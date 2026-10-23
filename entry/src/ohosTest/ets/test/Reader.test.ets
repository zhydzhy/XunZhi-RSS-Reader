import { describe, it, expect } from '@ohos/hypium';
import { abilityDelegatorRegistry } from '@kit.TestKit';
import { relationalStore, preferences } from '@kit.ArkData';
import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { fileIo } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { makeParser, resolveHttp, discoverFeeds, fetchFeed } from '../../../main/ets/reader/NativeFeed';
import { exportOpml, readerHtml, textOnly, articleTitle, articleId, Article, Feed, ParsedFeed, Subscription } from '../../../main/ets/reader/Feed';
import { ReaderStore } from '../../../main/ets/reader/ReaderStore';
import { ReaderProgress } from '../../../main/ets/reader/ReaderProgress';
import { ReaderPreferences, readerColorMode } from '../../../main/ets/reader/ReaderPreferences';
import { readOpmlFile } from '../../../main/ets/reader/ReaderFiles';
import { iconCandidates, prepareVideos } from '../../../main/ets/reader/ReaderMedia';
import { ReaderIcons } from '../../../main/ets/reader/ReaderIcons';
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
  describe('ReaderProgressStorage', () => {
    it('positions_and_last_article_survive_native_database_reopen', 0, async () => {
      const context = await testContext(); const name = 'validation_reading_progress.db';
      try { await relationalStore.deleteRdbStore(context, name); } catch (_) {}
      let progress = new ReaderProgress(); await progress.open(context, name);
      try {
        expect(progress.lastArticleId).assertEqual('');
        await progress.visit('article-a'); await progress.save('article-a', 1842.5);
        await progress.visit('article-b'); await progress.save('article-b', 620);
        await progress.save('article-a', 1800);
        await progress.close(); progress = new ReaderProgress(); await progress.open(context, name);
        expect(progress.lastArticleId).assertEqual('article-b');
        expect(progress.position('article-a')).assertEqual(1800);
        expect(progress.position('article-b')).assertEqual(620);
        await progress.visit('article-a'); await progress.save('article-a', 0);
        await progress.close(); progress = new ReaderProgress(); await progress.open(context, name);
        expect(progress.lastArticleId).assertEqual('article-a');
        expect(progress.position('article-a')).assertEqual(0);
        expect(progress.position('article-b')).assertEqual(620);
      } finally { await progress.close(); await relationalStore.deleteRdbStore(context, name); }
    });
  });
  describe('ReaderHtmlAttributes', () => {
    it('candidate_names_and_urls_decode_once_before_native_url_validation', 0, () => {
      const titles = new Map<string, string>();
      const candidates = discoverFeeds('<base href="/news&#47;"><link rel="alternate" type="application/rss+xml" ' +
        'title="Tom&#8217;s &quot;Tech&quot; &lt;News&gt;" href="feed?x=1&#38;y=2">' +
        '<link rel="alternate" type="application/rss+xml" title="Literal &amp;#8217;" href="once?x=1&amp;#38;y=2">' +
        '<link rel="alternate" type="application/rss+xml" href="jav&#97;script:alert(1)">',
        'https://example.org/start', resolveHttp, titles);
      expect(candidates.length).assertEqual(2);
      expect(candidates[0]).assertEqual('https://example.org/news/feed?x=1&y=2');
      expect(candidates[1]).assertEqual('https://example.org/news/once?x=1&');
      expect(titles.get(candidates[0])).assertEqual('Tom’s "Tech" <News>');
      expect(titles.get(candidates[1])).assertEqual('Literal &#8217;');
    });
    it('icon_and_video_attributes_preserve_query_parameters', 0, () => {
      const icons = iconCandidates('<base href="/assets&#47;"><link rel=icon href="logo&#46;png?x=1&#x26;y=2">' +
        '<link rel=icon href="jav&#97;script:alert(1)">', 'https://example.org/post', resolveHttp);
      expect(icons.length).assertEqual(2);
      expect(icons[0]).assertEqual('https://example.org/assets/logo.png?x=1&y=2');
      const video = prepareVideos('<video src="clip.mp4?x=1&#38;y=2" poster="cover&#46;jpg"></video>' +
        '<video src="jav&#97;script:alert(1)"></video>', 'https://example.org/post', resolveHttp);
      expect(video).assertContain('src="https://example.org/clip.mp4?x=1&amp;y=2"');
      expect(video).assertContain('poster="https://example.org/cover.jpg"');
      expect(video).assertContain('无法加载视频');
      expect(video.includes('javascript:')).assertFalse();
    });
  });
  describe('ReaderIcons', () => {
    it('site_icon_decodes_and_survives_cache_reload_without_network', 0, async () => {
      const context = await testContext();
      const name = 'validation_icons';
      const id = 'https://daringfireball.net/feeds/json';
      const declared = 'https://daringfireball.net/graphics/favicon-64.png';
      let path = '';
      try {
        const icons = new ReaderIcons(context, name);
        path = await icons.update(id, 'https://daringfireball.net/', declared);
        expect(path.length > 0).assertTrue();
        expect(fileIo.accessSync(path)).assertTrue();
        expect((await fileIo.stat(path)).size > 0).assertTrue();
        await preferences.removePreferencesFromCache(context, name);
        const restored = new ReaderIcons(context, name);
        expect(restored.cached(id)).assertEqual(path);
        expect(await restored.update(id, 'https://invalid.invalid/', declared)).assertEqual(path);
      } finally {
        if (path) await fileIo.unlink(path);
        await preferences.deletePreferences(context, name);
        if (fileIo.accessSync(`${context.filesDir}/${name}`)) await fileIo.rmdir(`${context.filesDir}/${name}`);
      }
    });
  });
  describe('ReaderNetNewsWireIcon', () => {
    it('declared_blog_icon_loads_on_device', 0, async () => {
      const context = await testContext();
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      const name = 'validation_nnw_icon';
      const id = 'https://netnewswire.blog/feed.json';
      let path = '';
      try {
        const response = await fetchFeed(id);
        const parsed = makeParser().parse(response.source, id, response.url);
        await delegator.print(`NNW icon=${parsed.icon} site=${parsed.site}\n`);
        const icons = new ReaderIcons(context, name);
        path = await icons.update(id, parsed.site, parsed.icon, true);
        await delegator.print(`NNW saved=${!!path}\n`);
        expect(path.length > 0).assertTrue();
      } finally {
        if (path) await fileIo.unlink(path);
        await preferences.deletePreferences(context, name);
        if (fileIo.accessSync(`${context.filesDir}/${name}`)) await fileIo.rmdir(`${context.filesDir}/${name}`);
      }
    });
  });
  describe('ReaderAppearance', () => {
    it('appearance_survives_preferences_cache_eviction', 0, async () => {
      const context = await testContext();
      const name = 'p3_validation_appearance';
      await preferences.deletePreferences(context, name);
      try {
        let appearance = new ReaderPreferences(context, name);
        expect(appearance.load().theme).assertEqual('system');
        expect(appearance.load().fontSize).assertEqual(18);
        await appearance.save({ theme: 'dark', fontSize: 24 });
        await preferences.removePreferencesFromCache(context, name);
        appearance = new ReaderPreferences(context, name);
        expect(appearance.load().theme).assertEqual('dark');
        expect(appearance.load().fontSize).assertEqual(24);
        await appearance.save({ theme: 'system', fontSize: 18 });
        await preferences.removePreferencesFromCache(context, name);
        expect(new ReaderPreferences(context, name).load().theme).assertEqual('system');
      } finally { await preferences.deletePreferences(context, name); }
    });
    it('invalid_saved_values_fall_back_without_changing_reader_data', 0, async () => {
      const context = await testContext();
      const name = 'p3_validation_invalid_appearance';
      const values = preferences.getPreferencesSync(context, { name });
      try {
        values.putSync('theme', 'unknown'); values.putSync('fontSize', 'large');
        const appearance = new ReaderPreferences(context, name);
        expect(appearance.load().theme).assertEqual('system');
        expect(appearance.load().fontSize).assertEqual(18);
        values.putSync('fontSize', 99);
        expect(appearance.load().fontSize).assertEqual(30);
        values.putSync('fontSize', 0);
        expect(appearance.load().fontSize).assertEqual(14);
        expect(readerColorMode('system')).assertEqual(ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET);
        expect(readerColorMode('light')).assertEqual(ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT);
        expect(readerColorMode('dark')).assertEqual(ConfigurationConstant.ColorMode.COLOR_MODE_DARK);
      } finally { await preferences.deletePreferences(context, name); }
    });
  });
  describe('ReaderP2', () => {
    it('declared_language_survives_native_xml_conversion_and_content_overrides', 0, () => {
      const source = '<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US"><title>Feed</title>' +
        '<entry><id>one</id><content>Hello</content></entry>' +
        '<entry xml:lang="zh-CN"><id>two</id><content>你好</content></entry>' +
        '<entry xml:lang="zh-CN"><id>three</id><content xml:lang="en-GB">Hello</content></entry>' +
        '<entry xml:lang=""><id>four</id><content>Unknown</content></entry></feed>';
      const rows = makeParser().parse(source, 'https://example.org/language').articles;
      expect(rows.map((row: Article) => row.language).join(',')).assertEqual('en-US,zh-CN,en-GB,');
      expect(readerHtml(rows[0], 18)).assertContain('font:18px/1.6 system-ui');
      expect(readerHtml(rows[1], 18)).assertContain('font:18px/1.8 system-ui');
    });
    it('untitled_rss_atom_keep_stable_ids_and_use_body_only_in_lists', 0, () => {
      for (const source of [
        '<rss><channel><title>RSS</title><item><description>Opening sentence.</description></item></channel></rss>',
        '<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><content>Opening sentence.</content></entry></feed>'
      ]) {
        const article = makeParser().parse(source, 'https://example.org/untitled').articles[0];
        expect(article.title).assertEqual('');
        expect(article.id).assertEqual(articleId('https://example.org/untitled', '无标题\n'));
        expect(articleTitle(article)).assertEqual('Opening sentence.');
        expect(readerHtml(article, 18).includes('<h1>')).assertFalse();
      }
    });
    it('feed_root_ignores_stylesheet_processing_instructions', 0, () => {
      const prefix = '<?xml version="1.0" encoding="UTF-8"?><?xml-stylesheet type="text/xsl" href="/feed.xsl"?>';
      const sources = [
        '<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><id>a</id><title>A</title></entry></feed>',
        '<rss version="2.0"><channel><title>RSS</title><item><guid>a</guid><title>A</title></item></channel></rss>'
      ];
      for (const source of sources) {
        const feed = makeParser().parse(prefix + source, 'https://example.org/feed');
        expect(feed.articles.length).assertEqual(1);
        expect(feed.articles[0].title).assertEqual('A');
      }
      expect(rejects(() => { makeParser().parse(prefix + '<html/>', 'https://example.org/feed'); })).assertTrue();
    });
    it('preview_decodes_typographic_entities_once', 0, () => {
      expect(textOnly('<p>We&rsquo;ve&nbsp;updated &ldquo;JSON&rdquo;&hellip;</p>')).assertEqual('We’ve updated “JSON”…');
      expect(textOnly('&amp;rsquo;')).assertEqual('&rsquo;');
      expect(textOnly('NPR&#8217;s &#x201C;Planet Money&#x201D; &#128640;')).assertEqual('NPR’s “Planet Money” 🚀');
      expect(textOnly('&amp;#8217; &#38;rsquo; &#x26;lt;')).assertEqual('&#8217; &rsquo; &lt;');
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
      const parsed = makeParser().parse(rss.replace('<channel>', '<channel><language>en-US</language>'), 'https://example.org/feed');
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
        for (const version of [1, 2]) {
          await store.close();
          const oldCache = await relationalStore.getRdbStore(context, { name: cache, securityLevel: relationalStore.SecurityLevel.S1 });
          // Recreate the actual old schema, rather than only changing its version number.
          await oldCache.executeSql('CREATE TABLE LegacyArticle (id TEXT PRIMARY KEY, feedId TEXT, title TEXT, link TEXT, content TEXT, published DOUBLE, author TEXT)');
          await oldCache.executeSql('INSERT INTO LegacyArticle SELECT id,feedId,title,link,content,published,author FROM Article');
          await oldCache.executeSql('DROP TABLE Article');
          await oldCache.executeSql('ALTER TABLE LegacyArticle RENAME TO Article');
          await oldCache.executeSql("UPDATE FeedCache SET etag = 'legacy-etag', modified = 'legacy-date'");
          oldCache.version = version;
          await oldCache.close();
          store = new ReaderStore(user, cache); await store.open(context);
          expect((await store.subscriptions())[0].etag).assertEqual('');
          const migrated = await store.articles([feed.id]);
          expect(migrated.length).assertEqual(1);
          expect(migrated[0].language).assertEqual('');
          expect(migrated[0].content).assertEqual(parsed.articles[0].content);
          expect(migrated[0].read).assertTrue(); expect(migrated[0].starred).assertTrue();
          await store.saveRefresh(feed, parsed, 'language-etag', '');
          await store.close(); store = new ReaderStore(user, cache); await store.open(context);
          expect((await store.articles([feed.id]))[0].language).assertEqual('en-US');
          expect((await store.subscriptions())[0].etag).assertEqual('language-etag');
        }
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
  describe('ReaderLargeLibrary', () => {
    it('ten_thousand_persisted_articles_keep_order_states_and_scope_after_reopen_and_refresh', 0, async () => {
      const context = await testContext();
      const delegator = abilityDelegatorRegistry.getAbilityDelegator();
      const user = 'large_validation_user.db'; const cache = 'large_validation_cache.db';
      try { await relationalStore.deleteRdbStore(context, user); } catch (_) {}
      try { await relationalStore.deleteRdbStore(context, cache); } catch (_) {}
      let store = new ReaderStore(user, cache); await store.open(context);
      let timer = -1;
      try {
        const subscriptions: Subscription[] = [];
        const feeds: Feed[] = [];
        const readIds: string[] = [];
        let first: ParsedFeed = { title: '', site: '', articles: [] };
        const started = Date.now();
        for (let f = 0; f < 100; f++) {
          const feed: Feed = { id: `https://large-rdb.invalid/${f}`, title: `订阅 ${f}`, site: '', folder: '[]',
            etag: '', modified: '', checked: 0, error: '' };
          feeds.push(feed); subscriptions.push({ url: feed.id, title: feed.title, folders: [] });
          const articles: Article[] = [];
          for (let i = 0; i < 100; i++) {
            const n = f * 100 + i; const id = `rdb-${n.toString().padStart(5, '0')}`;
            articles.push({ id, feedId: feed.id, title: `数据库文章 ${n}`, link: '',
              content: `<p>正文关键词 needle-${n}，包含中文、English 与实体 &amp;，用于实际数据库读写验证。</p>`.repeat(8),
              published: 1000000 - n, author: '作者', read: false, starred: false });
            if (n % 3 === 0) readIds.push(id);
          }
          const parsed: ParsedFeed = { title: feed.title, site: '', articles };
          if (f === 0) first = parsed;
          await store.saveRefresh(feed, parsed, `etag-${f}`, '');
        }
        await store.saveSubscriptions(subscriptions);
        const unread = await store.articles([feeds[0].id]);
        expect(unread.length).assertEqual(100);
        expect(unread.some((row: Article) => row.read || row.starred)).assertFalse();
        expect((await store.articles(['https://large-rdb.invalid/missing'])).length).assertEqual(0);
        await store.setReadStates(readIds, true);
        await store.setState('rdb-00000', 'star', true);
        await delegator.print(`LARGE_RDB writeMs=${Date.now() - started}\n`);
        await store.close(); store = new ReaderStore(user, cache);
        const opened = Date.now(); await store.open(context);
        const restored = await store.subscriptions();
        expect(restored.length).assertEqual(100);
        let beats = 0; let longest = 0; let previous = Date.now();
        timer = setInterval(() => {
          const now = Date.now(); longest = Math.max(longest, now - previous); previous = now; beats++;
        }, 16);
        const queried = Date.now();
        const rows = await store.articles(restored.map((feed: Feed) => feed.id));
        const queryMs = Date.now() - queried;
        await new Promise<void>(resolve => { setTimeout(resolve, 20); });
        clearInterval(timer); timer = -1;
        await delegator.print(`LARGE_RDB reopenMs=${queried - opened} readMs=${queryMs} timerCallbacks=${beats} maxTimerGapMs=${longest}\n`);
        expect(rows.length).assertEqual(10000);
        expect(new Set(rows.map((row: Article) => row.id)).size).assertEqual(10000);
        expect(rows[0].id).assertEqual('rdb-00000');
        expect(rows[9999].id).assertEqual('rdb-09999');
        expect(rows[9999].content).assertContain('needle-9999');
        expect(rows.filter((row: Article) => row.read).length).assertEqual(readIds.length);
        expect(rows[0].starred).assertTrue();
        expect((await store.articles([feeds[99].id])).length).assertEqual(100);
        expect((await store.articles([])).length).assertEqual(0);
        first.articles[0].title = '更新后的标题';
        await store.saveRefresh(feeds[0], first, 'updated', '');
        const refreshed = await store.articles([feeds[0].id]);
        expect(refreshed.length).assertEqual(100);
        expect(refreshed[0].title).assertEqual('更新后的标题');
        expect(refreshed[0].read).assertTrue();
        expect(refreshed[0].starred).assertTrue();
      } finally {
        if (timer >= 0) clearInterval(timer);
        await store.close();
        await relationalStore.deleteRdbStore(context, user);
        await relationalStore.deleteRdbStore(context, cache);
      }
    });
  });
  describe('ReaderBulkRead', () => {
    it('bulk_snapshot_survives_restart_and_undo_preserves_new_articles_and_stars', 0, async () => {
      const context = await testContext();
      const user = 'review_validation_user.db'; const cache = 'review_validation_cache.db';
      try { await relationalStore.deleteRdbStore(context, user); } catch (_) {}
      try { await relationalStore.deleteRdbStore(context, cache); } catch (_) {}
      let store = new ReaderStore(user, cache); await store.open(context);
      const feed: Feed = { id: 'https://example.org/review', title: 'Review', site: '', folder: '[]', etag: '', modified: '', checked: 0, error: '' };
      const parsed = makeParser().parse(rss, feed.id);
      const id = parsed.articles[0].id;
      try {
        await store.saveRefresh(feed, parsed, '', '');
        await store.setState(id, 'star', true);
        await store.setReadStates([id], true);
        const newer = makeParser().parse(rss, feed.id);
        newer.articles[0].id = `${id}-new`;
        await store.saveRefresh(feed, newer, '', '');
        await store.close(); store = new ReaderStore(user, cache); await store.open(context);
        let rows = await store.articles([feed.id]);
        expect(rows.find((row) => row.id === id)?.read).assertTrue();
        expect(rows.find((row) => row.id === `${id}-new`)?.read).assertFalse();
        await store.setReadStates([id], false);
        rows = await store.articles([feed.id]);
        expect(rows.find((row) => row.id === id)?.read).assertFalse();
        expect(rows.find((row) => row.id === id)?.starred).assertTrue();
        expect(rows.find((row) => row.id === `${id}-new`)?.read).assertFalse();
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
  describe('ReaderImportedSources', () => {
    for (const address of ['https://jvns.ca/atom.xml', 'https://feeds.kottke.org/main', 'https://feedpress.me/sixcolors?type=xml']) {
      it(address, 0, async () => {
        const delegator = abilityDelegatorRegistry.getAbilityDelegator();
        let stage = 'fetch';
        try {
          const response = await fetchFeed(address);
          stage = 'parse';
          await delegator.print(`IMPORTED FETCH ${address} length=${response.source.length}\n`);
          const parsed = makeParser().parse(response.source, address, response.url);
          expect(parsed.articles.length > 0).assertTrue();
          await delegator.print(`IMPORTED PASS ${address} articles=${parsed.articles.length}\n`);
        } catch (error) {
          await delegator.print(`IMPORTED FAIL ${address} stage=${stage} error=${JSON.stringify(error)}\n`);
          throw error as Error;
        }
      });
    }
  });
}
