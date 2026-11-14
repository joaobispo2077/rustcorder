import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {apiFixture} from './git-fixture.mjs';
import {readFileSync} from 'node:fs';
import {jobNames,requiredGates} from '../gates.mjs';
const target=new URL('../pr-comment.mjs',import.meta.url);
const reporter=existsSync(target)?await import(target.href):{};
const repository='joaobispo2077/rustcorder',prefix='/repos/'+repository,sha='a'.repeat(40),merge='b'.repeat(40);
function fixture(){
  const repo={id:1,full_name:repository},fork={id:2,full_name:'contributor/fork'};
  const pr={number:7,state:'open',head:{sha,ref:'feature/example',repo:fork},base:{ref:'develop',repo},merge_commit_sha:merge};
  const run={id:201,run_attempt:1,run_number:10,created_at:'2026-11-14T12:00:00Z',workflow_id:202,path:'.github/workflows/ci.yml',event:'pull_request',head_sha:sha,
    head_branch:pr.head.ref,head_repository:{...fork},repository:repo,status:'completed',conclusion:'failure',pull_requests:[{number:7,head:{sha},base:{ref:'develop'}}]};
  const comments=[];const api=apiFixture({
    ['GET '+prefix]:{...repo},['GET '+prefix+'/actions/workflows/ci.yml']:{id:202,path:'.github/workflows/ci.yml',state:'active'},
    ['GET '+prefix+'/actions/runs/201']:()=>run,['GET '+prefix+'/pulls/7']:()=>pr,
    ['GET '+prefix+'/actions/workflows/ci.yml/runs?event=pull_request&per_page=100&page=1']:{total_count:1,workflow_runs:[run]},
    ['GET '+prefix+'/actions/runs/201/attempts/1/jobs?per_page=100&page=1']:{total_count:1,jobs:[{id:1,name:'Rust quality',status:'completed',conclusion:'failure',run_id:201,run_attempt:1,head_sha:merge}]},
    ['GET '+prefix+'/actions/runs/201/artifacts?per_page=100&page=1']:{total_count:0,artifacts:[]},
    ['GET '+prefix+'/issues/7/comments?per_page=100&page=1']:()=>comments,
    ['POST '+prefix+'/issues/7/comments']:({body})=>{const item={id:100,user:{id:41898282,type:'Bot'},body:body.body};comments.push(item);return item;},
    ['PATCH '+prefix+'/issues/comments/100']:({body})=>{comments[0].body=body.body;return comments[0];},
  });return{api:api.api,calls:api.calls,routes:api.routes,pr,run,comments};
}
test('fork PR resolution verifies API identity and constructs a failure diagnostic without a report',async()=>{
  assert.equal(typeof reporter.resolvePr,'function');const s=fixture();
  const result=await reporter.resolvePr({run_id:201,pr_number:7},{api:s.api});
  assert.equal(result.pr.head.repo.id,2);assert.equal(result.phase,'failed');assert.equal(result.projection,null);
  assert.ok(result.reasons.some(reason=>/report/i.test(reason)));
  assert.ok(s.calls.every(call=>call.method==='GET'));
});
test('forged association, direct push and foreign target cannot authorize a comment',async()=>{
  assert.equal(typeof reporter.resolvePr,'function');
  for(const change of [s=>{s.run.event='push';},s=>{s.pr.base.repo.id=9;},s=>{s.pr.base.ref='unknown';},s=>{s.run.head_repository.id=9;},s=>{s.run.pull_requests=[];}]){
    const s=fixture();change(s);await assert.rejects(()=>reporter.resolvePr({run_id:201,pr_number:7},{api:s.api}));
    assert.ok(s.calls.every(call=>call.method==='GET'));
  }
});
test('idempotent owned delivery ignores human markers and reconciles pending after a rerun',async()=>{
  assert.equal(typeof reporter.deliverPr,'function');const s=fixture();
  s.comments.push({id:99,user:{id:7,type:'User'},body:'<!-- rustcorder-quality-report:v1 --> human'});
  const delivered=await reporter.deliverPr({run_id:201,pr_number:7},{api:s.api});
  assert.equal(delivered.outcome,'delivered');assert.equal(s.comments.length,2);
  s.run.status='in_progress';s.run.conclusion=null;s.run.run_attempt=2;
  s.comments.splice(0,1);
  await reporter.deliverPr({run_id:201,pr_number:7},{api:s.api});
  assert.equal(s.comments.length,1);assert.match(s.comments[0].body,/pending/i);
  assert.equal(s.calls.filter(call=>call.method==='POST').length,1);
});
test('forbidden delivery retains a readable report and cannot change upstream readiness',async()=>{
  assert.equal(typeof reporter.deliverPr,'function');const s=fixture();
  const api=(endpoint,options)=>options?.method==='POST'?Promise.reject(new Error('GitHub request failed (403)')):s.api(endpoint,options);
  const result=await reporter.deliverPr({run_id:201,pr_number:7},{api});
  assert.equal(result.outcome,'forbidden');assert.match(result.markdown,/failed/i);
  assert.equal(s.run.conclusion,'failure');
});

test('lost POST responses and duplicate bot reports recover without touching human comments',async()=>{
  const s=fixture();let lost=true;
  const api=async(endpoint,options)=>{
    const value=await s.api(endpoint,options);
    if(options?.method==='POST' && lost){lost=false;throw new Error('lost response');}return value;
  };
  assert.equal((await reporter.deliverPr({run_id:201,pr_number:7},{api})).outcome,'delivered');
  assert.equal(s.comments.length,1);assert.equal(s.calls.filter(call=>call.method==='POST').length,1);
});

test('duplicate owned comments are neutralized while human text remains untouched',async()=>{
  const s=fixture();s.comments.push({id:100,user:{id:41898282,type:'Bot'},body:'<!-- rustcorder-quality-report:v1 --> first'},
    {id:101,user:{id:41898282,type:'Bot'},body:'<!-- rustcorder-quality-report:v1 --> duplicate'});
  s.routes['PATCH '+prefix+'/issues/comments/101']=({body})=>{s.comments[1].body=body.body;return s.comments[1];};
  const result=await reporter.deliverPr({run_id:201,pr_number:7},{api:s.api});
  assert.equal(result.outcome,'delivered');assert.equal(s.comments.filter(comment=>comment.body.startsWith('<!-- rustcorder-quality-report:v1 -->')).length,1);
  assert.match(s.comments[1].body,/Superseded/);assert.ok(s.calls.every(call=>call.method!=='DELETE'));
});

test('an older callback reconciles a newer run, and attempt numbers are compared only within a run',async()=>{
  const s=fixture(),latest={...s.run,id:202,run_number:11,run_attempt:1,status:'in_progress',conclusion:null};s.run.run_attempt=3;
  s.routes['GET '+prefix+'/actions/workflows/ci.yml/runs?event=pull_request&per_page=100&page=1']={total_count:2,workflow_runs:[s.run,latest]};
  s.routes['GET '+prefix+'/actions/runs/202']=latest;
  const result=await reporter.deliverPr({run_id:201,pr_number:7},{api:s.api});
  assert.equal(result.run_id,202);assert.equal(result.run_attempt,1);assert.equal(result.phase,'pending');
});

test('PR head changes during delivery are reconciled rather than left green',async()=>{
  const s=fixture();let changed=false;
  const api=async(endpoint,options)=>{
    const value=await s.api(endpoint,options);
    if(options?.method==='POST' && !changed){changed=true;s.pr.head.sha='c'.repeat(40);}return value;
  };
  const result=await reporter.deliverPr({run_id:201,pr_number:7},{api});
  assert.equal(result.outcome,'superseded');assert.match(s.comments[0].body,/superseded/i);
});

test('a complete PR report passes only with matching final certification and exact-attempt jobs',async()=>{
  const s=fixture();s.run.conclusion='success';
  const context={...JSON.parse(readFileSync(new URL('fixtures/context.json',import.meta.url))),repository_id:1,head_repository_id:2,event:'pull_request',branch:s.pr.head.ref,
    source_sha:sha,tested_sha:merge,run_id:201,run_attempt:1,workflow_id:202};
  const projection={schema_version:1,kind:'pr-quality-projection',context,construction_errors:[],gates:requiredGates(context).map(gate=>({gate,required:true,status:'pass'}))};
  const certification={schema_version:1,context:{...context,job_id:'readiness'},ready:true,reasons:[],required_gates:requiredGates(context)};
  s.routes['GET '+prefix+'/actions/runs/201/attempts/1/jobs?per_page=100&page=1']={total_count:Object.keys(jobNames).length,jobs:Object.values(jobNames).map((name,index)=>({id:index+1,name,run_id:201,run_attempt:1,status:'completed',conclusion:'success'}))};
  s.routes['GET '+prefix+'/actions/runs/201/artifacts?per_page=100&page=1']={total_count:2,artifacts:[{id:1,name:'quality-comment-201-1'},{id:2,name:'certification-201-1'}]};
  const load=async(raw)=>raw.id===1?structuredClone(projection):structuredClone(certification);
  assert.equal((await reporter.resolvePr({run_id:201,pr_number:7},{api:s.api,load})).phase,'passed');
  projection.context.tested_sha='c'.repeat(40);
  assert.equal((await reporter.resolvePr({run_id:201,pr_number:7},{api:s.api,load})).phase,'incomplete');
  projection.context.tested_sha=merge;certification.context.run_attempt=2;
  assert.equal((await reporter.resolvePr({run_id:201,pr_number:7},{api:s.api,load})).phase,'incomplete');
  certification.context.run_attempt=1;s.pr.state='closed';s.pr.merge_commit_sha='d'.repeat(40);
  assert.equal((await reporter.resolvePr({run_id:201,pr_number:7},{api:s.api,load})).phase,'historical');
});

test('expired, foreign, oversized and malformed compact artifacts never reach download',async()=>{
  const s=fixture();let downloads=0;
  const valid={id:500,name:'quality-comment-201-1',digest:'sha256:'+'d'.repeat(64),size_in_bytes:100,expired:false,workflow_run:{id:201}};
  for(const change of [{expired:true},{workflow_run:{id:202}},{size_in_bytes:1048577},{digest:'bad'},{name:'quality-comment-201-2'}]){
    await assert.rejects(()=>reporter.loadPrArtifact({...valid,...change},s.run,'quality-comment-201-1',{api:s.api,download:async()=>{downloads++;}}));
  }
  assert.equal(downloads,0);
});

test('transient comment transport failures retry within a fixed bound and preserve report construction errors',async()=>{
  const s=fixture();s.comments.push({id:100,user:{id:41898282,type:'Bot'},body:'<!-- rustcorder-quality-report:v1 --> old'});
  let attempts=0;
  const api=async(endpoint,options)=>{if(options?.method==='PATCH' && ++attempts<3)throw new Error('GitHub request failed (503)');return s.api(endpoint,options);};
  const result=await reporter.deliverPr({run_id:201,pr_number:7},{api});assert.equal(result.outcome,'delivered');assert.equal(attempts,3);
});

test('fork runs with an empty PR hint list use a verified commit association',async()=>{
  const s=fixture();s.run.pull_requests=[];
  s.routes['GET '+prefix+'/commits/'+sha+'/pulls?per_page=100&page=1']=[{id:7,number:7}];
  assert.equal((await reporter.resolvePr({run_id:201,pr_number:7},{api:s.api})).pr.number,7);
  s.pr.head.sha='d'.repeat(40);
  await assert.rejects(()=>reporter.resolvePr({run_id:201,pr_number:7},{api:s.api}),/association|head/i);
});
