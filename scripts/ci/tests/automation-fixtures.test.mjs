import test from 'node:test';
import assert from 'node:assert/strict';
import { apiFixture } from './git-fixture.mjs';

test('automatic release fixtures record exact API order and deny all unlisted network calls', async () => {
  const fixture = apiFixture({
    'GET /repos/fixture/project/commits/abc/pulls': [{ number: 7, merged: true }],
    'POST /repos/fixture/project/git/commits': call => ({ sha: 'a'.repeat(40), parents: call.body.parents }),
    'GET /repos/fixture/project/actions/runs/8/attempts/2': { id: 8, run_attempt: 2 },
  });
  assert.equal((await fixture.api('/repos/fixture/project/commits/abc/pulls'))[0].number, 7);
  assert.deepEqual(await fixture.api('/repos/fixture/project/git/commits', { method: 'POST', body: { parents: ['b'.repeat(40)] } }), { sha: 'a'.repeat(40), parents: ['b'.repeat(40)] });
  assert.equal((await fixture.api('/repos/fixture/project/actions/runs/8/attempts/2')).run_attempt, 2);
  await assert.rejects(() => fixture.api('/repos/joaobispo2077/rustcorder/releases', { method: 'POST' }), /Network forbidden/);
  assert.deepEqual(fixture.calls.map(call => call.method), ['GET', 'POST', 'GET', 'POST']);
});
