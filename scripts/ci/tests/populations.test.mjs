import test from 'node:test';
import assert from 'node:assert/strict';
import * as gates from '../gates.mjs';

const listed = 'one: test\ntwo: test\n\n2 tests, 0 benchmarks\n';
const executed = 'running 2 tests\ntest one ... ok\ntest two ... ignored, external device\n\ntest result: ok. 1 passed; 0 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.01s\n';
test('listed and executed libtest identities reconcile', () => {
  assert.deepEqual(gates.libtestPopulation(listed, executed, ['two']), { listed: 2, passed: 1, failed: 0, ignored: 1, identities: ['one', 'two'], ignored_identities: ['two'] });
});
for (const [list, run, ignored] of [
  ['0 tests, 0 benchmarks\n', '', []],
  [listed, executed.replace('test two ... ignored, external device\n', ''), ['two']],
  [listed, executed + executed, ['two']],
  [listed, executed, []],
  [listed + 'one: test\n', executed, ['two']],
  [listed, '{"reason":"compiler-artifact"}', ['two']],
  [listed, executed.replace('0 failed', '1 failed'), ['two']],
]) test('rejects empty/truncated/contradictory test evidence ' + JSON.stringify([list, run]), () => {
  assert.throws(() => gates.libtestPopulation(list, run, ignored));
});
test('Node baseline rejects missing, zero, cancelled and failed results', () => {
  assert.equal(gates.nodePopulation('# tests 3\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n').passed, 3);
  for (const log of ['', '# tests 0\n', '# tests 1\n# pass 0\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n']) {
    assert.throws(() => gates.nodePopulation(log));
  }
});

test('a UI selection records unrelated filtered tests without counting them as executed', () => {
  const uiRun = executed.replace('0 filtered out', '80 filtered out');
  assert.equal(gates.libtestPopulation(listed, uiRun, ['two'], true).passed, 1);
  assert.throws(() => gates.libtestPopulation(listed, uiRun, ['two']));
});
