import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as release from '../release.mjs';
import { gitFixture } from './git-fixture.mjs';

const manifest = '[package]\nname = "rustcorder"\nversion = "0.1.0" # keep comment\nedition = "2024"\npublish = false\n\n[dependencies]\nserde = "1.0"\n';
const lock = 'version = 4\n\n[[package]]\nname = "rustcorder"\nversion = "0.1.0"\ndependencies = ["serde"]\n\n[[package]]\nname = "serde"\nversion = "1.0.229"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "fixture"\n';

test('Angular linked headings insert and extract without changing published history', () => {
  const old = '# Changelog\r\n\r\n## 0.1.0 - 2026-11-01\r\n\r\nPublished bytes.\r\n';
  const notes = '# [0.2.0](https://github.com/fixture/repo/compare/v0.1.0...v0.2.0) (2026-11-14)\n\n### Features\n\n* New behavior\n';
  const output = release.preparedChangelog(old, '0.2.0', '2026-11-14', notes);
  assert.ok(output.endsWith(old.slice(old.indexOf('## 0.1.0'))));
  assert.ok(output.includes('# [0.2.0]'));
  assert.equal(release.releaseEntry(output, '0.2.0').replaceAll('\r\n', '\n'), notes.trim());
  assert.equal(release.releaseEntry(output, '0.1.0'), 'Published bytes.');
  assert.throws(() => release.preparedChangelog(output, '0.2.0', '2026-11-14', notes), /already|duplicate/i);
  assert.throws(() => release.preparedChangelog(old, '0.2.0', '2026-11-15', notes), /date|identity/i);
  assert.throws(() => release.releaseEntry(output + '\r\n' + notes, '0.2.0'), /ambiguous|duplicate/i);
});

for (const eol of ['\n', '\r\n']) test('version editing preserves every other byte with ' + JSON.stringify(eol), () => {
  const originalManifest = manifest.replaceAll('\n', eol), originalLock = lock.replaceAll('\n', eol);
  const result = release.editVersionFiles(Buffer.from(originalManifest), Buffer.from(originalLock), '0.2.0');
  assert.equal(result.manifest.toString(), originalManifest.replace('version = "0.1.0"', 'version = "0.2.0"'));
  assert.equal(result.lock.toString(), originalLock.replace('version = "0.1.0"', 'version = "0.2.0"'));
  assert.equal(result.previous_version, '0.1.0');
});
for (const [label, a, b] of [
  ['inherited', manifest.replace('version = "0.1.0" # keep comment', 'version.workspace = true'), lock],
  ['duplicate manifest version', manifest.replace('edition', 'version = "0.1.0"\nedition'), lock],
  ['different lock root', manifest, lock.replace('version = "0.1.0"', 'version = "0.2.0"')],
  ['ambiguous source-less root', manifest, lock + '\n[[package]]\nname = "rustcorder"\nversion = "0.1.0"\n'],
  ['unsupported lock version', manifest, lock.replace('version = 4', 'version = 3')],
]) test('refuses unsupported root version shape: ' + label, () => {
  assert.throws(() => release.editVersionFiles(Buffer.from(a), Buffer.from(b), '0.2.0'));
});
test('version editing cannot downgrade or alter non-root dependencies', () => {
  assert.throws(() => release.editVersionFiles(Buffer.from(manifest), Buffer.from(lock), '0.0.9'));
  const result = release.editVersionFiles(Buffer.from(manifest), Buffer.from(lock), '0.1.0');
  assert.equal(result.manifest.toString(), manifest);
  assert.equal(result.lock.toString(), lock);
});
test('changelog insertion is dated, linked and never duplicates an existing version', () => {
  const source = '# Changelog\r\n\r\nExisting introduction.\r\n';
  const result = release.preparedChangelog(source, '0.2.0', '2026-11-05', 'Useful feature.\n\nSee [guide](docs/ci-quality-release-plan.md).');
  assert.ok(result.includes('## 0.2.0 - 2026-11-05\r\n'));
  assert.ok(result.includes('Useful feature.\r\n'));
  assert.ok(result.startsWith(source));
  assert.throws(() => release.preparedChangelog(result, '0.2.0', '2026-11-05', 'Again'));
  assert.throws(() => release.preparedChangelog(source, '0.2.0', '2026-02-30', 'Invalid date'));
});
function metadata(root, version) {
  return { packages: [{ id: root, name: 'rustcorder', version, source: null },
    { id: 'opaque-dependency#42', name: 'serde', version: '1.0.229', source: 'registry+fixture' }],
  workspace_members: [root], workspace_default_members: [root],
  resolve: { root, nodes: [{ id: root, dependencies: ['opaque-dependency#42'] }, { id: 'opaque-dependency#42', dependencies: [] }] } };
}
test('Cargo IDs are opaque and only the exact root identity/version may change', () => {
  const before = metadata('opaque-root-before#abc', '0.1.0');
  const after = metadata('entirely-different-root-id', '0.2.0');
  assert.ok(release.verifyMetadataGraph(before, after, '0.1.0', '0.2.0'));
  after.packages[1].version = '1.0.230';
  assert.throws(() => release.verifyMetadataGraph(before, after, '0.1.0', '0.2.0'));
});
test('preparation requires explicit completion and bootstrap confirmation', () => {
  const p = { state: 'bootstrap', version: '0.1.0' };
  assert.throws(() => release.confirmPreparation(p, { completion: false, bootstrap: true }));
  assert.throws(() => release.confirmPreparation(p, { completion: true, bootstrap: false }));
  assert.ok(release.confirmPreparation(p, { completion: true, bootstrap: true }));
  assert.throws(() => release.confirmPreparation({ ...p, state: 'no-release' }, { completion: true, bootstrap: true }));
});

async function preparationInput(t) {
  const repo = gitFixture(t), first = repo.commit('chore: initial state');
  const source = repo.commit('feat: validated export', [first.sha]);
  const context = JSON.parse(readFileSync(new URL('fixtures/context.json', import.meta.url), 'utf8'));
  Object.assign(context, { source_sha: source.sha, tested_sha: source.sha });
  const proposal = await release.createProposal({ cwd: repo.root, source_sha: source.sha, context, date: '2026-11-05',
    published: [{ tag_name: 'v0.1.0', tag_object: repo.tag('v0.1.0', first), target_sha: first.sha, published: true }] });
  const args = { cwd: repo.root, proposal, reviewed_sha256: proposal.proposal_sha256,
    confirmation: { completion: true }, date: '2026-11-05',
    control: { actor: 'fixture-owner', run_id: 404, run_attempt: 1, source_sha: 'a'.repeat(40), workflow_id: 405 },
    metadata: directory => metadata('opaque-root#' + release.manifestVersion(readFileSync(path.join(directory, 'Cargo.toml'), 'utf8')),
      release.manifestVersion(readFileSync(path.join(directory, 'Cargo.toml'), 'utf8'))) };
  return { repo, source, args };
}

test('isolated preparation emits exact tree/patch while source/workspace/refs remain untouched', async t => {
  const { repo, source, args } = await preparationInput(t);
  const workspaceManifest = readFileSync(new URL('../../../Cargo.toml', import.meta.url));
  const oldManifest = repo.git(['show', source.sha + ':Cargo.toml']);
  const result = await release.prepareProposal(args);
  assert.equal(result.manifest.version, '0.2.0');
  assert.equal(result.manifest.source_sha, source.sha);
  assert.equal(result.manifest.confirmation.completion, true);
  assert.ok(result.patch.toString().includes('version = "0.2.0"'));
  assert.equal(repo.git(['show', source.sha + ':Cargo.toml']), oldManifest);
  assert.equal(repo.git(['for-each-ref']), '');
  assert.ok(readFileSync(new URL('../../../Cargo.toml', import.meta.url)).equals(workspaceManifest));
  const env = { ...process.env, GIT_OBJECT_DIRECTORY: path.join(result.scratch, 'objects'),
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(repo.root, 'objects') };
  const changed = execFileSync('git', ['diff-tree', '--no-commit-id', '-r', '--name-only', source.sha, result.manifest.expected_tree],
    { cwd: repo.root, env, encoding: 'utf8' }).trim().split('\n');
  assert.deepEqual(changed.sort(), ['Cargo.lock', 'Cargo.toml', 'CHANGELOG.md'].sort());
  assert.equal(result.manifest.patch_sha256, (await import('../gates.mjs')).digest(result.patch));
});

test('automatic preparation binds source authority, exact four-path tree and continuation instructions', async t => {
  const { args, repo, source } = await preparationInput(t);
  const context = args.proposal.context;
  const policy = { schema_version: 1, automation_enabled: true, initial_version: null };
  const automatic_authority = { policy, source_sha: source.sha, source_ci: context, complete: true,
    pr: { number: 7, merged: true, merge_commit_sha: source.sha, base: { ref: 'release', repo: { id: context.repository_id } },
      head: { ref: 'develop', repo: { id: context.repository_id } } }, commit_date: '2026-11-05T12:00:00Z',
    quality_snapshot: '# Quality metrics\n\nSynthetic preparation baseline.\n',
    artifacts: Object.fromEntries(['quality', 'certification', 'package'].map((kind, index) => [kind, { id: 500 + index, api_digest: 'sha256:' + 'a'.repeat(64) }])) };
  const result = await release.prepareProposal({ ...args, confirmation: undefined, automatic_authority });
  assert.equal(result.manifest.schema_version, 2);
  assert.equal(result.manifest.kind, 'automatic-preparation');
  assert.equal(result.manifest.confirmation, undefined);
  assert.deepEqual([...result.manifest.permitted_paths].sort(), ['Cargo.toml', 'Cargo.lock', 'CHANGELOG.md', 'docs/quality-metrics.md'].sort());
  assert.equal(release.validateAutomaticPreparation(result.manifest), result.manifest);
  const payload = JSON.parse(readFileSync(path.join(result.output, 'prepared-files.json')));
  assert.equal(Buffer.from(payload['docs/quality-metrics.md'].content, 'base64').toString(), automatic_authority.quality_snapshot);
  assert.ok(!readFileSync(path.join(result.output, 'apply-instructions.md'), 'utf8').includes('push it yourself'));
  assert.equal(repo.git(['for-each-ref']), '');
});

test('changed reviewed digest and metadata graph cannot produce a preparation', async t => {
  const { args } = await preparationInput(t);
  await assert.rejects(() => release.prepareProposal({ ...args, reviewed_sha256: '0'.repeat(64) }), /digest/i);
  let calls = 0;
  const drift = directory => {
    const value = args.metadata(directory);
    if (++calls === 2) value.packages[1].version = '1.0.230';
    return value;
  };
  await assert.rejects(() => release.prepareProposal({ ...args, metadata: drift }), /graph drift/i);
});

test('exact final candidate requires the prepared tree and one source parent', async t => {
  const { args, source } = await preparationInput(t);
  const { manifest } = await release.prepareProposal(args);
  const candidate = { sha: 'f'.repeat(40), tree_sha: manifest.expected_tree, parents: [source.sha], version: manifest.version };
  assert.ok(release.verifyCandidate(manifest, candidate));
  for (const change of [
    { tree_sha: 'e'.repeat(40) }, { parents: [] }, { parents: [source.sha, source.sha] },
    { parents: ['e'.repeat(40)] }, { version: '9.9.9' },
  ]) assert.throws(() => release.verifyCandidate(manifest, { ...candidate, ...change }));
});

test('only the exact authenticated unpublished entry is replaced; published bytes remain intact',()=>{
  assert.equal(typeof release.reconcileUnpublishedChangelog,'function');
  const old='## 0.1.0 - 2026-11-01\n\nPublished history.\n';
  const notes='# [0.2.0](https://github.com/example/repo/compare/v0.1.0...v0.2.0) (2026-11-14)\n\n### Features\n\n* Existing feature\n';
  const text='# Changelog\n\n'+notes+'\n'+old;
  const row={source_sha:'a'.repeat(40),version:'0.2.0',date:'2026-11-14',notes};
  const result=release.reconcileUnpublishedChangelog(text,[row]);
  assert.ok(result.endsWith(old));assert.ok(!result.includes('Existing feature'));
  assert.throws(()=>release.reconcileUnpublishedChangelog(text.replace('Existing feature','Edited by a real PR'),[row]),/changed|conflict/i);
  assert.throws(()=>release.reconcileUnpublishedChangelog(text,[{...row,version:'0.1.0'}]),/changed|conflict/i);
});

test('authenticated metadata with breaking notes is excluded while every real unpublished commit remains',async t=>{
  const {repo,args,source}=await preparationInput(t);
  const generated=repo.commit('chore(release): 0.2.0\n\nBREAKING CHANGE: copied release notes',[source.sha]);
  const newer=repo.commit('fix: new real correction',[generated.sha]);
  const context={...args.proposal.context,source_sha:newer.sha,tested_sha:newer.sha};
  const raw=await release.createProposal({cwd:repo.root,source_sha:newer.sha,context,published:[args.proposal.previous],automatic:true,date:'2026-11-14'});
  assert.equal(raw.version,'1.0.0');
  const row={source_sha:generated.sha,version:'0.2.0',date:'2026-11-14',notes:'Synthetic authenticated notes',preparation_sha256:'1'.repeat(64),intent_sha256:'2'.repeat(64)};
  const corrected=await release.createProposal({cwd:repo.root,source_sha:newer.sha,context,published:[args.proposal.previous],automatic:true,date:'2026-11-14',authenticated_metadata:[row]});
  assert.equal(corrected.version,'0.2.0');assert.deepEqual(corrected.commits.map(item=>item.sha),[source.sha,newer.sha]);
  assert.ok(corrected.notes.includes('new real correction'));
});
