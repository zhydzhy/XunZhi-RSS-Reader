import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
const source = readFileSync(new URL('../entry/src/main/ets/reader/NativeFeed.ets', import.meta.url), 'utf8').replace(/^import .*\n/gm, '').replaceAll('export ', '');
function setup(respond) {
  const clients = [];
  const http = { InterceptorType: { REDIRECTION: 0 }, RequestMethod: { GET: 0 }, HttpDataType: { ARRAY_BUFFER: 0 },
    HttpInterceptorChain: class { addChain() {} apply() {} },
    createHttp() {
      let reject;
      const client = { destroyed: 0, request(address, options) { return new Promise((resolve, fail) => { reject = fail; respond({ address, options, resolve, reject: fail, client }); }); },
        destroy() { this.destroyed++; reject?.(new Error('cancelled')); } };
      clients.push(client); return client;
    },
  };
  return { clients, ...runInNewContext(stripTypeScriptTypes(source) + '\n({fetchResource, fetchFeed})', {
    http, url: { URL }, util: { TextDecoder: class { constructor(encoding) { this.decoder = new TextDecoder(encoding); } decodeToString(data) { return this.decoder.decode(data); } } }, MAX_SOURCE: 1024,
  }) };
}
const response = (code, header = {}, body = '') => ({ responseCode: code, header, result: new TextEncoder().encode(body).buffer });
test('cancelling feed discovery interrupts its native request and unregisters its cancellation callback', async () => {
  const s = setup(() => {}); let cancel;
  const result = s.fetchFeed('https://slow.example/', '', '', value => { cancel = value; });
  const failure = assert.rejects(result, /cancelled/);
  assert.equal(typeof cancel, 'function'); cancel(); await failure;
  assert.equal(cancel, undefined); assert.deepEqual(s.clients.map(c => c.destroyed), [1]);
});
test('cancellation after a redirect response prevents the next hop and destroys the client once', async () => {
  let finish, cancel; const s = setup(request => { finish = request.resolve; });
  const result = s.fetchResource('https://slow.example/', 'text/html', 1024, '', '', value => { cancel = value; });
  const failure = assert.rejects(result, /cancelled/i);
  assert.equal(typeof cancel, 'function');
  finish(response(302, { location: '/next' })); cancel(); await failure;
  assert.equal(s.clients.length, 1); assert.equal(s.clients[0].destroyed, 1); assert.equal(cancel, undefined);
});
test('redirects replace the cancellation handler; ordinary resource requests keep their existing behavior', async () => {
  const s = setup(({ address, resolve }) => resolve(address.endsWith('/next') ? response(200, { 'Content-Type': 'text/html' }, 'ready') : response(302, { location: '/next' })));
  const registered = [];
  const result = await s.fetchFeed('https://example.org/', '', '', value => registered.push(value));
  assert.equal(result.source, 'ready'); assert.equal(result.url, 'https://example.org/next');
  assert.equal(registered.filter(value => typeof value === 'function').length, 2);
  assert.equal(registered.at(-1), undefined); assert.deepEqual(s.clients.map(c => c.destroyed), [1,1]);
  const icon = setup(({ resolve }) => resolve(response(200, { 'Content-Type': 'image/png' }, 'icon')));
  const image = await icon.fetchResource('https://example.org/icon', 'image/*', 1024);
  assert.equal(image.data.byteLength, 4); assert.equal(image.type, 'image/png'); assert.equal(icon.clients[0].destroyed, 1);
});
