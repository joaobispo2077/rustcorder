import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { jobNames, loadPolicy, readiness, requiredGates, workflowPolicy } from '../gates.mjs';

const workflow = name => parse(readFileSync(new URL('../../../.github/workflows/' + name, import.meta.url), 'utf8'));
const ci = workflow('ci.yml'), release = workflow('release.yml'), full = workflow('mutation-full.yml');
const reporter = workflow('quality-comment.yml');
const pins = JSON.parse(readFileSync(new URL('../toolchain.json', import.meta.url), 'utf8'));
const policy = loadPolicy();
const baseContext = JSON.parse(readFileSync(new URL('fixtures/context.json', import.meta.url), 'utf8'));
const jobs = Object.fromEntries([...policy.jobs.ordinary, ...policy.jobs.release].map(id => [id, 'success']));
const expression = value => String(value).replace(/^\$\{\{\s*|\s*\}\}$/g, '').replace(/\s+/g, '');
const needs = job => job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs];
const steps = job => job.steps ?? [];
const command = (job, part) => {
  const found = steps(job).filter(step => step.run?.includes(part));
  assert.equal(found.length, 1, 'Missing/ambiguous fixed command: ' + part);
  return found[0];
};

function ancestors(definition, id, pending = new Set()) {
  assert.ok(definition.jobs[id], 'Unknown dependency job: ' + id);
  assert.ok(!pending.has(id), 'Workflow dependency cycle at ' + id);
  const next = new Set(pending).add(id);
  return new Set(needs(definition.jobs[id]).flatMap(parent => [parent, ...ancestors(definition, parent, next)]));
}

function receipt(gate) {
  return {
    schema_version: 1, gate, context: { ...baseContext, job_id: policy.gate_owners[gate] },
    status: 'pass', applicable: true, required: true, completed: true,
    exit_code: 0, duration_ms: 10, started_at: '2026-11-05T12:00:00Z', completed_at: '2026-11-05T12:00:01Z',
    raw_outputs: [{ path: gate + '/run.log', sha256: 'e'.repeat(64) }],
    measurements: gate === 'coverage' ? { covered: 1, total: 1 } :
      gate.startsWith('mutation-') ? { profile: 'light' } : null,
    reason: null,
  };
}

test('installed CI graph waits for every producer, then always reports before always evaluating readiness', () => {
  const ids = [...new Set([...policy.jobs.ordinary, ...policy.jobs.release, 'readiness'])];
  assert.deepEqual(Object.keys(ci.jobs).sort(), ids.sort());
  for (const [id, job] of Object.entries(ci.jobs)) {
    assert.equal(job.name, jobNames[id], 'Required check name changed for ' + id);
    ancestors(ci, id);
  }
  assert.equal(expression(ci.jobs.report.if), 'always()');
  assert.equal(expression(ci.jobs.readiness.if), 'always()');
  for (const id of ids.filter(id => !['report', 'readiness'].includes(id))) {
    assert.ok(ancestors(ci, 'report').has(id), 'Report can race producer ' + id);
  }
  assert.ok(ancestors(ci, 'readiness').has('report'));
  assert.ok(!ancestors(ci, 'report').has('readiness'));
  assert.equal(expression(command(ci.jobs.report, 'gates.mjs report').if), 'always()');
  const download = steps(ci.jobs.report).find(step => step.uses?.startsWith('actions/download-artifact@'));
  assert.equal(download['continue-on-error'], true, 'Missing evidence must still reach the report renderer');
  assert.notEqual(ci.jobs.readiness['continue-on-error'], true);
});

test('package applicability agrees with the actual release-push job condition', () => {
  assert.equal(expression(ci.jobs.package.if), "github.event_name=='push'&&github.ref=='refs/heads/release'");
  assert.ok(needs(ci.jobs.report).includes('package'));
  assert.ok(needs(ci.jobs.readiness).includes('package'));
  for (const [event, branch, applicable] of [
    ['push', 'release', true], ['pull_request', 'release', false],
    ['push', 'develop', false], ['push', 'feature/ci', false], ['push', 'main', false],
  ]) {
    assert.equal(requiredGates({ ...baseContext, event, branch }, policy).includes('package'), applicable);
  }
  assert.ok(readiness(baseContext, [], jobs, true).reasons.includes('Missing gate: package'));
  assert.equal(expression(ci.concurrency['cancel-in-progress']),
    "github.event_name=='pull_request'||startsWith(github.ref,'refs/heads/feature/')");
});

test('all installed Actions match reviewed immutable identities and checkouts discard credentials', () => {
  const known = new Map(Object.values(pins.actions).map(pin => [pin.repository, pin.sha]));
  for (const definition of [ci, release, full]) {
    for (const job of Object.values(definition.jobs)) {
      const invocations = [...(job.uses ? [job] : []), ...steps(job).filter(step => step.uses)];
      for (const step of invocations) {
        const match = step.uses.match(/^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+)@([a-f0-9]{40})$/);
        assert.ok(match, 'Mutable/unreviewed Action: ' + step.uses);
        assert.equal(match[2], known.get(match[1]), 'Action differs from its reviewed pin');
        if (match[1] === 'actions/checkout') assert.equal(step.with?.['persist-credentials'], false);
      }
    }
  }
});

test('actual CI copies with a writable token, mutable Action, retained credentials or privileged PR trigger are rejected', () => {
  assert.equal(workflowPolicy(ci), true);
  for (const mutate of [
    copy => { copy.jobs.rust.permissions = { contents: 'write' }; },
    copy => { copy.jobs.policy.steps[0].uses = 'actions/checkout@v7'; },
    copy => { copy.jobs.policy.steps[0].with['persist-credentials'] = true; },
    copy => { copy.on.pull_request_target = {}; },
  ]) {
    const unsafe = structuredClone(ci); mutate(unsafe);
    assert.throws(() => workflowPolicy(unsafe));
  }
});

test('only the isolated main-controlled publisher receives a contents-write job token', () => {
  for (const [name, definition] of [['ci', ci], ['release', release], ['full', full]]) {
    assert.equal(definition.permissions.contents, 'read');
    assert.equal(definition.permissions.actions, 'read');
    assert.equal(definition.on.pull_request_target, undefined);
    for (const [id, job] of Object.entries(definition.jobs)) {
      const permissions = job.permissions ?? definition.permissions;
      const writable = Object.entries(permissions).filter(([, value]) => value === 'write').map(([key]) => key);
      assert.deepEqual(writable, name === 'release' && id === 'publish' ? ['contents'] : []);
      assert.ok(Object.keys(permissions).every(key => ['contents', 'actions'].includes(key) ||
        (name==='release' && key==='pull-requests' && permissions[key]==='read')), 'Unexpected token scope');
      assert.notEqual(job['continue-on-error'], true);
    }
  }
  assert.equal(release.jobs.publish.environment, undefined);
  assert.deepEqual(needs(release.jobs.publish), ['preview','preflight']);
  assert.equal(release.jobs.publish.concurrency['cancel-in-progress'], false);
  assert.equal(release.jobs.publish.concurrency.group, 'release-publication-${{ github.repository }}');
});

test('every release-control job executes code from the frozen trusted workflow SHA', () => {
  for (const [id, job] of Object.entries(release.jobs)) {
    ancestors(release, id);
    assert.ok(id==='preview'?expression(job.if).includes("github.ref=='refs/heads/main'"):ancestors(release,id).has('preview'));
    const checkout = steps(job).filter(step => step.uses?.startsWith('actions/checkout@'));
    assert.equal(checkout.length, 1);
    assert.equal(checkout[0].with.ref, '${{ github.workflow_sha }}');
    assert.equal(checkout[0].with['fetch-depth'], 0);
    assert.equal(checkout[0].with['persist-credentials'], false);
    for (const step of steps(job).filter(step => step.run)) {
      assert.doesNotMatch(step.run, /\$\{\{\s*(?:inputs\.|github\.(?:head_ref|event\.))/,
        'Untrusted workflow input must enter through data/environment fields');
    }
  }
});

test('manual dispatch is preview-only and has no metadata/publication authority inputs', () => {
  const inputs = release.on.workflow_dispatch.inputs;
  assert.deepEqual(Object.keys(inputs).sort(),['source_run_attempt','source_run_id','source_sha']);
  assert.equal(release.jobs.prepare.if,"needs.preview.outputs.state == 'source'");
  assert.equal(release.jobs.preflight.if,"needs.preview.outputs.state == 'final'");
  assert.equal(release.jobs.publish.if,"needs.preview.outputs.state == 'final'");
  assert.ok(!JSON.stringify(release.jobs.publish).includes('secrets.'));
  assert.equal(command(release.jobs.metadata,'release-automation.mjs metadata').env.RELEASE_WRITE_TOKEN,'${{ steps.app.outputs.token || secrets.GH_TOKEN }}');
});

test('publisher input is the immutable artifact from its own exact preflight producer', () => {
  const preflight = release.jobs.preflight;
  assert.ok(command(preflight, 'release-automation.mjs preflight'));
  const upload = steps(preflight).find(step => step.uses?.startsWith('actions/upload-artifact@'));
  assert.equal(upload.id, 'candidate');
  assert.equal(upload.with['if-no-files-found'], 'error');
  assert.equal(upload.with.name, 'candidate-${{ github.run_id }}-${{ github.run_attempt }}');
  assert.deepEqual(preflight.outputs, {
    artifact_id: '${{ steps.candidate.outputs.artifact-id }}',
  });
  const publish = command(release.jobs.publish, 'release-automation.mjs publish');
  assert.equal(publish.env.CANDIDATE_ARTIFACT_ID, '${{ needs.preflight.outputs.artifact_id }}');
  assert.equal(publish.env.GH_TOKEN,'${{ github.token }}');
});

test('controlled write jobs reject appended commands, action caches and credential scope crossing',()=>{
  for(const [role,original,job]of [['release-automation',release,'metadata'],['pr-report',reporter,'comment']]){
    for(const mutate of [
      value=>{value.jobs[job].steps.push({run:'node scripts/ci/release-automation.mjs route; node candidate/evil.mjs'});},
      value=>{value.jobs[job].steps.find(step=>step.uses?.startsWith('actions/setup-node@')).with.cache='npm';},
      value=>{value.jobs[job].steps.push({uses:'unknown/action@'+'a'.repeat(40)});},
    ]){const value=structuredClone(original);mutate(value);assert.throws(()=>workflowPolicy(value,role));}
  }
  const escaped=structuredClone(reporter);escaped.jobs.comment.steps[2].env={RELEASE_WRITE_TOKEN:'${{ secrets.GH_TOKEN }}'};
  assert.throws(()=>workflowPolicy(escaped,'pr-report'));
});

test('evidence uploads are attempt-specific immutable artifacts retained for fourteen days', () => {
  for (const definition of [ci, release, full]) {
    for (const job of Object.values(definition.jobs)) {
      for (const step of steps(job).filter(step => step.uses?.startsWith('actions/upload-artifact@'))) {
        assert.ok(step.with.name.includes('${{ github.run_id }}'));
        assert.ok(step.with.name.includes('${{ github.run_attempt }}'));
        assert.equal(step.with['retention-days'], 14);
        assert.notEqual(step.with.overwrite, true);
      }
    }
  }
});

test('weekly/manual full mutation is independent, fresh and cannot substitute the candidate light jobs', () => {
  assert.deepEqual(full.on.schedule, [{ cron: '0 6 * * 1' }]);
  assert.deepEqual(full.on.workflow_dispatch, {});
  assert.deepEqual(Object.keys(full.on).sort(), ['schedule', 'workflow_dispatch']);
  assert.equal(full.concurrency['cancel-in-progress'], false);
  for (const [id, fragment] of [['mutation_rust', '-Profile'], ['mutation_ci', '--profile']]) {
    assert.match(command(ci.jobs[id], fragment).run, new RegExp(fragment + '\\s+light\\b'));
    assert.match(command(full.jobs[id], fragment).run, new RegExp(fragment + '\\s+full\\b'));
    assert.ok(needs(ci.jobs.report).includes(id));
    assert.ok(needs(ci.jobs.readiness).includes(id));
    assert.match(ci.jobs[id].name, / light$/); assert.match(full.jobs[id].name, / full$/);
    for (const step of steps(full.jobs[id]).filter(step => step.uses?.startsWith('actions/cache@'))) {
      assert.doesNotMatch(step.with.path, /mutants\.out|mutation-results|stryker-tmp|reports/i);
    }
  }
});

test('full mutation still renders a blocked report when a required engine artifact is absent', () => {
  assert.equal(expression(full.jobs.report.if), 'always()');
  assert.deepEqual([...needs(full.jobs.report)].sort(), ['mutation_ci', 'mutation_rust']);
  const download = steps(full.jobs.report).find(step => step.uses?.startsWith('actions/download-artifact@'));
  assert.equal(download['continue-on-error'], true, 'Missing full-engine evidence prevented diagnostic reporting');
  assert.equal(expression(command(full.jobs.report, 'gates.mjs mutation-summary').if), 'always()');
});

test('complete candidate readiness rejects either a full-profile substitution or another workflow context', () => {
  const receipts = requiredGates(baseContext, policy).map(receipt);
  assert.equal(readiness(baseContext, receipts, jobs, true, policy).ready, true, 'The complete light control must pass');
  const fullProfile = structuredClone(receipts);
  fullProfile.find(item => item.gate === 'mutation-ci').measurements.profile = 'full';
  const profileResult = readiness(baseContext, fullProfile, jobs, true, policy);
  assert.equal(profileResult.ready, false);
  assert.ok(profileResult.reasons.some(reason => reason.includes('ordinary readiness requires the light profile')));
  const otherWorkflow = structuredClone(receipts);
  const other = otherWorkflow.find(item => item.gate === 'mutation-ci');
  other.context.workflow_id++; other.context.workflow_path = '.github/workflows/mutation-full.yml';
  const contextResult = readiness(baseContext, otherWorkflow, jobs, true, policy);
  assert.equal(contextResult.ready, false);
  assert.ok(contextResult.reasons.some(reason => reason.includes('Context mismatch: workflow_id')));
});
