import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
const source = readFileSync(new URL('../entry/src/main/ets/reader/ReaderStore.ets', import.meta.url), 'utf8');
const ReaderStore = runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('export class')).replace('export class', 'class')) + '\nReaderStore', {
  relationalStore: {
    ConflictResolution: { ON_CONFLICT_REPLACE: 1 },
    RdbPredicates: class {
      in(field, values) { this.field = field; this.values = values; return this; }
      orderByDesc() { return this; } orderByAsc() { return this; }
    },
  },
});
test('a failed bulk-read transaction rolls back all state changes', async () => {
  const store = new ReaderStore();
  const states = new Map([['original', 1]]);
  let backup;
  store.userDb = {
    beginTransaction() { backup = new Map(states); },
    async insert(_table, row) { if (row.articleId === 'fail') throw new Error('disk write failure'); states.set(row.id, row.value); },
    commit() { backup = undefined; },
    rollBack() { states.clear(); for (const [id, value] of backup) states.set(id, value); },
  };
  await assert.rejects(store.setReadStates(['a', 'fail'], true), /disk write failure/);
  assert.deepEqual([...states], [['original', 1]]);
  await store.setReadStates(['a', 'b'], true);
  assert.equal(states.get('read:a'), 1);
  assert.equal(states.get('read:b'), 1);
});

test('adding a feed during refresh serializes cache transactions and keeps later writes usable', async () => {
  const store = new ReaderStore();
  let active = false;
  const writes = [];
  store.cacheDb = {
    beginTransaction() { assert.equal(active, false, 'nested cache transaction'); active = true; },
    async insert(table, row) { await new Promise(resolve => setImmediate(resolve)); writes.push([table, row.id]); },
    commit() { active = false; }, rollBack() { active = false; },
  };
  const feed = id => ({ id, title: id, site: '', etag: '', modified: '', checked: 0, error: '' });
  await Promise.all([store.saveRefresh(feed('refresh'), undefined, '', ''), store.saveRefresh(feed('added'), undefined, '', '')]);
  assert.deepEqual(writes, [['FeedCache', 'refresh'], ['FeedCache', 'added']]);
  const insert = store.cacheDb.insert;
  store.cacheDb.insert = async (table, row) => {
    if (row.id === 'fail') throw new Error('disk write failure');
    return insert(table, row);
  };
  const results = await Promise.allSettled([
    store.saveRefresh(feed('fail'), undefined, '', ''), store.saveRefresh(feed('after-failure'), undefined, '', ''),
  ]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled']);
  assert.equal(writes.at(-1)[1], 'after-failure');
  assert.equal(active, false);
});

function resultSet(rows, failAt = Infinity) {
  let index = -1;
  return {
    closed: false,
    rowCount: rows.length,
    goToNextRow() { return ++index < rows.length; },
    getColumnIndex(name) { return name; },
    isColumnNull(name) { return rows[index][name] == null; },
    getString(name) { return rows[index][name]; },
    getDouble(name) { return rows[index][name] ?? 0; },
    async getRows(count, position) {
      await new Promise(resolve => setImmediate(resolve));
      if (position >= failAt) throw new Error('result read failure');
      return rows.slice(position, position + count);
    },
    close() { this.closed = true; },
  };
}

test('loading a large library allows other work while retaining complete ordered state and nullable fields', async () => {
  const store = new ReaderStore();
  const rows = Array.from({ length: 10000 }, (_, i) => ({
    id: String(i), feedId: 'feed', title: `Title ${i}`, content: '<p>body</p>',
    link: null, author: null, published: 10000 - i,
  }));
  const states = resultSet([{ articleId: '0', kind: 'read' }, { articleId: '9999', kind: 'star' }]);
  const articles = resultSet(rows);
  store.userDb = { querySql: async () => states };
  store.cacheDb = { query: async predicates => {
    assert.equal(predicates.field, 'feedId');
    assert.deepEqual(Array.from(predicates.values), ['feed']);
    return articles;
  } };
  let otherWorkRan = false;
  setImmediate(() => { otherWorkRan = true; });
  const loaded = await store.articles(['feed']);
  assert.equal(otherWorkRan, true, 'bulk result conversion must yield to the event loop');
  assert.equal(loaded.length, rows.length);
  assert.deepEqual(Array.from(loaded, row => row.id), rows.map(row => row.id));
  assert.equal(loaded[0].read, true);
  assert.equal(loaded[0].starred, false);
  assert.equal(loaded[9999].starred, true);
  assert.equal(loaded[9999].read, false);
  assert.equal(loaded[9999].published, 1);
  assert.equal(loaded[0].link, '');
  assert.equal(loaded[0].author, '');
  assert.equal(states.closed, true);
  assert.equal(articles.closed, true);
});

test('failed result batches close their cursor and reject without returning a partial library', async () => {
  for (const failStates of [true, false]) {
    const store = new ReaderStore();
    const states = resultSet([{ articleId: '0', kind: 'read' }], failStates ? 0 : Infinity);
    const articles = resultSet(Array.from({ length: 250 }, (_, i) => ({ id: String(i) })), 100);
    store.userDb = { querySql: async () => states };
    store.cacheDb = { query: async () => articles };
    await assert.rejects(store.articles(['feed']), /result read failure/);
    assert.equal(states.closed, true);
    assert.equal(articles.closed, !failStates);
  }
});

test('empty native results are closed without fetching out-of-bounds rows', async () => {
  for (const articleRows of [[], [{ id: 'new', feedId: 'feed', published: 1 }]]) {
    const store = new ReaderStore();
    const states = resultSet([], 0);
    const articles = resultSet(articleRows, articleRows.length ? Infinity : 0);
    store.userDb = { querySql: async () => states };
    store.cacheDb = { query: async () => articles };
    const rows = await store.articles(['feed']);
    assert.equal(rows.length, articleRows.length);
    assert.equal(rows.some(row => row.read || row.starred), false);
    assert.equal(states.closed, true);
    assert.equal(articles.closed, true);
  }
});
