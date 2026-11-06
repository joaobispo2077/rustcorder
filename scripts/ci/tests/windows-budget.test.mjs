import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const workflow = name => parse(readFileSync(new URL('../../../.github/workflows/' + name, import.meta.url), 'utf8'));
const ci = workflow('ci.yml'), full = workflow('mutation-full.yml');
const policy = JSON.parse(readFileSync(new URL('../policy.json', import.meta.url), 'utf8'));
// PR run 42241814972: worker start to engine start, plus bounded teardown room.
const observedStartupMinutes = (Date.parse('2026-11-06T15:33:13Z') - Date.parse('2026-11-06T15:19:58Z')) / 60000;
const overheadMinutes = Math.ceil(observedStartupMinutes) + 5;
for (const [name, job, engineMinutes, ordinary] of [
  ['Rust light mutation', ci.jobs.mutation_rust, policy.mutation.light.timeout_minutes, true],
  ['Rust full mutation', full.jobs.mutation_rust, policy.mutation.full.timeout_minutes, false],
  ['native package', ci.jobs.package, policy.budgets.package_minutes, true],
]) test(name + ' retains its full execution window after observed cold Windows startup', () => {
  assert.equal(job['runs-on'], 'windows-2025');
  assert.ok(job['timeout-minutes'] >= engineMinutes + overheadMinutes,
    `${name}: job limit ${job['timeout-minutes']} cannot fit ${engineMinutes} execution minutes and ${overheadMinutes} startup/cleanup minutes`);
  if (ordinary) assert.ok(job['timeout-minutes'] <= policy.budgets.warm_minutes, 'Ordinary job exceeds the pipeline target');
});
