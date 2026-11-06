import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ci = fileURLToPath(new URL('../', import.meta.url));
const root = path.resolve(ci, '../..');
function json(name) {
  const filename = path.join(ci, name);
  assert.ok(existsSync(filename), `${name} must exist as a reviewed CI contract`);
  return JSON.parse(readFileSync(filename, 'utf8'));
}

test('CI tools are private, exact and separate from product versioning', () => {
  const pkg = json('package.json');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.version, undefined);
  for (const [name, version] of Object.entries(pkg.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must have an exact pin`);
  }
  assert.equal(pkg.devDependencies['@semantic-release/commit-analyzer'], '13.0.1');
  assert.equal(pkg.devDependencies['@semantic-release/release-notes-generator'], '14.1.0');
  assert.equal(pkg.devDependencies['semantic-release'], undefined);
  assert.equal(pkg.overrides['semantic-release'], '25.0.8');
});

test('toolchain pins include verified assets and immutable actions', () => {
  const pins = json('toolchain.json');
  assert.equal(pins.node, '24.22.2');
  assert.equal(pins.rust, '1.95.0-x86_64-pc-windows-msvc');
  for (const asset of Object.values(pins.assets)) {
    assert.match(asset.url, /^https:\/\//);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  }
  for (const action of Object.values(pins.actions)) {
    assert.match(action.sha, /^[a-f0-9]{40}$/);
  }
});

test('CI-generated dependencies and outcomes stay ignored; locks remain tracked', () => {
  const ignore = readFileSync(path.join(root, '.gitignore'), 'utf8');
  for (const value of ['node_modules/', '/reports/', '/mutants.out/', '/.stryker-tmp/']) {
    assert.ok(ignore.includes(value), `Missing generated-output ignore: ${value}`);
  }
  assert.ok(!/^\s*(?:Cargo|package)-?lock(?:\.json)?\s*$/m.test(ignore));
});

test('CI dependency overrides close the observed audit paths without waivers', () => {
  const pkg = json('package.json');
  assert.equal(pkg.devDependencies.yaml, '2.9.1');
  assert.deepEqual(pkg.overrides, {
    glob: '14.0.2',
    minimatch: '11.0.1',
    qs: '6.16.1',
    'semantic-release': '25.0.8',
  });
});

test('unused publishing core is absent while official analysis hooks work', async () => {
  assert.equal(existsSync(path.join(ci, 'node_modules/semantic-release')), false);
  const { analyzeCommits } = await import('@semantic-release/commit-analyzer');
  const { generateNotes } = await import('@semantic-release/release-notes-generator');
  const context = {
    cwd: ci,
    commits: [{ hash: 'b'.repeat(40), message: 'feat: local analysis fixture' }],
    logger: { log() {}, error() {} },
    options: { repositoryUrl: 'https://github.com/joaobispo2077/rustcorder' },
    lastRelease: { version: '0.1.0', gitTag: 'v0.1.0' },
    nextRelease: { version: '0.2.0', gitTag: 'v0.2.0' },
  };
  assert.equal(await analyzeCommits({ preset: 'conventionalcommits' }, context), 'minor');
  assert.match(await generateNotes({ preset: 'conventionalcommits' }, context), /local analysis fixture/);
});
