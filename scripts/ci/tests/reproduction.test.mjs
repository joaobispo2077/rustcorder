import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const root=fileURLToPath(new URL('../../..',import.meta.url));
const document=readFileSync(path.join(root,'docs/development.md'),'utf8');
const section=document.split('## Reproducing CI locally')[1]??'';
const dispatcher=readFileSync(path.join(root,'scripts/ci/ci.ps1'),'utf8');
const policy=JSON.parse(readFileSync(path.join(root,'scripts/ci/policy.json'),'utf8'));
const pins=JSON.parse(readFileSync(path.join(root,'scripts/ci/toolchain.json'),'utf8'));

test('development guide provides local CI reproduction with evidence boundaries',()=>{
  assert.ok(section.trim(),'The development guide is missing local CI reproduction');
  for(const value of ['missing','failed','incomplete','local evidence cannot certify hosted readiness','14 days','simulated','native','no-overwrite']) {
    assert.ok(section.toLowerCase().includes(value),'Missing reproduction boundary: '+value);
  }
});

test('documented gate commands use real aliases and both declared mutation profiles',()=>{
  const declared=[...dispatcher.match(/\$taskNames = @\(([\s\S]*?)\)/)[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
  const commands=section.split('\n').filter(line=>line.startsWith('rtk proxy'));
  assert.ok(commands.length>=10,'Expected setup, quality, mutation, package, report and readiness examples');
  const documented=[];
  for(const command of commands){
    if(command.includes('scripts/ci/ci.ps1')) {
      assert.match(command,/^rtk proxy pwsh -NoProfile -File scripts\/ci\/ci\.ps1 /);
      const gate=command.match(/-Gate ([a-z-]+)/)?.[1];
      assert.ok(declared.includes(gate),'Unsupported documented gate: '+gate);documented.push(gate);
      assert.match(command,/-EvidenceDirectory \$(?:ciEvidence|fullEvidence)/);
    }
  }
  for(const gate of ['quality','mutation-rust','mutation-ci','package','report','readiness']) assert.ok(documented.includes(gate));
  assert.match(section,/-Profile light/);assert.match(section,/-Profile full/);
  assert.match(dispatcher,/ValidateSet\('light', 'full'\)/);
  assert.ok(section.includes('ci --prefix scripts/ci --omit=peer --ignore-scripts'));
  assert.ok(section.includes('v'+pins.node));
  assert.match(section,/Get-Command node\.exe/);
});

test('quality selection and adopted limits match the actual policy',()=>{
  const quality=[...dispatcher.match(/foreach \(\$taskQualityGate in @\(([\s\S]*?)\)/)[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
  const documented=[...(section.match(/Quality selection:\s*([\s\S]+?)\n\n/)?.[1]??'').matchAll(/`([^`]+)`/g)].map(x=>x[1]);
  assert.deepEqual(documented,quality);
  assert.ok(section.includes(quality.length+' gates'));
  for(const value of [policy.coverage.floor+'% coverage floor',policy.complexity.max+' by default',policy.complexity.exceptions.length+' legacy exceptions',policy.duplication.max_percent+'% duplication']) assert.ok(section.includes(value),'Policy drift: '+value);
  for(const name of ['light','full']){
    assert.ok(section.includes(policy.mutation[name].min_percent+'% '+name));
    assert.ok(section.includes(policy.mutation[name].timeout_minutes+' minutes'));
  }
  assert.ok(section.includes('90% cheap-unit'));
});

test('reproduction references resolve and hosted artifact retention agrees',()=>{
  for(const match of section.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)){
    const target=match[1].split('#')[0];
    if(!target||/^https?:/.test(target))continue;
    assert.ok(existsSync(path.resolve(root,'docs',target)),'Broken reproduction link: '+target);
  }
  for(const filename of ['ci.yml','mutation-full.yml']){
    assert.ok(section.includes('../.github/workflows/'+filename));
    const workflow=parse(readFileSync(path.join(root,'.github/workflows',filename),'utf8'));
    for(const job of Object.values(workflow.jobs))for(const step of job.steps??[]){
      if(step.uses?.startsWith('actions/upload-artifact@'))assert.equal(step.with['retention-days'],14);
    }
  }
});
