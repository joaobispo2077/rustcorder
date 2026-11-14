import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as release from '../release.mjs';
const fixture = JSON.parse(readFileSync(new URL('fixtures/semantic-release.json', import.meta.url), 'utf8'));

for (const [name, version, previous] of [['major', '1.0.0', '0.2.0'], ['minor', '1.1.0', '1.0.0'], ['patch', '1.1.1', '1.1.0'], ['initial', '0.1.0', null]]) {
  test('configured Angular snapshot: ' + name, async () => {
    assert.equal(typeof release.generateReleaseNotes, 'function', 'Pinned Angular notes generation is missing');
    const commits = fixture.commits.map(({ hash, message }) => ({ hash, message })), before = structuredClone(commits);
    const result = await release.generateReleaseNotes({ commits, version, previous, date: fixture.date,
      repository: 'joaobispo2077/rustcorder', source_sha: 'f'.repeat(40) });
    assert.equal(result.replaceAll('\r\n', '\n'), readFileSync(new URL('fixtures/release-notes/' + name + '.md', import.meta.url), 'utf8').replaceAll('\r\n', '\n'));
    assert.deepEqual(commits, before);
  });
}
test('notes cloning preserves existing breaking notes without a duplicate synthetic footer', () => {
  assert.equal(typeof release.notesInputs, 'function', 'Notes-only normalization is missing');
  for (const keyword of ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING', 'BREAKING-CHANGE']) {
    const input = [{ message: 'docs(release)!: new platform\n\n' + keyword + ': preserve migration instructions', hash: 'a'.repeat(40) }];
    const output = release.notesInputs(input);
    assert.equal(output[0].message, 'fix(release): new platform\n\n' + keyword + ': preserve migration instructions');
    assert.equal(input[0].message.startsWith('docs(release)!:'), true);
    assert.equal(output[0].hash, input[0].hash);
  }
});
