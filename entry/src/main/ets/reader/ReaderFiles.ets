import { common } from '@kit.AbilityKit';
import { fileIo, picker } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { MAX_SOURCE } from './Feed';

export async function importFile(context: common.UIAbilityContext): Promise<string | undefined> {
  const paths = await new picker.DocumentViewPicker(context).select({ maxSelectNumber: 1, fileSuffixFilters: ['订阅文件|.opml,.xml'] });
  if (!paths.length) return undefined;
  const file = await fileIo.open(paths[0], fileIo.OpenMode.READ_ONLY);
  try { return await readOpmlFile(file.fd); } finally { await fileIo.close(file); }
}

export async function readOpmlFile(fd: number): Promise<string> {
  const size = (await fileIo.stat(fd)).size;
  if (size > MAX_SOURCE || size === 0) throw new Error('OPML 文件为空或超过 4 MB');
  const buffer = new ArrayBuffer(size);
  let offset = 0;
  while (offset < size) {
    const chunk = new ArrayBuffer(Math.min(64 * 1024, size - offset));
    // read advances the file pointer; an additional offset would skip bytes.
    const n = await fileIo.read(fd, chunk);
    if (!n) throw new Error('文件未完整读取');
    new Uint8Array(buffer).set(new Uint8Array(chunk, 0, n), offset); offset += n;
  }
  return new util.TextDecoder('utf-8', { fatal: true }).decodeToString(new Uint8Array(buffer));
}
export async function exportFile(context: common.UIAbilityContext, source: string): Promise<boolean> {
  const paths = await new picker.DocumentViewPicker(context).save({ newFileNames: ['讯枝订阅.opml'] });
  if (!paths.length) return false;
  const file = await fileIo.open(paths[0], fileIo.OpenMode.READ_WRITE | fileIo.OpenMode.CREATE | fileIo.OpenMode.TRUNC);
  try {
    const bytes = new util.TextEncoder().encodeInto(source);
    let offset = 0;
    while (offset < bytes.length) {
      const n = await fileIo.write(file.fd, bytes.slice(offset).buffer as ArrayBuffer);
      if (!n) throw new Error('导出未完整写入'); offset += n;
    }
    return true;
  } finally { await fileIo.close(file); }
}
