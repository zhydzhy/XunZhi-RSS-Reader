import { Article } from './Feed';

export class ReaderArticleSource implements IDataSource {
  revision: number = 0;
  private items: Article[] = [];
  private keys: Map<string, string> = new Map();
  private listeners: DataChangeListener[] = [];
  totalCount(): number { return this.items.length; }
  getData(index: number): Article { return this.items[index]; }
  key(id: string): string { return this.keys.get(id)!; }
  private sameArticle(a: Article, b: Article): boolean {
    return a.id === b.id && a.feedId === b.feedId && a.title === b.title && a.content === b.content &&
      a.link === b.link && a.published === b.published && a.author === b.author && a.language === b.language &&
      a.read === b.read && a.starred === b.starred;
  }
  replace(items: Article[]): void {
    if (items === this.items) return;
    const previous = new Map<string, Article>();
    for (const item of this.items) previous.set(item.id, item);
    const keys = new Map<string, string>();
    this.revision++;
    items.forEach((item: Article) => {
      const old = previous.get(item.id);
      // Keep unchanged native rows, but never retain a closure over stale article content.
      keys.set(item.id, old && (old === item || this.sameArticle(old, item)) ? this.keys.get(item.id)! : `${this.revision}:${item.id}`);
    });
    this.items = items; this.keys = keys;
    for (const listener of this.listeners) listener.onDataReloaded();
  }
  registerDataChangeListener(listener: DataChangeListener): void {
    if (!this.listeners.includes(listener)) this.listeners.push(listener);
  }
  unregisterDataChangeListener(listener: DataChangeListener): void {
    this.listeners = this.listeners.filter((item: DataChangeListener) => item !== listener);
  }
}
