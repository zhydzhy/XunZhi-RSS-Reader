import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareVideos } from '../entry/src/main/ets/reader/ReaderMedia.ts';

function resolve(value, base) {
  const u = new URL(value, base);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw Error('bad url');
  return u.href;
}
test('HLS video becomes an inline player with no autoplay, preserving surrounding paragraphs', () => {
  const result = prepareVideos('<p>Train</p><video controls src="/movie.m3u8?a=1&amp;b=2" poster="/cover.jpg"></video><p>After</p>',
    'https://example.org/post', resolve);
  assert.ok(result.includes('src="https://example.org/movie.m3u8?a=1&amp;b=2"'));
  assert.ok(result.includes('poster="https://example.org/cover.jpg"'));
  assert.ok(result.includes('controls playsinline preload="metadata"'));
  assert.ok(!result.includes('autoplay'));
  assert.ok(result.startsWith('<p>Train</p>'));
  assert.ok(result.endsWith('<p>After</p>'));
  assert.ok(result.includes('<video'));
  assert.ok(!result.includes('xunzhi:'));
});
test('source children work; comments, scripts and unsafe media URLs do not become playable', () => {
  const result = prepareVideos('<!--<video src="/hidden.mp4"></video>--><script>"<video src=/hidden.mp4></video>"</script>' +
    '<VIDEO poster="javascript:bad"><SOURCE src="//example.org/a.mp4"></VIDEO>' +
    '<video src="file:///private/movie.mp4"></video><video src="https://user:pass@example.org/a"></video>',
    'https://example.org/', resolve);
  assert.ok(result.includes('src="https://example.org/a.mp4"'));
  for (const forbidden of ['hidden.mp4', 'javascript:', 'file:', 'user:pass', '<script']) {
    assert.ok(!result.includes(forbidden));
  }
});

import { readerHtml } from '../entry/src/main/ets/reader/Feed.ts';
test('reader permits HTTP media without enabling scripts or frames', () => {
  const html = readerHtml({ title: '', author: '', link: 'https://example.org', feedId: '', content: '<video></video>' }, 18);
  assert.ok(html.includes('media-src https: http:;'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("script-src 'none'"));
  assert.ok(html.includes("frame-src 'none'"));
});


test('media and poster attributes decode numeric entities before validation and escape output once', () => {
  const html = prepareVideos('<video src="clip.mp4?x=1&#38;y=2" poster="cover&#46;jpg"></video>' +
    '<video src="jav&#97;script:alert(1)"></video>', 'https://example.org/post', resolve);
  assert.ok(html.includes('src="https://example.org/clip.mp4?x=1&amp;y=2"'));
  assert.ok(html.includes('poster="https://example.org/cover.jpg"'));
  assert.ok(html.includes('无法加载视频'));
  assert.ok(!html.includes('javascript:'));
});
