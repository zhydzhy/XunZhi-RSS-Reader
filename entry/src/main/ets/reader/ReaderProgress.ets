import { common } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';

interface ReadingPosition { id: string; y: number; opened: number; }

// Keep frequent position writes out of subscription/read-state transactions and the replaceable feed cache.
export class ReaderProgress {
  private db?: relationalStore.RdbStore;
  private positions: Map<string, ReadingPosition> = new Map();
  private writes: Promise<void> = Promise.resolve();
  private latest: number = 0;
  lastArticleId: string = '';

  async open(context: common.UIAbilityContext, name: string = 'reader_progress.db'): Promise<void> {
    this.db = await relationalStore.getRdbStore(context, { name, securityLevel: relationalStore.SecurityLevel.S1 });
    if (this.db.version > 1) throw new Error('阅读进度版本较新，请使用新版应用');
    await this.db.executeSql('CREATE TABLE IF NOT EXISTS ReadingPosition (id TEXT PRIMARY KEY, y DOUBLE, opened DOUBLE)');
    this.db.version = 1;
    const result = await this.db.querySql('SELECT * FROM ReadingPosition');
    try {
      for (let offset = 0; offset < result.rowCount;) {
        const rows = await result.getRows(100, offset);
        if (!rows.length) break;
        offset += rows.length;
        for (const row of rows) {
          const id = row['id'] as string; const y = row['y'] as number; const opened = row['opened'] as number;
          if (!id || !Number.isFinite(y) || !Number.isFinite(opened)) continue;
          this.positions.set(id, { id, y: Math.max(0, y), opened });
          if (opened > this.latest) { this.latest = opened; this.lastArticleId = id; }
        }
      }
    } finally { result.close(); }
  }
  position(id: string): number { return this.positions.get(id)?.y || 0; }
  visit(id: string): Promise<void> {
    this.latest = Math.max(Date.now(), this.latest + 1);
    this.lastArticleId = id;
    return this.write({ id, y: this.position(id), opened: this.latest });
  }
  save(id: string, y: number): Promise<void> {
    const previous = this.positions.get(id);
    if (!previous || !Number.isFinite(y)) return Promise.resolve();
    return this.write({ id, y: Math.max(0, y), opened: previous.opened });
  }
  private write(position: ReadingPosition): Promise<void> {
    this.positions.set(position.id, position);
    const write = this.writes.catch(() => {}).then(async () => {
      if (!this.db) throw new Error('阅读进度尚未打开');
      await this.db.insert('ReadingPosition', { id: position.id, y: position.y, opened: position.opened },
        relationalStore.ConflictResolution.ON_CONFLICT_REPLACE);
    });
    this.writes = write;
    return write;
  }
  async close(): Promise<void> {
    try { await this.writes; } finally { await this.db?.close(); }
  }
}
