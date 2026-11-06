import test from 'node:test';
import assert from 'node:assert/strict';
import { executionContext, loadPolicy } from '../gates.mjs';
import { fileURLToPath } from 'node:url';
const sha = 'a'.repeat(40), repository = loadPolicy().repository;
const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: '101',
  GITHUB_EVENT_PATH: fileURLToPath(new URL('fixtures/context.json', import.meta.url)),
  GITHUB_RUN_ID: '303', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: sha, GITHUB_WORKFLOW_SHA: sha,
  GITHUB_EVENT_NAME: 'push', GITHUB_REF_NAME: 'release', GITHUB_JOB: 'rust' };
const run = { id: 303, run_attempt: 1, workflow_id: 202, path: '.github/workflows/ci.yml',
  event: 'push', head_sha: sha, head_branch: 'release',
  repository: { id: 101, full_name: repository }, head_repository: { id: 101, full_name: repository } };
const reader = dirty => args => args[0] === 'rev-parse' ? sha : args[0] === 'branch' ? 'release' :
  args[0] === 'status' ? dirty ? ' M src/main.rs' : '' : assert.fail('Unexpected Git read');
test('hosted identity requires a clean checkout matching the actual API run', async () => {
  assert.equal((await executionContext('rust', env, async () => run, reader(false))).kind, 'hosted');
  await assert.rejects(() => executionContext('rust', env, async () => run, reader(true)), /clean|dirty/i);
});
test('hosted identity refuses API run/attempt/source substitution', async () => {
  for (const changes of [{ id: 999 }, { run_attempt: 2 }, { head_sha: 'b'.repeat(40) }, { head_branch: 'main' }]) {
    await assert.rejects(() => executionContext('rust', env, async () => ({ ...run, ...changes }), reader(false)));
  }
});
