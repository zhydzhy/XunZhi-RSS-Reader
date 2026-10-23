import { common, bundleManager, Configuration } from '@kit.AbilityKit';
import { display, AnimatorResult, router, window, SymbolGlyphModifier, FrameCallback, LengthMetrics, TextModifier } from '@kit.ArkUI';
import { accessibility } from '@kit.AccessibilityKit';
import { webview } from '@kit.ArkWeb';
import { util } from '@kit.ArkTS';
import { systemShare } from '@kit.ShareKit';
import { uniformTypeDescriptor } from '@kit.ArkData';
import { pasteboard } from '@kit.BasicServicesKit';
import { fileUri } from '@kit.CoreFileKit';
import { Article, Feed, Subscription, articleTitle, exportOpml, readerHtml, textOnly, hasReaderBody, articleDate, feedError, READER_FONT, READER_HEADING_FONT } from '../reader/Feed';
import { discoverFeeds, fetchFeed, FetchResult, makeParser, resolveHttp } from '../reader/NativeFeed';
import { registerReaderFonts, readerFontResponse } from '../reader/ReaderFonts';
import { ReaderDialog, ReaderDialogOptions } from '../reader/ReaderDialog';
import { ReaderStore } from '../reader/ReaderStore';
import { ReaderProgress } from '../reader/ReaderProgress';
import { ReaderPreferences, readerColorMode } from '../reader/ReaderPreferences';
import { importFile, exportFile } from '../reader/ReaderFiles';
import { prepareVideos } from '../reader/ReaderMedia';
import { ReaderIcons } from '../reader/ReaderIcons';
import { ReaderArticleSource } from '../reader/ReaderArticleSource';
import { ReaderFooter, ReaderFooterParams } from '../reader/ReaderFooter';

interface ReaderListPosition { ids: string[]; offset: number; }
interface ReaderArticleState { read: boolean; starred: boolean; }

class ReaderFrame extends FrameCallback {
  private done: () => void;
  constructor(done: () => void) { super(); this.done = done; }
  onIdle(): void { this.done(); }
}

@Entry
@Component
struct Index {
  @State @Watch('syncList') feeds: Feed[] = [];
  @State @Watch('syncList') articles: Article[] = [];
  @State folders: string[] = [];
  @State paths: NavPathStack = new NavPathStack();
  @State readerPaths: NavPathStack = new NavPathStack();
  @State windowWidth: number = 0;
  @State unfolding: boolean = false;
  @State unfoldBlur: number = 0;
  @State unfoldNavWidth: number = 280;
  private unfoldPending: boolean = false;
  private foldSignalTime: number = 0;
  private foldWasClosed: boolean = false;
  private foldListening: boolean = false;
  private unfoldRevision: number = 0;
  private unfoldAnimator?: AnimatorResult;
  private foldStatusChanged = (status: display.FoldStatus): void => {
    if (status === display.FoldStatus.FOLD_STATUS_FOLDED) {
      this.cancelUnfold(); this.foldWasClosed = true;
    } else if (this.foldWasClosed && (status === display.FoldStatus.FOLD_STATUS_HALF_FOLDED ||
      status === display.FoldStatus.FOLD_STATUS_EXPANDED)) {
      this.unfoldPending = true; this.foldSignalTime = Date.now();
    }
  };
  private reduceMotionChanged = (enabled: boolean): void => { if (enabled) this.cancelUnfold(); };

  @State @Watch('onFontScaleChange') systemFontScale: number = 1;
  private environmentId: number = -1;
  @State listSplit: boolean = false;
  @State libraryDrawer: boolean = false;
  @State @Watch('syncList') showRead: boolean = false;
  @State undoReadIds: string[] = [];
  private readingQueue: Article[] = [];
  private readingQueuePosition: number = -1;
  @State readingStates: Map<string, ReaderArticleState> = new Map();
  private listData: ReaderArticleSource = new ReaderArticleSource();
  private visibleCache: Article[] = [];
  private visibleArticles?: Article[];
  private visibleFolders?: Map<string, string>;
  private membershipFeeds?: Feed[];
  private feedFolders: Map<string, string> = new Map();
  private lookupFeeds?: Feed[];
  private feedsById: Map<string, Feed> = new Map();
  private visibleKey: string = '';
  private plainText: Map<string, string> = new Map();
  private searchText: Map<string, string> = new Map();
  private textCacheArticles?: Article[];
  private indexedArticles?: Article[];
  private indexingArticles?: Article[];
  @State searchPending: boolean = false;
  private countArticles?: Article[];
  private countFolders?: Map<string, string>;
  private countDay: number = 0;
  private unreadCounts: Map<string, number> = new Map();
  @State searching: boolean = false;
  @State refreshing: boolean = false;
  @State homeRefreshing: boolean = false;
  @State listRefreshing: boolean = false;
  @State showSheet: boolean = false;
  @State sheet: string = '添加订阅';
  @State sheetMessage: string = '';
  @State sheetError: boolean = false;
  @State sheetEditing: boolean = false;
  @StorageProp('readerKeyboardVisible') keyboardVisible: boolean = false;
  @StorageProp('readerBottomInset') bottomInset: number = 0;
  @State movingFeed: Feed | undefined = undefined;
  @State collapsedFolders: string[] = [];
  @State folderMenu: string = '';
  @State addMenuOwner: string = '';
  @State @Watch('syncReaderFooter') theme: string = 'system';
  @State savingAppearance: boolean = false;
  private appearance?: ReaderPreferences;
  private actionReturnFocus: string = '';
  private addressRevision: number = 0;
  private cancelLookup?: () => void;
  private refreshRunning: boolean = false;
  private reloadOnIdle: boolean = false;
  private reloadRevision: number = 0;
  private restoreScrollY: number = 0;
  private progress?: ReaderProgress;
  private pendingResume?: Article;
  private readingPaneReady: boolean = false;
  private progressY: number = 0;
  private progressReady: boolean = false;
  private progressDirty: boolean = false;
  private progressTimer: number = -1;
  private progressWarning: boolean = false;
  @StorageProp('readerInBackground') @Watch('onReaderBackground') readerInBackground: boolean = false;
  private listScroller: Scroller = new Scroller();
  private listFirstVisible: number = 0;
  private listScope: string = '';
  private listPosition?: ReaderListPosition;
  // The reading columns were opened by a wide window, not by choosing a scope or an article.
  private autoArticles: boolean = false;
  @State @Watch('syncList') filter: string = '未读';
  @State @Watch('syncList') query: string = '';
  @State @Watch('syncList') selectedFeed: string = '';
  @State @Watch('syncList') selectedFolder: string = '';
  @State address: string = '';
  @State folderName: string = '';
  @State candidates: string[] = [];
  @State candidateTitles: Map<string, string> = new Map();
  @State @Watch('syncReaderFooter') busy: boolean = false;
  @State ready: boolean = false;
  @State @Watch('syncReaderFooter') article: Article | undefined = undefined;
  @State @Watch('syncReaderFooter') fontSize: number = 18;
  @State loaded: boolean = false;
  @State readerError: boolean = false;
  private readerLoadId: number = 0;
  private readerDocumentUrl: string = '';
  private readerDataPrefix: string = '';
  private store: ReaderStore = new ReaderStore();
  private readerFooter: ReaderFooter = new ReaderFooter();
  private footerEmbedId: string = '';
  @State footerVisible: boolean = false;
  @State footerX: number = 0;
  @State footerY: number = 0;
  @State footerWidth: number = 0;
  @State footerHeight: number = 0;
  private web: webview.WebviewController = new webview.WebviewController();
  private opened: boolean = false;
  @State mediaFullScreen: boolean = false;
  @State readerFullScreen: boolean = false;
  @State fullScreenWindowActive: boolean = false;
  private windowFullScreenUpdate: Promise<void> = Promise.resolve();
  private previousNavigationIndicatorVisible: boolean = true;
  @State readerChromeVisible: boolean = true;
  private readerTouchX: number = 0;
  private readerTouchY: number = 0;
  private mediaExit?: FullScreenExitHandler;
  private mediaFullScreenRevision: number = 0;
  private mediaScrollY: number = 0;
  private icons?: ReaderIcons;
  @State failedIcons: string[] = [];
  @State refreshProgress: string = '';
  @State activityTime: number = Date.now();
  private activityTimer: number = -1;
  @State calendarDay: number = new Date().setHours(0, 0, 0, 0);
  @State version: string = '';

  private readerDialog?: CustomDialogController;
  private readerFont: string = READER_FONT;
  private headingFont: string = READER_HEADING_FONT;
  private headingModifier: TextModifier = new TextModifier().fontFamily(READER_HEADING_FONT);
  private textModifier: TextModifier = new TextModifier().fontFamily(READER_FONT);
  @State fontLicenses: string = '';

  aboutToAppear(): void {
    registerReaderFonts(this.getUIContext());
    if (display.isFoldable()) {
      this.foldWasClosed = display.getFoldStatus() === display.FoldStatus.FOLD_STATUS_FOLDED;
      display.on('foldStatusChange', this.foldStatusChanged);
      accessibility.onAnimationReduceStateChange(this.reduceMotionChanged);
      this.foldListening = true;
    }

    this.systemFontScale = this.context().config.fontSizeScale || 1;
    this.environmentId = this.context().getApplicationContext().on('environment', {
      onConfigurationUpdated: (config: Configuration) => {
        if (config.fontSizeScale !== undefined) this.systemFontScale = config.fontSizeScale;
      },
      onMemoryLevel: () => {}
    });
    if (!this.opened) { this.opened = true; this.run(async () => {
      let warning = '';
      const info = bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT);
      this.version = `${info.versionName} (${info.versionCode})`;
      try {
        this.appearance = new ReaderPreferences(this.context());
        const saved = this.appearance.load(); this.theme = saved.theme; this.fontSize = saved.fontSize;
      } catch (_) { warning = '阅读设置暂时无法打开'; }
      try { this.icons = new ReaderIcons(this.context()); } catch (_) {}
      await this.store.open(this.context()); this.ready = true; await this.reload(); this.toast(warning);
      try {
        const progress = new ReaderProgress(); await progress.open(this.context()); this.progress = progress;
      } catch (_) { this.toast('阅读进度暂时无法打开'); }
      this.loadIcons().catch(() => {});
    }).then(() => { this.resumeReading(); }); }
  }
  onPageShow(): void {
    this.onPageHide();
    if (this.foldListening) this.foldWasClosed = display.getFoldStatus() === display.FoldStatus.FOLD_STATUS_FOLDED;
    this.updateActivityTime();
    this.activityTimer = setInterval(() => { this.updateActivityTime(); }, 60000);
  }
  private updateActivityTime(): void {
    this.activityTime = Date.now();
    const day = new Date(this.activityTime).setHours(0, 0, 0, 0);
    if (day === this.calendarDay) return;
    this.calendarDay = day;
    if (this.filter === '今天') this.syncList();
  }
  onPageHide(): void {
    this.flushReadingProgress();
    this.cancelUnfold(); this.foldWasClosed = false;
    if (this.activityTimer !== -1) clearInterval(this.activityTimer);
    this.activityTimer = -1;
  }
  aboutToDisappear(): void {
    this.invalidateLookup();
    if (this.foldListening) {
      display.off('foldStatusChange', this.foldStatusChanged);
      accessibility.offAnimationReduceStateChange(this.reduceMotionChanged);
      this.foldListening = false;
    }

    this.onPageHide();
    if (this.environmentId !== -1) {
      this.context().getApplicationContext().off('environment', this.environmentId).catch(() => {});
      this.environmentId = -1;
    }
  }
  private context(): common.UIAbilityContext { return this.getUIContext().getHostContext() as common.UIAbilityContext; }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    const sheet = this.showSheet ? this.sheet : '';
    const revision = this.addressRevision;
    this.busy = true;
    try { await action(); } catch (error) {
      const raw = (error as Error).message || '';
      const message = /[\u3400-\u9fff]/.test(raw) ? raw : sheet === '添加订阅' ? feedError(raw) : '操作未完成，请重试';
      if (sheet && this.showSheet && this.sheet === sheet && revision === this.addressRevision) {
        this.sheetMessage = message; this.sheetError = true;
      } else this.toast(message);
    }
    finally {
      if (this.reloadOnIdle) {
        this.reloadOnIdle = false;
        try { await this.reload(); } catch (_) { this.toast('文章列表未能更新，请重试'); }
      }
      this.busy = false;
      this.restoreActionFocus();
    }
  }
  private activateFocusAction(id: string, action: () => void): void {
    this.actionReturnFocus = this.getUIContext().getFocusController().isActive() ? id : '';
    action();
  }
  private restoreActionFocus(sheetDisappeared: boolean = false): void {
    if (this.busy || (this.showSheet && !sheetDisappeared)) return;
    const id = this.actionReturnFocus; this.actionReturnFocus = '';
    if (!id) return;
    // Sheet disappearance can precede its visibility update; check again after native layout.
    this.getUIContext().postFrameCallback(new ReaderFrame(() => {
      const page = this.paths.getAllPathName().slice(-1)[0];
      const visible = id === 'activity-home' ? !page : id === 'activity-sidebar' ?
        page === 'articles' && !this.fullScreenWindowActive && (this.hasLibrarySidebar() || this.libraryDrawer) :
        page === 'settings';
      if (visible && !this.busy && !this.showSheet) this.getUIContext().getFocusController().requestFocus(id);
    }));
  }
  private async reload(): Promise<void> {
    const revision = ++this.reloadRevision;
    const states = new Map(this.readingStates);
    const feeds = await this.store.subscriptions();
    const folders = await this.store.folders();
    const articles = await this.store.articles(feeds.map((f: Feed) => f.id));
    // Refresh and user actions may overlap; publish only the latest complete snapshot.
    if (revision !== this.reloadRevision) return;
    for (const feed of feeds) feed.icon = this.icons?.cached(feed.id) || '';
    // Keep writes completed during this read visible until a later snapshot includes them.
    states.forEach((state: ReaderArticleState, id: string) => {
      if (this.readingStates.get(id) === state) this.readingStates.delete(id);
    });
    this.feeds = feeds; this.folders = folders; this.articles = articles;
    if (this.article) {
      const latest = new Map<string, Article>();
      for (const item of articles) latest.set(item.id, item);
      // Freeze queue membership and order, but use refreshed content when opening the next article.
      this.readingQueue = this.readingQueue.map((queued: Article): Article => {
        const item = latest.get(queued.id) || queued;
        const state = this.readingStates.get(item.id) || item;
        return { id: item.id, feedId: item.feedId, title: item.title, link: item.link, content: item.content,
          published: item.published, author: item.author, language: item.language, read: state.read, starred: state.starred };
      });
      const article = this.article;
      const state = this.readingStates.get(article.id) || latest.get(article.id);
      if (state) this.article = { id: article.id, feedId: article.feedId, title: article.title, link: article.link,
        content: article.content, published: article.published, author: article.author, language: article.language,
        read: state.read, starred: state.starred };
    }
  }
  private async loadIcons(): Promise<void> {
    if (!this.icons) return;
    for (const feed of this.feeds) {
      await this.updateIcon(feed.id, feed.site).catch(() => {});
    }
  }
  private async updateIcon(id: string, site: string, declared: string = '', retryMissing: boolean = false): Promise<void> {
    if (!this.icons) return;
    const icon = await this.icons.update(id, site, declared, retryMissing);
    const current = this.feeds.find((item: Feed) => item.id === id);
    if (current && current.icon !== icon) {
      current.icon = icon;
      this.feeds = this.feeds.slice();
    }
  }
  private invalidateLookup(): void {
    this.addressRevision++;
    this.cancelLookup?.(); this.cancelLookup = undefined;
  }
  private async add(address: string): Promise<void> {
    const revision = this.addressRevision;
    const id = resolveHttp(address.includes('://') ? address : `https://${address}`);
    if (this.feeds.some((f: Feed) => f.id === id)) throw new Error('已经订阅这个地址');
    this.sheetError = false; this.sheetMessage = '正在查找订阅…';
    const response = await fetchFeed(id, '', '', (cancel?: () => void) => { this.cancelLookup = cancel; }).catch((error: Error) => {
      if (revision === this.addressRevision && this.showSheet) throw error;
      return undefined;
    });
    if (!response || revision !== this.addressRevision || !this.showSheet) return;
    if (/<html\b|<!doctype\s+html/i.test(response.source.slice(0, 2000))) {
      const titles = new Map<string, string>();
      this.candidates = discoverFeeds(response.source, response.url, resolveHttp, titles);
      this.candidateTitles = titles;
      if (!this.candidates.length) throw new Error('网页没有声明订阅地址，请粘贴 RSS / Atom / JSON Feed 链接');
      this.sheetMessage = '选择要添加的订阅'; return;
    }
    const parsed = makeParser().parse(response.source, id, response.url);
    const feed: Feed = { id, title: parsed.title, site: parsed.site, folder: '[]', etag: '', modified: '', checked: 0, error: '' };
    await this.store.saveRefresh(feed, parsed, response.etag, response.modified);
    await this.store.saveSubscriptions([{ url: id, title: parsed.title, folders: [] }]);
    await this.reload();
    this.updateIcon(id, parsed.site, parsed.icon).catch(() => {});
    this.toast(`已添加 ${parsed.title} · ${parsed.articles.length} 篇`);
    // Saving may finish after the user has edited, dismissed or replaced the sheet.
    if (revision !== this.addressRevision || !this.showSheet || this.sheet !== '添加订阅') return;
    this.candidates = []; this.address = ''; this.showSheet = false;
    this.readerPaths.clear(); this.closeArticle();
    if (this.paths.size() > 0) this.paths.clear();
    this.chooseScope(id);
  }
  private async refresh(feedId: string = '', folder: string = ''): Promise<void> {
    let failed = 0;
    const feeds = this.feeds.filter((feed: Feed) => (!feedId || feed.id === feedId) && (!folder || feed.folder === folder));
    let completed = 0;
    let next = 0;
    let publication: Promise<void> = Promise.resolve();
    this.refreshProgress = `正在更新 0/${feeds.length}`;
    const worker = async (): Promise<void> => {
      while (next < feeds.length) {
        const feed = feeds[next++];
        let response: FetchResult | undefined;
        let failure = '';
        try { response = await fetchFeed(feed.id, feed.etag, feed.modified); }
        catch (error) { failure = (error as Error).message; }
        // Publish each completed feed without overlapping cache transactions or snapshot reads.
        const update = publication.then(async () => {
          try {
            if (!response) throw new Error(failure);
            const parsed = response.unchanged ? undefined : makeParser().parse(response.source, feed.id, response.url);
            await this.store.saveRefresh(feed, parsed, response.etag, response.modified);
            this.updateIcon(feed.id, parsed?.site || feed.site, parsed?.icon, true).catch(() => {});
          } catch (error) { failed++; await this.store.error(feed, (error as Error).message); }
          await this.reload();
          this.refreshProgress = `正在更新 ${++completed}/${feeds.length}`;
        });
        publication = update.catch(() => {});
        await update;
      }
    };
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(3, feeds.length); i++) workers.push(worker());
    // A storage failure must not end the spinner while another worker is still running.
    const results = await Promise.allSettled(workers);
    for (const result of results) if (result.status === 'rejected') throw result.reason as Error;
    await this.reload(); this.toast(failed ? `${failed} 个订阅未能更新` : '已更新');
  }
  private syncList(): void {
    const scope = JSON.stringify([this.selectedFeed, this.selectedFolder, this.filter, this.showRead, this.query]);
    const scopeChanged = scope !== this.listScope || !this.paths.getAllPathName().includes('articles');
    if (scopeChanged) {
      this.listPosition = undefined;
    }
    this.listScope = scope;
    this.syncTextCache();
    this.searchPending = !!this.query.trim() && this.indexedArticles !== this.articles;
    const previous = this.visibleCache;
    const items = this.visible();
    if (!scopeChanged && items !== previous) this.rememberListPosition();
    this.listData.replace(items);
    if (!this.searchPending && this.listPosition) {
      const indices = new Map<string, number>();
      items.forEach((item: Article, index: number) => { indices.set(item.id, index); });
      const position = this.listPosition;
      const id = position.ids.find((id: string) => indices.has(id));
      if (id !== undefined) {
        const index = indices.get(id)!;
        const revision = this.listData.revision;
        this.getUIContext().postFrameCallback(new ReaderFrame(() => {
          if (this.listPosition !== position || this.listData.revision !== revision || this.listScope !== scope ||
            !this.listIsVisible()) return;
          this.listPosition = undefined;
          this.listScroller.scrollToIndex(index, false, ScrollAlign.START, { extraOffset: LengthMetrics.vp(position.offset) });
        }));
      } else { this.listPosition = undefined; }
    }
    if (this.searchPending && this.indexingArticles !== this.articles) {
      this.indexingArticles = this.articles;
      this.indexSearch(this.articles);
    }
  }
  private listIsVisible(): boolean {
    return this.paths.getAllPathName().slice(-1)[0] === 'articles' &&
      (!this.article || (this.listSplit && !this.fullScreenWindowActive));
  }
  private setListSplit(split: boolean): void {
    if (!split && this.listSplit) this.rememberListPosition();
    this.listSplit = split;
    if (split) this.syncList();
  }
  private cancelUnfold(): void {
    this.unfoldRevision++; this.unfoldPending = false;
    this.unfoldAnimator?.cancel(); this.unfoldAnimator = undefined;
    this.unfolding = false; this.unfoldBlur = 0;
  }
  private resizeWindow(width: number): void {
    const previous = this.windowWidth;
    const sidebar = !this.fullScreenWindowActive && this.hasLibrarySidebar() ? this.libraryPaneWidth() : 0;
    const previousReader = !this.fullScreenWindowActive &&
      previous >= sidebar + this.listPaneWidth() + (this.hasLibrarySidebar() ? 440 : 320) ?
      previous - sidebar - this.listPaneWidth() : previous;
    this.windowWidth = width;
    if (Date.now() - this.foldSignalTime > 1500) this.unfoldPending = false;
    if (this.unfoldPending && previous > 0 && width > previous + 32) {
      this.unfoldPending = false; this.foldWasClosed = false;
      if (this.article && !this.showSheet && !this.mediaFullScreen && !accessibility.isAnimationReduceEnabledSync() &&
        ((this.readerFullScreen && this.fullScreenWindowActive) ||
          (!this.readerFullScreen && !this.fullScreenWindowActive && width >= this.listPaneWidth() + 320))) {
        const revision = ++this.unfoldRevision;
        const start = width - previousReader - (!this.readerFullScreen && this.hasLibrarySidebar() ? this.libraryPaneWidth() : 0);
        const target = this.readerFullScreen ? 0 : this.listPaneWidth();
        this.unfoldNavWidth = start; this.unfolding = true; this.unfoldBlur = 24;
        const animator = this.getUIContext().createAnimator({ duration: 360, easing: 'ease-out', delay: 0,
          fill: 'forwards', direction: 'normal', iterations: 1, begin: 0, end: 1 });
        this.unfoldAnimator = animator;
        animator.onframe = (progress: number) => {
          if (revision !== this.unfoldRevision) return;
          this.unfoldNavWidth = start + (target - start) * progress;
          this.unfoldBlur = 24 * (1 - progress);
        };
        animator.onfinish = () => {
          if (revision !== this.unfoldRevision) return;
          this.unfolding = false; this.unfoldAnimator = undefined; this.unfoldBlur = 0;
        };
        animator.play();
      }
    } else if (width < previous || (width !== previous && this.unfoldAnimator !== undefined)) this.cancelUnfold();
    if (this.hasLibrarySidebar()) this.libraryDrawer = false;
    this.syncWideHome();
  }
  // A wide window opens on the reading columns, with the library in its drawer or sidebar, so the
  // phone home is never stretched across it. Narrowing again returns there unless the reader was used.
  private syncWideHome(): void {
    const names = this.paths.getAllPathName();
    if (this.isWide() && !names.includes('articles')) {
      this.autoArticles = true;
      this.paths.pushPath({ name: 'articles' }, false);
      // Settings opened on the narrow home stays in front.
      if (names.length) this.paths.moveIndexToTop(0, false);
    } else if (!this.isWide() && this.autoArticles && !this.article && names.includes('articles')) {
      this.autoArticles = false; this.libraryDrawer = false;
      if (names[names.length - 1] === 'articles') this.paths.pop(false);
      else this.paths.removeByName('articles');
    }
  }
  private layoutScale(): number { return Math.max(1, this.systemFontScale); }
  private hasLibrarySidebar(): boolean { return this.windowWidth >= 560 * this.layoutScale() + 442; }
  private isWide(): boolean { return this.windowWidth >= 280 * this.layoutScale() + 320; }
  private listPaneWidth(): number { return (this.hasLibrarySidebar() ? 320 : 280) * this.layoutScale(); }
  // The drawer covers the list column exactly; the embedded sidebar sits beside it.
  private libraryPaneWidth(): number {
    return Math.min(this.hasLibrarySidebar() ? 240 * this.layoutScale() : this.listPaneWidth(), Math.max(240, this.windowWidth - 48));
  }
  private onFontScaleChange(): void { this.cancelUnfold(); this.resizeWindow(this.windowWidth); }
  private rememberListPosition(): void {
    if (this.listPosition || !this.listIsVisible() ||
      this.listFirstVisible < 0 || this.listFirstVisible >= this.listData.totalCount()) return;
    const rect = this.listScroller.getItemRect(this.listFirstVisible);
    if (rect.height <= 0 || (this.listFirstVisible === 0 && rect.y >= 0)) return;
    const ids: string[] = [];
    for (let i = this.listFirstVisible; i < this.listData.totalCount(); i++) ids.push(this.listData.getData(i).id);
    for (let i = this.listFirstVisible - 1; i >= 0; i--) ids.push(this.listData.getData(i).id);
    this.listPosition = { ids, offset: -rect.y };
  }
  private syncTextCache(): void {
    if (this.textCacheArticles === this.articles) return;
    if (this.plainText.size || this.searchText.size) {
      const previous = new Map<string, Article>();
      for (const item of this.textCacheArticles || []) previous.set(item.id, item);
      const current = new Map<string, Article>();
      for (const item of this.articles) current.set(item.id, item);
      this.plainText.forEach((_text: string, id: string) => {
        const before = previous.get(id); const after = current.get(id);
        if (!before || !after || before.content !== after.content) this.plainText.delete(id);
      });
      this.searchText.forEach((_text: string, id: string) => {
        const before = previous.get(id); const after = current.get(id);
        if (!before || !after || before.content !== after.content || before.title !== after.title ||
          before.author !== after.author) this.searchText.delete(id);
      });
    }
    this.textCacheArticles = this.articles;
    if (this.searchText.size === this.articles.length) this.indexedArticles = this.articles;
  }
  private async indexSearch(articles: Article[]): Promise<void> {
    const pending = articles.filter((article: Article) => !this.searchText.has(article.id));
    let index = 0;
    while (index < pending.length) {
      // Yield before the first batch too, so typing and clearing remain responsive.
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      if (articles !== this.articles || !this.query.trim()) {
        if (this.indexingArticles === articles) this.indexingArticles = undefined;
        return;
      }
      const start = Date.now();
      let count = 0;
      do {
        const article = pending[index++];
        if (!this.searchText.has(article.id)) {
          this.searchText.set(article.id, `${article.title} ${this.articleText(article)} ${article.author}`.toLowerCase());
        }
      } while (index < pending.length && ++count < 100 && Date.now() - start < 8);
    }
    this.indexedArticles = articles;
    this.indexingArticles = undefined;
    this.syncList();
  }
  private articleText(article: Article): string {
    let text = this.plainText.get(article.id);
    if (text === undefined) { text = textOnly(article.content); this.plainText.set(article.id, text); }
    return text;
  }
  private visible(): Article[] {
    this.syncTextCache();
    const folders = this.foldersByFeed();
    const now = new Date(this.calendarDay); const today = this.calendarDay;
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const query = this.query.trim().toLowerCase();
    const key = JSON.stringify([this.selectedFeed, this.selectedFolder, this.filter, `${this.showRead}`, query, `${today}`, `${this.searchPending}`]);
    if (this.visibleArticles === this.articles && this.visibleFolders === folders && this.visibleKey === key) return this.visibleCache;
    this.visibleArticles = this.articles; this.visibleFolders = folders; this.visibleKey = key;
    if (this.searchPending) { this.visibleCache = []; return this.visibleCache; }
    const ids = new Set(this.feeds.filter((f: Feed) => (!this.selectedFeed || f.id === this.selectedFeed) &&
      (!this.selectedFolder || f.folder === this.selectedFolder)).map((f: Feed) => f.id));
    // A changed filter uses saved reading decisions, but never drops the article being read.
    this.visibleCache = this.articles.filter((a: Article) => ids.has(a.feedId) &&
      (this.showRead || !this.articleState(a).read || a.id === this.article?.id) && (this.filter !== '星标' || a.starred) &&
      (this.filter !== '今天' || (a.published >= today && a.published < tomorrow)) &&
      (!query || (this.searchText.get(a.id) || '').includes(query)));
    return this.visibleCache;
  }
  private foldersByFeed(): Map<string, string> {
    if (this.membershipFeeds !== this.feeds) {
      if (this.feedFolders.size !== this.feeds.length || this.feeds.some((feed: Feed) =>
        !this.feedFolders.has(feed.id) || this.feedFolders.get(feed.id) !== feed.folder)) {
        this.feedFolders = new Map<string, string>();
        for (const feed of this.feeds) this.feedFolders.set(feed.id, feed.folder);
      }
      this.membershipFeeds = this.feeds;
    }
    return this.feedFolders;
  }
  private findFeed(id: string): Feed | undefined {
    if (this.lookupFeeds !== this.feeds) {
      this.feedsById.clear();
      for (const feed of this.feeds) this.feedsById.set(feed.id, feed);
      this.lookupFeeds = this.feeds;
    }
    return this.feedsById.get(id);
  }
  private feedTitle(id: string): string { return this.findFeed(id)?.title || id; }
  private rowDate(item: Article): string {
    const date = articleDate(item.published, new Date(this.calendarDay));
    return this.selectedFeed || !date ? date : ` · ${date}`;
  }
  private folderTitle(path: string): string { return (JSON.parse(path) as string[]).join(' / ') || '未分组'; }
  private articleState(article: Article): ReaderArticleState {
    return this.readingStates.get(article.id) || article;
  }
  private resumeReading(): void {
    if (this.article || !this.progress?.lastArticleId) return;
    const article = this.articles.find((item: Article) => item.id === this.progress?.lastArticleId);
    if (!article) return;
    this.chooseScope(article.feedId, '', '全部'); this.pendingResume = article;
    if (this.readingPaneReady) this.readingPaneShown();
  }
  private readingPaneShown(): void {
    this.readingPaneReady = true;
    const article = this.pendingResume; this.pendingResume = undefined;
    if (article) this.openArticle(article);
  }
  private beginReadingProgress(id: string): void {
    this.progressReady = false; this.progressDirty = false;
    this.progressY = this.progress?.position(id) || 0;
    this.restoreScrollY = this.progressY;
    this.progress?.visit(id).catch(() => { this.warnReadingProgress(); });
  }
  private warnReadingProgress(): void {
    if (!this.progressWarning) { this.progressWarning = true; this.toast('阅读进度未能保存'); }
  }
  private onReaderBackground(): void { if (this.readerInBackground) this.flushReadingProgress(); }
  private flushReadingProgress(): void {
    if (this.progressTimer !== -1) clearTimeout(this.progressTimer);
    this.progressTimer = -1;
    if (!this.article || !this.progress || !this.progressDirty) return;
    const id = this.article.id; const y = this.progressY;
    this.progressDirty = false;
    this.progress.save(id, y).catch(() => {
      if (this.article?.id === id) this.progressDirty = true;
      this.warnReadingProgress();
    });
  }
  private isCurrentReaderLocation(): boolean {
    const address = this.web.getUrl();
    if (this.isCurrentReaderDocument(address)) return true;
    // A footnote changes the fragment without replacing the validated document.
    return !!this.readerDocumentUrl && address.includes('#') && !address.includes('#xunzhi-load-') &&
      address.split('#')[0] === this.readerDocumentUrl.split('#')[0];
  }
  private recordReaderScroll(y: number): void {
    if (!this.progress || !this.article || !this.progressReady || this.readerError || this.mediaFullScreen || !Number.isFinite(y)) return;
    if (!this.isCurrentReaderLocation()) return;
    this.progressY = Math.max(0, y); this.progressDirty = true;
    // Throttle, rather than debounce: a long continuous scroll still reaches disk every second.
    if (this.progressTimer === -1) this.progressTimer = setTimeout(() => { this.flushReadingProgress(); }, 1000);
  }
  private restoreReadingProgress(finished: boolean): void {
    if (this.readerError) return;
    if (this.restoreScrollY > 0) this.web.scrollTo(0, this.restoreScrollY);
    if (finished || this.restoreScrollY === 0) {
      this.restoreScrollY = 0; this.progressReady = true;
    }
  }
  private openArticle(article: Article): void {
    if (this.busy || this.mediaFullScreen || this.article?.id === article.id) return;
    this.flushReadingProgress();
    this.cancelUnfold(); this.autoArticles = false;
    if (!this.listSplit) this.rememberListPosition();
    this.readingQueue = this.visible().map((item: Article): Article => ({
      id: item.id, feedId: item.feedId, title: item.title, link: item.link, content: item.content,
      published: item.published, author: item.author, language: item.language, read: this.articleState(item).read, starred: this.articleState(item).starred
    }));
    this.readerChromeVisible = true;
    this.loaded = false; this.readerError = false; this.restoreScrollY = 0;
    const state = this.articleState(article);
    this.article = { id: article.id, feedId: article.feedId, title: article.title, link: article.link,
      content: article.content, published: article.published, author: article.author, language: article.language,
      read: state.read, starred: state.starred };
    this.beginReadingProgress(article.id);
    if (this.readerPaths.size() === 0) this.readerPaths.pushPath({ name: 'article' });
    else this.loadReader();
  }
  private readerDidDisappear(): void {
    // A replaced destination may finish leaving after a new selection has opened.
    if (this.readerPaths.size() === 0) this.closeArticle();
  }
  private closeArticle(): void {
    if (!this.article) return;
    this.flushReadingProgress(); this.progressReady = false;
    this.cancelUnfold();
    if (this.readerFullScreen) this.setReaderFullScreen(false).catch(() => { this.toast('全屏显示未能更新'); });
    this.readerFooter.clear(); this.footerEmbedId = ''; this.footerVisible = false;
    this.article = undefined; this.readingQueue = []; this.restoreScrollY = 0;
    this.readerDocumentUrl = ''; this.readerDataPrefix = '';
    // A closed article no longer keeps its row through the read filter.
    this.visibleKey = '';
    if (this.busy) this.reloadOnIdle = true;
    else this.run(async () => { await this.reload(); });
  }
  private async markRead(): Promise<void> {
    const article = this.article;
    if (!article || this.loaded || this.readerError || !hasReaderBody(article.content)) return;
    this.loaded = true;
    try {
      await this.store.setState(article.id, 'read', true);
      this.readingStates.set(article.id, { read: true, starred: article.starred }); this.countArticles = undefined;
      const queued = this.readingQueue.find((item: Article) => item.id === article.id);
      if (queued) queued.read = true;
      // Keep the source list stable until the native navigation returns to it.
      if (this.article?.id === article.id) this.article = {
        id: article.id, feedId: article.feedId, title: article.title, link: article.link,
        content: article.content, published: article.published, author: article.author, language: article.language, read: true, starred: article.starred
      };
    } catch (error) { this.loaded = false; throw error as Error; }
  }
  private onReaderTouch(event: TouchEvent): void {
    if (this.mediaFullScreen || event.touches.length !== 1) return;
    const point = event.touches[0];
    if (event.type === TouchType.Down) {
      if (this.progress && this.isCurrentReaderLocation()) {
        this.restoreScrollY = 0; this.progressReady = true;
      }
      this.readerTouchX = point.displayX; this.readerTouchY = point.displayY;
    } else if (event.type === TouchType.Move) {
      const dx = point.displayX - this.readerTouchX;
      const dy = point.displayY - this.readerTouchY;
      // Screen coordinates avoid header resizing being mistaken for a reversed gesture.
      if (Math.abs(dy) >= 24 && Math.abs(dy) > Math.abs(dx)) {
        this.readerChromeVisible = dy > 0;
        this.readerTouchX = point.displayX; this.readerTouchY = point.displayY;
      }
    }
  }
  onBackPress(): boolean {
    this.pendingResume = undefined;
    if (this.paths.getAllPathName().slice(-1)[0] === 'settings') { this.paths.pop(); return true; }
    if (this.libraryDrawer) { this.libraryDrawer = false; return true; }
    if (!this.mediaFullScreen) {
      if (!this.readerFullScreen) {
        // Split Navigation keeps its last destination unless it is explicitly removed.
        if (this.readerPaths.size() > 0) { this.readerPaths.pop(); return true; }
        // Wide windows have no separate home; with target SDK 12+ Back from a home page backgrounds the app.
        if (this.isWide() && this.paths.size() === 1) { this.context().moveAbilityToBackground().catch(() => {}); return true; }
        if (this.paths.size() > 0) { this.paths.pop(); return true; }
        return false;
      }
      this.setReaderFullScreen(false).catch(() => { this.toast('全屏显示未能更新'); });
      return true;
    }
    const revision = this.mediaFullScreenRevision;
    const loadId = this.readerLoadId;
    this.getUIContext().runScopedTask(() => { this.mediaExit?.exitFullScreen(); });
    // shortcut: exitFullScreen did not respond on the SDK 26 test phone; reload stops playback but preserves the article.
    setTimeout(() => {
      if (!this.mediaFullScreen || this.mediaFullScreenRevision !== revision || this.readerLoadId !== loadId) return;
      this.restoreScrollY = this.mediaScrollY;
      this.loadReader();
      this.setMediaFullScreen(false).catch(() => {});
    }, 200);
    return true;
  }
  private async setMediaFullScreen(active: boolean): Promise<void> {
    this.mediaFullScreenRevision++;
    if (active) this.cancelUnfold();
    this.mediaFullScreen = active;
    await this.updateWindowFullScreen();
  }
  private async setReaderFullScreen(active: boolean): Promise<void> {
    this.cancelUnfold();
    this.readerFullScreen = active;
    this.readerChromeVisible = !active;
    await this.updateWindowFullScreen();
  }
  private updateWindowFullScreen(): Promise<void> {
    if (this.mediaFullScreen || this.readerFullScreen) this.libraryDrawer = false;
    // Window calls must finish in order even if Back arrives during entry.
    const update = this.windowFullScreenUpdate.catch(() => {}).then(() => this.applyWindowFullScreen());
    this.windowFullScreenUpdate = update;
    return update;
  }
  private async applyWindowFullScreen(): Promise<void> {
    const current = await window.getLastWindow(this.context());
    const active = this.mediaFullScreen || this.readerFullScreen;
    if (active && !this.fullScreenWindowActive) {
      this.previousNavigationIndicatorVisible =
        current.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR).bottomRect.height > 0;
    }
    if (active) this.fullScreenWindowActive = true;
    await current.setSpecificSystemBarEnabled('navigation', !active);
    await current.setSpecificSystemBarEnabled('navigationIndicator', !active && this.previousNavigationIndicatorVisible);
    await current.setWindowLayoutFullScreen(active);
    if (!active) {
      // Restore the page-owned status bar while the destination still fills Navigation.
      await new Promise<void>(resolve => {
        this.getUIContext().postFrameCallback(new ReaderFrame(resolve));
      });
      this.fullScreenWindowActive = this.mediaFullScreen || this.readerFullScreen;
    }
  }
  private async toggle(kind: string): Promise<void> {
    const article = this.article;
    if (!article) return;
    const value = kind === 'read' ? !article.read : !article.starred;
    await this.store.setState(article.id, kind, value);
    this.readingStates.set(article.id, { read: kind === 'read' ? value : article.read,
      starred: kind === 'star' ? value : article.starred }); this.countArticles = undefined;
    const queued = this.readingQueue.find((item: Article) => item.id === article.id);
    if (queued) { if (kind === 'read') queued.read = value; else queued.starred = value; }
    if (this.article?.id !== article.id) return;
    if (kind === 'read') this.loaded = true;
    this.article = { id: article.id, feedId: article.feedId, title: article.title, link: article.link,
      content: article.content, published: article.published, author: article.author, language: article.language,
      read: kind === 'read' ? value : article.read, starred: kind === 'star' ? value : article.starred };
  }
  private async share(): Promise<void> {
    if (!this.article) return;
    const data = new systemShare.SharedData({ utd: uniformTypeDescriptor.UniformDataType.TEXT,
      content: `${articleTitle(this.article)}\n${this.article.link || this.article.feedId}` });
    await new systemShare.ShareController(data).show(this.context(), {});
  }
  private nextUnread(): Article | undefined {
    const id = this.article?.id;
    // Revalidate the position by ID so replaced or reordered snapshots need no separate invalidation.
    if (this.readingQueue[this.readingQueuePosition]?.id !== id) {
      this.readingQueuePosition = this.readingQueue.findIndex((item: Article) => item.id === id);
    }
    const index = this.readingQueuePosition;
    for (let i = index + 1; i < this.readingQueue.length; i++) {
      const next = this.readingQueue[i];
      if (!next.read && this.findFeed(next.feedId)) return next;
    }
    for (let i = 0; i < index; i++) {
      const next = this.readingQueue[i];
      if (!next.read && this.findFeed(next.feedId)) return next;
    }
    return undefined;
  }
  private openNextUnread(): void {
    if (this.busy || this.mediaFullScreen) return;
    const next = this.nextUnread();
    if (!next) return;
    this.flushReadingProgress();
    this.article = next; this.loaded = false; this.readerChromeVisible = true;
    this.beginReadingProgress(next.id);
    this.loadReader();
  }
  private overrideLink(address: string): boolean {
    const original = this.article?.link || this.article?.feedId || '';
    if (address.startsWith('#') || (address.includes('#') && address.split('#')[0] === original.split('#')[0])) return false;
    if (/^https?:\/\//i.test(address)) {
      this.context().openLink(address).catch(() => { this.toast('无法打开链接，请稍后重试'); });
    }
    return true;
  }
  private confirmMarkAllRead(): void {
    const ids = this.visible().filter((item: Article) => !this.articleState(item).read).map((item: Article) => item.id);
    if (!ids.length || this.busy) return;
    this.showReaderAlert({ title: '全部标为已读？',
      message: `将「${this.scopeTitle()}${this.query ? ' · 当前搜索结果' : ''}」的 ${ids.length} 篇未读文章标为已读？`,
      primaryButton: { value: '取消', action: () => {} }, secondaryButton: { value: '标为已读', action: () => {
        this.run(async () => {
          await this.store.setReadStates(ids, true); this.undoReadIds = ids; await this.reload();
          this.toast(`已将 ${ids.length} 篇标为已读，可在列表底部撤销`);
        });
      } } });
  }
  private async undoMarkAllRead(): Promise<void> {
    const ids = this.undoReadIds.slice();
    await this.store.setReadStates(ids, false); this.undoReadIds = []; await this.reload();
    this.toast('已撤销标为已读');
  }
  private showReaderAlert(options: ReaderDialogOptions): void {
    this.readerDialog?.close();
    this.readerDialog = new CustomDialogController({ builder: ReaderDialog({ options }), autoCancel: true });
    this.readerDialog.open();
  }
  private toast(message: string): void {
    if (message) this.getUIContext().getPromptAction().showToast({ message });
  }
  private async openOriginal(): Promise<void> {
    if (this.article?.link) await this.context().openLink(resolveHttp(this.article.link));
  }
  private async importOpml(): Promise<void> {
    const source = await importFile(this.context()); if (source === undefined) return;
    const items = makeParser().importOpml(source);
    await this.store.saveSubscriptions(items); await this.reload();
    this.toast('订阅已导入，刷新后即可获取文章');
  }
  private async exportOpmlFile(): Promise<void> {
    const items: Subscription[] = this.feeds.map((f: Feed): Subscription => ({ url: f.id, title: f.title, folders: JSON.parse(f.folder) as string[] }));
    if (await exportFile(this.context(), exportOpml(items))) this.toast(`已导出 ${items.length} 个订阅`);
  }

  private scopeTitle(): string {
    return this.selectedFeed ? this.feedTitle(this.selectedFeed) : this.selectedFolder ? this.folderTitle(this.selectedFolder) : this.filter;
  }
  private hasHiddenReadArticles(): boolean {
    if (!this.ready || this.searchPending || this.query.trim() || this.showRead) return false;
    const today = new Date(this.calendarDay);
    const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime();
    return this.articles.some((article: Article) => {
      if (!article.read || (this.selectedFeed && article.feedId !== this.selectedFeed)) return false;
      const feed = this.findFeed(article.feedId);
      return !!feed && (!this.selectedFolder || feed.folder === this.selectedFolder) &&
        (this.filter !== '星标' || article.starred) &&
        (this.filter !== '今天' || (article.published >= this.calendarDay && article.published < tomorrow));
    });
  }
  private emptyListMessage(): string {
    if (this.searchPending) return '正在搜索…';
    if (!this.ready) return '正在打开…';
    if (this.query.trim()) return '没有找到相关文章';
    if (this.selectedFolder && !this.feeds.some((feed: Feed) => feed.folder === this.selectedFolder)) return '此文件夹还没有订阅';
    if (!this.feeds.length) return this.hasLibrarySidebar() ? '尚未添加订阅' : '从一个喜欢的网站开始';
    const hasRead = this.hasHiddenReadArticles();
    if (this.filter === '星标') return hasRead ? '没有未读的星标文章' : '喜欢的文章可以留在这里';
    if (this.filter === '今天') return hasRead ? '今天没有未读文章' : '今天还没有新文章';
    return hasRead ? '已经读完了' : '这里暂时没有文章';
  }
  private chooseScope(feed: string = '', folder: string = '', filter: string = '未读'): void {
    this.pendingResume = undefined;
    this.readerPaths.clear(); this.closeArticle(); this.libraryDrawer = false;
    this.listPosition = undefined; this.autoArticles = false;
    this.selectedFeed = feed; this.selectedFolder = folder; this.filter = filter;
    this.showRead = filter === '全部' || filter === '星标';
    this.query = ''; this.searching = false;
    this.paths.pushPath({ name: 'articles' }, { launchMode: LaunchMode.POP_TO_SINGLETON });
    this.listScroller.scrollTo({ xOffset: 0, yOffset: 0 });
  }
  private cacheUnreadCounts(): void {
    // Every count consumer must observe writes, including calls that reuse the cached totals.
    const states = this.readingStates;
    const folders = this.foldersByFeed();
    const now = new Date(this.calendarDay); const today = this.calendarDay;
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    if (this.countArticles === this.articles && this.countFolders === folders && this.countDay === today) return;
    this.countArticles = this.articles; this.countFolders = folders; this.countDay = today;
    this.unreadCounts.clear();
    for (const article of this.articles) {
      const state = states.get(article.id) || article;
      if (state.read || !folders.has(article.feedId)) continue;
      const keys = ['c:未读', `f:${article.feedId}`, `d:${folders.get(article.feedId)}`];
      if (state.starred) keys.push('c:星标');
      if (article.published >= today && article.published < tomorrow) keys.push('c:今天');
      for (const key of keys) this.unreadCounts.set(key, (this.unreadCounts.get(key) || 0) + 1);
    }
  }
  private unread(feed: string = '', folder: string = ''): number {
    this.cacheUnreadCounts();
    return this.unreadCounts.get(feed ? `f:${feed}` : folder ? `d:${folder}` : 'c:未读') || 0;
  }
  private collectionCount(filter: string): number {
    this.cacheUnreadCounts();
    return this.unreadCounts.get(`c:${filter}`) || 0;
  }
  private canRefresh(feedId: string = '', folder: string = ''): boolean {
    return this.ready && !this.busy && !this.refreshing &&
      this.feeds.some((feed: Feed) => (!feedId || feed.id === feedId) && (!folder || feed.folder === folder));
  }
  private async startRefresh(feedId: string = '', folder: string = ''): Promise<void> {
    if (this.refreshRunning) return;
    if (!this.canRefresh(feedId, folder)) {
      this.homeRefreshing = false; this.listRefreshing = false; this.refreshing = false; return;
    }
    this.refreshRunning = true; this.refreshing = true;
    try { await this.refresh(feedId, folder); } catch (_) { this.toast('暂时无法更新，仍可阅读已下载的文章'); }
    finally {
      this.refreshRunning = false; this.refreshing = false; this.refreshProgress = '';
      this.homeRefreshing = false; this.listRefreshing = false;
    }
  }
  private openSheet(title: string): void {
    this.cancelUnfold();
    this.invalidateLookup();
    this.sheet = title; this.sheetMessage = ''; this.sheetError = false; this.sheetEditing = false; this.showSheet = true;
    if (title === '开源许可' && !this.fontLicenses) {
      const decoder = util.TextDecoder.create('utf-8');
      this.fontLicenses = decoder.decodeToString(this.context().resourceManager.getRawFileContentSync('fonts/Literata-OFL.txt')) + '\n\n' +
        decoder.decodeToString(this.context().resourceManager.getRawFileContentSync('fonts/SourceHanSerif-LICENSE.txt'));
    }
    if (title === '添加订阅') { this.address = ''; this.candidates = []; }
  }
  private async saveAppearance(theme: string, size: number): Promise<void> {
    if (!this.appearance || this.savingAppearance) return;
    this.savingAppearance = true;
    const oldTheme = this.theme;
    const oldSize = this.fontSize;
    const sheet = this.showSheet ? this.sheet : '';
    const revision = this.addressRevision;
    if (sheet === '阅读设置') { this.sheetMessage = ''; this.sheetError = false; }
    try {
      this.context().getApplicationContext().setColorMode(readerColorMode(theme));
      this.theme = theme; this.fontSize = size;
      await this.appearance.save({ theme, fontSize: size });
    } catch (_) {
      this.context().getApplicationContext().setColorMode(readerColorMode(oldTheme));
      this.theme = oldTheme; this.fontSize = oldSize;
      if (sheet && this.showSheet && this.sheet === sheet && revision === this.addressRevision) {
        this.sheetMessage = '设置未能保存，请重试'; this.sheetError = true;
      } else this.toast('设置未能保存，请重试');
    } finally {
      if (this.readerFullScreen || this.mediaFullScreen) {
        // Reapply the page-owned status bar after the color-mode configuration renders.
        await new Promise<void>(resolve => { this.getUIContext().postFrameCallback(new ReaderFrame(resolve)); });
      }
      this.savingAppearance = false;
    }
  }
  private footerParams(): ReaderFooterParams {
    const next = this.nextUnread();
    return { width: this.footerWidth, height: this.footerHeight, title: next ? articleTitle(next) : '',
      fontSize: this.fontSize, enabled: !this.busy, next: () => { this.openNextUnread(); } };
  }
  private syncReaderFooter(): void { this.readerFooter.update(this.footerParams()); }
  private updateReaderFooter(event: NativeEmbedDataInfo): void {
    if (event.status === NativeEmbedStatus.DESTROY) {
      if (event.embedId === this.footerEmbedId) { this.readerFooter.clear(); this.footerEmbedId = ''; this.footerVisible = false; }
      return;
    }
    if (event.info?.id !== 'xunzhi-reader-footer' || event.info?.type !== 'native/xunzhi-footer') return;
    if (event.status === NativeEmbedStatus.CREATE && !event.surfaceId) return;
    if (event.status !== NativeEmbedStatus.CREATE && event.embedId !== this.footerEmbedId) return;
    const ui = this.getUIContext();
    this.footerX = ui.px2vp(Number(event.info.position?.x || 0));
    this.footerY = ui.px2vp(Number(event.info.position?.y || 0));
    const width = ui.px2vp(event.info.width || 0); const height = ui.px2vp(event.info.height || 0);
    const resized = width !== this.footerWidth || height !== this.footerHeight;
    this.footerWidth = width; this.footerHeight = height;
    this.footerEmbedId = event.embedId || '';
    if (event.status === NativeEmbedStatus.CREATE) this.readerFooter.setSurface(event.surfaceId!, this.footerParams());
    else if (resized) this.syncReaderFooter();
  }
  private loadReader(): void {
    if (!this.article) return;
    this.flushReadingProgress(); this.progressReady = false;
    this.readerError = false;
    try {
      const base = this.article.link || this.article.feedId;
      const marker = `<!--xunzhi-load:${++this.readerLoadId}-->`;
      // Align the prefix to a complete Base64 block; callbacks may report data URLs instead of historyUrl.
      const prefix = marker.padEnd(Math.ceil(marker.length / 3) * 3, ' ');
      this.readerDataPrefix = new util.Base64Helper().encodeToStringSync(new util.TextEncoder().encodeInto(prefix));
      this.readerDocumentUrl = `${base.split('#')[0]}#xunzhi-load-${this.readerLoadId}`;
      const prepared = prepareVideos(this.article.content, base, resolveHttp);
      // Native theme and text scaling update the existing document without resetting its reading position or media.
      this.readerFooter.clear(); this.footerEmbedId = ''; this.footerVisible = false;
      this.web.loadData(prefix + readerHtml(this.article, 18, 'system', prepared, this.feedTitle(this.article.feedId)), 'text/html', 'UTF-8',
        base, this.readerDocumentUrl);
    } catch (_) { this.failReader(); }
  }
  private isCurrentReaderDocument(address: string): boolean {
    if (!this.article || !this.readerDocumentUrl) return false;
    if (address === this.readerDocumentUrl) return true;
    if (!/^data:text\/html;(?:charset=[^;,]+;)?base64,/i.test(address)) return false;
    const start = address.indexOf(',') + 1;
    return address.startsWith(this.readerDataPrefix, start) || address.startsWith(encodeURIComponent(this.readerDataPrefix), start);
  }
  private failReader(): void {
    this.readerError = true; this.readerChromeVisible = true;
  }
  private readerMenus(): NavigationMenuItem[] {
    const items: NavigationMenuItem[] = [
      { value: this.article?.starred ? '取消星标' : '星标',
        symbolIcon: new SymbolGlyphModifier(this.article?.starred ? $r('sys.symbol.star_fill') : $r('sys.symbol.star'))
          .fontColor([this.article?.starred ? $r('app.color.reader_star') : $r('sys.color.icon_primary')]),
        isEnabled: !this.busy, action: () => { this.run(async () => this.toggle('star')); } },
      { value: '下一篇未读', symbolIcon: new SymbolGlyphModifier($r('sys.symbol.chevron_down')),
        isEnabled: !this.busy && !!this.nextUnread(), action: () => { this.openNextUnread(); } },
      { value: '分享', symbolIcon: new SymbolGlyphModifier($r('sys.symbol.share')),
        isEnabled: !this.busy, action: () => { this.run(async () => this.share()); } },
      // Like the star, the glyph shows the current state and the label names the action.
      { value: this.article?.read ? '标未读' : '标已读',
        symbolIcon: new SymbolGlyphModifier(this.article?.read ? $r('sys.symbol.circle') : $r('sys.symbol.smallcircle_filled_circle'))
          .fontColor([this.article?.read ? $r('sys.color.icon_primary') : $r('app.color.reader_accent')]),
        isEnabled: !this.busy, action: () => { this.run(async () => this.toggle('read')); } },
      { value: '在浏览器中打开', symbolIcon: new SymbolGlyphModifier($r('sys.symbol.arrow_right_up_and_square')),
        isEnabled: !!this.article?.link && !this.busy, action: () => { this.run(async () => this.openOriginal()); } },
      { value: this.readerFullScreen ? '退出全屏阅读' : '全屏阅读',
        symbolIcon: new SymbolGlyphModifier(this.readerFullScreen ? $r('sys.symbol.arrow_down_right_and_arrow_up_left') :
          $r('sys.symbol.arrow_up_left_and_arrow_down_right')),
        action: () => { this.setReaderFullScreen(!this.readerFullScreen).catch(() => { this.toast('全屏显示未能更新'); }); } },
      { value: '阅读设置', symbolIcon: new SymbolGlyphModifier($r('sys.symbol.textformat')),
        action: () => { this.openSheet('阅读设置'); } }
    ];
    if (this.article && /<video\b/i.test(this.article.content)) {
      items.push({ value: '重新加载视频', symbolIcon: new SymbolGlyphModifier($r('sys.symbol.arrow_clockwise')), action: () => {
        this.restoreScrollY = Math.max(0, this.web.getScrollOffset().y); this.loadReader();
      } });
    }
    return items;
  }
  private removeFeed(feed: Feed): void {
    this.showReaderAlert({ title: '取消订阅？', message: '已下载的文章和阅读记录会保留，再次订阅可以恢复。',
      primaryButton: { value: '保留', action: () => {} }, secondaryButton: { value: '取消订阅', action: () => {
        this.run(async () => {
          await this.store.removeFeed(feed.id);
          if (this.selectedFeed === feed.id) this.selectedFeed = '';
          await this.reload();
        });
      } } });
  }
  private removeFolder(folder: string): void {
    this.showReaderAlert({ title: '移除文件夹？', message: '订阅会移到未分组，文章和阅读记录保留。',
      primaryButton: { value: '取消', action: () => {} }, secondaryButton: { value: '移除', action: () => {
        this.run(async () => {
          await this.store.removeFolder(folder);
          if (this.selectedFolder === folder) this.selectedFolder = '';
          await this.reload();
        });
      } } });
  }
  private openSearch(all: boolean = false): void {
    if (!this.ready || this.busy) return;
    if (all) this.chooseScope('', '', '全部');
    else {
      this.showRead = true;
      if (this.filter === '未读') this.filter = '全部';
    }
    this.searching = true;
    this.getUIContext().postFrameCallback(new ReaderFrame(() => {
      if (this.searching && this.listIsVisible() && !this.showSheet) {
        this.getUIContext().getFocusController().requestFocus('article-search');
      }
    }));
  }
  private closeSearch(): void {
    this.query = ''; this.searching = false;
  }
  private libraryMenus(close: boolean = false): NavigationMenuItem[] {
    const items: NavigationMenuItem[] = [
      { value: '搜索文章', symbolIcon: new SymbolGlyphModifier($r('sys.symbol.magnifyingglass')),
        isEnabled: this.ready && !this.busy, action: () => { this.openSearch(true); } }
    ];
    if (close) items.push({ value: '关闭订阅', symbolIcon: new SymbolGlyphModifier($r('sys.symbol.xmark')),
      action: () => { this.libraryDrawer = false; } });
    return items;
  }
  private readingMenus(): NavigationMenuItem[] {
    return [
      { value: this.showRead ? '隐藏已读文章' : '显示已读文章',
        symbolIcon: new SymbolGlyphModifier($r('sys.symbol.funnel')).fontColor([this.showRead ? $r('sys.color.ohos_id_color_text_secondary') : $r('app.color.reader_accent')]),
        action: () => { this.showRead = !this.showRead; } },
      { value: '全部标为已读', symbolIcon: new SymbolGlyphModifier($r('sys.symbol.checkmark')),
        isEnabled: !this.busy && this.visible().some((item: Article) => !this.articleState(item).read), action: () => { this.confirmMarkAllRead(); } },
      { value: '刷新', symbolIcon: new SymbolGlyphModifier($r('sys.symbol.arrow_clockwise')),
        isEnabled: this.canRefresh(this.selectedFeed, this.selectedFolder),
        action: () => { this.startRefresh(this.selectedFeed, this.selectedFolder); } }
    ];
  }
  private feedIcon(id: string): string { return this.findFeed(id)?.icon || ''; }
  private activitySummary(): string {
    if (!this.ready) return '正在打开…';
    if (this.refreshing) return this.refreshProgress || '正在更新…';
    const failed = this.feeds.filter((feed: Feed) => !!feed.error).length;
    if (failed) return `${failed} 个订阅未能更新`;
    const checked = Math.max(0, ...this.feeds.map((feed: Feed) => feed.checked));
    if (!checked) return this.feeds.length ? '尚未更新' : '暂无活动';
    const minutes = Math.max(0, Math.floor((this.activityTime - checked) / 60000));
    const date = articleDate(checked, new Date(this.activityTime));
    // Chinese words run together; only a numeral is spaced from them.
    return minutes < 1 ? '刚刚更新' : minutes < 60 ? `${minutes} 分钟前更新` : `${date}${/\d$/.test(date) ? ' ' : ''}更新`;
  }
  private showFeedError(feed: Feed): void {
    this.showReaderAlert({ title: feed.title, message: feedError(feed.error),
      confirm: { value: '知道了', action: () => {} } });
  }
  private createFolder(): void {
    const name = this.folderName.trim();
    if (!name) return;
    const revision = this.addressRevision;
    this.run(async () => {
      await this.store.addFolder(JSON.stringify([name])); await this.reload();
      this.toast('文件夹已创建');
      if (revision !== this.addressRevision || !this.showSheet || this.sheet !== '新建文件夹') return;
      this.folderName = ''; this.showSheet = false;
    });
  }
  private moveFeed(folder: string): void {
    const feed = this.movingFeed;
    if (!feed) return;
    const revision = this.addressRevision;
    this.run(async () => {
      await this.store.moveFeed(feed.id, folder); await this.reload();
      this.toast('订阅已移动');
      if (revision === this.addressRevision && this.showSheet && this.sheet === '移动订阅') this.showSheet = false;
    });
  }
  @Builder
  choiceMenu(items: MenuElement[]) {
    Menu() {
      ForEach(items, (item: MenuElement) => {
        MenuItem({ content: item.value }).contentFont({ family: this.readerFont }).onClick(item.action)
      })
    }.font({ family: this.readerFont })
  }
  @Builder
  readerOverflow() {
    Menu() {
      ForEach(this.readerMenus().slice(2), (item: NavigationMenuItem) => {
        MenuItem({ symbolStartIcon: item.symbolIcon, content: item.value }).contentFont({ family: this.readerFont })
          .enabled(item.isEnabled !== false).onClick(() => { item.action?.(); })
      })
    }.font({ family: this.readerFont })
  }
  @Builder
  readerToolbar() {
    Row({ space: 8 }) {
      ForEach(this.readerMenus().slice(0, 2), (item: NavigationMenuItem) => {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph().attributeModifier(item.symbolIcon!).fontSize('24vp')
        }.width(40).height(40).responseRegion({ x: -4, y: -4, width: 48, height: 48 })
          .backgroundColor($r('sys.color.comp_background_tertiary')).accessibilityText(item.value as string)
          .enabled(item.isEnabled !== false).onClick(() => { item.action?.(); })
      })
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.ellipsis_circle')).fontSize('24vp').fontColor([$r('sys.color.icon_primary')])
      }.width(40).height(40).responseRegion({ x: -4, y: -4, width: 48, height: 48 })
        .backgroundColor($r('sys.color.comp_background_tertiary')).accessibilityText('更多阅读操作')
        .bindMenu(this.readerOverflow)
    }.height(56).padding({ left: 8, right: 16 })
  }
  @Builder
  feedSwipe(feed: Feed) {
    Row() {
      Button('移动').fontFamily(this.readerFont).type(ButtonType.Normal).width(64).height(48).fontSize(14).borderRadius(8)
        .labelStyle({ maxLines: 1, minFontSize: '14vp', maxFontSize: '14fp' })
        .fontColor($r('sys.color.ohos_id_color_text_primary')).backgroundColor(Color.Transparent)
        .onClick(() => { this.movingFeed = feed; this.openSheet('移动订阅'); })
      Button('取消订阅').fontFamily(this.readerFont).type(ButtonType.Normal).width(96).height(48).fontSize(14).borderRadius(8)
        .labelStyle({ maxLines: 1, minFontSize: '14vp', maxFontSize: '14fp' })
        .fontColor($r('app.color.reader_error')).backgroundColor(Color.Transparent)
        .onClick(() => { this.removeFeed(feed); })
    }.height(56).enabled(!this.busy && !this.refreshing)
  }
  @Builder
  sectionTitle(title: string) {
    Text(title).fontFamily(this.readerFont).fontSize(14).fontColor($r('sys.color.ohos_id_color_text_secondary'))
      .width('100%').textAlign(TextAlign.Start).padding({ left: 16, top: 16, bottom: 4 })
  }
  @Builder
  readingList() {
    Column({ space: 8 }) {
      if (this.searching) {
        Row({ space: 8 }) {
          Search({ value: this.query, placeholder: `${this.scopeTitle()} · 搜索标题、正文或作者` }).textFont({ family: this.readerFont }).placeholderFont({ family: this.readerFont })
            .id('article-search').defaultFocus(true).layoutWeight(1).onChange((value: string) => { this.query = value; })
          Button('取消').fontFamily(this.readerFont).height(48).backgroundColor(Color.Transparent).fontColor($r('app.color.reader_accent'))
            .onClick(() => { this.closeSearch(); })
        }.margin({ left: 8, right: 8 })
      }
      Refresh({ refreshing: $$this.listRefreshing }) {
        List({ scroller: this.listScroller }) {
          if (this.visible().length === 0) {
            ListItem() {
              Column({ space: 16 }) {
                if (this.searchPending) { LoadingProgress().width(32).height(32) }
                Text(this.emptyListMessage())
                  .fontSize(22).fontFamily(this.readerFont).textAlign(TextAlign.Center)
                if (this.query.trim()) {
                  Button('清空搜索').fontFamily(this.readerFont).height(48).onClick(() => { this.query = ''; })
                } else if (!this.feeds.length && !this.selectedFolder && !this.hasLibrarySidebar()) {
                  Button('添加订阅').fontFamily(this.readerFont).height(48).enabled(this.ready && !this.busy).onClick(() => { this.openSheet('添加订阅'); })
                  Button('导入 OPML 文件').fontFamily(this.readerFont).height(48).backgroundColor(Color.Transparent).fontColor($r('app.color.reader_accent'))
                    .enabled(this.ready && !this.busy).onClick(() => { this.run(async () => this.importOpml()); })
                } else if (this.hasHiddenReadArticles()) {
                  Button('查看全部').fontFamily(this.readerFont).height(48).onClick(() => { this.showRead = true; })
                }
              }.width('100%').padding({ top: 64, bottom: 64, left: 16, right: 16 })
            }
          }
          LazyForEach(this.listData, (item: Article) => {
            ListItem() {
              Column() {
                // The unread dot lives in its own gutter, so title, summary and source share one left edge.
                Row() {
                  Column() {
                    Blank().width(8).height(8).borderRadius(4).backgroundColor($r('app.color.reader_accent'))
                      .visibility(this.articleState(item).read ? Visibility.Hidden : Visibility.Visible)
                  }.width(20).padding({ top: 8 })
                  Column({ space: 3 }) {
                    Text(articleTitle(item)).fontFamily(this.articleState(item).read ? this.readerFont : this.headingFont).fontSize(17).lineHeight(24)
                      .fontWeight(this.articleState(item).read ? FontWeight.Normal : 600)
                      .fontColor($r('sys.color.ohos_id_color_text_primary'))
                      .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                    if (item.title.trim()) {
                      Text(this.articleText(item).slice(0, 180)).fontFamily(this.readerFont).fontSize(14).lineHeight(21).maxLines(2)
                        .textOverflow({ overflow: TextOverflow.Ellipsis })
                        .fontColor($r('sys.color.ohos_id_color_text_secondary'))
                    }
                    Row() {
                      if (!this.selectedFeed && this.feedIcon(item.feedId)) {
                        Image(fileUri.getUriFromPath(this.feedIcon(item.feedId))).width(14).height(14).borderRadius(3)
                          .objectFit(ImageFit.Contain).margin({ right: 6 }).accessibilityLevel('no')
                      }
                      if (!this.selectedFeed) {
                        Text(this.feedTitle(item.feedId)).fontFamily(this.readerFont).fontSize(12).lineHeight(18).maxLines(1)
                          .textOverflow({ overflow: TextOverflow.Ellipsis }).flexShrink(1)
                          .fontColor($r('sys.color.ohos_id_color_text_secondary'))
                      }
                      Text(this.rowDate(item)).fontFamily(this.readerFont).fontSize(12).lineHeight(18).maxLines(1).flexShrink(0)
                        .fontColor($r('sys.color.ohos_id_color_text_secondary'))
                      Blank()
                      if (this.articleState(item).starred) {
                        SymbolGlyph($r('sys.symbol.star_fill')).fontSize('14vp').fontColor([$r('app.color.reader_star')])
                          .margin({ left: 8 })
                      }
                    }.width('100%').margin({ top: 3 })
                  }.alignItems(HorizontalAlign.Start).layoutWeight(1)
                }.alignItems(VerticalAlign.Top).width('100%').padding({ top: 12, bottom: 12, right: 20 })
              }
            }.onClick(() => { this.openArticle(item); })
              .accessibilitySelected(this.article?.id === item.id)
              .backgroundColor(this.article?.id === item.id ? $r('app.color.reader_selection') : Color.Transparent)
              .borderRadius(12)
              .accessibilityText(`${articleTitle(item)}，${this.feedTitle(item.feedId)}，${this.articleState(item).read ? '已读' : '未读'}${this.articleState(item).starred ? '，已星标' : ''}`)
          }, (item: Article) => this.listData.key(item.id))
        }.width('100%').height('100%').scrollBar(BarState.Off).padding({ left: 8, right: 8 })
          // Rows run under the gesture bar, but the last one still scrolls clear of it.
          .contentEndOffset(this.undoReadIds.length ? 0 : this.bottomInset)
          .onScrollIndex((start: number) => { this.listFirstVisible = start; })
          .onTouch((event: TouchEvent) => { if (event.type === TouchType.Down) this.listPosition = undefined; })
      }.pullToRefresh(this.canRefresh(this.selectedFeed, this.selectedFolder))
        .onRefreshing(() => { this.startRefresh(this.selectedFeed, this.selectedFolder); }).layoutWeight(1)
    }.width('100%').height('100%')
  }
  @Builder
  feedMenu(feed: Feed) {
    Menu() {
      MenuItem({ content: '移到文件夹' }).contentFont({ family: this.readerFont }).enabled(!this.busy && !this.refreshing).onClick(() => {
        this.movingFeed = feed; this.openSheet('移动订阅');
      })
      if (feed.error) {
        MenuItem({ content: '查看更新错误' }).contentFont({ family: this.readerFont }).onClick(() => {
          this.showFeedError(feed);
        })
      }
      MenuItem({ content: '取消订阅' }).contentFont({ family: this.readerFont }).enabled(!this.busy && !this.refreshing).onClick(() => { this.removeFeed(feed); })
    }
  }
  @Builder
  feedRow(feed: Feed) {
    Row({ space: 12 }) {
      Row({ space: 12 }) {
        if (feed.icon && !this.failedIcons.includes(feed.icon)) {
          Image(fileUri.getUriFromPath(feed.icon)).width(28).height(28).objectFit(ImageFit.Contain).borderRadius(5)
            .onError(() => { if (feed.icon) this.failedIcons = [...this.failedIcons, feed.icon]; })
            .accessibilityLevel('no')
        } else {
          Text(feed.title.slice(0, 1).toUpperCase()).fontFamily(this.readerFont).fontSize('16vp').fontWeight(FontWeight.Medium)
            .fontColor($r('sys.color.ohos_id_color_text_primary')).textAlign(TextAlign.Center)
            .width(28).height(28).borderRadius(6).backgroundColor($r('sys.color.ohos_id_color_list_separator'))
        }
        Text(feed.title).fontFamily(this.readerFont).fontSize(17).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
          .fontColor($r('sys.color.ohos_id_color_text_primary')).layoutWeight(1)
          .focusable(true).onClick(() => { this.chooseScope(feed.id); })
        if (feed.error) {
          SymbolGlyph($r('sys.symbol.exclamationmark_circle')).fontSize('18vp').fontColor([$r('app.color.reader_error')])
            .width(48).height(48).accessibilityText('查看更新失败原因').onClick(() => { this.showFeedError(feed); })
        }
        if (this.unread(feed.id) > 0) {
          Text(`${this.unread(feed.id)}`).fontFamily(this.readerFont).fontSize(15).fontColor($r('sys.color.ohos_id_color_text_secondary'))
        }
      }.layoutWeight(1).constraintSize({ minHeight: 56 }).onClick(() => { this.chooseScope(feed.id); })
        .accessibilityText(`${feed.title}，${this.unread(feed.id)} 篇未读${feed.error ? '，更新失败' : ''}`)
    }.padding({ left: 16, right: 16 }).width('100%')
      .bindContextMenu(this.feedMenu(feed), ResponseType.LongPress)
  }
  @Builder
  folderHeader(folder: string, owner: string) {
    Row({ space: 8 }) {
      Button() {
        SymbolGlyph(this.collapsedFolders.includes(folder) ? $r('sys.symbol.chevron_right') : $r('sys.symbol.chevron_down'))
          .fontSize('16vp').fontColor([$r('sys.color.ohos_id_color_text_secondary')])
      }.type(ButtonType.Normal).width(48).height(48).backgroundColor(Color.Transparent)
        .accessibilityText(`${this.collapsedFolders.includes(folder) ? '展开' : '收起'} ${this.folderTitle(folder)}`)
        .onClick(() => {
          this.collapsedFolders = this.collapsedFolders.includes(folder) ?
            this.collapsedFolders.filter((item: string) => item !== folder) : this.collapsedFolders.concat(folder);
        })
      Text(this.folderTitle(folder)).fontFamily(this.readerFont).fontSize(16).fontWeight(FontWeight.Medium)
        .fontColor($r('sys.color.ohos_id_color_text_primary')).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1).constraintSize({ minHeight: 48 }).onClick(() => { this.chooseScope('', folder); })
        .accessibilityText(`${this.folderTitle(folder)}，${this.unread('', folder)} 篇未读，查看文章`)
      if (this.unread('', folder) > 0) {
        Text(`${this.unread('', folder)}`).fontFamily(this.readerFont).fontSize(15).fontColor($r('sys.color.ohos_id_color_text_secondary'))
      }
      Button() {
        SymbolGlyph($r('sys.symbol.ellipsis_circle')).fontSize('20vp').fontColor([$r('sys.color.ohos_id_color_text_secondary')])
      }.type(ButtonType.Normal).width(48).height(48).backgroundColor(Color.Transparent)
        .accessibilityText(`管理文件夹 ${this.folderTitle(folder)}`).enabled(!this.busy && !this.refreshing)
        .onClick(() => { this.folderMenu = JSON.stringify([owner, folder]); })
        .bindMenu(this.folderMenu === JSON.stringify([owner, folder]), this.choiceMenu([{ value: '查看文章', action: () => { this.chooseScope('', folder); } },
          { value: '移除文件夹', action: () => { this.removeFolder(folder); } }]),
          { onDisappear: () => { if (this.folderMenu === JSON.stringify([owner, folder])) this.folderMenu = ''; } })
    }.width('100%').padding({ top: 12, bottom: 4 })
  }
  @Builder
  library(owner: string = 'home') {
    List({ space: 12 }) {
      if (this.feeds.length) {
      ListItemGroup({ style: ListItemGroupStyle.CARD }) {
        ForEach(['今天', '未读', '星标'], (filter: string) => {
          ListItem() {
            Row({ space: 12 }) {
              SymbolGlyph(filter === '今天' ? $r('sys.symbol.sun_max_fill') : filter === '未读' ? $r('sys.symbol.smallcircle_filled_circle') :
                $r('sys.symbol.star_fill'))
                .fontSize('24vp').width(28).fontColor([filter === '星标' ? $r('app.color.reader_star') : $r('app.color.reader_accent')])
              Text(filter).fontFamily(this.readerFont).fontSize(17).fontColor($r('sys.color.ohos_id_color_text_primary')).layoutWeight(1)
              if (this.collectionCount(filter) > 0) {
                Text(`${this.collectionCount(filter)}`).fontFamily(this.readerFont).fontSize(15).fontColor($r('sys.color.ohos_id_color_text_secondary'))
              }
            }.width('100%').padding({ left: 16, right: 16 }).constraintSize({ minHeight: 56 })
          }.onClick(() => { this.chooseScope('', '', filter); }).accessibilityText(`${filter}，${this.collectionCount(filter)} 篇未读`)
        })
      }.divider({ strokeWidth: 0.5, color: $r('sys.color.ohos_id_color_list_separator'), startMargin: 56, endMargin: 16 })
      }
      if (!this.feeds.length) {
        ListItem() {
          Column({ space: 16 }) {
            Text(this.ready ? '从一个喜欢的网站开始' : '正在打开…').fontFamily(this.readerFont).fontSize(22)
            Button('添加订阅').fontFamily(this.readerFont).height(48).enabled(this.ready && !this.busy).onClick(() => { this.openSheet('添加订阅'); })
            Button('导入 OPML 文件').fontFamily(this.readerFont).height(48).backgroundColor(Color.Transparent).fontColor($r('app.color.reader_accent'))
              .enabled(this.ready && !this.busy).onClick(() => { this.run(async () => this.importOpml()); })
          }.width('100%').padding({ top: 64, bottom: 64 })
        }
      }
      if (this.feeds.some((feed: Feed) => feed.folder === '[]')) {
        ListItemGroup({ style: ListItemGroupStyle.CARD, header: this.sectionTitle('我的订阅') }) {
          ForEach(this.feeds.filter((feed: Feed) => feed.folder === '[]'), (feed: Feed) => {
            ListItem() { this.feedRow(feed) }.swipeAction({ end: this.feedSwipe(feed) })
          }, (feed: Feed) => JSON.stringify([feed.id, feed.title, feed.folder, feed.error, feed.icon]))
        }.clip(true).divider({ strokeWidth: 0.5, color: $r('sys.color.ohos_id_color_list_separator'), startMargin: 56, endMargin: 16 })
      }
      ForEach(this.folders, (folder: string) => {
        ListItemGroup({ style: ListItemGroupStyle.CARD }) {
          ListItem() { this.folderHeader(folder, owner) }
          if (!this.collapsedFolders.includes(folder)) {
            ForEach(this.feeds.filter((feed: Feed) => feed.folder === folder), (feed: Feed) => {
              ListItem() { this.feedRow(feed) }.swipeAction({ end: this.feedSwipe(feed) })
            }, (feed: Feed) => JSON.stringify([feed.id, feed.title, feed.folder, feed.error, feed.icon]))
          }
        }.clip(true).divider({ strokeWidth: 0.5, color: $r('sys.color.ohos_id_color_list_separator'), startMargin: 56, endMargin: 16 })
      }, (folder: string) => folder)
    }.scrollBar(BarState.Off).contentEndOffset(72).width('100%').height('100%')
      .backgroundColor($r('app.color.reader_canvas'))
  }
  @Builder
  homeActions(owner: string = 'home') {
    Row({ space: 8 }) {
      Button() {
        SymbolGlyph($r('sys.symbol.gearshape')).fontSize('24vp').fontColor([$r('sys.color.ohos_id_color_text_primary')])
      }.type(ButtonType.Normal).width(48).height(48).backgroundColor(Color.Transparent).accessibilityText('设置')
        .onClick(() => { this.libraryDrawer = false; this.paths.pushPath({ name: 'settings' }, { launchMode: LaunchMode.POP_TO_SINGLETON }); })
      Button(this.activitySummary()).fontFamily(this.readerFont).type(ButtonType.Normal).layoutWeight(1).height(48)
        .fontSize(12).fontColor($r('sys.color.ohos_id_color_text_secondary')).backgroundColor(Color.Transparent)
        .id(`activity-${owner}`).accessibilityText(`当前活动，${this.activitySummary()}`)
        .onClick(() => { this.activateFocusAction(`activity-${owner}`, () => { this.openSheet('当前活动'); }); })
      Button() {
        SymbolGlyph($r('sys.symbol.plus')).fontSize('24vp').fontColor([$r('sys.color.ohos_id_color_text_primary')])
      }.type(ButtonType.Normal).width(48).height(48).backgroundColor(Color.Transparent).accessibilityText('添加')
        .enabled(this.ready).onClick(() => { this.addMenuOwner = owner; })
        .bindMenu(this.addMenuOwner === owner, this.choiceMenu([{ value: '新订阅', action: () => { this.openSheet('添加订阅'); } },
          { value: '新建文件夹', action: () => { this.openSheet('新建文件夹'); } }]),
          { onDisappear: () => { if (this.addMenuOwner === owner) this.addMenuOwner = ''; } })
    }.width('100%').height(56).padding({ left: 12, right: 12 })
  }
  @Builder
  errorMenu(feed: Feed) {
    Menu() {
      MenuItem({ content: '复制错误详情' }).contentFont({ family: this.readerFont }).onClick(() => { this.run(async () => {
        await pasteboard.getSystemPasteboard().setData(pasteboard.createData(pasteboard.MIMETYPE_TEXT_PLAIN, feed.error));
        this.toast('错误详情已复制');
      }); })
    }
  }
  @Builder
  currentActivity() {
    Column({ space: 16 }) {
      Text(`${this.feeds.length} 个订阅 · ${this.activitySummary()}`).fontFamily(this.readerFont).fontSize(16)
      ForEach(this.feeds.filter((feed: Feed) => !!feed.error), (feed: Feed) => {
        Column({ space: 8 }) {
          Row({ space: 8 }) {
            if (feed.icon) { Image(fileUri.getUriFromPath(feed.icon)).width(28).height(28).objectFit(ImageFit.Contain) }
            Text(feed.title).fontFamily(this.readerFont).fontSize(16).fontWeight(FontWeight.Medium).layoutWeight(1)
          }
          Text(feedError(feed.error)).fontFamily(this.readerFont).fontSize(14).fontColor($r('app.color.reader_error'))
          Text(feed.checked ? `上次成功更新：${articleDate(feed.checked, new Date(this.activityTime), true)}` : '尚未成功更新').fontFamily(this.readerFont)
            .fontSize(12).fontColor($r('sys.color.ohos_id_color_text_secondary'))
          Row({ space: 12 }) {
            Button('重试').fontFamily(this.readerFont).type(ButtonType.Normal).height(48).backgroundColor(Color.Transparent).fontColor($r('app.color.reader_accent'))
              .enabled(this.canRefresh(feed.id)).onClick(() => { this.startRefresh(feed.id); })
            Button('打开网站').fontFamily(this.readerFont).type(ButtonType.Normal).height(48).backgroundColor(Color.Transparent).fontColor($r('app.color.reader_accent'))
              .onClick(() => { this.run(async () => { await this.context().openLink(resolveHttp(feed.site || feed.id)); }); })
          }
        }.alignItems(HorizontalAlign.Start).width('100%')
          .bindContextMenu(this.errorMenu(feed), ResponseType.LongPress)
      }, (feed: Feed) => JSON.stringify([feed.id, feed.title, feed.error, feed.icon, feed.checked, feed.site]))
      Button('刷新订阅').fontFamily(this.readerFont).width('100%').height(48).enabled(this.canRefresh())
        .onClick(() => { this.startRefresh(); })
    }.alignItems(HorizontalAlign.Start).width('100%')
  }
  @Builder
  appearanceControls() {
    Column({ space: 16 }) {
      Row({ space: 8 }) {
        ForEach(['system', 'light', 'dark'], (theme: string) => {
          Button(theme === 'system' ? '系统' : theme === 'light' ? '浅色' : '深色').fontFamily(this.readerFont)
            .type(ButtonType.Normal).layoutWeight(1).height(48).borderRadius(12)
            .backgroundColor(theme === 'dark' ? '#151515' : theme === 'light' ? '#FCFCFB' : $r('app.color.reader_surface'))
            .fontColor(theme === 'dark' ? '#F2F3EF' : theme === 'light' ? '#202420' : $r('sys.color.ohos_id_color_text_primary'))
            .border({ radius: 12, width: this.theme === theme ? 2 : 1, color: this.theme === theme ? $r('app.color.reader_accent') : $r('sys.color.ohos_id_color_list_separator') })
            .enabled(this.ready && this.appearance !== undefined && !this.savingAppearance)
            .accessibilityText(`${theme === 'system' ? '跟随系统' : theme === 'light' ? '浅色' : '深色'}${this.theme === theme ? '，已选择' : ''}`)
            .onClick(() => { this.saveAppearance(theme, this.fontSize); })
        })
      }.width('100%')
      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween, alignItems: ItemAlign.Center }) {
        Text('正文字号').fontFamily(this.readerFont).fontSize(16).padding({ right: 12 })
        Row({ space: 12 }) {
          Button() {
            Text('A−').fontFamily(this.readerFont).fontSize(16).fontColor($r('app.color.reader_accent'))
          }.constraintSize({ minWidth: 48, minHeight: 48 }).padding(12).backgroundColor(Color.Transparent)
            .accessibilityText('减小字号').enabled(!!this.appearance && !this.savingAppearance && this.fontSize > 14)
            .onClick(() => { this.saveAppearance(this.theme, this.fontSize - 2); })
          Text(`${this.fontSize}`).fontFamily(this.readerFont).fontSize(16)
          Button() {
            Text('A+').fontFamily(this.readerFont).fontSize(16).fontColor($r('app.color.reader_accent'))
          }.constraintSize({ minWidth: 48, minHeight: 48 }).padding(12).backgroundColor(Color.Transparent)
            .accessibilityText('增大字号').enabled(!!this.appearance && !this.savingAppearance && this.fontSize < 30)
            .onClick(() => { this.saveAppearance(this.theme, this.fontSize + 2); })
        }.padding({ top: 4, bottom: 4 })
      }.width('100%')
    }.alignItems(HorizontalAlign.Start).width('100%')
  }
  @Builder
  settingsRow(title: string, action: () => void, enabled: boolean) {
    Row() {
      Text(title).fontFamily(this.readerFont).fontSize(17).layoutWeight(1)
      SymbolGlyph($r('sys.symbol.chevron_right')).fontSize('16vp').fontColor([$r('sys.color.ohos_id_color_text_secondary')])
    }.width('100%').constraintSize({ minHeight: 56 }).padding({ left: 16, right: 16 })
      .id(title).enabled(enabled).onClick(() => { this.activateFocusAction(title, action); })
      .accessibilityText(title).accessibilityLevel('yes')
  }
  @Builder
  subscriptionFooter() {
    Text('OPML 包含订阅和文件夹，不含文章、已读记录及星标。\n暂不支持多设备同步。').fontFamily(this.readerFont)
      .fontSize(12).fontColor($r('sys.color.ohos_id_color_text_secondary'))
      .width('100%').textAlign(TextAlign.Start).padding(16)
  }
  @Builder
  settings() {
    List({ space: 12 }) {
      ListItemGroup({ style: ListItemGroupStyle.CARD, header: this.sectionTitle('阅读') }) {
        ListItem() { Column() { this.appearanceControls() }.padding(16) }
      }
      ListItemGroup({ style: ListItemGroupStyle.CARD, header: this.sectionTitle('订阅'), footer: this.subscriptionFooter() }) {
        ListItem() { this.settingsRow('导入 OPML 文件', () => { this.run(async () => this.importOpml()); }, this.ready && !this.busy) }
        ListItem() { this.settingsRow('导出 OPML 文件', () => { this.run(async () => this.exportOpmlFile()); }, this.ready && !this.busy && this.feeds.length > 0) }
      }.divider({ strokeWidth: 0.5, color: $r('sys.color.ohos_id_color_list_separator'), startMargin: 16, endMargin: 16 })
      ListItemGroup({ style: ListItemGroupStyle.CARD, header: this.sectionTitle('关于') }) {
        ListItem() {
          Column({ space: 8 }) {
            Text('讯枝').fontFamily(this.readerFont).fontSize(18).fontWeight(FontWeight.Medium)
            Text(this.version).fontFamily(this.readerFont).fontSize(14).fontColor($r('sys.color.ohos_id_color_text_secondary'))
          }.width('100%').alignItems(HorizontalAlign.Start).padding(16)
            .bindContextMenu(this.developerMenu(), ResponseType.LongPress)
        }
        ListItem() { this.settingsRow('开源许可', () => { this.openSheet('开源许可'); }, true) }
      }.divider({ strokeWidth: 0.5, color: $r('sys.color.ohos_id_color_list_separator'), startMargin: 16, endMargin: 16 })
    }.scrollBar(BarState.Off).contentEndOffset(this.bottomInset + 12).width('100%').height('100%')
      .backgroundColor($r('app.color.reader_canvas'))
  }
  @Builder
  developerMenu() {
    Menu() { MenuItem({ content: '开发工具' }).contentFont({ family: this.readerFont }).onClick(() => { router.pushUrl({ url: 'pages/Probe' }); }) }
  }
  @Builder
  sheetTitle() {
    Text(this.sheet).fontFamily(this.headingFont).fontSize(20).fontWeight(600).maxLines(2)
      .padding({ left: 24, right: 56, top: 16, bottom: 16 }).width('100%')
  }
  @Builder
  sheetContent() {
    Column({ space: 16 }) {
        if (this.sheet === '开源许可') {
          Text('讯枝是独立的 HarmonyOS 应用，与 NetNewsWire 官方无隶属关系。').fontFamily(this.readerFont).fontSize(16)
          Text('字体：Literata、思源宋体（SIL OFL 1.1）。开发与测试依赖：Hypium、Hamock（Apache-2.0）。').fontFamily(this.readerFont).fontSize(14)
          Scroll() { Text(this.fontLicenses).fontFamily(this.readerFont).fontSize(14).textAlign(TextAlign.Start).copyOption(CopyOptions.InApp) }.height(280).width('100%')
          Button('Apache License 2.0').fontFamily(this.readerFont).height(48).onClick(() => { this.context().openLink('https://www.apache.org/licenses/LICENSE-2.0').catch(() => { this.toast('无法打开许可页面'); }); })
        }
        else if (this.sheet === '当前活动') { this.currentActivity() }
        else if (this.sheet === '阅读设置') { this.appearanceControls() }
        else if (this.sheet === '移动订阅' && this.movingFeed) {
          Text(this.movingFeed.title).fontFamily(this.readerFont).fontSize(18).fontColor($r('sys.color.ohos_id_color_text_primary'))
          ForEach(['[]'].concat(this.folders), (folder: string) => {
            Button() {
              Row({ space: 12 }) {
                SymbolGlyph($r('sys.symbol.folder')).fontSize('22vp').fontColor([$r('sys.color.ohos_id_color_text_secondary')])
                Text(this.folderTitle(folder)).fontFamily(this.readerFont).fontSize(16).fontColor($r('sys.color.ohos_id_color_text_primary')).layoutWeight(1)
                if (this.movingFeed?.folder === folder) {
                  SymbolGlyph($r('sys.symbol.checkmark')).fontSize('20vp').fontColor([$r('app.color.reader_accent')])
                }
              }.width('100%').constraintSize({ minHeight: 48 })
            }.type(ButtonType.Normal).width('100%').backgroundColor(Color.Transparent).enabled(!this.busy && !this.refreshing)
              .accessibilityText(`移到${this.folderTitle(folder)}`).onClick(() => {
                this.moveFeed(folder);
              })
          }, (folder: string) => folder)
        } else if (this.sheet === '新建文件夹') {
          TextInput({ text: this.folderName, placeholder: '文件夹名称' }).fontFamily(this.readerFont).defaultFocus(true).enterKeyType(EnterKeyType.Done)
            .onEditChange((editing: boolean) => { this.sheetEditing = editing; })
            .onChange((value: string) => { this.folderName = value; this.invalidateLookup(); this.sheetMessage = ''; }).onSubmit(() => { this.createFolder(); })
          Button('新建').fontFamily(this.readerFont).width('100%').height(48).enabled(!this.busy && !!this.folderName.trim()).onClick(() => { this.createFolder(); })
        } else {
          TextInput({ text: this.address, placeholder: '网站或订阅地址' }).fontFamily(this.readerFont).type(InputType.URL).defaultFocus(true).enterKeyType(EnterKeyType.Go)
            .onEditChange((editing: boolean) => { this.sheetEditing = editing; })
            .onSubmit(() => { if (this.address.trim()) this.run(async () => this.add(this.address)); })
            .onChange((value: string) => { this.address = value; this.invalidateLookup(); this.candidates = []; this.sheetMessage = ''; })
          if (this.sheetMessage) { Text(this.sheetMessage).fontFamily(this.readerFont).fontSize(14).fontColor(this.sheetError ? $r('app.color.reader_error') : $r('sys.color.ohos_id_color_text_secondary')).width('100%') }
          Text('粘贴网站或 RSS / Atom / JSON Feed 地址').fontFamily(this.readerFont).fontSize(14)
            .fontColor($r('sys.color.ohos_id_color_text_secondary'))
          PasteButton().fontFamily(this.readerFont).height(48).backgroundColor($r('app.color.reader_surface'))
            .fontColor($r('app.color.reader_accent')).iconColor($r('app.color.reader_accent'))
            .onClick((_event: ClickEvent, result: PasteButtonOnClickResult) => {
            if (result === PasteButtonOnClickResult.SUCCESS) this.run(async () => {
              const revision = this.addressRevision;
              const data = await pasteboard.getSystemPasteboard().getData().catch(() => {
                throw new Error('无法读取剪贴板，请重试');
              });
              if (!this.showSheet || this.sheet !== '添加订阅' || revision !== this.addressRevision) return;
              const value = data.getPrimaryText().trim();
              if (!/^https?:\/\//i.test(value)) { this.sheetMessage = '剪贴板中没有网站地址'; this.sheetError = true; return; }
              this.address = value; this.invalidateLookup(); this.candidates = []; this.sheetMessage = '';
            });
          })
          Button('查找订阅').fontFamily(this.readerFont).width('100%').height(48).enabled(!this.busy && !!this.address.trim())
            .onClick(() => { this.run(async () => this.add(this.address)); })
          ForEach(this.candidates, (candidate: string) => {
            Column({ space: 4 }) {
              Text(this.candidateTitles.get(candidate) || `订阅源 ${this.candidates.indexOf(candidate) + 1}`).fontFamily(this.readerFont).fontSize(16)
              Text(candidate).fontFamily(this.readerFont).fontSize(12).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
                .fontColor($r('sys.color.ohos_id_color_text_secondary'))
            }.alignItems(HorizontalAlign.Start).width('100%').padding({ top: 12, bottom: 12 })
              .enabled(!this.busy).onClick(() => { this.run(async () => this.add(candidate)); })
          })
        }
        if (this.sheetMessage && this.sheet !== '添加订阅') { Text(this.sheetMessage).fontFamily(this.readerFont).fontSize(14).fontColor(this.sheetError ? $r('app.color.reader_error') : $r('sys.color.ohos_id_color_text_secondary')).width('100%') }
    }.alignItems(HorizontalAlign.Start).width('100%').padding(20)
  }
  @Builder
  sidebarActions() {
    this.homeActions('sidebar')
  }
  @Builder
  libraryPane() {
    Navigation() {
      Refresh({ refreshing: $$this.homeRefreshing }) { this.library('sidebar') }
        .pullToRefresh(this.canRefresh()).onRefreshing(() => { this.startRefresh(); }).width('100%').height('100%').clip(true)
    }.title('订阅', { mainTitleModifier: this.headingModifier }).titleMode(NavigationTitleMode.Mini).hideBackButton(true)
      .toolbarConfiguration(this.sidebarActions, { barStyle: BarStyle.STACK, backgroundBlurStyle: BlurStyle.COMPONENT_THICK })
      .menus(this.libraryMenus(!this.hasLibrarySidebar()))
      .mode(NavigationMode.Stack).width('100%').height('100%').backgroundColor($r('app.color.reader_canvas'))
  }
  @Builder
  readerPlaceholder() {
    // An empty article column should look intended, not like a page that failed to render.
    Column({ space: 12 }) {
      SymbolGlyph($r('sys.symbol.doc_text')).fontSize('48vp').fontColor([$r('sys.color.icon_fourth')])
      Text('未选择文章').fontFamily(this.readerFont).fontSize(14).fontColor($r('sys.color.font_tertiary'))
    }.width('100%').height('100%').justifyContent(FlexAlign.Center).padding({ left: this.listPaneWidth() })
      .hitTestBehavior(HitTestMode.None)
  }
  @Builder
  readingActionMenu() {
    Menu() {
      ForEach(this.readingMenus(), (item: NavigationMenuItem) => {
        MenuItem({ symbolStartIcon: item.symbolIcon, content: item.value }).contentFont({ family: this.readerFont }).enabled(item.isEnabled !== false)
          .onClick(() => { item.action?.(); })
      })
    }
  }
  @Builder
  readingActions() {
    // Same geometry as the native title-bar buttons: 40vp circles, 24vp symbols, 8vp gaps (also after a long title), 16vp end inset.
    Row({ space: 8 }) {
      if (this.isWide() && !this.hasLibrarySidebar()) {
        Button({ type: ButtonType.Circle }) {
          SymbolGlyph($r('sys.symbol.open_sidebar')).fontSize('24vp').fontColor([$r('sys.color.icon_primary')])
        }.width(40).height(40).responseRegion({ x: -4, y: -4, width: 48, height: 48 }).backgroundColor($r('sys.color.comp_background_tertiary')).accessibilityText('订阅')
          .onClick(() => { this.libraryDrawer = !this.libraryDrawer; })
      }
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.magnifyingglass')).fontSize('24vp').fontColor([$r('sys.color.icon_primary')])
      }.width(40).height(40).responseRegion({ x: -4, y: -4, width: 48, height: 48 }).backgroundColor($r('sys.color.comp_background_tertiary'))
        .accessibilityText('搜索文章').enabled(this.ready && !this.busy)
        .onClick(() => { this.openSearch(); })
      Button({ type: ButtonType.Circle }) {
        SymbolGlyph($r('sys.symbol.dot_grid_2x2')).fontSize('24vp').fontColor([$r('sys.color.icon_primary')])
      }.width(40).height(40).responseRegion({ x: -4, y: -4, width: 48, height: 48 }).backgroundColor($r('sys.color.comp_background_tertiary')).accessibilityText('文章列表操作')
        .bindMenu(this.readingActionMenu)
    }.height(56).padding({ left: 8, right: 16 })
  }
  @Builder
  readingPane() {
    Navigation(this.readerPaths) {
        Column() {
          Column() { this.readingList() }.layoutWeight(1).width('100%')
          if (this.undoReadIds.length) {
            Row({ space: 12 }) {
              Text(`已将 ${this.undoReadIds.length} 篇标为已读`).fontFamily(this.readerFont).layoutWeight(1).fontSize(14)
              Button('撤销').fontFamily(this.readerFont).backgroundColor(Color.Transparent).fontColor($r('app.color.reader_accent')).height(48)
                .enabled(!this.busy).onClick(() => { this.run(async () => this.undoMarkAllRead()); })
              Button('关闭').fontFamily(this.readerFont).backgroundColor(Color.Transparent).fontColor($r('sys.color.ohos_id_color_text_secondary')).height(48)
                .onClick(() => { this.undoReadIds = []; })
            }.padding({ left: 16, right: 16, bottom: this.bottomInset }).width('100%')
          }
        }.width('100%').height('100%')
    }.title({ main: this.scopeTitle(), sub: this.searchPending ? '' : this.showRead ? `共 ${this.visible().length} 篇` : `${this.visible().filter((item: Article) => !this.articleState(item).read).length} 篇未读` },
      { backgroundColor: $r('app.color.reader_background'), mainTitleModifier: this.headingModifier, subTitleModifier: this.textModifier })
      .titleMode(NavigationTitleMode.Mini).hideBackButton(this.isWide()).menus(this.readingActions)
      .navDestination(this.readerDestination).mode(this.fullScreenWindowActive ? NavigationMode.Stack : NavigationMode.Auto)
      .navBarWidth(this.unfolding ? this.unfoldNavWidth : this.listPaneWidth())
      .navBarWidthRange(this.unfolding ? [1, this.windowWidth] : [280 * this.layoutScale(), 360 * this.layoutScale()])
      .minContentWidth(this.unfolding ? 1 : this.hasLibrarySidebar() ? 440 : 320)
      .onNavigationModeChange((mode: NavigationMode) => { this.setListSplit(mode === NavigationMode.Split); })
      .hideNavBar(this.fullScreenWindowActive)
      .ignoreLayoutSafeArea([LayoutSafeAreaType.SYSTEM], [LayoutSafeAreaEdge.BOTTOM])
      .width('100%').height('100%').backgroundColor($r('app.color.reader_background'))
  }
  @Builder
  destination(name: string) {
    if (name === 'articles') {
      NavDestination() {
        // Native columns grow with system text; the Web reader has its own font setting.
        SideBarContainer(this.hasLibrarySidebar() ? SideBarContainerType.Embed : SideBarContainerType.Overlay) {
          this.libraryPane()
          Stack() {
            this.readingPane()
            if (this.listSplit && !this.article && this.visible().length) { this.readerPlaceholder() }
            if (this.libraryDrawer && !this.fullScreenWindowActive && !this.hasLibrarySidebar()) {
              // As with the system's overlay panels, the columns behind dim and a tap there closes the drawer.
              Column().width('100%').height('100%').backgroundColor('#33000000')
                .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
                .transition(TransitionEffect.OPACITY.animation({ duration: 250, curve: Curve.Friction }))
                .accessibilityLevel('no').onClick(() => { this.libraryDrawer = false; })
            }
          }.width('100%').height('100%').expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
        }.sideBarWidth(this.libraryPaneWidth()).minSideBarWidth(this.libraryPaneWidth()).maxSideBarWidth(this.libraryPaneWidth())
          .minContentWidth(this.hasLibrarySidebar() ? 320 * this.layoutScale() + 440 : 0)
          .showSideBar(!this.fullScreenWindowActive && (this.hasLibrarySidebar() || this.libraryDrawer))
          .showControlButton(false)
          .onChange((shown: boolean) => { if (!this.hasLibrarySidebar()) this.libraryDrawer = shown; })
          .width('100%').height('100%').expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
      }.hideTitleBar(true).onBackPressed(() => this.onBackPress())
        .onShown(() => { this.readingPaneShown(); })
        .onHidden(() => { this.readingPaneReady = false; })
        .backgroundColor($r('app.color.reader_background'))
    } else if (name === 'settings') {
      NavDestination() {
        Column() {
          Column() { this.settings() }.layoutWeight(1).width('100%')
        }.width('100%').height('100%')
      }.title('设置', { mainTitleModifier: this.headingModifier }).onBackPressed(() => this.onBackPress())
        .ignoreLayoutSafeArea([LayoutSafeAreaType.SYSTEM], [LayoutSafeAreaEdge.BOTTOM])
    }
  }
  @Builder
  readerDestination(name: string) {
      NavDestination() {
        Stack() {
          NodeContainer(this.readerFooter).position({ x: this.footerX, y: this.footerY }).width(this.footerWidth).height(this.footerHeight)
            .visibility(this.footerVisible ? Visibility.Visible : Visibility.Hidden)
          Web({ src: '', controller: this.web }).javaScriptAccess(false).fileAccess(false).domStorageAccess(false)
            .mixedMode(MixedMode.None).onlineImageAccess(true).height('100%').width('100%')
            .darkMode(this.theme === 'dark' ? WebDarkMode.On : this.theme === 'light' ? WebDarkMode.Off : WebDarkMode.Auto)
            .textZoomRatio(Math.round(this.fontSize / 18 * 100))
            .backgroundColor($r('app.color.reader_background'))
            .verticalScrollBarAccess(false).horizontalScrollBarAccess(false).overScrollMode(OverScrollMode.NEVER)
            .onTouch((event: TouchEvent) => { this.onReaderTouch(event); })
            .onScroll((event) => { this.recordReaderScroll(event.yOffset); })
            .visibility(this.readerError ? Visibility.Hidden : Visibility.Visible)
            .enableNativeEmbedMode(true).registerNativeEmbedRule('embed', 'native/xunzhi-footer')
            .nativeEmbedOptions({ supportCssDisplayChange: true })
            .onNativeEmbedLifecycleChange((event) => { this.updateReaderFooter(event); })
            .onNativeEmbedVisibilityChange((event) => {
              if (event.embedId === this.footerEmbedId) this.footerVisible = event.visibility;
            })
            .onNativeEmbedGestureEvent((event) => {
              event.result?.setGestureEventResult(event.embedId === this.footerEmbedId && this.readerFooter.postTouch(event.touchEvent));
            })
            .onInterceptRequest((event) => readerFontResponse(event.request.getRequestUrl())!)
            .onControllerAttached(() => { this.loadReader(); })
            .onRenderExited(() => { this.failReader(); })
            .onErrorReceive((event) => { if (event.request.isMainFrame() && this.isCurrentReaderDocument(event.request.getRequestUrl())) this.failReader(); })
            .onHttpErrorReceive((event) => { if (event.request.isMainFrame() && this.isCurrentReaderDocument(event.request.getRequestUrl())) this.failReader(); })
            .onOverrideUrlLoading((request: WebResourceRequest) => this.overrideLink(request.getRequestUrl()))
            .onFullScreenEnter((event) => { this.mediaScrollY = Math.max(0, this.web.getScrollOffset().y); this.mediaExit = event.handler; this.setMediaFullScreen(true).catch(() => {}); })
            .onFullScreenExit(() => { this.mediaExit = undefined; this.setMediaFullScreen(false).catch(() => {}); })
            // Readable text must not wait for remote images to finish loading.
            .onPageVisible((event) => { if (this.isCurrentReaderDocument(event.url)) { this.restoreReadingProgress(false); if (this.article && textOnly(this.article.content)) this.run(async () => this.markRead()); } })
            .onPageEnd((event) => {
              if (!event || !this.isCurrentReaderDocument(event.url)) return;
              this.restoreReadingProgress(true);
              this.run(async () => { await this.markRead(); });
            })
          if (this.readerError) {
            Column({ space: 12 }) {
              Text('正文暂时无法显示').fontFamily(this.readerFont).fontSize(18).fontColor($r('sys.color.ohos_id_color_text_primary'))
              Button('重试').fontFamily(this.readerFont).height(48).enabled(!this.busy).onClick(() => { this.loadReader(); })
              if (this.article?.link) {
                Button('打开原文').fontFamily(this.readerFont).height(48).backgroundColor(Color.Transparent).fontColor($r('app.color.reader_accent'))
                  .enabled(!this.busy).onClick(() => { this.run(async () => this.openOriginal()); })
              }
            }.width('100%').height('100%').justifyContent(FlexAlign.Center).padding({ top: 56, left: 20, right: 20 })
          }
        }.width(this.fullScreenWindowActive && this.unfolding ? this.windowWidth - this.unfoldNavWidth : '100%')
          .position({ x: this.fullScreenWindowActive && this.unfolding ? this.unfoldNavWidth : 0, y: 0 })
          .height('100%').clip(true)
      }.title('', { barStyle: BarStyle.STACK, backgroundColor: Color.Transparent,
        backgroundEffect: { radius: 24, saturation: 0, brightness: 1, color: $r('app.color.reader_chrome_mask') } })
        .backgroundColor($r('app.color.reader_background'))
        // The article runs under the gesture bar; the document pads its end with the safe-area inset.
        .ignoreLayoutSafeArea([LayoutSafeAreaType.SYSTEM], [LayoutSafeAreaEdge.BOTTOM])
        .hideTitleBar(this.mediaFullScreen || !this.readerChromeVisible, !this.mediaFullScreen)
        .enableStatusBar(this.fullScreenWindowActive && !this.savingAppearance && (this.mediaFullScreen || this.readerFullScreen) ? false : undefined, true)
        .enableNavigationIndicator(this.fullScreenWindowActive && (this.mediaFullScreen || this.readerFullScreen) ? false : undefined)
        .onBackPressed(() => this.onBackPress())
        // onPop is a result callback; native back without a result still destroys the destination.
        .onWillDisappear(() => { this.readerDidDisappear(); })
        .menus(this.readerToolbar)
  }
  build() {
    Navigation(this.paths) {
      Refresh({ refreshing: $$this.homeRefreshing }) { this.library() }
        .pullToRefresh(this.canRefresh()).onRefreshing(() => { this.startRefresh(); }).width('100%').height('100%').clip(true)
    }.title('订阅', { mainTitleModifier: this.headingModifier }).titleMode(NavigationTitleMode.Mini).hideBackButton(true)
      .menus(this.libraryMenus())
      .toolbarConfiguration(this.homeActions, { barStyle: BarStyle.STACK, backgroundBlurStyle: BlurStyle.COMPONENT_THICK })
      .navDestination(this.destination).mode(NavigationMode.Stack)
      .onSizeChange((_oldSize: SizeOptions, size: SizeOptions) => { this.resizeWindow(Number(size.width)); })
      .expandSafeArea([SafeAreaType.SYSTEM], [SafeAreaEdge.TOP, SafeAreaEdge.BOTTOM])
      .width('100%').height('100%').backgroundColor($r('app.color.reader_canvas'))
      .linearGradientBlur(this.unfoldBlur, { fractionStops: [[1, 0], [0.125, 0.25], [0, 0.5], [0, 1]], direction: GradientDirection.Right })
      .bindSheet($$this.showSheet, this.sheetContent(), { title: this.sheetTitle,
        height: this.sheetEditing && this.keyboardVisible ? SheetSize.LARGE : this.sheet === '移动订阅' || this.sheet === '当前活动' ? SheetSize.MEDIUM : SheetSize.FIT_CONTENT,
        maskColor: '#33000000', keyboardAvoidMode: SheetKeyboardAvoidMode.RESIZE_ONLY,
        onDisappear: () => { this.sheetEditing = false; this.invalidateLookup(); this.candidates = []; this.sheetMessage = ''; this.restoreActionFocus(true); } })
  }
}
