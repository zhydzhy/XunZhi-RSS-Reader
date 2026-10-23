import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textOnly } from '../entry/src/main/ets/reader/Feed.ts';

test('feed previews decode decimal and hexadecimal characters exactly once', () => {
  assert.equal(textOnly('<p>NPR&#8217;s &#x201C;Planet Money&#x201D; &#128640;</p>'), 'NPR’s “Planet Money” 🚀');
  assert.equal(textOnly('&amp;#8217; &#38;rsquo; &#x26;lt;'), '&#8217; &rsquo; &lt;');
  assert.equal(textOnly('&#0; &#55296; &#1114112;'), '� � �');
});
