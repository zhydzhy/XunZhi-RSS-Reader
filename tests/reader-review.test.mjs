import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleDate, feedError, readerHtml } from '../entry/src/main/ets/reader/Feed.ts';

const now = new Date(2026, 9, 20, 18, 0);
test('article dates use local calendar boundaries, omit missing dates and retain older years', () => {
  assert.equal(articleDate(new Date(2026, 9, 20, 15, 42).getTime(), now), '15:42');
  assert.equal(articleDate(new Date(2026, 9, 19, 23, 59).getTime(), now), '昨天');
  assert.equal(articleDate(new Date(2026, 9, 18).getTime(), now), '10月18日');
  assert.equal(articleDate(new Date(2025, 9, 18).getTime(), now), '2025年10月18日');
  assert.equal(articleDate(0, now), '');
  assert.equal(articleDate(NaN, now), '');
  assert.equal(articleDate(new Date(2026, 9, 20, 15, 42).getTime(), now, true), '10月20日 15:42');
});

test('transport failures receive readable copy', () => {
  for (const [raw, copy] of [
    ['HTTP 404', '订阅地址已失效'], ['HTTP 410', '订阅地址已失效'],
    ['Transferred a partial file', '下载中断，稍后会重试'],
    ['Operation timed out', '网站响应超时'], ['XML parse failed', '内容格式无法识别'],
    ['2300999 Internal error', '无法连接到网站'],
  ]) assert.equal(feedError(raw), copy);
});

test('reader metadata is escaped and the native footer slot preserves fragments and CSP', () => {
  const article = { id: 'a', feedId: 'https://example.org/feed', link: 'https://example.org/post?a=1&b=2',
    title: '<Title>', content: '<a href="#note">note</a><p id="note">Footnote</p>', author: '<Author>',
    published: now.getTime(), read: false, starred: false };
  const html = readerHtml(article, 18, 'dark', article.content, 'A & B');
  assert.ok(html.includes('<p class="source">A &amp; B'));
  assert.ok(html.includes('<p class="source">A &amp; B</p>'), 'the feed name is a kicker of its own above the title');
  assert.ok(html.includes('<p class="byline">&lt;Author&gt; · 10月20日 18:00</p>'), 'author and date sit together under the title');
  assert.ok(readerHtml({ ...article, author: ' ' }, 18).includes('<p class="byline">10月20日 18:00</p>'));
  assert.ok(!readerHtml({ ...article, author: '', published: 0 }, 18).includes('class="byline"'));
  assert.ok(html.includes('<a href="https://example.org/post?a=1&amp;b=2">&lt;Title&gt;</a>'));
  assert.ok(html.includes('<embed id="xunzhi-reader-footer" type="native/xunzhi-footer">'));
  assert.ok(!html.includes('xunzhi://next'), 'the document must not retain a stale queue snapshot');
  assert.ok(html.includes(article.content));
  assert.ok(html.includes("script-src 'none'"));
  assert.ok(html.includes('padding:56px 20px 0'), 'article opening must clear the overlay bar without resizing the Web');
  assert.ok(html.includes('scroll-padding-top:56px'), 'fragment targets must clear the visible overlay bar');
  assert.ok(html.includes('viewport-fit=cover') && html.includes('padding-bottom:env(safe-area-inset-bottom,0px)'),
    'the article runs under the gesture bar but its footer ends above it');
  assert.ok(!readerHtml({ ...article, link: 'javascript:alert(1)' }, 18).includes('href="javascript:'));
});


test('empty or whitespace-only bodies offer an original link only when one exists', () => {
  const article = { id: 'empty', feedId: 'https://example.org/feed', link: '', title: 'Empty',
    content: '  \n ', author: '', published: 0, read: false, starred: false };
  for (const content of [article.content, '<p></p>', '<p>&nbsp; &#160;</p>', '<!-- hidden -->', '<script>hidden</script><style>hidden</style>']) {
    assert.ok(readerHtml({ ...article, content }, 18).includes('此订阅未提供正文，也没有提供原文链接。'));
  }
  const missing = readerHtml(article, 18);
  assert.ok(missing.includes('此订阅未提供正文，也没有提供原文链接。'));
  assert.equal(missing.includes('在浏览器中打开'), false);
  const linked = readerHtml({ ...article, link: 'https://example.org/post?a=1&b=2' }, 18);
  assert.ok(linked.includes('<a href="https://example.org/post?a=1&amp;b=2">在浏览器中打开</a>'));
  assert.equal(linked.includes('也没有提供原文链接'), false);
});
