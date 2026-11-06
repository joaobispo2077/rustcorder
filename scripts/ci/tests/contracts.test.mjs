import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const target = new URL('../gates.mjs', import.meta.url);
const core = existsSync(target) ? await import(target.href) : {};
const context = JSON.parse(readFileSync(new URL('fixtures/context.json', import.meta.url), 'utf8'));
function fn(name) {
  assert.equal(typeof core[name], 'function', 'Missing gate contract: ' + name);
  return core[name];
}
function receipt() {
  return {
    schema_version: 1, gate: 'format', context: structuredClone(context),
    status: 'pass', applicable: true, required: true, completed: true,
    exit_code: 0, duration_ms: 12,
    started_at: '2026-11-05T12:00:00.000Z',
    completed_at: '2026-11-05T12:00:00.012Z',
    raw_outputs: [{ path: 'format.log', sha256: 'e'.repeat(64) }],
    measurements: null, reason: null,
  };
}

test('valid hosted context retains actual attempt identity', () => {
  assert.equal(fn('validateContext')(structuredClone(context), context).run_attempt, 1);
});
for (const [key, value] of [
  ['schema_version', 2], ['run_id', 0], ['run_attempt', true],
  ['repository_id', '101'], ['tested_sha', 'main'], ['policy_sha256', 'bad'],
  ['workflow_path', '../ci.yml'], ['job_id', 'bad\njob'], ['kind', 'invented'],
]) {
  test('context rejects invalid ' + key, () => {
    const changed = { ...context, [key]: value };
    assert.throws(() => fn('validateContext')(changed, context));
  });
}
for (const key of ['repository', 'repository_id', 'head_repository_id', 'workflow_id',
  'workflow_sha', 'event', 'branch', 'tested_sha', 'source_sha', 'run_id', 'run_attempt',
  'policy_sha256', 'toolchain_sha256']) {
  test('context cannot substitute ' + key + ' from another attempt', () => {
    const value = typeof context[key] === 'number' ? context[key] + 1 :
      String(context[key]).replace(/^[a-z]/, 'f') + (String(context[key]).length < 40 ? '-other' : '');
    assert.throws(() => fn('validateContext')({ ...context, [key]: value }, context));
  });
}
for (const bad of [-1, 1.5, true, '1', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test('counter rejects ' + String(bad), () => {
    assert.throws(() => fn('counter')(bad, 'test'));
  });
}
test('zero is a valid count but not a nonempty population', () => {
  assert.equal(fn('counter')(0, 'test'), 0);
  assert.throws(() => fn('counter')(0, 'test', true));
});
for (const value of ['', '../escape', '/root', 'C:escape', 'folder/../x',
  '\\\\server\\share', 'name\0bad', 'folder/CON.txt', 'folder/trailing.', 'x:y']) {
  test('relative path rejects ' + JSON.stringify(value), () => {
    assert.throws(() => fn('safeRelativePath')(value));
  });
}
test('relative paths normalize Windows separators and preserve Unicode', () => {
  assert.equal(fn('safeRelativePath')('src\\ui.rs'), 'src/ui.rs');
  assert.equal(fn('safeRelativePath')('evidence/ação.json'), 'evidence/ação.json');
});
test('valid receipt binds raw output to the expected attempt', () => {
  assert.equal(fn('validateReceipt')(receipt(), context).status, 'pass');
});
for (const mutate of [
  r => { r.completed = false; },
  r => { r.status = 'skipped'; },
  r => { r.exit_code = 1; },
  r => { r.raw_outputs = []; },
  r => { r.raw_outputs[0].path = '../../escape'; },
  r => { r.duration_ms = -1; },
  r => { r.context.run_attempt = 2; },
  r => { r.status = 'excluded'; r.reason = 'not today'; },
  r => { r.counts = { passed: true }; },
]) {
  test('required receipt rejects inconsistent or forged proof ' + mutate.toString(), () => {
    const r = receipt(); mutate(r);
    assert.throws(() => fn('validateReceipt')(r, context));
  });
}
test('an unexecuted measurement cannot be represented by a passing receipt', () => {
  const r = receipt();
  r.gate = 'coverage'; r.measurements = { covered: 0, total: 0 };
  assert.throws(() => fn('validateReceipt')(r, context));
});
test('local identity cannot be accepted as expected hosted proof', () => {
  assert.throws(() => fn('validateContext')({ ...context, kind: 'local' }, context));
});

test('local receipts cannot hide changed dirty state', () => {
  const local = { ...context, kind: 'local', event: 'local', run_id: 'local-test', dirty: false };
  assert.throws(() => core.validateContext({ ...local, dirty: true }, local));
});

test('a hosted receipt cannot claim a dirty source checkout', () => {
  assert.throws(() => core.validateContext({ ...context, dirty: true }));
});

test('an exception must identify the exact debt it exempts', () => {
  const policy = JSON.parse(readFileSync(new URL('../policy.json', import.meta.url), 'utf8'));
  policy.complexity.exceptions.push({ owner: 'maintainer', reason: 'Legacy function' });
  assert.throws(() => core.validatePolicy(policy));
});
test('policy accepts an unset baseline as configuration but refuses bad floors', () => {
  const filename = fileURLToPath(new URL('../policy.json', import.meta.url));
  assert.ok(existsSync(filename), 'Required gate policy must exist');
  const policy = JSON.parse(readFileSync(filename, 'utf8'));
  policy.coverage.floor = null;
  assert.equal(fn('validatePolicy')(policy).coverage.floor, null);
  for (const floor of [0, -1, 101, true, '80', 20.5]) {
    assert.throws(() => fn('validatePolicy')({ ...policy, coverage: { ...policy.coverage, floor } }));
  }
});

for (const key of ['source_sha', 'tested_sha', 'workflow_sha', 'policy_sha256', 'toolchain_sha256']) {
  test('hash type is strict for ' + key + ', not string-coerced', () => {
    assert.throws(() => core.validateContext({ ...context, [key]: [context[key]] }));
  });
}
for (const mutate of [
  r => { delete r.started_at; },
  r => { r.completed_at = 'tomorrow'; },
  r => { r.completed_at = '2026-11-04T12:00:00.000Z'; },
  r => { r.raw_outputs[0].sha256 = [r.raw_outputs[0].sha256]; },
]) {
  test('execution provenance rejects invalid timestamp or hash ' + mutate.toString(), () => {
    const r = receipt(); mutate(r);
    assert.throws(() => core.validateReceipt(r, context));
  });
}
