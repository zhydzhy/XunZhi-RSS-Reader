import { common } from '@kit.AbilityKit';
import { router } from '@kit.ArkUI';
import { webview } from '@kit.ArkWeb';
import { systemShare } from '@kit.ShareKit';
import { uniformTypeDescriptor } from '@kit.ArkData';
import { Article, Feed, Subscription, exportOpml, readerHtml, textOnly } from '../reader/Feed';
import { discoverFeeds, fetchFeed, makeParser, resolveHttp } from '../reader/NativeFeed';
import { ReaderStore } from '../reader/ReaderStore';
import { importFile, exportFile } from '../reader/ReaderFiles';

@Entry
@Component
struct Index {
  @State feeds: Feed[] = [];
  @State articles: Article[] = [];
  @State folders: string[] = [];
  @State view: string = '阅读';
  @State filter: string = '未读';
  @State query: string = '';
  @State selectedFeed: string = '';
  @State selectedFolder: string = '';
  @State address: string = '';
  @State folderName: string = '';
  @State candidates: string[] = [];
  @State message: string = '正在打开资料库…';
  @State busy: boolean = false;
  @State ready: boolean = false;
  @State article: Article | undefined = undefined;
  @State fontSize: number = 18;
  @State loaded: boolean = false;
  private store: ReaderStore = new ReaderStore();
  private web: webview.WebviewController = new webview.WebviewController();
  private opened: boolean = false;

  aboutToAppear(): void {
    if (!this.opened) { this.opened = true; this.run(async () => {
      await this.store.open(this.context()); this.ready = true; await this.reload(); this.message = '';
    }); }
  }
  private context(): common.UIAbilityContext { return this.getUIContext().getHostContext() as common.UIAbilityContext; }
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try { await action(); } catch (error) { this.message = (error as Error).message || '操作未完成，请重试'; }
    finally { this.busy = false; }
  }
  private async reload(): Promise<void> {
    this.feeds = await this.store.subscriptions(); this.folders = await this.store.folders();
    this.articles = await this.store.articles(this.feeds.map((f: Feed) => f.id));
  }
  private async add(address: string): Promise<void> {
    const id = resolveHttp(address.includes('://') ? address : `https://${address}`);
    if (this.feeds.some((f: Feed) => f.id === id)) throw new Error('已经订阅这个地址');
    this.message = '正在查找订阅…';
    const response = await fetchFeed(id);
    if (/<html\b|<!doctype\s+html/i.test(response.source.slice(0, 2000))) {
      this.candidates = discoverFeeds(response.source, response.url);
      if (!this.candidates.length) throw new Error('网页没有声明订阅地址，请粘贴 RSS / Atom / JSON Feed 链接');
      this.message = '选择要订阅的源'; return;
    }
    const parsed = makeParser().parse(response.source, id, response.url);
    const feed: Feed = { id, title: parsed.title, site: parsed.site, folder: '[]', etag: '', modified: '', checked: 0, error: '' };
    await this.store.saveRefresh(feed, parsed, response.etag, response.modified);
    await this.store.saveSubscriptions([{ url: id, title: parsed.title, folders: [] }]);
    await this.reload(); this.candidates = []; this.address = ''; this.message = `已添加 ${parsed.title} · ${parsed.articles.length} 篇`;
  }
  private async refresh(): Promise<void> {
    let updated = 0; let unchanged = 0; let failed = 0;
    for (const feed of this.feeds) {
      this.message = `正在刷新 ${feed.title}`;
      try {
        const result = await fetchFeed(feed.id, feed.etag, feed.modified);
        const parsed = result.unchanged ? undefined : makeParser().parse(result.source, feed.id, result.url);
        await this.store.saveRefresh(feed, parsed, result.etag, result.modified);
        if (result.unchanged) unchanged++; else updated++;
      } catch (error) { failed++; await this.store.error(feed, (error as Error).message); }
    }
    await this.reload(); this.message = `刷新完成：${updated} 个更新，${unchanged} 个未变化，${failed} 个失败`;
  }
  private visible(): Article[] {
    const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const query = this.query.trim().toLowerCase();
    const ids = this.feeds.filter((f: Feed) => (!this.selectedFeed || f.id === this.selectedFeed) &&
      (!this.selectedFolder || f.folder === this.selectedFolder)).map((f: Feed) => f.id);
    return this.articles.filter((a: Article) => ids.includes(a.feedId) &&
      (this.filter !== '未读' || !a.read) && (this.filter !== '星标' || a.starred) &&
      (this.filter !== '今天' || a.published >= today) &&
      (!query || `${a.title} ${textOnly(a.content)} ${a.author}`.toLowerCase().includes(query)));
  }
  private feedTitle(id: string): string { return this.feeds.find((f: Feed) => f.id === id)?.title || id; }
  private folderTitle(path: string): string { return (JSON.parse(path) as string[]).join(' / ') || '未分组'; }
  private openArticle(article: Article): void { if (this.busy) return; this.loaded = false; this.message = ''; this.article = article; }
  private async markRead(): Promise<void> {
    if (!this.article || this.loaded) return;
    this.loaded = true;
    await this.store.setState(this.article.id, 'read', true);
    // Keep the current list stable until the reader is closed.
    this.article = { id: this.article.id, feedId: this.article.feedId, title: this.article.title, link: this.article.link,
      content: this.article.content, published: this.article.published, author: this.article.author, read: true, starred: this.article.starred };
  }
  private async closeArticle(): Promise<void> { this.article = undefined; await this.reload(); }
  onBackPress(): boolean {
    if (this.article) { if (!this.busy) this.run(async () => this.closeArticle()); return true; }
    if (this.view !== '阅读') { this.view = '阅读'; return true; } return false;
  }
  private async toggle(kind: string): Promise<void> {
    if (!this.article) return;
    const value = kind === 'read' ? !this.article.read : !this.article.starred;
    await this.store.setState(this.article.id, kind, value);
    if (kind === 'read') this.article.read = value; else this.article.starred = value;
    this.article = { id: this.article.id, feedId: this.article.feedId, title: this.article.title, link: this.article.link,
      content: this.article.content, published: this.article.published, author: this.article.author,
      read: this.article.read, starred: this.article.starred };
  }
  private async share(): Promise<void> {
    if (!this.article) return;
    const data = new systemShare.SharedData({ utd: uniformTypeDescriptor.UniformDataType.TEXT,
      content: `${this.article.title}\n${this.article.link || this.article.feedId}` });
    await new systemShare.ShareController(data).show(this.context(), {});
  }
  private async openOriginal(): Promise<void> {
    if (this.article?.link) await this.context().openLink(resolveHttp(this.article.link));
  }
  private async importOpml(): Promise<void> {
    const source = await importFile(this.context()); if (source === undefined) return;
    const items = makeParser().importOpml(source);
    await this.store.saveSubscriptions(items); await this.reload();
    this.message = `已导入 ${items.length} 条订阅关系，点击刷新下载文章`;
  }
  private async exportOpmlFile(): Promise<void> {
    const items: Subscription[] = this.feeds.map((f: Feed): Subscription => ({ url: f.id, title: f.title, folders: JSON.parse(f.folder) as string[] }));
    if (await exportFile(this.context(), exportOpml(items))) this.message = `已导出 ${items.length} 个订阅`;
  }

  private feedOptions(): SelectOption[] {
    const result: SelectOption[] = [{ value: '所有订阅' }];
    for (const feed of this.feeds) result.push({ value: feed.title });
    return result;
  }
  private folderOptions(first: string): SelectOption[] {
    const result: SelectOption[] = [{ value: first }];
    for (const folder of this.folders) result.push({ value: this.folderTitle(folder) });
    return result;
  }
  @Builder
  header() {
    Row() {
      Column({ space: 4 }) {
        Text('讯枝').fontSize(30).fontWeight(FontWeight.Bold)
        Text('留一点时间，认真阅读。').fontSize(13).fontColor($r('sys.color.ohos_id_color_text_secondary'))
      }.alignItems(HorizontalAlign.Start).layoutWeight(1)
      Button('刷新').enabled(this.ready && !this.busy && this.feeds.length > 0)
        .onClick(() => { this.run(async () => this.refresh()); })
    }.width('100%').padding({ left: 20, right: 20, top: 16, bottom: 12 })
  }
  @Builder
  readingList() {
    Column({ space: 12 }) {
      Row({ space: 8 }) {
        ForEach(['未读', '全部', '今天', '星标'], (label: string) => {
          Button(label).type(ButtonType.Capsule).fontSize(14)
            .backgroundColor(this.filter === label ? '#245C48' : $r('sys.color.ohos_id_color_component_normal'))
            .fontColor(this.filter === label ? '#FFFFFF' : $r('sys.color.ohos_id_color_text_primary'))
            .onClick(() => { this.filter = label; })
        })
      }.width('100%')
      Search({ value: this.query, placeholder: '搜索标题与已缓存正文' }).onChange((value: string) => { this.query = value; })
      Row({ space: 8 }) {
        Select(this.feedOptions())
          .value(this.selectedFeed ? this.feedTitle(this.selectedFeed) : '所有订阅')
          .onSelect((index: number) => { this.selectedFeed = index === 0 ? '' : this.feeds[index - 1].id; })
          .layoutWeight(1)
        Select(this.folderOptions('所有文件夹'))
          .value(this.selectedFolder ? this.folderTitle(this.selectedFolder) : '所有文件夹')
          .onSelect((index: number) => { this.selectedFolder = index === 0 ? '' : this.folders[index - 1]; })
          .layoutWeight(1)
      }.width('100%')
      if (this.visible().length === 0) {
        Column({ space: 12 }) {
          Text(this.feeds.length ? '这里暂时没有文章' : '从一个喜欢的网站开始').fontSize(22).fontWeight(FontWeight.Medium)
          Text(this.feeds.length ? '切换筛选，或刷新订阅获取新内容。' : '添加订阅地址，或导入 NetNewsWire 的 OPML 文件。')
            .fontSize(15).fontColor($r('sys.color.ohos_id_color_text_secondary')).textAlign(TextAlign.Center)
          if (!this.feeds.length) { Button('添加订阅').onClick(() => { this.view = '订阅'; }) }
        }.width('100%').layoutWeight(1).justifyContent(FlexAlign.Center).padding(24)
      } else {
        List({ space: 0 }) {
          ForEach(this.visible(), (item: Article) => {
            ListItem() {
              Column({ space: 8 }) {
                Row({ space: 6 }) {
                  if (!item.read) { Text('●').fontSize(9).fontColor('#39765C') }
                  Text(this.feedTitle(item.feedId)).fontSize(12).fontColor($r('sys.color.ohos_id_color_text_secondary')).layoutWeight(1).maxLines(1)
                  if (item.starred) { Text('★').fontColor('#A67824') }
                  Text(item.published ? new Date(item.published).toLocaleDateString() : '').fontSize(11)
                    .fontColor($r('sys.color.ohos_id_color_text_secondary'))
                }.width('100%')
                Text(item.title).fontSize(19).fontWeight(item.read ? FontWeight.Normal : FontWeight.Medium).maxLines(3)
                Text(textOnly(item.content).slice(0, 180)).fontSize(14).maxLines(2).lineHeight(21)
                  .fontColor($r('sys.color.ohos_id_color_text_secondary'))
              }.alignItems(HorizontalAlign.Start).width('100%').padding({ top: 18, bottom: 18 })
            }.onClick(() => { this.openArticle(item); }).accessibilityText(`${item.title}，${item.read ? '已读' : '未读'}`)
          }, (item: Article) => item.id)
        }.layoutWeight(1).divider({ strokeWidth: 0.5, color: $r('sys.color.ohos_id_color_list_separator') })
      }
    }.padding({ left: 20, right: 20 }).layoutWeight(1).width('100%')
  }
  @Builder
  library() {
    Scroll() {
      Column({ space: 16 }) {
        Text('订阅资料库').fontSize(24).fontWeight(FontWeight.Bold)
        TextInput({ text: this.address, placeholder: '网站或 RSS / Atom / JSON Feed 地址' }).type(InputType.URL)
          .onChange((value: string) => { this.address = value; })
        Row({ space: 8 }) {
          Button('添加').enabled(this.ready && !this.busy && !!this.address.trim()).onClick(() => { this.run(async () => this.add(this.address)); })
          Button('导入 OPML').enabled(this.ready && !this.busy).onClick(() => { this.run(async () => this.importOpml()); })
          Button('导出').enabled(this.ready && !this.busy && this.feeds.length > 0).onClick(() => { this.run(async () => this.exportOpmlFile()); })
        }
        ForEach(this.candidates, (candidate: string) => {
          Button(candidate).fontSize(13).enabled(!this.busy).onClick(() => { this.run(async () => this.add(candidate)); })
        })
        Row({ space: 8 }) {
          TextInput({ text: this.folderName, placeholder: '新文件夹名称' }).layoutWeight(1)
            .onChange((value: string) => { this.folderName = value; })
          Button('新建').enabled(this.ready && !this.busy && !!this.folderName.trim()).onClick(() => {
            this.run(async () => { await this.store.addFolder(JSON.stringify([this.folderName.trim()])); this.folderName = ''; await this.reload(); });
          })
        }
        ForEach(this.folders, (folder: string) => {
          Row() {
            Text(this.folderTitle(folder)).layoutWeight(1)
            Button('移除文件夹').fontSize(12).enabled(!this.busy).onClick(() => {
              this.getUIContext().showAlertDialog({ title: '移除文件夹？', message: '订阅会移到未分组，文章和阅读状态保留。',
                primaryButton: { value: '取消', action: () => {} }, secondaryButton: { value: '移除', action: () => {
                  this.run(async () => { await this.store.removeFolder(folder); this.selectedFolder = ''; await this.reload(); });
                } } });
            })
          }.width('100%')
        })
        ForEach(this.feeds, (feed: Feed) => {
          Column({ space: 8 }) {
            Text(feed.title).fontSize(18).fontWeight(FontWeight.Medium)
            Text(feed.id).fontSize(12).fontColor($r('sys.color.ohos_id_color_text_secondary')).maxLines(2)
            if (feed.error) { Text(feed.error).fontSize(13).fontColor('#BC5644') }
            Row({ space: 10 }) {
              Select(this.folderOptions('未分组'))
                .value(this.folderTitle(feed.folder)).enabled(!this.busy).layoutWeight(1)
                .onSelect((index: number) => { this.run(async () => { await this.store.moveFeed(feed.id, index === 0 ? '[]' : this.folders[index - 1]); await this.reload(); }); })
              Button('取消订阅').fontSize(13).enabled(!this.busy).onClick(() => {
                this.getUIContext().showAlertDialog({ title: '取消订阅？', message: '保留已缓存文章和阅读状态，再次订阅可以恢复。',
                  primaryButton: { value: '保留', action: () => {} }, secondaryButton: { value: '取消订阅', action: () => {
                    this.run(async () => { await this.store.removeFeed(feed.id); this.selectedFeed = ''; await this.reload(); });
                  } } });
              })
            }.width('100%')
          }.alignItems(HorizontalAlign.Start).width('100%').padding(16)
            .backgroundColor($r('sys.color.ohos_id_color_component_normal')).borderRadius(12)
        }, (feed: Feed) => `${feed.id}:${feed.folder}:${feed.error}`)
      }.alignItems(HorizontalAlign.Start).width('100%').padding(20)
    }.layoutWeight(1).width('100%').align(Alignment.TopStart)
  }
  @Builder
  settings() {
    Column({ space: 20 }) {
      Text('阅读与数据').fontSize(24).fontWeight(FontWeight.Bold)
      Text('阅读资料库保存在本机，已下载的正文可离线打开。图片仍可能需要网络。').fontSize(16)
      Text('业务资料库暂未启用云同步。P0 测试库的手机双向链路已验证，平板与业务数据同步仍待验收。').fontSize(15)
        .fontColor($r('sys.color.ohos_id_color_text_secondary'))
      Button('打开 P0 同步验证页').onClick(() => { router.pushUrl({ url: 'pages/Probe' }); })
      Text('OPML 可迁移订阅与文件夹，不包含文章历史、已读或星标。').fontSize(14)
      Text('讯枝 · P2 开发版').fontSize(13).fontColor($r('sys.color.ohos_id_color_text_secondary'))
    }.alignItems(HorizontalAlign.Start).padding(24).layoutWeight(1).width('100%')
  }
  @Builder
  reader() {
    Column() {
      Row({ space: 8 }) {
        Button('返回').enabled(!this.busy).onClick(() => { this.run(async () => this.closeArticle()); })
        Text(this.article ? this.feedTitle(this.article.feedId) : '').layoutWeight(1).maxLines(1).fontSize(14)
        Button('A−').accessibilityText('缩小字号').onClick(() => { this.fontSize = Math.max(14, this.fontSize - 2); if (this.article) this.web.loadData(readerHtml(this.article, this.fontSize), 'text/html', 'UTF-8'); })
        Button('A+').accessibilityText('放大字号').onClick(() => { this.fontSize = Math.min(30, this.fontSize + 2); if (this.article) this.web.loadData(readerHtml(this.article, this.fontSize), 'text/html', 'UTF-8'); })
      }.padding(12).width('100%')
      if (this.message) { Text(this.message).fontSize(13).padding(12).width('100%') }
      Web({ src: '', controller: this.web }).javaScriptAccess(false).fileAccess(false).domStorageAccess(false)
        .mixedMode(MixedMode.None).onlineImageAccess(true).layoutWeight(1).width('100%')
        .onControllerAttached(() => { if (this.article) this.web.loadData(readerHtml(this.article, this.fontSize), 'text/html', 'UTF-8'); })
        .onOverrideUrlLoading(() => true)
        .onPageEnd(() => { this.run(async () => this.markRead()); })
      Row({ space: 8 }) {
        Button(this.article?.read ? '标未读' : '标已读').fontSize(13).enabled(!this.busy).onClick(() => { this.run(async () => this.toggle('read')); })
        Button(this.article?.starred ? '已星标' : '星标').fontSize(13).enabled(!this.busy).onClick(() => { this.run(async () => this.toggle('star')); })
        Button('原文').fontSize(13).enabled(!!this.article?.link).onClick(() => { this.run(async () => this.openOriginal()); })
        Button('分享').fontSize(13).onClick(() => { this.run(async () => this.share()); })
      }.padding(12).width('100%').justifyContent(FlexAlign.SpaceBetween)
    }.width('100%').height('100%')
  }
  build() {
    Column() {
      if (this.article) { this.reader() }
      else {
        this.header()
        if (this.message) { Text(this.message).fontSize(12).fontColor($r('sys.color.ohos_id_color_text_secondary')).width('100%').padding({ left: 20, right: 20, bottom: 10 }) }
        if (this.view === '阅读') { this.readingList() }
        else if (this.view === '订阅') { this.library() }
        else { this.settings() }
        Row() {
          ForEach(['阅读', '订阅', '设置'], (tab: string) => {
            Button(tab).type(ButtonType.Normal).layoutWeight(1).height(52)
              .backgroundColor(Color.Transparent).fontColor(this.view === tab ? '#39765C' : $r('sys.color.ohos_id_color_text_secondary'))
              .fontWeight(this.view === tab ? FontWeight.Bold : FontWeight.Normal).onClick(() => { this.view = tab; })
          })
        }.width('100%')
      }
    }.width('100%').height('100%').backgroundColor($r('sys.color.ohos_id_color_background'))
  }
}
