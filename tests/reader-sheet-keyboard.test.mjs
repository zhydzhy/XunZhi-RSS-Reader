import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const page = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
const ability = readFileSync(new URL('../entry/src/main/ets/entryability/EntryAbility.ets', import.meta.url), 'utf8');
const size = page.match(/height: (.+),\n\s+maskColor:/)[1];
const SheetSize = { FIT_CONTENT: 'fit', MEDIUM: 'medium', LARGE: 'large' };
const height = state => runInNewContext(`(function () { return ${size}; }).call(state)`, { state, SheetSize });

test('focused forms stay compact without an occupying soft keyboard', () => {
  for (const sheet of ['添加订阅', '新建文件夹']) {
    assert.equal(height({ sheet, sheetEditing: true, keyboardVisible: false }), 'fit');
    assert.equal(height({ sheet, sheetEditing: true, keyboardVisible: true }), 'large');
    assert.equal(height({ sheet, sheetEditing: false, keyboardVisible: true }), 'fit');
  }
  for (const sheet of ['移动订阅', '当前活动']) {
    assert.equal(height({ sheet, sheetEditing: false, keyboardVisible: true }), 'medium');
  }
});

function abilityHarness() {
  const storage = new Map(); const listeners = new Map(); const avoidance = [];
  const avoid = { system: 0, indicator: 98 };
  const mockWindow = {
    on(event, callback) { assert.equal(listeners.has(event), false); listeners.set(event, callback); },
    off(event, callback) { assert.equal(listeners.get(event), callback); listeners.delete(event); },
    getWindowAvoidArea: type => ({ bottomRect: { height: type === 'indicator' ? avoid.indicator : avoid.system } }),
    getUIContext: () => ({ setKeyboardAvoidMode: mode => avoidance.push(mode), px2vp: px => px / 3.5 }),
  };
  const EntryAbility = runInNewContext(stripTypeScriptTypes(ability.slice(ability.indexOf('export default class'))
    .replace('export default class', 'class')) + '\nEntryAbility', {
    UIAbility: class {}, DOMAIN: 0, hilog: { info() {}, error() {} },
    AppStorage: { setOrCreate: (key, value) => storage.set(key, value) },
    ReaderPreferences: class { load() { return { theme: 'system' }; } },
    readerColorMode: value => value, ReaderTheme: class {}, ThemeControl: { setDefaultTheme() {} },
    KeyboardAvoidMode: { RESIZE: 'resize' },
    window: { AvoidAreaType: { TYPE_SYSTEM: 'system', TYPE_NAVIGATION_INDICATOR: 'indicator' } },
  });
  const instance = new EntryAbility();
  instance.context = { getApplicationContext: () => ({ setColorMode() {} }) };
  const stage = { getMainWindowSync: () => mockWindow, loadContent: (_path, done) => done({ code: 0 }) };
  return { storage, listeners, avoidance, avoid, instance, stage };
}

test('window keyboard changes reach sheet sizing and are removed when its stage is destroyed', () => {
  const { storage, listeners, avoidance, instance, stage } = abilityHarness();
  const binding = page.match(/@StorageProp\('([^']+)'\) keyboardVisible: boolean = false/);
  assert.ok(binding, 'sheet must observe the window keyboard state');
  for (let cycle = 0; cycle < 2; cycle++) {
    instance.onWindowStageCreate(stage);
    assert.equal(storage.get(binding[1]), false);
    const callback = listeners.get('keyboardHeightChange'); assert.equal(typeof callback, 'function');
    for (const pixels of [800, 650, 0]) {
      callback(pixels);
      assert.equal(height({ sheet: '新建文件夹', sheetEditing: true, keyboardVisible: storage.get(binding[1]) }), pixels ? 'large' : 'fit');
    }
    callback(800); instance.onWindowStageDestroy();
    assert.equal(listeners.size, 0); assert.equal(storage.get(binding[1]), false);
  }
  assert.deepEqual(avoidance, ['resize', 'resize']);
});

test('the bottom system bar height reaches the page and follows the navigation style', () => {
  const { storage, listeners, avoid, instance, stage } = abilityHarness();
  const binding = page.match(/@StorageProp\('([^']+)'\) bottomInset: number = 0/);
  assert.ok(binding, 'lists and the reader must observe the bottom inset');
  instance.onWindowStageCreate(stage);
  assert.equal(storage.get(binding[1]), 28, 'gesture bar height in vp');
  avoid.indicator = 0; avoid.system = 168; listeners.get('avoidAreaChange')();
  assert.equal(storage.get(binding[1]), 48, 'the three-button bar is cleared too');
  avoid.system = 0; listeners.get('avoidAreaChange')();
  assert.equal(storage.get(binding[1]), 0, 'a hidden bar frees the space');
  instance.onWindowStageDestroy();
  assert.equal(listeners.size, 0);
  assert.equal(page.match(/ignoreLayoutSafeArea\(\[LayoutSafeAreaType\.SYSTEM\], \[LayoutSafeAreaEdge\.BOTTOM\]\)/g)?.length, 3,
    'the article list, the reader and settings run under the bar');
  assert.equal(page.match(/contentEndOffset\([^)]*this\.bottomInset/g)?.length, 2, 'scrolling lists end clear of the bar');
});
