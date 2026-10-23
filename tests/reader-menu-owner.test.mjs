import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const source = readFileSync(new URL('../entry/src/main/ets/pages/Index.ets', import.meta.url), 'utf8');
function menuCallbacks(start, end) {
  const section = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const click = [...section.matchAll(/\.onClick\(\(\) => \{([^}]+)\}\)/g)].at(-1)[1];
  const condition = section.match(/\.bindMenu\((.*?), (?:this\.choiceMenu\()?\[/)[1];
  const disappear = section.match(/onDisappear: \(\) => \{([^}]+)\}/)[1];
  return (page, owner, folder = '["News"]') => {
    const execute = body => runInNewContext(`(function() { ${body} }).call(page)`, { page, owner, folder, JSON });
    return { open: () => execute(click), visible: () => execute(`return ${condition};`), close: () => execute(disappear) };
  };
}
for (const [name, start, end] of [
  ['add', '  homeActions(', '  errorMenu('],
  ['folder', '  folderHeader(', '  library('],
]) {
  test(`${name} menu belongs only to the library instance that opened it`, () => {
    const make = menuCallbacks(start, end);
    const page = { showAddMenu: false, addMenuOwner: '', folderMenu: '' };
    const home = make(page, 'home'), sidebar = make(page, 'sidebar');
    sidebar.open();
    assert.deepEqual([home.visible(), sidebar.visible()], [false, true]);
    home.close(); // A hidden/previous menu disappearing must not dismiss the active one.
    assert.equal(sidebar.visible(), true);
    sidebar.close();
    assert.deepEqual([home.visible(), sidebar.visible()], [false, false]);
    home.open();
    assert.deepEqual([home.visible(), sidebar.visible()], [true, false]);
    sidebar.close(); assert.equal(home.visible(), true);
    home.close(); assert.equal(home.visible(), false);
  });
}
