export interface XmlNode {
  _name?: string;
  _type?: string;
  _text?: string;
  _cdata?: string;
  _attributes?: Record<string, string>;
  _elements?: XmlNode[];
}
export interface Article {
  id: string;
  feedId: string;
  title: string;
  link: string;
  content: string;
  published: number;
  author: string;
  read: boolean;
  starred: boolean;
}
export interface Feed {
  id: string;
  title: string;
  site: string;
  folder: string;
  etag: string;
  modified: string;
  checked: number;
  error: string;
}
export interface ParsedFeed { title: string; site: string; articles: Article[]; }
export interface Subscription { url: string; title: string; folders: string[]; }
interface JsonItem {
  id?: string;
  url?: string;
  title?: string;
  content_html?: string;
  content_text?: string;
  summary?: string;
  date_published?: string;
  authors?: JsonAuthor[];
  author?: JsonAuthor;
}
interface JsonAuthor { name?: string; }
interface JsonFeed {
  version?: string;
  title?: string;
  home_page_url?: string;
  items?: JsonItem[];
}
export type ResolveUrl = (value: string, base: string) => string;
export type ReadXml = (source: string) => XmlNode;
export const MAX_SOURCE = 4 * 1024 * 1024;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function textOnly(value: string): string {
  const punctuation: Record<string, string> = { lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    ndash: '–', mdash: '—', hellip: '…', nbsp: ' ' };
  return value.replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&(lsquo|rsquo|ldquo|rdquo|ndash|mdash|hellip|nbsp);/g,
      (_entity: string, name: string): string => punctuation[name])
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}
export function guardSource(source: string): void {
  if (!source.trim() || source.length > MAX_SOURCE) throw new Error('订阅文件为空或超过 4 MB');
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('不接受包含 DTD 或实体声明的文件');
}
function name(node: XmlNode): string { return (node._name ?? '').split(':').pop()!.toLowerCase(); }
function children(node: XmlNode, tag: string): XmlNode[] {
  return (node._elements ?? []).filter((n: XmlNode) => name(n) === tag);
}
function child(node: XmlNode, tag: string): XmlNode {
  return children(node, tag)[0] ?? {};
}
function content(node: XmlNode): string {
  return (node._text ?? node._cdata ?? '') + (node._elements ?? []).map((n: XmlNode) => content(n)).join('');
}
function field(node: XmlNode, tag: string): string { return content(child(node, tag)).trim(); }
function attr(node: XmlNode, key: string): string { return node._attributes?.[key] ?? (key === 'xml:base' ? node._attributes?.['base'] ?? '' : ''); }
function serialize(node: XmlNode): string {
  if (!node._name) return escapeHtml(content(node));
  let attributes = '';
  const attrs = node._attributes ?? {};
  for (const key of Object.keys(attrs)) attributes += ` ${key}="${escapeHtml(attrs[key])}"`;
  return `<${node._name}${attributes}>${(node._elements ?? []).map((n: XmlNode) => serialize(n)).join('')}</${node._name}>`;
}
function body(node: XmlNode, atomText: boolean = false): string {
  if (!node._name) return '';
  if (attr(node, 'type') === 'xhtml') return (node._elements ?? []).map((n: XmlNode) => serialize(n)).join('');
  if (attr(node, 'type') === 'text' || (atomText && !attr(node, 'type'))) return `<p>${escapeHtml(content(node))}</p>`;
  return content(node);
}
function timestamp(value: string): number {
  const n = Date.parse(value); return Number.isFinite(n) ? n : 0;
}
// Version 1 IDs retain the original subscription URL across HTTP redirects.
export function articleId(feed: string, key: string): string {
  return `v1:${encodeURIComponent(feed)}:${encodeURIComponent(key)}`;
}
export class FeedParser {
  constructor(private resolve: ResolveUrl, private xml: ReadXml) {}

  private link(value: string, base: string): string {
    if (!value.trim()) return '';
    try { return this.resolve(value, base); } catch (_) { return ''; }
  }

  parse(source: string, feedId: string, base: string = feedId): ParsedFeed {
    guardSource(source);
    if (source.trimStart().startsWith('{')) return this.json(source, feedId, base);
    const document = this.xml(source);
    const root = (document._elements ?? []).find((n: XmlNode) => !!n._name);
    if (!root) throw new Error('未找到订阅根节点');
    const kind = name(root);
    if (!['rss', 'rdf', 'feed'].includes(kind)) throw new Error('不是 RSS、Atom 或 JSON Feed');
    const channel = kind === 'feed' ? root : child(root, 'channel');
    if (!channel._name) throw new Error('RSS 缺少 channel');
    const feedBase = this.link(attr(root, 'xml:base'), base) || base;
    const items = kind === 'feed' ? children(root, 'entry') : children(kind === 'rdf' ? root : channel, 'item');
    if (items.length > 2000) throw new Error('单个订阅超过 2000 篇，未写入');
    const result: ParsedFeed = { title: textOnly(field(channel, 'title')) || feedId,
      site: kind === 'feed' ? this.atomLink(channel, feedBase) : this.link(field(channel, 'link'), feedBase), articles: [] };
    const seen = new Set<string>();
    for (const item of items) {
      const itemBase = this.link(attr(item, 'xml:base'), feedBase) || feedBase;
      const link = kind === 'feed' ? this.atomLink(item, itemBase) : this.link(field(item, 'link'), itemBase);
      const title = textOnly(field(item, 'title')) || '无标题';
      const date = field(item, 'published') || field(item, 'pubdate') || field(item, 'date') || field(item, 'updated');
      const key = field(item, 'guid') || field(item, 'id') || link || `${title}\n${date}`;
      const id = articleId(feedId, key);
      if (seen.has(id)) continue;
      seen.add(id);
      const rich = child(item, 'encoded');
      const atom = child(item, 'content');
      const description = child(item, kind === 'feed' ? 'summary' : 'description');
      result.articles.push({ id, feedId, title, link, content: body(rich) || body(atom, true) || body(description, kind === 'feed'),
        published: timestamp(date), author: field(item, 'creator') || field(child(item, 'author'), 'name') || field(item, 'author'),
        read: false, starred: false });
    }
    return result;
  }

  private atomLink(node: XmlNode, base: string): string {
    const link = children(node, 'link').find((n: XmlNode) => ['', 'alternate'].includes(attr(n, 'rel')));
    return link ? this.link(attr(link, 'href'), base) : '';
  }

  private json(source: string, feedId: string, base: string): ParsedFeed {
    const data = JSON.parse(source) as JsonFeed;
    if (!data || typeof data.version !== 'string' || !/^https:\/\/jsonfeed.org\/version\/(1|1.1)$/.test(data.version) ||
      typeof data.title !== 'string' || !Array.isArray(data.items)) throw new Error('JSON Feed 结构无效');
    if (data.items.length > 2000) throw new Error('单个订阅超过 2000 篇，未写入');
    const result: ParsedFeed = { title: data.title, site: this.link(data.home_page_url ?? '', base), articles: [] };
    const seen = new Set<string>();
    for (const item of data.items) {
      if (!item || typeof item.id !== 'string' || !item.id) throw new Error('JSON Feed 文章缺少字符串 id');
      for (const value of [item.url, item.title, item.content_html, item.content_text, item.summary, item.date_published]) {
        if (value !== undefined && typeof value !== 'string') throw new Error('JSON Feed 字段类型无效');
      }
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      result.articles.push({ id: articleId(feedId, item.id), feedId,
        title: item.title || textOnly(item.summary || item.content_text || '').slice(0, 80) || '无标题',
        link: this.link(item.url ?? '', base), content: item.content_html || `<p>${escapeHtml(item.content_text || item.summary || '')}</p>`,
        published: timestamp(item.date_published ?? ''), author: item.authors?.[0]?.name || item.author?.name || '',
        read: false, starred: false });
    }
    return result;
  }

  importOpml(source: string): Subscription[] {
    guardSource(source);
    const root = child(this.xml(source), 'opml');
    if (!root._name) throw new Error('不是 OPML 文件');
    const result: Subscription[] = [];
    this.outlines(child(root, 'body'), [], result);
    return result;
  }

  private outlines(node: XmlNode, folders: string[], result: Subscription[]): void {
    if (folders.length > 20 || result.length > 1000) throw new Error('OPML 层级或订阅数量超过限制');
    for (const outline of children(node, 'outline')) {
      const raw = attr(outline, 'xmlUrl');
      const title = attr(outline, 'title') || attr(outline, 'text');
      if (raw) {
        if (result.length >= 1000) throw new Error('OPML 订阅数量超过 1000');
        result.push({ url: this.resolve(raw, ''), title: title || raw, folders });
      }
      else this.outlines(outline, [...folders, title || '未命名文件夹'], result);
    }
  }
}
export function exportOpml(subscriptions: Subscription[]): string {
  return '<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>讯枝订阅</title></head><body>' +
    exportOutlines(subscriptions, 0) + '</body></opml>';
}
function exportOutlines(items: Subscription[], depth: number): string {
  let result = '';
  const groups = new Set<string>();
  for (const item of items) {
    if (item.folders.length === depth) result += `<outline type="rss" text="${escapeHtml(item.title)}" xmlUrl="${escapeHtml(item.url)}"/>`;
    else groups.add(item.folders[depth]);
  }
  for (const group of groups) result += `<outline text="${escapeHtml(group)}">` +
    exportOutlines(items.filter((s: Subscription) => s.folders[depth] === group), depth + 1) + '</outline>';
  return result;
}
export function readerHtml(article: Article, fontSize: number): string {
  const size = Math.max(14, Math.min(30, fontSize));
  return '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: http: data:; style-src \'unsafe-inline\'; base-uri https: http:; form-action \'none\'; frame-src \'none\'">' +
    `<base href="${escapeHtml(article.link || article.feedId)}"><style>` +
    `:root{color-scheme:light dark}body{font:${size}px/1.8 system-ui;margin:24px auto;padding:0 22px;max-width:720px;overflow-wrap:anywhere}` +
    'h1{font-size:1.6em;line-height:1.35}img,video{max-width:100%;height:auto}pre{overflow:auto;padding:12px;background:#8882}blockquote{border-left:3px solid #888;padding-left:16px}a{color:#2675d8}table{display:block;overflow:auto}iframe,form,object,embed{display:none}</style></head><body>' +
    `<h1>${escapeHtml(article.title)}</h1><p>${escapeHtml(article.author)}</p>${article.content || '<p>此订阅未提供正文，请打开原文。</p>'}</body></html>`;
}
