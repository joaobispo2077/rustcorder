import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessPrEvidence,newerRun,ownedComments} from '../pr-comment.mjs';
import {loadPolicy,requiredGates} from '../gates.mjs';
const context={...JSON.parse(readFileSync(new URL('fixtures/context.json',import.meta.url))),event:'pull_request',branch:'feature/example'};
function evidence(){return{
  pr:{number:7,state:'open',head:{sha:context.source_sha}},run:{id:1,run_attempt:1,run_number:1,created_at:'2026-11-14T12:00:00Z',head_sha:context.source_sha,status:'completed',conclusion:'success'},
  projection:{context,gates:requiredGates(context).map(gate=>({gate,required:true,status:'pass'})),construction_errors:[]},
  certification:{schema_version:1,context,ready:true,required_gates:requiredGates(context),reasons:[]},
  jobs:Object.fromEntries([...loadPolicy().jobs.ordinary,'readiness'].map(id=>[id,'success'])),errors:[]};}
test('passing requires all gates, actual jobs and final certification',()=>{
  const input=evidence();assert.equal(assessPrEvidence(input).phase,'passed');
  input.projection.gates.pop();assert.equal(assessPrEvidence(input).phase,'incomplete');
});
for(const [label,change,phase] of [
  ['running',s=>{s.run.status='in_progress';},'pending'],['queued',s=>{s.run.status='queued';},'pending'],
  ['failed',s=>{s.run.conclusion='failure';},'failed'],['cancelled',s=>{s.run.conclusion='cancelled';},'failed'],
  ['timed out',s=>{s.run.conclusion='timed_out';},'failed'],['stale head',s=>{s.pr.head.sha='e'.repeat(40);},'superseded'],
  ['missing projection',s=>{s.projection=null;},'incomplete'],['missing certification',s=>{s.certification=null;},'incomplete'],
  ['preliminary only',s=>{s.jobs.readiness='missing';},'incomplete'],['failed readiness',s=>{s.jobs.readiness='failure';},'failed'],
  ['skipped readiness',s=>{s.jobs.readiness='skipped';},'incomplete'],['bad final schema',s=>{s.certification.schema_version=2;},'incomplete'],
  ['final false',s=>{s.certification.ready=false;},'incomplete'],['construction failed',s=>{s.projection.construction_errors=[{reason:'bad'}];},'incomplete'],
  ['gate failed',s=>{s.projection.gates[0].status='fail';},'incomplete'],['collection error',s=>{s.errors=['bad report'];},'incomplete'],
  ['neutral',s=>{s.run.conclusion='neutral';},'incomplete'],['closed',s=>{s.pr.state='closed';},'historical'],
])test('PR final overlay: '+label,()=>{const input=evidence();change(input);assert.equal(assessPrEvidence(input).phase,phase);});
test('ordering uses run number across runs and attempt only within one run',()=>{
  const a={id:1,run_number:10,run_attempt:9,created_at:'2026-11-14T12:00:00Z'},b={...a,id:2,run_number:11,run_attempt:1};
  assert.equal(newerRun(b,a),true);assert.equal(newerRun(a,b),false);assert.equal(newerRun({...a,run_attempt:10},a),true);
  assert.equal(newerRun({...a,run_attempt:8},a),false);
});
test('only the fixed numeric GitHub bot with the leading marker owns a comment',()=>{
  const own={id:3,user:{id:41898282,type:'Bot'},body:'<!-- rustcorder-quality-report:v1 -->\nreport'};
  assert.deepEqual(ownedComments([own,{...own,id:4,user:{id:1,type:'User'}},{...own,id:5,body:'prefix '+own.body},{...own,id:6,user:{id:41898282,type:'User'}}]),[own]);
});
