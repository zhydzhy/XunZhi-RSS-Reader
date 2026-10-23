import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { readerHtml, readerFontFile, READER_FONT_FILES, READER_FONT_ORIGIN, READER_FONT, READER_HEADING_FONT } from '../entry/src/main/ets/reader/Feed.ts';

test('font interception serves only packaged fonts and leaves article and image requests alone', () => {
  const source = readFileSync(new URL('../entry/src/main/ets/reader/ReaderFonts.ets', import.meta.url), 'utf8');
  const responseFor = runInNewContext(stripTypeScriptTypes(source.slice(source.indexOf('export function readerFontResponse'))
    .replace('export function', 'function')) + '\nreaderFontResponse', {
    readerFontFile, $rawfile: file => file,
    WebResourceResponse: class {
      setResponseData(data) { this.data = data; }
      setResponseMimeType(mime) { this.mime = mime; }
      setResponseCode(code) { this.code = code; }
      setReasonMessage() {}
      setResponseHeader(headers) { this.headers = headers; }
    },
  });
  for (const file of READER_FONT_FILES) {
    const response = responseFor(`${READER_FONT_ORIGIN}/${file}`);
    assert.equal(response.data, `fonts/${file}`);
    assert.equal(response.code, 200);
    assert.match(response.mime, /^font\/(otf|ttf)$/);
    const data = readFileSync(new URL(`../entry/src/main/resources/rawfile/${response.data}`, import.meta.url));
    assert.ok(data.length > 100000);
    assert.ok(data.subarray(0, 4).equals(Buffer.from([0, 1, 0, 0])) || data.subarray(0, 4).toString() === 'OTTO');
  }
  for (const url of ['https://example.org/image.png', `${READER_FONT_ORIGIN}/../secret`,
    `${READER_FONT_ORIGIN}/%2e%2e/secret`, `${READER_FONT_ORIGIN}/Literata-Regular.ttf?other`,
    'file:///system/fonts/secret', 'https://fonts.xunzhi.invalid.evil/Literata-Regular.ttf']) {
    assert.equal(responseFor(url), null);
  }
});

test('mixed-language reader uses offline serif faces without enabling scripts, file access, or remote fonts', () => {
  const html = readerHtml({ id: 'a', feedId: '', title: '阅读 Reading', link: '',
    content: '<p>中文 English <em>italic</em> <strong>bold</strong></p><pre>const x = 1;</pre>',
    author: '', published: 0, read: false, starred: false }, 18);
  assert.ok(html.includes('Literata,SourceHanSerif,serif'));
  assert.ok(html.includes(`font-src ${READER_FONT_ORIGIN};`));
  assert.ok(html.includes("script-src 'none'"));
  assert.ok(html.includes('font-style:italic'));
  assert.ok(html.includes('<pre>const x = 1;</pre>'));
  for (const file of READER_FONT_FILES) assert.ok(html.includes(`${READER_FONT_ORIGIN}/${file}`));
  for (const file of ['Literata-OFL.txt', 'SourceHanSerif-LICENSE.txt']) {
    const license = readFileSync(new URL(`../entry/src/main/resources/rawfile/fonts/${file}`, import.meta.url), 'utf8');
    assert.match(license, /Copyright/);
    assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  }
});

// ArkUI on API 26 treats leading whitespace after a comma as part of the next alias.
test('native font aliases have no whitespace that silently sends Chinese to the system font', () => {
  for (const family of [READER_FONT, READER_HEADING_FONT]) {
    for (const alias of family.split(',')) assert.equal(alias, alias.trim());
  }
});
