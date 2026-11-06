import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync,readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gateMeasurement, assertPinnedBytes, digest,collectEvidence,writeJson,readiness } from '../gates.mjs';

test('collector uses the frozen candidate source inventory instead of trusted-main files', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rustcorder-collector-'));
  t.after(() => rmSync(root, { recursive: true }));
  mkdirSync(path.join(root, 'architecture'));
  writeFileSync(path.join(root, 'architecture/run.stdout.log'), '[]');
  const scope = { inventory: { all: ['src/new-candidate.rs'], executable: ['src/new-candidate.rs'], non_executable: [] } };
  const value = gateMeasurement('architecture', root, undefined, undefined, scope);
  assert.deepEqual(value.sources, scope.inventory.all);
});

test('public VAD provisioning requires exact pinned byte count and digest', () => {
  const bytes = Buffer.from('public model fixture');
  const pin = { bytes: bytes.length, sha256: digest(bytes) };
  assert.ok(assertPinnedBytes(bytes, pin));
  assert.throws(() => assertPinnedBytes(Buffer.from('substituted model'), pin));
  assert.throws(() => assertPinnedBytes(bytes, { ...pin, bytes: pin.bytes + 1 }));
});

test('collector rejects substituted attempts and changed or missing raw bytes', t=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'rustcorder-collector-'));
  t.after(()=>rmSync(root,{recursive:true}));
  const ctx=JSON.parse(readFileSync(new URL('fixtures/context.json',import.meta.url)));
  const directory=path.join(root,'format');mkdirSync(directory);
  const raw=path.join(directory,'run.log');writeFileSync(raw,'actual checker success');
  const receipt={schema_version:1,gate:'format',context:{...ctx,job_id:'rust'},status:'pass',applicable:true,required:true,
    completed:true,exit_code:0,duration_ms:10,started_at:'2026-11-05T12:00:00Z',completed_at:'2026-11-05T12:00:01Z',
    raw_outputs:[{path:'format/run.log',sha256:digest(readFileSync(raw))}],measurements:null,reason:null};
  const filename=path.join(directory,'gate.json');writeJson(filename,receipt);
  assert.equal(collectEvidence(root,ctx).receipts.length,1);
  receipt.context.run_attempt++;writeJson(filename,receipt);
  assert.equal(collectEvidence(root,ctx).errors.length,1);
  receipt.context.run_attempt--;writeJson(filename,receipt);writeFileSync(raw,'substituted');
  assert.equal(collectEvidence(root,ctx).errors.length,1);
  rmSync(raw);assert.equal(collectEvidence(root,ctx).errors.length,1);
});

test('a full mutation profile cannot satisfy ordinary light readiness',()=>{
  const ctx=JSON.parse(readFileSync(new URL('fixtures/context.json',import.meta.url)));
  const receipt={schema_version:1,gate:'mutation-ci',context:{...ctx,job_id:'mutation_ci'},status:'pass',applicable:true,required:true,
    completed:true,exit_code:0,duration_ms:10,started_at:'2026-11-05T12:00:00Z',completed_at:'2026-11-05T12:00:01Z',
    raw_outputs:[{path:'mutation-ci/run.log',sha256:'e'.repeat(64)}],measurements:{profile:'full'},reason:null};
  assert.ok(readiness(ctx,[receipt],{},true).reasons.some(x=>x.includes('light profile')));
});
