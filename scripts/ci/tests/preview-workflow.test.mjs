import test from 'node:test';
import assert from 'node:assert/strict';
import * as release from '../release.mjs';
import { jobNames, git } from '../gates.mjs';
import { readFileSync } from 'node:fs';
import { parse as yaml } from 'yaml';
const repository = 'joaobispo2077/rustcorder';
const sha = 'a'.repeat(40);
function scenario(mutate = () => {}) {
  const repo = { id: 101, full_name: repository };
  const state = {
    run: { id: 303, run_attempt: 1, workflow_id: 202, path: '.github/workflows/ci.yml',
      event: 'push', head_branch: 'release', head_sha: sha, repository: repo, head_repository: repo,
      status: 'completed', conclusion: 'success' },
    jobs: Object.entries(jobNames).map(([id, name], index) => ({ id: index + 1, name,
      status: 'completed', conclusion: 'success', run_id: 303, run_attempt: 1, head_sha: sha })),
    artifacts: ['quality', 'certification', 'evidence-package'].map((name, index) => ({
      id: index + 500, name: name === 'evidence-package' ? 'evidence-303-1-package' : name + '-303-1',
      expired: false, size_in_bytes: 100, digest: 'sha256:' + 'd'.repeat(64),
    })),
    tip: sha,
  };
  mutate(state);
  const reads = [];
  async function api(endpoint) {
    reads.push(endpoint);
    if (endpoint === '/repos/' + repository) return repo;
    if (endpoint.endsWith('/actions/workflows/ci.yml')) return { id: 202, path: '.github/workflows/ci.yml', state: 'active' };
    if (/\/actions\/runs\/303$/.test(endpoint)) return state.run;
    if (endpoint.includes('/attempts/1/jobs?')) {
      const page = Number(new URL('https://api.github.com' + endpoint).searchParams.get('page'));
      return { total_count: state.jobs.length, jobs: state.jobs.slice((page - 1) * 100, page * 100) };
    }
    if (endpoint.includes('/artifacts?')) {
      const page = Number(new URL('https://api.github.com' + endpoint).searchParams.get('page'));
      return { total_count: state.artifacts.length, artifacts: state.artifacts.slice((page - 1) * 100, page * 100) };
    }
    if (endpoint.endsWith('/git/ref/heads/release')) return { ref: 'refs/heads/release', object: { type: 'commit', sha: state.tip } };
    throw new Error('Unexpected read-only API endpoint: ' + endpoint);
  }
  return { state, reads, api, input: { repository, run_id: 303, run_attempt: 1, source_sha: sha } };
}
test('preview verifier binds repository, actual push, latest attempt, jobs and artifact digests', async () => {
  const s = scenario();
  const result = await release.verifySourceAttempt(s.input, s.api);
  assert.equal(result.run.id, 303);
  assert.equal(result.artifacts.certification.id, 501);
  assert.ok(s.reads.every(x => x.startsWith('/repos/' + repository)));
});
for (const [label, mutate] of [
  ['PR completion', s => { s.run.event = 'pull_request'; }],
  ['other repository', s => { s.run.repository = { id: 999, full_name: 'someone/other' }; }],
  ['fork head', s => { s.run.head_repository = { id: 999, full_name: 'someone/fork' }; }],
  ['workflow substitution', s => { s.run.workflow_id = 999; }],
  ['newer run attempt', s => { s.run.run_attempt = 2; }],
  ['proposed merge SHA', s => { s.run.head_sha = 'b'.repeat(40); }],
  ['changed release tip', s => { s.tip = 'b'.repeat(40); }],
  ['skipped required job', s => { s.jobs[0].conclusion = 'skipped'; }],
  ['missing readiness job', s => { s.jobs.pop(); }],
  ['expired artifact', s => { s.artifacts[0].expired = true; }],
  ['invalid archive digest', s => { s.artifacts[0].digest = 'unknown'; }],
]) test('preview refuses ' + label, async () => {
  const s = scenario(mutate);
  await assert.rejects(() => release.verifySourceAttempt(s.input, s.api));
});
test('job and artifact collections are paginated rather than truncated at first page', async () => {
  const s = scenario(state => {
    state.jobs.unshift(...Array.from({ length: 100 }, (_, i) => ({ id: i + 1000, name: 'unrelated-' + i })));
    state.artifacts.unshift(...Array.from({ length: 100 }, (_, i) => ({ id: i + 1000, name: 'unrelated-' + i })));
  });
  await release.verifySourceAttempt(s.input, s.api);
  assert.ok(s.reads.some(x => x.includes('/jobs?') && x.endsWith('page=2')));
  assert.ok(s.reads.some(x => x.includes('/artifacts?') && x.endsWith('page=2')));
});
test('a run cannot change attempts while its evidence is being collected', async () => {
  const s = scenario();
  let reads = 0;
  const api = async endpoint => {
    if (/\/actions\/runs\/303$/.test(endpoint) && ++reads === 2) return { ...s.state.run, run_attempt: 2 };
    return s.api(endpoint);
  };
  await assert.rejects(() => release.verifySourceAttempt(s.input, api), /attempt/i);
});

test('installed preview is read-only, main-controlled and actual-push filtered', () => {
  const workflow = yaml(readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.permissions.contents, 'read');
  assert.ok(workflow.jobs.preview.if.includes("github.ref == 'refs/heads/main'"));
  assert.ok(workflow.jobs.preview.if.includes("workflow_run.event == 'push'"));
  const checkout = workflow.jobs.preview.steps.find(x => x.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ github.workflow_sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.ok(workflow.jobs.preview.steps.some(x => x.run?.includes('--omit=peer --ignore-scripts')));
});

test('trusted controls reconcile the executing SHA with the actual running main workflow', async () => {
  const head = git(['rev-parse', 'HEAD']);
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repository, GITHUB_REPOSITORY_ID: '101',
    GITHUB_REF: 'refs/heads/main', GITHUB_WORKFLOW_REF: repository + '/.github/workflows/release.yml@refs/heads/main',
    GITHUB_WORKFLOW_SHA: head, GITHUB_SHA: head, GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_RUN_ID: '404', GITHUB_RUN_ATTEMPT: '1', GITHUB_ACTOR: 'fixture-owner' };
  const run = { id: 404, run_attempt: 1, workflow_id: 405, event: 'workflow_dispatch',
    path: '.github/workflows/release.yml', head_branch: 'main', head_sha: head, status: 'in_progress',
    repository: { id: 101, full_name: repository }, head_repository: { id: 101, full_name: repository }, actor: { login: 'fixture-owner' } };
  const api = async endpoint => endpoint.endsWith('/actions/workflows/release.yml') ?
    { id: 405, path: '.github/workflows/release.yml', state: 'active' } : run;
  const cleanGit = args => args[0] === 'status' ? '' : git(args);
  assert.equal((await release.trustedControl(env, api, cleanGit)).source_sha, head);
  await assert.rejects(() => release.trustedControl({ ...env, GITHUB_ACTOR: 'different-owner' }, api, cleanGit), /actor|identity/i);
  await assert.rejects(() => release.trustedControl(env, api, args => args[0] === 'status' ? ' M scripts/ci/release.mjs' : git(args)), /clean|dirty/i);
  await assert.rejects(() => release.trustedControl({ ...env, GITHUB_REF: 'refs/heads/release' }, api));
  run.head_sha = 'f'.repeat(40);
  await assert.rejects(() => release.trustedControl(env, api, cleanGit), /identity|SHA/i);
});
