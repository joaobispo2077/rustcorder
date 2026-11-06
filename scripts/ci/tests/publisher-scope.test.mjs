import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('publisher boundaries work when invoked from the workflow script scope', () => {
  const fixture = fileURLToPath(new URL('./publish.test.ps1', import.meta.url)).replaceAll("'", "''");
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', "& '" + fixture + "'"], {
    encoding: 'utf8', windowsHide: true, timeout: 60000,
    env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /Publisher boundary checks passed/);
});
