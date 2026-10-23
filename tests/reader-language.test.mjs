import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeedParser, readerHtml, readerLineHeight } from '../entry/src/main/ets/reader/Feed.ts';

const resolve = (value, base) => new URL(value, base).href;
const element = (name, children = [], attributes = {}) =>
  ({ _type: 'element', _name: name, _elements: children, _attributes: attributes });
const text = value => ({ _type: 'text', _text: value });
const xmlParser = root => new FeedParser(resolve, () => ({ _elements: [root] }));

test('RSS channel language is retained without changing article identity or content', () => {
  const item = element('item', [element('guid', [text('one')]), element('description', [text('<p>Hello</p>')])]);
  const parse = language => xmlParser(element('rss', [element('channel', [
    element('language', [text(language)]), item,
  ])])).parse('<rss/>', 'https://example.org/rss').articles[0];
  const english = parse('en-US');
  assert.equal(english.language, 'en-US');
  assert.equal(english.content, '<p>Hello</p>');
  assert.equal(english.id, parse('zh-CN').id);
});

test('Atom language inherits from feed through entry and selected content, with empty overrides respected', () => {
  const entry = (id, entryAttrs, contentAttrs) => element('entry', [
    element('id', [text(id)]), element('content', [text('Hello')], contentAttrs),
  ], entryAttrs);
  const feed = element('feed', [
    entry('inherited', {}, {}), entry('entry', { 'xml:lang': 'zh-CN' }, {}),
    entry('content', { 'xml:lang': 'zh-CN' }, { 'xml:lang': 'en-GB' }),
    entry('unknown', { 'xml:lang': '' }, {}),
  ], { 'xml:lang': 'en' });
  assert.deepEqual(xmlParser(feed).parse('<feed/>', 'https://example.org/atom').articles.map(a => a.language),
    ['en', 'zh-CN', 'en-GB', '']);
  const localNames = JSON.parse(JSON.stringify(feed).replaceAll('"xml:lang"', '"lang"'));
  assert.deepEqual(xmlParser(localNames).parse('<feed/>', 'https://example.org/atom').articles.map(a => a.language),
    ['en', 'zh-CN', 'en-GB', '']);
});

test('JSON Feed uses item language before feed language and ignores malformed optional declarations', () => {
  const parser = new FeedParser(resolve, () => ({}));
  const data = { version: 'https://jsonfeed.org/version/1.1', title: 'Feed', language: 'en-US',
    items: [{ id: 'one', content_text: 'Hello' }, { id: 'two', language: 'zh-Hans', content_text: '你好' },
      { id: 'three', language: 42, content_text: 'Hello' }] };
  assert.deepEqual(parser.parse(JSON.stringify(data), 'https://example.org/json').articles.map(a => a.language),
    ['en-US', 'zh-Hans', 'en-US']);
});

test('leading follows the article script, not a missing or mislabelled language tag', () => {
  const article = { id: 'a', feedId: '', title: 'Title', link: '', content: '<p>Hello</p>',
    author: '', published: 0, read: false, starred: false };
  const english = '<p>Apple announced the new devices today, and the reviews are already in.</p>';
  const chinese = '<p>今天发布的新设备已经开始陆续送到评测者手中，评价相当正面。</p>';
  for (const language of [undefined, '', 'en', 'en-US', 'fr', 'english', 'zh-CN']) {
    assert.ok(readerHtml({ ...article, language, content: english }, 18).includes('font:18px/1.6 Literata,SourceHanSerif,serif'), `${language}`);
    assert.ok(readerHtml({ ...article, language, title: '新设备', content: chinese }, 18).includes('font:18px/1.8 Literata,SourceHanSerif,serif'), `${language}`);
  }
  // A few English product names inside Chinese prose, or a few Chinese words inside English prose, do not flip the leading.
  assert.equal(readerLineHeight('', '<p>苹果今天发布了 iPhone 和 MacBook Pro，评测者认为续航明显改善。</p>'), 1.8);
  assert.equal(readerLineHeight('', '<p>The word for “reader” is 读者, and it appears in the app name.</p>'), 1.6);
  assert.equal(readerLineHeight('', '<img src="/a.jpg">'), 1.8, 'image-only posts keep the CJK default');
  for (const language of ['en', 'en-US', 'EN-gb']) {
    assert.ok(readerHtml({ ...article, language }, 18).includes(`lang="${language}"`));
    assert.ok(readerHtml({ ...article, language }, 18).includes('script-src \'none\''));
  }
  assert.ok(!readerHtml({ ...article, language: 'en" onload="alert(1)' }, 18).includes('lang="en" onload='));
});
