import test from 'node:test';
import assert from 'node:assert/strict';
import * as gates from '../gates.mjs';
import { readFileSync } from 'node:fs';
const policy = JSON.parse(readFileSync(new URL('../policy.json', import.meta.url), 'utf8'));
const context = JSON.parse(readFileSync(new URL('fixtures/context.json', import.meta.url), 'utf8'));

function controlWorkflow(role) {
  const checkout = { uses: 'actions/checkout@' + 'a'.repeat(40), with: { ref: '${{ github.workflow_sha }}', 'persist-credentials': false } };
  const job = permissions => ({ permissions, steps: [structuredClone(checkout), { run: 'node scripts/ci/' + (role === 'pr-report' ? 'pr-comment' : 'release-automation') + '.mjs' }] });
  return { on: { workflow_run: { workflows: ['CI'], types: ['completed'] } }, permissions: { contents: 'read', actions: 'read' }, jobs: role === 'pr-report' ?
    { resolve: job({ contents: 'read', actions: 'read' }), comment: job({ contents: 'read', actions: 'read', 'pull-requests': 'write' }) } :
    { prepare: job({ contents: 'read', actions: 'read' }), metadata: job({ contents: 'read', actions: 'read' }), publish: job({ contents: 'write', actions: 'read' }) } };
}

for (const role of ['release-automation', 'pr-report']) test('trusted role permissions remain isolated: ' + role, () => {
  const workflow = controlWorkflow(role);
  assert.equal(gates.workflowPolicy(workflow, role), true);
  for (const change of [
    value => { value.permissions.contents = 'write'; },
    value => { value.on.pull_request_target = {}; },
    value => { Object.values(value.jobs)[0].permissions.contents = 'write'; },
    value => { Object.values(value.jobs).at(-1).steps[0].with.ref = '${{ github.event.workflow_run.head_sha }}'; },
    value => { Object.values(value.jobs).at(-1).steps.push({ uses: 'actions/cache@' + 'b'.repeat(40) }); },
    value => { Object.values(value.jobs).at(-1).steps.push({ run: 'node candidate/evil.mjs' }); },
  ]) { const mutated = structuredClone(workflow); change(mutated); assert.throws(() => gates.workflowPolicy(mutated, role)); }
});
test('readiness requires all applicable jobs even without receipts', () => {
  const result = gates.readiness(context, [], { policy: 'success', rust: 'success', mutation_rust: 'success', mutation_ci: 'success', report: 'success' }, true, policy);
  assert.equal(result.ready, false);
  assert.ok(result.reasons.some(x => x.includes('Missing gate')));
});
for (const state of ['failure', 'cancelled', 'skipped', 'timed_out', 'unknown', null]) {
  test('required job state cannot be treated as success: ' + state, () => {
    const result = gates.readiness(context, [], { policy: state, rust: 'success', mutation_rust: 'success', mutation_ci: 'success', report: 'success' }, true, policy);
    assert.equal(result.ready, false);
    assert.ok(result.reasons.some(x => x.includes('policy')));
  });
}
test('release push requires package; ordinary PR explicitly excludes it', () => {
  assert.ok(gates.requiredGates({ ...context, event: 'push', branch: 'release' }, policy).includes('package'));
  assert.ok(!gates.requiredGates({ ...context, event: 'pull_request' }, policy).includes('package'));
});
test('failed report construction blocks readiness', () => {
  assert.ok(gates.readiness(context, [], {}, false, policy).reasons.includes('Required report construction failed'));
});
test('workflow actions must be immutable and fork jobs read-only', () => {
  const valid = { on: { push: {}, pull_request: {} }, permissions: { contents: 'read' }, jobs: {
    policy: { steps: [{ uses: 'actions/checkout@' + 'a'.repeat(40), with: { 'persist-credentials': false } }] },
    rust: { steps: [] }, readiness: { if: 'always()', needs: ['policy', 'rust'], steps: [] },
  } };
  assert.ok(gates.workflowPolicy(valid));
  for (const mutate of [
    w => { w.jobs.policy.steps[0].uses = 'actions/checkout@v7'; },
    w => { w.permissions.contents = 'write'; },
    w => { w.on.pull_request_target = {}; },
    w => { w.on.push.paths = ['src']; },
    w => { w.jobs.readiness.if = 'success()'; },
  ]) { const changed = structuredClone(valid); mutate(changed); assert.throws(() => gates.workflowPolicy(changed)); }
});
