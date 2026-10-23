import { UIContext } from '@kit.ArkUI';
import { readerFontFile } from './Feed';

export function registerReaderFonts(ui: UIContext): void {
  const font = ui.getFont();
  font.registerFont({ familyName: 'Literata', familySrc: $rawfile('fonts/Literata-Regular.ttf') });
  font.registerFont({ familyName: 'LiterataSemibold', familySrc: $rawfile('fonts/Literata-SemiBold.ttf') });
  font.registerFont({ familyName: 'SourceHanSerif', familySrc: $rawfile('fonts/SourceHanSerifCN-Regular.otf') });
  font.registerFont({ familyName: 'SourceHanSerifSemibold', familySrc: $rawfile('fonts/SourceHanSerifCN-SemiBold.otf') });
}

export function readerFontResponse(url: string): WebResourceResponse | null {
  const file = readerFontFile(url);
  if (!file) return null;
  const response = new WebResourceResponse();
  response.setResponseData($rawfile(`fonts/${file}`));
  response.setResponseMimeType(file.endsWith('.otf') ? 'font/otf' : 'font/ttf');
  response.setResponseCode(200);
  response.setReasonMessage('OK');
  response.setResponseHeader([{ headerKey: 'Access-Control-Allow-Origin', headerValue: '*' }]);
  return response;
}
