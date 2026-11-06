import test from 'node:test';
import assert from 'node:assert/strict';
import * as gates from '../gates.mjs';
import { readFileSync } from 'node:fs';
const policy = JSON.parse(readFileSync(new URL('../policy.json', import.meta.url), 'utf8'));
const context = JSON.parse(readFileSync(new URL('fixtures/context.json', import.meta.url), 'utf8'));
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
