import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { window, CustomColors, CustomTheme, ThemeControl, KeyboardAvoidMode } from '@kit.ArkUI';
import { ReaderPreferences, readerColorMode } from '../reader/ReaderPreferences';

class ReaderColors implements CustomColors {
  brand: ResourceColor = $r('app.color.reader_accent');
  fontEmphasize: ResourceColor = $r('app.color.reader_accent');
  iconEmphasize: ResourceColor = $r('app.color.reader_accent');
  compBackgroundEmphasize: ResourceColor = $r('app.color.reader_accent');
  fontOnPrimary: ResourceColor = $r('app.color.reader_on_accent');
}
class ReaderTheme implements CustomTheme { colors: CustomColors = new ReaderColors(); }

const DOMAIN = 0x0000;

export default class EntryAbility extends UIAbility {
  private mainWindow?: window.Window;
  private keyboardHeightChanged = (height: number): void => {
    AppStorage.setOrCreate('readerKeyboardVisible', height > 0);
  };
  // Lists and the reader run under the gesture bar (or button bar) and end their content above it.
  private avoidAreaChanged = (): void => {
    const current = this.mainWindow;
    if (!current) return;
    try {
      const bottom = Math.max(current.getWindowAvoidArea(window.AvoidAreaType.TYPE_NAVIGATION_INDICATOR).bottomRect.height,
        current.getWindowAvoidArea(window.AvoidAreaType.TYPE_SYSTEM).bottomRect.height);
      AppStorage.setOrCreate('readerBottomInset', current.getUIContext().px2vp(bottom));
    } catch (_) {
      hilog.error(DOMAIN, 'testTag', 'Failed to read the bottom avoid area');
    }
  };

  onCreate(want: Want, launchParam: AbilityConstant.LaunchParam): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onCreate');
  }

  onDestroy(): void {
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onDestroy');
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    // Main window is created, set main page for this ability
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageCreate');

    try {
      const appearance = new ReaderPreferences(this.context).load();
      this.context.getApplicationContext().setColorMode(readerColorMode(appearance.theme));
    } catch (_) {
      hilog.error(DOMAIN, 'testTag', 'Failed to restore reading appearance');
    }
    ThemeControl.setDefaultTheme(new ReaderTheme());
    AppStorage.setOrCreate('readerKeyboardVisible', false);
    this.mainWindow = windowStage.getMainWindowSync();
    this.mainWindow.on('keyboardHeightChange', this.keyboardHeightChanged);
    windowStage.loadContent('pages/Index', (err) => {
      if (err.code) {
        hilog.error(DOMAIN, 'testTag', 'Failed to load the content. Cause: %{public}s', JSON.stringify(err));
        return;
      }
      windowStage.getMainWindowSync().getUIContext().setKeyboardAvoidMode(KeyboardAvoidMode.RESIZE);
      this.mainWindow?.on('avoidAreaChange', this.avoidAreaChanged);
      this.avoidAreaChanged();
      hilog.info(DOMAIN, 'testTag', 'Succeeded in loading the content.');
    });

  }

  onWindowStageDestroy(): void {
    this.mainWindow?.off('keyboardHeightChange', this.keyboardHeightChanged);
    this.mainWindow?.off('avoidAreaChange', this.avoidAreaChanged);
    this.mainWindow = undefined;
    AppStorage.setOrCreate('readerKeyboardVisible', false);
    // Main window is destroyed, release UI related resources
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onWindowStageDestroy');
  }

  onForeground(): void {
    AppStorage.setOrCreate('readerInBackground', false);
    // Ability has brought to foreground
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onForeground');
  }

  onBackground(): void {
    AppStorage.setOrCreate('readerInBackground', true);
    // Ability has back to background
    hilog.info(DOMAIN, 'testTag', '%{public}s', 'Ability onBackground');
  }
}
