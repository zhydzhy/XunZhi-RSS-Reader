import { common } from '@kit.AbilityKit';
import { relationalStore } from '@kit.ArkData';
import { BusinessError, deviceInfo } from '@kit.BasicServicesKit';
import { ProbeRecord, ProbeStore } from '../probe/ProbeStore';
import { syncStatus } from '../probe/SyncStatus';

@Entry
@Component
struct Index {
  @State records: ProbeRecord[] = [];
  @State selectedId: string = '';
  @State value: string = '';
  @State writer: string = deviceInfo.deviceType;
  @State ready: boolean = false;
  @State busy: boolean = false;
  @State events: string[] = [];
  private probe: ProbeStore = new ProbeStore();
  private started: boolean = false;

  aboutToAppear(): void {
    if (!this.started) {
      this.started = true;
      this.initialize();
    }
  }

  onPageShow(): void {
    if (this.ready) {
      this.refreshFromCloud();
    }
  }

  private log(message: string): void {
    this.events = [`${new Date().toLocaleTimeString()} ${message}`, ...this.events].slice(0, 12);
  }

  private reportError(error: BusinessError): void {
    this.log(`失败：${error.message}（code=${error.code ?? '未提供'}）`);
  }

  private async initialize(): Promise<void> {
    if (!canIUse('SystemCapability.DistributedDataManager.CloudSync.Client')) {
      this.log('设备未声明 CloudSync.Client 能力，无法验证原生云同步');
      return;
    }
    try {
      await this.probe.open(this.getUIContext().getHostContext() as common.UIAbilityContext,
        (details) => this.onProgress(details), () => { this.refreshFromCloud(); });
      this.ready = true;
      await this.reload();
      this.log('数据库就绪；云服务是否可用尚待验证');
    } catch (error) {
      this.reportError(error as BusinessError);
    }
  }

  private async reload(): Promise<void> {
    this.records = await this.probe.read();
    if (!this.records.some((row: ProbeRecord) => row.id === this.selectedId)) {
      this.selectedId = '';
    }
  }

  private async refreshFromCloud(): Promise<void> {
    try {
      await this.reload();
    } catch (error) {
      this.reportError(error as BusinessError);
    }
  }

  private onProgress(details: relationalStore.ProgressDetails): void {
    let incomplete = 0;
    const tables = Object.keys(details.details);
    for (const table of tables) {
      const stats = details.details[table];
      incomplete += stats.upload.failed + stats.download.failed + stats.upload.remained + stats.download.remained;
    }
    this.log(`同步统计：${JSON.stringify(details.details)}`);
    this.log(`[stage=${details.schedule}, code=${details.code}] ${syncStatus(details.schedule, details.code, incomplete)}`);
    if (details.schedule === relationalStore.Progress.SYNC_FINISH) {
      this.refreshFromCloud();
    }
  }

  private async perform(action: string): Promise<void> {
    if (this.busy || !this.ready) {
      return;
    }
    this.busy = true;
    try {
      if (action === 'create' || action === 'update') {
        if (!this.value.trim() || !this.writer.trim()) {
          this.log('请填写测试内容和设备标签');
          return;
        }
        if (action === 'create') {
          this.selectedId = await this.probe.create(this.value.trim(), this.writer.trim());
        } else {
          await this.probe.update(this.selectedId, this.value.trim(), this.writer.trim());
        }
        this.log('已写入本地；等待云同步');
      } else if (action === 'delete') {
        await this.probe.remove(this.selectedId);
        this.log('已从本地删除；等待云同步');
      } else if (action === 'sync') {
        this.log('正在请求同步；请求返回不代表同步完成');
        await this.probe.sync((details) => this.onProgress(details));
      }
      await this.reload();
      if (action === 'read') {
        this.log(`已重新读取本地数据库：${this.records.length} 条`);
      }
    } catch (error) {
      this.reportError(error as BusinessError);
    } finally {
      this.busy = false;
    }
  }

  build() {
    Scroll() {
      Column({ space: 16 }) {
        Text('原生云同步 · P0').fontSize(28).fontWeight(FontWeight.Bold)
        Text('仅使用虚构测试数据。两台设备记录一致后，才能确认跨设备同步通过。').fontSize(16)
        Text(`${deviceInfo.osFullName}\nAPI ${deviceInfo.sdkApiVersion} · ${deviceInfo.deviceType}\n` +
          'reader_probe / SyncProbe · 包名 com.apexracing.rssreader').fontSize(13).copyOption(CopyOptions.LocalDevice)
        TextInput({ text: this.writer, placeholder: '设备标签，如 Mate60 / MatePad' })
          .maxLength(40).onChange((text: string) => { this.writer = text; })
        TextInput({ text: this.value, placeholder: '测试内容，如 phone-001' })
          .maxLength(240).onChange((text: string) => { this.value = text; })
        Flex({ wrap: FlexWrap.Wrap }) {
          Button('新增记录').margin(4).enabled(this.ready && !this.busy)
            .onClick(() => { this.perform('create'); })
          Button('更新选中').margin(4).enabled(this.ready && !this.busy && this.selectedId !== '')
            .onClick(() => { this.perform('update'); })
          Button('删除选中').margin(4).enabled(this.ready && !this.busy && this.selectedId !== '')
            .onClick(() => { this.perform('delete'); })
          Button('请求云同步').margin(4).enabled(this.ready && !this.busy)
            .onClick(() => { this.perform('sync'); })
          Button('重读本地').margin(4).enabled(this.ready && !this.busy)
            .onClick(() => { this.perform('read'); })
        }
        Text(`本地记录 ${this.records.length} 条 · 点击记录以编辑`).fontWeight(FontWeight.Medium)
        ForEach(this.records, (record: ProbeRecord) => {
          Column({ space: 6 }) {
            Text(record.value).fontSize(18)
            Text(`${record.writer} · ${new Date(record.updatedAt).toLocaleString()}\n${record.id}`)
              .fontSize(12).copyOption(CopyOptions.LocalDevice)
          }
          .alignItems(HorizontalAlign.Start).width('100%').padding(12)
          .border({ width: this.selectedId === record.id ? 2 : 1,
            color: this.selectedId === record.id ? '#0A59F7' : '#888888', radius: 8 })
          .onClick(() => { this.selectedId = record.id; this.value = record.value; })
        }, (record: ProbeRecord) => `${record.id}:${record.updatedAt}:${record.value}:${record.writer}`)
        Text('最近事件（可长按复制）').fontWeight(FontWeight.Medium)
        Text(this.events.join('\n\n')).fontSize(13).width('100%').copyOption(CopyOptions.LocalDevice)
      }
      .alignItems(HorizontalAlign.Start).width('100%').constraintSize({ maxWidth: 840 }).padding(24)
    }.width('100%').height('100%')
  }
}
