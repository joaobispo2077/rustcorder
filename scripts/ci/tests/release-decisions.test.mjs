import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalText, canonicalDigest, confirmPreparation, proposalDigest,
  validatePreparation, verifyApproval, verifyArtifactMetadata, verifyCandidate,
} from '../release.mjs';
import { mutationTestFiles } from '../stryker.config.mjs';
import * as automatic from '../release.mjs';

test('automatic adoption policy is explicit, disabled by default and rejects ambiguous versions', () => {
  assert.equal(typeof automatic.validateReleasePolicy, 'function', 'Automatic adoption policy validation is missing');
  const policy = { schema_version: 1, automation_enabled: false, initial_version: null };
  assert.deepEqual(automatic.validateReleasePolicy(policy), policy);
  for (const change of [{ schema_version: 2 }, { automation_enabled: 'true' }, { initial_version: 'v1.0.0' },
    { initial_version: '1.0.0-rc.1' }, { initial_version: '1.0.0+build' }, { unexpected: true }]) {
    assert.throws(() => automatic.validateReleasePolicy({ ...policy, ...change }));
  }
  assert.equal(automatic.validateReleasePolicy({ ...policy, automation_enabled: true, initial_version: '0.1.0' }).initial_version, '0.1.0');
});

test('automatic v2 records bind kind, canonical digest, source, policy and controller', () => {
  assert.equal(typeof automatic.sealAutomaticRecord, 'function', 'Automatic release records are missing');
  const body = { repository: 'joaobispo2077/rustcorder', source_sha: 'a'.repeat(40), version: '1.0.0',
    release_policy_sha256: 'b'.repeat(64), control: { run_id: 10, run_attempt: 1, workflow_id: 11, source_sha: 'c'.repeat(40) } };
  for (const kind of ['automatic-preparation', 'metadata-intent', 'automatic-candidate', 'automatic-publication-authority', 'automatic-publication-receipt']) {
    const record = automatic.sealAutomaticRecord(kind, body);
    assert.equal(record.schema_version, 2);
    assert.equal(automatic.validateAutomaticRecord(record, kind), record);
    for (const change of [{ schema_version: 1 }, { kind: 'confirmed-preparation' }, { source_sha: 'bad' },
      { version: 'v1.0.0' }, { repository: 'foreign/repo' }, { release_policy_sha256: 'bad' }, { control: { ...body.control, run_attempt: 0 } }]) {
      assert.throws(() => automatic.validateAutomaticRecord({ ...record, ...change }, kind));
    }
    for(const change of [{source_sha:'bad'},{repository:'foreign/repo'},{version:'v1.0.0'},{version:'1.0.0-rc.1'},{version:'1.0.0+build'},{release_policy_sha256:'bad'},
      {control:{...body.control,run_id:0}},{control:{...body.control,run_attempt:0}},{control:{...body.control,workflow_id:0}},{control:{...body.control,source_sha:'bad'}}]){
      assert.throws(()=>automatic.sealAutomaticRecord(kind,{...body,...change}),'A freshly sealed invalid record bypassed field validation');
    }
    assert.throws(() => automatic.validateAutomaticRecord({ schema_version: 1, ...body }, kind));
  }
});

test('automatic authority binds every exact field and refuses manual identity or extra approval fields',()=>{
  const control={run_id:404,run_attempt:1,workflow_id:405,source_sha:'c'.repeat(40)};
  const policy={schema_version:1,automation_enabled:true,initial_version:null};
  const candidate=automatic.sealAutomaticRecord('automatic-candidate',{repository:'joaobispo2077/rustcorder',source_sha:'a'.repeat(40),version:'0.2.0',
    release_policy_sha256:canonicalDigest(policy),control,intent_sha256:'d'.repeat(64),preparation_sha256:'e'.repeat(64)});
  const body={repository:candidate.repository,source_sha:candidate.source_sha,version:candidate.version,release_policy_sha256:candidate.release_policy_sha256,
    control,candidate_sha256:candidate.candidate_sha256,intent_sha256:candidate.intent_sha256,preparation_sha256:candidate.preparation_sha256,actor:'automatic-ci'};
  const seal=body=>automatic.sealAutomaticRecord('automatic-publication-authority',body);
  assert.equal(automatic.validateAutomaticAuthority(candidate,seal(body),policy),true);
  for(const change of [{source_sha:'b'.repeat(40)},{version:'0.2.1'},{candidate_sha256:'b'.repeat(64)},{intent_sha256:'b'.repeat(64)},
    {preparation_sha256:'b'.repeat(64)},{release_policy_sha256:'b'.repeat(64)},{control:{...control,run_attempt:2}},{actor:'maintainer'},{environment_id:22}]){
    assert.throws(()=>automatic.validateAutomaticAuthority(candidate,seal({...body,...change}),policy));
  }
  assert.throws(()=>automatic.validateAutomaticAuthority(candidate,seal(body),{...policy,automation_enabled:false}));
});

// Pure decision fixtures: no Git databases, child processes, archives or requests.
const hash = (character, length = 40) => character.repeat(length);
const request = { candidate_sha256: hash('a',64), control: { run_id:404, run_attempt:1 } };
const environment = { id:22, name:'release-publish', protection_rules:[{ type:'required_reviewers',
  reviewers:[{type:'User',reviewer:{id:7,login:'owner'}}] }] };
const approved = () => ({state:'approved',comment:approvalText(request),environments:[{id:22,name:'release-publish'}],user:{id:7,login:'owner'}});
function preparation() {
  const source = hash('b'), policy = hash('c',64), toolchain = hash('d',64);
  const body = { schema_version:1, kind:'confirmed-preparation', repository:'joaobispo2077/rustcorder', version:'0.1.0',
    date:'2026-11-05', previous:null, source_sha:source, expected_tree:hash('e'),
    patch_sha256:hash('f',64), proposal_sha256:hash('1',64), policy_sha256:policy, toolchain_sha256:toolchain,
    source_ci:{schema_version:1,kind:'hosted',repository:'joaobispo2077/rustcorder',repository_id:101,head_repository_id:101,
      workflow_id:202,workflow_path:'.github/workflows/ci.yml',workflow_sha:hash('a'),event:'push',branch:'release',
      source_sha:source,tested_sha:source,run_id:303,run_attempt:1,job_id:'rust',policy_sha256:policy,toolchain_sha256:toolchain},
    confirmation:{completion:true,bootstrap:true,run_id:404,run_attempt:1,workflow_id:405,workflow_sha:hash('a'),actor:'fixture-owner'},
    metadata_graph_verified:true,permitted_paths:['Cargo.toml','Cargo.lock','CHANGELOG.md'],changed_paths:['Cargo.toml'] };
  return {...body,preparation_sha256:canonicalDigest(body)};
}

test('per-mutant commands retain cheap release decisions and leave integration suites to policy CI',()=>{
  for(const profile of ['light','full']){
    const files=mutationTestFiles(profile);
    assert.ok(files.includes('scripts/ci/tests/release-decisions.test.mjs'),'Missing cheap release decision population');
    assert.ok(!files.includes('scripts/ci/tests/preparation.test.mjs'),'Git preparation integration must run once in policy CI');
    assert.ok(!files.includes('scripts/ci/tests/authorization.test.mjs'),'Archive extraction integration must run once in policy CI');
  }
});

test('approval binds the frozen request and reports the configured reviewer',()=>{
  assert.deepEqual(verifyApproval(request,environment,[approved()]),{actor:'owner',environment_id:22,candidate_sha256:request.candidate_sha256,comment:approvalText(request)});
  const whitespace=approved();whitespace.comment=' \n'+whitespace.comment+'\t ';
  assert.equal(verifyApproval(request,environment,[whitespace]).actor,'owner');
  const unrelated=approved();unrelated.comment='Approve another request';unrelated.state='rejected';
  assert.equal(verifyApproval(request,environment,[unrelated,approved()]).actor,'owner');
});

test('approval refuses wrong scope, absent reviewer protection and unconfigured identities',()=>{
  for(const changes of [{candidate_sha256:'bad'},{control:{run_id:405,run_attempt:1}},{control:{run_id:404,run_attempt:2}}]) {
    assert.throws(()=>verifyApproval({...request,...changes},environment,[approved()]));
  }
  const rules=environment.protection_rules;
  for(const changes of [{id:0},{id:'22'},{name:'other'}, {protection_rules:[]},{protection_rules:[...rules,...rules]},
    {protection_rules:[{type:'required_reviewers',reviewers:[]}]},
    {protection_rules:[{type:'required_reviewers',reviewers:[{type:'Team',reviewer:{id:7}}]}]},
    {protection_rules:[{type:'required_reviewers',reviewers:[{type:'User',reviewer:{id:0}}]}]}]){
    assert.throws(()=>verifyApproval(request,{...environment,...changes},[approved()]));
  }
  for(const change of [review=>{review.user.id=8;},review=>{review.state='pending';},review=>{review.comment='Ship it';},
    review=>{review.environments[0].id=23;},review=>{review.environments[0].name='another';},review=>{review.environments=[];},
    review=>{review.user.login='';}]){
    const review=approved();change(review);assert.throws(()=>verifyApproval(request,environment,[review]));
  }
  assert.throws(()=>verifyApproval(request,environment,[]));
  const rejected=approved();rejected.state='rejected';
  assert.throws(()=>verifyApproval(request,environment,[approved(),rejected]));
});

test('completion and first-version approval are distinct exact boolean decisions',()=>{
  assert.equal(confirmPreparation({state:'bootstrap',version:'0.1.0'},{completion:true,bootstrap:true}),true);
  assert.equal(confirmPreparation({state:'release',version:'0.2.0'},{completion:true,bootstrap:false}),true);
  for(const completion of [false,undefined,null,1,'true'])assert.throws(()=>confirmPreparation({state:'release',version:'0.2.0'},{completion}));
  for(const bootstrap of [false,undefined,null,1,'true'])assert.throws(()=>confirmPreparation({state:'bootstrap',version:'0.1.0'},{completion:true,bootstrap}));
  for(const state of ['no-release','pending',''])assert.throws(()=>confirmPreparation({state,version:'0.1.0'},{completion:true,bootstrap:true}));
  for(const version of ['v0.1.0','bad','',null,1])assert.throws(()=>confirmPreparation({state:'release',version},{completion:true}));
});

test('final candidate uses the exact prepared tree, version and single source parent',()=>{
  const prepared=preparation();assert.equal(validatePreparation(prepared),prepared);
  const candidate={sha:hash('f'),tree_sha:prepared.expected_tree,parents:[prepared.source_sha],version:prepared.version,dirty:false};
  assert.equal(verifyCandidate(prepared,candidate),true);
  for(const change of [{sha:prepared.source_sha},{sha:'not-a-sha'},{sha:1},{tree_sha:hash('9')},{tree_sha:null},
    {parents:[]},{parents:[prepared.source_sha,prepared.source_sha]},{parents:[hash('9')]},{parents:null},
    {version:'0.2.0'},{version:null},{dirty:true}])assert.throws(()=>verifyCandidate(prepared,{...candidate,...change}));
  const tampered={...prepared,expected_tree:hash('9')};
  assert.throws(()=>verifyCandidate(tampered,{...candidate,tree_sha:tampered.expected_tree}),/digest/);
});

test('artifact metadata requires the exact immutable artifact and bounded positive bytes',()=>{
  const frozen={id:10,name:'quality-303-1',size_in_bytes:100,api_digest:'sha256:'+hash('c',64)};
  const raw={...frozen,digest:frozen.api_digest,expired:false,workflow_run:{id:303}};
  assert.equal(verifyArtifactMetadata(raw,frozen,303),true);
  const max={...frozen,size_in_bytes:512*1024*1024};
  assert.equal(verifyArtifactMetadata({...raw,size_in_bytes:max.size_in_bytes},max,303),true);
  for(const change of [{id:11},{name:'quality-303-2'},{size_in_bytes:101},{digest:'sha256:'+hash('d',64)},
    {expired:true},{expired:undefined},{workflow_run:{id:304}},{workflow_run:null}])assert.throws(()=>verifyArtifactMetadata({...raw,...change},frozen,303));
  for(const change of [{id:0},{id:'10'},{size_in_bytes:0},{size_in_bytes:-1},{size_in_bytes:0.5},
    {size_in_bytes:512*1024*1024+1},{api_digest:'sha256:'+hash('g',64)},{api_digest:hash('c',64)}]){
    assert.throws(()=>verifyArtifactMetadata(raw,{...frozen,...change},303));
  }
});

test('canonical release digests bind values and array order while ignoring object key order',()=>{
  assert.equal(canonicalDigest({b:2,a:{d:4,c:3}}),canonicalDigest({a:{c:3,d:4},b:2}));
  assert.notEqual(canonicalDigest([1,2]),canonicalDigest([2,1]));
  assert.notEqual(canonicalDigest({count:1}),canonicalDigest({count:2}));
  for(const value of [NaN,Infinity,undefined,()=>true])assert.throws(()=>canonicalDigest(value));
  const body={state:'release',version:'0.2.0',source_sha:hash('a')};
  assert.equal(proposalDigest({...body,proposal_sha256:hash('0',64)}),canonicalDigest(body));
});
