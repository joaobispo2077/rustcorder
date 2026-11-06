import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as release from '../release.mjs';
import { gitFixture } from './git-fixture.mjs';

const manifest = '[package]\nname = "rustcorder"\nversion = "0.1.0" # keep comment\nedition = "2024"\npublish = false\n\n[dependencies]\nserde = "1.0"\n';
const lock = 'version = 4\n\n[[package]]\nname = "rustcorder"\nversion = "0.1.0"\ndependencies = ["serde"]\n\n[[package]]\nname = "serde"\nversion = "1.0.229"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "fixture"\n';

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
  const proposal = await release.createProposal({ cwd: repo.root, source_sha: source.sha, context,
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
