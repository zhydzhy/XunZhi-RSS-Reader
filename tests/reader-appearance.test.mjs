import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { readerHtml } from '../entry/src/main/ets/reader/Feed.ts';

const article = {
  id: 'test', feedId: 'https://example.org/feed', title: '中文 <标题>',
  link: 'https://example.org/article', content: '<p>正文 &amp; English</p>',
  published: 0, author: '作者', read: false, starred: false,
};

test('explicit reader themes override the system without weakening HTML restrictions', () => {
  for (const theme of ['light', 'dark']) {
    const html = readerHtml(article, 22, theme);
    assert.ok(html.includes(`color-scheme:${theme}`));
    assert.ok(!html.includes('color-scheme:light dark'));
    assert.ok(html.includes("default-src 'none'"));
    assert.ok(html.includes("form-action 'none'"));
    assert.ok(html.includes('中文 &lt;标题&gt;'));
    assert.ok(html.includes('22px/1.8'));
    assert.ok(html.includes(article.content));
  }
});

test('system theme remains adaptive and arbitrary theme values cannot inject CSS', () => {
  assert.ok(readerHtml(article, 18).includes('prefers-color-scheme:dark'));
  const html = readerHtml(article, 18, '</style><script>alert(1)</script>');
  assert.ok(html.includes('color-scheme:light dark'));
  assert.ok(!html.includes('<script>'));
});

test('reader font sizes stay within the supported range including invalid saved values', () => {
  for (const [input, expected] of [[0, 14], [100, 30], [NaN, 18], [Infinity, 18]]) {
    assert.ok(readerHtml(article, input).includes(`${expected}px/1.8`));
  }
});

test('reader document canvas matches the native page background in both themes', () => {
  for (const [theme, folder] of [['light', 'base'], ['dark', 'dark']]) {
    const colors = JSON.parse(readFileSync(new URL(`../entry/src/main/resources/${folder}/element/color.json`, import.meta.url)));
    const background = colors.color.find(color => color.name === 'reader_background')?.value.toLowerCase();
    assert.ok(background, 'native page needs an explicit theme background');
    assert.ok(readerHtml(article, 18, theme).includes(`html,body{background:${background};`));
    assert.ok(readerHtml(article, 18, 'system').includes(`html,body{background:${background};`));
  }
});

test('grouped list separators span the text column of their cards', () => {
  const page = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
  const dividers = page.match(/\.divider\(\{[^}]*\}\)/g) ?? [];
  assert.equal(dividers.length, 5, 'the three library groups and both multi-row settings cards');
  for (const divider of dividers) {
    assert.match(divider, /startMargin: (56|16), endMargin: 16 \}/, 'lines start at the titles and end under the counts or chevrons');
  }
});
