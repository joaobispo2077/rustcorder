import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitFixture } from './git-fixture.mjs';
import * as release from '../release.mjs';
import { collectEvidence, digest, filesBelow, gateMeasurement, jobNames, loadPolicy, readiness,
  repoRoot, requiredGates, validateReceipt, writeJson } from '../gates.mjs';
import { renderReport } from '../report.mjs';

const started = '2026-11-06T04:00:00.000Z', completed = '2026-11-06T04:00:01.000Z';
const fixture = new URL('release-flow.fixture.ps1', import.meta.url);
function powershell(mode, root, input, expectedExit = 0) {
  const inputFile = path.join(root, mode + '-input.json');
  writeJson(inputFile, input);
  const result = spawnSync('pwsh', ['-NoProfile', '-File', fileURLToPath(fixture),
    '-Mode', mode, '-InputFile', inputFile], {
    cwd: repoRoot, encoding: 'utf8', timeout: 60000, windowsHide: true,
    env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' },
  });
  let diagnostic = result.stderr || result.error?.message;
  const receiptFile = path.join(root, 'attachments/publication.json');
  if (mode === 'publish' && result.status !== expectedExit && existsSync(receiptFile)) {
    const previous = JSON.parse(readFileSync(receiptFile));
    const attempted = JSON.parse(readFileSync(path.join(root, 'publish-result.json'))).attempted_result;
    assert.deepEqual(attempted, previous, 'Publication retry changed a receipt value');
    diagnostic += '\nIdentical values, asset key order: ' + JSON.stringify({ previous: Object.keys(previous.assets[0]), attempted: Object.keys(attempted.assets[0]) });
  }
  assert.equal(result.status, expectedExit, diagnostic);
  return JSON.parse(readFileSync(path.join(root, mode + '-result.json'), 'utf8'));
}
function metadata(directory) {
  const version = release.manifestVersion(readFileSync(path.join(directory, 'Cargo.toml'), 'utf8'));
  const id = 'fixture-root#' + version;
  return { packages: [{ id, name: 'rustcorder', version, source: null }],
    workspace_members: [id], workspace_default_members: [id], resolve: { root: id, nodes: [{ id, dependencies: [] }] } };
}
function rawMutation(root, gate) {
  const raw = path.join(root, gate, 'raw');
  const execution = { profile: 'light', exit_code: 0, completed: true, fresh: true, cached: false,
    scope: [gate === 'mutation-rust' ? 'src/lib.rs' : 'scripts/ci/gates.mjs'],
    baseline: { completed: true, passed: 1, failed: 0, ignored: 0 }, started_at: started, completed_at: completed };
  writeJson(path.join(raw, 'execution.json'), execution);
  if (gate === 'mutation-rust') {
    const span = { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } };
    const mutant = { name: 'src/lib.rs: replace fixture_marker with false', package: 'rustcorder', file: 'src/lib.rs',
      function: { function_name: 'fixture_marker', return_type: '-> bool', span }, span, replacement: 'false', genre: 'FnValue', diff: 'fixture' };
    const phase = (phase, process_status) => ({ phase, process_status, duration: 0.01, argv: ['cargo', 'test', '--lib'] });
    const scenario = (scenario, summary, testStatus) => ({ scenario, summary, log_path: 'log/scenario.log', diff_path: null,
      phase_results: [phase('Build', 'Success'), phase('Test', testStatus)] });
    const bare = { ...mutant }; delete bare.diff;
    writeJson(path.join(raw, 'mutants.json'), [mutant]);
    writeJson(path.join(raw, 'mutants.out/outcomes.json'), { cargo_mutants_version: '27.1.0',
      start_time: started, end_time: completed, total_mutants: 1, caught: 1, missed: 0, unviable: 0, timeout: 0, success: 0,
      outcomes: [scenario('Baseline', 'Success', 'Success'), scenario({ Mutant: bare }, 'CaughtMutant', { Failure: 101 })] });
  } else {
    const mutant = { id: '0', mutatorName: 'BooleanLiteral', replacement: 'false', status: 'Killed',
      location: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } } };
    writeJson(path.join(raw, 'stryker-report.json'), { schemaVersion: '1.0', projectRoot: '/fixture',
      framework: { name: 'StrykerJS', version: '10.1.1' }, config: { incremental: false, inPlace: false },
      files: { 'scripts/ci/gates.mjs': { language: 'javascript', source: 'true', mutants: [mutant] } } });
    const { status, ...planned } = mutant;
    writeJson(path.join(raw, 'stryker-events/0-onMutationTestingPlanReady.json'), { mutantPlans: [{ plan: 'Run',
      mutant: { ...planned, fileName: '/fixture/scripts/ci/gates.mjs',
        location: { start: { line: 0, column: 0 }, end: { line: 0, column: 4 } } } }] });
    writeJson(path.join(raw, 'stryker-events/0-onDryRunCompleted.json'), {
      result: { status: 'complete', tests: [{ id: 'fixture', status: 0, name: 'fixture test', timeSpentMs: 1 }] } });
  }
}
function rawQuality(root, scope, sourceRoot) {
  const log = (gate, name, value) => { const file = path.join(root, gate, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, value); };
  for (const gate of Object.keys(scope.policy.gate_owners)) log(gate, 'stdout.log', 'Synthetic contract fixture only\n');
  for (const gate of ['unit', 'integration', 'ui']) {
    log(gate, 'list.stdout.log', 'fixture: test\n\n1 test, 0 benchmarks\n');
    log(gate, 'run.stdout.log', 'test fixture ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s\n');
  }
  log('ci-support', 'run.stdout.log', '# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n');
  writeJson(path.join(root, 'coverage/coverage.json'), { type: 'llvm.coverage.json.export', data: [{ files: [
    { filename: path.join(sourceRoot, 'src/lib.rs'), summary: { lines: { count: 10, covered: 8 } } },
  ] }] });
  writeJson(path.join(root, 'duplication/jscpd-report.json'), { statistics: {
    total: { lines: 100, duplicatedLines: 0, sources: 1 }, formats: { rust: { sources: 1 } } } });
  log('architecture', 'run.stdout.log', '[]');
  log('complexity', 'parse.stdout.log', 'Total nodes: 10\nFound nodes: 0\n');
  writeJson(path.join(root, 'complexity/rca/lib.json'), { name: 'src/lib.rs', kind: 'unit', metrics: { cyclomatic: { sum: 1 } },
    spaces: [{ name: 'fixture_marker', kind: 'function', start_line: 1, end_line: 1, metrics: { cyclomatic: { sum: 1 } }, spaces: [] }] });
  log('dependencies', 'rust.stderr.log', JSON.stringify({ type: 'summary', fields: Object.fromEntries(
    ['advisories', 'licenses', 'bans', 'sources'].map(x => [x, { errors: 0, warnings: 0 }])) }) + '\n');
  writeJson(path.join(root, 'dependencies/npm.stdout.log'), { auditReportVersion: 2, vulnerabilities: {}, metadata: {
    dependencies: { total: 1 }, vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } });
  for (const gate of ['mutation-rust', 'mutation-ci']) rawMutation(root, gate);
}
function sourceApi(context, artifacts) {
  const repository = { id: context.repository_id, full_name: context.repository };
  const state = { run: { id: context.run_id, run_attempt: context.run_attempt, workflow_id: context.workflow_id,
    path: context.workflow_path, event: 'push', head_branch: 'release', head_sha: context.source_sha,
    repository, head_repository: repository, status: 'completed', conclusion: 'success' },
    tip: context.source_sha, jobs: Object.entries(jobNames).map(([id, name], i) => ({ id: i + 1, name,
      status: 'completed', conclusion: 'success', run_id: context.run_id, run_attempt: context.run_attempt, head_sha: context.source_sha })) };
  const reads = [];
  const api = async endpoint => {
    reads.push(endpoint);
    const prefix = '/repos/' + context.repository;
    if (endpoint === prefix) return repository;
    if (endpoint.endsWith('/actions/workflows/ci.yml')) return { id: context.workflow_id, path: context.workflow_path, state: 'active' };
    if (endpoint.endsWith('/actions/runs/' + context.run_id)) return state.run;
    if (endpoint.includes('/jobs?')) return { total_count: state.jobs.length, jobs: state.jobs };
    if (endpoint.includes('/artifacts?')) return { total_count: artifacts.length, artifacts };
    if (endpoint.endsWith('/git/ref/heads/release')) return { ref: 'refs/heads/release', object: { type: 'commit', sha: state.tip } };
    throw new Error('Unexpected fixture API read: ' + endpoint);
  };
  return { api, reads, state };
}

test('release flow joins confirmed source, final evidence, approval and immutable publication retries', async t => {
  const boundary = realpathSync(path.join(repoRoot, '.build'));
  const root = mkdtempSync(path.join(boundary, 'release-flow-'));
  t.after(() => { assert.equal(path.dirname(realpathSync(root)), boundary); rmSync(root, { recursive: true }); });
  const repo = gitFixture(t);
  const workspaceVersion = readFileSync(path.join(repoRoot, 'Cargo.toml'));
  const workspaceRefs = execFileSync('git', ['for-each-ref'], { cwd: repoRoot, encoding: 'utf8' });
  const policy = loadPolicy(); policy.complexity.exceptions = [];
  const vad = { filename: 'ggml-silero-v6.2.0.bin', sha256: digest('abc'), bytes: 3,
    revision: 'd'.repeat(40), license: 'MIT', license_sha256: digest('synthetic license') };
  const vadBytes = Buffer.from(JSON.stringify(vad) + '\n');
  const initial = repo.commit('chore: fixture baseline', [], {
    'scripts/ci/policy.json': JSON.stringify(policy) + '\n',
    'scripts/ci/toolchain.json': readFileSync(new URL('../toolchain.json', import.meta.url), 'utf8'),
    'assets/silero-vad.json': vadBytes.toString(),
  });
  const source = repo.commit('feat: fixture export', [initial.sha]);
  const sourceScope = release.frozenSourceScope(source.sha, 'hosted', repo.root);
  const context = { ...JSON.parse(readFileSync(new URL('fixtures/context.json', import.meta.url))),
    job_id: 'readiness', source_sha: source.sha, tested_sha: source.sha,
    policy_sha256: sourceScope.policy_sha256, toolchain_sha256: sourceScope.toolchain_sha256 };
  const control = { run_id: 404, run_attempt: 1, workflow_id: 405, source_sha: 'c'.repeat(40), actor: 'fixture-owner' };
  const proposal = await release.createProposal({ cwd: repo.root, source_sha: source.sha, context: structuredClone(context),
    published: [{ tag_name: 'v0.1.0', tag_object: repo.tag('v0.1.0', initial), target_sha: initial.sha, published: true }] });
  const prepared = await release.prepareProposal({ cwd: repo.root, proposal, reviewed_sha256: proposal.proposal_sha256,
    confirmation: { completion: true }, control, date: '2026-11-06', metadata });
  t.after(() => { assert.equal(path.dirname(realpathSync(prepared.scratch)), boundary); rmSync(prepared.scratch, { recursive: true }); });
  const objectEnv = { ...process.env, GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(prepared.scratch, 'objects') };
  const git = repo.git;
  const pack = execFileSync('git', ['pack-objects', '--revs', '--stdout'], {
    cwd: repo.root, env: objectEnv, input: prepared.manifest.expected_tree + '\n',
  });
  execFileSync('git', ['index-pack', '--stdin'], { cwd: repo.root, input: pack, stdio: ['pipe', 'pipe', 'pipe'] });
  const finalSha = git(['commit-tree', prepared.manifest.expected_tree, '-p', source.sha, '-m', 'chore(release): prepare 0.2.0']);
  const scope = release.frozenSourceScope(finalSha, 'hosted', repo.root);
  Object.assign(context, { run_id: 304, source_sha: finalSha, tested_sha: finalSha });
  const evidence = path.join(root, 'evidence'); rawQuality(evidence, scope, repo.root);
  powershell('package', root, { root, scope: scope.package, vad_json: vadBytes.toString('base64') });
  const receipts = requiredGates(context, policy).map(gate => {
    const measurement = gateMeasurement(gate, evidence, policy, repo.root, scope);
    const raw = filesBelow(path.join(evidence, gate)).map(file => ({ path: path.relative(evidence, file).replaceAll('\\', '/'), sha256: digest(readFileSync(file)) }));
    const receipt = validateReceipt({ schema_version: 1, gate, context: { ...context, job_id: policy.gate_owners[gate] },
      status: 'pass', required: true, applicable: true, completed: true, exit_code: 0, duration_ms: 1000,
      started_at: started, completed_at: completed, raw_outputs: raw, measurements: measurement, reason: null });
    writeJson(path.join(evidence, gate, 'gate.json'), receipt);
    return receipt;
  });
  const jobs = Object.fromEntries(Object.keys(jobNames).map(x => [x, 'success']));
  const collected = collectEvidence(evidence, context, scope);
  const report = renderReport({ context, ...collected, jobs, policy, generatedAt: completed });
  writeJson(path.join(root, 'certification.json'), report.json.assessment);
  writeFileSync(path.join(root, 'report.md'), report.markdown);
  const artifacts = ['quality', 'certification', 'evidence-package'].map((name, i) => ({ id: 500 + i,
    name: name === 'evidence-package' ? 'evidence-304-1-package' : name + '-304-1',
    expired: false, size_in_bytes: 100, digest: 'sha256:' + 'd'.repeat(64) }));
  const hosted = sourceApi(context, artifacts);
  const request = { repository: context.repository, run_id: 304, run_attempt: 1, source_sha: finalSha };

  await t.test('prepared tree has one exact source parent and only metadata changes', () => {
    assert.equal(git(['show', '-s', '--format=%an <%ae>', finalSha]), 'CI fixture <ci@example.invalid>');
    assert.ok(release.verifyCandidate(prepared.manifest, { sha: finalSha, tree_sha: scope.package.tree_sha,
      parents: git(['rev-list', '--parents', '-n', '1', finalSha]).split(' ').slice(1), version: scope.package.version }));
    assert.deepEqual(git(['diff-tree', '--no-commit-id', '-r', '--name-only', source.sha, finalSha]).split('\n').sort(), ['CHANGELOG.md', 'Cargo.lock', 'Cargo.toml']);
    assert.equal(scope.package.version, '0.2.0');
  });
  await t.test('real schema, package and mutation adapters join a complete report', () => {
    assert.deepEqual(collected.errors, []);
    assert.equal(report.json.assessment.ready, true, JSON.stringify(report.json.assessment.reasons));
    assert.equal(receipts.length, 18);
    assert.equal(receipts.find(x => x.gate === 'package').measurements.kind, 'hosted-release-package');
    for (const gate of ['mutation-rust', 'mutation-ci']) {
      const measured = receipts.find(x => x.gate === gate).measurements;
      assert.equal(measured.status, 'pass'); assert.equal(measured.detected, 1); assert.equal(measured.total, 1);
    }
  });
  await t.test('every required job and final source attempt remain mandatory', async () => {
    for (const id of Object.keys(jobNames)) {
      if (id !== 'readiness') assert.equal(readiness(context, receipts, { ...jobs, [id]: 'skipped' }, true, policy).ready, false, id);
      const job = hosted.state.jobs.find(x => x.name === jobNames[id]); job.conclusion = 'skipped';
      await assert.rejects(() => release.verifySourceAttempt(request, hosted.api)); job.conclusion = 'success';
    }
    await release.verifySourceAttempt(request, hosted.api);
    const stale = { ...context, source_sha: source.sha, tested_sha: source.sha, run_id: 303 };
    assert.ok(collectEvidence(evidence, stale, sourceScope).errors.length);
    hosted.state.run.run_attempt++;
    await assert.rejects(() => release.verifySourceAttempt(request, hosted.api), /attempt/i);
    hosted.state.run.run_attempt--;
  });
  await t.test('changed raw bytes and missing mutation outcomes block collection and reports', () => {
    const log = path.join(evidence, 'format/stdout.log'), original = readFileSync(log);
    writeFileSync(log, 'substituted');
    const bad = collectEvidence(evidence, context, scope);
    assert.equal(renderReport({ context, ...bad, jobs, policy, generatedAt: completed }).json.assessment.ready, false);
    writeFileSync(log, original);
    const outcome = path.join(evidence, 'mutation-rust/raw/mutants.out/outcomes.json'), bytes = readFileSync(outcome);
    const incomplete = JSON.parse(bytes); incomplete.outcomes.pop(); writeJson(outcome, incomplete);
    assert.equal(gateMeasurement('mutation-rust', evidence).status, 'incomplete');
    writeFileSync(outcome, bytes);
  });

  const attachments = path.join(root, 'attachments'); mkdirSync(attachments);
  const packageManifest = JSON.parse(readFileSync(path.join(evidence, 'package/package-manifest.json')));
  for (const name of [packageManifest.zip.path, 'SHA256SUMS', 'package-manifest.json']) copyFileSync(path.join(evidence, 'package', name), path.join(attachments, name));
  copyFileSync(path.join(root, 'certification.json'), path.join(attachments, 'certification.json'));
  const notes = release.releaseEntry(git(['show', finalSha + ':CHANGELOG.md']), '0.2.0');
  writeFileSync(path.join(attachments, 'release-notes.md'), notes + '\n');
  const files = filesBelow(attachments).map(file => ({ name: path.basename(file), path: path.basename(file), bytes: readFileSync(file).length, sha256: digest(readFileSync(file)) }));
  const body = { schema_version: 1, kind: 'release-candidate', repository: context.repository, version: '0.2.0',
    source_sha: finalSha, tree_sha: scope.package.tree_sha, ci: { ...request, workflow_id: context.workflow_id, repository_id: context.repository_id },
    control, files, notes, previous: proposal.previous, preparation_sha256: prepared.manifest.preparation_sha256 };
  const { control: excluded, ...identity } = body;
  const frozen = { ...body, release_sha256: release.canonicalDigest(identity) };
  const candidate = release.validateCandidateRequest({ ...frozen, candidate_sha256: release.canonicalDigest(frozen) });
  const environment = { id: 22, name: 'release-publish', protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 7 } }] }] };
  const review = { state: 'approved', comment: release.approvalText(candidate), environments: [{ id: 22, name: 'release-publish' }], user: { id: 7, login: 'fixture-owner' } };
  const authorization = { ...release.verifyApproval(candidate, environment, [review]), control };
  await t.test('approval cannot authorize a different candidate or control attempt', () => {
    assert.throws(() => release.verifyApproval({ ...candidate, control: { ...control, run_attempt: 2 } }, environment, [review]));
    assert.throws(() => release.verifyApproval({ ...candidate, candidate_sha256: 'f'.repeat(64) }, environment, [review]));
    assert.throws(() => release.validateCandidateRequest({ ...candidate, source_sha: source.sha }));
    const staleAuthorization = { ...authorization, control: { ...control, run_attempt: 2 } };
    const rejected = powershell('publish', root, { root, attachments, candidate, authorization: staleAuthorization }, 3);
    assert.match(rejected.error, /run\/attempt/i);
    assert.equal(rejected.state.calls.length, 0, 'Stale approval reached the fixture transport');
  });
  await t.test('partial draft retry preserves the tag and existing bytes without a real remote', () => {
    const input = { root, attachments, candidate, authorization, fail_after_first_upload: true };
    const partial = powershell('publish', root, input, 3);
    assert.equal(partial.state.release.draft, true);
    assert.equal(partial.state.assets.length, 1);
    const tag = partial.state.tag.sha, firstAsset = partial.state.assets[0];
    const result = powershell('publish', root, input);
    assert.equal(result.result.status, 'published');
    assert.equal(result.state.tag.sha, tag);
    assert.deepEqual(result.state.assets[0], firstAsset);
    assert.equal(result.state.assets.length, files.length);
    assert.equal(result.state.calls.filter(x => x.method === 'POST' && x.path.endsWith('/git/tags')).length, 1);
    assert.equal(result.state.calls.filter(x => x.method === 'POST' && x.path.endsWith('/git/refs')).length, 1);
    assert.ok(result.state.calls.every(x => !x.ref || x.ref.startsWith('refs/tags/')));
    const receipt = readFileSync(path.join(attachments, 'publication.json'));
    const retry = powershell('publish', root, input);
    assert.deepEqual(retry.result, result.result);
    assert.ok(readFileSync(path.join(attachments, 'publication.json')).equals(receipt));
  });
  assert.equal(repo.git(['for-each-ref']), '');
  assert.ok(readFileSync(path.join(repoRoot, 'Cargo.toml')).equals(workspaceVersion));
  assert.equal(execFileSync('git', ['for-each-ref'], { cwd: repoRoot, encoding: 'utf8' }), workspaceRefs);
});
