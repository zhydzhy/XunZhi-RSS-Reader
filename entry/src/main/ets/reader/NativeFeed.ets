import { convertxml, util, url, xml } from '@kit.ArkTS';
import { http } from '@kit.NetworkKit';
import { Feed, FeedParser, XmlNode, MAX_SOURCE, guardSource, ResolveUrl } from './Feed';

export function resolveHttp(value: string, base: string = ''): string {
  const parsed = base ? new url.URL(value.trim(), base) : new url.URL(value.trim());
  if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('请输入不含账号密码的 HTTP 或 HTTPS 地址');
  }
  parsed.hash = '';
  return parsed.toString();
}
export function readXml(source: string): XmlNode {
  guardSource(source);
  const bytes = new util.TextEncoder().encodeInto(source);
  const parser = new xml.XmlPullParser(bytes.buffer as ArrayBuffer, 'UTF-8');
  let tooDeep = false;
  let roots = 0;
  // Validate structure without resolving namespaces; the converter retains feed fields and xml attributes.
  parser.parseXml({ supportDoctype: false, ignoreNameSpace: true,
    tokenValueCallbackFunction: (event: xml.EventType, info: xml.ParseInfo): boolean => {
      if (info.getDepth() > 64) { tooDeep = true; return false; }
      if (event === xml.EventType.START_TAG && info.getDepth() === 1) roots++;
      return true;
    } });
  if (tooDeep || roots !== 1) throw new Error('XML 层级过深或根节点无效');
  return new convertxml.ConvertXML().fastConvertToJSObject(source) as XmlNode;
}
export function makeParser(): FeedParser { return new FeedParser(resolveHttp, readXml); }
export interface FetchResult { source: string; url: string; etag: string; modified: string; unchanged: boolean; }
function header(headers: Record<string, string>, key: string): string {
  const match = Object.keys(headers).find((k: string) => k.toLowerCase() === key);
  return match ? String(headers[match]) : '';
}
export async function fetchFeed(address: string, etag: string = '', modified: string = ''): Promise<FetchResult> {
  let current = resolveHttp(address);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const client = http.createHttp();
    const headers: Record<string, string> = { 'Accept': 'application/atom+xml, application/rss+xml, application/feed+json, application/xml, text/xml, text/html;q=0.5',
      'User-Agent': 'Xunzhi/0.2 (HarmonyOS RSS Reader)' };
    if (etag) headers['If-None-Match'] = etag;
    if (modified) headers['If-Modified-Since'] = modified;
    try {
      const response = await client.request(current, { method: http.RequestMethod.GET, header: headers,
        expectDataType: http.HttpDataType.ARRAY_BUFFER, maxLimit: MAX_SOURCE, connectTimeout: 12000,
        readTimeout: 20000, usingCache: false, maxRedirects: 0 });
      const responseHeaders = response.header as Record<string, string>;
      if ([301, 302, 303, 307, 308].includes(response.responseCode)) {
        const next = resolveHttp(header(responseHeaders, 'location'), current);
        if (current.startsWith('https:') && next.startsWith('http:')) throw new Error('已阻止 HTTPS 降级重定向');
        current = next;
        continue;
      }
      if (response.responseCode === 304) return { source: '', url: current, etag, modified, unchanged: true };
      if (response.responseCode !== 200) throw new Error(`源站返回 HTTP ${response.responseCode}`);
      const data = new Uint8Array(response.result as ArrayBuffer);
      if (data.length > MAX_SOURCE) throw new Error('响应超过 4 MB');
      const type = header(responseHeaders, 'content-type');
      const prefix = new util.TextDecoder('utf-8').decodeToString(data.slice(0, 200));
      const encoding = /charset\s*=\s*["']?([\w-]+)/i.exec(type)?.[1] ||
        /<\?xml[^>]*encoding\s*=\s*["']([^"']+)/i.exec(prefix)?.[1] || 'utf-8';
      return { source: new util.TextDecoder(encoding).decodeToString(data), url: current,
        etag: header(responseHeaders, 'etag'), modified: header(responseHeaders, 'last-modified'), unchanged: false };
    } finally { client.destroy(); }
  }
  throw new Error('重定向次数超过 5 次');
}
export function discoverFeeds(html: string, base: string, resolve: ResolveUrl = resolveHttp): string[] {
  const result: string[] = [];
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  const baseTag = /<base\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/i.exec(clean);
  let documentBase = base;
  if (baseTag) { try { documentBase = resolve(baseTag[1], base); } catch (_) {} }
  const tags = clean.match(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? [];
  for (const tag of tags) {
    const attrs: Record<string, string> = {};
    const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let match = pattern.exec(tag);
    while (match) { attrs[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4]).replace(/&amp;/g, '&'); match = pattern.exec(tag); }
    if (!(attrs['rel'] ?? '').toLowerCase().split(/\s+/).includes('alternate') ||
      !['application/rss+xml', 'application/atom+xml', 'application/feed+json', 'application/json'].includes((attrs['type'] ?? '').toLowerCase())) continue;
    try {
      const target = resolve(attrs['href'] ?? '', documentBase);
      if (attrs['href'] && !result.includes(target)) result.push(target);
    } catch (_) {}
  }
  return result;
}
