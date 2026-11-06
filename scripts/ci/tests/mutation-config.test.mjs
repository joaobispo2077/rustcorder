import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createStrykerConfig, criticalFunctions, mutationCommand, mutationRepoRoot, mutationTestFiles, namedMutationRanges } from '../stryker.config.mjs';

test('light mutates explicit critical decision ranges and full adds reporting', () => {
  const light = createStrykerConfig('light');
  const full = createStrykerConfig('full');
  for (const pattern of [...light.mutate, ...full.mutate]) {
    assert.match(pattern, /^scripts\/ci\/(?:gates|release|report|mutation)\.mjs:\d+:\d+-\d+:\d+$/, 'Unbounded source scope: ' + pattern);
  }
  assert.deepEqual([...new Set(light.mutate.map(x => x.split(':')[0]))], ['scripts/ci/gates.mjs', 'scripts/ci/release.mjs']);
  assert.deepEqual(full.mutate.slice(0, light.mutate.length), light.mutate);
  assert.deepEqual([...new Set(full.mutate.slice(light.mutate.length).map(x=>x.split(':')[0]))],['scripts/ci/report.mjs','scripts/ci/mutation.mjs']);
});

test('ranges follow named function syntax without widening to adjacent code', () => {
  const source = 'export function critical() {\n  return `braces } ${ { value: 1 }.value }`;\n}\nfunction unrelated() { return false; }\n';
  assert.deepEqual(namedMutationRanges(source, 'fixture.mjs', ['critical']), ['fixture.mjs:1:7-3:1']);
  assert.throws(() => namedMutationRanges(source, 'fixture.mjs', ['missing']), /critical function/);
  assert.throws(() => namedMutationRanges(source + 'function critical() {}', 'fixture.mjs', ['critical']));
  const light = createStrykerConfig('light');
  const names = Object.entries(criticalFunctions).filter(([name]) => ['gates.mjs','release.mjs'].includes(name)).flatMap(([, names]) => names);
  assert.equal(light.mutate.length, names.length);
  for (const pattern of light.mutate) {
    const [filename, range] = pattern.split(':');
    const firstLine = Number(range), sourceLines = readFileSync(path.join(mutationRepoRoot, filename), 'utf8').split(/\r?\n/);
    assert.match(sourceLines[firstLine - 1], /^(?:export )?(?:async )?function (?:validateContext|validateReceipt|promotion|commitPolicy|requiredGates|readiness|verifyArtifactMetadata|verifyApproval|confirmPreparation|verifyCandidate)\(/);
  }
});

test('command runner uses the declared exact Node population for each profile', () => {
  const light = mutationTestFiles('light'), full = mutationTestFiles('full');
  assert.deepEqual(light, ['contracts', 'context', 'promotion', 'workflows', 'release-decisions'].map(name => 'scripts/ci/tests/' + name + '.test.mjs'));
  assert.deepEqual(full, [...light, 'scripts/ci/tests/report.test.mjs','scripts/ci/tests/mutation.test.mjs']);
  for (const profile of ['light', 'full']) {
    const config = createStrykerConfig(profile);
    assert.equal(config.testRunner, 'command');
    assert.equal(config.commandRunner.command, mutationCommand(profile));
    assert.ok(config.commandRunner.command.includes('--test --test-reporter=dot '));
    assert.ok(!config.commandRunner.command.includes('*'));
    assert.ok(config.commandRunner.command.includes(process.execPath));
    assert.equal(config.testFiles, undefined, 'Stryker command runner rejects testFiles');
    assert.deepEqual(config.plugins, []);
  }
});

test('fresh isolated execution preserves raw plan/dry-run reports and custom acceptance', () => {
  const evidenceDirectory=path.join(mutationRepoRoot,'.build','config-fixture');
  const config=createStrykerConfig('full',{evidenceDirectory,dryRunOnly:true});
  assert.equal(config.incremental,false);
  assert.equal(config.inPlace,false);
  assert.equal(config.coverageAnalysis,'off');
  assert.equal(config.allowEmpty,false);
  assert.equal(config.thresholds.break,null,'Built-in timeout-as-detection scores cannot accept CI');
  assert.deepEqual(config.reporters,['json','event-recorder']);
  assert.equal(config.jsonReporter.fileName,path.join(evidenceDirectory,'stryker-report.json'));
  assert.equal(config.eventReporter.baseDir,path.join(evidenceDirectory,'stryker-events'));
  assert.equal(path.dirname(config.tempDirName),path.join(mutationRepoRoot,'.build'));
  assert.match(path.basename(config.tempDirName),/^ci-mutation-scratch-[a-f0-9-]+$/);
  assert.ok(!config.tempDirName.startsWith(evidenceDirectory+path.sep),'Scratch copies cannot contaminate raw evidence after timeout');
  assert.equal(config.cleanTempDir,'always');
  assert.equal(config.dryRunOnly,true);
  assert.equal(config.symlinkNodeModules,false,'Avoid walking Rust outputs and recursively visiting the sandbox');
  assert.match(config.buildCommand,/symlinkSync/);
  assert.ok(config.ignorePatterns.includes('/.build'));
});

test('invalid profiles, evidence roots and truthy dry-run strings fail closed', () => {
  for(const value of ['', 'LIGHT', 'unsupported', ['light'], null]) assert.throws(()=>createStrykerConfig(value));
  for(const evidenceDirectory of [mutationRepoRoot,path.join(mutationRepoRoot,'.build'),path.join(mutationRepoRoot,'.build','..','elsewhere'),null]) {
    assert.throws(()=>createStrykerConfig('light',{evidenceDirectory}));
  }
  assert.throws(()=>createStrykerConfig('light',{dryRunOnly:'false'}));
});

test('evidence path case follows the host filesystem without looping', () => {
  if(process.platform !== 'win32') {
    assert.throws(()=>createStrykerConfig('light',{evidenceDirectory:path.join(mutationRepoRoot,'.BUILD','case-fixture')}));
    return;
  }
  const evidence=path.join(mutationRepoRoot,'.build','case-fixture').replace(/^[A-Za-z]/,value=>value===value.toLowerCase()?value.toUpperCase():value.toLowerCase());
  const source='import {createStrykerConfig} from '+JSON.stringify(new URL('../stryker.config.mjs',import.meta.url).href)+';createStrykerConfig("light",{evidenceDirectory:process.argv[1]});';
  const child=spawnSync(process.execPath,['--input-type=module','-e',source,evidence],{timeout:5000,encoding:'utf8',windowsHide:true});
  assert.equal(child.status,0,child.error?.message??child.stderr);
});
