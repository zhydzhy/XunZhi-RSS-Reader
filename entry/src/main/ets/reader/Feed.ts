// ArkUI treats whitespace after a comma as part of the alias; keep these lists unspaced.
export const READER_FONT = 'Literata,SourceHanSerif';
export const READER_HEADING_FONT = 'LiterataSemibold,SourceHanSerifSemibold';
export const READER_FONT_ORIGIN = 'https://fonts.xunzhi.invalid';
export const READER_FONT_FILES: string[] = [
  'Literata-Regular.ttf', 'Literata-SemiBold.ttf', 'Literata-Italic.ttf',
  'SourceHanSerifCN-Regular.otf', 'SourceHanSerifCN-SemiBold.otf'
];

// Only these packaged assets can be served; feed URLs cannot select arbitrary local files.
export function readerFontFile(url: string): string {
  return READER_FONT_FILES.find((file: string) => url === `${READER_FONT_ORIGIN}/${file}`) || '';
}

export const READER_FONT_CSS =
  `@font-face{font-family:Literata;src:url('${READER_FONT_ORIGIN}/Literata-Regular.ttf');font-weight:400;font-display:block}` +
  `@font-face{font-family:Literata;src:url('${READER_FONT_ORIGIN}/Literata-SemiBold.ttf');font-weight:500 900;font-display:block}` +
  `@font-face{font-family:Literata;src:url('${READER_FONT_ORIGIN}/Literata-Italic.ttf');font-style:italic;font-weight:400;font-display:block}` +
  `@font-face{font-family:SourceHanSerif;src:url('${READER_FONT_ORIGIN}/SourceHanSerifCN-Regular.otf');font-weight:400;font-display:block}` +
  `@font-face{font-family:SourceHanSerif;src:url('${READER_FONT_ORIGIN}/SourceHanSerifCN-SemiBold.otf');font-weight:500 900;font-display:block}`;

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
  language?: string;
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
  icon?: string;
}
export interface ParsedFeed { title: string; site: string; icon?: string; articles: Article[]; }
export interface Subscription { url: string; title: string; folders: string[]; }
interface JsonItem {
  language?: string;
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
  language?: string;
  version?: string;
  title?: string;
  home_page_url?: string;
  favicon?: string;
  icon?: string;
  items?: JsonItem[];
}
export type ResolveUrl = (value: string, base: string) => string;
export type ReadXml = (source: string) => XmlNode;
export const MAX_SOURCE = 4 * 1024 * 1024;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function decodeHtmlEntities(value: string): string {
  const punctuation: Record<string, string> = { lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    ndash: '–', mdash: '—', hellip: '…', nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
  return value.replace(/&(#x[0-9a-fA-F]+|#X[0-9a-fA-F]+|#[0-9]+|lsquo|rsquo|ldquo|rdquo|ndash|mdash|hellip|nbsp|lt|gt|quot|apos|amp);/g,
      (_entity: string, name: string): string => {
        if (!name.startsWith('#')) return punctuation[name];
        const hex = name[1].toLowerCase() === 'x';
        const code = parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code) : '\ufffd';
      });
}
export function textOnly(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
export function hasReaderBody(content: string): boolean {
  const visible = content.replace(/<!--[\s\S]*?-->|<(script|style|iframe|form|object)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  return !!textOnly(visible) || /<(img|video|audio|svg)\b/i.test(visible);
}
export function articleTitle(article: Article): string {
  if (article.title.trim()) return article.title;
  const opening = textOnly(article.content);
  if (opening) return Array.from(opening).slice(0, 180).join('');
  return /<video\b/i.test(article.content) ? '视频' : /<img\b/i.test(article.content) ? '图片' : '文章';
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
function xmlLanguage(node: XmlNode, inherited: string): string {
  return (node._attributes?.['xml:lang'] ?? node._attributes?.['lang'] ?? inherited).trim();
}
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
  private resolve: ResolveUrl;
  private xml: ReadXml;
  constructor(resolve: ResolveUrl, xml: ReadXml) { this.resolve = resolve; this.xml = xml; }

  private link(value: string, base: string): string {
    if (!value.trim()) return '';
    try { return this.resolve(value, base); } catch (_) { return ''; }
  }

  parse(source: string, feedId: string, base: string = feedId): ParsedFeed {
    guardSource(source);
    if (source.trimStart().startsWith('{')) return this.json(source, feedId, base);
    const document = this.xml(source);
    // Processing instructions also have names (for example xml-stylesheet).
    const root = (document._elements ?? []).find((n: XmlNode) => n._type === 'element');
    if (!root) throw new Error('未找到订阅根节点');
    const kind = name(root);
    if (!['rss', 'rdf', 'feed'].includes(kind)) throw new Error('不是 RSS、Atom 或 JSON Feed');
    const channel = kind === 'feed' ? root : child(root, 'channel');
    if (!channel._name) throw new Error('RSS 缺少 channel');
    const feedBase = this.link(attr(root, 'xml:base'), base) || base;
    const language = field(channel, 'language') || xmlLanguage(channel, xmlLanguage(root, ''));
    const items = kind === 'feed' ? children(root, 'entry') : children(kind === 'rdf' ? root : channel, 'item');
    if (items.length > 2000) throw new Error('单个订阅超过 2000 篇，未写入');
    const result: ParsedFeed = { title: textOnly(field(channel, 'title')) || feedId,
      site: kind === 'feed' ? this.atomLink(channel, feedBase) : this.link(field(channel, 'link'), feedBase),
      icon: this.link(kind === 'feed' ? field(channel, 'icon') || field(channel, 'logo') : field(child(channel, 'image'), 'url'), feedBase),
      articles: [] };
    const seen = new Set<string>();
    for (const item of items) {
      const itemBase = this.link(attr(item, 'xml:base'), feedBase) || feedBase;
      const link = kind === 'feed' ? this.atomLink(item, itemBase) : this.link(field(item, 'link'), itemBase);
      const title = textOnly(field(item, 'title'));
      const date = field(item, 'published') || field(item, 'pubdate') || field(item, 'date') || field(item, 'updated');
      const key = field(item, 'guid') || field(item, 'id') || link || `${title || '无标题'}\n${date}`;
      const id = articleId(feedId, key);
      if (seen.has(id)) continue;
      seen.add(id);
      const rich = child(item, 'encoded');
      const atom = child(item, 'content');
      const description = child(item, kind === 'feed' ? 'summary' : 'description');
      const richContent = body(rich);
      const atomContent = richContent ? '' : body(atom, true);
      const contentNode = richContent ? rich : atomContent ? atom : description;
      result.articles.push({ id, feedId, title, link, content: richContent || atomContent || body(description, kind === 'feed'),
        language: xmlLanguage(contentNode, xmlLanguage(item, language)),
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
    const declaredIcon = typeof data.favicon === 'string' ? data.favicon : typeof data.icon === 'string' ? data.icon : '';
    const result: ParsedFeed = { title: data.title, site: this.link(data.home_page_url ?? '', base),
      icon: this.link(declaredIcon, base), articles: [] };
    const seen = new Set<string>();
    for (const item of data.items) {
      if (!item || typeof item.id !== 'string' || !item.id) throw new Error('JSON Feed 文章缺少字符串 id');
      for (const value of [item.url, item.title, item.content_html, item.content_text, item.summary, item.date_published]) {
        if (value !== undefined && typeof value !== 'string') throw new Error('JSON Feed 字段类型无效');
      }
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      result.articles.push({ id: articleId(feedId, item.id), feedId,
        language: typeof item.language === 'string' ? item.language.trim() : typeof data.language === 'string' ? data.language.trim() : '',
        title: item.title?.trim() || '',
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
export function articleDate(value: number, now: Date = new Date(), includeTime: boolean = false): string {
  if (!value || !Number.isFinite(value)) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (!includeTime && date >= day && date < tomorrow) return time;
  if (!includeTime && date >= yesterday && date < day) return '昨天';
  return `${date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`}${date.getMonth() + 1}月${date.getDate()}日${includeTime ? ` ${time}` : ''}`;
}
export function feedError(message: string): string {
  if (/404|410/.test(message)) return '订阅地址已失效';
  if (/partial file/i.test(message)) return '下载中断，稍后会重试';
  if (/timeout|timed out|超时/i.test(message)) return '网站响应超时';
  if (/parse|xml|json|格式|解析/i.test(message)) return '内容格式无法识别';
  return '无法连接到网站';
}
// Han and kana carry about a word per character, so mostly-Latin text keeps Latin leading even with a few CJK words.
export function readerLineHeight(title: string, content: string): number {
  const sample = `${title} ${textOnly(content.slice(0, 20000))}`;
  const cjk = (sample.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/g) || []).length;
  const latin = (sample.match(/[A-Za-z\u00c0-\u024f]/g) || []).length;
  return latin > 0 && cjk * 4 < latin ? 1.6 : 1.8;
}
export function readerHtml(article: Article, fontSize: number, theme: string = 'system', content: string = article.content,
  source: string = ''): string {
  const size = Number.isFinite(fontSize) ? Math.max(14, Math.min(30, fontSize)) : 18;
  const light = 'background:#fcfcfb;color:#202420;--accent:#245c48;--muted:#69706a';
  const dark = 'background:#121212;color:#e6e6e1;--accent:#8bc5a6;--muted:#a3aaa5';
  const colors = theme === 'dark' ? `:root{color-scheme:dark}html,body{${dark}}` :
    theme === 'light' ? `:root{color-scheme:light}html,body{${light}}` :
      `:root{color-scheme:light dark}html,body{${light}}@media(prefers-color-scheme:dark){html,body{${dark}}}`;
  const original = /^https?:\/\//i.test(article.link) ? article.link : '';
  const base = original || (/^https?:\/\//i.test(article.feedId) ? article.feedId : '');
  const byline = [article.author.trim(), articleDate(article.published, new Date(), true)].filter((part: string) => !!part).join(' · ');
  const language = article.language?.trim() || '';
  const lineHeight = readerLineHeight(article.title, content);
  // The native 56vp title bar overlays the Web; its clearance scrolls with the article and never changes on hide/show.
  // The Web also runs under the gesture bar, so the page ends by the bottom safe-area inset.
  return `<!doctype html><html${language ? ` lang="${escapeHtml(language)}"` : ''}><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; img-src https: http: data:; media-src https: http:; style-src \'unsafe-inline\'; font-src https://fonts.xunzhi.invalid; base-uri https: http:; form-action \'none\'; frame-src \'none\'">' +
    (base ? `<base href="${escapeHtml(base)}">` : '') + '<style>' + READER_FONT_CSS +
    `${colors}html{scroll-padding-top:56px}body{font:${size}px/${lineHeight} ${READER_FONT},serif;margin:24px auto;padding:56px 20px 0;padding-bottom:env(safe-area-inset-bottom,0px);max-width:680px;overflow-wrap:anywhere}` +
    '@media(min-width:560px){body{padding-left:32px;padding-right:32px}}' +
    'a{color:var(--accent);text-decoration-thickness:1px;text-underline-offset:.2em;text-decoration-color:color-mix(in srgb,currentColor 40%,transparent)}' +
    'video{display:block;width:100%;min-height:180px;background:#000}' +
    'header{margin-bottom:1.75em}.source{margin:0 0 .45em;font-size:.8em;font-weight:600;color:var(--accent)}' +
    'h1,h2,h3,h4,h5,h6{font-weight:600}h1{font-size:1.6em;line-height:1.35;margin:0;text-wrap:balance}h1 a{color:inherit;text-decoration:none}' +
    '.byline{margin:.55em 0 0;font-size:.8em;color:var(--muted)}footer{margin-top:3em;padding-top:1em;border-top:1px solid #8884;font-size:.85em}' +
    'embed#xunzhi-reader-footer{display:block;width:100%;height:80px}' +
    'img,video{max-width:100%;height:auto}pre,table{max-width:100%;box-sizing:border-box}pre{overflow:auto;padding:12px;background:#8882}blockquote{margin:1em 0;border-left:3px solid #8886;padding-left:1em}table{display:block;overflow:auto;overflow-wrap:normal}th,td{padding:.35em .6em}iframe,form,object,embed{display:none}</style></head><body><header>' +
    (source ? `<p class="source">${escapeHtml(source)}</p>` : '') +
    (article.title.trim() ? `<h1>${original ? `<a href="${escapeHtml(original)}">${escapeHtml(article.title)}</a>` : escapeHtml(article.title)}</h1>` : '') +
    (byline ? `<p class="byline">${escapeHtml(byline)}</p>` : '') + '</header>' +
    (hasReaderBody(content) ? content : original ? `<p>此订阅未提供正文，<a href="${escapeHtml(original)}">在浏览器中打开</a>。</p>` :
      '<p>此订阅未提供正文，也没有提供原文链接。</p>') +
    '<footer lang="zh-CN"><embed id="xunzhi-reader-footer" type="native/xunzhi-footer"></footer>' + '</body></html>';
}
