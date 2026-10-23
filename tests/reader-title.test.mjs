import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeedParser, articleTitle, readerHtml } from '../entry/src/main/ets/reader/Feed.ts';
const parser = new FeedParser((value, base) => new URL(value, base).href, () => ({}));
function parse(title) {
  return parser.parse(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'Manton',
    items: [{ id: 'train', title, content_html: '<p>Yet more views from the train. 🚂</p><video src="/a.m3u8"></video>' }]
  }), 'https://example.org/feed.json').articles[0];
}
test('untitled feeds use opening text only in lists, with no fake or duplicate heading in the reader', () => {
  for (const title of [undefined, '', '  ']) {
    const article = parse(title);
    assert.equal(article.title, '');
    assert.equal(articleTitle(article), 'Yet more views from the train. 🚂');
    const html = readerHtml(article, 18);
    assert.ok(!html.includes('<h1>'));
    assert.equal(html.split('Yet more views from the train.').length - 1, 1);
    assert.ok(!html.includes('<p></p>'));
  }
});
test('real titles including the literal 无标题 remain intact and article IDs do not change', () => {
  const first = parse(undefined);
  for (const title of ['A real title', '无标题']) {
    const article = parse(title);
    assert.equal(article.id, first.id);
    assert.equal(articleTitle(article), title);
    assert.ok(readerHtml(article, 18).includes(`<h1>${title}</h1>`));
  }
  assert.equal(articleTitle({ ...first, content: '<img src="/a.jpg">' }), '图片');
  assert.equal(articleTitle({ ...first, content: '<video src="/a.mp4"></video>' }), '视频');
});
