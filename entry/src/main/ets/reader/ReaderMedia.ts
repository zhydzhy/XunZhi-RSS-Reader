import { decodeHtmlEntities } from './Feed.ts';

export function htmlAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match = pattern.exec(tag);
  while (match) {
    attrs[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4]);
    match = pattern.exec(tag);
  }
  return attrs;
}
function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
export function prepareVideos(content: string, base: string, resolve: (value: string, base: string) => string): string {
  const clean = content.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  return clean.replace(/<video\b((?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/video\s*>/gi,
    (_whole: string, attributes: string, children: string): string => {
      const attrs = htmlAttributes(attributes);
      const sources = [attrs['src'] ?? '', ...(children.match(/<source\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? [])
        .map((tag: string) => htmlAttributes(tag)['src'] ?? '')];
      let url = ''; let poster = '';
      for (const source of sources) {
        if (!source) continue;
        try { url = resolve(source, base); break; } catch (_) {}
      }
      if (!url) return '<p>无法加载视频，请打开原文。</p>';
      if (attrs['poster']) { try { poster = resolve(attrs['poster'], base); } catch (_) {} }
      return `<video controls playsinline preload="metadata" src="${escapeAttribute(url)}"` +
        (poster ? ` poster="${escapeAttribute(poster)}"` : '') +
        '>此视频暂时无法播放，请打开原文。</video>';
    });
}


export function iconCandidates(html: string, website: string, resolve: (value: string, base: string) => string): string[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  const baseTag = /<base\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(clean);
  let base = website;
  if (baseTag) { try { base = resolve(htmlAttributes(baseTag[0])['href'] || website, website); } catch (_) {} }
  const icons: string[] = []; const touch: string[] = [];
  for (const tag of clean.match(/<link\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi) ?? []) {
    const attrs = htmlAttributes(tag);
    const rel = (attrs['rel'] ?? '').toLowerCase().split(/\s+/);
    if (!attrs['href']) continue;
    try {
      const target = resolve(attrs['href'], base);
      if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) touch.push(target);
      else if (rel.includes('icon')) icons.push(target);
    } catch (_) {}
  }
  return Array.from(new Set([...touch, ...icons, resolve('/favicon.ico', website)]));
}
