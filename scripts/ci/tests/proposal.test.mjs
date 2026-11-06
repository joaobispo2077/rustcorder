import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gitFixture } from './git-fixture.mjs';
import * as release from '../release.mjs';
import { digest } from '../gates.mjs';

const fixtureContext = JSON.parse(readFileSync(new URL('fixtures/context.json', import.meta.url), 'utf8'));
function input(repo, source, published = []) {
  return { cwd: repo.root, source_sha: source.sha, published,
    context: { ...fixtureContext, event: 'push', branch: 'release', source_sha: source.sha, tested_sha: source.sha } };
}
test('bootstrap is explicit and preview never creates release records', async t => {
  const repo = gitFixture(t), source = repo.commit('feat: first feature');
  const before = repo.git(['show', source.sha + ':Cargo.toml']);
  const proposal = await release.createProposal(input(repo, source));
  assert.equal(proposal.state, 'bootstrap');
  assert.equal(proposal.version, '0.1.0');
  assert.equal(proposal.completion_confirmation_required, true);
  assert.equal(repo.git(['show', source.sha + ':Cargo.toml']), before);
  assert.equal(repo.git(['for-each-ref']), '');
  assert.equal(proposal.proposal_sha256, release.proposalDigest(proposal));
});
test('all reachable merged feature commits are analyzed beyond merge subjects', async t => {
  const repo = gitFixture(t), previous = repo.commit('chore: initial state');
  const tag_object = repo.tag('v0.1.0', previous);
  const fix = repo.commit('fix: recover state', [previous.sha]);
  const feat = repo.commit('feat: export retained text', [previous.sha]);
  const merge = repo.commit('Merge feature export', [fix.sha, feat.sha]);
  const published = [{ tag_name: 'v0.1.0', tag_object, target_sha: previous.sha, published: true }];
  const result = await release.createProposal(input(repo, merge, published));
  assert.equal(result.state, 'release');
  assert.equal(result.version, '0.2.0');
  assert.equal(result.impact, 'minor');
  assert.ok(result.commits.some(x => x.sha === feat.sha));
  assert.ok(result.commits.some(x => x.sha === fix.sha));
  assert.ok(result.notes.includes('export retained text'));
});
test('ordinary changes and generated bookkeeping yield no release', async t => {
  const repo = gitFixture(t), previous = repo.commit('feat: initial behavior');
  const source = repo.commit('chore(release): prepare 0.1.0', [previous.sha]);
  const result = await release.createProposal(input(repo, source,
    [{ tag_name: 'v0.1.0', tag_object: repo.tag('v0.1.0', previous), target_sha: previous.sha, published: true }]));
  assert.equal(result.state, 'no-release');
  assert.equal(result.version, null);
});
test('incomplete history and unsynchronized release ancestry refuse proposals', async t => {
  const repo = gitFixture(t), a = repo.commit('feat: original');
  const unrelated = repo.commit('feat: unrelated root');
  const published = [{ tag_name: 'v0.1.0', tag_object: repo.tag('v0.1.0', a), target_sha: a.sha, published: true }];
  await assert.rejects(() => release.createProposal(input(repo, unrelated, published)), /ancestry/i);
  writeFileSync(path.join(repo.root, 'shallow'), a.sha + '\n');
  await assert.rejects(() => release.createProposal(input(repo, a)), /shallow|history/i);
});
test('a lightweight object cannot impersonate the prior annotated release', async t => {
  const repo = gitFixture(t), a = repo.commit('feat: first');
  await assert.rejects(() => release.createProposal(input(repo, a,
    [{ tag_name: 'v0.1.0', tag_object: a.sha, target_sha: a.sha, published: true }])), /annotated/i);
});
test('main preview preserves the published version without proposing another', async t => {
  const repo = gitFixture(t), a = repo.commit('feat: first');
  const args = input(repo, a); args.context.branch = 'main';
  const result = await release.createProposal(args);
  assert.equal(result.state, 'no-release');
  assert.equal(result.version, null);
  assert.equal(result.manifest_version, '0.1.0');
});
test('proposal identity changes when any bound source/evidence field changes', async t => {
  const repo = gitFixture(t), a = repo.commit('feat: first');
  const proposal = await release.createProposal(input(repo, a));
  const changed = { ...proposal, context: { ...proposal.context, run_attempt: 2 } };
  assert.notEqual(release.proposalDigest(changed), proposal.proposal_sha256);
  assert.equal(typeof digest(JSON.stringify(proposal)), 'string');
});

test('proposal notes retain configured ticket and existing document references', async t => {
  const repo = gitFixture(t);
  const source = repo.commit('feat(RCR-233): export words\n\nSee docs/export-words.md and docs/missing-file.md', [], {
    'docs/branching.md': '[RCR-233](https://tracker.example.invalid/RCR-233)\n',
    'docs/export-words.md': '# Export words\n',
  });
  const proposal = await release.createProposal(input(repo, source));
  assert.ok(proposal.notes.includes('[RCR-233](https://tracker.example.invalid/RCR-233)'));
  assert.ok(proposal.notes.includes('/docs/export-words.md)'));
  assert.ok(!proposal.notes.includes('/docs/missing-file.md)'));
});
