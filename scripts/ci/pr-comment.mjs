import {appendFileSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {ensure,counter,SHA,githubJson,repoRoot,loadPolicy,jobNames,validateContext,jsonFile,cliOptions,writeJson,filesBelow,containedFile,git,digest,requiredGates} from './gates.mjs';
import {paginate,downloadArtifact,verifyArtifactMetadata,canonicalDigest} from './release.mjs';
import {parsePrProjection,renderPrReport} from './report.mjs';

export const marker='<!-- rustcorder-quality-report:v1 -->';
const botId=41898282; // GitHub.com github-actions[bot], verified numerically before editing.
const prefix='/repos/'+loadPolicy().repository;
const terminalFailures=new Set(['failure','cancelled','timed_out','action_required','stale']);

function verifyRun(run,repo,workflow) {
  counter(run.id,'PR CI run',true);counter(run.run_attempt,'PR CI attempt',true);counter(run.run_number,'PR CI run number',true);
  ensure(run.repository?.id===repo.id && run.repository.full_name===loadPolicy().repository &&
    run.workflow_id===workflow.id && run.path?.split('@')[0]==='.github/workflows/ci.yml' && run.event==='pull_request' &&
    typeof run.head_sha==='string' && SHA.test(run.head_sha),'Untrusted PR CI identity');
  counter(run.head_repository?.id,'PR head repository',true);
  ensure(typeof run.created_at==='string' && Number.isFinite(Date.parse(run.created_at)),'Invalid PR CI ordering date');
  ensure(['queued','in_progress','completed','waiting','requested','pending'].includes(run.status),'Invalid PR CI status');
  return run;
}

function verifyPr(pr,run,repo) {
  counter(pr.number,'PR number',true);
  ensure(pr.base?.repo?.id===repo.id && pr.base.repo.full_name===loadPolicy().repository &&
    ['develop','release','main'].includes(pr.base.ref),'Untrusted PR target');
  ensure(['open','closed'].includes(pr.state) && typeof pr.head?.sha==='string' && SHA.test(pr.head.sha),'Invalid PR state/head');
  const association=run.pull_requests?.filter(item=>item.number===pr.number);
  ensure(association?.length===1 && run.head_repository?.id===pr.head.repo?.id && run.head_branch===pr.head.ref,
    'CI run is not associated with this PR/head repository');
  // A stale callback may name an older head, but its explicit association is never borrowed for a different fork.
  ensure(association[0].head?.sha===run.head_sha && association[0].base?.ref===pr.base.ref,'PR association identity mismatch');
}

export function newerRun(a,b) {
  if(a.id===b.id)return a.run_attempt>b.run_attempt;
  return a.run_number>b.run_number || (a.run_number===b.run_number && Date.parse(a.created_at)>Date.parse(b.created_at));
}

async function currentPrRun(input,api) {
  counter(input.run_id,'upstream PR run',true);counter(input.pr_number,'target PR',true);
  const repo=await api(prefix),workflow=await api(prefix+'/actions/workflows/ci.yml');
  ensure(workflow.path==='.github/workflows/ci.yml' && workflow.state==='active','Untrusted CI workflow');
  const pr=await api(prefix+'/pulls/'+input.pr_number);
  const original=await associatedRun(verifyRun(await api(prefix+'/actions/runs/'+input.run_id),repo,workflow),pr,api);
  verifyPr(pr,original,repo);
  const runs=await paginate(api,prefix+'/actions/workflows/ci.yml/runs?event=pull_request','workflow_runs');
  let current=original;
  for(let candidate of runs){
    if(candidate.head_sha!==pr.head.sha || candidate.head_repository?.id!==pr.head.repo.id || candidate.head_branch!==pr.head.ref)continue;
    candidate=await associatedRun(candidate,pr,api);
    if(!candidate.pull_requests?.some(item=>item.number===pr.number))continue;
    verifyRun(candidate,repo,workflow);verifyPr(pr,candidate,repo);
    if(current.head_sha!==pr.head.sha || newerRun(candidate,current))current=candidate;
  }
  // Listing can race with reruns; the run endpoint gives the latest attempt, not a cached callback.
  const latest=await associatedRun(verifyRun(await api(prefix+'/actions/runs/'+current.id),repo,workflow),pr,api);verifyPr(pr,latest,repo);
  return {pr,run:latest,repo,workflow};
}

async function associatedRun(run,pr,api) {
  if(run.pull_requests?.length)return run;
  const associated=await paginate(api,prefix+'/commits/'+run.head_sha+'/pulls',null);
  ensure(associated.filter(item=>item.number===pr.number).length===1 && pr.head.sha===run.head_sha &&
    pr.head.repo?.id===run.head_repository?.id && pr.head.ref===run.head_branch,'Missing verified fork PR/head association');
  return {...run,pull_requests:[{number:pr.number,head:{sha:run.head_sha},base:{ref:pr.base.ref}}]};
}

export async function loadPrArtifact(raw,run,name,{api=githubJson,download=downloadArtifact}={}) {
  ensure(raw?.name===name && raw.size_in_bytes<=1048576,'Compact PR artifact exceeds bound or has wrong name');
  const frozen={id:raw.id,name:raw.name,api_digest:raw.digest,size_in_bytes:raw.size_in_bytes};
  verifyArtifactMetadata(raw,frozen,run.id);
  const parent=path.join(repoRoot,'.build');mkdirSync(parent,{recursive:true});
  const root=path.join(mkdtempSync(path.join(parent,'pr-report-')),'data');
  await download(loadPolicy().repository,frozen,run.id,root,api);
  const expected=name.startsWith('quality-comment-')?'pr-quality-projection.json':'certification.json';
  const files=filesBelow(root);ensure(files.length===1 && path.basename(files[0])===expected,'Unexpected compact PR artifact contents');
  const bytes=readFileSync(containedFile(root,expected));ensure(bytes.length<=1048576,'PR evidence JSON exceeds bound');
  return expected==='pr-quality-projection.json'?parsePrProjection(bytes):JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}

export function assessPrEvidence({pr,run,projection,certification,jobs,errors=[]}) {
  const reasons=[...errors];
  if(run.head_sha!==pr.head.sha)return {phase:'superseded',reasons:[...reasons,'A newer PR head has no matching CI evidence yet']};
  if(run.status!=='completed')return {phase:'pending',reasons:[...reasons,'Latest CI attempt is still running']};
  if(terminalFailures.has(run.conclusion))return {phase:'failed',reasons:[...reasons,'Actual CI conclusion: '+run.conclusion]};
  const required=[...loadPolicy().jobs.ordinary,'readiness'];
  const failed=required.filter(id=>terminalFailures.has(jobs[id]));
  if(failed.length)return {phase:'failed',reasons:[...reasons,'Failed jobs: '+failed.join(', ')]};
  if(!projection)reasons.push('Quality report is missing');
  if(!certification)reasons.push('Final readiness certification is missing');
  if(required.some(id=>jobs[id]!=='success'))reasons.push('Required jobs are incomplete');
  if(projection?.construction_errors?.length)reasons.push('Quality report construction failed');
  if(certification && (certification.schema_version!==1 || certification.ready!==true || !Array.isArray(certification.reasons) || certification.reasons.length))reasons.push('Final readiness did not pass');
  if(projection?.gates.some(row=>row.required && row.status!=='pass'))reasons.push('Required quality gate did not pass');
  if(projection && requiredGates(projection.context).some(gate=>!projection.gates.some(row=>row.gate===gate && row.required===true && row.status==='pass')))reasons.push('Required quality gate is missing');
  if(run.conclusion!=='success')reasons.push('CI did not conclude successfully');
  return {phase:reasons.length?'incomplete':pr.state==='closed'?'historical':'passed',reasons};
}

export async function resolvePr(input,{api=githubJson,load=loadPrArtifact}={}) {
  const identity=await currentPrRun(input,api),{pr,run}=identity;
  let projection=null,certification=null;const jobs={},errors=[];
  if(run.status==='completed'){
    const actual=await paginate(api,prefix+'/actions/runs/'+run.id+'/attempts/'+run.run_attempt+'/jobs','jobs');
    for(const [id,name] of Object.entries(jobNames)){
      const matches=actual.filter(item=>item.name===name);
      if(matches.length===1){const job=matches[0];ensure(job.run_id===run.id && job.run_attempt===run.run_attempt,'Wrong exact-attempt PR job');jobs[id]=job.status==='completed'?job.conclusion:'pending';}
      else jobs[id]='missing';
    }
    const artifacts=await paginate(api,prefix+'/actions/runs/'+run.id+'/artifacts','artifacts');
    for(const kind of ['quality-comment','certification']){
      const name=kind+'-'+run.id+'-'+run.run_attempt,matches=artifacts.filter(item=>item.name===name);
      if(matches.length!==1){errors.push(kind==='quality-comment'?'Quality report is missing or ambiguous':'Final certification is missing or ambiguous');continue;}
      try {
        const value=await load(matches[0],run,name,{api});
        const context=kind==='quality-comment'?value.context:value.context;validateContext(context);
        ensure(context.kind==='hosted' && context.repository===loadPolicy().repository && context.repository_id===identity.repo.id &&
          context.head_repository_id===pr.head.repo.id && context.run_id===run.id && context.run_attempt===run.run_attempt &&
          context.event==='pull_request' && context.source_sha===run.head_sha && context.workflow_id===identity.workflow.id &&
          context.workflow_path==='.github/workflows/ci.yml' && context.branch===pr.head.ref,'PR evidence identity mismatch');
        if(pr.state==='open' && run.head_sha===pr.head.sha)ensure(typeof pr.merge_commit_sha==='string' && SHA.test(pr.merge_commit_sha) && context.tested_sha===pr.merge_commit_sha,'PR tested merge is stale');
        if(kind==='quality-comment')projection=value;else certification=value;
      }catch(error){errors.push(kind+' construction/validation failed: '+error.message);}
    }
    if(projection && certification){
      const withoutJob=context=>{const{job_id,...rest}=context;return rest;};
      if(canonicalDigest(withoutJob(projection.context))!==canonicalDigest(withoutJob(certification.context))){certification=null;errors.push('Report/final certification context differs');}
    }
  }
  return {...identity,projection,certification,jobs,...assessPrEvidence({pr,run,projection,certification,jobs,errors})};
}

export function ownedComments(comments) {
  return comments.filter(item=>Number.isSafeInteger(item.id) && item.user?.id===botId && item.user.type==='Bot' &&
    typeof item.body==='string' && item.body.startsWith(marker)).sort((a,b)=>a.id-b.id);
}

function fingerprint(evidence){return canonicalDigest({pr:evidence.pr.number,head:evidence.pr.head.sha,state:evidence.pr.state,
  run:evidence.run.id,attempt:evidence.run.run_attempt,status:evidence.run.status,conclusion:evidence.run.conclusion});}

export async function deliverPr(input,{api=githubJson,load=loadPrArtifact}={}) {
  api=deliveryTransport(api);
  let evidence,markdown='';
  try{
    for(let reconciliation=0;reconciliation<3;reconciliation++){
      evidence=await resolvePr(input,{api,load});
      markdown=renderPrReport(evidence);
      const metadata={schema_version:1,pr:evidence.pr.number,head:evidence.pr.head.sha,tested:evidence.projection?.context.tested_sha??null,
        run_id:evidence.run.id,run_number:evidence.run.run_number,run_attempt:evidence.run.run_attempt,phase:evidence.phase,report_sha256:digest(markdown)};
      const body=markdown+'\n<!-- rustcorder-quality-state:'+Buffer.from(JSON.stringify(metadata)).toString('base64')+' -->';
      const comments=()=>paginate(api,prefix+'/issues/'+input.pr_number+'/comments',null);
      let owned=ownedComments(await comments());
      const fresh=await currentPrRun(input,api);
      if(fingerprint({...evidence,...fresh})!==fingerprint(evidence))continue;
      if(owned.length){
        if(owned[0].body!==body)await api(prefix+'/issues/comments/'+owned[0].id,{method:'PATCH',body:{body}});
      }else{
        try{const created=await api(prefix+'/issues/'+input.pr_number+'/comments',{method:'POST',body:{body}});ensure(ownedComments([created]).length===1,'Unexpected comment author identity');}
        catch(error){owned=ownedComments(await comments());if(!owned.length)throw error;await api(prefix+'/issues/comments/'+owned[0].id,{method:'PATCH',body:{body}});}
      }
      owned=ownedComments(await comments());
      for(const duplicate of owned.slice(1))await api(prefix+'/issues/comments/'+duplicate.id,{method:'PATCH',body:{body:'Superseded CI quality report. See the current bot report in this PR.'}});
      const after=await currentPrRun(input,api);
      if(fingerprint({...evidence,...after})===fingerprint(evidence))return {outcome:evidence.pr.state==='closed'?'closed':evidence.phase==='superseded'?'superseded':'delivered',markdown,phase:evidence.phase,run_id:evidence.run.id,run_attempt:evidence.run.run_attempt};
    }
    const owned=ownedComments(await paginate(api,prefix+'/issues/'+input.pr_number+'/comments',null));
    const pending=marker+'\nCI evidence changed while reporting. Latest result is pending; use the CI run for current evidence.';
    if(owned.length)await api(prefix+'/issues/comments/'+owned[0].id,{method:'PATCH',body:{body:pending}});
    return {outcome:'superseded',markdown:pending,phase:'pending'};
  }catch(error){
    const forbidden=/\((?:401|403)\)/.test(error.message);
    return {outcome:forbidden?'forbidden':'service-failed',markdown:markdown||'CI report resolution failed. Inspect the upstream CI run.',reason:error.message};
  }
}

function deliveryTransport(transport) {
  return async(endpoint,options={})=>{
    for(let attempt=0;attempt<3;attempt++){
      try{return await transport(endpoint,options);}
      catch(error){
        if((options.method??'GET')==='POST' || attempt===2 || !/\(5[0-9]{2}\)|timeout|ECONNRESET|fetch failed/i.test(error.message))throw error;
        await delay(250*(attempt+1));
      }
    }
  };
}

export async function trustedReporter(env=process.env,api=githubJson,readGit=git) {
  ensure(env.GITHUB_ACTIONS==='true' && env.GITHUB_REPOSITORY===loadPolicy().repository && env.GITHUB_REF==='refs/heads/main' &&
    env.GITHUB_WORKFLOW_REF===loadPolicy().repository+'/.github/workflows/quality-comment.yml@refs/heads/main' &&
    env.GITHUB_EVENT_NAME==='workflow_run' && SHA.test(env.GITHUB_WORKFLOW_SHA) && readGit(['rev-parse','HEAD'])===env.GITHUB_WORKFLOW_SHA &&
    readGit(['status','--porcelain']).length===0,'Reporter must execute clean trusted main');
  const run=await api(prefix+'/actions/runs/'+Number(env.GITHUB_RUN_ID)),workflow=await api(prefix+'/actions/workflows/quality-comment.yml');
  ensure(run.id===Number(env.GITHUB_RUN_ID) && run.run_attempt===Number(env.GITHUB_RUN_ATTEMPT) && run.head_sha===env.GITHUB_WORKFLOW_SHA &&
    run.head_branch==='main' && run.event==='workflow_run' && run.status==='in_progress' && run.repository?.id===Number(env.GITHUB_REPOSITORY_ID) &&
    run.repository.full_name===loadPolicy().repository && run.head_repository?.id===run.repository.id && run.workflow_id===workflow.id &&
    workflow.path==='.github/workflows/quality-comment.yml' && workflow.state==='active' && run.path?.split('@')[0]===workflow.path,
    'Untrusted reporter control provenance');
}

export async function main(argv=process.argv.slice(2),env=process.env) {
  const[command,...args]=argv,options=cliOptions(args);ensure(['resolve','deliver'].includes(command),'Unknown PR reporter command');
  for(const key of Object.keys(options))ensure(key==='out','Unsupported reporter option');
  await trustedReporter(env);
  const event=jsonFile(env.GITHUB_EVENT_PATH),id=event.workflow_run?.id;counter(id,'upstream CI run',true);
  const root=path.resolve(repoRoot,options.out??'.build/pr-delivery'),relative=path.relative(path.join(repoRoot,'.build'),root);
  ensure(relative && !relative.startsWith('..') && !path.isAbsolute(relative),'Reporter output must be under .build');mkdirSync(root,{recursive:true});
  if(command==='resolve'){
    const run=await githubJson(prefix+'/actions/runs/'+id);
    const values=[];
    const hints=run.event==='pull_request'?(run.pull_requests?.length?run.pull_requests:await paginate(githubJson,prefix+'/commits/'+run.head_sha+'/pulls',null)):[];
    for(const hint of hints){
      try{const evidence=await currentPrRun({run_id:id,pr_number:hint.number},githubJson);values.push(evidence.pr.number);}catch(error){console.error('PR association refused: '+error.message);}
    }
    const prs=[...new Set(values)];ensure(prs.length<=20,'PR population exceeds bound');
    writeJson(path.join(root,'resolution.json'),{run_id:id,prs});
    if(env.GITHUB_OUTPUT)appendFileSync(env.GITHUB_OUTPUT,'prs='+JSON.stringify(prs)+'\nhas_prs='+(prs.length>0)+'\n');
    return {prs};
  }
  const number=Number(env.PR_NUMBER);counter(number,'delivery PR',true);
  const result=await deliverPr({run_id:id,pr_number:number});writeFileSync(path.join(root,'report.md'),result.markdown);writeJson(path.join(root,'delivery.json'),result);
  if(env.GITHUB_STEP_SUMMARY)appendFileSync(env.GITHUB_STEP_SUMMARY,result.markdown+'\n\nComment delivery: '+result.outcome+'\n');
  ensure(!['service-failed'].includes(result.outcome),'PR report delivery failed; readable fallback retained');return result;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)main().catch(error=>{console.error(error.message);process.exitCode=2;});
