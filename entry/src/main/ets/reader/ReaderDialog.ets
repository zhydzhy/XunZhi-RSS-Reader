import { READER_FONT, READER_HEADING_FONT } from './Feed';

interface ReaderDialogButton { value: string; action: () => void; }
export interface ReaderDialogOptions {
  title: string;
  message: string;
  primaryButton?: ReaderDialogButton;
  secondaryButton?: ReaderDialogButton;
  confirm?: ReaderDialogButton;
}

@CustomDialog
export struct ReaderDialog {
  controller?: CustomDialogController;
  options: ReaderDialogOptions = { title: '', message: '' };

  @Builder
  actionButton(button: ReaderDialogButton) {
    Button(button.value).fontFamily(READER_FONT).fontSize(16).constraintSize({ minHeight: 48 })
      .layoutWeight(1).backgroundColor(Color.Transparent).fontColor($r('app.color.reader_accent'))
      .onClick(() => { this.controller?.close(); button.action(); })
  }
  build() {
    Column({ space: 16 }) {
      Text(this.options.title).fontFamily(READER_HEADING_FONT).fontSize(20).fontWeight(600).width('100%')
      Scroll() {
        Text(this.options.message).fontFamily(READER_FONT).fontSize(16).width('100%')
          .fontColor($r('sys.color.ohos_id_color_text_secondary'))
      }.constraintSize({ maxHeight: 280 }).width('100%')
      Row({ space: 8 }) {
        if (this.options.primaryButton) { this.actionButton(this.options.primaryButton) }
        if (this.options.secondaryButton) { this.actionButton(this.options.secondaryButton) }
        if (this.options.confirm) { this.actionButton(this.options.confirm) }
      }.width('100%')
    }.padding(24).width('100%')
  }
}
