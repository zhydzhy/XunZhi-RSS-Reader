import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { prepareVideos } from '../entry/src/main/ets/reader/ReaderMedia.ts';
import { FeedParser, articleDate, articleTitle, feedError, textOnly, decodeHtmlEntities, readerHtml, hasReaderBody, READER_FONT, READER_HEADING_FONT } from '../entry/src/main/ets/reader/Feed.ts';

// Exercise the page's actual handlers without ArkUI. Platform rendering is checked on device.
const source = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const dataSource = readFileSync(new URL('../entry/src/main/ets/reader/ReaderArticleSource.ets', import.meta.url), 'utf8');
const ReaderArticleSource = runInNewContext(stripTypeScriptTypes(dataSource.slice(dataSource.indexOf('export class')).replace('export class', 'class')) + '\nReaderArticleSource');
const handlers = source.slice(source.indexOf('struct Index'), source.indexOf('  @Builder'))
  .replace('struct Index', 'class Index').replaceAll('@State ', '').replace(/@(Watch|StorageProp)\('[^']+'\) /g, '');
const frame = source.slice(source.indexOf('class ReaderFrame'), source.indexOf('@Entry'));
const leaving = source.match(/\.onWillDisappear\(\(\) => \{([^}]+)\}\)/)?.[1] || '';
const nativeFeed = readFileSync(new URL('../entry/src/main/ets/reader/NativeFeed.ets', import.meta.url), 'utf8');
const discoverFeeds = runInNewContext(stripTypeScriptTypes(nativeFeed.slice(nativeFeed.indexOf('export function discoverFeeds'))
  .replace('export function', 'function')) + '\ndiscoverFeeds', { decodeHtmlEntities });
let decodedBodies = 0;
const feedRequests = new Map();
const activityTimers = new Map();
let activityTimerId = 0;
const foldListeners = new Map();
const motionListeners = new Set();
let foldable = false; let foldStatus = 2; let reducedMotion = false;
const display = {
  FoldStatus: { FOLD_STATUS_FOLDED: 2, FOLD_STATUS_HALF_FOLDED: 3, FOLD_STATUS_EXPANDED: 1 },
  isFoldable: () => foldable, getFoldStatus: () => foldStatus,
  on: (name, callback) => foldListeners.set(name, callback),
  off: (name, callback) => { assert.equal(foldListeners.get(name), callback); foldListeners.delete(name); },
};
const accessibility = {
  isAnimationReduceEnabledSync: () => reducedMotion,
  onAnimationReduceStateChange: callback => motionListeners.add(callback),
  offAnimationReduceStateChange: callback => { assert.equal(motionListeners.delete(callback), true); },
};
const Index = runInNewContext(stripTypeScriptTypes(frame + handlers + '\n}') + '\nIndex', {
  $r: name => name, display, accessibility, READER_FONT, READER_HEADING_FONT,
  registerReaderFonts: () => {}, TextModifier: class { fontFamily() { return this; } },
  util: { TextEncoder: class { encodeInto(value) { return new TextEncoder().encode(value); } }, Base64Helper: class { encodeToStringSync(value) { return Buffer.from(value).toString('base64'); } } },
  ReaderArticleSource, textOnly: value => { decodedBodies++; return textOnly(value); }, feedError, articleDate, articleTitle, readerHtml, hasReaderBody, prepareVideos, discoverFeeds, Date, FrameCallback: class {},
  setInterval: (callback, interval) => {
    const id = activityTimerId++; activityTimers.set(id, { callback, interval }); return id;
  },
  clearInterval: id => activityTimers.delete(id),
  LengthMetrics: { vp: value => ({ value }) }, ScrollAlign: { START: 0 },
  resolveHttp: (value, base) => new URL(value, base || undefined).href,
  fetchFeed: (address, _etag, _modified, registerCancel) => feedRequests.get(address)(registerCancel),
  makeParser: () => new FeedParser((value, base) => new URL(value, base).href, () => { throw new Error('XML is outside this fixture'); }),
  window: { getLastWindow: async context => context.testWindow, AvoidAreaType: { TYPE_NAVIGATION_INDICATOR: 0 } },
  readerColorMode: theme => theme,
  setTimeout, clearTimeout,
  TouchType: { Down: 0, Up: 1, Move: 2, Cancel: 3 },
  LaunchMode: { POP_TO_SINGLETON: 2 },
  SymbolGlyphModifier: class { constructor(resource) { this.resource = resource; } fontColor() { return this; } },
  NavPathStack: class {
    entries = [];
    pushPath(info, options) {
      const index = this.entries.findIndex(entry => entry.name === info.name);
      if (options?.launchMode === 2 && index >= 0) this.entries.splice(index + 1);
      else this.entries.push(info);
    }
    size() { return this.entries.length; }
    clear() { this.entries = []; }
    moveIndexToTop(index) { this.entries.push(...this.entries.splice(index, 1)); }
    removeByName(name) {
      const count = this.entries.length;
      this.entries = this.entries.filter(entry => entry.name !== name);
      return count - this.entries.length;
    }
    getAllPathName() { return this.entries.map(entry => entry.name); }
    pop(result) {
      const info = this.entries.pop();
      // SDK contract: a result-less native back does not call NavPathInfo.onPop.
      if (result !== undefined) info?.onPop?.({ info, result });
    }
  },
  Scroller: class { scrollTo() {} },
  ReaderFooter: class { update(params) { this.params = params; } clear() { this.params = undefined; } setSurface(surface, params) { this.surface = surface; this.params = params; } },
  NativeEmbedStatus: { CREATE: 0, UPDATE: 1, DESTROY: 2 },
  ReaderStore: class {},
  webview: { WebviewController: class {} },
});

Index.prototype.showReaderAlert = function(options) { this.getUIContext().showAlertDialog(options); };

const first = { id: 'a', feedId: 'feed', title: 'A', link: '', published: 0, author: '', content: '<p>A</p>', read: false, starred: false };
const second = { ...first, id: 'b', title: 'B' };

function setup(write = async () => {}) {
  const page = new Index();
  page.web.loadData = () => {};
  const saved = [{ ...first }, { ...second }];
  page.feeds = [{ id: 'feed' }];
  page.articles = saved.map(a => ({ ...a }));
  page.store = {
    subscriptions: async () => [{ id: 'feed' }],
    folders: async () => [],
    articles: async () => saved.map(a => ({ ...a })),
    setState: async (id, kind, value) => {
      await write();
      saved.find(a => a.id === id)[kind === 'star' ? 'starred' : 'read'] = value;
    },
  };
  return page;
}

test('wide list selects another article in the same reader route and uses saved row states', async () => {
  const page = setup();
  let loads = 0; page.loadReader = () => { loads++; };
  page.chooseScope('feed'); page.openArticle(first);
  await page.markRead(); await page.toggle('star');
  page.openArticle(second);
  assert.equal(page.article.id, 'b');
  assert.equal(loads, 1);
  assert.deepEqual(Array.from(page.paths.getAllPathName()), ['articles']);
  assert.deepEqual(Array.from(page.readerPaths.getAllPathName()), ['article']);
  assert.equal(page.articleState(first).read, true);
  assert.equal(page.articleState(first).starred, true);
  page.openArticle(first);
  assert.equal(page.article.read, true); assert.equal(page.article.starred, true);
  assert.equal(page.nextUnread().id, 'b');
  page.openArticle(first); assert.equal(loads, 2, 'reselecting the same row must not reload');
});

test('hiding read articles while reading follows saved states and keeps the open article', async () => {
  const page = setup();
  page.loadReader = () => {};
  await page.store.setState('a', 'read', true); await page.reload();
  page.chooseScope('feed'); page.showRead = true;
  page.openArticle(page.articles[0]);
  await page.toggle('read');
  page.showRead = false;
  assert.deepEqual(page.visible().map(item => item.id), ['a', 'b'], 'an article marked unread returns with the filter');
  page.openArticle(page.articles[1]); await page.markRead();
  page.showRead = true; page.visible(); page.showRead = false;
  assert.deepEqual(page.visible().map(item => item.id), ['a', 'b'], 'the open article stays even though it is read');
  assert.equal(page.visible().filter(item => !page.articleState(item).read).length, page.unread('feed'));
  page.openArticle(page.articles[0]);
  page.showRead = true; page.visible(); page.showRead = false;
  assert.deepEqual(page.visible().map(item => item.id), ['a']);
});

test('changing library scope retires the old reader before a late disappearance callback', async () => {
  const page = setup(); page.chooseScope('feed'); page.openArticle(first);
  page.chooseScope('', '', '星标'); await idle(page);
  assert.equal(page.article, undefined);
  assert.equal(page.readerPaths.size(), 0);
  page.openArticle(second);
  page.readerDidDisappear();
  assert.equal(page.article.id, 'b', 'old destination cleanup cannot clear the new selection');
});

test('settings and the library drawer return before the active reader is dismissed', async () => {
  const page = setup(); page.chooseScope('feed'); page.openArticle(first);
  page.paths.pushPath({ name: 'settings' });
  assert.equal(page.onBackPress(), true);
  assert.equal(page.article.id, 'a'); assert.equal(page.readerPaths.size(), 1);
  page.libraryDrawer = true;
  assert.equal(page.onBackPress(), true);
  assert.equal(page.libraryDrawer, false); assert.equal(page.readerPaths.size(), 1);
  assert.equal(page.onBackPress(), true);
  assert.equal(page.readerPaths.size(), 0);
  page.readerDidDisappear(); await idle(page);
  assert.equal(page.article, undefined); assert.equal(page.paths.size(), 1);
  assert.equal(page.onBackPress(), true); assert.equal(page.paths.size(), 0);
});

test('a wide window opens the reading columns instead of stretching the phone home', () => {
  const page = setup(); const names = () => Array.from(page.paths.getAllPathName());
  page.resizeWindow(460); assert.deepEqual(names(), []);
  page.resizeWindow(672); assert.deepEqual(names(), ['articles']);
  page.resizeWindow(460); assert.deepEqual(names(), [], 'an untouched wide list returns to the home');
  page.resizeWindow(809); page.chooseScope('feed'); page.resizeWindow(366);
  assert.deepEqual(names(), ['articles'], 'a chosen scope survives narrowing');
  page.onBackPress(); page.resizeWindow(809); page.openArticle(first); page.resizeWindow(366);
  assert.deepEqual(names(), ['articles'], 'an opened article survives narrowing');
});

test('Back from the wide reading columns backgrounds the app like Back on the home page', async () => {
  const page = setup(); let backgrounded = 0;
  page.context = () => ({ moveAbilityToBackground: async () => { backgrounded++; } });
  page.resizeWindow(809); page.libraryDrawer = true;
  assert.equal(page.onBackPress(), true); assert.equal(page.libraryDrawer, false);
  page.openArticle(first);
  assert.equal(page.onBackPress(), true); assert.equal(page.readerPaths.size(), 0);
  page.readerDidDisappear(); await idle(page);
  assert.equal(page.onBackPress(), true);
  assert.equal(backgrounded, 1);
  assert.deepEqual(Array.from(page.paths.getAllPathName()), ['articles'], 'no stretched home behind the columns');
  page.resizeWindow(366);
  assert.equal(page.onBackPress(), true); assert.equal(page.paths.size(), 0);
  assert.equal(page.onBackPress(), false, 'the narrow home leaves Back to the system');
  assert.equal(backgrounded, 1);
});

test('settings opened on the narrow home stays in front when the window widens', () => {
  const page = setup(); const names = () => Array.from(page.paths.getAllPathName());
  page.resizeWindow(460); page.paths.pushPath({ name: 'settings' });
  page.resizeWindow(809); assert.deepEqual(names(), ['articles', 'settings']);
  assert.equal(page.onBackPress(), true); assert.deepEqual(names(), ['articles']);
  page.paths.pushPath({ name: 'settings' }); page.resizeWindow(460);
  assert.deepEqual(names(), ['settings'], 'the untouched list leaves from under settings');
});

test('a visible-list bulk update also refreshes the reader actions and next-unread queue', async () => {
  const page = setup(); page.chooseScope('feed'); page.openArticle(first);
  await page.store.setState('a', 'read', true);
  await page.store.setState('b', 'read', true);
  await page.reload();
  assert.equal(page.article.read, true);
  assert.equal(page.nextUnread(), undefined);
  await page.store.setState('b', 'read', false);
  await page.reload();
  assert.equal(page.nextUnread().id, 'b');
});

test('live footer follows bulk read and undo without reloading the document', async () => {
  const page = setup(); page.chooseScope('feed'); page.openArticle(first);
  let loads = 0; page.loadReader = () => { loads++; };
  page.syncReaderFooter(); assert.equal(page.readerFooter.params.title, 'B');
  await page.store.setState('b', 'read', true); await page.reload(); page.syncReaderFooter();
  assert.equal(page.readerFooter.params.title, '');
  await page.store.setState('b', 'read', false); await page.reload(); page.syncReaderFooter();
  assert.equal(page.readerFooter.params.title, 'B'); assert.equal(loads, 0);
  page.readerFooter.params.next(); assert.equal(page.article.id, 'b'); assert.equal(loads, 1);
});

test('footer updates size and busy state', () => {
  const page = setup(); page.chooseScope('feed'); page.openArticle(first);
  page.fontSize = 30; page.busy = true; page.syncReaderFooter();
  assert.equal(page.readerFooter.params.fontSize, 30); assert.equal(page.readerFooter.params.enabled, false);
  page.busy = false; page.syncReaderFooter(); assert.equal(page.readerFooter.params.enabled, true);
});

test('footer ignores stale surfaces and releases the current surface when it is destroyed', () => {
  const page = setup();
  page.getUIContext = () => ({ px2vp: value => value / 2 });
  const event = (id, status, x = 10) => ({ embedId: id, surfaceId: 'surface-' + id, status,
    info: { id: 'xunzhi-reader-footer', type: 'native/xunzhi-footer', width: 600, height: 160, position: { x, y: 100 } } });
  page.updateReaderFooter(event('old', 0));
  page.updateReaderFooter(event('new', 0));
  page.updateReaderFooter(event('old', 1, 900));
  page.updateReaderFooter(event('old', 2));
  assert.equal(page.footerEmbedId, 'new'); assert.equal(page.footerX, 5);
  assert.equal(page.readerFooter.params.width, 300); assert.equal(page.readerFooter.params.height, 80);
  const moved = event('new', 1, 30); delete moved.surfaceId;
  moved.info.width = 400; page.updateReaderFooter(moved);
  assert.equal(page.footerX, 15); assert.equal(page.readerFooter.params.width, 200);
  const visibilityBody = source.match(/\.onNativeEmbedVisibilityChange\(\(event\) => \{([\s\S]*?)\n            \}\)/)[1];
  const visibility = new Function('event', visibilityBody).bind(page);
  visibility({ embedId: 'old', visibility: true }); assert.equal(page.footerVisible, false);
  visibility({ embedId: 'new', visibility: true }); assert.equal(page.footerVisible, true);
  visibility({ embedId: 'new', visibility: false }); assert.equal(page.footerVisible, false);
  visibility({ embedId: 'new', visibility: true });
  page.updateReaderFooter(event('new', 2));
  assert.equal(page.footerVisible, false);
  assert.equal(page.footerEmbedId, ''); assert.equal(page.readerFooter.params, undefined);
});

test('bulk-read availability follows saved row states before the source list is reloaded', async () => {
  const page = setup(); page.loadReader = () => {};
  page.chooseScope('feed'); page.openArticle(first); await page.markRead();
  page.openArticle(second); await page.markRead();
  assert.equal(page.readingMenus().find(item => item.value === '全部标为已读').isEnabled, false);
  let confirms = 0;
  page.getUIContext = () => ({ showAlertDialog: () => { confirms++; } });
  page.confirmMarkAllRead(); assert.equal(confirms, 0);
  await page.toggle('read');
  assert.equal(page.readingMenus().find(item => item.value === '全部标为已读').isEnabled, true);
});

test('visible split-list refresh restores its anchor while a covered single list waits for return', () => {
  const { page, scrolls, render } = positionedList();
  page.setListSplit(true); render(); scrolls.length = 0;
  page.openArticle(page.articles[3]);
  page.articles = [{ ...first, id: 'new' }, ...page.articles]; page.syncList(); render();
  assert.equal(page.listData.getData(scrolls.at(-1)[0]).id, 'row-3');
  scrolls.length = 0;
  page.setListSplit(false);
  page.articles = [{ ...first, id: 'newer' }, ...page.articles]; page.syncList(); render();
  assert.equal(scrolls.length, 0);
  page.setListSplit(true); render();
  assert.equal(scrolls.length, 1);
});
function nativeBack(page) {
  page.readerPaths.pop();
  new Function(leaving).call(page);
}
async function idle(page) {
  for (let i = 0; page.busy && i < 50; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.busy, false);
}

test('read, star and next-unread transitions preserve declared article languages', async () => {
  const page = setup();
  page.articles[0].language = 'en-US';
  page.articles[1].language = 'zh-CN';
  page.loadReader = () => {};
  page.chooseScope('feed'); page.openArticle(page.articles[0]);
  assert.equal(page.readingQueue[0].language, 'en-US');
  await page.markRead();
  assert.equal(page.article.language, 'en-US');
  await page.toggle('star');
  assert.equal(page.article.language, 'en-US');
  page.openNextUnread();
  assert.equal(page.article.id, 'b');
  assert.equal(page.article.language, 'zh-CN');
});

test('native back refreshes unread immediately and allows opening another article', async () => {
  const page = setup();
  page.chooseScope('feed');
  page.openArticle(first);
  await page.run(() => page.markRead());
  nativeBack(page);
  await idle(page);
  assert.equal(page.article, undefined);
  assert.equal(page.visible().some(a => a.id === first.id), false);
  page.showRead = true;
  assert.equal(page.visible().find(a => a.id === first.id).read, true);
  page.openArticle(second);
  assert.equal(page.article.id, second.id);
  assert.equal(page.readerPaths.size(), 1);
});

test('return during an outstanding read write reloads after it completes', async () => {
  let finish;
  const page = setup(() => new Promise(resolve => { finish = resolve; }));
  page.openArticle(first);
  const saving = page.run(() => page.markRead());
  nativeBack(page);
  assert.equal(page.article, undefined);
  finish();
  await saving;
  assert.equal(page.visible().some(a => a.id === first.id), false);
  page.openArticle(second);
  assert.equal(page.article.id, second.id);
});

test('manual unread survives return and does not prevent the next article opening', async () => {
  const page = setup();
  page.openArticle(first);
  await page.run(() => page.markRead());
  await page.run(() => page.toggle('read'));
  await page.run(() => page.markRead());
  nativeBack(page);
  await idle(page);
  assert.equal(page.visible().find(a => a.id === first.id).read, false);
  page.openArticle(second);
  assert.equal(page.article.id, second.id);
});


test('subscription selection opens an article list above the subscription home', () => {
  const page = setup();
  page.query = 'old search';
  page.chooseScope('feed', '', '全部');
  assert.deepEqual(Array.from(page.paths.getAllPathName()), ['articles']);
  assert.equal(page.selectedFeed, 'feed');
  assert.equal(page.filter, '全部');
  assert.equal(page.query, '');
  page.paths.pop();
  page.chooseScope('', '', '星标');
  assert.equal(page.selectedFeed, '');
  assert.equal(page.filter, '星标');
  assert.equal(page.paths.size(), 1);
});

test('visible sidebar switches scopes without stacking duplicate lists or retaining the old reader', async () => {
  const page = setup();
  page.chooseScope('feed');
  page.openArticle(first);
  page.chooseScope('', '', '星标');
  assert.deepEqual(Array.from(page.paths.getAllPathName()), ['articles']);
  // Native removal of the old reader runs its existing lifecycle cleanup.
  new Function(leaving).call(page);
  await idle(page);
  assert.equal(page.article, undefined);
  assert.equal(page.filter, '星标');
  page.chooseScope('feed');
  page.chooseScope('feed');
  assert.deepEqual(Array.from(page.paths.getAllPathName()), ['articles']);
  page.openArticle(second);
  assert.equal(page.article.id, second.id);
  assert.deepEqual(Array.from(page.paths.getAllPathName()), ['articles']);
  assert.deepEqual(Array.from(page.readerPaths.getAllPathName()), ['article']);
});

test('appearance changes update the current reader without reloading its document', async () => {
  const page = setup();
  page.article = { ...first, read: true };
  page.loaded = true;
  const modes = [];
  const saved = [];
  let reloads = 0;
  page.context = () => ({ getApplicationContext: () => ({ setColorMode: mode => modes.push(mode) }) });
  page.appearance = { save: async value => saved.push(value) };
  page.web.getScrollOffset = () => ({ x: 0, y: 500 });
  page.loadReader = () => { reloads++; };
  for (const [theme, size] of [['dark', 18], ['light', 18], ['light', 24], ['system', 24]]) {
    await page.saveAppearance(theme, size);
    assert.equal(page.theme, theme);
    assert.equal(page.fontSize, size);
  }
  assert.equal(reloads, 0, 'appearance must not reset scrolling or reload media');
  assert.equal(page.article.id, first.id);
  assert.equal(page.loaded, true);
  assert.equal(saved.length, 4);
  assert.deepEqual(modes, ['dark', 'light', 'light', 'system']);
});

test('reload-video preserves native positive page offsets through the actual page-end handler', async () => {
  const page = setup();
  page.article = { ...first, content: '<video controls></video><p>Text</p>', read: true };
  page.loaded = true;
  const endBody = source.match(/\.onPageEnd\(\((?:event)?\) => \{([\s\S]*?)\n {12}\}\)/)?.[1];
  assert.ok(endBody, 'exercise the production page-end callback');
  const pageEnd = new Function('event', endBody);
  page.web.loadData = () => {}; page.loadReader();
  for (const offset of [381.5, 0]) {
    let y = offset;
    page.web.getScrollOffset = () => ({ x: 0, y });
    page.web.scrollTo = (_x, restored) => { y = restored; };
    page.loadReader = () => { y = 0; };
    page.readerMenus().find(item => item.value === '重新加载视频').action();
    pageEnd.call(page, { url: page.readerDocumentUrl }); await idle(page);
    assert.equal(y, offset, 'a reload must restore the scroll coordinate, not negate it');
    assert.equal(page.restoreScrollY, 0, 'consume the saved position once');
  }
});

test('native media fullscreen saves a positive scroll coordinate for the Back fallback', async () => {
  const page = setup();
  page.web.getScrollOffset = () => ({ x: 0, y: 527.25 });
  page.setMediaFullScreen = async active => { page.mediaFullScreen = active; };
  const enterBody = source.match(/\.onFullScreenEnter\(\(event\) => \{([^\n]+)\}\)/)?.[1];
  assert.ok(enterBody, 'exercise the production native fullscreen callback');
  const handler = { exitFullScreen() {} };
  new Function('event', enterBody).call(page, { handler });
  assert.equal(page.mediaScrollY, 527.25);
  assert.equal(page.mediaExit, handler);
  assert.equal(page.mediaFullScreen, true);
});

test('failed appearance persistence restores the app theme and keeps the displayed preferences', async () => {
  const page = setup();
  const modes = [];
  page.theme = 'dark'; page.fontSize = 20; page.showSheet = true;
  page.context = () => ({ getApplicationContext: () => ({ setColorMode: mode => modes.push(mode) }) });
  page.appearance = { save: async () => { throw new Error('disk full'); } };
  await page.saveAppearance('light', 24);
  assert.deepEqual(modes, ['light', 'dark']);
  assert.equal(page.theme, 'dark');
  assert.equal(page.fontSize, 20);
  assert.equal(page.savingAppearance, false);
  assert.equal(page.sheetMessage, '设置未能保存，请重试');
});


test('system back exits embedded media fullscreen before leaving the article', () => {
  const page = setup();
  page.chooseScope('feed');
  page.openArticle(first);
  page.mediaFullScreen = true;
  let exits = 0;
  page.mediaExit = { exitFullScreen() { exits++; } };
  page.getUIContext = () => ({ runScopedTask: action => action() });
  assert.equal(page.onBackPress(), true);
  assert.equal(exits, 1);
  assert.equal(page.readerPaths.size(), 1);
  page.mediaFullScreen = false;
  assert.equal(page.onBackPress(), true);
  assert.equal(page.readerPaths.size(), 0);
});

test('ignored platform fullscreen exit falls back to the same article without opening another page', async () => {
  const page = setup();
  page.chooseScope('feed'); page.openArticle(first);
  page.mediaFullScreen = true; page.mediaScrollY = 360;
  page.mediaExit = { exitFullScreen() {} };
  page.getUIContext = () => ({ runScopedTask: action => action() });
  let reloads = 0;
  page.loadReader = () => { reloads++; };
  page.setMediaFullScreen = async active => { page.mediaFullScreen = active; };
  assert.equal(page.onBackPress(), true);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(reloads, 1);
  assert.equal(page.restoreScrollY, 360);
  assert.equal(page.mediaFullScreen, false);
  assert.equal(page.readerPaths.size(), 1);
  assert.equal(page.article.id, first.id);
});

test('reading gestures hide and reveal the header without reacting to taps, horizontal pans or fullscreen video', () => {
  const page = setup();
  page.openArticle(first);
  const touch = (type, x, y) => page.onReaderTouch({ type, touches: [{ displayX: x, displayY: y }] });
  assert.equal(page.readerChromeVisible, true);
  touch(0, 100, 300); touch(2, 100, 290);
  assert.equal(page.readerChromeVisible, true);
  touch(0, 100, 300); touch(2, 200, 270);
  assert.equal(page.readerChromeVisible, true);
  touch(0, 100, 300); touch(2, 100, 240);
  assert.equal(page.readerChromeVisible, false);
  touch(0, 100, 240); touch(2, 100, 300);
  assert.equal(page.readerChromeVisible, true);
  page.mediaFullScreen = true;
  touch(0, 100, 300); touch(2, 100, 200);
  assert.equal(page.readerChromeVisible, true);
  page.mediaFullScreen = false;
  page.readerChromeVisible = false;
  page.closeArticle();
  page.busy = false;
  page.openArticle(second);
  assert.equal(page.readerChromeVisible, true);
});

test('reader chrome matches the article background and keeps native overlay animation', () => {
  const options = source.match(/\.title\('', (\{[\s\S]*?\})\)\s*\n\s*\.backgroundColor/)?.[1];
  const title = runInNewContext(`(${options})`, {
    $r: name => name, display, accessibility, READER_FONT, READER_HEADING_FONT,
  registerReaderFonts: () => {}, TextModifier: class { fontFamily() { return this; } },
  util: { TextEncoder: class { encodeInto(value) { return new TextEncoder().encode(value); } }, Base64Helper: class { encodeToStringSync(value) { return Buffer.from(value).toString('base64'); } } }, Color: { Transparent: 'transparent' },
    BarStyle: { STACK: 'overlay' }, BlurStyle: { COMPONENT_THICK: 'material' },
  });
  assert.equal(title.barStyle, 'overlay', 'hiding the bar must not resize the Web viewport');
  assert.equal(title.backgroundColor, 'transparent');
  assert.equal(title.backgroundEffect.radius, 24);
  assert.equal(title.backgroundEffect.saturation, 0, 'article images must not tint the chrome');
  assert.equal(title.backgroundEffect.brightness, 1);
  assert.equal(title.backgroundEffect.color, 'app.color.reader_chrome_mask');
  for (const theme of ['base', 'dark']) {
    const palette = JSON.parse(readFileSync(new URL(`../entry/src/main/resources/${theme}/element/color.json`, import.meta.url))).color;
    const background = palette.find(item => item.name === 'reader_background').value;
    const mask = palette.find(item => item.name === 'reader_chrome_mask').value;
    assert.equal(mask, '#CC' + background.slice(1), 'mask must match the reading surface at 80% opacity');
  }
  assert.equal(title.backgroundBlurStyle, undefined, 'material tint must not create a different color strip');
  const args = source.match(/\.hideTitleBar\((this\.mediaFullScreen[^)]+)\)/)?.[1];
  const evaluate = new Function(`return [${args}];`);
  assert.deepEqual(evaluate.call({ mediaFullScreen: false, readerChromeVisible: false }), [true, true]);
  assert.deepEqual(evaluate.call({ mediaFullScreen: false, readerChromeVisible: true }), [false, true]);
  assert.deepEqual(evaluate.call({ mediaFullScreen: true, readerChromeVisible: true }), [true, false]);
});

test('reader overflow preserves read and star actions and disables missing original links', async () => {
  const page = setup();
  page.openArticle(first);
  let menu = page.readerMenus();
  assert.equal(menu.find(item => item.value === '在浏览器中打开').isEnabled, false);
  menu.find(item => item.value === '标已读').action();
  await idle(page);
  assert.equal(page.article.read, true);
  menu = page.readerMenus();
  menu.find(item => item.value === '星标').action();
  await idle(page);
  assert.equal(page.article.starred, true);
  page.busy = true;
  assert.equal(page.readerMenus().find(item => item.value === '标未读').isEnabled, false);
});

test('smart collection title and unread counts stay scoped; a feed never inherits stars', () => {
  const page = setup();
  page.articles[0].starred = true;
  page.articles[1].read = true; page.articles[1].starred = true;
  page.chooseScope('', '', '星标');
  assert.equal(page.scopeTitle(), '星标');
  assert.equal(page.collectionCount('星标'), 1);
  assert.equal(page.showRead, true, 'starred collection must include saved read articles on entry');
  assert.equal(page.visible().length, 2);
  page.showRead = false;
  assert.equal(page.visible().length, 1);
  page.chooseScope('feed');
  assert.equal(page.filter, '未读');
  assert.equal(page.showRead, false);
  assert.equal(page.visible().length, 1);
});

test('next unread follows the opening snapshot, skips read entries, and does not push destinations', async () => {
  const page = setup();
  page.loadReader = () => {};
  page.chooseScope('feed'); page.openArticle(first);
  await page.markRead();
  page.articles.unshift({ ...first, id: 'new' });
  assert.equal(page.nextUnread().id, 'b');
  page.openNextUnread();
  assert.equal(page.article.id, 'b');
  assert.equal(page.readerPaths.size(), 1);
  await page.markRead();
  assert.equal(page.nextUnread(), undefined);
});

test('reader footer and toolbar agree through manual unread, wraparound and the last unread article', async () => {
  const page = setup();
  page.articles = ['a', 'b', 'c'].map(id => ({ ...first, id, title: id.toUpperCase(), link: `https://example.org/${id}`, author: '', published: 0 }));
  const saved = new Map(page.articles.map(article => [article.id, false]));
  page.store.setState = async (id, kind, value) => { assert.equal(kind, 'read'); saved.set(id, value); };
  let html = '';
  page.web.loadData = value => { html = value; };
  page.chooseScope('feed'); page.openArticle(page.articles[0]); page.loadReader();
  const assertNext = title => {
    assert.equal(page.readerMenus().find(item => item.value === '下一篇未读').isEnabled, !!title);
    page.syncReaderFooter(); assert.equal(page.readerFooter.params.title, title);
    assert.ok(html.includes('native/xunzhi-footer'));
    assert.equal(page.readerPaths.size(), 1, 'next unread replaces the body without growing the back stack');
  };
  readerPageVisible(page); await idle(page); assertNext('B');
  assert.equal(page.unread('feed'), 2, 'visible sidebar must follow successful reads without waiting for back');
  await page.run(() => page.toggle('read'));
  readerPageEnd(page); await idle(page);
  assert.equal(saved.get('a'), false, 'a late page-end event must preserve manual unread');
  assertNext('B'); assert.equal(page.collectionCount('未读'), 3);
  for (const [id, next] of [['b', 'C'], ['c', 'A'], ['a', '']]) {
    page.readerFooter.params.next();
    assert.equal(page.article.id, id);
    readerPageVisible(page); readerPageEnd(page); await idle(page);
    assertNext(next);
    assert.equal(page.unread('feed'), [...saved.values()].filter(read => !read).length);
    assert.equal(page.articles.filter(article => !article.read).length, 3, 'keep source rows stable during reading');
  }
  assert.deepEqual([...saved.values()], [true, true, true]);
  const lastHtml = html;
  page.openNextUnread();
  assert.equal(page.article.id, 'a'); assert.equal(html, lastHtml);
});

test('sidebar read, today, folder and unread-star counts reflect only successful reader writes', async () => {
  let fail = false;
  const page = setup(async () => { if (fail) throw new Error('disk full'); });
  page.feeds[0].folder = '["News"]';
  page.articles[0].published = page.calendarDay + 1000;
  page.articles[0].starred = true;
  const rows = page.visible();
  page.openArticle(page.articles[0]);
  assert.equal(page.unread('feed'), 2); assert.equal(page.collectionCount('星标'), 1);
  await page.markRead();
  assert.equal(page.unread('feed'), 1); assert.equal(page.unread('', '["News"]'), 1);
  assert.equal(page.collectionCount('今天'), 0); assert.equal(page.collectionCount('星标'), 0);
  await page.toggle('read');
  assert.equal(page.collectionCount('今天'), 1); assert.equal(page.collectionCount('星标'), 1);
  await page.toggle('star'); assert.equal(page.collectionCount('星标'), 0);
  fail = true;
  await assert.rejects(page.toggle('read'), /disk full/);
  await assert.rejects(page.toggle('star'), /disk full/);
  assert.equal(page.unread('feed'), 2); assert.equal(page.collectionCount('星标'), 0);
  assert.equal(page.visible(), rows, 'count changes must not replace the underlying article rows');
});

test('a reload cannot roll sidebar counts back over a newer saved reading decision', async () => {
  const page = setup(); page.openArticle(first); await page.markRead();
  const currentArticles = page.store.articles;
  const stale = await currentArticles();
  let finish, requested;
  const started = new Promise(resolve => { requested = resolve; });
  page.store.articles = () => { requested(); return new Promise(resolve => { finish = resolve; }); };
  const reloading = page.reload(); await started;
  await page.toggle('read');
  finish(stale); await reloading;
  assert.equal(page.articles[0].read, true, 'fixture returned the older snapshot');
  assert.equal(page.unread('feed'), 2, 'the newer saved manual-unread decision wins');
  page.store.articles = currentArticles; await page.reload();
  assert.equal(page.unread('feed'), 2);
  assert.equal(page.readingStates.size, 0, 'a later snapshot retires temporary state');
  await page.toggle('read'); assert.equal(page.unread('feed'), 1);
  await page.store.setState(first.id, 'read', false); await page.reload();
  assert.equal(page.unread('feed'), 2, 'later authoritative changes must not be masked by old reader state');
});

for (const delayedStage of ['subscriptions', 'articles']) {
  test(`an older reload delayed at ${delayedStage} cannot overwrite a newer library snapshot`, async () => {
    const page = setup();
    const original = page.store[delayedStage];
    let finish, requested;
    const started = new Promise(resolve => { requested = resolve; });
    page.store[delayedStage] = async (...args) => {
      const snapshot = await original(...args);
      requested();
      return new Promise(resolve => { finish = () => resolve(snapshot); });
    };
    const older = page.reload(); await started;
    const freshFeeds = [{ id: 'feed', title: 'Renamed' }, { id: 'new-feed', title: 'New' }];
    const freshArticles = [{ ...first, read: true }, { ...second }, { ...first, id: 'new', feedId: 'new-feed' }];
    page.store.subscriptions = async () => freshFeeds;
    page.store.folders = async () => ['["News"]'];
    page.store.articles = async () => freshArticles;
    await page.reload();
    const newestFeeds = page.feeds;
    const newestArticles = page.articles;
    assert.equal(page.unread('feed'), 1);
    finish(); await older;
    assert.equal(page.feeds, newestFeeds, 'obsolete reads must not replace current subscriptions');
    assert.equal(page.articles, newestArticles, 'obsolete reads must not replace current articles');
    assert.equal(page.unread('feed'), 1);
    assert.equal(page.unread('new-feed'), 1);
    assert.deepEqual(Array.from(page.folders), ['["News"]']);
  });
}

test('a failed library read leaves the last complete snapshot visible', async () => {
  const page = setup();
  const feeds = page.feeds, articles = page.articles, folders = page.folders;
  page.store.subscriptions = async () => [{ id: 'new-feed' }];
  page.store.folders = async () => ['["News"]'];
  page.store.articles = async () => { throw new Error('read failed'); };
  await assert.rejects(page.reload(), /read failed/);
  assert.equal(page.feeds, feeds);
  assert.equal(page.articles, articles);
  assert.equal(page.folders, folders);
  assert.equal(page.unread('feed'), 2);
});

test('next unread stops at the adjacent unread article without copying a large queue', () => {
  const page = setup();
  const entries = Array.from({ length: 10000 }, (_, i) => ({ ...first, id: String(i) }));
  let reads = 0;
  page.readingQueue = new Proxy(entries, {
    get(target, key, receiver) {
      if (/^\d+$/.test(String(key))) reads++;
      return Reflect.get(target, key, receiver);
    },
  });
  page.article = entries[0];
  for (let i = 0; i < 200; i++) assert.equal(page.nextUnread(), entries[1]);
  assert.ok(reads <= 400, `adjacent lookups read ${reads} queue entries`);
});

test('next unread wraps in snapshot order, excludes the current article, and handles empty queues', () => {
  const page = setup();
  const entries = Array.from({ length: 5 }, (_, i) => ({ ...first, id: String(i), read: true }));
  page.readingQueue = entries;
  page.article = entries[3]; entries[3].read = false;
  assert.equal(page.nextUnread(), undefined, 'manual unread on the current article does not loop to itself');
  entries[0].read = false; entries[2].read = false;
  assert.equal(page.nextUnread(), entries[0]);
  entries[4].read = false;
  assert.equal(page.nextUnread(), entries[4], 'prefer the remaining suffix before wrapping');
  page.article = { ...first, id: 'not-in-snapshot' };
  assert.equal(page.nextUnread(), entries[0]);
  page.readingQueue = [page.article];
  assert.equal(page.nextUnread(), undefined);
  page.readingQueue = [];
  assert.equal(page.nextUnread(), undefined);
});

test('article links route HTTP outward, fragments inward, and reject other schemes', () => {
  const page = setup();
  page.openArticle({ ...first, link: 'https://example.org/post' });
  const opened = [];
  page.context = () => ({ openLink: async url => { opened.push(url); } });
  assert.equal(page.overrideLink('https://example.org/other'), true);
  assert.equal(page.overrideLink('https://example.org/post#note'), false);
  assert.equal(page.overrideLink('javascript:alert(1)'), true);
  assert.equal(page.overrideLink('file:///etc/passwd'), true);
  assert.deepEqual(opened, ['https://example.org/other']);
});

test('bulk read and undo use only the confirmed unread snapshot, including after refresh', async () => {
  const page = setup();
  const writes = [];
  page.store.setReadStates = async (ids, read) => { writes.push([Array.from(ids), read]); };
  page.reload = async () => {};
  page.toast = () => {};
  let confirm;
  page.getUIContext = () => ({ showAlertDialog: options => { confirm = options.secondaryButton.action; } });
  page.chooseScope('feed');
  page.confirmMarkAllRead();
  page.articles.push({ ...first, id: 'arrived-after-confirmation' });
  confirm(); await idle(page);
  await page.undoMarkAllRead();
  assert.deepEqual(writes, [[['a', 'b'], true], [['a', 'b'], false]]);
});


test('cached list filtering invalidates on scope, search and refreshed content; lazy rows receive updates', async () => {
  const page = setup();
  page.query = 'needle';
  assert.equal(page.visible().length, 0);
  const old = page.visible();
  assert.equal(page.visible(), old);
  page.articles = [{ ...first, content: '<p>needle</p>' }, { ...second }];
  page.syncList();
  await searchIdle(page);
  assert.equal(page.listData.totalCount(), 1);
  assert.equal(page.listData.getData(0).id, 'a');
  page.selectedFeed = 'another-feed'; page.syncList();
  assert.equal(page.listData.totalCount(), 0);
  page.selectedFeed = 'feed'; page.query = ''; page.syncList();
  assert.equal(page.listData.totalCount(), 2);
  page.articles = [{ ...first, read: true }, { ...second }];
  page.syncList();
  assert.equal(page.unread('feed'), 1);
  assert.equal(page.listData.getData(0).id, 'b');
  page.showRead = true; page.syncList();
  assert.equal(page.listData.totalCount(), 2);
});

test('article source labels and icons do not rescan subscriptions for every rendered row', (t) => {
  const page = setup();
  let idReads = 0;
  page.feeds = Array.from({ length: 1000 }, (_, i) => ({
    get id() { idReads++; return `feed-${i}`; }, title: `Source ${i}`, icon: `icon-${i}`,
  }));
  const start = performance.now();
  for (let i = 800; i < 1000; i++) {
    // The row checks its icon, renders the image/title, and names its accessible source.
    assert.equal(page.feedIcon(`feed-${i}`), `icon-${i}`);
    assert.equal(page.feedIcon(`feed-${i}`), `icon-${i}`);
    assert.equal(page.feedTitle(`feed-${i}`), `Source ${i}`);
    assert.equal(page.feedTitle(`feed-${i}`), `Source ${i}`);
  }
  assert.equal(page.feedIcon('missing'), '');
  assert.equal(page.feedTitle('missing'), 'missing');
  t.diagnostic(JSON.stringify({ subscriptions: 1000, renderedRows: 200, idReads,
    elapsedMs: +(performance.now() - start).toFixed(2) }));
  assert.ok(idReads <= 1000, `Repeated subscription scans: ${idReads} ID reads`);
});

test('source lookup follows refresh, icon publication and subscription removal', async () => {
  const page = setup();
  page.feeds = [{ id: 'feed', title: 'Before', icon: 'old-icon', site: '' }];
  page.selectedFeed = 'feed';
  assert.equal(page.scopeTitle(), 'Before');
  assert.equal(page.feedIcon('feed'), 'old-icon');
  page.icons = { update: async () => 'downloaded-icon' };
  await page.loadIcons();
  assert.equal(page.feedIcon('feed'), 'downloaded-icon');
  page.feeds = [{ id: 'feed', title: 'Refreshed', icon: 'replacement-icon' }];
  assert.equal(page.scopeTitle(), 'Refreshed');
  assert.equal(page.feedIcon('feed'), 'replacement-icon');
  page.feeds[0].title = 'Updated in place';
  assert.equal(page.feedTitle('feed'), 'Updated in place');
  page.feeds = [];
  assert.equal(page.feedTitle('feed'), 'feed');
  assert.equal(page.feedIcon('feed'), '');
});

test('loading cached icons does not rescan a 10,000-article library for every subscription', async (t) => {
  const page = setup();
  page.feeds = Array.from({ length: 100 }, (_, i) => ({ id: `feed-${i}`, icon: `icon-${i}` }));
  let articleReads = 0;
  page.articles = Array.from({ length: 10_000 }, (_, i) => ({
    ...first, id: `article-${i}`,
    get feedId() { articleReads++; return `feed-${i % 100}`; },
  }));
  page.syncList(); page.unread();
  let feeds = page.feeds;
  let publications = 0;
  Object.defineProperty(page, 'feeds', {
    get: () => feeds,
    set: value => {
      feeds = value; publications++;
      // Simulate @Watch and the count lookup during the subsequent render.
      page.syncList(); page.unread();
    },
  });
  let updates = 0;
  let cacheReads = 0;
  page.icons = {
    update: async id => { updates++; return `icon-${id.slice(5)}`; },
    cached: id => { cacheReads++; return `icon-${id.slice(5)}`; },
  };
  articleReads = 0;
  const start = performance.now();
  await page.loadIcons();
  t.diagnostic(JSON.stringify({ subscriptions: 100, articles: 10_000, updates, publications,
    articleReads, cacheReads, elapsedMs: +(performance.now() - start).toFixed(2) }));
  assert.equal(updates, 100, 'each icon still receives its freshness check');
  assert.equal(publications, 0, 'unchanged icons must not invalidate article lists and counts');
  assert.equal(articleReads, 0);
  assert.equal(cacheReads, 0, 'update already returns the final cached path');
});

test('an icon arriving after subscription edits preserves the latest title and does not restore removed feeds', async () => {
  const page = setup();
  page.feeds = [{ id: 'feed', title: 'Before', icon: 'old' }, { id: 'removed', title: 'Removed', icon: 'old' }];
  let updates = 0;
  page.icons = {
    update: async id => {
      updates++;
      if (id === 'feed') page.feeds = [{ id: 'feed', title: 'Renamed', folder: '["New"]', icon: 'old' }];
      return `new-${id}`;
    },
    cached: id => `new-${id}`,
  };
  await page.loadIcons();
  assert.equal(updates, 2);
  assert.equal(page.feeds.length, 1);
  assert.equal(page.feeds[0].title, 'Renamed');
  assert.equal(page.feeds[0].folder, '["New"]');
  assert.equal(page.feeds[0].icon, 'new-feed');
});

test('Web callbacks ignore a blank document and accept the actual generated data document', async () => {
  const page = setup(); const loads = captureReaderLoads(page);
  page.openArticle(first); page.loadReader();
  readerPageEnd(page, 'about:blank'); await idle(page);
  assert.equal(page.article.read, false);
  readerPageEnd(page, loads[0]); await idle(page);
  assert.equal(page.article.read, true);
});

async function searchIdle(page) {
  for (let i = 0; page.searchPending && i < 2000; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(page.searchPending, false, 'search must finish');
}

test('cold full-body search yields before indexing and between batches without publishing partial results', async () => {
  const page = setup();
  page.articles = Array.from({ length: 10_000 }, (_, i) => ({ ...first, id: String(i), content: `<p>body-${i}</p>` }));
  page.query = 'body-9999';
  page.syncList();
  assert.equal(page.searchPending, true);
  assert.equal(page.plainText.size, 0, 'input handler must not strip the library synchronously');
  assert.equal(page.listData.totalCount(), 0, 'partial matches must not masquerade as completed search');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(page.plainText.size > 0 && page.plainText.size <= 100, 'another event runs between batches');
  await searchIdle(page);
  assert.deepEqual(Array.from(page.visible(), item => item.id), ['9999']);
  page.query = 'body-9998'; page.syncList();
  assert.equal(page.searchPending, false, 'warm searches reuse the index');
  assert.deepEqual(Array.from(page.visible(), item => item.id), ['9998']);
});

test('clearing search cancels pending indexing and restores the list immediately', async () => {
  const page = setup();
  page.query = 'missing'; page.syncList();
  page.query = ''; page.syncList();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(page.searchPending, false);
  assert.equal(page.plainText.size, 0);
  assert.equal(page.listData.totalCount(), 2);
});

test('rapid edits and data replacement cannot publish obsolete search results', async () => {
  const page = setup();
  const oldArticles = Array.from({ length: 500 }, (_, i) => ({ ...first, id: `old-${i}`, content: '<p>old match</p>' }));
  page.articles = oldArticles;
  page.query = 'old'; page.syncList();
  await new Promise(resolve => setTimeout(resolve, 0));
  page.query = 'new'; page.syncList();
  page.articles = [{ ...first, id: 'replacement', content: '<p>new match</p>' }]; page.syncList();
  await searchIdle(page);
  assert.equal(page.indexedArticles, page.articles);
  assert.deepEqual(Array.from(page.visible(), item => item.id), ['replacement']);
  assert.equal(page.plainText.size, 1);
});

test('warm search reuses normalized title, author and decoded body text', async () => {
  const page = setup();
  let fieldReads = 0;
  page.articles = [{ ...first,
    get title() { fieldReads++; return 'Mixed TITLE'; },
    get author() { fieldReads++; return 'Writer'; },
    content: '<p>BODY &amp; 中文</p>'
  }];
  page.query = 'title'; page.syncList(); await searchIdle(page);
  const indexedReads = fieldReads;
  for (const query of ['writer', 'body & 中文', '  TITLE  ']) {
    page.query = query; page.syncList();
    assert.equal(page.listData.totalCount(), 1);
  }
  assert.equal(fieldReads, indexedReads, 'typing must not concatenate and normalize article fields again');
});

function fullscreenPage() {
  const page = setup();
  const changes = [];
  page.context = () => ({ testWindow: {
    getWindowAvoidArea() { return { topRect: { height: 40 }, bottomRect: { height: 28 } }; },
    async setSpecificSystemBarEnabled(name, enabled) { changes.push([name, enabled]); },
    async setWindowLayoutFullScreen(active) { changes.push(['layout', active]); }
  } });
  page.toast = () => {};
  page.getUIContext = () => ({ postFrameCallback: callback => setTimeout(() => callback.onIdle(), 0) });
  page.chooseScope('feed'); page.openArticle(first);
  let reloads = 0;
  page.loadReader = () => { reloads++; };
  return { page, changes, reloads: () => reloads };
}

test('fullscreen entry and a permanent sidebar retire the temporary drawer before Back', async () => {
  for (const enter of ['setReaderFullScreen', 'setMediaFullScreen']) {
    const { page } = fullscreenPage();
    page.libraryDrawer = true;
    const entering = page[enter](true);
    assert.equal(page.libraryDrawer, false, 'a hidden drawer must not consume the first Back');
    await entering;
  }
  const page = setup();
  page.resizeWindow(800); page.libraryDrawer = true;
  page.resizeWindow(1002);
  assert.equal(page.libraryDrawer, false, 'the permanent sidebar has no temporary drawer to dismiss');
  page.resizeWindow(800);
  assert.equal(page.libraryDrawer, false, 'shrinking again must not resurrect the old drawer');
});

test('reading fullscreen keeps the document and route, and back exits fullscreen first', async () => {
  const { page, changes, reloads } = fullscreenPage();
  await page.setReaderFullScreen(true);
  assert.equal(page.readerFullScreen, true);
  assert.equal(page.readerChromeVisible, false);
  assert.deepEqual(changes.slice(-3), [['navigation', false], ['navigationIndicator', false], ['layout', true]]);
  assert.equal(page.onBackPress(), true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(page.readerFullScreen, false);
  assert.equal(page.readerChromeVisible, true);
  assert.equal(page.article.id, 'a');
  assert.equal(page.readerPaths.size(), 1);
  assert.equal(reloads(), 0);
  assert.equal(page.onBackPress(), true);
  assert.equal(page.readerPaths.size(), 0);
  assert.deepEqual(changes.slice(-3), [['navigation', true], ['navigationIndicator', true], ['layout', false]]);
});

test('video fullscreen exit returns to reading fullscreen without showing system bars', async () => {
  const { page, changes } = fullscreenPage();
  await page.setReaderFullScreen(true);
  await page.setMediaFullScreen(true);
  page.getUIContext = () => ({ runScopedTask: action => action() });
  let exits = 0; page.mediaExit = { exitFullScreen() { exits++; } };
  assert.equal(page.onBackPress(), true);
  assert.equal(exits, 1);
  assert.equal(page.readerFullScreen, true);
  await page.setMediaFullScreen(false);
  assert.deepEqual(changes.slice(-3), [['navigation', false], ['navigationIndicator', false], ['layout', true]]);
  assert.equal(page.readerFullScreen, true);
});

test('leaving the article clears reading fullscreen and restores the window', async () => {
  const { page, changes } = fullscreenPage();
  await page.setReaderFullScreen(true);
  nativeBack(page);
  await idle(page);
  assert.equal(page.readerFullScreen, false);
  assert.equal(page.article, undefined);
  assert.deepEqual(changes.slice(-3), [['navigation', true], ['navigationIndicator', true], ['layout', false]]);
});

test('nested fullscreen preserves the original gesture indicator even after its avoid area disappears', async () => {
  const { page, changes } = fullscreenPage();
  const normal = page.context().testWindow;
  normal.getWindowAvoidArea = () => ({ topRect: { height: 0 }, bottomRect: { height: 28 } });
  page.context = () => ({ testWindow: normal });
  await page.setReaderFullScreen(true);
  normal.getWindowAvoidArea = () => ({ bottomRect: { height: 0 } });
  await page.setMediaFullScreen(true);
  await page.setMediaFullScreen(false);
  await page.setReaderFullScreen(false);
  assert.deepEqual(changes.slice(-3), [['navigation', true], ['navigationIndicator', true], ['layout', false]]);
  assert.equal(page.fullScreenWindowActive, false);
});


test('fullscreen leaves an originally hidden gesture indicator hidden', async () => {
  const { page, changes } = fullscreenPage();
  const normal = page.context().testWindow;
  normal.getWindowAvoidArea = () => ({ bottomRect: { height: 0 } });
  page.context = () => ({ testWindow: normal });
  await page.setReaderFullScreen(true);
  await page.setReaderFullScreen(false);
  assert.deepEqual(changes.slice(-3), [['navigation', true], ['navigationIndicator', false], ['layout', false]]);
});


test('fullscreen restores the status bar before expanding the split navigation', async () => {
  const { page } = fullscreenPage();
  let frame;
  page.getUIContext = () => ({ postFrameCallback: callback => { frame = callback; } });
  await page.setReaderFullScreen(true);
  const exiting = page.setReaderFullScreen(false);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(frame);
  assert.equal(page.readerFullScreen, false, 'release the native page status-bar override');
  assert.equal(page.fullScreenWindowActive, true, 'page must still occupy all of Navigation for restoration');
  frame.onIdle(); await exiting;
  assert.equal(page.fullScreenWindowActive, false);
});

for (const change of ['edit', 'close', 'reopen']) {
  test(`an obsolete subscription lookup failure does not leak after ${change}`, async () => {
    const page = new Index();
    const toasts = [];
    page.toast = message => toasts.push(message);
    const address = `https://${change}.example.org/`;
    let fail;
    feedRequests.set(address, () => new Promise((_, reject) => { fail = reject; }));
    page.openSheet('添加订阅');
    const pending = page.run(() => page.add(address));
    if (change === 'edit') {
      page.address = 'https://replacement.example.org/';
      page.addressRevision++;
      page.sheetMessage = '';
    } else if (change === 'close') {
      page.showSheet = false;
    } else {
      page.showSheet = false;
      page.openSheet('添加订阅');
    }
    fail(new Error('Operation timed out'));
    await pending;
    assert.equal(page.busy, false);
    if (page.showSheet) assert.equal(page.sheetMessage, '');
    assert.equal(toasts.length, 0);
    assert.equal(page.candidates.length, 0);
    feedRequests.delete(address);
  });
}

test('a current lookup failure stays actionable and retry replaces it with discovered candidates', async () => {
  const page = new Index();
  const address = 'https://retry.example.org/';
  page.openSheet('添加订阅');
  feedRequests.set(address, async () => { throw new Error('Operation timed out'); });
  await page.run(() => page.add(address));
  assert.equal(page.sheetMessage, '网站响应超时');
  assert.equal(page.sheetError, true);
  assert.equal(page.busy, false);
  feedRequests.set(address, async () => ({ url: address, source:
    '<html><head><link rel="alternate" type="application/rss+xml" href="/feed" title="Example feed"></head></html>' }));
  await page.run(() => page.add(address));
  assert.equal(page.sheetMessage, '选择要添加的订阅');
  assert.equal(page.sheetError, false);
  assert.deepEqual(Array.from(page.candidates), ['https://retry.example.org/feed']);
  assert.equal(page.candidateTitles.get(page.candidates[0]), 'Example feed');
  assert.equal(page.showSheet, true);
  assert.equal(page.busy, false);
  feedRequests.delete(address);
});

function positionedList() {
  const page = setup();
  page.articles = Array.from({ length: 8 }, (_, i) => ({ ...first, id: `row-${i}` }));
  page.paths.pushPath({ name: 'articles' });
  const scrolls = [];
  const frames = [];
  page.getUIContext = () => ({ postFrameCallback: frame => frames.push(frame) });
  page.listScroller = {
    scrollTo() {},
    getItemRect: () => ({ x: 0, y: -12, width: 360, height: 120 }),
    scrollToIndex: (...args) => scrolls.push(args),
  };
  page.syncList();
  page.listFirstVisible = 3;
  return { page, scrolls, frames, render: () => frames.splice(0).forEach(frame => frame.onIdle()) };
}

test('a refresh prepending articles preserves the visible article ID and partial row offset', () => {
  const { page, scrolls, render } = positionedList();
  page.articles = [{ ...first, id: 'new' }, ...page.articles];
  page.syncList();
  assert.equal(scrolls.length, 0, 'restore only after the updated native list has rendered');
  render();
  assert.equal(scrolls.length, 1);
  assert.deepEqual(scrolls[0].slice(0, 3), [4, false, 0]);
  assert.equal(scrolls[0][3].extraOffset.value, 12);
  assert.equal(page.listData.getData(4).id, 'row-3');
});

test('removed visible anchors choose the next survivor, then a previous survivor at the end', () => {
  const { page, scrolls, render } = positionedList();
  page.articles = page.articles.map((item, i) => ({ ...item, read: i === 3 || i === 4 }));
  page.syncList();
  render();
  assert.equal(page.listData.getData(scrolls.at(-1)[0]).id, 'row-5');
  page.listFirstVisible = 5;
  page.articles = page.articles.map(item => ({ ...item, read: item.read || item.id === 'row-7' }));
  page.syncList();
  render();
  assert.equal(page.listData.getData(scrolls.at(-1)[0]).id, 'row-6');
});

test('scope changes discard the old list position instead of pulling a new selection back', () => {
  const { page, scrolls } = positionedList();
  page.filter = '全部'; page.showRead = true;
  page.syncList();
  assert.equal(scrolls.length, 0);
});

test('successive refreshes before rendering retain the original anchor and discard obsolete restores', () => {
  const { page, scrolls, render } = positionedList();
  page.articles = [{ ...first, id: 'new-1' }, ...page.articles]; page.syncList();
  page.articles = [{ ...first, id: 'new-2' }, ...page.articles]; page.syncList();
  render();
  assert.equal(scrolls.length, 1);
  assert.equal(page.listData.getData(scrolls[0][0]).id, 'row-3');
  assert.equal(scrolls[0][0], 5);
});

test('a scope switch or a new touch cancels a scheduled position restore', () => {
  for (const action of ['scope', 'touch']) {
    const { page, scrolls, render } = positionedList();
    page.articles = [{ ...first, id: 'new' }, ...page.articles]; page.syncList();
    if (action === 'scope') { page.filter = '星标'; page.syncList(); }
    else {
      const touch = source.match(/\.onTouch\(\(event: TouchEvent\) => \{ if \(event.type === TouchType.Down\) ([^}]+) \}\)/);
      assert.ok(touch);
      new Function(touch[1]).call(page);
    }
    render();
    assert.equal(scrolls.length, 0);
  }
});

test('refresh during reading restores the next surviving article after native back', async () => {
  const { page, scrolls, render } = positionedList();
  page.reload = async () => page.syncList();
  page.openArticle(page.articles[3]);
  page.articles = [{ ...first, id: 'new' }, ...page.articles.map(item => ({ ...item, read: item.id === 'row-3' }))];
  page.syncList(); render();
  assert.equal(scrolls.length, 0, 'do not scroll the hidden source list');
  nativeBack(page); await idle(page); render();
  assert.equal(scrolls.length, 1);
  assert.equal(page.listData.getData(scrolls[0][0]).id, 'row-4');
});

test('refresh preserves an active search anchor through asynchronous index rebuilding', async () => {
  const { page, scrolls, render } = positionedList();
  page.query = 'A'; page.syncList(); await searchIdle(page); render();
  scrolls.length = 0; page.listFirstVisible = 3;
  page.articles = [{ ...first, id: 'new' }, ...page.articles]; page.syncList();
  assert.equal(page.searchPending, true);
  assert.equal(page.listData.totalCount(), 0);
  await searchIdle(page); render();
  assert.equal(scrolls.length, 1);
  assert.equal(page.listData.getData(scrolls[0][0]).id, 'row-3');
});

test('a list already at the top shows newly arrived articles without restoring an older first row', () => {
  const { page, scrolls, render } = positionedList();
  page.listFirstVisible = 0;
  page.listScroller.getItemRect = () => ({ x: 0, y: 0, width: 360, height: 120 });
  page.articles = [{ ...first, id: 'new' }, ...page.articles]; page.syncList(); render();
  assert.equal(scrolls.length, 0);
  assert.equal(page.listData.getData(0).id, 'new');
});

test('an index left over from a previous layout is not queried outside the current data', () => {
  const { page, scrolls, render } = positionedList();
  page.listFirstVisible = 80;
  page.listScroller.getItemRect = () => { throw new Error('out-of-range layout query'); };
  page.syncList(); render();
  assert.equal(scrolls.length, 0);
});


test('relative update status advances while idle, stops in background and catches up on return', t => {
  let now = new Date(2026, 9, 20, 12).getTime();
  t.mock.method(Date, 'now', () => now);
  const page = setup(); page.ready = true;
  page.feeds = [{ id: 'feed', checked: now - 59000, error: '' }];
  page.onPageShow();
  assert.equal(activityTimers.size, 1);
  assert.equal(page.activitySummary(), '刚刚更新');
  const timer = [...activityTimers.values()][0];
  assert.equal(timer.interval, 60000);
  now += 60000; timer.callback();
  assert.equal(page.activitySummary(), '1 分钟前更新');
  page.onPageHide();
  assert.equal(activityTimers.size, 0);
  now += 5 * 60000;
  page.onPageShow();
  assert.equal(page.activitySummary(), '6 分钟前更新');
  page.onPageShow();
  assert.equal(activityTimers.size, 1, 'repeated show cannot leave multiple timers');
  page.aboutToDisappear();
  assert.equal(activityTimers.size, 0);
});

test('activity clock keeps opening, progress and failure priority and updates yesterday labels', t => {
  let now = new Date(2026, 9, 20, 23, 59).getTime();
  t.mock.method(Date, 'now', () => now);
  const page = setup(); page.onPageShow();
  const tick = () => [...activityTimers.values()][0].callback();
  assert.equal(page.activitySummary(), '正在打开…');
  page.ready = true; page.feeds = [];
  assert.equal(page.activitySummary(), '暂无活动');
  page.feeds = [{ id: 'feed', checked: 0, error: '' }];
  assert.equal(page.activitySummary(), '尚未更新');
  page.feeds[0].checked = new Date(2026, 9, 20, 12).getTime();
  assert.equal(page.activitySummary(), '12:00 更新');
  now += 2 * 60000; tick();
  assert.equal(page.activitySummary(), '昨天更新');
  page.feeds[0].checked = new Date(2026, 9, 18, 12).getTime();
  assert.equal(page.activitySummary(), '10月18日更新');
  page.feeds[0].error = 'timeout';
  assert.equal(page.activitySummary(), '1 个订阅未能更新');
  page.refreshing = true; page.refreshProgress = '正在更新 1/2';
  assert.equal(page.activitySummary(), '正在更新 1/2');
  page.onPageHide();
});


test('saved read articles remain discoverable in stars after reopening the scope', () => {
  const page = setup();
  page.articles = [{ ...first, read: true, starred: true }, { ...second, read: false, starred: false }];
  page.chooseScope('', '', '星标');
  assert.deepEqual(Array.from(page.visible(), item => item.id), ['a']);
  assert.equal(page.collectionCount('星标'), 0, 'library badges consistently count unread');
  page.showRead = false;
  assert.equal(page.visible().length, 0);
  page.ready = true;
  assert.equal(emptyListText.call(page), '没有未读的星标文章');
  page.chooseScope('feed');
  assert.equal(page.showRead, false);
  assert.deepEqual(Array.from(page.visible(), item => item.id), ['b']);
  page.chooseScope('', '', '星标');
  assert.deepEqual(Array.from(page.visible(), item => item.id), ['a']);
  page.articles = [{ ...first, read: true, starred: false }];
  assert.equal(page.visible().length, 0);
  assert.equal(emptyListText.call(page), '喜欢的文章可以留在这里');
});


test('menu refresh reports progress without pulling either pane or blocking reading', async () => {
  const page = setup(); page.ready = true;
  let finish, calls = 0;
  page.refresh = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const pending = page.startRefresh('feed');
  assert.equal(page.refreshing, true);
  assert.equal(page.busy, false);
  assert.equal(page.homeRefreshing, false);
  assert.equal(page.listRefreshing, false);
  page.openArticle(first);
  assert.equal(page.article.id, first.id);
  await page.startRefresh('feed');
  assert.equal(calls, 1);
  finish(); await pending;
  assert.equal(page.refreshing, false);
  assert.equal(page.homeRefreshing, false);
  assert.equal(page.listRefreshing, false);
  assert.match(source, /Refresh\(\{ refreshing: \$\$this\.homeRefreshing \}\)/);
  assert.match(source, /Refresh\(\{ refreshing: \$\$this\.listRefreshing \}\)/);
});

test('pull refresh animates only its own pane and always ends on completion or rejection', async () => {
  for (const origin of ['homeRefreshing', 'listRefreshing']) {
    const page = setup(); page.ready = true;
    const other = origin === 'homeRefreshing' ? 'listRefreshing' : 'homeRefreshing';
    const messages = []; page.toast = message => messages.push(message);
    let fail;
    page.refresh = () => new Promise((resolve, reject) => { fail = reject; });
    page[origin] = true;
    const pending = page.startRefresh();
    assert.equal(page[origin], true);
    assert.equal(page[other], false);
    fail(new Error('offline')); await pending;
    assert.equal(page.homeRefreshing, false);
    assert.equal(page.listRefreshing, false);
    assert.equal(page.refreshing, false);
    assert.equal(messages[0], '暂时无法更新，仍可阅读已下载的文章');
  }
  const page = setup(); page.ready = true; page.busy = true;
  page.homeRefreshing = true; page.listRefreshing = true;
  await page.startRefresh();
  assert.equal(page.homeRefreshing, false);
  assert.equal(page.listRefreshing, false);
});


test('today rolls over while idle without refreshing or replacing the open article', t => {
  const midnight = new Date().setHours(0, 0, 0, 0);
  let now = new Date(midnight).setHours(23, 59, 0, 0);
  t.mock.method(Date, 'now', () => now);
  const page = setup();
  const tomorrow = new Date(midnight); tomorrow.setDate(tomorrow.getDate() + 1);
  page.articles = [{ ...first, published: midnight + 3600000 },
    { ...second, published: tomorrow.getTime() + 3600000 }];
  page.listScroller.getItemRect = () => ({ y: 0, height: 100 });
  page.onPageShow(); t.after(() => page.onPageHide());
  page.chooseScope('', '', '今天'); page.syncList();
  assert.equal(page.collectionCount('今天'), 1);
  assert.deepEqual(Array.from({ length: page.listData.totalCount() }, (_, i) => page.listData.getData(i).id), ['a']);
  page.openArticle(page.articles[0]);
  const article = page.article; const queue = page.readingQueue;
  now = tomorrow.getTime() + 60000;
  [...activityTimers.values()][0].callback();
  assert.deepEqual(Array.from({ length: page.listData.totalCount() }, (_, i) => page.listData.getData(i).id), ['b']);
  assert.equal(page.collectionCount('今天'), 1);
  const revision = page.listData.revision;
  now += 60000; [...activityTimers.values()][0].callback();
  assert.equal(page.listData.revision, revision, 'same-day ticks must not republish the list');
  assert.equal(page.article, article, 'midnight must not reload the current Web article');
  assert.equal(page.readingQueue, queue, 'keep the reading session queue');
  assert.equal(page.busy, false);
});

test('today catches up after a night in background and leaves other lists alone', t => {
  const midnight = new Date().setHours(0, 0, 0, 0);
  let now = midnight + 3600000;
  t.mock.method(Date, 'now', () => now);
  const page = setup(); page.articles = [{ ...first, published: now }];
  page.listScroller.getItemRect = () => ({ y: 0, height: 100 });
  page.onPageShow(); t.after(() => page.onPageHide());
  page.chooseScope('', '', '今天'); page.syncList();
  assert.equal(page.listData.totalCount(), 1);
  page.onPageHide();
  const next = new Date(midnight); next.setDate(next.getDate() + 1);
  now = next.getTime() + 3600000;
  page.onPageShow();
  assert.equal(page.listData.totalCount(), 0);
  assert.equal(page.collectionCount('今天'), 0);
  assert.equal(page.collectionCount('未读'), 1);
  page.chooseScope('feed'); page.syncList();
  const revision = page.listData.revision;
  now += 3 * 86400000; [...activityTimers.values()][0].callback();
  assert.equal(page.listData.revision, revision, 'calendar changes must not republish a normal feed');
  assert.equal(page.listData.totalCount(), 1);
});


function readerResourceError(page, name, mainFrame, url = currentReaderUrl(page)) {
  const callback = source.match(new RegExp('\\.' + name + '\\(\\(event\\) => \\{([^\\n]+)\\}\\)'));
  assert.ok(callback, `${name} must distinguish the document from failed images`);
  new Function('event', callback[1]).call(page, { request: { isMainFrame: () => mainFrame, getRequestUrl: () => url } });
}
function currentReaderUrl(page) {
  if (!page.readerDocumentUrl) { page.web.loadData ||= () => {}; page.loadReader(); }
  return page.readerDocumentUrl;
}
function readerPageEnd(page, url = currentReaderUrl(page)) {
  const callback = source.slice(source.indexOf('.onPageEnd('));
  const body = callback.slice(callback.indexOf('{') + 1, callback.indexOf('\n            })'));
  new Function('event', body).call(page, { url });
}

function readerPageVisible(page, url = currentReaderUrl(page)) {
  const callback = source.match(/\.onPageVisible\(\((?:event)?\) => \{([^\n]+)\}\)/);
  assert.ok(callback, 'readable text must not wait for remote images to finish loading');
  new Function('textOnly', 'event', callback[1]).call(page, textOnly, { url });
}

test('visible article text is marked read before late images finish, without duplicate writes', async () => {
  let writes = 0;
  const page = setup(async () => { writes++; });
  page.openArticle({ ...first, content: '<p>Readable now</p><img src="https://example.org/slow.png">' });
  readerPageVisible(page); await idle(page);
  assert.equal(page.article.read, true);
  assert.equal(writes, 1);
  readerPageEnd(page); await idle(page);
  assert.equal(writes, 1);
  await page.toggle('read');
  readerPageVisible(page); readerPageEnd(page); await idle(page);
  assert.equal(page.article.read, false, 'late callbacks must preserve manual unread');
  assert.equal(writes, 2);
});

test('page visibility does not mark failed, empty or media-only documents prematurely', async () => {
  for (const content of ['', '<p>&nbsp;</p>', '<img src="https://example.org/slow.png">', '<video src="https://example.org/slow.mp4"></video>']) {
    const page = setup(); page.openArticle({ ...first, content });
    readerPageVisible(page); await idle(page);
    assert.equal(page.article.read, false);
  }
  for (const name of ['onErrorReceive', 'onHttpErrorReceive']) {
    const page = setup(); page.openArticle(first);
    readerResourceError(page, name, true); readerPageVisible(page); readerPageEnd(page); await idle(page);
    assert.equal(page.article.read, false);
  }
  const page = setup();
  assert.doesNotThrow(() => readerPageVisible(page));
});

test('a failed main document is not marked read by the following page-end event', async () => {
  for (const name of ['onErrorReceive', 'onHttpErrorReceive']) {
    const page = setup(); page.openArticle(first); page.readerChromeVisible = false;
    readerResourceError(page, name, true); readerPageEnd(page); await idle(page);
    assert.equal(page.article.read, false);
    assert.equal(page.loaded, false);
    assert.equal(page.readerError, true);
    assert.equal(page.readerChromeVisible, true, 'keep recovery and back controls reachable');
  }
});

test('a missing image does not hide readable text or prevent its read state', async () => {
  const page = setup(); page.openArticle(first);
  readerResourceError(page, 'onErrorReceive', false);
  readerResourceError(page, 'onHttpErrorReceive', false);
  readerPageEnd(page); await idle(page);
  assert.equal(page.readerError, false);
  assert.equal(page.article.read, true);
});

test('a synchronous renderer failure offers a retry and only successful retry marks read', async () => {
  const page = setup();
  page.openArticle({ ...first, link: 'https://example.org/article', published: 0, author: '' });
  page.web.loadData = () => { throw new Error('renderer unavailable'); };
  assert.doesNotThrow(() => page.loadReader());
  readerPageEnd(page); await idle(page);
  assert.equal(page.readerError, true); assert.equal(page.article.read, false);
  let html = '';
  page.web.loadData = value => { html = value; };
  page.loadReader();
  assert.equal(page.readerError, false);
  assert.ok(html.includes('<p>A</p>'));
  readerPageEnd(page); await idle(page);
  assert.equal(page.article.read, true);
  await page.toggle('read');
  page.loadReader(); readerPageEnd(page); await idle(page);
  assert.equal(page.article.read, false, 'retry must not erase a manual unread decision');
});


test('empty markup stays unread while image-only articles remain readable', async () => {
  for (const content of ['', '  ', '<p></p>', '<p>&nbsp; &#160;</p>', '<!-- hidden -->']) {
    const page = setup(); page.openArticle({ ...first, content });
    readerPageEnd(page); await idle(page);
    assert.equal(page.article.read, false, `empty content: ${content}`);
  }
  const page = setup(); page.openArticle({ ...first, content: '<img src="https://example.org/comic.png" alt="Comic">' });
  readerPageEnd(page); await idle(page);
  assert.equal(page.article.read, true, 'do not discard image-only RSS feeds');
});


function readerRenderExited(page) {
  currentReaderUrl(page);
  const callback = source.match(/\.onRenderExited\(\(\) => \{([^\n]+)\}\)/);
  assert.ok(callback, 'render-process exit needs a native recovery path');
  new Function(callback[1]).call(page);
}

test('a renderer exit offers recovery without changing read decisions, and retry shows the same article', async () => {
  for (const manualUnread of [false, true]) {
    let writes = 0;
    const page = setup(async () => { writes++; });
    page.openArticle({ ...first, link: 'https://example.org/article', published: 0, author: '' });
    page.loaded = manualUnread;
    page.readerChromeVisible = false;
    const article = page.article;
    readerRenderExited(page);
    assert.equal(page.readerError, true);
    assert.equal(page.readerChromeVisible, true);
    assert.equal(page.article, article);
    readerPageVisible(page); readerPageEnd(page); await idle(page);
    assert.equal(writes, 0, 'late callbacks after failure cannot mark the article read');
    let html = '';
    page.web.loadData = value => { html = value; };
    page.loadReader(); readerPageVisible(page); await idle(page);
    assert.equal(page.readerError, false);
    assert.ok(html.includes('<p>A</p>'));
    assert.equal(page.article.id, first.id);
    assert.equal(writes, manualUnread ? 0 : 1);
    assert.equal(page.article.read, !manualUnread);
  }
});

test('settings keyboard actions restore their origin after work and sheets finish', async () => {
  const page = setup();
  page.paths.pushPath({ name: 'settings' });
  const frames = [], focused = [];
  page.getUIContext = () => ({
    getFocusController: () => ({ isActive: () => true, requestFocus: id => focused.push(id) }),
    postFrameCallback: frame => frames.push(frame),
  });
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  let work;
  page.activateFocusAction('导入 OPML 文件', () => { work = page.run(() => pending); });
  assert.equal(page.busy, true);
  assert.equal(frames.length, 0);
  finish(); await work;
  assert.equal(page.busy, false);
  assert.equal(focused.length, 0, 'wait until disabled rows are enabled in native layout');
  frames.shift().onIdle();
  assert.deepEqual(focused, ['导入 OPML 文件']);

  page.activateFocusAction('开源许可', () => { page.showSheet = true; });
  page.restoreActionFocus();
  assert.equal(frames.length, 0, 'never take focus from an open sheet');
  page.showSheet = false;
  page.restoreActionFocus(); frames.shift().onIdle();
  assert.deepEqual(focused, ['导入 OPML 文件', '开源许可']);
  page.restoreActionFocus();
  assert.equal(frames.length, 0, 'consume a return target only once');
});

test('settings focus restoration skips touch, navigation away and newly opened overlays', async () => {
  const page = setup();
  page.paths.pushPath({ name: 'settings' });
  const frames = [], focused = [];
  let keyboard = false;
  page.getUIContext = () => ({
    getFocusController: () => ({ isActive: () => keyboard, requestFocus: id => focused.push(id) }),
    postFrameCallback: frame => frames.push(frame),
  });
  page.toast = () => {};
  let work;
  page.activateFocusAction('导出 OPML 文件', () => { work = page.run(async () => {}); });
  await work;
  assert.equal(frames.length, 0, 'touch must not acquire a keyboard focus highlight');
  keyboard = true;
  page.activateFocusAction('导出 OPML 文件', () => { work = page.run(async () => { throw new Error('export failed'); }); });
  await work;
  page.paths.pop(); frames.shift().onIdle();
  assert.equal(focused.length, 0, 'do not jump back to a departed settings page');
  page.paths.pushPath({ name: 'settings' });
  page.activateFocusAction('导入 OPML 文件', () => { work = page.run(async () => {}); });
  await work;
  page.showSheet = true; frames.shift().onIdle();
  assert.equal(focused.length, 0, 'do not steal focus from an overlay opened before the frame');
});

test('activity sheets return keyboard focus to the visible home, sidebar or drawer entry', () => {
  for (const owner of ['home', 'sidebar', 'drawer']) {
    const page = setup(); const frames = [], focused = [];
    if (owner !== 'home') page.paths.pushPath({ name: 'articles' });
    page.windowWidth = owner === 'sidebar' ? 1440 : 800;
    page.libraryDrawer = owner === 'drawer';
    page.getUIContext = () => ({
      getFocusController: () => ({ isActive: () => true, requestFocus: id => focused.push(id) }),
      postFrameCallback: frame => frames.push(frame),
    });
    const id = owner === 'home' ? 'activity-home' : 'activity-sidebar';
    page.activateFocusAction(id, () => { page.openSheet('当前活动'); });
    page.restoreActionFocus(); assert.equal(frames.length, 0);
    page.showSheet = false; page.restoreActionFocus(); frames.shift().onIdle();
    assert.deepEqual(focused, [id], owner);
    page.restoreActionFocus(); assert.equal(frames.length, 0);
  }
});

test('sheet disappearance may precede the two-way visibility update', () => {
  const page = setup(); const frames = [], focused = [];
  page.getUIContext = () => ({
    getFocusController: () => ({ isActive: () => true, requestFocus: id => focused.push(id) }),
    postFrameCallback: frame => frames.push(frame),
  });
  page.activateFocusAction('activity-home', () => { page.openSheet('当前活动'); });
  page.restoreActionFocus(true);
  assert.equal(frames.length, 1, 'native onDisappear must not discard restoration while visibility is still true');
  page.showSheet = false; frames.shift().onIdle();
  assert.deepEqual(focused, ['activity-home']);
});

test('activity focus does not return to hidden owners or steal focus from a newer sheet', () => {
  for (const change of ['navigate', 'fold', 'drawer-close', 'fullscreen', 'new-sheet']) {
    const page = setup(); const frames = [], focused = [];
    page.fontLicenses = 'Licenses already loaded';
    const home = change === 'navigate' || change === 'new-sheet';
    if (!home) page.paths.pushPath({ name: 'articles' });
    page.windowWidth = change === 'drawer-close' ? 800 : 1440;
    page.libraryDrawer = change === 'drawer-close';
    page.getUIContext = () => ({
      getFocusController: () => ({ isActive: () => true, requestFocus: id => focused.push(id) }),
      postFrameCallback: frame => frames.push(frame),
    });
    page.activateFocusAction(home ? 'activity-home' : 'activity-sidebar', () => { page.openSheet('当前活动'); });
    page.showSheet = false; page.restoreActionFocus();
    if (change === 'navigate') page.paths.pushPath({ name: 'settings' });
    if (change === 'fold') page.windowWidth = 460;
    if (change === 'drawer-close') page.libraryDrawer = false;
    if (change === 'fullscreen') page.fullScreenWindowActive = true;
    if (change === 'new-sheet') page.openSheet('开源许可');
    frames.shift().onIdle(); assert.deepEqual(focused, [], change);
  }
});

test('system back dismisses the last destination before leaving the library', () => {
  const page = setup();
  assert.equal(page.onBackPress(), false, 'Home belongs to system back handling');
  for (const name of ['settings', 'articles']) {
    page.paths.pushPath({ name });
    assert.equal(page.onBackPress(), true, `${name} must return to the library even in split mode`);
    assert.equal(page.paths.size(), 0);
    assert.equal(page.onBackPress(), false);
  }
  page.chooseScope('feed'); page.openArticle(first);
  assert.equal(page.onBackPress(), true, 'explicitly remove the last reader in split mode');
  assert.equal(page.readerPaths.size(), 0);
  new Function(leaving).call(page);
  assert.equal(page.paths.size(), 1);
  assert.equal(page.article, undefined);
  assert.equal(page.onBackPress(), true);
  assert.equal(page.paths.size(), 0);
});

for (const entering of [true, false]) {
  test(`a delayed fullscreen ${entering ? 'entry' : 'exit'} cannot overwrite the newer request`, async () => {
    const { page } = fullscreenPage();
    const current = page.context().testWindow;
    page.context = () => ({ testWindow: current });
    page.getUIContext = () => ({ postFrameCallback: callback => callback.onIdle() });
    if (!entering) await page.setReaderFullScreen(true);
    const bars = new Map();
    let layout = !entering;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let delayed = false;
    current.setSpecificSystemBarEnabled = async (name, enabled) => {
      bars.set(name, enabled);
      if (!delayed && name === 'navigation' && enabled === !entering) {
        delayed = true;
        await gate;
      }
    };
    current.setWindowLayoutFullScreen = async active => { layout = active; };
    const firstChange = page.setReaderFullScreen(entering);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(delayed, true);
    const lastChange = page.setReaderFullScreen(!entering);
    await new Promise(resolve => setImmediate(resolve));
    release();
    await Promise.all([firstChange, lastChange]);
    assert.equal(page.readerFullScreen, !entering);
    assert.equal(layout, !entering, 'window must agree with the last requested state');
    assert.equal(page.fullScreenWindowActive, !entering);
    assert.equal(bars.get('navigation'), entering);
    assert.equal(bars.get('navigationIndicator'), entering);
  });
}

test('a rejected fullscreen update does not prevent a subsequent exit', async () => {
  const { page } = fullscreenPage();
  const current = page.context().testWindow;
  page.context = () => ({ testWindow: current });
  page.getUIContext = () => ({ postFrameCallback: callback => callback.onIdle() });
  const bars = new Map();
  let fail = true;
  current.setSpecificSystemBarEnabled = async (name, enabled) => {
    if (fail) { fail = false; throw new Error('window update failed'); }
    bars.set(name, enabled);
  };
  let layout;
  current.setWindowLayoutFullScreen = async active => { layout = active; };
  await assert.rejects(page.setReaderFullScreen(true), /window update failed/);
  await page.setReaderFullScreen(false);
  assert.equal(layout, false);
  assert.equal(page.fullScreenWindowActive, false);
  assert.equal(bars.get('navigationIndicator'), true);
});

// Read the expressions used by the real empty-state UI, so these tests also cover wiring.
const emptyListMarkup = source.slice(source.indexOf('if (this.visible().length === 0)'), source.indexOf('LazyForEach(this.listData'));
const emptyListText = new Function('return ' + emptyListMarkup.match(/Text\(([\s\S]+?)\)\s*\.fontSize\(22\)/)[1]);
const emptyListAll = new Function('return ' + emptyListMarkup.match(/else if \(([^\n]+)\) \{\s*Button\('查看全部'/)[1]);
function emptyScope() {
  const page = setup(); page.ready = true;
  page.feeds = [{ id: 'feed', folder: '[]' }, { id: 'other', folder: '["其他"]' }];
  page.articles = [{ ...first, feedId: 'other', read: true }];
  return page;
}

test('an empty folder is not reported as read, with or without other subscriptions', () => {
  const page = emptyScope(); page.selectedFolder = '["空文件夹"]';
  for (const feeds of [page.feeds, []]) {
    page.feeds = feeds;
    assert.equal(emptyListText.call(page), '此文件夹还没有订阅');
    assert.equal(emptyListAll.call(page), false);
  }
});

test('an undownloaded feed has no misleading read-complete message or ineffective show-all action', () => {
  const page = emptyScope(); page.selectedFeed = 'feed';
  assert.equal(page.visible().length, 0);
  assert.equal(emptyListText.call(page), '这里暂时没有文章');
  assert.equal(emptyListAll.call(page), false, 'read articles in another feed do not count');
  page.articles = [{ ...first, read: true }];
  assert.equal(emptyListText.call(page), '已经读完了');
  assert.equal(emptyListAll.call(page), true);
  page.showRead = true;
  assert.equal(page.visible().length, 1, 'the offered action must reveal an article');
});

test('folder show-all only considers read articles from that folder', () => {
  const page = emptyScope(); page.selectedFolder = '[]';
  assert.equal(emptyListText.call(page), '这里暂时没有文章');
  assert.equal(emptyListAll.call(page), false);
  page.articles.push({ ...second, read: true });
  assert.equal(emptyListText.call(page), '已经读完了');
  assert.equal(emptyListAll.call(page), true);
});

test('today and starred empty states offer show-all only for matching saved articles', () => {
  const page = emptyScope();
  const yesterday = page.calendarDay - 1;
  page.articles = [{ ...first, read: true, published: yesterday }];
  page.filter = '今天';
  assert.equal(emptyListText.call(page), '今天还没有新文章');
  assert.equal(emptyListAll.call(page), false);
  const day = new Date(page.calendarDay);
  page.articles = [{ ...first, read: true, published: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() }];
  assert.equal(emptyListAll.call(page), false, 'tomorrow is outside today');
  page.articles = [{ ...first, read: true, published: page.calendarDay }];
  assert.equal(emptyListText.call(page), '今天没有未读文章');
  assert.equal(emptyListAll.call(page), true);
  page.filter = '星标';
  assert.equal(emptyListText.call(page), '喜欢的文章可以留在这里');
  assert.equal(emptyListAll.call(page), false);
  page.articles = [{ ...first, read: true, starred: true }];
  assert.equal(emptyListText.call(page), '没有未读的星标文章');
  assert.equal(emptyListAll.call(page), true);
});

test('loading and search empty states do not offer show-all, and whitespace is not a query', () => {
  const page = emptyScope(); page.articles = [{ ...first, read: true }];
  page.ready = false;
  assert.equal(emptyListText.call(page), '正在打开…');
  assert.equal(emptyListAll.call(page), false);
  page.ready = true; page.searchPending = true;
  assert.equal(emptyListText.call(page), '正在搜索…');
  assert.equal(emptyListAll.call(page), false);
  page.searchPending = false; page.query = 'missing';
  assert.equal(emptyListText.call(page), '没有找到相关文章');
  assert.equal(emptyListAll.call(page), false);
  page.query = '   ';
  assert.equal(emptyListText.call(page), '已经读完了');
  assert.equal(emptyListAll.call(page), true);
  page.showRead = true; page.articles = [];
  assert.equal(emptyListText.call(page), '这里暂时没有文章');
  assert.equal(emptyListAll.call(page), false);
  page.feeds = [];
  assert.equal(emptyListText.call(page), '从一个喜欢的网站开始');
});

test('empty refresh scopes disable the menu and pull gesture despite feeds elsewhere', () => {
  const page = emptyScope(); page.selectedFolder = '["空文件夹"]';
  assert.equal(page.readingMenus().find(item => item.value === '刷新').isEnabled, false);
  const list = source.slice(source.indexOf('  readingList()'), source.indexOf('  feedMenu('));
  const pull = new Function('return ' + list.match(/\.pullToRefresh\(([^\n]+)\)/)[1]);
  assert.equal(pull.call(page), false);
  page.selectedFolder = '[]';
  assert.equal(page.readingMenus().find(item => item.value === '刷新').isEnabled, true);
  assert.equal(pull.call(page), true);
  page.selectedFeed = 'other';
  assert.equal(page.readingMenus().find(item => item.value === '刷新').isEnabled, false, 'feed and folder must both match');
  page.selectedFolder = '';
  assert.equal(page.readingMenus().find(item => item.value === '刷新').isEnabled, true);
  page.selectedFeed = 'removed-feed';
  assert.equal(page.readingMenus().find(item => item.value === '刷新').isEnabled, false);
});

test('an empty refresh request is a quiet no-op and clears only idle pull state', async () => {
  const page = emptyScope(); let calls = 0; const messages = [];
  page.refresh = async () => { calls++; }; page.toast = text => messages.push(text);
  for (const [feed, folder] of [['','["空文件夹"]'], ['removed-feed',''], ['other','[]']]) {
    page.homeRefreshing = true; page.listRefreshing = true;
    await page.startRefresh(feed, folder);
    assert.equal(calls, 0);
    assert.equal(page.refreshing, false);
    assert.equal(page.homeRefreshing, false);
    assert.equal(page.listRefreshing, false);
    assert.deepEqual(messages, []);
  }
  await page.startRefresh('', '[]');
  assert.equal(calls, 1, 'an existing feed still refreshes even without articles');
});

test('switching to an empty folder does not cancel or retarget an active refresh', async () => {
  const page = emptyScope(); let finish; const requests = [];
  page.refresh = (feed,folder) => { requests.push([feed,folder]); return new Promise(resolve => { finish = resolve; }); };
  page.listRefreshing = true;
  const pending = page.startRefresh('', '[]');
  page.selectedFolder = '["空文件夹"]';
  await page.startRefresh('', page.selectedFolder);
  assert.equal(page.refreshing, true);
  assert.equal(page.listRefreshing, true);
  assert.deepEqual(requests, [['','[]']]);
  assert.equal(page.readingMenus().find(item => item.value === '刷新').isEnabled, false);
  finish(); await pending;
  assert.equal(page.refreshing, false);
  assert.equal(page.listRefreshing, false);
  page.selectedFolder = '[]';
  assert.equal(page.readingMenus().find(item => item.value === '刷新').isEnabled, true);
});

test('real refresh keeps its selected feed snapshot when navigation changes mid-request', async () => {
  const page = emptyScope();
  page.feeds = [{ id: 'scope-a1', folder: '[]' }, { id: 'scope-a2', folder: '[]' }, { id: 'scope-b', folder: '["其他"]' }];
  const fetched = [], saved = [], messages = []; let finish;
  feedRequests.set('scope-a1', () => { fetched.push('scope-a1'); return new Promise(resolve => { finish = resolve; }); });
  feedRequests.set('scope-a2', async () => { fetched.push('scope-a2'); return { unchanged: true }; });
  feedRequests.set('scope-b', async () => { fetched.push('scope-b'); return { unchanged: true }; });
  page.store.saveRefresh = async feed => { saved.push(feed.id); };
  page.store.error = async () => { assert.fail('refresh should not fail'); };
  page.reload = async () => {}; page.toast = text => messages.push(text);
  try {
    const pending = page.startRefresh('', '[]');
    page.selectedFolder = '["其他"]';
    finish({ unchanged: true }); await pending;
    assert.deepEqual(fetched, ['scope-a1','scope-a2']);
    assert.deepEqual(saved, fetched);
    assert.deepEqual(messages, ['已更新']);
  } finally { for (const id of ['scope-a1','scope-a2','scope-b']) feedRequests.delete(id); }
});

test('home pull refresh is disabled before load, without feeds, and during blocking work', () => {
  const page = emptyScope();
  const build = source.slice(source.indexOf('  build()'));
  const pull = new Function('return ' + build.match(/\.pullToRefresh\((.*?)\)\.onRefreshing/)[1]);
  assert.equal(pull.call(page), true);
  page.ready = false; assert.equal(pull.call(page), false); page.ready = true;
  page.busy = true; assert.equal(pull.call(page), false); page.busy = false;
  page.refreshing = true; assert.equal(pull.call(page), false); page.refreshing = false;
  page.feeds = []; assert.equal(pull.call(page), false);
});


for (const fails of [false, true]) {
  test(`fullscreen status ownership survives a theme ${fails ? 'rollback' : 'change'}`, async () => {
    const { page, changes, reloads } = fullscreenPage();
    const current = page.context().testWindow;
    const expression = source.match(/\.enableStatusBar\(([^\n]+), true\)/)[1];
    const status = new Function(`return ${expression};`);
    const frames = [];
    page.getUIContext = () => ({ postFrameCallback: callback => {
      frames.push(status.call(page)); callback.onIdle();
    } });
    page.context = () => ({ testWindow: current,
      getApplicationContext: () => ({ setColorMode: () => {} }) });
    page.appearance = { save: async () => { if (fails) throw new Error('save failed'); } };
    await page.setReaderFullScreen(true);
    assert.equal(status.call(page), false);
    await page.saveAppearance('light', 18);
    assert.deepEqual(frames, [undefined], 'release native ownership while configuration renders');
    assert.equal(status.call(page), false, 'reapply after configuration, even on preference rollback');
    assert.equal(page.savingAppearance, false);
    assert.equal(reloads(), 0);
    await page.setReaderFullScreen(false);
    assert.equal(status.call(page), undefined, 'restore native per-orientation policy on exit');
    assert.ok(!changes.some(([name]) => name === 'status'), 'window status override would overwrite the native restoration policy');
  });
}

test('footer reuses a surface for state changes and disposes it when the article changes', () => {
  const footerSource = readFileSync(new URL('../entry/src/main/ets/reader/ReaderFooter.ets', import.meta.url), 'utf8');
  const nodes = [];
  class BuilderNode {
    constructor(_context, options) { this.options = options; this.disposed = 0; nodes.push(this); }
    build(_builder, params) { this.params = params; }
    update(params) { this.params = params; }
    getFrameNode() { return this; }
    dispose() { this.disposed++; }
    postTouchEvent(event) { return event === 'touch'; }
  }
  const Footer = runInNewContext(stripTypeScriptTypes(footerSource.slice(footerSource.indexOf('export class'))
    .replace('export class', 'class')) + '\nReaderFooter', {
    BuilderNode, NodeController: class { rebuild() {} }, NodeRenderType: { RENDER_TYPE_TEXTURE: 1 },
    wrapBuilder: builder => builder, readerFooterBuilder() {},
  });
  const footer = new Footer();
  assert.equal(footer.makeNode({}), null); assert.equal(footer.postTouch('touch'), false);
  footer.setSurface('first', { title: 'A' }); const firstNode = footer.makeNode({});
  footer.update({ title: 'B' }); assert.equal(footer.makeNode({}), firstNode);
  assert.equal(firstNode.params.title, 'B'); assert.equal(footer.postTouch('touch'), true);
  footer.setSurface('second', { title: 'C' }); const secondNode = footer.makeNode({});
  assert.notEqual(secondNode, firstNode); assert.equal(firstNode.disposed, 1);
  footer.clear(); assert.equal(secondNode.disposed, 1); assert.equal(footer.makeNode({}), null);
  assert.equal(footer.postTouch('touch'), false);
});

test('large system fonts reserve readable native columns instead of retaining a cramped sidebar', () => {
  const page = setup();
  page.systemFontScale = 1; page.resizeWindow(1002);
  assert.equal(page.hasLibrarySidebar(), true);
  assert.equal(page.listPaneWidth(), 320);
  page.resizeWindow(1001); assert.equal(page.hasLibrarySidebar(), false);
  page.systemFontScale = 1.75; page.resizeWindow(1440);
  assert.equal(page.hasLibrarySidebar(), true);
  assert.equal(page.libraryPaneWidth(), 420);
  assert.equal(page.listPaneWidth(), 560);
  page.systemFontScale = 3.2; page.onFontScaleChange();
  assert.equal(page.hasLibrarySidebar(), false);
  assert.equal(page.listPaneWidth(), 896);
  assert.equal(page.libraryPaneWidth(), 896, 'the drawer covers the list column instead of exposing a sliver of it');
  page.resizeWindow(460);
  assert.equal(page.libraryPaneWidth(), 412, 'drawer leaves room to dismiss on a narrow screen');
});

test('font-driven layout changes preserve the active document and close a redundant drawer', () => {
  const page = setup(); page.resizeWindow(1440); page.systemFontScale = 3.2;
  page.chooseScope('feed'); page.openArticle(first); page.libraryDrawer = true;
  let loads = 0; page.loadReader = () => { loads++; };
  page.systemFontScale = 1; page.onFontScaleChange();
  assert.equal(page.libraryDrawer, false);
  assert.equal(page.article.id, 'a'); assert.equal(page.readerPaths.size(), 1);
  assert.equal(loads, 0);
});

test('font configuration observation initializes, follows changes and unregisters its own listener', async () => {
  const page = setup(); page.opened = true;
  page.getUIContext = () => ({});
  let callback; const removals = [];
  page.context = () => ({ config: { fontSizeScale: 1.75 }, getApplicationContext: () => ({
    on(name, value) { assert.equal(name, 'environment'); callback = value; return 0; },
    async off(name, id) { removals.push([name, id]); }
  }) });
  page.aboutToAppear(); assert.equal(page.systemFontScale, 1.75);
  callback.onConfigurationUpdated({ fontSizeScale: 3.2 }); assert.equal(page.systemFontScale, 3.2);
  callback.onConfigurationUpdated({ colorMode: 0 }); assert.equal(page.systemFontScale, 3.2);
  page.aboutToDisappear(); page.aboutToDisappear();
  assert.deepEqual(removals, [['environment', 0]]);
});

test('search-scoped bulk read and undo preserve refreshed arrivals, other feeds and the reader queue', async () => {
  const page = setup();
  const folder = '["Work"]';
  const feeds = [{ id: 'feed', title: 'Source', folder }, { id: 'outside', title: 'Other', folder: '[]' }];
  const rows = [
    { ...first, title: 'needle first' },
    { ...second, title: 'needle next', starred: true },
    { ...first, id: 'read-before', title: 'needle already read', read: true },
    { ...first, id: 'non-match', title: 'unrelated' },
    { ...first, id: 'other-feed', feedId: 'outside', title: 'needle outside' },
  ];
  let writes = 0;
  let failWrite = false;
  page.store = {
    subscriptions: async () => feeds.map(feed => ({ ...feed })),
    folders: async () => [folder],
    articles: async () => rows.map(row => ({ ...row })),
    setState: async (id, kind, value) => { rows.find(row => row.id === id)[kind === 'star' ? 'starred' : 'read'] = value; },
    setReadStates: async (ids, value) => {
      if (failWrite) throw new Error('disk write failure');
      writes++;
      for (const id of ids) rows.find(row => row.id === id).read = value;
    },
  };
  let dialog;
  page.getUIContext = () => ({ showAlertDialog: value => { dialog = value; }, postFrameCallback: () => {} });
  page.listScroller.getItemRect = () => ({ y: 0, height: 0 });
  page.toast = () => {};
  let loads = 0; page.loadReader = () => { loads++; };
  await page.reload(); page.chooseScope('', folder); page.query = 'needle'; page.syncList(); await searchIdle(page);
  page.openArticle(page.visible()[0]); await page.markRead();
  assert.equal(page.nextUnread().id, 'b');
  page.confirmMarkAllRead();
  assert.match(dialog.message, /Work · 当前搜索结果.*1 篇/);
  dialog.primaryButton.action(); assert.equal(writes, 0, 'cancel never mutates state');
  page.confirmMarkAllRead(); const confirm = dialog.secondaryButton.action;
  rows.unshift({ ...first, id: 'arrived', title: 'needle arrived' });
  await page.reload(); page.syncList(); await searchIdle(page);
  confirm(); await idle(page); page.syncList(); await searchIdle(page);
  assert.equal(page.article.id, 'a'); assert.equal(page.article.read, true);
  assert.equal(page.nextUnread(), undefined, 'the original reading queue is exhausted');
  assert.deepEqual(Array.from(page.visible(), row => row.id), ['arrived', 'a'], 'only the article being read outlasts the bulk read');
  assert.equal(page.unread('feed'), 2, 'new arrival and non-match stay unread');
  assert.equal(page.unread('outside'), 1);
  assert.deepEqual(Array.from(page.undoReadIds), ['b']);
  failWrite = true;
  await assert.rejects(page.undoMarkAllRead(), /disk write failure/);
  assert.deepEqual(Array.from(page.undoReadIds), ['b'], 'failed undo remains retryable');
  assert.equal(rows.find(row => row.id === 'b').read, true);
  failWrite = false;
  await page.undoMarkAllRead(); page.syncList(); await searchIdle(page);
  assert.equal(page.nextUnread().id, 'b'); assert.equal(page.nextUnread().starred, true);
  assert.equal(page.article.read, true, 'automatic read preceding the bulk operation is retained');
  assert.equal(rows.find(row => row.id === 'read-before').read, true);
  assert.equal(page.unread('feed'), 3); assert.equal(page.unread('outside'), 1);
  assert.equal(loads, 0, 'bulk read and undo must not reload the open document');
  page.openNextUnread(); assert.equal(page.article.id, 'b'); assert.equal(loads, 1);
});

test('refresh updates queued article content without changing the current document or queue order', async () => {
  const page = setup();
  const loaded = [];
  page.loadReader = () => { loaded.push({ ...page.article }); };
  page.chooseScope('feed'); page.openArticle(first); await page.markRead();
  const rows = await page.store.articles();
  Object.assign(rows[0], { title: 'Current updated remotely', content: '<p>Current new body</p>' });
  Object.assign(rows[1], { title: 'Next updated', content: '<p>New next body</p>',
    link: 'https://example.org/new', author: 'New author', published: 10, language: 'en-US' });
  page.store.articles = async () => [{ ...first, id: 'new-arrival' }, ...rows.map(row => ({ ...row }))];
  await page.reload(); page.syncReaderFooter();
  assert.equal(page.article.title, 'A', 'do not mutate the open document metadata behind the reader');
  assert.equal(page.article.content, '<p>A</p>');
  assert.deepEqual(Array.from(page.readingQueue, row => row.id), ['a', 'b'], 'freeze order and membership only');
  assert.equal(page.readerFooter.params.title, 'Next updated');
  assert.equal(loaded.length, 0, 'background refresh cannot reload the current document');
  page.openNextUnread();
  assert.equal(loaded[0].title, 'Next updated');
  assert.equal(loaded[0].content, '<p>New next body</p>');
  assert.equal(loaded[0].link, 'https://example.org/new');
  assert.equal(loaded[0].author, 'New author');
  assert.equal(loaded[0].published, 10);
  assert.equal(loaded[0].language, 'en-US');
});

function pendingSubscription(stage, icon = '') {
  const page = new Index();
  const address = 'https://pending.example.org/feed.json';
  const gate = Promise.withResolvers();
  const reached = Promise.withResolvers();
  const feeds = [{ id: 'feed', title: 'Existing', folder: '[]' }];
  let articles = [{ ...first }];
  const toasts = [];
  page.toast = message => toasts.push(message);
  page.getUIContext = () => ({ postFrameCallback() {} });
  page.listScroller.getItemRect = () => ({ y: 0, height: 0 });
  page.feeds = feeds.slice(); page.articles = articles.slice();
  page.article = { ...first }; page.selectedFeed = 'feed';
  page.readingQueue = articles.slice();
  page.paths.pushPath({ name: 'articles' }); page.readerPaths.pushPath({ name: 'article' });
  const wait = async point => {
    if (point === stage) { reached.resolve(); await gate.promise; }
  };
  page.store = {
    saveRefresh: async (_feed, parsed) => { articles = [...articles, ...parsed.articles]; },
    saveSubscriptions: async items => {
      await wait('save');
      feeds.push({ id: items[0].url, title: items[0].title, folder: '[]' });
    },
    subscriptions: async () => { await wait('reload'); return feeds.slice(); },
    folders: async () => [],
    articles: async () => articles.slice(),
  };
  page.icons = { update: async () => { await wait('icons'); return icon; }, cached: () => '' };
  feedRequests.set(address, async () => ({ url: address, etag: '', modified: '', source: JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1', title: 'New subscription',
    items: [{ id: 'new', title: 'New article', content_text: 'New body' }],
  }) }));
  page.openSheet('添加订阅'); page.address = address;
  const pending = page.run(() => page.add(address));
  return { page, address, gate, reached: reached.promise, pending, feeds, toasts };
}

for (const stage of ['save', 'reload']) {
  test(`subscription completion after ${stage} preserves a newer sheet, input or reading context`, async () => {
    for (const change of ['unchanged', 'edit', 'close', 'reopen', 'switch']) {
      const { page, address, gate, reached, pending, feeds, toasts } = pendingSubscription(stage);
      await reached;
      if (change === 'edit') { page.address = 'https://replacement.example.org/'; page.invalidateLookup(); page.sheetMessage = ''; }
      if (change === 'close') { page.showSheet = false; page.paths.pushPath({ name: 'settings' }); }
      if (change === 'reopen') { page.showSheet = false; page.openSheet('添加订阅'); page.address = 'https://replacement.example.org/'; }
      if (change === 'switch') { page.openSheet('新建文件夹'); page.folderName = 'New folder'; }
      const before = { address: page.address, sheet: page.sheet, show: page.showSheet, message: page.sheetMessage,
        paths: Array.from(page.paths.getAllPathName()) };
      gate.resolve(); await pending;
      assert.equal(feeds.filter(f => f.id === address).length, 1, `${stage}/${change}: save completes once`);
      assert.equal(page.busy, false);
      assert.deepEqual(toasts, ['已添加 New subscription · 1 篇']);
      if (change === 'unchanged') {
        assert.equal(page.showSheet, false); assert.equal(page.address, '');
        assert.equal(page.selectedFeed, address); assert.equal(page.article, undefined);
      } else {
        assert.equal(page.showSheet, before.show, `${stage}/${change}: preserve sheet visibility`);
        assert.equal(page.address, before.address, `${stage}/${change}: preserve new input`);
        assert.equal(page.sheet, before.sheet); assert.equal(page.sheetMessage, before.message);
        assert.deepEqual(Array.from(page.paths.getAllPathName()), before.paths);
        assert.equal(page.selectedFeed, 'feed'); assert.equal(page.article.id, first.id);
        assert.equal(page.readerPaths.size(), 1);
        if (change === 'switch') assert.equal(page.folderName, 'New folder');
      }
      feedRequests.delete(address);
    }
  });
}

test('late subscription save failure reports the result without contaminating a replacement sheet', async () => {
  for (const change of ['unchanged', 'reopen', 'switch']) {
    const { page, address, gate, reached, pending, feeds, toasts } = pendingSubscription('save');
    await reached;
    if (change === 'reopen') { page.openSheet('添加订阅'); page.address = 'https://replacement.example.org/'; }
    if (change === 'switch') { page.openSheet('新建文件夹'); page.folderName = 'Keep me'; }
    gate.reject(new Error('订阅保存失败')); await pending;
    assert.equal(feeds.length, 1); assert.equal(page.busy, false); assert.equal(page.showSheet, true);
    assert.equal(page.article.id, first.id);
    if (change === 'unchanged') {
      assert.equal(page.sheetMessage, '订阅保存失败'); assert.equal(page.sheetError, true); assert.deepEqual(toasts, []);
    } else {
      assert.equal(page.sheetMessage, ''); assert.equal(page.sheetError, false);
      assert.deepEqual(toasts, ['订阅保存失败']);
    }
    feedRequests.delete(address);
  }
});

test('switching away from an in-flight lookup prevents its candidates appearing in another sheet', async () => {
  const page = new Index(); const address = 'https://lookup.example.org/';
  const gate = Promise.withResolvers();
  feedRequests.set(address, () => gate.promise);
  page.openSheet('添加订阅');
  const pending = page.run(() => page.add(address));
  page.openSheet('新建文件夹'); page.folderName = 'Keep me';
  gate.resolve({ url: address, source: '<html><link rel="alternate" type="application/rss+xml" href="/feed"></html>' });
  await pending;
  assert.equal(page.sheetMessage, ''); assert.equal(page.candidates.length, 0);
  assert.equal(page.folderName, 'Keep me'); assert.equal(page.showSheet, true);
  feedRequests.delete(address);
});

test('an operation started outside a sheet does not put its failure into a newly opened add form', async () => {
  const page = new Index(); const gate = Promise.withResolvers(); const toasts = [];
  page.toast = message => toasts.push(message);
  const pending = page.run(() => gate.promise);
  page.openSheet('添加订阅'); page.address = 'https://keep.example.org/';
  gate.reject(new Error('Export failed')); await pending;
  assert.equal(page.sheetMessage, ''); assert.equal(page.sheetError, false);
  assert.equal(page.address, 'https://keep.example.org/'); assert.equal(page.showSheet, true);
  assert.deepEqual(toasts, ['操作未完成，请重试']);
});

// Run the callbacks wired to native folder input and move rows, including the old inline move implementation.
const editFolder = runInNewContext(stripTypeScriptTypes('(function(value: string) {' +
  source.match(/\.onChange\(\(value: string\) => \{\s*(this\.folderName[^}]+)\}\)/)[1] + '})'));
const moveFolder = runInNewContext(stripTypeScriptTypes('(function(folder: string) {' +
  source.match(/\.accessibilityText\(`移到\$\{this\.folderTitle\(folder\)\}`\)\.onClick\(\(\) => \{([\s\S]*?)\n              \}\)/)[1] + '})'));

function pendingFolderOperation(operation, stage) {
  const page = new Index(); const gate = Promise.withResolvers(); const reached = Promise.withResolvers();
  const savedFolders = []; const writes = []; const toasts = [];
  const feeds = [{ id: 'feed', title: 'Existing', folder: '[]' }, { id: 'other', title: 'Other', folder: '[]' }];
  page.feeds = feeds.map(f => ({ ...f })); page.article = { ...first }; page.readingQueue = [{ ...first }];
  page.paths.pushPath({ name: 'articles' }); page.readerPaths.pushPath({ name: 'article' });
  page.toast = message => toasts.push(message);
  const wait = async point => { if (point === stage) { reached.resolve(); await gate.promise; } };
  page.store = {
    addFolder: async folder => { writes.push(folder); await wait('save'); savedFolders.push(folder); },
    moveFeed: async (id, folder) => { writes.push([id, folder]); await wait('save'); feeds.find(f => f.id === id).folder = folder; },
    subscriptions: async () => { await wait('reload'); return feeds.map(f => ({ ...f })); },
    folders: async () => savedFolders.slice(), articles: async () => [{ ...first }],
  };
  page.openSheet(operation === 'create' ? '新建文件夹' : '移动订阅');
  page.folderName = 'Original folder'; page.movingFeed = page.feeds[0];
  if (operation === 'create') page.createFolder(); else moveFolder.call(page, '["Destination"]');
  return { page, gate, reached: reached.promise, savedFolders, feeds, writes, toasts };
}

for (const operation of ['create', 'move']) {
  for (const stage of ['save', 'reload']) {
    test(`${operation} folder completion after ${stage} preserves the user's current context`, async () => {
      const changes = operation === 'create' ? ['unchanged', 'edit', 'close', 'reopen', 'switch'] : ['unchanged', 'close', 'reopen', 'switch'];
      for (const change of changes) {
        const { page, gate, reached, savedFolders, feeds, writes, toasts } = pendingFolderOperation(operation, stage);
        await reached;
        if (change === 'edit') editFolder.call(page, 'New draft');
        if (change === 'close') { page.showSheet = false; page.paths.pushPath({ name: 'settings' }); }
        if (change === 'reopen') {
          page.openSheet(operation === 'create' ? '新建文件夹' : '移动订阅');
          if (operation === 'create') editFolder.call(page, 'New draft'); else page.movingFeed = page.feeds[1];
        }
        if (change === 'switch') { page.openSheet('添加订阅'); page.address = 'https://keep.example.org/'; }
        const paths = Array.from(page.paths.getAllPathName());
        gate.resolve(); await idle(page);
        assert.equal(page.article.id, first.id); assert.equal(page.readerPaths.size(), 1);
        assert.deepEqual(Array.from(page.paths.getAllPathName()), paths);
        assert.equal(page.busy, false); assert.equal(writes.length, 1);
        if (operation === 'create') assert.deepEqual(savedFolders, ['["Original folder"]']);
        else { assert.equal(feeds[0].folder, '["Destination"]'); assert.equal(feeds[1].folder, '[]'); }
        assert.equal(page.showSheet, change !== 'unchanged' && change !== 'close', `${operation}/${stage}/${change}: preserve sheet`);
        if (change === 'unchanged' && operation === 'create') assert.equal(page.folderName, '');
        if (change === 'edit' || change === 'reopen' && operation === 'create') assert.equal(page.folderName, 'New draft');
        if (change === 'reopen' && operation === 'move') assert.equal(page.movingFeed.id, 'other');
        if (change === 'switch') assert.equal(page.address, 'https://keep.example.org/');
        assert.deepEqual(toasts, [operation === 'create' ? '文件夹已创建' : '订阅已移动']);
      }
    });
  }
}

test('folder save failures preserve the draft and remain scoped to the original input or move sheet', async () => {
  for (const operation of ['create', 'move']) {
    for (const change of ['unchanged', 'edit', 'reopen', 'switch']) {
      if (change === 'edit' && operation === 'move') continue;
      const { page, gate, reached, savedFolders, feeds, toasts } = pendingFolderOperation(operation, 'save');
      await reached;
      if (change === 'edit') editFolder.call(page, 'New draft');
      if (change === 'reopen') page.openSheet(operation === 'create' ? '新建文件夹' : '移动订阅');
      if (change === 'switch') { page.openSheet('添加订阅'); page.address = 'https://keep.example.org/'; }
      gate.reject(new Error('写入失败')); await idle(page);
      assert.equal(page.busy, false); assert.equal(page.showSheet, true);
      assert.deepEqual(savedFolders, []); assert.equal(feeds[0].folder, '[]');
      if (change === 'unchanged') { assert.equal(page.sheetMessage, '写入失败'); assert.equal(page.sheetError, true); assert.deepEqual(toasts, []); }
      else { assert.equal(page.sheetMessage, ''); assert.deepEqual(toasts, ['写入失败']); }
      if (operation === 'create') assert.equal(page.folderName, change === 'edit' ? 'New draft' : 'Original folder');
    }
  }
});

test('appearance preview updates the reader and selected controls before persistence completes', async () => {
  const page = setup(); const gate = Promise.withResolvers(); const writes = []; const modes = [];
  page.article = { ...first }; page.loaded = true; page.theme = 'dark'; page.fontSize = 18;
  page.openSheet('阅读设置');
  page.context = () => ({ getApplicationContext: () => ({ setColorMode: mode => modes.push(mode) }) });
  page.appearance = { save: value => { writes.push(value); return gate.promise; } };
  let reloads = 0; page.loadReader = () => reloads++;
  const pending = page.saveAppearance('light', 22);
  assert.equal(page.theme, 'light', 'Web and selected button must match the app theme during the save');
  assert.equal(page.fontSize, 22, 'font changes should preview without waiting for disk');
  assert.equal(page.savingAppearance, true); assert.deepEqual(modes, ['light']);
  await page.saveAppearance('dark', 24);
  assert.equal(writes.length, 1, 'pending persistence still prevents overlapping writes');
  gate.resolve(); await pending;
  assert.equal(page.savingAppearance, false); assert.equal(page.theme, 'light'); assert.equal(page.fontSize, 22);
  assert.equal(reloads, 0); assert.equal(page.article.id, first.id); assert.equal(page.loaded, true);
});

test('failed appearance saves roll back the preview without leaking errors into newer sheets', async () => {
  for (const change of ['unchanged', 'reopen', 'switch', 'close', 'from-settings']) {
    const page = setup(); const gate = Promise.withResolvers(); const modes = []; const toasts = [];
    page.theme = 'dark'; page.fontSize = 20; page.article = { ...first }; page.loaded = true;
    page.toast = message => toasts.push(message);
    page.context = () => ({ getApplicationContext: () => ({ setColorMode: mode => modes.push(mode) }) });
    page.appearance = { save: () => gate.promise };
    let reloads = 0; page.loadReader = () => reloads++;
    if (change !== 'from-settings') page.openSheet('阅读设置');
    const pending = page.saveAppearance('light', 24);
    if (change === 'reopen' || change === 'from-settings') page.openSheet('阅读设置');
    if (change === 'switch') { page.openSheet('添加订阅'); page.address = 'https://keep.example.org/'; }
    if (change === 'close') page.showSheet = false;
    // Navigating to another article while a settings write is pending must remain safe.
    page.article = { ...second };
    gate.reject(new Error('disk full')); await pending;
    assert.deepEqual(modes, ['light', 'dark']);
    assert.equal(page.theme, 'dark'); assert.equal(page.fontSize, 20); assert.equal(page.savingAppearance, false);
    assert.equal(page.article.id, second.id); assert.equal(page.loaded, true); assert.equal(reloads, 0);
    if (change === 'unchanged') {
      assert.equal(page.sheetMessage, '设置未能保存，请重试'); assert.equal(page.sheetError, true); assert.deepEqual(toasts, []);
      page.appearance = { save: async () => {} };
      const retry = page.saveAppearance('light', 24);
      assert.equal(page.sheetMessage, '', 'retry clears the previous failure');
      assert.equal(page.sheetError, false);
      await retry; assert.equal(page.theme, 'light'); assert.equal(page.fontSize, 24);
    } else {
      assert.equal(page.sheetMessage, ''); assert.equal(page.sheetError, false);
      assert.deepEqual(toasts, ['设置未能保存，请重试']);
      if (change === 'switch') assert.equal(page.address, 'https://keep.example.org/');
    }
  }
});

test('adding a saved subscription finishes before its icon arrives and late publication preserves the new sheet', async () => {
  const { page, gate, reached, pending, address, feeds, toasts } = pendingSubscription('icons', 'new-icon');
  await reached; await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(page.busy, false, 'optional artwork must not keep the add operation busy');
    assert.equal(page.showSheet, false); assert.equal(page.selectedFeed, address);
    assert.equal(feeds.filter(f => f.id === address).length, 1);
    assert.deepEqual(toasts, ['已添加 New subscription · 1 篇']);
    page.openSheet('添加订阅'); page.address = 'https://keep.example.org/';
  } finally { gate.resolve(); await pending; feedRequests.delete(address); }
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.showSheet, true); assert.equal(page.address, 'https://keep.example.org/');
  assert.equal(page.feeds.find(f => f.id === address).icon, 'new-icon');
});

test('refresh publishes every feed and ends its spinner while optional icons are still pending', async () => {
  const page = new Index(); const iconGate = Promise.withResolvers(); const iconStarted = Promise.withResolvers();
  const icons = []; const errors = []; const toasts = []; const articles = [];
  const feeds = ['a', 'b'].map(id => ({ id: `https://${id}.example/feed`, title: id, folder: '[]', site: '', icon: 'cached', error: '' }));
  page.feeds = feeds.slice(); page.ready = true; page.toast = value => toasts.push(value);
  page.store = {
    saveRefresh: async (_feed, parsed) => articles.push(...parsed.articles),
    error: async (...args) => errors.push(args),
    subscriptions: async () => feeds.map(f => ({ ...f })), folders: async () => [], articles: async () => articles.slice(),
  };
  page.icons = { cached: () => 'cached', update: async (...args) => {
    icons.push(args); iconStarted.resolve(); await iconGate.promise; throw new Error('icon unavailable');
  } };
  for (const feed of feeds) feedRequests.set(feed.id, async () => ({ url: feed.id, etag: '', modified: '', source: JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1', title: feed.title, home_page_url: feed.id.replace('/feed', '/'),
    favicon: '/icon.png', items: [{ id: feed.id, title: `New ${feed.title}`, content_text: 'New content' }],
  }) }));
  const pending = page.startRefresh();
  await iconStarted.promise; await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(page.refreshing, false, 'content refresh should finish before artwork');
    assert.equal(page.articles.length, 2); assert.deepEqual(toasts, ['已更新']);
    assert.equal(icons.length, 2);
    assert.equal(icons[0][2], 'https://a.example/icon.png'); assert.equal(icons[0][3], true);
  } finally { iconGate.resolve(); await pending; for (const feed of feeds) feedRequests.delete(feed.id); }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, [], 'an icon failure is not a feed failure');
  assert.ok(page.feeds.every(f => f.icon === 'cached'));
});

test('one failed startup icon leaves its cached image and does not stop later icons', async () => {
  const page = new Index(); const calls = [];
  page.feeds = [{ id: 'a', site: '', icon: 'cached-a' }, { id: 'b', site: '', icon: '' }];
  page.icons = { update: async id => { calls.push(id); if (id === 'a') throw new Error('unavailable'); return 'new-b'; } };
  await page.loadIcons();
  assert.deepEqual(calls, ['a', 'b']);
  assert.equal(page.feedIcon('a'), 'cached-a'); assert.equal(page.feedIcon('b'), 'new-b');
});

test('publishing 100 new icons does not rescan or reposition a scrolled 10,000-article list', async (t) => {
  const page = new Index(); let idReads = 0; let feedReads = 0; let publications = 0; let scrolls = 0;
  page.feeds = Array.from({ length: 100 }, (_, i) => ({ id: `feed-${i}`, folder: '["News"]', icon: '', site: '' }));
  page.articles = Array.from({ length: 10_000 }, (_, i) => ({
    ...first, get id() { idReads++; return `article-${i}`; }, get feedId() { feedReads++; return `feed-${i % 100}`; },
  }));
  page.paths.pushPath({ name: 'articles' });
  page.getUIContext = () => ({ postFrameCallback: frame => frame.onIdle() });
  page.listScroller = { getItemRect: () => ({ y: -12, height: 100 }), scrollToIndex: () => scrolls++ };
  page.syncList(); assert.equal(page.unread(), 10_000); page.listFirstVisible = 30;
  const rows = page.visible(); let feeds = page.feeds;
  Object.defineProperty(page, 'feeds', { get: () => feeds, set: value => {
    feeds = value; publications++; page.syncList(); assert.equal(page.unread(), 10_000);
  } });
  page.icons = { update: async id => `new-${id}` };
  idReads = 0; feedReads = 0; const start = performance.now();
  await page.loadIcons();
  t.diagnostic(JSON.stringify({ publications, idReads, feedReads, scrolls, elapsedMs: +(performance.now() - start).toFixed(2) }));
  assert.equal(publications, 100, 'new icons still publish');
  assert.equal(idReads, 0, 'unchanged article rows need no new keys or scroll anchors');
  assert.equal(feedReads, 0, 'icon changes do not affect filtering or unread counts');
  assert.equal(scrolls, 0, 'metadata alone must not schedule a scroll restoration');
  assert.equal(page.visible(), rows);
  assert.equal(page.feedIcon('feed-99'), 'new-feed-99');
});

test('metadata cache preserves rows but still invalidates membership, folders, article state and calendar counts', () => {
  const page = new Index(); const day = page.calendarDay;
  page.feeds = [{ id: 'a', title: 'A', folder: '["News"]' }, { id: 'b', folder: '["News"]' }, { id: 'c', folder: '["Tech"]' }];
  page.articles = [
    { ...first, id: 'a1', feedId: 'a', starred: true, published: day + 1000 },
    { ...first, id: 'a2', feedId: 'a', read: true, published: day + 1000 },
    { ...first, id: 'b1', feedId: 'b', published: day - 1000 },
    { ...first, id: 'c1', feedId: 'c', starred: true, published: day + 1000 },
    { ...first, id: 'd1', feedId: 'd', published: day + 1000 },
  ];
  page.selectedFolder = '["News"]';
  const ids = () => Array.from(page.visible(), a => a.id);
  assert.deepEqual(ids(), ['a1', 'b1']); const rows = page.visible();
  assert.equal(page.unread(), 3); assert.equal(page.unread('', '["News"]'), 2);
  assert.equal(page.collectionCount('星标'), 2); assert.equal(page.collectionCount('今天'), 2);
  page.feeds = page.feeds.map(f => ({ ...f, title: 'Updated', icon: 'new', error: 'HTTP 404', checked: 123 })).reverse();
  assert.equal(page.visible(), rows, 'presentation changes and feed order do not change article membership');
  assert.equal(page.feedTitle('a'), 'Updated'); assert.equal(page.feedIcon('a'), 'new'); assert.equal(page.unread(), 3);
  page.feeds = page.feeds.map(f => ({ ...f, folder: f.id === 'b' ? '["Tech"]' : f.folder }));
  assert.deepEqual(ids(), ['a1']); assert.equal(page.unread('', '["News"]'), 1); assert.equal(page.unread('', '["Tech"]'), 2);
  page.feeds = page.feeds.filter(f => f.id !== 'a');
  assert.deepEqual(ids(), []); assert.equal(page.unread(), 2); assert.equal(page.collectionCount('星标'), 1);
  page.feeds = page.feeds.map(f => ({ ...f, id: f.id === 'c' ? 'd' : f.id }));
  assert.equal(page.unread(), 2); assert.equal(page.collectionCount('星标'), 0); assert.equal(page.collectionCount('今天'), 1);
  page.selectedFolder = '["Tech"]'; assert.deepEqual(ids(), ['b1', 'd1']);
  page.articles = page.articles.map(a => ({ ...a, read: a.id === 'b1' || a.read }));
  assert.deepEqual(ids(), ['d1']); assert.equal(page.unread(), 1);
  page.calendarDay = day + 86400000; assert.equal(page.collectionCount('今天'), 0);
});

// Extract the actual PasteButton callback; platform authorization stays outside this host test.
function pasteCallback(getData) {
  const body = source.slice(source.indexOf('          PasteButton()'), source.indexOf("          Button('查找订阅')"))
    .match(/\.onClick\(\(_event: ClickEvent, result: PasteButtonOnClickResult\) => \{([\s\S]*)\n          \}\)/)[1];
  return runInNewContext(stripTypeScriptTypes('(function(result: number) {' + body + '})'), {
    PasteButtonOnClickResult: { SUCCESS: 0 },
    pasteboard: { getSystemPasteboard: () => ({ getData }) },
  });
}
const editAddress = runInNewContext(stripTypeScriptTypes('(function(value: string) {' +
  source.match(/\.onChange\(\(value: string\) => \{\s*(this\.address[^}]+)\}\)/)[1] + '})'));

test('late clipboard content cannot replace edited, closed, reopened or switched form state', async () => {
  for (const content of ['https://clipboard.example.org/feed', 'not a URL']) {
    for (const change of ['edit', 'close', 'reopen', 'switch']) {
      const page = setup(); const gate = Promise.withResolvers(); page.toast = () => {};
      page.openSheet('添加订阅'); page.address = 'https://original.example.org/';
      pasteCallback(() => gate.promise).call(page, 0); assert.equal(page.busy, true);
      if (change === 'edit') editAddress.call(page, 'https://new.example.org/');
      if (change === 'close') page.showSheet = false;
      if (change === 'reopen') { page.showSheet = false; page.openSheet('添加订阅'); editAddress.call(page, 'https://new.example.org/'); }
      if (change === 'switch') { page.openSheet('新建文件夹'); page.folderName = 'Keep folder'; }
      const expected = [page.address, page.addressRevision, page.sheet, page.showSheet, page.folderName];
      page.candidates = ['https://keep.example.org/feed']; page.sheetMessage = 'Keep current feedback';
      gate.resolve({ getPrimaryText: () => content }); await idle(page);
      assert.deepEqual([page.address, page.addressRevision, page.sheet, page.showSheet, page.folderName], expected, `${change}: ${content}`);
      assert.deepEqual(Array.from(page.candidates), ['https://keep.example.org/feed']);
      assert.equal(page.sheetMessage, 'Keep current feedback');
    }
  }
});

test('paste updates the original form once and invalid clipboard content preserves its draft', async () => {
  for (const valid of [true, false]) {
    const page = setup(); page.toast = () => {}; page.openSheet('添加订阅');
    page.address = 'https://draft.example.org/'; page.candidates = ['old'];
    const revision = page.addressRevision;
    pasteCallback(async () => ({ getPrimaryText: () => valid ? '  https://clipboard.example.org/feed  ' : 'plain text' })).call(page, 0);
    await idle(page);
    assert.equal(page.address, valid ? 'https://clipboard.example.org/feed' : 'https://draft.example.org/');
    assert.equal(page.addressRevision, revision + (valid ? 1 : 0));
    assert.deepEqual(Array.from(page.candidates), valid ? [] : ['old']);
    assert.equal(page.sheetMessage, valid ? '' : '剪贴板中没有网站地址');
    assert.equal(page.showSheet, true); assert.equal(page.busy, false);
  }
});

test('denied paste authorization never reads clipboard; read failure stays with its originating form', async () => {
  const page = setup(); const messages = []; page.toast = message => messages.push(message);
  page.openSheet('添加订阅'); page.address = 'https://draft.example.org/';
  pasteCallback(() => { assert.fail('denied paste must not read clipboard'); }).call(page, 1);
  assert.equal(page.busy, false); assert.equal(page.address, 'https://draft.example.org/');
  pasteCallback(async () => { throw new Error('clipboard unavailable'); }).call(page, 0);
  await idle(page); assert.equal(page.sheetMessage, '无法读取剪贴板，请重试'); assert.equal(page.sheetError, true);
  assert.equal(page.address, 'https://draft.example.org/'); assert.deepEqual(messages, []);
  const gate = Promise.withResolvers(); pasteCallback(() => gate.promise).call(page, 0);
  pasteCallback(() => { assert.fail('a pending read must not be duplicated'); }).call(page, 0);
  page.openSheet('新建文件夹'); page.folderName = 'Keep folder';
  gate.reject(new Error('clipboard unavailable')); await idle(page);
  assert.equal(page.sheetMessage, ''); assert.equal(page.folderName, 'Keep folder');
  assert.deepEqual(messages, ['无法读取剪贴板，请重试']);
});

function removableLibrary() {
  const page = new Index(); let dialog; const toasts = []; const writes = [];
  let feeds = [{ id: 'a', title: 'A', folder: '["A"]' }, { id: 'b', title: 'B', folder: '["B"]' }];
  let folders = ['["A"]', '["B"]'];
  const rows = [
    { ...first, id: 'a0', feedId: 'a', title: 'Earlier A' },
    { ...first, id: 'b0', feedId: 'b', title: 'Current B' },
    { ...first, id: 'b1', feedId: 'b', title: 'Next B' },
    { ...first, id: 'a1', feedId: 'a', title: 'Next A' },
  ];
  page.getUIContext = () => ({ showAlertDialog: value => { dialog = value; }, postFrameCallback() {} });
  page.toast = message => toasts.push(message); page.loadReader = () => {};
  page.store = {
    subscriptions: async () => feeds.map(f => ({ ...f })), folders: async () => folders.slice(),
    articles: async ids => rows.filter(row => ids.includes(row.feedId)).map(row => ({ ...row })),
    removeFeed: async id => { writes.push(id); feeds = feeds.filter(f => f.id !== id); },
    removeFolder: async folder => { writes.push(folder); folders = folders.filter(f => f !== folder); feeds = feeds.map(f => ({ ...f, folder: f.folder === folder ? '[]' : f.folder })); },
  };
  return { page, rows, writes, toasts, dialog: () => dialog };
}

test('removing an unrelated subscription or folder preserves the current list scope and document', async () => {
  for (const kind of ['feed', 'folder']) {
    const { page, rows, writes, dialog } = removableLibrary(); await page.reload();
    page.chooseScope(kind === 'feed' ? 'a' : '', kind === 'folder' ? '["A"]' : '');
    page.openArticle(rows[0]); const article = page.article; const paths = page.readerPaths;
    page.query = 'Earlier'; page.showRead = true;
    if (kind === 'feed') page.removeFeed(page.feeds[1]); else page.removeFolder('["B"]');
    dialog().primaryButton.action(); assert.equal(writes.length, 0);
    dialog().secondaryButton.action(); await idle(page);
    assert.equal(page.selectedFeed, kind === 'feed' ? 'a' : '');
    assert.equal(page.selectedFolder, kind === 'folder' ? '["A"]' : '');
    assert.equal(page.scopeTitle(), 'A'); assert.equal(page.query, 'Earlier'); assert.equal(page.showRead, true);
    assert.equal(page.article.id, article.id); assert.equal(page.article.content, article.content); assert.equal(page.readerPaths, paths);
    assert.equal(writes.length, 1);
  }
});

test('unsubscribed sources leave next-unread and footer while the current document preserves queue position', async () => {
  const { page, rows, dialog } = removableLibrary(); await page.reload();
  page.chooseScope(); page.openArticle(rows[1]); page.syncReaderFooter();
  assert.equal(page.readerFooter.params.title, 'Next B');
  const loaded = []; page.loadReader = () => loaded.push(page.article.id);
  page.removeFeed(page.feeds[1]); dialog().secondaryButton.action(); await idle(page); page.syncReaderFooter();
  assert.equal(page.article.id, 'b0'); assert.equal(page.article.content, rows[1].content); assert.deepEqual(loaded, []);
  assert.deepEqual(Array.from(page.readingQueue, row => row.id), ['a0', 'b0', 'b1', 'a1'], 'preserve the session order while skipping unsubscribed sources');
  assert.equal(page.nextUnread().id, 'a1', 'continue after the current position before wrapping');
  assert.equal(page.readerFooter.params.title, 'Next A');
  page.readerFooter.params.next(); assert.deepEqual(loaded, ['a1']);
  assert.equal(page.nextUnread().id, 'a0', 'wrap skips the retained current document from the removed feed');
});

test('removing the selected source exhausts only its existing reading queue', async () => {
  const { page, rows, dialog } = removableLibrary(); await page.reload(); page.chooseScope('b'); page.openArticle(rows[1]);
  page.removeFeed(page.feeds[1]); dialog().secondaryButton.action(); await idle(page); page.syncReaderFooter();
  assert.equal(page.selectedFeed, ''); assert.equal(page.article.id, 'b0');
  assert.equal(page.nextUnread(), undefined); assert.equal(page.readerFooter.params.title, '');
  page.openNextUnread(); assert.equal(page.article.id, 'b0');
});

test('late removal respects a newly chosen scope and a failed removal leaves the original scope intact', async () => {
  for (const kind of ['feed', 'folder']) for (const fail of [false, true]) {
    const { page, dialog, writes } = removableLibrary(); await page.reload();
    page.chooseScope(kind === 'feed' ? 'b' : '', kind === 'folder' ? '["B"]' : '');
    const gate = Promise.withResolvers(); const method = kind === 'feed' ? 'removeFeed' : 'removeFolder';
    const original = page.store[method]; page.store[method] = async target => { await gate.promise; await original(target); };
    if (kind === 'feed') page.removeFeed(page.feeds[1]); else page.removeFolder('["B"]');
    dialog().secondaryButton.action(); assert.equal(page.busy, true);
    if (fail) gate.reject(new Error('write failed'));
    else { page.chooseScope(kind === 'feed' ? 'a' : '', kind === 'folder' ? '["A"]' : ''); gate.resolve(); }
    await idle(page);
    assert.equal(page.scopeTitle(), fail ? 'B' : 'A'); assert.equal(writes.length, fail ? 0 : 1);
  }
});

test('empty reading lists reserve onboarding copy for layouts without a persistent library', () => {
  const page = setup(); page.ready = true; page.feeds = []; page.articles = [];
  for (const [width, scale, sidebar] of [[460, 1, false], [940, 1, false], [1440, 1, true], [1440, 3.2, false]]) {
    page.systemFontScale = scale; page.resizeWindow(width);
    assert.equal(page.hasLibrarySidebar(), sidebar);
    assert.equal(page.emptyListMessage(), sidebar ? '尚未添加订阅' : '从一个喜欢的网站开始');
  }
  page.systemFontScale = 1; page.resizeWindow(1440); page.query = 'needle';
  assert.equal(page.emptyListMessage(), '没有找到相关文章');
  page.query = ''; page.selectedFolder = '["Empty"]';
  assert.equal(page.emptyListMessage(), '此文件夹还没有订阅');
});

test('repeated next-unread queries do not rescan the current position deep in a large session', t => {
  const results = [];
  for (const position of [0, 5000, 9998, 9999]) {
    const page = setup(); const entries = Array.from({ length: 10000 }, (_, i) => ({ ...first, id: String(i) }));
    let reads = 0;
    page.readingQueue = new Proxy(entries, { get(target, key, receiver) {
      if (/^\d+$/.test(String(key))) reads++;
      return Reflect.get(target, key, receiver);
    } });
    page.article = entries[position]; const next = entries[(position + 1) % entries.length];
    assert.equal(page.nextUnread(), next); const initialReads = reads; reads = 0;
    for (let repeat = 0; repeat < 200; repeat++) assert.equal(page.nextUnread(), next);
    results.push({ position, initialReads, repeatedReads: reads });
  }
  t.diagnostic(JSON.stringify(results));
  assert.ok(results.every(result => result.repeatedReads <= 400), 'stable current positions must not be searched again for each render');
});

test('cached queue position follows reordered snapshots and live read/source changes without caching next content', () => {
  const page = setup(); page.feeds = [{ id: 'feed' }, { id: 'other' }];
  const a = { ...first, id: 'a' }; const b = { ...first, id: 'b', feedId: 'other' };
  const c = { ...first, id: 'c' }; const d = { ...first, id: 'd' };
  page.readingQueue = [a, b, c, d]; page.article = c; assert.equal(page.nextUnread(), d);
  page.readingQueue = [d, c, a, b]; assert.equal(page.nextUnread(), a);
  const updated = { ...a, title: 'Refreshed next title', content: 'New content' };
  page.readingQueue = [d, c, updated, b]; assert.equal(page.nextUnread(), updated);
  updated.read = true; assert.equal(page.nextUnread(), b);
  page.feeds = [{ id: 'feed' }]; assert.equal(page.nextUnread(), d);
  page.article = d; assert.equal(page.nextUnread(), c);
  page.readingQueue = []; assert.equal(page.nextUnread(), undefined);
  page.readingQueue = [a, b, c, d]; assert.equal(page.nextUnread(), a);
  page.article = { ...first, id: 'absent' }; assert.equal(page.nextUnread(), a);
});

test('state-only refresh keeps complete search results visible without decoding unchanged bodies', async t => {
  const page = setup(); page.query = 'needle';
  page.articles = Array.from({ length: 1000 }, (_, i) => ({ ...first, id: String(i), content: `<p>needle body ${i}</p>` }));
  page.syncList(); await searchIdle(page); assert.equal(page.listData.totalCount(), 1000);
  decodedBodies = 0;
  page.articles = page.articles.map((a, i) => ({ ...a, read: i === 0, starred: true, published: 123, link: 'https://changed.example', language: 'en' }));
  page.syncList();
  const immediate = { pending: page.searchPending, rows: page.listData.totalCount() };
  await searchIdle(page);
  t.diagnostic(JSON.stringify({ immediate, decodedBodies, finalRows: page.listData.totalCount() }));
  assert.deepEqual(immediate, { pending: false, rows: 999 });
  assert.equal(decodedBodies, 0); assert.equal(page.listData.getData(0).starred, true);
  assert.equal(page.listData.getData(0).link, 'https://changed.example');
});

test('refresh invalidates only changed search fields and removes retired cache entries', async t => {
  const page = setup(); page.query = 'base';
  page.articles = Array.from({ length: 5 }, (_, i) => ({ ...first, id: String(i), title: `base title ${i}`, author: `writer ${i}`, content: `<p>base body ${i}</p>` }));
  page.syncList(); await searchIdle(page); decodedBodies = 0;
  const old = page.articles;
  page.articles = [old[4], { ...old[0], title: 'replacement headline' }, { ...old[1], author: 'replacement author' },
    { ...old[2], content: '<p>replacement body</p>' }, { ...old[3], id: 'new', title: 'new source', content: '<p>new text</p>' }];
  page.syncList(); await searchIdle(page);
  t.diagnostic(JSON.stringify({ decodedBodies, plainEntries: page.plainText.size, searchEntries: page.searchText.size }));
  assert.equal(decodedBodies, 2, 'only changed body and new article need HTML decoding');
  assert.equal(page.plainText.has('3'), false); assert.equal(page.searchText.has('3'), false);
  assert.equal(page.plainText.size, 5); assert.equal(page.searchText.size, 5);
  for (const [query, ids] of [['replacement headline', ['0']], ['replacement author', ['1']], ['replacement body', ['2']],
    ['base title 0', []], ['writer 1', []], ['base body 2', []], ['new text', ['new']]]) {
    page.query = query; page.syncList(); assert.equal(page.searchPending, false);
    assert.deepEqual(Array.from(page.visible(), a => a.id), ids, query);
  }
});

test('snapshot replacement during partial indexing reuses valid work without letting the old task publish', async () => {
  const page = setup(); page.query = 'new match';
  page.articles = Array.from({ length: 500 }, (_, i) => ({ ...first, id: String(i), content: '<p>old match</p>' }));
  page.syncList(); await new Promise(resolve => setTimeout(resolve, 0));
  const retained = page.searchText.size; assert.ok(retained > 0 && retained <= 100);
  decodedBodies = 0;
  page.articles = page.articles.map((a, i) => i === 0 ? { ...a, content: '<p>new match</p>' } : { ...a });
  page.syncList(); await searchIdle(page);
  assert.deepEqual(Array.from(page.visible(), a => a.id), ['0']);
  assert.equal(decodedBodies, 500 - retained + 1);
  assert.equal(page.indexedArticles, page.articles);
  assert.equal(page.searchText.get('0').includes('old match'), false);
});


function captureReaderLoads(page) {
  const urls = [];
  page.web.loadData = html => urls.push('data:text/html;charset=UTF-8;base64,' + encodeURIComponent(Buffer.from(html).toString('base64')));
  return urls;
}

test('late native callbacks from the previous article cannot read or scroll the new selection', async () => {
  for (const callback of [readerPageEnd, readerPageVisible]) {
    let writes = 0; const page = setup(async () => writes++); const urls = captureReaderLoads(page);
    page.openArticle(first); page.loadReader(); const old = urls.at(-1);
    page.openArticle(second); const current = urls.at(-1);
    page.restoreScrollY = 512; const scrolls = []; page.web.scrollTo = (...args) => scrolls.push(args);
    callback(page, old); await idle(page);
    assert.equal(writes, 0); assert.equal(page.article.read, false);
    assert.equal(page.restoreScrollY, 512); assert.equal(scrolls.length, 0);
    callback(page, current); await idle(page);
    assert.equal(writes, 1); assert.equal(page.article.id, 'b'); assert.equal(page.article.read, true);
    readerPageEnd(page, current); await idle(page);
    assert.equal(page.restoreScrollY, 0); assert.equal(scrolls[0][1], 512);
  }
});

test('old main-frame errors cannot hide a newly selected document', () => {
  for (const name of ['onErrorReceive', 'onHttpErrorReceive']) {
    const page = setup(); const urls = captureReaderLoads(page);
    page.openArticle(first); page.loadReader(); const old = urls.at(-1);
    page.openArticle(second); page.readerChromeVisible = false;
    readerResourceError(page, name, true, old);
    assert.equal(page.readerError, false); assert.equal(page.readerChromeVisible, false);
    readerResourceError(page, name, false, urls.at(-1)); assert.equal(page.readerError, false);
    readerResourceError(page, name, true, urls.at(-1)); assert.equal(page.readerError, true);
  }
});

test('retry loads distinguish identical HTML and discard callbacks after the reader closes', async () => {
  const page = setup(); const urls = captureReaderLoads(page);
  page.openArticle(first); page.loadReader(); const old = urls.at(-1);
  page.failReader(); page.loadReader(); const current = urls.at(-1);
  readerPageVisible(page, old); await idle(page); assert.equal(page.article.read, false);
  readerPageVisible(page, current); await idle(page); assert.equal(page.article.read, true);
  page.closeArticle(); await idle(page);
  readerResourceError(page, 'onErrorReceive', true, current);
  assert.equal(page.readerError, false); assert.equal(page.article, undefined);
});

test('document ownership accepts history and encoded or raw data URLs without confusing retry prefixes', () => {
  const page = setup(); const urls = captureReaderLoads(page);
  page.openArticle(first); page.loadReader(); const old = urls.at(-1);
  for (let i = 0; i < 10; i++) page.loadReader();
  const current = urls.at(-1);
  assert.equal(page.isCurrentReaderDocument(old), false);
  assert.equal(page.isCurrentReaderDocument(current), true);
  assert.equal(page.isCurrentReaderDocument(decodeURIComponent(current)), true);
  assert.equal(page.isCurrentReaderDocument(page.readerDocumentUrl), true);
  assert.equal(page.isCurrentReaderDocument('data:text/html;base64,unrelated'), false);
});


function liveFoldingPage() {
  const page = setup(); const animations = [];
  page.article = first; page.windowWidth = 460;
  page.getUIContext = () => ({ createAnimator: options => {
    const animation = { options, played: false, cancelled: false,
      play() { this.played = true; }, cancel() { this.cancelled = true; } };
    animations.push(animation); return animation;
  } });
  return { page, animations };
}

test('fold width handoff expands the same reader without loading or stretching a snapshot', () => {
  const { page, animations } = liveFoldingPage();
  const article = page.article, web = page.web, paths = page.readerPaths;
  page.web.loadData = () => { assert.fail('folding must not reload the article'); };
  page.resizeWindow(940); assert.equal(animations.length, 0, 'ordinary rotation is not an unfold');
  for (let cycle = 0; cycle < 2; cycle++) {
    page.foldStatusChanged(2); page.resizeWindow(460); page.foldStatusChanged(3); page.resizeWindow(940);
    const animation = animations.at(-1);
    assert.equal(page.unfolding, true); assert.equal(animation.played, true);
    assert.equal(940 - page.unfoldNavWidth, 460, 'begin at the cover reader width');
    animation.onframe(0.5);
    assert.equal(940 - page.unfoldNavWidth, 560, 'grow the actual viewport, retaining glyph size');
    animation.onframe(1); animation.onfinish();
    assert.equal(page.unfolding, false); assert.equal(page.unfoldBlur, 0);
    assert.equal(page.article, article); assert.equal(page.web, web); assert.equal(page.readerPaths, paths);
  }
  assert.equal(animations.length, 2);
});

test('fold animation cancellation rejects late frames after navigation, resize, or motion changes', async () => {
  for (const stop of [page => page.foldStatusChanged(2), page => page.resizeWindow(800),
    page => page.onPageHide(), page => page.openSheet('阅读设置'), page => page.onFontScaleChange(),
    page => page.closeArticle(), page => page.reduceMotionChanged(true),
    page => page.setReaderFullScreen(true), page => page.setMediaFullScreen(true)]) {
    const { page, animations } = liveFoldingPage();
    page.updateWindowFullScreen = async () => {};
    page.foldStatusChanged(2); page.foldStatusChanged(3); page.resizeWindow(940);
    const animation = animations[0]; animation.onframe(0.25); await stop(page);
    const width = page.unfoldNavWidth;
    animation.onframe(0.75); animation.onfinish();
    assert.equal(animation.cancelled, true); assert.equal(page.unfolding, false);
    assert.equal(page.unfoldBlur, 0); assert.equal(page.unfoldNavWidth, width);
    await idle(page);
  }
});

test('unfold gating respects reduced motion, sheets, fullscreen, font space, and stale fold signals', () => {
  for (const prepare of [page => { page.article = undefined; }, page => { page.showSheet = true; },
    page => { page.mediaFullScreen = true; }, page => { page.fullScreenWindowActive = true; },
    page => { page.systemFontScale = 3.2; }, page => { page.foldSignalTime = Date.now() - 2000; },
    () => { reducedMotion = true; }]) {
    const { page, animations } = liveFoldingPage();
    page.foldStatusChanged(2); page.foldStatusChanged(3); prepare(page);
    try { page.resizeWindow(940); assert.equal(animations.length, 0); assert.equal(page.unfolding, false); }
    finally { reducedMotion = false; }
  }
  const { page, animations } = liveFoldingPage();
  page.foldStatusChanged(2); page.foldStatusChanged(3); page.foldSignalTime = Date.now() - 2000;
  page.resizeWindow(460); page.foldStatusChanged(1); page.resizeWindow(940);
  assert.equal(animations.length, 1, 'a slow physical fold can re-arm on the final expanded signal');
});

test('fold listeners resume from physical state and are removed on component destruction', () => {
  const { page, animations } = liveFoldingPage();
  const app = { on: () => 1, off: async () => {} };
  page.context = () => ({ config: {}, getApplicationContext: () => app }); page.opened = true;
  foldable = true; foldStatus = 2;
  try {
    page.aboutToAppear(); page.onPageShow();
    assert.equal(foldListeners.size, 1); assert.equal(motionListeners.size, 1);
    foldStatus = 3; foldListeners.get('foldStatusChange')(3); page.resizeWindow(940);
    assert.equal(animations.length, 1);
    page.aboutToDisappear();
    assert.equal(animations[0].cancelled, true); assert.equal(foldListeners.size, 0); assert.equal(motionListeners.size, 0);
  } finally { foldable = false; foldStatus = 2; page.onPageHide(); }
});

test('fullscreen unfolding grows the same document to the whole window, including wide inner screens', () => {
  for (const [width, scale] of [[940, 1], [1200, 1], [940, 3.2]]) {
    const { page, animations } = liveFoldingPage();
    page.readerFullScreen = true; page.fullScreenWindowActive = true; page.systemFontScale = scale;
    const article = page.article, web = page.web, paths = page.readerPaths;
    page.web.loadData = () => assert.fail('fullscreen unfolding must retain the loaded document');
    page.foldStatusChanged(2); page.foldStatusChanged(3); page.resizeWindow(width);
    assert.equal(animations.length, 1);
    const animation = animations[0];
    assert.equal(width - page.unfoldNavWidth, 460);
    animation.onframe(0.5);
    assert.equal(width - page.unfoldNavWidth, (460 + width) / 2);
    animation.onframe(1); assert.equal(page.unfoldNavWidth, 0);
    animation.onfinish();
    assert.equal(page.unfolding, false); assert.equal(page.unfoldBlur, 0);
    assert.equal(page.readerFullScreen, true); assert.equal(page.fullScreenWindowActive, true);
    assert.equal(page.article, article); assert.equal(page.web, web); assert.equal(page.readerPaths, paths);
  }
});

test('leaving fullscreen during unfold cancels before a late frame can resize the normal reader', async () => {
  const { page, animations } = liveFoldingPage();
  page.readerFullScreen = true; page.fullScreenWindowActive = true;
  page.updateWindowFullScreen = async () => { page.fullScreenWindowActive = false; };
  page.foldStatusChanged(2); page.foldStatusChanged(3); page.resizeWindow(940);
  assert.equal(animations.length, 1);
  const animation = animations[0]; animation.onframe(0.25);
  await page.setReaderFullScreen(false);
  const inset = page.unfoldNavWidth;
  animation.onframe(0.75); animation.onfinish();
  assert.equal(animation.cancelled, true); assert.equal(page.unfolding, false);
  assert.equal(page.unfoldNavWidth, inset); assert.equal(page.unfoldBlur, 0);
  assert.equal(page.fullScreenWindowActive, false); assert.equal(page.readerFullScreen, false);
});

test('fullscreen unfold waits for the window and respects shared motion and overlay gates', () => {
  for (const prepare of [page => { page.fullScreenWindowActive = false; },
    page => { page.readerFullScreen = false; }, page => { page.mediaFullScreen = true; },
    page => { page.showSheet = true; }, () => { reducedMotion = true; }]) {
    const { page, animations } = liveFoldingPage();
    page.readerFullScreen = true; page.fullScreenWindowActive = true;
    page.foldStatusChanged(2); page.foldStatusChanged(3); prepare(page);
    try { page.resizeWindow(940); assert.equal(animations.length, 0); }
    finally { reducedMotion = false; }
  }
});


test('unfolding into wider columns begins at the previous single or split reader width', () => {
  for (const [cover, inner, scale, priorReader, finalReader] of [
    [574, 1174, 1, 574, 614], [632, 1292, 1, 352, 732],
    [940, 1292, 1, 660, 732], [632, 1500, 1.5, 632, 660], [632, 940, 1, 352, 660]
  ]) {
    const { page, animations } = liveFoldingPage();
    page.windowWidth = cover; page.systemFontScale = scale;
    const article = page.article, web = page.web;
    page.web.loadData = () => assert.fail('three-column unfold must retain the document');
    page.foldStatusChanged(2); page.foldStatusChanged(3); page.resizeWindow(inner);
    assert.equal(animations.length, 1, `unfold ${cover} -> ${inner}`);
    const animation = animations[0];
    const contentWidth = () => inner - (page.hasLibrarySidebar() ? page.libraryPaneWidth() : 0) - page.unfoldNavWidth;
    assert.equal(contentWidth(), priorReader, 'do not count the previous list as article width');
    animation.onframe(0.5); assert.equal(contentWidth(), (priorReader + finalReader) / 2);
    animation.onframe(1); assert.equal(contentWidth(), finalReader);
    animation.onfinish();
    assert.equal(page.unfolding, false); assert.equal(page.article, article); assert.equal(page.web, web);
  }
});

for (const change of ['reenter', 'replace-document']) {
  test(`pending video Back fallback cannot affect a newer ${change}`, async () => {
    const page = setup();
    page.chooseScope('feed'); page.openArticle(first); page.loadReader();
    page.updateWindowFullScreen = async () => {};
    page.getUIContext = () => ({ runScopedTask: action => action() });
    page.mediaExit = { exitFullScreen() {} };
    await page.setMediaFullScreen(true);
    assert.equal(page.onBackPress(), true);
    if (change === 'reenter') {
      await page.setMediaFullScreen(false);
      // Even a platform that reuses the handler object starts a new fullscreen session.
      await page.setMediaFullScreen(true);
    } else {
      page.loadReader();
    }
    const document = page.readerDocumentUrl;
    let reloads = 0;
    const load = page.loadReader.bind(page);
    page.loadReader = () => { reloads++; load(); };
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(reloads, 0, 'an old Back must not reset the current video');
    assert.equal(page.mediaFullScreen, true);
    assert.equal(page.readerDocumentUrl, document);
    assert.equal(page.restoreScrollY, 0);
  });
}


test('feed discovery decodes candidate names and addresses once before URL validation', () => {
  const titles = new Map();
  const resolve = (value, base) => {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('unsafe');
    url.hash = ''; return url.href;
  };
  const html = '<base href="/news&#47;">' +
    '<link rel="alternate" type="application/rss+xml" title="Tom&#8217;s &quot;Tech&quot; &lt;News&gt;" href="feed?x=1&#38;y=2">' +
    '<link rel="alternate" type="application/rss+xml" title="Literal &amp;#8217;" href="once?x=1&amp;#38;y=2">' +
    '<link rel="alternate" type="application/rss+xml" href="jav&#97;script:alert(1)">';
  const urls = discoverFeeds(html, 'https://example.org/start', resolve, titles);
  assert.deepEqual(Array.from(urls), ['https://example.org/news/feed?x=1&y=2', 'https://example.org/news/once?x=1&']);
  assert.equal(titles.get(urls[0]), 'Tom’s "Tech" <News>');
  assert.equal(titles.get(urls[1]), 'Literal &#8217;');
});

for (const change of ['edit', 'close', 'reopen']) {
  test(`obsolete discovery releases the busy state immediately after ${change}`, async () => {
    const page = new Index(); const toasts = []; page.toast = message => toasts.push(message);
    const address = `https://cancel-${change}.example.org/`; let fail; let cancelled = 0;
    feedRequests.set(address, register => new Promise((_, reject) => {
      fail = reject;
      register?.(() => { cancelled++; reject(new Error('cancelled')); });
    }).finally(() => register?.(undefined)));
    page.openSheet('添加订阅');
    const pending = page.run(() => page.add(address));
    try {
      if (change === 'edit') {
        const body = source.match(/\.onChange\(\(value: string\) => \{ (this\.address = value;[^}]+)\}/)[1];
        runInNewContext(stripTypeScriptTypes(`(function(value: string) { ${body} })`)).call(page, 'https://replacement.example/');
      } else if (change === 'close') {
        page.showSheet = false;
        const body = source.slice(source.indexOf('.bindSheet')).match(/onDisappear: \(\) => \{([^}]+)\}/)[1];
        runInNewContext(`(function() { ${body} })`).call(page);
      } else page.openSheet('添加订阅');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(cancelled, 1, 'the old request must actually be cancelled');
      assert.equal(page.busy, false, 'do not wait for the obsolete server timeout');
      assert.equal(toasts.length, 0); assert.equal(page.sheetMessage, '');
      const replacement = 'https://replacement.example/';
      feedRequests.set(replacement, async () => ({ url: replacement, source: '<html><link rel="alternate" type="application/rss+xml" href="/feed" title="New feed"></html>' }));
      if (!page.showSheet) page.openSheet('添加订阅');
      await page.run(() => page.add(replacement));
      assert.equal(page.candidateTitles.get(replacement + 'feed'), 'New feed');
      feedRequests.delete(replacement);
    } finally { fail(new Error('test cleanup')); await pending; feedRequests.delete(address); }
  });
}

test('today publishes fast feeds before a stalled feed finishes and limits concurrent requests', async () => {
  const page = new Index(); const slow = Promise.withResolvers();
  const feeds = ['slow', 'fast', 'third', 'fourth', 'fifth'].map(id => ({ id, title: id, folder: '[]', site: '' }));
  const articles = [], fetched = [], failures = [], messages = []; let active = 0, peak = 0;
  page.feeds = feeds; page.ready = true; page.chooseScope('', '', '今天');
  page.toast = value => messages.push(value);
  page.store = {
    saveRefresh: async (_feed, parsed) => articles.push(...parsed.articles),
    error: async (feed, message) => failures.push([feed.id, message]),
    subscriptions: async () => feeds.map(f => ({ ...f })), folders: async () => [], articles: async () => articles.slice(),
  };
  for (const feed of feeds) feedRequests.set(feed.id, async () => {
    fetched.push(feed.id); peak = Math.max(peak, ++active);
    try {
      if (feed.id === 'slow') { await slow.promise; throw new Error('timeout'); }
      await new Promise(resolve => setImmediate(resolve));
      return { url: `https://${feed.id}.example/`, source: JSON.stringify({
        version: 'https://jsonfeed.org/version/1.1', title: feed.title,
        items: [{ id: feed.id, title: feed.id, content_text: 'Today', date_published: new Date().toISOString() }],
      }) };
    } finally { active--; }
  });
  const pending = page.startRefresh();
  try {
    for (let i = 0; i < 30; i++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.visible().length, 4, 'today must show fast responses while the first feed is still pending');
    assert.equal(page.collectionCount('今天'), 4);
    assert.equal(page.refreshing, true);
    assert.equal(page.refreshProgress, '正在更新 4/5');
    assert.equal(new Set(fetched).size, 5); assert.equal(peak, 3);
    assert.equal(messages.length, 0, 'completion feedback waits for every feed');
  } finally {
    slow.resolve(); await pending; for (const feed of feeds) feedRequests.delete(feed.id);
  }
  assert.equal(page.refreshing, false); assert.equal(page.visible().length, 4);
  assert.deepEqual(failures, [['slow', 'timeout']]);
  assert.deepEqual(messages, ['1 个订阅未能更新']);
});

test('parallel refresh serializes saving and publication, and drains requests after a storage failure', async () => {
  const page = new Index(); const saveGate = Promise.withResolvers(); const networkGate = Promise.withResolvers();
  const feeds = ['save-first', 'save-fails', 'network-last'].map(id => ({ id, folder: '[]' }));
  const events = [], messages = []; let writing = false;
  page.feeds = feeds; page.ready = true; page.toast = value => messages.push(value);
  page.store = {
    saveRefresh: async feed => {
      assert.equal(writing, false); writing = true; events.push(`save:${feed.id}`);
      try {
        if (feed.id === 'save-first') await saveGate.promise;
        if (feed.id === 'save-fails') throw new Error('disk full');
      } finally { writing = false; }
    },
    error: async () => { throw new Error('disk full'); },
  };
  page.reload = async () => { assert.equal(writing, false); events.push('publish'); };
  for (const feed of feeds) feedRequests.set(feed.id, async () => {
    if (feed.id === 'network-last') await networkGate.promise;
    return { unchanged: true };
  });
  const pending = page.startRefresh();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['save:save-first'], 'a second response cannot publish during the first save');
    saveGate.resolve(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(events, ['save:save-first', 'publish', 'save:save-fails']);
    assert.equal(page.refreshing, true); assert.equal(messages.length, 0);
  } finally {
    saveGate.resolve(); networkGate.resolve(); await pending;
    for (const feed of feeds) feedRequests.delete(feed.id);
  }
  assert.deepEqual(events, ['save:save-first', 'publish', 'save:save-fails', 'save:network-last', 'publish']);
  assert.equal(page.refreshing, false);
  assert.deepEqual(messages, ['暂时无法更新，仍可阅读已下载的文章']);
});

test('home search finds read articles across dates, feeds and previous collection filters', async () => {
  const page = emptyScope(); page.getUIContext = () => ({ postFrameCallback() {} });
  page.feeds = [{ id: 'feed', title: 'Daring Fireball', folder: '[]' }, { id: 'other', title: 'Other', folder: '["Work"]' }];
  page.articles = [
    { ...first, title: 'A review', content: '<p>The iPhone <em>Duo</em> feels different.</p>', author: 'John Gruber', read: true },
    { ...second, feedId: 'other', title: 'Another iPhone Duo', published: Date.now() },
  ];
  page.chooseScope('other', '["Work"]', '星标'); page.query = 'old query';
  page.libraryMenus().find(item => item.value === '搜索文章').action();
  assert.equal(page.selectedFeed, ''); assert.equal(page.selectedFolder, '');
  assert.equal(page.filter, '全部'); assert.equal(page.showRead, true);
  assert.equal(page.searching, true); assert.equal(page.query, '');
  assert.equal(page.paths.getAllPathName().at(-1), 'articles');
  page.query = 'iPHONE duo'; page.syncList(); await searchIdle(page);
  assert.deepEqual(Array.from(page.visible(), a => a.id), ['a', 'b']);
  page.query = 'John Gruber'; page.syncList();
  assert.deepEqual(Array.from(page.visible(), a => a.id), ['a']);
  page.listScroller.getItemRect = () => ({ x: 0, y: 0, width: 320, height: 100 });
  page.web.loadData = () => {}; page.openArticle(page.visible()[0]);
  assert.equal(page.article.id, 'a'); assert.equal(page.article.read, true);
  page.chooseScope('other');
  assert.equal(page.searching, false); assert.equal(page.query, ''); assert.equal(page.showRead, false);
});

test('list search includes already-read articles while retaining the selected feed', async () => {
  const page = emptyScope(); page.getUIContext = () => ({ postFrameCallback() {} });
  page.feeds = [{ id: 'feed', folder: '[]' }, { id: 'other', folder: '[]' }];
  page.articles = [{ ...first, title: 'Lost article', read: true }, { ...second, feedId: 'other', title: 'Lost article' }];
  page.chooseScope('feed'); page.openSearch();
  assert.equal(page.selectedFeed, 'feed'); assert.equal(page.showRead, true);
  assert.equal(page.filter, '全部'); assert.equal(page.searching, true);
  page.query = 'Lost'; page.syncList(); await searchIdle(page);
  assert.deepEqual(Array.from(page.visible(), a => a.id), ['a']);
  page.closeSearch();
  assert.equal(page.searching, false); assert.equal(page.query, '');
  assert.equal(page.selectedFeed, 'feed');
});

test('search focus waits for rendering and never steals focus after cancellation or navigation', () => {
  const page = emptyScope(); const frames = [], focused = [];
  page.getUIContext = () => ({ postFrameCallback: frame => frames.push(frame),
    getFocusController: () => ({ requestFocus: id => focused.push(id) }) });
  page.openSearch(true); assert.equal(focused.length, 0);
  frames.shift().onIdle(); assert.deepEqual(focused, ['article-search']);
  page.openSearch(); page.closeSearch(); frames.shift().onIdle();
  page.openSearch(); page.chooseScope('feed'); frames.shift().onIdle();
  assert.deepEqual(focused, ['article-search']);
});

function progressFixture(page, saved = new Map(), lastArticleId = '') {
  const writes = [];
  page.progress = { lastArticleId, position: id => saved.get(id) || 0,
    visit: async id => { page.progress.lastArticleId = id; },
    save: async (id, y) => { saved.set(id, y); writes.push([id, y]); },
  };
  page.web.getUrl = () => page.readerDocumentUrl;
  page.web.scrollTo = (_x, y) => { page.restoredY = y; };
  return writes;
}

test('startup resumes the last cached article including read articles, but ignores a missing article', () => {
  const page = setup(); progressFixture(page, new Map([['a', 1234]]), 'a');
  page.articles[0].read = true; page.resumeReading();
  assert.equal(page.article, undefined, 'wait for the native nested navigation to be mounted');
  page.readingPaneShown();
  assert.equal(page.article.id, 'a'); assert.equal(page.restoreScrollY, 1234);
  assert.equal(page.selectedFeed, 'feed'); assert.equal(page.filter, '全部');
  const missing = setup(); progressFixture(missing, new Map(), 'missing'); missing.resumeReading();
  assert.equal(missing.article, undefined); assert.equal(missing.paths.size(), 0);
});

test('switching articles flushes their independent positions and loading zero cannot overwrite a bookmark', async () => {
  const page = setup(); const writes = progressFixture(page, new Map([['a', 1200], ['b', 800]]));
  page.openArticle(first); page.loadReader();
  page.recordReaderScroll(0); page.flushReadingProgress();
  assert.equal(writes.length, 0);
  readerPageEnd(page); await idle(page); assert.equal(page.restoredY, 1200);
  page.recordReaderScroll(1450); page.openArticle(second);
  assert.deepEqual(writes.at(-1), ['a', 1450]); assert.equal(page.restoreScrollY, 800);
  page.recordReaderScroll(0); assert.equal(writes.length, 1);
  readerPageEnd(page); await idle(page); page.recordReaderScroll(920);
  page.closeArticle(); assert.deepEqual(writes.at(-1), ['b', 920]);
});

test('background saves immediately, deliberate scrolling cancels late restoration, and top is saved as zero', async () => {
  const page = setup(); const writes = progressFixture(page, new Map([['a', 1200]]));
  page.openArticle(first); page.loadReader(); readerPageVisible(page); await idle(page);
  page.onReaderTouch({ type: 0, touches: [{ displayX: 10, displayY: 10 }] });
  page.recordReaderScroll(0); page.onPageHide();
  assert.deepEqual(writes.at(-1), ['a', 0]);
  page.restoredY = -1; readerPageEnd(page); await idle(page);
  assert.equal(page.restoredY, -1, 'late image completion cannot jump back after interaction');
});

test('next unread saves the outgoing article and restores the next article bookmark', async () => {
  const page = setup(); const writes = progressFixture(page, new Map([['b', 500]]));
  page.openArticle(first); readerPageEnd(page); await idle(page);
  page.recordReaderScroll(300); page.openNextUnread();
  assert.deepEqual(writes.at(-1), ['a', 300]); assert.equal(page.restoreScrollY, 500);
  page.onPageHide();
});


test('pending startup resume is cancelled when the user chooses another scope', () => {
  const page = setup(); progressFixture(page, new Map([['a', 1234]]), 'a');
  page.resumeReading(); page.chooseScope('', '', '星标'); page.readingPaneShown();
  assert.equal(page.article, undefined);
});

test('article footnote fragments keep recording, while stale document scroll callbacks are ignored', async () => {
  const page = setup(); const writes = progressFixture(page);
  page.openArticle({ ...first, link: 'https://example.org/a' });
  readerPageEnd(page); await idle(page);
  page.web.getUrl = () => 'https://example.org/a#footnote-1';
  page.recordReaderScroll(650); page.flushReadingProgress();
  assert.deepEqual(writes.at(-1), ['a', 650]);
  page.web.getUrl = () => 'https://example.org/a#xunzhi-load-0';
  page.recordReaderScroll(0); page.flushReadingProgress();
  assert.equal(writes.length, 1);
});

test('matching page completion restores the position even during another busy operation', () => {
  const page = setup(); progressFixture(page, new Map([['a', 1234]]));
  page.openArticle(first); page.loadReader(); page.busy = true;
  readerPageEnd(page); assert.equal(page.restoredY, 1234);
  page.busy = false; page.onPageHide();
});


test('Back during startup navigation cancels the pending automatic article open', () => {
  const page = setup(); progressFixture(page, new Map(), 'a');
  page.resumeReading(); page.onBackPress(); page.readingPaneShown();
  assert.equal(page.article, undefined);
});
