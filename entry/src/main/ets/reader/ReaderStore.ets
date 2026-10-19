import { common } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';
import { Article, Feed, ParsedFeed, Subscription } from './Feed';

// P2 local data remains separate from the P0 cloud probe; enable business cloud tables only after schema/account isolation validation.
export class ReaderStore {
  private userName: string;
  private cacheName: string;
  private userDb?: relationalStore.RdbStore;
  private cacheDb?: relationalStore.RdbStore;
  constructor(userName: string = 'reader_user.db', cacheName: string = 'reader_cache.db') {
    this.userName = userName; this.cacheName = cacheName;
  }
  private get user(): relationalStore.RdbStore {
    if (!this.userDb) throw new Error('用户资料库尚未打开');
    return this.userDb;
  }
  private get cache(): relationalStore.RdbStore {
    if (!this.cacheDb) throw new Error('文章缓存尚未打开');
    return this.cacheDb;
  }
  async open(context: common.UIAbilityContext): Promise<void> {
    this.userDb = await relationalStore.getRdbStore(context, { name: this.userName, securityLevel: relationalStore.SecurityLevel.S1 });
    this.cacheDb = await relationalStore.getRdbStore(context, { name: this.cacheName, securityLevel: relationalStore.SecurityLevel.S1 });
    if (this.user.version > 1 || this.cache.version > 1) throw new Error('数据库版本较新，请使用新版应用');
    await this.user.executeSql('CREATE TABLE IF NOT EXISTS Subscription (id TEXT PRIMARY KEY, title TEXT, folder TEXT)');
    await this.user.executeSql('CREATE TABLE IF NOT EXISTS Folder (id TEXT PRIMARY KEY)');
    await this.user.executeSql('CREATE TABLE IF NOT EXISTS ArticleState (id TEXT PRIMARY KEY, articleId TEXT, kind TEXT, value INTEGER)');
    await this.cache.executeSql('CREATE TABLE IF NOT EXISTS FeedCache (id TEXT PRIMARY KEY, title TEXT, site TEXT, etag TEXT, modified TEXT, checked DOUBLE, error TEXT)');
    await this.cache.executeSql('CREATE TABLE IF NOT EXISTS Article (id TEXT PRIMARY KEY, feedId TEXT, title TEXT, link TEXT, content TEXT, published DOUBLE, author TEXT)');
    await this.cache.executeSql('CREATE INDEX IF NOT EXISTS article_feed ON Article(feedId)');
    this.user.version = 1; this.cache.version = 1;
  }
  async close(): Promise<void> { await this.cache.close(); await this.user.close(); }
  async subscriptions(): Promise<Feed[]> {
    const metadata = new Map<string, Feed>();
    const cached = await this.cache.querySql('SELECT * FROM FeedCache');
    try {
      while (cached.goToNextRow()) metadata.set(this.string(cached, 'id'), { id: this.string(cached, 'id'), title: this.string(cached, 'title'),
        site: this.string(cached, 'site'), folder: '[]', etag: this.string(cached, 'etag'), modified: this.string(cached, 'modified'),
        checked: cached.getDouble(cached.getColumnIndex('checked')), error: this.string(cached, 'error') });
    } finally { cached.close(); }
    const rows: Feed[] = [];
    const result = await this.user.querySql('SELECT * FROM Subscription ORDER BY title COLLATE NOCASE');
    try {
      while (result.goToNextRow()) {
        const id = this.string(result, 'id');
        const item: Feed = metadata.get(id) ?? { id, title: id, site: '', folder: '[]', etag: '', modified: '', checked: 0, error: '' };
        item.title = this.string(result, 'title') || item.title;
        item.folder = this.string(result, 'folder') || '[]'; rows.push(item);
      }
    } finally { result.close(); }
    return rows;
  }
  private string(result: relationalStore.ResultSet, field: string): string {
    const index = result.getColumnIndex(field); return result.isColumnNull(index) ? '' : result.getString(index);
  }
  async folders(): Promise<string[]> {
    const result = await this.user.querySql('SELECT id FROM Folder ORDER BY id'); const rows: string[] = [];
    try { while (result.goToNextRow()) rows.push(this.string(result, 'id')); } finally { result.close(); }
    return rows;
  }
  async addFolder(path: string): Promise<void> {
    if ((JSON.parse(path) as string[]).length === 0) return;
    await this.user.insert('Folder', { id: path }, relationalStore.ConflictResolution.ON_CONFLICT_IGNORE);
  }
  async saveSubscriptions(items: Subscription[]): Promise<void> {
    this.user.beginTransaction();
    try {
      for (const item of items) {
        const folder = JSON.stringify(item.folders);
        await this.addFolder(folder);
        await this.user.insert('Subscription', { id: item.url, title: item.title, folder }, relationalStore.ConflictResolution.ON_CONFLICT_IGNORE);
      }
      this.user.commit();
    } catch (error) { this.user.rollBack(); throw error as Error; }
  }
  async moveFeed(id: string, folder: string): Promise<void> {
    await this.addFolder(folder);
    await this.user.update({ folder }, new relationalStore.RdbPredicates('Subscription').equalTo('id', id));
  }
  async removeFeed(id: string): Promise<void> {
    await this.user.delete(new relationalStore.RdbPredicates('Subscription').equalTo('id', id));
    // Cached content and state survive unsubscribe; re-adding the source restores reading state.
  }
  async removeFolder(path: string): Promise<void> {
    this.user.beginTransaction();
    try {
      await this.user.update({ folder: '[]' }, new relationalStore.RdbPredicates('Subscription').equalTo('folder', path));
      await this.user.delete(new relationalStore.RdbPredicates('Folder').equalTo('id', path));
      this.user.commit();
    } catch (error) { this.user.rollBack(); throw error as Error; }
  }
  async saveRefresh(feed: Feed, parsed: ParsedFeed | undefined, etag: string, modified: string): Promise<void> {
    this.cache.beginTransaction();
    try {
      if (parsed) for (const item of parsed.articles) await this.cache.insert('Article', { id: item.id, feedId: feed.id,
        title: item.title, link: item.link, content: item.content, published: item.published, author: item.author },
        relationalStore.ConflictResolution.ON_CONFLICT_REPLACE);
      await this.cache.insert('FeedCache', { id: feed.id, title: parsed?.title || feed.title, site: parsed?.site || feed.site,
        etag, modified, checked: Date.now(), error: '' }, relationalStore.ConflictResolution.ON_CONFLICT_REPLACE);
      this.cache.commit();
    } catch (error) { this.cache.rollBack(); throw error as Error; }
  }
  async error(feed: Feed, message: string): Promise<void> {
    await this.cache.insert('FeedCache', { id: feed.id, title: feed.title, site: feed.site, etag: feed.etag,
      modified: feed.modified, checked: feed.checked, error: message }, relationalStore.ConflictResolution.ON_CONFLICT_REPLACE);
  }
  async articles(feedIds: string[]): Promise<Article[]> {
    if (!feedIds.length) return [];
    const read = new Set<string>(); const starred = new Set<string>();
    const states = await this.user.querySql('SELECT articleId,kind FROM ArticleState WHERE value = 1');
    try { while (states.goToNextRow()) (this.string(states, 'kind') === 'read' ? read : starred).add(this.string(states, 'articleId')); }
    finally { states.close(); }
    const result = await this.cache.query(new relationalStore.RdbPredicates('Article').in('feedId', feedIds).orderByDesc('published').orderByAsc('id'));
    const rows: Article[] = [];
    try {
      while (result.goToNextRow()) {
        const id = this.string(result, 'id');
        rows.push({ id, feedId: this.string(result, 'feedId'), title: this.string(result, 'title'), link: this.string(result, 'link'),
          content: this.string(result, 'content'), published: result.getDouble(result.getColumnIndex('published')),
          author: this.string(result, 'author'), read: read.has(id), starred: starred.has(id) });
      }
    } finally { result.close(); }
    return rows;
  }
  async setState(id: string, kind: string, value: boolean): Promise<void> {
    if (!['read', 'star'].includes(kind)) throw new Error('未知文章状态');
    await this.user.insert('ArticleState', { id: `${kind}:${id}`, articleId: id, kind, value: value ? 1 : 0 },
      relationalStore.ConflictResolution.ON_CONFLICT_REPLACE);
  }
}
