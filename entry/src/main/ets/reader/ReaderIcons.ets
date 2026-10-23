import { common } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';
import { util } from '@kit.ArkTS';
import { fileIo } from '@kit.CoreFileKit';
import { image } from '@kit.ImageKit';
import { fetchFeed, fetchResource, resolveHttp } from './NativeFeed';
import { iconCandidates } from './ReaderMedia';

interface CachedIcon { path: string; checked: number; declared: string; }
interface PendingIcon { work: Promise<string>; site: string; declared: string; retryMissing: boolean; }
export class ReaderIcons {
  private values: preferences.Preferences;
  private directory: string;
  private pending: Map<string, PendingIcon> = new Map();
  private queue: Promise<void> = Promise.resolve();
  constructor(context: common.Context, name: string = 'reader_icons') {
    this.values = preferences.getPreferencesSync(context, { name });
    this.directory = `${context.filesDir}/${name}`;
    if (!fileIo.accessSync(this.directory)) fileIo.mkdirSync(this.directory);
  }
  private record(id: string): CachedIcon {
    const value = this.values.getSync(id, '');
    if (typeof value === 'string' && value) {
      try { return JSON.parse(value) as CachedIcon; } catch (_) {}
    }
    return { path: '', checked: 0, declared: '' };
  }
  cached(id: string): string {
    const path = this.record(id).path;
    return path && fileIo.accessSync(path) ? path : '';
  }
  async update(id: string, site: string, declared: string = '', retryMissing: boolean = false): Promise<string> {
    const pending = this.pending.get(id);
    if (pending && pending.site === site && pending.declared === declared && pending.retryMissing === retryMissing) return pending.work;
    const work = this.queue.then(() => this.updateRecord(id, site, declared, retryMissing));
    this.queue = work.then(() => {}, () => {});
    const request: PendingIcon = { work, site, declared, retryMissing };
    this.pending.set(id, request);
    try { return await work; } finally {
      if (this.pending.get(id) === request) this.pending.delete(id);
    }
  }
  private async updateRecord(id: string, site: string, declared: string, retryMissing: boolean): Promise<string> {
    const previous = this.record(id);
    const cached = this.cached(id);
    const age = Date.now() - previous.checked;
    if ((cached || !retryMissing) && age >= 0 && age < (cached ? 7 * 86400000 : 3600000) &&
      (!declared || declared === previous.declared)) return cached;
    let path = '';
    const preferred = declared || previous.declared;
    if (preferred) { try { path = await this.download(preferred); } catch (_) {} }
    if (!path) {
      try {
        const website = site || resolveHttp('/', id);
        let candidates = [resolveHttp('/favicon.ico', website)];
        try {
          const response = await fetchFeed(website);
          candidates = iconCandidates(response.source, response.url, resolveHttp).slice(0, 6);
        } catch (_) {}
        for (const candidate of candidates) {
          try { path = await this.download(candidate); break; } catch (_) {}
        }
      } catch (_) {}
    }
    const next: CachedIcon = { path: path || cached, declared: preferred, checked: Date.now() };
    try {
      this.values.putSync(id, JSON.stringify(next)); await this.values.flush();
    } catch (_) {
      this.values.putSync(id, JSON.stringify(previous));
      if (path) { try { await fileIo.unlink(path); } catch (_) {} }
      return cached;
    }
    if (path && previous.path && previous.path !== path) {
      try { await fileIo.unlink(previous.path); } catch (_) {}
    }
    return next.path;
  }
  private async download(address: string): Promise<string> {
    const response = await fetchResource(address, 'image/*', 1024 * 1024);
    const source = image.createImageSource(response.data);
    try {
      const info = await source.getImageInfo();
      if (info.size.width <= 0 || info.size.height <= 0 || Math.max(info.size.width, info.size.height) > 4096) {
        throw new Error('图标尺寸不支持');
      }
      const scale = Math.min(1, 128 / Math.max(info.size.width, info.size.height));
      const pixels = await source.createPixelMap({ desiredSize: {
        width: Math.max(1, Math.round(info.size.width * scale)), height: Math.max(1, Math.round(info.size.height * scale))
      } });
      const packer = image.createImagePacker();
      try {
        const data = await packer.packing(pixels, { format: 'image/png', quality: 100 });
        const path = `${this.directory}/${util.generateRandomUUID()}.png`;
        const output = await fileIo.open(path, fileIo.OpenMode.CREATE | fileIo.OpenMode.READ_WRITE);
        try {
          let offset = 0;
          while (offset < data.byteLength) {
            const n = await fileIo.write(output.fd, data.slice(offset));
            if (!n) throw new Error('图标未完整写入');
            offset += n;
          }
        } catch (error) {
          await fileIo.unlink(path); throw error as Error;
        } finally { await fileIo.close(output); }
        return path;
      } finally { await packer.release(); await pixels.release(); }
    } finally { await source.release(); }
  }
}
