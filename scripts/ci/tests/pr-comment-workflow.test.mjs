import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {parse} from 'yaml';
import {workflowPolicy} from '../gates.mjs';
test('reporter resolves read-only and serializes comment writes per PR from trusted main',()=>{
  const file=new URL('../../../.github/workflows/quality-comment.yml',import.meta.url);
  assert.ok(existsSync(file),'Quality comment workflow is missing');
  const workflow=parse(readFileSync(file,'utf8'));assert.equal(workflowPolicy(workflow,'pr-report'),true);
  assert.deepEqual(workflow.on.workflow_run.types,['requested','in_progress','completed']);
  assert.equal(workflow.on.workflow_run.branches,undefined);
  assert.equal(workflow.jobs.resolve.permissions['pull-requests'],'read');
  assert.equal(workflow.jobs.comment.permissions['pull-requests'],'write');
  assert.match(workflow.jobs.comment.concurrency.group,/matrix.pr/);
  assert.equal(workflow.jobs.comment.concurrency['cancel-in-progress'],false);
  const text=JSON.stringify(workflow);assert.ok(!text.includes('secrets.') && !text.includes('RELEASE_WRITE_TOKEN'));
});
