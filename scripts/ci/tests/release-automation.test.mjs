import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { apiFixture } from './git-fixture.mjs';
import { jobNames, digest, repoRoot } from '../gates.mjs';
import { sealAutomaticRecord, canonicalDigest, preparedChangelog, metadataIntentArtifact } from '../release.mjs';
const target = new URL('../release-automation.mjs', import.meta.url);
const automation = existsSync(target) ? await import(target.href) : {};
const repository = 'joaobispo2077/rustcorder', prefix = '/repos/' + repository;
const sha = value => value.repeat(40), hash = value => value.repeat(64);
const request = { repository, run_id: 201, run_attempt: 1, source_sha: sha('a') };
const control = { source_sha: sha('c'), run_id: 101, run_attempt: 1, workflow_id: 102, actor: 'fixture-owner' };
const policy = { schema_version: 1, automation_enabled: true, initial_version: '0.1.0' };

test('GH_TOKEN writer resolves the authenticated numeric identity without trusting a configured login', async () => {
  assert.equal(typeof automation.configuredToken, 'function');
  const fixture=apiFixture({['GET /user']:{id:909,login:'release-owner',type:'User'}});
  assert.deepEqual(await automation.configuredToken('fixture-only',fixture.api),{kind:'token',id:909,login:'release-owner'});
  await assert.rejects(()=>automation.configuredToken('',fixture.api),/token/i);
  const invalid=apiFixture({['GET /user']:{id:'909',login:'release-owner',type:'User'}});
  await assert.rejects(()=>automation.configuredToken('fixture-only',invalid.api),/identity|integer/i);
});

test('restarted controllers select the first matching verified preparation and refuse conflicting material',()=>{
  assert.equal(typeof automation.selectSourcePreparation,'function');
  const first=prepared().preparation;
  const {preparation_sha256,...body}=first;
  const second=sealAutomaticRecord('automatic-preparation',{...body,control:{...body.control,run_id:102},proposal_sha256:hash('3')});
  const original={manifest:first,artifact:{id:800}},duplicate={manifest:second,artifact:{id:801}};
  assert.equal(automation.selectSourcePreparation([duplicate,original],request,policy),original);
  const different=sealAutomaticRecord('automatic-preparation',{...body,expected_tree:sha('f')});
  assert.throws(()=>automation.selectSourcePreparation([original,{manifest:different,artifact:{id:802}}],request,policy),/conflict/i);
  const oldAttempt=sealAutomaticRecord('automatic-preparation',{...body,source_ci:{...body.source_ci,run_attempt:2}});
  assert.equal(automation.selectSourcePreparation([{manifest:oldAttempt,artifact:{id:803}}],request,policy),null);
});

test('preparation lookup accepts exact trusted source artifacts and ignores candidate-workflow imitations',async t=>{
  const preparation=prepared().preparation,root=path.join(repoRoot,'.build','lookup-preparation-'+crypto.randomUUID());
  mkdirSync(root,{recursive:true});writeFileSync(path.join(root,'preparation.json'),JSON.stringify(preparation));
  t.after(()=>{assert.equal(path.dirname(realpathSync(root)),realpathSync(path.join(repoRoot,'.build')));rmSync(root,{recursive:true});});
  const raw={id:800,name:'preparation-'+request.source_sha+'-101-1',expired:false,workflow_run:{id:101}};
  const forged={id:900,name:'preparation-'+request.source_sha+'-201-1',expired:false,workflow_run:{id:201}};
  const run={id:101,run_attempt:1,head_sha:control.source_sha,path:'.github/workflows/release.yml',event:'workflow_run',head_branch:'main',
    repository:{id:1,full_name:repository},head_repository:{id:1},workflow_id:102,actor:{login:control.actor},status:'completed',conclusion:'success'};
  const fixture=apiFixture({['GET '+prefix+'/actions/artifacts?per_page=100&page=1']:{total_count:2,artifacts:[forged,raw]},
    ['GET '+prefix+'/actions/runs/101/attempts/1']:run,
    ['GET '+prefix+'/actions/runs/201/attempts/1']:{...run,id:201,path:'.github/workflows/ci.yml',event:'pull_request'}});
  let loads=0;const load=async(id)=>{loads++;assert.equal(id,800);return{root,artifact:{id:800},run};};
  const found=await automation.findSourcePreparation(request,fixture.api,policy,load);
  assert.equal(found.manifest.preparation_sha256,preparation.preparation_sha256);assert.equal(loads,1);
  assert.ok(fixture.calls.every(call=>call.method==='GET'));
});

function sourceFixture() {
  const run = { id: 201, run_attempt: 1, repository: { id: 1, full_name: repository }, head_repository: { id: 1, full_name: repository },
    workflow_id: 202, path: '.github/workflows/ci.yml', event: 'push', head_branch: 'release', head_sha: request.source_sha,
    status: 'completed', conclusion: 'success', created_at: '2026-11-14T12:00:00Z' };
  const pr = { id: 7, number: 7, merged: true, state: 'closed', merge_commit_sha: request.source_sha,
    base: { ref: 'release', repo: { id: 1, full_name: repository } }, head: { ref: 'develop', repo: { id: 1, full_name: repository } } };
  const artifacts = ['quality-201-1', 'certification-201-1', 'evidence-201-1-package'].map((name, index) => ({ id: 300 + index, name, expired: false, digest: 'sha256:' + hash('d'), size_in_bytes: 100 }));
  const fixture = apiFixture({
    ['GET ' + prefix]: { id: 1 },
    ['GET ' + prefix + '/actions/workflows/ci.yml']: { id: 202, path: '.github/workflows/ci.yml', state: 'active' },
    ['GET ' + prefix + '/actions/runs/201']: () => run,
    ['GET ' + prefix + '/actions/runs/201/attempts/1/jobs?per_page=100&page=1']: { total_count: Object.keys(jobNames).length,
      jobs: Object.values(jobNames).map((name, index) => ({ id: 400 + index, name, run_id: 201, run_attempt: 1, head_sha: request.source_sha, status: 'completed', conclusion: 'success' })) },
    ['GET ' + prefix + '/actions/runs/201/artifacts?per_page=100&page=1']: { total_count: artifacts.length, artifacts },
    ['GET ' + prefix + '/git/ref/heads/release']: { ref: 'refs/heads/release', object: { type: 'commit', sha: request.source_sha } },
    ['GET ' + prefix + '/commits/' + request.source_sha + '/pulls?per_page=100&page=1']: [pr],
    ['GET ' + prefix + '/pulls/7']: () => pr,
  });
  return { ...fixture, run, pr };
}

test('automatic source eligibility requires exact push evidence and merged develop-to-release PR', async () => {
  assert.equal(typeof automation.verifyMergedSource, 'function', 'Automatic merged-source verifier is missing');
  const fixture = sourceFixture();
  const result = await automation.verifyMergedSource(request, fixture.api);
  assert.equal(result.pr.number, 7);
  assert.equal(result.run.head_sha, request.source_sha);
  assert.ok(fixture.calls.every(call => call.method === 'GET'));
});

test('foreign/open/wrong-target PRs and newer failed source attempts authorize zero writes', async () => {
  assert.equal(typeof automation.verifyMergedSource, 'function');
  for (const mutate of [value => { value.pr.merged = false; }, value => { value.pr.base.ref = 'main'; },
    value => { value.pr.head.ref = 'feature/unsafe'; }, value => { value.pr.head.repo.id = 2; },
    value => { value.pr.merge_commit_sha = sha('b'); }, value => { value.run.run_attempt = 2; },
    value => { value.run.conclusion = 'failure'; }]) {
    const fixture = sourceFixture(); mutate(fixture);
    await assert.rejects(() => automation.verifyMergedSource(request, fixture.api));
    assert.ok(fixture.calls.every(call => call.method === 'GET'));
  }
});

test('source preparation must recollect actual report/certification bytes before metadata authority', async () => {
  assert.equal(typeof automation.prepareSource, 'function', 'Automatic source preparation is missing');
  const fixture = sourceFixture(); let checked = false;
  await assert.rejects(() => automation.prepareSource({ request, control, policy, api: fixture.api,
    certify: async () => { checked = true; throw new Error('Controlled source report byte mismatch'); } }), /report byte mismatch/);
  assert.equal(checked, true);
  assert.ok(fixture.calls.every(call => call.method === 'GET'));
});

function prepared() {
  const source_files = { 'Cargo.toml': '[package]\nname = "rustcorder"\nversion = "0.1.0"\n',
    'Cargo.lock': 'version = 4\n\n[[package]]\nname = "rustcorder"\nversion = "0.1.0"\n', 'CHANGELOG.md': '# Changelog\n' };
  const notes = '# 0.1.0 (2026-11-14)\n\n### Features\n\n* Synthetic first release\n';
  const snapshot = '# Quality metrics\n\nSynthetic preparation baseline.\n';
  const files = { ...source_files, 'CHANGELOG.md': preparedChangelog(source_files['CHANGELOG.md'], '0.1.0', '2026-11-14', notes), 'docs/quality-metrics.md': snapshot };
  const context = { ...JSON.parse(readFileSync(new URL('fixtures/context.json', import.meta.url), 'utf8')), source_sha: request.source_sha,
    tested_sha: request.source_sha, run_id: 201, run_attempt: 1, repository_id: 1, head_repository_id: 1, workflow_id: 202 };
  const source = sourceFixture();
  const source_authority = { policy, complete: true, source_sha: request.source_sha, source_ci: context, pr: source.pr,
    commit_date: '2026-11-14T12:00:00Z', quality_snapshot: snapshot,
    artifacts: Object.fromEntries(['quality', 'certification', 'package'].map((kind, index) => [kind, { id: 300 + index,
      name: ['quality-201-1', 'certification-201-1', 'evidence-201-1-package'][index], size_in_bytes: 100, api_digest: 'sha256:' + hash('d') }])) };
  const preparation = sealAutomaticRecord('automatic-preparation', { repository, source_sha: request.source_sha,
    version: '0.1.0', release_policy_sha256: canonicalDigest(policy), control, expected_tree: sha('b'), source_tree_sha: sha('9'),
    date: '2026-11-14', commit_date: source_authority.commit_date, notes, previous: null, source_authority, source_ci: context,
    policy_sha256: context.policy_sha256, toolchain_sha256: context.toolchain_sha256, metadata_graph_verified: true,
    patch_sha256: hash('f'), proposal_sha256: hash('e'), changed_paths: ['CHANGELOG.md', 'docs/quality-metrics.md'],
    permitted_paths: Object.keys(files), files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { bytes: Buffer.byteLength(text), sha256: digest(text) }])) });
  return { preparation, files, source_files };
}

test('metadata objects are deterministic, allowlisted, verified and never advance a ref before intent', async () => {
  assert.equal(typeof automation.createMetadataCommit, 'function', 'Bounded metadata writer is missing');
  const { preparation, files, source_files } = prepared();
  const source = sourceFixture();
  const fixture = apiFixture({
    ...source.routes,
    ['POST ' + prefix + '/git/blobs']: call => { const bytes = Buffer.from(call.body.content, call.body.encoding === 'base64' ? 'base64' : 'utf8'); return { sha: createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex') }; },
    ['POST ' + prefix + '/git/trees']: { sha: preparation.expected_tree },
    ['POST ' + prefix + '/git/commits']: call => ({ sha: sha('e'), tree: { sha: call.body.tree }, parents: call.body.parents.map(value => ({ sha: value })) }),
  });
  const app = { id: 12, bot_id: 13, slug: 'fixture-release', login: 'fixture-release[bot]' };
  const result = await automation.createMetadataCommit({ preparation, files, sourceFiles: source_files, policy, app, api: fixture.api });
  assert.equal(result.commit.sha, sha('e'));
  assert.equal(result.intent.parent_sha, preparation.source_sha);
  assert.equal(result.intent.source_sha, sha('e'));
  assert.ok(fixture.calls.every(call => !call.endpoint.includes('/git/refs/')));
  const commit = fixture.calls.find(call => call.endpoint.endsWith('/git/commits')).body;
  assert.deepEqual(commit.parents, [preparation.source_sha]);
  assert.equal(commit.author.date, preparation.commit_date);
  await assert.rejects(() => automation.createMetadataCommit({ preparation, files: { ...files, 'src/main.rs': 'unsafe' }, sourceFiles: source_files, policy, app, api: fixture.api }), /allow|file|scope/i);
});

test('ref advancement requires an uploaded immutable intent and refuses competing tips', async () => {
  assert.equal(typeof automation.advanceMetadata, 'function', 'Intent-before-ref advancement is missing');
  const fixture = apiFixture({});
  const { preparation } = prepared();
  const intent = sealAutomaticRecord('metadata-intent', { repository, source_sha: sha('e'), parent_sha: preparation.source_sha,
    expected_tree: preparation.expected_tree, version: preparation.version, release_policy_sha256: preparation.release_policy_sha256, control });
  await assert.rejects(() => automation.advanceMetadata({ intent, artifact: null, api: fixture.api }), /artifact|intent/i);
  assert.equal(fixture.calls.length, 0);
});

test('persisted intent uses exact successful trusted writer provenance and bounded data-only bytes', async t => {
  const app = { id: 12, bot_id: 13, slug: 'fixture-release', login: 'fixture-release[bot]' };
  const intent = sealAutomaticRecord('metadata-intent', { repository, source_sha: sha('e'), parent_sha: request.source_sha,
    version: '0.1.0', expected_tree: sha('b'), release_policy_sha256: canonicalDigest(policy), preparation_sha256: hash('f'),
    control, app });
  const raw = { id: 900, name: 'metadata-' + sha('e') + '-101-1', digest: 'sha256:' + hash('d'), size_in_bytes: 100,
    expired: false, workflow_run: { id: 101, head_sha: control.source_sha } };
  const run = { id: 101, run_attempt: 1, workflow_id: 102, head_sha: control.source_sha, event: 'workflow_run',
    path: '.github/workflows/release.yml', head_branch: 'main', status: 'completed', conclusion: 'success',
    repository: { id: 1, full_name: repository }, head_repository: { id: 1, full_name: repository }, actor: { login: control.actor } };
  const fixture = apiFixture({ ['GET ' + prefix + '/actions/artifacts/900']: () => raw,
    ['GET ' + prefix + '/actions/runs/101/attempts/1']: () => run,
    ['GET ' + prefix + '/actions/workflows/release.yml']: { id: 102, path: '.github/workflows/release.yml', state: 'active' } });
  const roots = [];
  const download = async (repo, frozen, id, target) => {
    assert.equal(repo, repository); assert.equal(id, 101); roots.push(path.dirname(target));
    mkdirSync(target, { recursive: true }); writeFileSync(path.join(target, 'metadata-intent.json'), JSON.stringify(intent));
  };
  t.after(() => { for (const root of roots) { assert.equal(path.dirname(realpathSync(root)), realpathSync(path.join(repoRoot, '.build'))); rmSync(root, { recursive: true }); } });
  assert.equal((await metadataIntentArtifact(900, sha('e'), fixture.api, { download })).record.intent_sha256, intent.intent_sha256);
  run.conclusion='failure';
  fixture.routes['GET '+prefix+'/actions/runs/101/attempts/1/jobs?per_page=100&page=1']={total_count:1,jobs:[{
    id:800,name:'Write bounded release metadata',run_id:101,run_attempt:1,status:'completed',conclusion:'failure',steps:[
      {name:'Create exact metadata objects',status:'completed',conclusion:'success'},
      {name:'Persist metadata intent',status:'completed',conclusion:'success'},
      {name:'Advance existing release ref',status:'completed',conclusion:'failure'}]}]};
  assert.equal((await metadataIntentArtifact(900,sha('e'),fixture.api,{download})).record.intent_sha256,intent.intent_sha256);
  fixture.routes['GET '+prefix+'/actions/runs/101/attempts/1/jobs?per_page=100&page=1'].jobs[0].steps[1].conclusion='failure';
  await assert.rejects(()=>metadataIntentArtifact(900,sha('e'),fixture.api,{download}),/producer|intent|provenance/i);
  run.conclusion='success';
  for (const mutate of [() => { run.head_branch = 'release'; }, () => { run.run_attempt = 2; }, () => { raw.expired = true; }]) {
    const originalRun = structuredClone(run), originalRaw = structuredClone(raw); mutate();
    await assert.rejects(() => metadataIntentArtifact(900, sha('e'), fixture.api, { download }));
    Object.assign(run, originalRun); Object.assign(raw, originalRaw);
  }
});

test('only the existing release ref advances after verified intent; competing tip never writes', async () => {
  const { preparation } = prepared();
  const artifact = { id: 900, name: 'metadata-' + sha('e') + '-101-1', api_digest: 'sha256:' + hash('d'), size_in_bytes: 100 };
  const intent = sealAutomaticRecord('metadata-intent', { repository, source_sha: sha('e'), parent_sha: preparation.source_sha,
    expected_tree: preparation.expected_tree, version: preparation.version, release_policy_sha256: preparation.release_policy_sha256,
    source_ci: preparation.source_ci, preparation: { id: 800 }, preparation_sha256: preparation.preparation_sha256, control });
  for (const tip of [preparation.source_sha, sha('e'), sha('f')]) {
    const source = sourceFixture();
    const fixture = apiFixture({ ...source.routes,
      ['GET ' + prefix + '/git/ref/heads/release']: { ref: 'refs/heads/release', object: { type: 'commit', sha: tip } },
      ['PATCH ' + prefix + '/git/refs/heads/release']: call => { assert.equal(call.body.force, false); return { ref: 'refs/heads/release', object: { sha: call.body.sha } }; } });
    const invoke = () => automation.advanceMetadata({ intent, artifact, policy, api: fixture.api,
      loadIntent: async () => ({ record: intent, artifact }) });
    if (tip === sha('f')) await assert.rejects(invoke, /Competing/);
    else assert.equal((await invoke()).state, 'awaiting-final-CI');
    assert.equal(fixture.calls.filter(call => call.method === 'PATCH').length, tip === preparation.source_sha ? 1 : 0);
    assert.ok(fixture.calls.every(call => call.method === 'GET' || call.endpoint === prefix + '/git/refs/heads/release'));
  }
});

test('uncertain ref writes converge across five duplicate deliveries without a second update',async()=>{
  const input=prepared(),artifact={id:900,name:'metadata-fixture',api_digest:'sha256:'+hash('d'),size_in_bytes:100};
  const intent=sealAutomaticRecord('metadata-intent',{repository,source_sha:sha('b'),parent_sha:request.source_sha,expected_tree:input.preparation.expected_tree,
    version:'0.1.0',release_policy_sha256:canonicalDigest(policy),control,source_ci:input.preparation.source_ci,preparation:{id:800},
    preparation_sha256:input.preparation.preparation_sha256,app:{id:77,bot_id:78,slug:'fixture-app',login:'fixture-app[bot]'}});
  const source=sourceFixture();let tip=request.source_sha,writes=0;
  const api=async(endpoint,options)=>{
    if(endpoint===prefix+'/git/ref/heads/release')return{ref:'refs/heads/release',object:{type:'commit',sha:tip}};
    if(options?.method==='PATCH'){writes++;tip=intent.source_sha;throw new Error('response lost after ref write');}
    return source.api(endpoint,options);
  };
  for(let count=0;count<5;count++)assert.equal((await automation.advanceMetadata({intent,artifact,policy,api,loadIntent:async()=>({record:intent,artifact})})).state,'awaiting-final-CI');
  assert.equal(writes,1);
});
