import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { rustMutationEnvironment } from '../run-mutation.mjs';

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

test('hosted scratch keeps observed MSVC tracking paths below MAX_PATH', () => {
  const env = { GITHUB_ACTIONS: 'true', TEMP: 'C:\\Users\\runneradmin\\AppData\\Local\\Temp', TMP: 'C:\\Users\\runneradmin\\AppData\\Local\\Temp', marker: 'preserved' };
  const original = { ...env };
  const child = rustMutationEnvironment(env, 'D:\\a\\rustcorder\\rustcorder');
  const suffix = '\\cargo-mutants-rustcorder-xqsyOx.tmp\\target\\x86_64-pc-windows-msvc\\debug\\build\\whisper-rs-sys-89e31c3d5468ae04\\out\\build\\CMakeFiles\\CMakeScratch\\TryCompile-57rwja\\cmTC_96eaf.dir\\Debug\\cmTC_96eaf.tlog\\link-cvtres.write.1.tlog';
  assert.ok((env.TEMP + suffix).length >= 260, 'Fixture must retain the observed failing path length');
  assert.ok((child.TEMP + suffix).length < 260, 'Native tracking path still exceeds MAX_PATH');
  assert.equal(child.TEMP, 'D:\\a\\rustcorder\\rustcorder\\.build\\t');
  assert.equal(child.TMP, child.TEMP);
  assert.equal(child.marker, env.marker);
  assert.deepEqual(env, original, 'Parent process environment changed');
});

test('local mutation keeps its existing temp settings and long hosted checkouts fail clearly', () => {
  const env = { TEMP: 'C:\\local', TMP: 'C:\\local' };
  assert.deepEqual(rustMutationEnvironment(env, 'C:\\a-long-local-checkout'), env);
  assert.throws(() => rustMutationEnvironment({ GITHUB_ACTIONS: 'true' }, 'C:\\a\\very-long-hosted-checkout-location'), /short.*checkout|checkout.*short/i);
});
