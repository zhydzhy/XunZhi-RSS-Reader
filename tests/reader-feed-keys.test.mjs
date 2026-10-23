import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const feed = { id: 'https://example.org/feed', title: 'Old', folder: '[]', error: 'HTTP 404',
  icon: '', site: 'https://example.org', checked: 1, etag: 'old', modified: '' };
function keys(section, end) {
  const body = source.slice(source.indexOf(section), source.indexOf(end, source.indexOf(section)));
  return [...body.matchAll(/\}, \(feed: Feed\) => (.+)\)/g)]
    .map(match => runInNewContext(`(feed) => ${match[1]}`));
}
function changes(key, fields) {
  for (const field of fields) assert.notEqual(key(feed), key({ ...feed, [field]: 'changed' }), field);
  assert.equal(key(feed), key({ ...feed, etag: 'new', modified: 'new' }), 'transport validators do not recreate UI');
}

test('both library groups invalidate changed labels and retain rows on timestamp-only refresh', () => {
  const library = keys('  library(', '  homeActions(');
  assert.equal(library.length, 2);
  for (const key of library) {
    changes(key, ['id', 'title', 'folder', 'error', 'icon']);
    assert.equal(key(feed), key({ ...feed, checked: 2 }), 'library does not display checked time');
  }
});

test('activity rows invalidate all displayed metadata and captured website targets', () => {
  const activity = keys('  currentActivity() {', '  appearanceControls() {');
  assert.equal(activity.length, 1);
  changes(activity[0], ['id', 'title', 'error', 'icon', 'checked', 'site']);
});
