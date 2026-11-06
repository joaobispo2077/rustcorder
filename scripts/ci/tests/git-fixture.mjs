import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Bare object database: fixtures never create/check out a branch or touch real refs.
export function gitFixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rustcorder-ci-test-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'CI fixture', GIT_AUTHOR_EMAIL: 'ci@example.invalid',
    GIT_COMMITTER_NAME: 'CI fixture', GIT_COMMITTER_EMAIL: 'ci@example.invalid',
    GIT_AUTHOR_DATE: '2026-11-01T12:00:00Z', GIT_COMMITTER_DATE: '2026-11-01T12:00:00Z',
    GIT_INDEX_FILE: path.join(root, 'fixture-index') };
  const git = (args, input) => execFileSync('git', args, { cwd: root, env, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  git(['init', '--bare', '--quiet']);
  t.after(() => {
    const canonical = realpathSync(root);
    const parent = realpathSync(os.tmpdir());
    if (path.dirname(canonical) !== parent || !path.basename(canonical).startsWith('rustcorder-ci-test-')) throw new Error('Unsafe fixture cleanup');
    rmSync(canonical, { recursive: true });
  });
  const files = {
    'Cargo.toml': '[package]\nname = "rustcorder"\nversion = "0.1.0"\nedition = "2024"\npublish = false\n',
    'Cargo.lock': 'version = 4\n\n[[package]]\nname = "rustcorder"\nversion = "0.1.0"\n',
    'CHANGELOG.md': '# Changelog\n',
    'docs/ci-quality-release-plan.md': '# Release guidance\n',
    'src/lib.rs': 'pub fn fixture_marker() -> bool { true }\n',
  };
  function commit(message, parents = [], changes = {}) {
    Object.assign(files, changes);
    git(['read-tree', '--empty']);
    for (const [name, contents] of Object.entries(files)) {
      const blob = git(['hash-object', '-w', '--stdin'], contents);
      git(['update-index', '--add', '--cacheinfo', '100644,' + blob + ',' + name]);
    }
    const tree = git(['write-tree']);
    const sha = git(['commit-tree', tree, ...parents.flatMap(x => ['-p', x]), '-m', message]);
    return { sha, tree };
  }
  function tag(name, commit) {
    return git(['mktag'], 'object ' + commit.sha + '\ntype commit\ntag ' + name +
      '\ntagger CI fixture <ci@example.invalid> 1793534400 +0000\n\nSynthetic release fixture\n');
  }
  return { root, git, commit, tag, files };
}
