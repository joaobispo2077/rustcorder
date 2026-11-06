import test from 'node:test';
import assert from 'node:assert/strict';
import * as gates from '../gates.mjs';

for (const [head, base] of [['feature/RCR-123', 'develop'], ['feature/ci-gates', 'develop'], ['develop', 'release'], ['release', 'main']]) {
  test('permits ' + head + ' to ' + base, () => {
    assert.equal(gates.promotion({ event: 'pull_request', head, base, same_repository: true,
      published_sha: 'a'.repeat(40), head_sha: 'a'.repeat(40), published_tree: 'b'.repeat(40), tested_tree: 'b'.repeat(40), published_version:'0.1.0', tested_version:'0.1.0' }).accepted, true);
  });
}
for (const [head, base, same] of [['main', 'develop', true], ['feature/x', 'main', true],
  ['develop', 'release', false], ['release', 'main', false], ['feature/../../x', 'develop', true],
  ['feature/x;bad', 'develop', true], ['feature/', 'develop', true]]) {
  test('rejects promotion ' + head + ' to ' + base + ' same=' + same, () => {
    assert.throws(() => gates.promotion({ event: 'pull_request', head, base, same_repository: same }));
  });
}
test('feature fork may target develop; release promotion requires published exact tree', () => {
  assert.ok(gates.promotion({ event: 'pull_request', head: 'feature/x', base: 'develop', same_repository: false }).accepted);
  assert.throws(() => gates.promotion({ event: 'pull_request', head: 'release', base: 'main', same_repository: true }));
  assert.throws(() => gates.promotion({ event: 'pull_request', head: 'release', base: 'main', same_repository: true,
    published_sha: 'a'.repeat(40), head_sha: 'a'.repeat(40), published_tree: 'b'.repeat(40), tested_tree: 'c'.repeat(40) }));
});
test('new nonmerge commits require conventional intent', () => {
  assert.ok(gates.commitPolicy([{ message: 'feat(ui): keep cancel visible', parents: 1 }]));
  assert.ok(gates.commitPolicy([{ message: 'Merge release', parents: 2 }]));
  assert.throws(() => gates.commitPolicy([{ message: 'update things', parents: 1 }]));
  assert.throws(() => gates.commitPolicy([{ message: 'feat: ', parents: 1 }]));
});

test('main promotion retains the published product version', () => {
  assert.throws(() => gates.promotion({event:'pull_request',head:'release',base:'main',same_repository:true,
    published_sha:'a'.repeat(40),head_sha:'a'.repeat(40),published_tree:'b'.repeat(40),tested_tree:'b'.repeat(40),
    published_version:'0.1.0',tested_version:'0.2.0'}));
});

test('conventional one-character descriptions and multiline breaking bodies are valid', () => {
  assert.ok(gates.commitPolicy([{ message: 'fix: x', parents: 1 }]));
  assert.ok(gates.commitPolicy([{ message: 'feat: change protocol\n\nBREAKING CHANGE: old workers are incompatible', parents: 1 }]));
  assert.ok(gates.commitPolicy([{ message: 'Merge pull request #7\n\nFeature description', parents: 2 }]));
  assert.throws(() => gates.commitPolicy([{ message: 'fix: x\u0000bad', parents: 1 }]));
});
