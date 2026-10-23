import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeedParser } from '../entry/src/main/ets/reader/Feed.ts';
import { iconCandidates } from '../entry/src/main/ets/reader/ReaderMedia.ts';
const resolve = (value, base) => {
  const url = new URL(value, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('unsafe');
  return url.href;
};
test('JSON Feed preserves its declared favicon and resolves relative URLs', () => {
  const parser = new FeedParser(resolve, () => ({}));
  const parsed = parser.parse(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'Site',
    favicon: '/favicon.png', icon: '/large.png', items: [] }), 'https://example.org/feed.json');
  assert.equal(parsed.icon, 'https://example.org/favicon.png');
});
test('website discovery uses rel tokens, relative base and touch icons, without requesting script URLs', () => {
  const html = '<!--<link rel=icon href=/hidden.png>--><base href="/assets/">' +
    '<link rel="shortcut icon" href="small.ico"><link href="touch.png?a=1&amp;b=2" rel="apple-touch-icon">' +
    '<link rel="icon" href="javascript:alert(1)"><script>"<link rel=icon href=/script.png>"</script>';
  assert.deepEqual(iconCandidates(html, 'https://example.org/blog', resolve), [
    'https://example.org/assets/touch.png?a=1&b=2', 'https://example.org/assets/small.ico', 'https://example.org/favicon.ico'
  ]);
});

test('background icon updates remain serial, coalesce duplicate feeds and continue after failure', async () => {
  const { readFileSync } = await import('node:fs');
  const { stripTypeScriptTypes } = await import('node:module');
  const { runInNewContext } = await import('node:vm');
  const source = readFileSync(new URL('../entry/src/main/ets/reader/ReaderIcons.ets', import.meta.url), 'utf8');
  const ReaderIcons = runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('export class')).replace('export class', 'class')) + '\nReaderIcons', {
    preferences: { getPreferencesSync: () => ({}) }, fileIo: { accessSync: () => true },
  });
  const icons = new ReaderIcons({ filesDir: '/unused' });
  const first = Promise.withResolvers(); const second = Promise.withResolvers(); const calls = [];
  let active = 0; let maximum = 0;
  icons.updateRecord = async id => {
    calls.push(id); active++; maximum = Math.max(maximum, active);
    try { if (id === 'a') return await first.promise; if (id === 'b') return await second.promise; return 'c-icon'; }
    finally { active--; }
  };
  const a = icons.update('a', ''); const again = icons.update('a', '');
  const b = icons.update('b', ''); const failed = assert.rejects(b, /icon failed/);
  const c = icons.update('c', '');
  await new Promise(resolve => setImmediate(resolve));
  try { assert.deepEqual(calls, ['a'], 'only one feed icon may perform network work at a time'); }
  finally { first.resolve('a-icon'); second.reject(new Error('icon failed')); }
  assert.equal(await a, 'a-icon'); assert.equal(await again, 'a-icon'); await failed;
  assert.equal(await c, 'c-icon'); assert.deepEqual(calls, ['a', 'b', 'c']);
  assert.equal(maximum, 1); assert.equal(icons.pending.size, 0);
});


test('icon discovery decodes base and link attributes exactly once', () => {
  assert.deepEqual(iconCandidates('<base href="/assets&#47;"><link rel=icon href="logo&#46;png?x=1&#x26;y=2">' +
    '<link rel=icon href="jav&#97;script:alert(1)">', 'https://example.org/post', resolve),
    ['https://example.org/assets/logo.png?x=1&y=2', 'https://example.org/favicon.ico']);
});

async function iconService() {
  const { readFileSync } = await import('node:fs');
  const { stripTypeScriptTypes } = await import('node:module');
  const { runInNewContext } = await import('node:vm');
  const values = new Map();
  const source = readFileSync(new URL('../entry/src/main/ets/reader/ReaderIcons.ets', import.meta.url), 'utf8');
  const ReaderIcons = runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('export class')).replace('export class', 'class')) + '\nReaderIcons', {
    preferences: { getPreferencesSync: () => ({
      getSync: (key, fallback) => values.get(key) ?? fallback,
      putSync: (key, value) => values.set(key, value), flush: async () => {},
    }) },
    fileIo: { accessSync: () => true, unlink: async () => {} },
    resolveHttp: resolve, fetchFeed: async () => { throw Error('website unavailable'); },
  });
  return { icons: new ReaderIcons({ filesDir: '/unused' }), values };
}

test('refresh declaration arriving during startup icon discovery is applied and duplicate refreshes coalesce', async () => {
  const { icons, values } = await iconService();
  const old = Promise.withResolvers(); const fresh = Promise.withResolvers(); const downloads = [];
  icons.download = address => { downloads.push(address); return downloads.length === 1 ? old.promise : fresh.promise; };
  const startup = icons.update('feed', 'https://example.org/');
  await new Promise(resolve => setImmediate(resolve));
  const refresh = icons.update('feed', 'https://example.org/', 'https://example.org/new.png', true);
  const duplicate = icons.update('feed', 'https://example.org/', 'https://example.org/new.png', true);
  old.resolve('/cache/old.png');
  assert.equal(await startup, '/cache/old.png');
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.deepEqual(downloads, ['https://example.org/favicon.ico', 'https://example.org/new.png']);
    assert.equal(icons.pending.has('feed'), true, 'finishing the old request must not remove the queued refresh');
  } finally { fresh.resolve('/cache/new.png'); }
  assert.equal(await refresh, '/cache/new.png'); assert.equal(await duplicate, '/cache/new.png');
  assert.equal(JSON.parse(values.get('feed')).declared, 'https://example.org/new.png');
  assert.equal(icons.cached('feed'), '/cache/new.png'); assert.equal(icons.pending.size, 0);
});

test('explicit missing-icon retry is not swallowed by a pending startup failure', async () => {
  const { icons } = await iconService(); const failed = Promise.withResolvers(); let downloads = 0;
  icons.download = () => ++downloads === 1 ? failed.promise : Promise.resolve('/cache/recovered.png');
  const startup = icons.update('feed', 'https://example.org/');
  await new Promise(resolve => setImmediate(resolve));
  const retry = icons.update('feed', 'https://example.org/', '', true);
  failed.reject(new Error('temporary icon outage'));
  assert.equal(await startup, '');
  assert.equal(await retry, '/cache/recovered.png');
  assert.equal(downloads, 2); assert.equal(icons.pending.size, 0);
});
