import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMetrics } from 'mutation-testing-metrics';
import { cargoMutantId, normalizeRustMutation, normalizeCiMutation } from '../mutation.mjs';

const timeoutFiles = { 'scripts/ci/gates.mjs': { language: 'javascript', source: 'true', mutants: [
  { id: '1', mutatorName: 'BooleanLiteral', location: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } }, status: 'Timeout' },
] } };

test('timeouts withhold a policy score rather than creating detections', () => {
  assert.equal(calculateMetrics(timeoutFiles).metrics.mutationScore, 100, 'The pinned built-in counts this timeout as detected');
  const fixture = ciFixture(['Timeout']);
  const result = normalizeCiMutation(fixture);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.score, null);
});

const start = '2026-11-05T10:00:00.000Z';
const end = '2026-11-05T10:00:05.000Z';
function execution(scope, profile = 'light', exit_code = 0) {
  return { profile, exit_code, completed: true, fresh: true, cached: false, scope,
    baseline: { completed: true, passed: 3, failed: 0, ignored: 0 }, started_at: start, completed_at: end };
}
function rustMutant(index) {
  const span = { start: { line: index + 1, column: 1 }, end: { line: index + 1, column: 2 } };
  return { name: 'src/app.rs: replace f' + index + ' with true', package: 'rustcorder', file: 'src/app.rs',
    function: { function_name: 'f' + index, return_type: '-> bool', span }, span, replacement: 'true', genre: 'FnValue', diff: 'fixture diff' };
}
function phase(phase, process_status) { return { phase, process_status, duration: 0.01, argv: ['cargo', 'test', '--lib'] }; }
function scenario(mutant, summary) {
  const bare = { ...mutant }; delete bare.diff;
  const phases = summary === 'Unviable' ? [phase('Build', { Failure: 101 })] :
    [phase('Build', 'Success'), phase('Test', summary === 'CaughtMutant' ? { Failure: 101 } : summary === 'Timeout' ? 'Timeout' : 'Success')];
  return { scenario: { Mutant: bare }, summary, log_path: 'log/mutant.log', diff_path: 'diff/mutant.diff', phase_results: phases };
}
function rustFixture(statuses = ['CaughtMutant', 'CaughtMutant', 'MissedMutant', 'MissedMutant', 'MissedMutant', 'Unviable']) {
  const mutants = statuses.map((_, index) => rustMutant(index));
  return { mutants, outcomes: {
    cargo_mutants_version: '27.1.0', start_time: start, end_time: end,
    total_mutants: statuses.length, caught: statuses.filter(x => x === 'CaughtMutant').length,
    missed: statuses.filter(x => x === 'MissedMutant').length, unviable: statuses.filter(x => x === 'Unviable').length,
    timeout: statuses.filter(x => x === 'Timeout').length, success: statuses.filter(x => x === 'Success').length,
    outcomes: [{ scenario: 'Baseline', summary: 'Success', log_path: 'log/baseline.log', diff_path: null,
      phase_results: [phase('Build', 'Success'), phase('Test', 'Success')] },
    ...statuses.map((status, index) => scenario(mutants[index], status))],
  }, execution: execution(['src/app.rs'], 'light', statuses.includes('MissedMutant') ? 2 : 0) };
}
function ciFixture(statuses = ['Killed', 'Killed', 'Survived', 'Survived', 'Survived', 'CompileError']) {
  const mutants = statuses.map((status, index) => ({ id: String(index), mutatorName: 'BooleanLiteral',
    location: { start: { line: index + 1, column: 1 }, end: { line: index + 1, column: 5 } }, replacement: 'false', status }));
  return { report: { schemaVersion: '1.0', framework: { name: 'StrykerJS', version: '10.1.1' },
    projectRoot: '/repo', config: { incremental: false, inPlace: false }, thresholds: { high: 80, low: 60 },
    files: { 'scripts/ci/gates.mjs': { language: 'javascript', source: 'true\n'.repeat(statuses.length), mutants } } },
    plan: { mutantPlans: mutants.map(({ status, ...mutant }) => ({ plan: 'Run', mutant: { ...structuredClone(mutant),
      location: Object.fromEntries(Object.entries(mutant.location).map(([edge, position]) =>
        [edge, { line: position.line - 1, column: position.column - 1 }])), fileName: '/repo/scripts/ci/gates.mjs' } })) },
    dryRun: { result: { status: 'complete', tests: [{ id: 'all', status: 0, name: 'all command tests', timeSpentMs: 10 }] } },
    execution: execution(['scripts/ci/gates.mjs']),
  };
}

test('Rust complete accounting uses viable-only exact 40/50 floors and accepts exit 2', () => {
  const fixture = rustFixture(), result = normalizeRustMutation(fixture);
  assert.equal(result.status, 'pass'); assert.equal(result.score, 40);
  assert.equal(result.detected, 2); assert.equal(result.survived, 3); assert.equal(result.nonviable, 1);
  assert.equal(result.viable, 5); assert.equal(result.total, 6);
  fixture.execution.profile = 'full';
  assert.equal(normalizeRustMutation(fixture).status, 'fail');
  const full = rustFixture(['CaughtMutant', 'MissedMutant', 'Unviable']);
  full.execution.profile = 'full';
  assert.equal(normalizeRustMutation(full).score, 50);
  assert.equal(normalizeRustMutation(full).status, 'pass');
});

test('Rust ID ignores only list diff and property order, retaining exact source/replacement identity', () => {
  const original = rustMutant(1);
  assert.equal(cargoMutantId(original), cargoMutantId(Object.fromEntries(Object.entries(original).reverse())));
  assert.equal(cargoMutantId(original), cargoMutantId({ ...original, diff: 'different diagnostic diff' }));
  assert.notEqual(cargoMutantId(original), cargoMutantId({ ...original, replacement: 'false' }));
});

for (const [name, mutate] of [
  ['missing outcome', x => { x.outcomes.outcomes.pop(); }],
  ['duplicate outcome', x => { x.outcomes.outcomes.push(x.outcomes.outcomes[1]); }],
  ['duplicate generated ID', x => { x.mutants.push(x.mutants[0]); }],
  ['substituted identity', x => { x.outcomes.outcomes[1].scenario.Mutant.replacement = 'false'; }],
  ['absent baseline', x => { x.outcomes.outcomes.shift(); }],
  ['duplicate baseline', x => { x.outcomes.outcomes.push(x.outcomes.outcomes[0]); }],
  ['baseline without tests', x => { x.outcomes.outcomes[0].phase_results.pop(); }],
  ['baseline failure', x => { x.outcomes.outcomes[0].summary = 'Failure'; }],
  ['caught build failure', x => { x.outcomes.outcomes[1].phase_results[0].process_status = { Failure: 101 }; }],
  ['caught success contradiction', x => { x.outcomes.outcomes[1].phase_results[1].process_status = 'Success'; }],
  ['nonviable test failure', x => { x.outcomes.outcomes.at(-1).phase_results = [phase('Test', { Failure: 101 })]; }],
  ['invalid phase duration', x => { x.outcomes.outcomes[0].phase_results[0].duration = -1; }],
  ['counter mismatch', x => { x.outcomes.caught += 1; }],
  ['zero-like boolean counter', x => { x.outcomes.timeout = false; }],
  ['missing completion marker', x => { x.outcomes.end_time = null; }],
  ['stale raw times', x => { x.outcomes.start_time = '2026-11-04T10:00:00Z'; }],
  ['wrong engine version', x => { x.outcomes.cargo_mutants_version = '26.0.0'; }],
  ['cached generated marker', x => { x.mutants[0].cached = true; }],
  ['foreign file scope', x => { x.execution.scope = ['src/settings.rs']; }],
]) test('Rust refuses ' + name, () => {
  const fixture = rustFixture(); mutate(fixture); const result = normalizeRustMutation(fixture);
  assert.equal(result.status, 'incomplete'); assert.equal(result.score, null);
  assert.ok(result.reason);
});
for (const status of ['Timeout', 'Failure', 'Success', 'Unknown', 'Pending']) {
  test('Rust does not count ' + status + ' as detected', () => {
    const fixture = rustFixture([status, 'CaughtMutant']);
    assert.equal(normalizeRustMutation(fixture).status, 'incomplete');
  });
}
test('Rust zero viable denominator cannot produce a score', () => {
  assert.equal(normalizeRustMutation(rustFixture(['Unviable'])).score, null);
});

test('Stryker ignores built-in thresholds and excludes compile errors', () => {
  const fixture = ciFixture(), result = normalizeCiMutation(fixture);
  assert.equal(result.status, 'pass'); assert.equal(result.score, 40);
  assert.equal(result.detected, 2); assert.equal(result.survived, 3); assert.equal(result.nonviable, 1);
  fixture.execution.profile = 'full'; fixture.report.thresholds = { high: 0, low: 0 };
  assert.equal(normalizeCiMutation(fixture).status, 'fail');
  const full = ciFixture(['Killed', 'Survived', 'CompileError']); full.execution.profile = 'full';
  assert.equal(normalizeCiMutation(full).status, 'pass');
});
test('Stryker reconciles an actual 10.1.1 internal plan with its schema report coordinates', () => {
  // Reduced ID 0 from the completed 680-mutant live light run; only the root path
  // and source payload are portable fixture data. Neither coordinate set is changed.
  const fixture = ciFixture(['Killed']);
  fixture.report.projectRoot = 'C:\\fixture\\rustcorder';
  fixture.plan.mutantPlans[0].mutant = {
    fileName: 'C:\\fixture\\rustcorder\\scripts\\ci\\gates.mjs', id: '0',
    location: { start: { column: 54, line: 106 }, end: { column: 1, line: 131 } },
    mutatorName: 'BlockStatement', replacement: '{}',
  };
  fixture.report.files['scripts/ci/gates.mjs'].mutants[0] = {
    id: '0', mutatorName: 'BlockStatement', replacement: '{}', status: 'Killed',
    location: { end: { column: 2, line: 132 }, start: { column: 55, line: 107 } },
  };
  const result = normalizeCiMutation(fixture);
  assert.equal(result.status, 'pass', result.reason);
  assert.equal(result.total, 1); assert.equal(result.detected, 1); assert.equal(result.score, 100);
});
for (const edge of ['start', 'end']) for (const coordinate of ['line', 'column']) {
  test('Stryker refuses substituted report ' + edge + ' ' + coordinate, () => {
    const fixture = ciFixture(['Killed']);
    fixture.report.files['scripts/ci/gates.mjs'].mutants[0].location[edge][coordinate] += 1;
    const result = normalizeCiMutation(fixture);
    assert.equal(result.status, 'incomplete'); assert.equal(result.score, null);
  });
  test('Stryker refuses negative plan ' + edge + ' ' + coordinate, () => {
    const fixture = ciFixture(['Killed']);
    fixture.plan.mutantPlans[0].mutant.location[edge][coordinate] = -1;
    assert.equal(normalizeCiMutation(fixture).status, 'incomplete');
  });
  test('Stryker refuses zero report ' + edge + ' ' + coordinate, () => {
    const fixture = ciFixture(['Killed']);
    fixture.report.files['scripts/ci/gates.mjs'].mutants[0].location[edge][coordinate] = 0;
    assert.equal(normalizeCiMutation(fixture).status, 'incomplete');
  });
}
for (const status of ['Timeout', 'NoCoverage', 'RuntimeError', 'Pending', 'Ignored', 'Unknown']) {
  test('Stryker leaves ' + status + ' incomplete', () => {
    const result = normalizeCiMutation(ciFixture(['Killed', status]));
    assert.equal(result.status, 'incomplete'); assert.equal(result.score, null);
  });
}
for (const [name, mutate] of [
  ['missing outcome', x => { x.report.files['scripts/ci/gates.mjs'].mutants.pop(); }],
  ['duplicate outcome', x => { const m = x.report.files['scripts/ci/gates.mjs'].mutants; m.push(m[0]); }],
  ['duplicate plan', x => { x.plan.mutantPlans.push(x.plan.mutantPlans[0]); }],
  ['wrong generated ID', x => { x.plan.mutantPlans[0].mutant.id = 'other'; }],
  ['replacement substitution', x => { x.report.files['scripts/ci/gates.mjs'].mutants[0].replacement = 'true'; }],
  ['location substitution', x => { x.report.files['scripts/ci/gates.mjs'].mutants[0].location.start.column = 2; }],
  ['incremental config', x => { x.report.config.incremental = true; }],
  ['in-place config', x => { x.report.config.inPlace = true; }],
  ['early cached result', x => { x.plan.mutantPlans[0].plan = 'EarlyResult'; }],
  ['wrong engine version', x => { x.report.framework.version = '9.0.0'; }],
  ['wrong report version', x => { x.report.schemaVersion = '2.0'; }],
  ['empty dry run', x => { x.dryRun.result.tests = []; }],
  ['failed dry run', x => { x.dryRun.result.tests[0].status = 1; }],
  ['skipped dry run', x => { x.dryRun.result.tests[0].status = 2; }],
  ['untyped dry run status', x => { x.dryRun.result.tests[0].status = 'success'; }],
  ['duplicate dry run test', x => { x.dryRun.result.tests.push(x.dryRun.result.tests[0]); }],
  ['dry run error', x => { x.dryRun.result.status = 'error'; }],
  ['foreign path', x => { x.plan.mutantPlans[0].mutant.fileName = '/outside/foreign.mjs'; }],
  ['traversal path', x => { x.execution.scope = ['scripts/ci/../outside.mjs']; }],
  ['empty source scope', x => { x.execution.scope = []; }],
]) test('Stryker refuses ' + name, () => {
  const fixture = ciFixture(); mutate(fixture); const result = normalizeCiMutation(fixture);
  assert.equal(result.status, 'incomplete'); assert.equal(result.score, null);
  assert.ok(result.reason);
});
test('Stryker zero viable denominator cannot produce a score', () => {
  assert.equal(normalizeCiMutation(ciFixture(['CompileError'])).score, null);
});
for (const input of [undefined, null, false, [], 'malformed']) {
  test('malformed adapter root stays incomplete: ' + JSON.stringify(input), () => {
    assert.equal(normalizeRustMutation(input).status, 'incomplete');
    assert.equal(normalizeCiMutation(input).status, 'incomplete');
  });
}
for (const engine of ['Rust', 'CI']) {
  for (const [name, mutate] of [
    ['unfinished run', x => { x.completed = false; }],
    ['not fresh', x => { x.fresh = false; }],
    ['cached outcome flag', x => { x.cached = true; }],
    ['alternate cached marker', x => { x.from_cache = true; }],
    ['empty baseline', x => { x.baseline.passed = 0; }],
    ['boolean baseline count', x => { x.baseline.passed = true; }],
    ['negative baseline count', x => { x.baseline.failed = -1; }],
    ['baseline failed', x => { x.baseline.failed = 1; }],
    ['baseline incomplete', x => { x.baseline.completed = false; }],
    ['invalid profile', x => { x.profile = 'fast'; }],
    ['invalid exit', x => { x.exit_code = 1; }],
    ['exit not integer', x => { x.exit_code = '0'; }],
    ['invalid timestamp', x => { x.completed_at = 'tomorrow'; }],
    ['reversed timestamps', x => { x.completed_at = '2026-11-04T10:00:00Z'; }],
  ]) test(engine + ' refuses execution metadata: ' + name, () => {
    const fixture = engine === 'Rust' ? rustFixture() : ciFixture(); mutate(fixture.execution);
    const result = engine === 'Rust' ? normalizeRustMutation(fixture) : normalizeCiMutation(fixture);
    assert.equal(result.status, 'incomplete'); assert.equal(result.score, null);
  });
}
