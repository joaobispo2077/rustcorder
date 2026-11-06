import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
const target = new URL('../release.mjs', import.meta.url);
const release = existsSync(target) ? await import(target.href) : {};
const officialDefault = messages => analyzeCommits({ preset: 'conventionalcommits' }, {
  cwd: process.cwd(), commits: messages.map((message, index) => ({ message, hash: String(index).padStart(40, 'a') })),
  logger: { log() {} },
});
const impact = release.semanticImpact ?? officialDefault;
for (const [message, expected] of [
  ['fix: retain recording on interruption', 'patch'],
  ['feat(ui): expose cancellation', 'minor'],
  ['feat!: change worker protocol', 'major'],
  ['fix: change worker protocol\n\nBREAKING CHANGE: old workers are incompatible', 'major'],
  ['docs(release): correct installation instructions', 'patch'],
  ['docs(release)!: drop an unsupported target', 'major'],
  ['docs(release): change setup\n\nBREAKING CHANGE: change required platform', 'major'],
  ['docs: describe internals', null],
  ['test: cover cancellation', null],
  ['refactor: simplify a helper', null],
  ['ci: add a gate', null],
  ['chore(release): prepare 0.2.0', null],
]) test('semantic policy: ' + message.split('\n')[0], async () => assert.equal(await impact([message]), expected));
test('breaking impact wins across merged feature/fix/doc commits', async () => {
  assert.equal(await impact(['fix: repair state', 'feat: add export', 'docs(release)!: remove platform']), 'major');
});
