import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('Rust profiles select explicit critical code and preserve fresh baseline execution', () => {
  const light = readFileSync(new URL('../mutants-light.toml',import.meta.url),'utf8');
  const full = readFileSync(new URL('../mutants-full.toml',import.meta.url),'utf8');
  for (const config of [light,full]) {
    for (const file of ['src/app.rs','src/settings.rs','src/transcription/transcript.rs','src/transcription/live.rs']) assert.ok(config.includes('"'+file+'"'));
    assert.ok(config.includes('"--locked"') && config.includes('"--offline"') && config.includes('"--lib"'));
    assert.ok(config.includes('copy_target = true'));
    assert.ok(!/in_place|iterate|skip.*baseline|skip_calls\s*=/.test(config));
  }
  assert.ok(full.includes('src/recording.rs') && !light.includes('src/recording.rs'));
  assert.ok(light.includes('examine_re') && !full.includes('examine_re'));
});
