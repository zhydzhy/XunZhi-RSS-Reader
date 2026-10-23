import { common, ConfigurationConstant } from '@kit.AbilityKit';
import { preferences } from '@kit.ArkData';

export interface ReaderAppearance {
  theme: string;
  fontSize: number;
}

export function readerColorMode(theme: string): ConfigurationConstant.ColorMode {
  if (theme === 'light') return ConfigurationConstant.ColorMode.COLOR_MODE_LIGHT;
  if (theme === 'dark') return ConfigurationConstant.ColorMode.COLOR_MODE_DARK;
  return ConfigurationConstant.ColorMode.COLOR_MODE_NOT_SET;
}

export class ReaderPreferences {
  private values: preferences.Preferences;
  constructor(context: common.Context, name: string = 'reader_appearance') {
    this.values = preferences.getPreferencesSync(context, { name });
  }
  load(): ReaderAppearance {
    const theme = this.values.getSync('theme', 'system');
    const size = this.values.getSync('fontSize', 18);
    return {
      theme: theme === 'light' || theme === 'dark' ? theme : 'system',
      fontSize: typeof size === 'number' && Number.isFinite(size) ?
        Math.max(14, Math.min(30, Math.round(size / 2) * 2)) : 18
    };
  }
  async save(value: ReaderAppearance): Promise<void> {
    const previous = this.load();
    try {
      this.values.putSync('theme', value.theme);
      this.values.putSync('fontSize', value.fontSize);
      await this.values.flush();
    } catch (_) {
      this.values.putSync('theme', previous.theme);
      this.values.putSync('fontSize', previous.fontSize);
      throw new Error('设置未能保存，请重试');
    }
  }
}
