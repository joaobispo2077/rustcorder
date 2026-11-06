import {spawn,spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync,lstatSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ensure,repoRoot,ciRoot,cliOptions,writeJson,libtestPopulation,nodePopulation,filesBelow} from './gates.mjs';
import {normalizeRustMutation,normalizeCiMutation} from './mutation.mjs';

export function mutationBudget(profile) {
  ensure(profile === 'light' || profile === 'full','Unknown mutation profile');
  return (profile === 'light' ? 20 : 60)*60*1000;
}

function owned(directory) {
  const full = path.resolve(directory), boundary = path.join(repoRoot,'.build')+path.sep;
  ensure(full.startsWith(boundary),'Mutation output escaped checkout .build');
  for (let parent=full;parent!==repoRoot;parent=path.dirname(parent)) {
    if (existsSync(parent)) ensure(!lstatSync(parent).isSymbolicLink(),'Redirected mutation output');
  }
  return full;
}

function child(program,args,directory,stem,deadline,env=process.env) {
  return new Promise(resolve => {
    let stdout='',stderr='',timed_out=false,error=null;
    let settled=false,cleanupTimer=null;
    const processChild = spawn(program,args,{cwd:repoRoot,env,windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    const finish=code=>{
      if(settled)return;settled=true;clearTimeout(timer);clearTimeout(cleanupTimer);
      writeFileSync(path.join(directory,stem+'.stdout.log'),stdout);
      writeFileSync(path.join(directory,stem+'.stderr.log'),stderr);
      resolve({exit_code:code,completed:!error&&!timed_out,timed_out,error,stdout,stderr});
    };
    const stop = () => {
      if(timed_out)return;
      timed_out=true;
      if (process.platform==='win32' && processChild.pid) {
        const killed=spawnSync('taskkill',['/PID',String(processChild.pid),'/T','/F'],{windowsHide:true,timeout:10000,stdio:'ignore'});
        if(killed.error||killed.status!==0) {
          error='Tree termination was unavailable; mutation execution is incomplete';
          spawnSync('pwsh',['-NoProfile','-Command','[Diagnostics.Process]::GetProcessById('+Number(processChild.pid)+').Kill($true)'],{windowsHide:true,timeout:10000,stdio:'ignore'});
          processChild.kill('SIGKILL');
        }
      }
      else if (processChild.pid) {try{process.kill(-processChild.pid,'SIGKILL');}catch{}}
      cleanupTimer=setTimeout(()=>{processChild.stdout.destroy();processChild.stderr.destroy();processChild.unref();finish(null);},5000);
    };
    const timer=setTimeout(stop,Math.max(1,deadline-Date.now()));
    for (const stream of ['stdout','stderr']) processChild[stream].on('data',bytes => {
      if (stream==='stdout') stdout+=bytes.toString('utf8'); else stderr+=bytes.toString('utf8');
      if (stdout.length+stderr.length>64*1024*1024) {error='Mutation child log exceeded bound';stop();}
    });
    processChild.on('error',e => {error=e.message;});
    processChild.on('close',finish);
  });
}

export async function runMutation(engine,profile,output) {
  const budget=mutationBudget(profile);
  ensure(engine==='rust'||engine==='ci','Unknown mutation engine');
  const directory=owned(path.join(output,'raw'));
  ensure(!existsSync(directory),'Mutation outputs must be fresh, never reused');
  mkdirSync(directory,{recursive:true});
  const started_at=new Date().toISOString(),deadline=Date.now()+budget;
  let baseline={completed:false,passed:0,failed:0,ignored:0},result={exit_code:null,completed:false},scope=[];
  let measurement;
  try {
    if (engine==='rust') {
      ensure(process.platform==='win32','Rust/native mutation requires Windows');
      const dev=['-NoProfile','-File',path.join(repoRoot,'scripts/dev.ps1')];
      const run=(args,stem)=>child('powershell.exe',[...dev,...args],directory,stem,deadline);
      const list=await run(['test','--locked','--offline','--lib','--','--list','--format','pretty'],'baseline-list');
      const tests=await run(['test','--locked','--offline','--lib','--','--format','pretty','--test-threads','1'],'baseline');
      ensure(list.completed&&list.exit_code===0&&tests.completed&&tests.exit_code===0,'Mutation baseline did not pass');
      const counts=libtestPopulation(list.stdout,tests.stdout);
      baseline={completed:true,passed:counts.passed,failed:counts.failed,ignored:counts.ignored};
      const config=path.join(ciRoot,'mutants-'+profile+'.toml');
      const generated=await run(['mutants','--config',config,'--list','--json'],'generated');
      ensure(generated.completed&&generated.exit_code===0,'Cargo mutant generation failed');
      const mutants=JSON.parse(generated.stdout);
      writeJson(path.join(directory,'mutants.json'),mutants);
      scope=[...new Set(mutants.map(x=>x.file))].sort();
      const expected=profile==='light'?['src/app.rs','src/settings.rs','src/transcription/live.rs','src/transcription/transcript.rs']:
        ['src/app.rs','src/models.rs','src/recording.rs','src/settings.rs','src/transcription/jobs.rs','src/transcription/live.rs','src/transcription/transcript.rs'];
      ensure(JSON.stringify(scope)===JSON.stringify(expected),'Generated Rust scope omitted a declared critical source');
      result=await run(['mutants','--config',config,'--baseline','run','--jobs','2','--output',directory],'engine');
      const outcomes=JSON.parse(readFileSync(path.join(directory,'mutants.out/outcomes.json'),'utf8'));
      measurement=normalizeRustMutation({mutants,outcomes,execution:{profile,scope,baseline,...result,
        fresh:true,cached:false,started_at,completed_at:new Date().toISOString()}});
    } else {
      const {mutationTestFiles}=await import('./stryker.config.mjs');
      const tests=await child(process.execPath,['--test','--test-reporter=tap',...mutationTestFiles(profile)],directory,'baseline',deadline);
      ensure(tests.completed&&tests.exit_code===0,'CI helper mutation baseline did not pass');
      baseline={completed:true,...nodePopulation(tests.stdout)};
      baseline={completed:true,passed:baseline.passed,failed:baseline.failed,ignored:0};
      scope=['scripts/ci/gates.mjs','scripts/ci/release.mjs',...(profile==='full'?['scripts/ci/mutation.mjs','scripts/ci/report.mjs']:[])].sort();
      result=await child(process.execPath,[path.join(ciRoot,'run-mutation.mjs'),'stryker-worker','--profile',profile,'--root',directory],directory,'engine',deadline);
      const report=JSON.parse(readFileSync(path.join(directory,'stryker-report.json'),'utf8'));
      const events=filesBelow(path.join(directory,'stryker-events'));
      const event=name=>{
        const found=events.filter(x=>path.basename(x).endsWith('-'+name+'.json'));
        ensure(found.length===1,'Missing/duplicate Stryker event '+name);
        return JSON.parse(readFileSync(found[0],'utf8'));
      };
      measurement=normalizeCiMutation({report,plan:event('onMutationTestingPlanReady'),dryRun:event('onDryRunCompleted'),
        execution:{profile,scope,baseline,...result,fresh:true,cached:false,started_at,completed_at:new Date().toISOString()}});
    }
  } catch(error) {
    measurement={status:'incomplete',reason:error.message,profile,score:null,detected:null,survived:null,viable:null};
  }
  const execution={profile,scope,baseline,exit_code:result.exit_code,completed:result.completed,
    timed_out:result.timed_out??false,fresh:true,cached:false,started_at,completed_at:new Date().toISOString()};
  writeJson(path.join(directory,'execution.json'),execution);
  writeJson(path.join(output,'mutation-result.json'),measurement);
  return measurement.status==='pass'?0:measurement.status==='fail'?1:2;
}

async function main() {
  const [command,...args]=process.argv.slice(2),options=cliOptions(args);
  if (command==='stryker-worker') {
    const {Stryker}=await import('@stryker-mutator/core');
    const {createStrykerConfig}=await import('./stryker.config.mjs');
    await new Stryker(createStrykerConfig(options.profile,{evidenceDirectory:options.root})).runMutationTest();
  } else process.exitCode=await runMutation(command,options.profile??'light',options.root);
}
if (process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error=>{console.error(error.message);process.exitCode=2;});
