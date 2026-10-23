import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
const source = readFileSync(new URL('../entry/src/main/ets/reader/ReaderProgress.ets', import.meta.url), 'utf8');
const databases = new Map();
let failWrite = false;
const ReaderProgress = runInNewContext(stripTypeScriptTypes(source.replace(/^import .*;\n/gm, '').replace(/export /g, '')) + '\nReaderProgress', {
  relationalStore: {
    SecurityLevel: { S1: 1 }, ConflictResolution: { ON_CONFLICT_REPLACE: 1 },
    async getRdbStore(_context, { name }) {
      if (!databases.has(name)) databases.set(name, new Map());
      const rows = databases.get(name);
      return {
        version: 1, async executeSql() {}, async close() {},
        async querySql() {
          const data = [...rows.values()];
          return { rowCount: data.length, async getRows(n, offset) { return data.slice(offset, offset + n); }, close() {} };
        },
        async insert(_table, row) {
          await new Promise(resolve => setImmediate(resolve));
          if (failWrite) { failWrite = false; throw new Error('disk full'); }
          rows.set(row.id, { ...row });
        },
      };
    },
  },
});

test('independent article positions and latest visit survive closing and reopening storage', async () => {
  let progress = new ReaderProgress(); await progress.open({}, 'reopen');
  assert.equal(progress.lastArticleId, ''); assert.equal(progress.position('a'), 0);
  await progress.visit('a'); await progress.save('a', 1234.5);
  await progress.visit('b'); await progress.save('b', 345);
  await progress.save('a', 777); // late save of A must not make it the last-opened article
  await progress.close(); progress = new ReaderProgress(); await progress.open({}, 'reopen');
  assert.equal(progress.lastArticleId, 'b');
  assert.equal(progress.position('a'), 777); assert.equal(progress.position('b'), 345);
  await progress.visit('a'); await progress.save('a', 0); await progress.close();
  progress = new ReaderProgress(); await progress.open({}, 'reopen');
  assert.equal(progress.lastArticleId, 'a'); assert.equal(progress.position('a'), 0);
});

test('writes capture immutable snapshots, stay ordered and recover after a disk error', async () => {
  const progress = new ReaderProgress(); await progress.open({}, 'ordering');
  await progress.visit('a');
  await Promise.all([progress.save('a', 100), progress.save('a', 200), progress.save('a', 300)]);
  assert.equal(databases.get('ordering').get('a').y, 300);
  failWrite = true; await assert.rejects(progress.save('a', 400), /disk full/);
  await progress.save('a', 500); await progress.close();
  assert.equal(databases.get('ordering').get('a').y, 500);
});

test('invalid scroll values never poison a good saved position; overscroll clamps to top', async () => {
  const progress = new ReaderProgress(); await progress.open({}, 'invalid');
  await progress.visit('a'); await progress.save('a', 12);
  await progress.save('a', NaN); await progress.save('a', Infinity);
  assert.equal(progress.position('a'), 12);
  await progress.save('a', -8); assert.equal(progress.position('a'), 0);
});
