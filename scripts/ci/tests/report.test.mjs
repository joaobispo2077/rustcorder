import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { main, renderReport, writeReport } from '../report.mjs';
import { digest, loadPolicy, repoRoot, requiredGates, writeJson } from '../gates.mjs';

const baseContext = JSON.parse(readFileSync(new URL('fixtures/context.json', import.meta.url), 'utf8'));
const policy = loadPolicy();
const now = '2026-11-05T12:00:01.000Z';
function context() { return { ...baseContext, branch: 'feature/ci', job_id: 'report' }; }
function receipt(gate = 'format', changes = {}) {
  return {
    schema_version: 1, gate, context: { ...context(), job_id: policy.gate_owners[gate] },
    status: 'pass', required: true, applicable: true, completed: true,
    exit_code: 0, duration_ms: 1250, started_at: '2026-11-05T12:00:00.000Z',
    completed_at: now, raw_outputs: [{ path: gate + '/stdout.log', sha256: 'e'.repeat(64) }],
    measurements: gate === 'coverage' ? { covered: 8, total: 10, floor: 72, files: ['src/a.rs'] } : null,
    reason: null, ...changes,
  };
}
function input(overrides = {}) {
  return { context: context(), receipts: [receipt()], jobs: { policy: 'success', rust: 'success' },
    errors: [], policy, generatedAt: now, ...overrides };
}

test('report records full identity and missing required evidence without inventing readiness', () => {
  const { json, markdown } = renderReport(input());
  assert.equal(json.schema_version, 1);
  assert.deepEqual(json.context, context());
  assert.equal(json.assessment.ready, false);
  assert.ok(json.assessment.reasons.includes('Missing gate: mutation-rust'));
  assert.match(markdown, /before final CI readiness/i);
  assert.match(markdown, /303.*attempt.*1/);
  assert.match(markdown, new RegExp(context().tested_sha));
});

test('failed gates stay failed even when their rounded percentage displays the threshold', () => {
  const coverage = receipt('coverage', { status: 'fail', reason: 'Coverage below frozen floor', measurements: {
    status: 'fail', covered: 79999, total: 100000, floor: 80, percent: 79.999, files: ['src/a.rs'],
  } });
  const { json, markdown } = renderReport(input({ receipts: [coverage] }));
  const row = json.gates.find(x => x.gate === 'coverage');
  assert.equal(row.status, 'fail');
  assert.equal(row.measurements.covered, 79999);
  assert.equal(json.assessment.ready, false);
  assert.match(markdown, /79999\/100000/);
  assert.match(markdown, /80\.00%.*display only/);
  assert.match(markdown, /Coverage below frozen floor/);
});

test('zero test failures and absent test measurements remain distinct', () => {
  const { json, markdown } = renderReport(input({ receipts: [receipt('unit', {
    counts: { listed: 5, passed: 5, failed: 0, ignored: 0 },
    measurements: { listed: 5, passed: 5, failed: 0, ignored: 0, names: ['a'], ignored_names: [] },
  })] }));
  assert.equal(json.gates.find(x => x.gate === 'unit').counts.failed, 0);
  assert.equal(json.gates.find(x => x.gate === 'integration').measurements, null);
  assert.match(markdown, /"failed": 0/);
  assert.match(markdown, /Not reported/);
});

test('ignored external identities, source scopes and exact exceptions survive rendering', () => {
  const measurements = { listed: 7, passed: 2, failed: 0, ignored: 5,
    ignored_names: ['real_asr_model', 'physical_microphone'], files: ['tests/integration.rs'] };
  const { json, markdown } = renderReport(input({ receipts: [receipt('integration', { measurements })] }));
  assert.deepEqual(json.gates.find(x => x.gate === 'integration').measurements, measurements);
  assert.deepEqual(json.policy.complexity.exceptions, policy.complexity.exceptions);
  assert.match(markdown, /real_asr_model/);
  assert.match(markdown, /tests\/integration\.rs/);
  assert.match(markdown, /src\/ui\.rs/);
});

test('headless UI evidence and absent native evidence have explicit labels', () => {
  const { markdown } = renderReport(input({ receipts: [receipt('ui', {
    measurements: { kind: 'simulated-egui-draw-input', listed: 5, passed: 5, failed: 0, ignored: 0 },
  })] }));
  assert.match(markdown, /simulated-egui-draw-input/);
  assert.match(markdown, /Native package smoke.*excluded/i);
});

test('actual release pushes require package evidence instead of excluding it', () => {
  const ctx = { ...context(), branch: 'release' };
  const { json, markdown } = renderReport(input({ context: ctx, receipts: [] }));
  assert.equal(json.gates.find(x => x.gate === 'package').status, 'incomplete');
  assert.equal(json.assessment.excluded_gates.length, 0);
  assert.match(markdown, /Native package smoke.*incomplete/i);
});

test('native package scope stays separate from simulated UI', () => {
  const { markdown } = renderReport(input({ context: { ...context(), branch: 'release' },
    receipts: [{ ...receipt('package', { measurements: {
      native: { kind: 'native', platform: 'Windows Server 2025', completed: true },
    } }), context: { ...context(), branch: 'release', job_id: 'package' } }],
  }));
  assert.match(markdown, /Windows Server 2025/);
  assert.match(markdown, /"kind": "native"/);
});

test('all required receipts and actual completed jobs can produce a qualified assessment', () => {
  const ctx = context();
  const receipts = requiredGates(ctx, policy).map(gate => receipt(gate, gate.startsWith('mutation-') ? {measurements:{profile:'light'}} : {}));
  const jobs = Object.fromEntries(policy.jobs.ordinary.map(job => [job, 'success']));
  const { json, markdown } = renderReport(input({ receipts, jobs }));
  assert.equal(json.assessment.ready, true);
  assert.match(markdown, /does not certify.*final CI readiness/i);
});

for (const state of ['missing', 'skipped', 'cancelled', 'failure', 'in_progress']) {
  test('actual job ' + state + ' cannot be presented as success', () => {
    const ctx = context();
    const jobs = Object.fromEntries(policy.jobs.ordinary.map(job => [job, 'success']));
    jobs.mutation_ci = state;
    const { json } = renderReport(input({ receipts: requiredGates(ctx, policy).map(gate => receipt(gate)), jobs }));
    assert.equal(json.jobs.mutation_ci, state);
    assert.equal(json.assessment.ready, false);
  });
}

test('collection errors remain blocking despite otherwise complete receipts/jobs', () => {
  const { json, markdown } = renderReport(input({
    receipts: requiredGates(context(), policy).map(gate => receipt(gate)),
    jobs: Object.fromEntries(policy.jobs.ordinary.map(job => [job, 'success'])),
    errors: [{ path: 'artifact/format/gate.json', reason: 'Raw evidence hash mismatch' }],
  }));
  assert.equal(json.assessment.ready, false);
  assert.deepEqual(json.collection_errors, [{ path: 'artifact/format/gate.json', reason: 'Raw evidence hash mismatch' }]);
  assert.match(markdown, /Raw evidence hash mismatch/);
});

test('local dirty evidence remains local and cannot certify hosted readiness', () => {
  const ctx = { ...context(), kind: 'local', event: 'local', run_id: 'local-report-fixture', dirty: true,
    repository_id: null, head_repository_id: null, workflow_id: null, workflow_path: null };
  const { json, markdown } = renderReport(input({ context: ctx, receipts: [], jobs: {} }));
  assert.equal(json.context.kind, 'local');
  assert.equal(json.context.dirty, true);
  assert.equal(json.assessment.ready, false);
  assert.match(markdown, /Local.*dirty.*true/i);
});

for (const key of ['run_attempt', 'tested_sha', 'kind']) {
  test('rejects substituted receipt ' + key, () => {
    const changed = receipt();
    changed.context[key] = key === 'run_attempt' ? 2 : key === 'tested_sha' ? 'f'.repeat(40) : 'local';
    assert.throws(() => renderReport(input({ receipts: [changed] })));
  });
}

test('duplicate gates and malformed jobs/collection errors are rejected', () => {
  assert.throws(() => renderReport(input({ receipts: [receipt(), receipt()] })));
  assert.throws(() => renderReport(input({ jobs: { rust: true } })));
  assert.throws(() => renderReport(input({ errors: [{ path: 'a.json', reason: null }] })));
});

test('untrusted labels are escaped and cannot inject Markdown rows or HTML', () => {
  const { markdown } = renderReport(input({ receipts: [receipt('format', { status: 'fail', reason: '<img src=x>| forged **pass**' })] }));
  assert.doesNotMatch(markdown, /<img/);
  assert.match(markdown, /&lt;img/);
  assert.match(markdown, /\\\|/);
});

function fixture(action) {
  const parent = path.join(repoRoot, '.build');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'report-fixture-'));
  try { return action(root); }
  finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(parent), 'Fixture cleanup must remain under .build');
    rmSync(root, { recursive: true, force: true });
  }
}
function evidence(root) {
  mkdirSync(path.join(root, 'format'));
  const raw = 'formatter checked source without rewriting it\n';
  writeFileSync(path.join(root, 'format/stdout.log'), raw);
  const proof = receipt('format', { raw_outputs: [{ path: 'format/stdout.log', sha256: digest(raw) }] });
  writeJson(path.join(root, 'format/gate.json'), proof);
  return proof;
}

test('report collection verifies raw bytes and writes fixed JSON/Markdown files', () => fixture(root => {
  evidence(root);
  const summary = path.join(root, 'job-summary.md');
  writeFileSync(summary, 'Previous summary\n');
  const result = writeReport({ root, context: context(), jobs: { rust: 'success' }, summaryPath: summary });
  const json = JSON.parse(readFileSync(path.join(root, 'report.json'), 'utf8'));
  assert.equal(json.gates.find(x => x.gate === 'format').status, 'pass');
  assert.deepEqual(json.collection_errors, []);
  assert.equal(readFileSync(path.join(root, 'report.md'), 'utf8'), result.markdown);
  assert.equal(readFileSync(summary, 'utf8'), 'Previous summary\n' + result.markdown + '\n');
}));

test('tampered or cross-attempt receipts become collection errors and missing evidence', () => fixture(root => {
  evidence(root);
  writeFileSync(path.join(root, 'format/stdout.log'), 'substituted bytes');
  const result = writeReport({ root, context: context() });
  assert.equal(result.json.assessment.ready, false);
  assert.equal(result.json.gates.find(x => x.gate === 'format').status, 'incomplete');
  assert.match(result.json.collection_errors[0].reason, /hash mismatch/);
  const next = writeReport({ root, context: { ...context(), run_attempt: 2 } });
  assert.match(next.json.collection_errors[0].reason, /run_attempt/);
}));

test('absent evidence still produces a blocked available-evidence report', () => fixture(root => {
  const out = path.join(root, 'out');
  const { json } = writeReport({ root: path.join(root, 'missing'), context: context(), out });
  assert.equal(json.assessment.ready, false);
  assert.equal(json.collection_errors[0].path, 'collection');
  assert.ok(readFileSync(path.join(out, 'report.md'), 'utf8').includes('Collection error'));
}));

test('optional summary delivery failure does not alter the gate assessment', () => fixture(root => {
  evidence(root);
  const warnings = [];
  const original = console.error;
  console.error = message => warnings.push(message);
  try {
    const result = writeReport({ root, context: context(), summaryPath: root });
    assert.equal(result.json.gates.find(x => x.gate === 'format').status, 'pass');
    assert.equal(result.json.assessment.ready, false);
    assert.match(warnings.join('\n'), /Optional job-summary delivery failed/);
  } finally { console.error = original; }
}));

test('CLI reads explicit identity and actual job states; a failed gate report exits successfully', () => fixture(root => {
  const proof = evidence(root);
  proof.status = 'fail'; proof.reason = 'Controlled formatter failure'; proof.exit_code = 1;
  writeJson(path.join(root, 'format/gate.json'), proof);
  const contextFile = path.join(root, 'context.json');
  writeJson(contextFile, context());
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../report.mjs', import.meta.url)),
    '--root', root, '--context', contextFile], { encoding: 'utf8', timeout: 10000,
    env: { ...process.env, CI_JOB_STATES: '{"rust":"failure","report":"in_progress"}', GITHUB_STEP_SUMMARY: path.join(root, 'summary.md') } });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(readFileSync(path.join(root, 'report.json'), 'utf8'));
  assert.equal(json.gates.find(x => x.gate === 'format').status, 'fail');
  assert.equal(json.jobs.report, 'in_progress');
  assert.equal(json.jobs.rust, 'failure');
  assert.equal(json.assessment.ready, false);
}));

test('CLI rejects unknown arguments, malformed jobs and unusable output destinations', () => fixture(root => {
  const contextFile = path.join(root, 'context.json');
  writeJson(contextFile, context());
  assert.throws(() => main(['--root', root, '--context', contextFile, '--execute', 'anything'], {}));
  assert.throws(() => main(['--root', root, '--context', contextFile], { CI_JOB_STATES: '{' }));
  const outputFile = path.join(root, 'file'); writeFileSync(outputFile, 'preserved');
  assert.throws(() => main(['--root', root, '--context', contextFile, '--out', outputFile], {}));
  assert.equal(readFileSync(outputFile, 'utf8'), 'preserved');
}));

test('rendering does not mutate caller identity, receipts, policy or job states', () => {
  const source = input();
  const before = structuredClone(source);
  const output = renderReport(source);
  output.json.context.branch = 'substituted';
  output.json.policy.coverage.floor = 1;
  assert.deepEqual(source, before);
});

test('large mutation inventories stay complete in JSON while Markdown remains readable and below 64 KiB', t => {
  const outcomes = Array.from({ length: 5000 }, (_, index) => ({
    id: index.toString(16).padStart(64, '0'), file: 'src/app.rs',
    raw_status: index < 1000 ? 'CaughtMutant' : index < 4500 ? 'MissedMutant' : 'Unviable',
    status: index < 1000 ? 'detected' : index < 4500 ? 'survived' : 'nonviable',
  }));
  const measurements = { schema_version: 1, engine: 'cargo-mutants', engine_version: '27.1.0',
    profile: 'light', scope: ['src/app.rs', 'src/settings.rs'], baseline: { passed: 96, failed: 0, ignored: 0 },
    status: 'fail', completed: true, total: 5000, detected: 1000, survived: 3500, nonviable: 500,
    viable: 4500, score: 100 * 1000 / 4500, min_percent: 40,
    inventories: Object.fromEntries(['detected', 'survived', 'nonviable'].map(status =>
      [status, outcomes.filter(outcome => outcome.status === status).map(outcome => outcome.id)])),
    outcomes, reason: 'Mutation score below the 40% light floor',
  };
  const raw_outputs = Array.from({ length: 5000 }, (_, index) => ({
    path: 'mutation-rust/raw/outcome-' + index + '.json', sha256: 'e'.repeat(64),
  }));
  const source = input({ receipts: [receipt('mutation-rust', { status: 'fail', exit_code: 2,
    duration_ms: 54321, measurements, raw_outputs, reason: measurements.reason })] });
  const { json, markdown } = renderReport(source);
  const gate = json.gates.find(item => item.gate === 'mutation-rust');
  assert.equal(gate.measurements?.outcomes?.length, outcomes.length);
  for (const status of ['detected', 'survived', 'nonviable']) {
    assert.equal(gate.measurements?.inventories?.[status]?.length, measurements.inventories[status].length);
  }
  assert.equal(gate.raw_outputs.length, raw_outputs.length);
  assert.equal(digest(JSON.stringify(gate.measurements)), digest(JSON.stringify(measurements)), 'Complete mutation measurements must preserve every value and its order');
  assert.equal(digest(JSON.stringify(gate.raw_outputs)), digest(JSON.stringify(raw_outputs)), 'Complete raw references must preserve every path/hash and its order');
  assert.equal(json.receipts_sha256, digest(JSON.stringify(source.receipts)));
  assert.equal(gate.status, 'fail');
  assert.equal(json.assessment.ready, false);
  const bytes = Buffer.byteLength(markdown);
  t.diagnostic('Large evidence display: ' + bytes + ' Markdown bytes; complete JSON: ' + Buffer.byteLength(JSON.stringify(json)) + ' bytes.');
  assert.ok(bytes < 64 * 1024, 'Readable Markdown exceeded 64 KiB: ' + bytes + ' bytes');
  assert.match(markdown, /detected 1000.*survived 3500.*nonviable 500/);
  assert.match(markdown, /1000\/4500/);
  assert.match(markdown, /floor 40% light/);
  assert.match(markdown, /54321/);
  assert.match(markdown, /src\/settings\.rs/);
  assert.match(markdown, /Mutation score below the 40% light floor/);
  assert.match(markdown, /report\.json/);
  assert.doesNotMatch(markdown, /outcome-4999\.json/);
});
