import assert from 'node:assert/strict';
import test from 'node:test';

import { getInstallerRenamePlan, isBuildCommand } from './tauri-wrapper.mjs';

test('detects only tauri build commands for installer renaming', () => {
  assert.equal(isBuildCommand(['build']), true);
  assert.equal(isBuildCommand(['build', '--debug']), true);
  assert.equal(isBuildCommand(['dev']), false);
  assert.equal(isBuildCommand(['--version']), false);
});

test('plans a hyphenated NSIS installer filename without changing product name', () => {
  const plan = getInstallerRenamePlan({
    srcTauriDir: 'E:/project/desktop/src-tauri',
    productName: 'CC Start',
    version: '1.0.0',
    arch: 'x64',
  });

  assert.equal(plan.source.endsWith('CC Start_1.0.0_x64-setup.exe'), true);
  assert.equal(plan.target.endsWith('CC-Start_1.0.0_x64-setup.exe'), true);
});
