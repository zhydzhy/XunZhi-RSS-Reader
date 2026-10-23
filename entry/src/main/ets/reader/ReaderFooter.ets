import { READER_FONT } from './Feed';
import { BuilderNode, FrameNode, NodeController, NodeRenderType, UIContext } from '@kit.ArkUI';

export interface ReaderFooterParams {
  width: number;
  height: number;
  title: string;
  fontSize: number;
  enabled: boolean;
  next: () => void;
}

// Texture export requires a custom component at the BuilderNode root.
@Component
struct ReaderFooterContent {
  @Prop params: ReaderFooterParams;
  build() {
    Column() {
      if (this.params.title) {
        Button({ type: ButtonType.Normal }) {
          Text('下一篇：' + this.params.title).fontFamily(READER_FONT).width('100%').textAlign(TextAlign.Start)
            .fontSize(`${this.params.fontSize * 0.85}vp`).maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
            .fontColor($r('app.color.reader_accent'))
        }.width('100%').height('100%').padding({ top: 8, bottom: 8, left: 0, right: 0 })
          .backgroundColor(Color.Transparent).enabled(this.params.enabled)
          .accessibilityText('下一篇：' + this.params.title).fontFamily(READER_FONT).onClick(this.params.next)
      } else {
        Text('没有更多未读文章').fontFamily(READER_FONT).fontSize(`${this.params.fontSize * 0.85}vp`)
          .fontColor($r('sys.color.ohos_id_color_text_secondary'))
      }
    }.width(this.params.width).height(this.params.height).alignItems(HorizontalAlign.Start).justifyContent(FlexAlign.Center)
  }
}

@Builder
function readerFooterBuilder(params: ReaderFooterParams) {
  ReaderFooterContent({ params })
}

export class ReaderFooter extends NodeController {
  private node?: BuilderNode<[ReaderFooterParams]>;
  private surface: string = '';
  private params?: ReaderFooterParams;

  makeNode(context: UIContext): FrameNode | null {
    if (!this.surface || !this.params) return null;
    if (!this.node) {
      this.node = new BuilderNode(context, { surfaceId: this.surface, type: NodeRenderType.RENDER_TYPE_TEXTURE });
      this.node.build(wrapBuilder(readerFooterBuilder), this.params);
    }
    return this.node.getFrameNode();
  }
  setSurface(surface: string, params: ReaderFooterParams): void {
    if (surface !== this.surface) {
      this.clear(); this.surface = surface; this.params = params; this.rebuild();
    } else { this.update(params); }
  }
  update(params: ReaderFooterParams): void { this.params = params; this.node?.update(params); }
  postTouch(event?: TouchEvent): boolean { return this.node?.postTouchEvent(event) || false; }
  clear(): void {
    this.node?.dispose(); this.node = undefined; this.surface = ''; this.params = undefined; this.rebuild();
  }
}
