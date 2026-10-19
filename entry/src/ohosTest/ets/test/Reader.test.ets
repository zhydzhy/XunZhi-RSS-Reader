import { describe, it, expect } from '@ohos/hypium';
import { abilityDelegatorRegistry } from '@kit.TestKit';
import { relationalStore } from '@kit.ArkData';
import { common } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { makeParser, resolveHttp, discoverFeeds, fetchFeed } from '../../../main/ets/reader/NativeFeed';
import { exportOpml, readerHtml, textOnly, Feed, Subscription } from '../../../main/ets/reader/Feed';
import { ReaderStore } from '../../../main/ets/reader/ReaderStore';
import { readOpmlFile } from '../../../main/ets/reader/ReaderFiles';
import { rss, atom, json, opml, malformed, dtd } from './Fixtures';

function rejects(action: () => void): boolean { try { action(); return false; } catch (_) { return true; } }
let nativeContext: common.UIAbilityContext | undefined;
async function testContext(): Promise<common.UIAbilityContext> {
  if (nativeContext) return nativeContext;
  const delegator = abilityDelegatorRegistry.getAbilityDelegator();
  const monitor: abilityDelegatorRegistry.AbilityMonitor = { abilityName: 'EntryAbility' };
  await delegator.addAbilityMonitor(monitor);
  try {
    await delegator.startAbility({ bundleName: 'com.apexracing.rssreader', abilityName: 'EntryAbility' });
    nativeContext = (await delegator.waitAbilityMonitor(monitor, 5000)).context;
    return nativeContext;
  } finally { await delegator.removeAbilityMonitor(monitor); }
}
export default function readerTest() {
  describe('ReaderP2', () => {
    it('preview_decodes_typographic_entities_once', 0, () => {
      expect(textOnly('<p>We&rsquo;ve&nbsp;updated &ldquo;JSON&rdquo;&hellip;</p>')).assertEqual('We’ve updated “JSON”…');
      expect(textOnly('&amp;rsquo;')).assertEqual('&rsquo;');
    });
    it('rss_cdata_namespace_unicode_dedup', 0, () => {
      const feed = makeParser().parse(rss, 'https://example.org/feed');
      expect(feed.title).assertEqual('测试 & News'); expect(feed.articles.length).assertEqual(1);
      expect(feed.articles[0].link).assertEqual('https://example.org/a');
      expect(feed.articles[0].content).assertContain('<p>正文 &amp; 内容</p>');
    });
    it('atom_base_xhtml_author_date', 0, () => {
      const feed = makeParser().parse(atom, 'https://example.org/atom');
      expect(feed.articles[0].link).assertEqual('https://example.org/blog/first');
      expect(feed.articles[0].author).assertEqual('Alice');
      expect(feed.articles[0].content).assertContain('<strong>强调</strong>');
      expect(feed.articles[0].published).assertEqual(1792153800000);
    });
    it('json_feed_text_is_escaped', 0, () => {
      const feed = makeParser().parse(json, 'https://example.org/json');
      expect(feed.articles[0].content).assertContain('&lt;script&gt;');
      expect(feed.articles[0].link).assertEqual('https://example.org/json');
    });
    it('reject_malformed_dtd_oversize_depth_wrong_format', 0, () => {
      for (const source of [malformed, dtd, '<a>'.repeat(66) + '</a>'.repeat(66), 'x'.repeat(4194305), '<html/>', '<rss/>']) {
        expect(rejects(() => { makeParser().parse(source, 'https://example.org/'); })).assertTrue();
      }
      expect(rejects(() => { makeParser().parse('{"version":"https://jsonfeed.org/version/1.1","title":"bad","items":[{"id":4}]}', 'https://example.org/'); })).assertTrue();
    });
    it('opml_roundtrip_nested_folders_and_escaping', 0, () => {
      const before = makeParser().importOpml(opml);
      const after = makeParser().importOpml(exportOpml(before));
      expect(before.length).assertEqual(2);
      expect(JSON.stringify(after.sort((a: Subscription, b: Subscription) => a.url.localeCompare(b.url)))).assertEqual(JSON.stringify(before.sort((a: Subscription, b: Subscription) => a.url.localeCompare(b.url))));
      expect(before.find((s: Subscription) => s.folders.length > 0)!.folders.join('/')).assertEqual('技术 & 阅读/嵌套');
    });
    it('discovery_relative_urls_and_protocol_rejection', 0, () => {
      const candidates = discoverFeeds('<html><head><link rel="alternate" type="application/rss+xml" href="/feed?a=1&amp;b=2"><link rel="alternate" type="application/atom+xml" href="javascript:alert(1)"></head></html>', 'https://example.org/');
      expect(candidates.length).assertEqual(1); expect(candidates[0]).assertEqual('https://example.org/feed?a=1&b=2');
      expect(rejects(() => { resolveHttp('https://user:pass@example.org/'); })).assertTrue();
      expect(rejects(() => { resolveHttp('file:///etc/passwd'); })).assertTrue();
    });
    it('stable_id_across_refresh_and_redirect', 0, () => {
      const first = makeParser().parse(rss, 'https://example.org/feed');
      const next = makeParser().parse(rss.replace('中文标题', '编辑标题'), 'https://example.org/feed', 'https://example.net/feed');
      expect(next.articles[0].id).assertEqual(first.articles[0].id);
      const html = readerHtml(first.articles[0], 18); expect(html).assertContain("default-src 'none'");
      expect(html).assertContain("form-action 'none'");
    });
    it('rdb_refresh_state_persistence_and_subscription_dedup', 0, async () => {
      const context = await testContext();
      const user = 'p2_validation_user.db'; const cache = 'p2_validation_cache.db';
      try { await relationalStore.deleteRdbStore(context, user); } catch (_) {}
      try { await relationalStore.deleteRdbStore(context, cache); } catch (_) {}
      let store = new ReaderStore(user, cache);
      await store.open(context);
      const parsed = makeParser().parse(rss, 'https://example.org/feed');
      const feed: Feed = { id: 'https://example.org/feed', title: 'test', site: '', folder: '[]', etag: '', modified: '', checked: 0, error: '' };
      try {
        const subscriptions: Subscription[] = [{ url: feed.id, title: 'test', folders: ['技术'] }];
        await store.saveSubscriptions(subscriptions); await store.saveSubscriptions(subscriptions);
        expect((await store.subscriptions()).length).assertEqual(1);
        await store.saveRefresh(feed, parsed, 'etag1', '');
        const id = parsed.articles[0].id;
        await store.setState(id, 'read', true); await store.setState(id, 'star', true);
        await store.saveRefresh(feed, parsed, 'etag2', '');
        await store.error(feed, 'synthetic network failure');
        await store.close(); store = new ReaderStore(user, cache); await store.open(context);
        let rows = await store.articles([feed.id]);
        expect(rows.length).assertEqual(1); expect(rows[0].read).assertTrue(); expect(rows[0].starred).assertTrue();
        await store.setState(id, 'read', false); rows = await store.articles([feed.id]);
        expect(rows[0].read).assertFalse(); expect(rows[0].starred).assertTrue();
        await store.removeFolder(JSON.stringify(['技术'])); expect((await store.subscriptions())[0].folder).assertEqual('[]');
        await store.removeFeed(feed.id); expect((await store.subscriptions()).length).assertEqual(0);
        await store.saveSubscriptions(subscriptions); rows = await store.articles([feed.id]); expect(rows[0].starred).assertTrue();
      } finally { await store.close(); await relationalStore.deleteRdbStore(context, user); await relationalStore.deleteRdbStore(context, cache); }
    });
  });
  describe('ReaderFiles', () => {
    it('opml_multichunk_utf8_read', 0, async () => {
      const context = await testContext();
      const path = `${context.cacheDir}/p2-validation-${Date.now()}.opml`;
      const source = opml.replace('<body>', '<body><!--' + '中英 & text '.repeat(20000) + '-->');
      const bytes = new util.TextEncoder().encodeInto(source);
      const output = await fileIo.open(path, fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
      try { expect(await fileIo.write(output.fd, bytes.buffer as ArrayBuffer)).assertEqual(bytes.length); }
      finally { await fileIo.close(output); }
      const input = await fileIo.open(path, fileIo.OpenMode.READ_ONLY);
      try {
        const actual = await readOpmlFile(input.fd);
        expect(actual).assertEqual(source);
        expect(makeParser().importOpml(actual).length).assertEqual(2);
      } finally { await fileIo.close(input); await fileIo.unlink(path); }
    });
  });
  describe('ReaderRedirect', () => {
    it('redirected_website_discovery_and_feed', 0, async () => {
      const website = await fetchFeed('https://jsonfeed.org/');
      expect(website.url).assertEqual('https://www.jsonfeed.org/');
      const candidates = discoverFeeds(website.source, website.url);
      expect(candidates.includes('https://www.jsonfeed.org/feed.json')).assertTrue();
      const result = await fetchFeed(candidates.find((candidate: string) => candidate.endsWith('/feed.json'))!);
      expect(result.url).assertEqual('https://www.jsonfeed.org/feed.json');
      expect(makeParser().parse(result.source, 'https://jsonfeed.org/feed.json', result.url).articles.length > 0).assertTrue();
    });
  });
  describe('ReaderNetwork', () => {
    for (const address of ['https://sspai.com/feed', 'https://www.ruanyifeng.com/blog/atom.xml', 'https://www.jsonfeed.org/feed.json']) {
      it(address, 0, async () => {
        const first = await fetchFeed(address);
        const parsed = makeParser().parse(first.source, address, first.url);
        expect(parsed.articles.length > 0).assertTrue();
        await abilityDelegatorRegistry.getAbilityDelegator().print(`NETWORK ${address} articles=${parsed.articles.length} validators=${!!first.etag || !!first.modified}\n`);
        if (first.etag || first.modified) {
          const next = await fetchFeed(address, first.etag, first.modified);
          await abilityDelegatorRegistry.getAbilityDelegator().print(`CONDITIONAL ${address} unchanged=${next.unchanged}\n`);
          expect(next.unchanged).assertTrue();
        }
      });
    }
  });
}
