import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../entry/src/main/ets/entryability/EntryAbility.ets', import.meta.url), 'utf8');
const resource = name => source.match(new RegExp(`${name}: ResourceColor = \\$r\\('([^']+)'\\)`))[1];
const options = { selectedFontColor: resource('fontOnPrimary'), selectedBackgroundColor: resource('compBackgroundEmphasize') };

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => {
    const channel = parseInt(value, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

for (const theme of ['base', 'dark']) {
  test(`${theme}: brand button label has at least 4.5:1 contrast against its actual background`, () => {
    const palette = JSON.parse(readFileSync(new URL(`../entry/src/main/resources/${theme}/element/color.json`, import.meta.url)));
    const resolve = resource => palette.color.find(color => `app.color.${color.name}` === resource)?.value;
    const foreground = resolve(options.selectedFontColor);
    const background = resolve(options.selectedBackgroundColor);
    assert.ok(foreground && background, 'selected foreground and background must be an explicit adaptive pair');
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5);
  });
}
