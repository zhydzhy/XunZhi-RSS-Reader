import assert from 'node:assert/strict';
import { test } from 'node:test';
import { syncStatus } from '../entry/src/main/ets/probe/SyncStatus.ts';

test('zero code before terminal progress never claims completion', () => {
  for (const stage of [0, 1, 99]) {
    assert.doesNotMatch(syncStatus(stage, 0), /本轮端云同步完成/);
  }
});

test('terminal success still asks for peer verification', () => {
  assert.match(syncStatus(2, 0), /本轮端云同步完成/);
  assert.match(syncStatus(2, 0), /仍需在另一台设备核对/);
});

test('every known failure and unknown codes remain failures', () => {
  for (const code of [-1, 1, 2, 3, 4, 5, 6, 7, 8, 99]) {
    const message = syncStatus(2, code);
    assert.match(message, /同步未成功/);
    assert.ok(message.includes(`code=${code}`));
  }
});

test('partial failure or remaining rows cannot be reported as success', () => {
  assert.match(syncStatus(2, 0, 1), /失败或未完成/);
  assert.doesNotMatch(syncStatus(2, 0, 1), /本轮端云同步完成/);
});
