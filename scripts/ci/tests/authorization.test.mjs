import test from 'node:test';
import assert from 'node:assert/strict';
import * as release from '../release.mjs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,existsSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {repoRoot,digest} from '../gates.mjs';

const request = { candidate_sha256: 'a'.repeat(64), control: {run_id: 404, run_attempt: 1} };
const env = {id: 22, name: 'release-publish', protection_rules: [{type:'required_reviewers', reviewers:[{type:'User',reviewer:{id:7,login:'owner'}}]}]};
function review(comment = 'Approve ' + request.candidate_sha256 + ' run 404 attempt 1') {
  return [{state:'approved',comment,environments:[{id:22,name:'release-publish'}],user:{id:7,login:'owner'}}];
}
test('publication approval names the exact frozen request, run and attempt', () => {
  assert.equal(release.verifyApproval(request, env, review()).actor, 'owner');
  for (const data of [[], review('Ship it'), review('Approve ' + 'b'.repeat(64) + ' run 404 attempt 1'), review('Approve ' + request.candidate_sha256 + ' run 404 attempt 2')]) {
    assert.throws(() => release.verifyApproval(request, env, data));
  }
});
test('missing required reviewers, wrong environment or unconfigured reviewer blocks publication', () => {
  assert.throws(() => release.verifyApproval(request, {...env,protection_rules:[]}, review()));
  const bad = review(); bad[0].user.id = 99;
  assert.throws(() => release.verifyApproval(request, env, bad));
  const wrong = review(); wrong[0].environments[0].id = 99;
  assert.throws(() => release.verifyApproval(request, env, wrong));
});

test('artifact download metadata cannot substitute ID, bytes, name, digest or run', () => {
  const frozen = {id:10,name:'quality-303-1',size_in_bytes:100,api_digest:'sha256:'+'c'.repeat(64)};
  const raw = {...frozen,digest:frozen.api_digest,expired:false,workflow_run:{id:303}};
  assert.ok(release.verifyArtifactMetadata(raw,frozen,303));
  for (const change of [{id:11},{name:'quality-303-2'},{size_in_bytes:101},{expired:true},{digest:'sha256:'+'d'.repeat(64)},{workflow_run:{id:304}}]) {
    assert.throws(() => release.verifyArtifactMetadata({...raw,...change},frozen,303));
  }
});

test('release notes expose only the newly confirmed version entry', () => {
  const changelog='# Changelog\n\n## 0.2.0 - 2026-11-05\n\nUseful feature.\n\n## 0.1.0 - 2026-10-01\n\nOlder history.\n';
  assert.equal(release.releaseEntry(changelog,'0.2.0'),'Useful feature.');
  assert.throws(()=>release.releaseEntry(changelog,'0.3.0'));
});

test('artifact download verifies bounded archive bytes before safe data-only extraction', async t => {
  const boundary=path.join(repoRoot,'.build');mkdirSync(boundary,{recursive:true});
  const root=mkdtempSync(path.join(boundary,'artifact-test-'));
  t.after(()=>{assert.equal(path.dirname(realpathSync(root)),realpathSync(boundary));rmSync(root,{recursive:true});});
  const source=path.join(root,'source');mkdirSync(source);writeFileSync(path.join(source,'payload.txt'),'verified fixture');
  const script=path.join(root,'fixture.ps1');
  writeFileSync(script,"Add-Type -AssemblyName System.IO.Compression.FileSystem\n[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $PSScriptRoot 'source'),(Join-Path $PSScriptRoot 'fixture.zip'))\n");
  execFileSync('pwsh',['-NoProfile','-File',script],{timeout:15000,stdio:'pipe'});
  const bytes=readFileSync(path.join(root,'fixture.zip'));
  const frozen={id:10,name:'quality-303-1',size_in_bytes:bytes.length,api_digest:'sha256:'+digest(bytes)};
  const metadata={...frozen,digest:frozen.api_digest,expired:false,workflow_run:{id:303}};
  const api=async()=>metadata;
  const requests=[];
  const response=async(url,options)=>{requests.push({url:String(url),options});return new Response(bytes);};
  await release.downloadArtifact('joaobispo2077/rustcorder',frozen,303,path.join(root,'valid'),api,response);
  assert.equal(readFileSync(path.join(root,'valid/payload.txt'),'utf8'),'verified fixture');
  await assert.rejects(()=>release.downloadArtifact('joaobispo2077/rustcorder',frozen,303,path.join(root,'substituted'),api,
    async()=>new Response(Buffer.from('changed'))),/digest|byte/);
  assert.equal(existsSync(path.join(root,'substituted')),false);
  await assert.rejects(()=>release.downloadArtifact('joaobispo2077/rustcorder',frozen,303,path.join(root,'redirect'),api,
    async()=>new Response(null,{status:302,headers:{location:'https://attacker.example/asset'}})),/redirect/);
  let redirected=0;
  await release.downloadArtifact('joaobispo2077/rustcorder',frozen,303,path.join(root,'signed'),api,
    async(url,options)=>{
      if(++redirected===1)return new Response(null,{status:302,headers:{location:'https://production.actions.githubusercontent.com/signed'}});
      assert.equal(options.headers,undefined,'Signed artifact requests must not receive credentials');
      return new Response(bytes);
    });
  assert.equal(redirected,2);
});
