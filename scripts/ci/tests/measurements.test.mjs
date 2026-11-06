import test from 'node:test';
import assert from 'node:assert/strict';
import * as gates from '../gates.mjs';

function cov(covered = 8, total = 10) {
  return { type: 'llvm.coverage.json.export', version: '2.0.1', data: [{ files: [{ filename: '/repo/src/a.rs', summary: { lines: { count: total, covered } } }] }] };
}
test('coverage uses exact counts rather than rounded display', () => {
  assert.equal(gates.coverageMeasurement(cov(79999, 100000), ['src/a.rs'], '/repo', 80).status, 'fail');
  assert.equal(gates.coverageMeasurement(cov(), ['src/a.rs'], '/repo', 80).status, 'pass');
  assert.equal(gates.coverageMeasurement(cov(), ['src/a.rs'], '/repo', null).status, 'incomplete');
  assert.equal(gates.coverageMeasurement(cov(), ['src/a.rs'], '/repo', 80).source_root, '/repo');
});
for (const raw of [cov(0, 0), cov(11, 10), cov(-1), { data: [] }]) {
  test('rejects invalid coverage counts ' + JSON.stringify(raw), () => assert.throws(() => gates.coverageMeasurement(raw, ['src/a.rs'], '/repo', 1)));
}
test('coverage cannot omit a first-party file or duplicate it', () => {
  assert.throws(() => gates.coverageMeasurement(cov(), ['src/a.rs', 'src/main.rs'], '/repo', 1));
  const raw = cov(); raw.data[0].files.push(raw.data[0].files[0]);
  assert.throws(() => gates.coverageMeasurement(raw, ['src/a.rs'], '/repo', 1));
});

test('coverage decisions remain exact across the full validated integer range', () => {
  assert.equal(gates.coverageMeasurement(cov(7205759403792792, 9007199254740991), ['src/a.rs'], '/repo', 80).status, 'fail');
});
test('duplication checks raw lines with positive Rust population', () => {
  const raw = { statistics: { total: { lines: 100000, duplicatedLines: 2001, sources: 2 }, formats: { rust: { sources: 2 } } } };
  assert.equal(gates.duplicationMeasurement(raw, 2).status, 'fail');
  raw.statistics.total.duplicatedLines = 2000;
  assert.equal(gates.duplicationMeasurement(raw, 2).status, 'pass');
  assert.throws(() => gates.duplicationMeasurement(raw, 3));
  raw.statistics.total.lines = 0;
  assert.throws(() => gates.duplicationMeasurement(raw, 2));
});
function space(name, kind, sum, spaces = [], line = 1) {
  return { name, kind, start_line: line, end_line: line + 1, metrics: { cyclomatic: { sum } }, spaces };
}
test('RCA own-function complexity subtracts nested function spaces', () => {
  const root = space('src/a.rs', 'unit', 25, [space('f', 'function', 14, [space('g', 'function', 3, [], 2)]), space('h', 'function', 11, [], 4)]);
  const result = gates.complexityMeasurement([root], ['src/a.rs'], []);
  assert.equal(result.status, 'fail');
  assert.deepEqual(result.violations.map(x => [x.symbol, x.value]), [['f', 11], ['h', 11]]);
  const exceptions = [{ path: 'src/a.rs', symbol: 'f', ceiling: 11, owner: 'maintainer', reason: 'Reviewed debt' }];
  assert.equal(gates.complexityMeasurement([root], ['src/a.rs'], exceptions).violations.length, 1);
  assert.throws(() => gates.complexityMeasurement([root], ['src/a.rs'], [{ ...exceptions[0], symbol: 'absent' }]));
});
test('RCA error counts must be a single complete zero finding', () => {
  assert.ok(gates.rcaParseProof('Total nodes: 100\nFound nodes: 0\nPercentage: 0.00%\n'));
  for (const raw of ['', 'Found nodes: 0\n', 'Total nodes: 20\nFound nodes: 1\nPercentage: 5.00%\n']) assert.throws(() => gates.rcaParseProof(raw));
});

test('anonymous RCA spaces have unique qualified span identities', () => {
  const root = space('src/a.rs', 'unit', 4, [space('<anonymous>', 'closure', 2, [], 2), space('<anonymous>', 'closure', 2, [], 5)]);
  const result = gates.complexityMeasurement([root], ['src/a.rs'], []);
  assert.deepEqual(result.functions.map(x => x.symbol), ['<anonymous>@2:3', '<anonymous>@5:6']);
});

test('only pure module-declaration files can lack executable coverage/token populations', () => {
  assert.equal(gates.isModuleDeclarations('//! module\npub mod app;\npub mod ui;\n'), true);
  for (const source of ['', '// empty', 'pub fn hidden() {}', 'pub mod ui;\nfn hidden() {}']) assert.equal(gates.isModuleDeclarations(source), false);
});
