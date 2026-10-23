import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../entry/src/main/ets/reader/ReaderArticleSource.ets', import.meta.url), 'utf8');
const ReaderArticleSource = runInNewContext(stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '')
  .replace('export class', 'class')) + '\nReaderArticleSource');
const article = { id: 'a', feedId: 'feed', title: '标题', content: '<p>正文</p>', link: 'https://example.org/a',
  published: 1, author: '作者', language: 'zh', read: false, starred: false };

test('unchanged snapshots and reordering retain row keys while replacing data references', () => {
  const rows = new ReaderArticleSource();
  const first = { ...article }; const second = { ...article, id: 'b' };
  rows.replace([first, second]);
  const keys = [rows.key('a'), rows.key('b')];
  const replacement = { ...first };
  rows.replace([{ ...second }, replacement]);
  assert.deepEqual([rows.key('a'), rows.key('b')], keys);
  assert.equal(rows.getData(1), replacement);
  rows.replace([{ ...article, id: 'new' }, replacement, { ...second }]);
  assert.deepEqual([rows.key('a'), rows.key('b')], keys);
  assert.notEqual(rows.key('new'), rows.key('a'));
});

test('every changed article field invalidates only its own row, including non-preview content', () => {
  const changes = { feedId: 'other', title: '新标题', content: '<p>正文</p><p>new</p>', link: 'https://example.org/new',
    published: 2, author: '新作者', language: 'en', read: true, starred: true };
  for (const [field, value] of Object.entries(changes)) {
    const rows = new ReaderArticleSource(); rows.replace([{ ...article }, { ...article, id: 'b' }]);
    const before = [rows.key('a'), rows.key('b')];
    rows.replace([{ ...article, [field]: value }, { ...article, id: 'b' }]);
    assert.notEqual(rows.key('a'), before[0], field);
    assert.equal(rows.key('b'), before[1], field);
    assert.equal(rows.getData(0)[field], value);
  }
});

test('removed rows are retired and listener registration stays idempotent', () => {
  const rows = new ReaderArticleSource(); let reloads = 0;
  const listener = { onDataReloaded() { reloads++; } };
  rows.registerDataChangeListener(listener); rows.registerDataChangeListener(listener);
  rows.replace([{ ...article }]); const original = rows.key('a');
  rows.replace([]); rows.replace([{ ...article, title: '返回后更新' }]);
  assert.notEqual(rows.key('a'), original); assert.equal(reloads, 3);
  rows.unregisterDataChangeListener(listener); rows.replace([]); assert.equal(reloads, 3);
});
