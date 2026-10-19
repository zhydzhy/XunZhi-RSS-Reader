import { common } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';
import { util } from '@kit.ArkTS';

export const PROBE_DATABASE: string = 'reader_probe.db';
export const PROBE_TABLE: string = 'SyncProbe';

export interface ProbeRecord {
  id: string;
  value: string;
  writer: string;
  updatedAt: number;
}

export class ProbeStore {
  private store?: relationalStore.RdbStore;

  async open(context: common.UIAbilityContext,
    progress: (details: relationalStore.ProgressDetails) => void,
    changed: () => void): Promise<void> {
    const store = await relationalStore.getRdbStore(context, {
      name: PROBE_DATABASE, securityLevel: relationalStore.SecurityLevel.S1
    });
    try {
      await store.executeSql(`CREATE TABLE IF NOT EXISTS ${PROBE_TABLE} ` +
        '(id TEXT PRIMARY KEY, value TEXT, writer TEXT, updatedAt DOUBLE)');
      // DISTRIBUTED_DATASYNC is only required for DISTRIBUTED_DEVICE, not this cloud path.
      await store.setDistributedTables([PROBE_TABLE], relationalStore.DistributedType.DISTRIBUTED_CLOUD,
        { autoSync: true });
      store.on('autoSyncProgress', progress);
      store.on('dataChange', relationalStore.SubscribeType.SUBSCRIBE_TYPE_CLOUD, changed);
      this.store = store;
    } catch (error) {
      await store.close();
      throw error as Error;
    }
  }

  private database(): relationalStore.RdbStore {
    if (!this.store) {
      throw new Error('测试数据库尚未就绪');
    }
    return this.store;
  }

  async read(): Promise<ProbeRecord[]> {
    const result = await this.database().query(new relationalStore.RdbPredicates(PROBE_TABLE)
      .orderByDesc('updatedAt'));
    const rows: ProbeRecord[] = [];
    try {
      while (result.goToNextRow()) {
        rows.push({ id: result.getString(result.getColumnIndex('id')),
          value: result.getString(result.getColumnIndex('value')),
          writer: result.getString(result.getColumnIndex('writer')),
          updatedAt: result.getDouble(result.getColumnIndex('updatedAt')) });
      }
    } finally {
      result.close();
    }
    return rows;
  }

  async create(value: string, writer: string): Promise<string> {
    const id = util.generateRandomUUID();
    await this.database().insert(PROBE_TABLE, { id, value, writer, updatedAt: Date.now() });
    return id;
  }

  async update(id: string, value: string, writer: string): Promise<void> {
    const count = await this.database().update({ value, writer, updatedAt: Date.now() },
      new relationalStore.RdbPredicates(PROBE_TABLE).equalTo('id', id));
    if (count !== 1) {
      throw new Error('记录已不存在，请重新读取；不会重新创建已删除的记录');
    }
  }

  async remove(id: string): Promise<void> {
    await this.database().delete(new relationalStore.RdbPredicates(PROBE_TABLE).equalTo('id', id));
  }

  async sync(progress: (details: relationalStore.ProgressDetails) => void): Promise<void> {
    await this.database().cloudSync(relationalStore.SyncMode.SYNC_MODE_TIME_FIRST, [PROBE_TABLE], progress);
  }
}
