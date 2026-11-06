import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, realpathSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { normalizeRustMutation, normalizeCiMutation } from './mutation.mjs';

export const ciRoot = fileURLToPath(new URL('./', import.meta.url));
export const repoRoot = path.resolve(ciRoot, '../..');
export const SHA = /^[a-f0-9]{40}$/;
export const SHA256 = /^[a-f0-9]{64}$/;
export const gateIds = new Set([
  'prerequisites', 'format', 'lint', 'build', 'unit', 'integration', 'ui',
  'coverage', 'complexity', 'deadcode', 'duplication', 'architecture',
  'dependencies', 'mutation-rust', 'mutation-ci', 'package', 'ci-support', 'workflow',
]);
const identityKeys = [
  'schema_version', 'kind', 'repository', 'repository_id', 'head_repository_id',
  'workflow_id', 'workflow_path', 'workflow_sha', 'event', 'branch', 'source_sha',
  'tested_sha', 'run_id', 'run_attempt', 'policy_sha256', 'toolchain_sha256',
];

export function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

export function object(value, name = 'value') {
  ensure(value !== null && typeof value === 'object' && !Array.isArray(value), name + ' must be an object');
  return value;
}

export function counter(value, name, positive = false) {
  ensure(Number.isSafeInteger(value) && value >= (positive ? 1 : 0), name + ' must be a ' + (positive ? 'positive' : 'nonnegative') + ' safe integer');
  return value;
}

export function textValue(value, name, max = 512) {
  ensure(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f]/.test(value), 'Invalid ' + name);
  return value;
}

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function assertPinnedBytes(bytes, pin) {
  counter(pin.bytes, 'pinned bytes', true);
  ensure(Buffer.isBuffer(bytes) && SHA256.test(pin.sha256) && bytes.length === pin.bytes && digest(bytes) === pin.sha256,
    'Pinned asset size/checksum mismatch');
  return true;
}

export async function boundedBytes(response, limit) {
  ensure(response.ok && response.body, 'Download failed: HTTP ' + response.status);
  const chunks = []; let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length; ensure(total <= limit, 'Download exceeded byte bound'); chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function provisionVad() {
  const pin = jsonFile(path.join(repoRoot, 'assets/silero-vad.json'));
  ensure(/^https:\/\/huggingface.co\/ggml-org\/whisper-vad\/resolve\/[a-f0-9]{40}\/[a-zA-Z0-9.-]+$/.test(pin.url), 'Unpinned public VAD URL');
  ensure(digest(readFileSync(containedFile(repoRoot, pin.license_file))) === pin.license_sha256, 'VAD license checksum mismatch');
  const models = path.join(repoRoot, 'models'); mkdirSync(models, { recursive: true });
  ensure(realpathSync(models) === path.join(realpathSync(repoRoot), 'models'), 'Redirected model destination');
  const destination = containedFile(models, safeRelativePath(pin.filename), { existing: false });
  if (existsSync(destination)) { assertPinnedBytes(readFileSync(containedFile(models, pin.filename)), pin); return; }
  const bytes = await boundedBytes(await fetch(pin.url, { signal: AbortSignal.timeout(60000) }), pin.bytes);
  assertPinnedBytes(bytes, pin);
  writeFileSync(destination, bytes, { flag: 'wx' });
}

export function jsonFile(filename, maxBytes = 16 * 1024 * 1024) {
  const bytes = readFileSync(filename);
  ensure(bytes.length <= maxBytes, 'JSON exceeds size limit: ' + filename);
  return JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
}

export function writeJson(filename, value) {
  mkdirSync(path.dirname(filename), { recursive: true });
  writeFileSync(filename, JSON.stringify(value, null, 2) + '\n');
}

export function safeRelativePath(value) {
  textValue(value, 'relative path', 1024);
  const normalized = value.replaceAll('\\', '/');
  ensure(!normalized.startsWith('/') && !/[<>:"|?*\x00-\x1f]/.test(normalized), 'Unsafe relative path');
  for (const part of normalized.split('/')) {
    ensure(part && part !== '.' && part !== '..' && !/[. ]$/.test(part), 'Unsafe relative segment');
    ensure(!/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part), 'Reserved Windows path');
  }
  return normalized;
}

export function containedFile(root, relative, { existing = true } = {}) {
  const safe = safeRelativePath(relative);
  const base = realpathSync(root);
  const target = path.resolve(base, safe);
  ensure(target.startsWith(base + path.sep), 'Path escaped evidence root');
  if (existing) ensure(realpathSync(target).startsWith(base + path.sep), 'Redirected path escaped evidence root');
  return target;
}

export function validateContext(ctx, expected = null) {
  object(ctx, 'context');
  ensure(ctx.schema_version === 1, 'Unsupported context schema');
  ensure(ctx.kind === 'hosted' || ctx.kind === 'local', 'Unknown execution kind');
  textValue(ctx.repository, 'repository');
  ensure(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(ctx.repository), 'Invalid repository');
  for (const key of ['source_sha', 'tested_sha', 'workflow_sha']) ensure(typeof ctx[key] === 'string' && SHA.test(ctx[key]), 'Invalid ' + key);
  for (const key of ['policy_sha256', 'toolchain_sha256']) ensure(typeof ctx[key] === 'string' && SHA256.test(ctx[key]), 'Invalid ' + key);
  textValue(ctx.branch, 'branch');
  textValue(ctx.job_id, 'job_id');
  ensure(/^[A-Za-z0-9_-]+$/.test(ctx.job_id), 'Invalid job identity');
  counter(ctx.run_attempt, 'run attempt', true);
  if (ctx.kind === 'hosted') {
    ensure(ctx.dirty === undefined || ctx.dirty === false, 'Hosted evidence cannot claim a dirty source checkout');
    for (const key of ['repository_id', 'head_repository_id', 'workflow_id', 'run_id']) counter(ctx[key], key, true);
    ensure(safeRelativePath(ctx.workflow_path).startsWith('.github/workflows/'), 'Invalid workflow path');
    ensure(['push', 'pull_request', 'workflow_dispatch', 'workflow_run', 'schedule'].includes(ctx.event), 'Unsupported hosted event');
  } else {
    ensure(typeof ctx.run_id === 'string' && ctx.run_id.startsWith('local-'), 'Invalid local run identity');
    ensure(ctx.event === 'local' && typeof ctx.dirty === 'boolean', 'Invalid local provenance');
  }
  if (expected) {
    for (const key of [...identityKeys, 'dirty']) ensure(ctx[key] === expected[key], 'Context mismatch: ' + key);
  }
  return ctx;
}

export function validatePolicy(policy) {
  object(policy, 'policy');
  ensure(policy.schema_version === 1, 'Unsupported policy schema');
  textValue(policy.repository, 'repository');
  object(policy.coverage, 'coverage policy');
  const floor = policy.coverage.floor;
  ensure(floor === null || (Number.isInteger(floor) && floor > 0 && floor <= 100), 'Invalid coverage floor');
  ensure(policy.complexity?.max === 10 && policy.duplication?.max_percent === 2, 'Invalid maintainability policy');
  ensure(policy.mutation?.light?.min_percent === 40 && policy.mutation?.full?.min_percent === 50, 'Invalid mutation floors');
  ensure(policy.mutation.light.timeout_minutes === 20 && policy.mutation.full.timeout_minutes === 60, 'Invalid mutation budgets');
  for (const list of [policy.exceptions, policy.complexity.exceptions, policy.dependencies.advisories]) {
    ensure(Array.isArray(list), 'Exceptions must be explicit arrays');
    const seen = new Set();
    for (const entry of list) {
      textValue(entry.reason, 'exception reason');
      textValue(entry.owner, 'exception owner');
      if (list === policy.complexity.exceptions) {
        safeRelativePath(entry.path); textValue(entry.symbol, 'exception symbol');
        counter(entry.ceiling, 'exception ceiling', true);
      } else textValue(entry.id, 'exception identity');
      if (entry.path) safeRelativePath(entry.path);
      const key = (entry.path ?? '') + ':' + (entry.symbol ?? entry.id);
      ensure(!seen.has(key.toLowerCase()), 'Duplicate exception identity');
      seen.add(key.toLowerCase());
      if (entry.ceiling !== undefined) counter(entry.ceiling, 'exception ceiling', true);
      if (entry.expires) ensure(/^\d{4}-\d{2}-\d{2}$/.test(entry.expires) && entry.expires >= new Date().toISOString().slice(0, 10), 'Expired exception');
    }
  }
  return policy;
}

export function validateReceipt(receipt, expected = null) {
  object(receipt, 'receipt');
  ensure(receipt.schema_version === 1 && gateIds.has(receipt.gate), 'Invalid gate receipt schema/identity');
  validateContext(receipt.context, expected);
  ensure(['pass', 'fail', 'incomplete', 'excluded', 'advisory'].includes(receipt.status), 'Unknown gate status');
  for (const key of ['required', 'applicable', 'completed']) ensure(typeof receipt[key] === 'boolean', 'Invalid receipt ' + key);
  counter(receipt.duration_ms, 'duration');
  const started = utcTime(receipt.started_at, 'start timestamp');
  const completed = utcTime(receipt.completed_at, 'completion timestamp');
  ensure(completed >= started, 'Completion preceded start');
  ensure(receipt.exit_code === null || Number.isInteger(receipt.exit_code), 'Invalid child exit');
  if (receipt.counts) for (const [key, value] of Object.entries(receipt.counts)) counter(value, key);
  if (receipt.required) ensure(receipt.applicable && !['excluded', 'advisory'].includes(receipt.status), 'Required gate cannot be excluded/advisory');
  if (receipt.status === 'pass') {
    ensure(receipt.completed, 'Unfinished gate cannot pass');
    ensure(receipt.exit_code === 0 || (receipt.gate === 'mutation-rust' && receipt.exit_code === 2), 'Failed child cannot pass');
    ensure(Array.isArray(receipt.raw_outputs) && receipt.raw_outputs.length > 0, 'Passing gate needs execution output');
    for (const output of receipt.raw_outputs) {
      safeRelativePath(output.path);
      ensure(typeof output.sha256 === 'string' && SHA256.test(output.sha256), 'Invalid raw-output hash');
    }
    if (receipt.gate === 'coverage') {
      counter(receipt.measurements?.covered, 'covered lines');
      counter(receipt.measurements?.total, 'total lines', true);
      ensure(receipt.measurements.covered <= receipt.measurements.total, 'Invalid coverage counts');
    }
  } else {
    textValue(receipt.reason, 'nonpassing reason', 4096);
  }
  return receipt;
}

export function utcTime(value, name) {
  ensure(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value), 'Invalid ' + name);
  const timestamp = Date.parse(value);
  ensure(Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19), 'Invalid ' + name);
  return timestamp;
}

export function loadPolicy() {
  return validatePolicy(jsonFile(path.join(ciRoot, 'policy.json')));
}

export function promotion(input) {
  if (input.event === 'pull_request') {
    const feature = /^feature\/(?:RCR-[1-9][0-9]*|[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(input.head);
    ensure((input.base === 'develop' && feature) ||
      (input.base === 'release' && input.head === 'develop' && input.same_repository) ||
      (input.base === 'main' && input.head === 'release' && input.same_repository), 'Forbidden promotion pair/origin');
    if (input.base === 'main') {
      ensure(typeof input.published_sha === 'string' && SHA.test(input.published_sha) && input.published_sha === input.head_sha, 'Main requires the published release commit');
      ensure(typeof input.published_tree === 'string' && SHA.test(input.published_tree) && input.published_tree === input.tested_tree, 'Main merge changes the published product tree');
      ensure(typeof input.published_version === 'string' && /^\d+\.\d+\.\d+$/.test(input.published_version) && input.published_version === input.tested_version, 'Main must retain the published product version');
    }
  } else if (input.event === 'push') {
    ensure(['develop', 'release', 'main'].includes(input.branch) ||
      /^feature\/(?:RCR-[1-9][0-9]*|[a-z0-9]+(?:-[a-z0-9]+)*)$/.test(input.branch), 'Unsupported push branch');
  } else ensure(input.event === 'local', 'Unsupported promotion event');
  return { accepted: true };
}

export function commitPolicy(commits) {
  ensure(Array.isArray(commits), 'Missing commit inventory');
  for (const commit of commits) {
    counter(commit.parents, 'commit parents');
    ensure(typeof commit.message === 'string' && commit.message.length > 0 && commit.message.length <= 65536 &&
      !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(commit.message), 'Invalid commit message');
    if (commit.parents >= 2) continue;
    ensure(/^(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([^\r\n()]+\))?!?: \S.*/.test(commit.message.split(/\r?\n/)[0]), 'Nonconventional commit: ' + commit.message.split(/\r?\n/)[0]);
  }
  return true;
}

function unique(values, label) {
  ensure(new Set(values).size === values.length, 'Duplicate ' + label);
  return values;
}

export function libtestPopulation(list, run, allowedIgnored = [], allowFiltered = false) {
  const names = unique([...list.matchAll(/^(.+): test\r?$/gm)].map(x => x[1]), 'listed test');
  counter(names.length, 'listed tests', true);
  const listTotals = [...list.matchAll(/^(\d+) tests?, (\d+) benchmarks?\r?$/gm)];
  ensure(listTotals.length === 1 && Number(listTotals[0][1]) === names.length && Number(listTotals[0][2]) === 0, 'Invalid test listing');
  const executed = [...run.matchAll(/^test (.+) \.\.\. (ok|FAILED|ignored)(?:, [^\r\n]+)?\r?$/gm)].map(x => ({ name: x[1], status: x[2] }));
  unique(executed.map(x => x.name), 'executed test');
  ensure(executed.length === names.length && executed.every(x => names.includes(x.name)), 'Listed/executed test identities differ');
  const summaries = [...run.matchAll(/^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out; finished in [^\r\n]+\r?$/gm)];
  ensure(summaries.length === 1, 'Missing or duplicate test execution summary');
  const summary = summaries[0];
  const passed = executed.filter(x => x.status === 'ok').length;
  const failed = executed.filter(x => x.status === 'FAILED').length;
  const ignored = executed.filter(x => x.status === 'ignored').map(x => x.name);
  ensure(Number(summary[2]) === passed && Number(summary[3]) === failed && Number(summary[4]) === ignored.length &&
    Number(summary[5]) === 0 && (allowFiltered || Number(summary[6]) === 0), 'Contradictory test summary');
  ensure(ignored.every(x => allowedIgnored.includes(x)), 'Unreviewed ignored test');
  ensure(failed === 0 && passed > 0 && summary[1] === 'ok', 'Required test population failed or ran no tests');
  return { listed: names.length, passed, failed, ignored: ignored.length, identities: names, ignored_identities: ignored };
}

export function nodePopulation(log) {
  const counts = {};
  for (const name of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...log.matchAll(new RegExp('^# ' + name + ' ([0-9]+)\\r?$', 'gm'))];
    ensure(matches.length === 1, 'Invalid Node test summary: ' + name);
    counts[name] = counter(Number(matches[0][1]), name);
  }
  ensure(counts.tests > 0 && counts.tests === counts.pass && counts.fail + counts.cancelled + counts.skipped + counts.todo === 0, 'Node baseline incomplete/failed');
  return { listed: counts.tests, passed: counts.pass, failed: 0, ignored: 0 };
}

export function rustFiles(root = repoRoot) {
  function walk(relative) {
    return readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap(entry => {
      ensure(!entry.isSymbolicLink(), 'Redirected source inventory');
      const name = relative + '/' + entry.name;
      return entry.isDirectory() ? walk(name) : entry.isFile() && name.endsWith('.rs') ? [name] : [];
    });
  }
  return walk('src').sort();
}

export function coverageMeasurement(raw, expectedFiles, root, floor) {
  ensure(raw.type === 'llvm.coverage.json.export' && raw.data?.length === 1 && Array.isArray(raw.data[0].files), 'Invalid LLVM export');
  counter(expectedFiles.length, 'coverage source population', true);
  const found = [];
  let covered = 0, total = 0;
  for (const file of raw.data[0].files) {
    const normalized = file.filename.replaceAll('\\', '/');
    const normalizedRoot = root.replaceAll('\\', '/').replace(/\/$/, '');
    const relative = normalized.toLowerCase().startsWith(normalizedRoot.toLowerCase() + '/') ? normalized.slice(normalizedRoot.length + 1) : normalized;
    if (!expectedFiles.includes(relative)) continue;
    found.push(relative);
    const lines = file.summary?.lines;
    counter(lines?.count, 'file lines'); counter(lines?.covered, 'covered file lines');
    ensure(lines.covered <= lines.count, 'Covered exceeds instrumented lines');
    covered += lines.covered; total += lines.count;
  }
  unique(found, 'coverage file');
  ensure(found.length === expectedFiles.length && expectedFiles.every(x => found.includes(x)), 'Coverage omitted a first-party file');
  counter(total, 'instrumented lines', true);
  const status = floor === null ? 'incomplete' : BigInt(covered) * 100n >= BigInt(counter(floor, 'coverage floor', true)) * BigInt(total) ? 'pass' : 'fail';
  return { status, covered, total, floor, source_root: root, files: found.sort(), percent: covered * 100 / total, reason: status === 'incomplete' ? 'Coverage baseline is unset' : status === 'fail' ? 'Coverage below frozen floor' : null };
}

export function isModuleDeclarations(source) {
  const lines = source.split(/\r?\n/).map(x => x.trim()).filter(x => x && !x.startsWith('//'));
  return lines.length > 0 && lines.every(x => /^(?:pub )?mod [a-zA-Z_][a-zA-Z0-9_]*;$/.test(x));
}

export function executableSourceInventory() {
  const all = rustFiles();
  const declarations = all.filter(file => isModuleDeclarations(readFileSync(path.join(repoRoot, file), 'utf8')));
  return { all, executable: all.filter(file => !declarations.includes(file)),
    non_executable: declarations.map(file => ({ path: file, reason: 'Only module declarations/comments: no executable lines; below the 50-token duplication population', sha256: digest(readFileSync(path.join(repoRoot, file))) })) };
}

export function duplicationMeasurement(raw, expectedSources) {
  const total = raw.statistics?.total;
  counter(total?.lines, 'analyzed lines', true); counter(total?.duplicatedLines, 'duplicated lines');
  ensure(total.duplicatedLines <= total.lines && total.sources === expectedSources &&
    raw.statistics.formats?.rust?.sources === expectedSources && Object.keys(raw.statistics.formats).length === 1, 'Duplication scope mismatch');
  const status = BigInt(total.duplicatedLines) * 100n <= 2n * BigInt(total.lines) ? 'pass' : 'fail';
  return { status, duplicated: total.duplicatedLines, total: total.lines, sources: expectedSources, max_percent: 2,
    percent: total.duplicatedLines * 100 / total.lines, reason: status === 'fail' ? 'Duplication exceeds 2%' : null };
}

export function rcaParseProof(log) {
  const total = [...log.matchAll(/^Total nodes: ([0-9,]+)\r?$/gm)];
  const found = [...log.matchAll(/^Found nodes: ([0-9,]+)\r?$/gm)];
  ensure(total.length === 1 && found.length === 1 && Number(total[0][1].replaceAll(',', '')) > 0 &&
    Number(found[0][1].replaceAll(',', '')) === 0, 'RCA parse preflight failed/incomplete');
  return true;
}

export function complexityMeasurement(roots, expectedFiles, exceptions) {
  const functions = [], seenExceptions = new Set();
  unique(roots.map(x => x.name.replaceAll('\\', '/')), 'RCA file');
  ensure(roots.length === expectedFiles.length && roots.every(x => expectedFiles.includes(x.name.replaceAll('\\', '/'))), 'RCA scope mismatch');
  function visit(space, filename, parents = []) {
    object(space, 'RCA space'); ensure(Array.isArray(space.spaces), 'Missing nested spaces');
    const name = space.name === '<anonymous>' ? space.name + '@' + counter(space.start_line, 'anonymous start', true) + ':' + counter(space.end_line, 'anonymous end', true) : space.name;
    const symbol = [...parents, name].join('::');
    const aggregate = counter(space.metrics?.cyclomatic?.sum, 'cyclomatic aggregate');
    if (space.kind === 'function' || space.kind === 'closure') {
      const nested = space.spaces.reduce((sum, child) => sum + counter(child.metrics?.cyclomatic?.sum, 'nested aggregate'), 0);
      const value = counter(aggregate - nested, 'own cyclomatic', true);
      functions.push({ path: filename, symbol, line: counter(space.start_line, 'function start', true), end_line: counter(space.end_line, 'function end', true), value, ceiling: 10 });
    }
    const next = space.kind === 'unit' ? parents : [...parents, name];
    for (const child of space.spaces) visit(child, filename, next);
  }
  for (const root of roots) visit(root, root.name.replaceAll('\\', '/'));
  counter(functions.length, 'function population', true);
  const groups = Map.groupBy(functions, x => x.path + ':' + x.symbol);
  for (const group of groups.values()) {
    for (const [index, fn] of group.entries()) {
      if (group.length > 1) fn.symbol += '@' + fn.line + ':' + fn.end_line + '#' + (index + 1);
      const exception = exceptions.find(x => x.path === fn.path && x.symbol === fn.symbol);
      if (exception) {
        ensure(fn.value > 10 && fn.value <= exception.ceiling, 'Stale/exceeded complexity exception');
        fn.ceiling = exception.ceiling; seenExceptions.add(exception);
      }
    }
  }
  unique(functions.map(x => x.path + ':' + x.symbol), 'qualified function identity');
  ensure(seenExceptions.size === exceptions.length, 'Stale complexity exception');
  const violations = functions.filter(x => x.value > x.ceiling);
  return { status: violations.length ? 'fail' : 'pass', functions, violations, max: 10, reason: violations.length ? 'Functions exceed exact complexity ceilings' : null };
}

export function npmAuditMeasurement(raw) {
  ensure(raw.auditReportVersion === 2 && !raw.error, 'npm audit failed/incomplete');
  object(raw.vulnerabilities, 'npm vulnerabilities');
  const counts = raw.metadata?.vulnerabilities;
  for (const name of ['info', 'low', 'moderate', 'high', 'critical', 'total']) counter(counts?.[name], 'npm ' + name);
  ensure(counts.total === counts.info + counts.low + counts.moderate + counts.high + counts.critical, 'Contradictory npm audit');
  counter(raw.metadata?.dependencies?.total, 'npm dependency population', true);
  return { status: counts.total ? 'fail' : 'pass', vulnerabilities: counts, reported_dependency_total: raw.metadata.dependencies.total,
    omitted: ['peer'], reason: counts.total ? 'Unwaived installed CI-tool vulnerability' : null };
}

export function denyMeasurement(records) {
  ensure(Array.isArray(records), 'Invalid cargo-deny JSON lines');
  const summaries = records.filter(x => x.type === 'summary');
  ensure(summaries.length === 1, 'Missing/duplicate cargo-deny completion');
  const counts = summaries[0].fields;
  let errors = 0;
  for (const name of ['advisories', 'licenses', 'bans', 'sources']) {
    counter(counts?.[name]?.errors, 'cargo-deny ' + name + ' errors');
    counter(counts[name].warnings, 'cargo-deny warnings'); errors += counts[name].errors;
  }
  return { status: errors ? 'fail' : 'pass', errors, summaries: counts,
    reason: errors ? 'Unwaived Rust dependency policy findings' : null };
}

export function filesBelow(root) {
  return readdirSync(root, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en')).flatMap(entry => {
    ensure(!entry.isSymbolicLink(), 'Redirected evidence file');
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesBelow(file) : entry.isFile() ? [file] : [];
  });
}

export function gateMeasurement(gate, evidenceRoot, policy = loadPolicy(), producerRoot = repoRoot, scope = null) {
  const root = path.join(evidenceRoot, gate);
  const read = name => readFileSync(containedFile(root, name), 'utf8').replace(/^\uFEFF/, '');
  if (['unit', 'integration', 'ui'].includes(gate)) {
    const counts = libtestPopulation(read('list.stdout.log'), read('run.stdout.log'),
      gate === 'integration' ? jsonFile(path.join(ciRoot, 'test-populations.json')).external : [], gate === 'ui');
    return { status: 'pass', ...counts, ...(gate === 'ui' ? { kind: 'simulated-egui-draw-input' } : {}) };
  }
  if (gate === 'ci-support') return { status: 'pass', ...nodePopulation(read('run.stdout.log')) };
  if (gate === 'coverage' || gate === 'duplication') {
    const inventory = scope?.inventory ?? executableSourceInventory();
    const measurement = gate === 'coverage' ? coverageMeasurement(jsonFile(path.join(root, 'coverage.json')), inventory.executable, producerRoot, policy.coverage.floor) :
      duplicationMeasurement(jsonFile(path.join(root, 'jscpd-report.json')), inventory.executable.length);
    return { ...measurement, source_inventory: inventory.all, non_executable: inventory.non_executable };
  }
  if (gate === 'complexity') {
    rcaParseProof(read('parse.stdout.log'));
    return complexityMeasurement(filesBelow(path.join(root, 'rca')).filter(x => x.endsWith('.json')).map(x => jsonFile(x)), scope?.inventory.all ?? rustFiles(), policy.complexity.exceptions);
  }
  if (gate === 'architecture') {
    const findings = JSON.parse(read('run.stdout.log'));
    ensure(Array.isArray(findings), 'Invalid ast-grep scan output');
    return { status: findings.length ? 'fail' : 'pass', findings, sources: scope?.inventory.all ?? rustFiles(), reason: findings.length ? 'Forbidden native/UI dependency edge' : null };
  }
  if (gate === 'dependencies') {
    const rust = denyMeasurement(read('rust.stderr.log').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)));
    const npm = npmAuditMeasurement(JSON.parse(read('npm.stdout.log')));
    return { status: rust.status === 'pass' && npm.status === 'pass' ? 'pass' : 'fail',
      rust, npm, reason: rust.reason ?? npm.reason };
  }
  if (gate === 'package') {
    const expected = scope?.package ?? workingPackageScope(jsonFile(path.join(evidenceRoot, 'context.json')));
    const result = spawnSync('pwsh', ['-NoProfile', '-File', path.join(ciRoot, 'package.ps1'), '-VerifyOnly', '-EvidenceDirectory', root],
      { cwd: repoRoot, input: JSON.stringify(expected), encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
    ensure(!result.error && result.status === 0, 'Package data verification failed: ' + (result.error?.message ?? result.stderr));
    return JSON.parse(result.stdout.replace(/^\uFEFF/, ''));
  }
  if (gate === 'mutation-rust' || gate === 'mutation-ci') {
    const raw = path.join(root,'raw');
    const execution = jsonFile(path.join(raw,'execution.json'));
    if (gate === 'mutation-rust') return normalizeRustMutation({execution,
      mutants:jsonFile(path.join(raw,'mutants.json')),outcomes:jsonFile(path.join(raw,'mutants.out/outcomes.json'))});
    const event = name => {
      const found=filesBelow(path.join(raw,'stryker-events')).filter(x=>path.basename(x).endsWith('-'+name+'.json'));
      ensure(found.length===1,'Missing/duplicate Stryker '+name); return jsonFile(found[0]);
    };
    return normalizeCiMutation({execution,report:jsonFile(path.join(raw,'stryker-report.json')),
      plan:event('onMutationTestingPlanReady'),dryRun:event('onDryRunCompleted')});
  }
  return null;
}

export function workingPackageScope(context) {
  validateContext(context);
  const manifest = readFileSync(path.join(repoRoot, 'Cargo.toml'), 'utf8');
  const section = manifest.match(/^\[package\][\s\S]*?(?=^\[|$(?![\s\S]))/m)?.[0];
  const version = section?.match(/^version\s*=\s*"((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))"\s*$/m)?.[1];
  ensure(version, 'Missing stable root package version');
  const vad = readFileSync(path.join(repoRoot, 'assets/silero-vad.json'));
  return { version, source_sha: context.tested_sha, tree_sha: git(['rev-parse', context.tested_sha + '^{tree}']),
    kind: context.kind, vad: JSON.parse(vad), vad_metadata_sha256: digest(vad) };
}

export const jobNames = {
  policy: 'CI policy', rust: 'Rust and quality', mutation_rust: 'Mutation Rust light',
  mutation_ci: 'Mutation CI light', package: 'Package smoke', report: 'CI report',
  readiness: 'CI readiness',
};

export function requiredGates(context, policy = loadPolicy()) {
  return Object.keys(policy.gate_owners).filter(gate => gate !== 'package' ||
    (context.event === 'push' && context.branch === 'release'));
}

export function readiness(context, receipts, jobs, reportOk, policy = loadPolicy()) {
  validateContext(context);
  const reasons = [];
  if (!reportOk) reasons.push('Required report construction failed');
  const required = requiredGates(context, policy);
  const jobIds = [...policy.jobs.ordinary, ...(required.includes('package') ? policy.jobs.release : [])];
  for (const id of jobIds) if (jobs[id] !== 'success') reasons.push('Required job ' + id + ': ' + (jobs[id] ?? 'missing'));
  const seen = new Set();
  for (const receipt of receipts) {
    try {
      validateReceipt(receipt, context);
      ensure(!seen.has(receipt.gate), 'Duplicate gate ' + receipt.gate);
      if (context.kind === 'hosted') ensure(receipt.context.job_id === policy.gate_owners[receipt.gate], 'Wrong gate owner');
      seen.add(receipt.gate);
      if (required.includes(receipt.gate) && receipt.status !== 'pass') reasons.push(receipt.gate + ': ' + receipt.status + ' - ' + receipt.reason);
      if (receipt.gate.startsWith('mutation-') && receipt.measurements?.profile !== 'light') reasons.push(receipt.gate + ': ordinary readiness requires the light profile');
    } catch (error) { reasons.push('Invalid gate evidence: ' + error.message); }
  }
  for (const gate of required) if (!seen.has(gate)) reasons.push('Missing gate: ' + gate);
  if (policy.coverage.floor === null) reasons.push('Coverage baseline is unset');
  if (context.kind !== 'hosted') reasons.push('Local evidence cannot certify hosted readiness');
  return { schema_version: 1, ready: reasons.length === 0, context, required_gates: required,
    excluded_gates: required.includes('package') ? [] : [{ gate: 'package', reason: 'Only required for an actual release push' }], reasons };
}

export function collectEvidence(root, context, scope = null) {
  const receipts = [], errors = [];
  for (const filename of filesBelow(root).filter(x => path.basename(x) === 'gate.json')) {
    try {
      const receipt = validateReceipt(jsonFile(filename), context);
      ensure(path.basename(path.dirname(filename)) === receipt.gate, 'Receipt directory/identity mismatch');
      const base = path.dirname(path.dirname(filename));
      ensure(receipt.raw_outputs?.length > 0, 'Missing raw evidence');
      for (const output of receipt.raw_outputs) {
        ensure(digest(readFileSync(containedFile(base, output.path))) === output.sha256, 'Raw evidence hash mismatch');
      }
      if (receipt.status === 'pass') {
        if (receipt.gate === 'coverage') textValue(receipt.measurements?.source_root, 'producer source root', 2048);
        const measurement = gateMeasurement(receipt.gate, base, scope?.policy ?? loadPolicy(), receipt.measurements?.source_root ?? repoRoot, scope);
        if (measurement) ensure(digest(JSON.stringify(measurement)) === digest(JSON.stringify(receipt.measurements)), 'Receipt/analyzer measurement mismatch');
      }
      receipts.push(receipt);
    } catch (error) { errors.push({ path: path.relative(root, filename).replaceAll('\\', '/'), reason: error.message }); }
  }
  return { receipts, errors };
}

export function workflowPolicy(workflow) {
  object(workflow, 'workflow'); object(workflow.on, 'workflow triggers');
  ensure(!workflow.on.pull_request_target, 'Privileged PR target execution is forbidden');
  for (const trigger of Object.values(workflow.on)) {
    ensure(!trigger?.paths && !trigger?.['paths-ignore'], 'Path filters can hide required checks');
  }
  ensure(workflow.permissions?.contents === 'read', 'CI defaults must be read-only');
  function readOnly(permissions) {
    if (permissions) for (const value of Object.values(permissions)) ensure(value !== 'write', 'Unprivileged CI requested write permission');
  }
  readOnly(workflow.permissions);
  for (const job of Object.values(workflow.jobs)) {
    readOnly(job.permissions);
    for (const step of job.steps ?? []) {
      if (!step.uses) continue;
      ensure(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+@[a-f0-9]{40}$/.test(step.uses), 'Action is not immutable');
      if (step.uses.startsWith('actions/checkout@')) ensure(step.with?.['persist-credentials'] === false, 'Checkout must not retain credentials');
    }
  }
  ensure(workflow.jobs.policy && workflow.jobs.rust && workflow.jobs.readiness?.if === 'always()', 'Missing fixed CI jobs or always-on readiness');
  ensure(workflow.jobs.readiness.needs.includes('policy') && workflow.jobs.readiness.needs.includes('rust'), 'Readiness omitted baseline jobs');
  return true;
}

export async function promotionFromEvent(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true') return promotion({ event: 'local' });
  const event = jsonFile(env.GITHUB_EVENT_PATH);
  const input = { event: env.GITHUB_EVENT_NAME, branch: env.GITHUB_REF_NAME };
  let base, head;
  if (event.pull_request) {
    const pr = event.pull_request;
    Object.assign(input, { head: pr.head.ref, base: pr.base.ref,
      same_repository: pr.head.repo?.id === pr.base.repo.id, head_sha: pr.head.sha });
    base = pr.base.sha; head = pr.head.sha;
    if (pr.base.ref === 'main') {
      const release = await githubJson('/repos/' + loadPolicy().repository + '/releases/latest');
      ensure(!release.draft && !release.prerelease && /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(release.tag_name), 'Main requires a stable published release');
      ensure(git(['cat-file', '-t', release.tag_name]) === 'tag', 'Published release tag must be annotated');
      input.published_sha = git(['rev-parse', release.tag_name + '^{}']);
      input.published_tree = git(['rev-parse', input.published_sha + '^{tree}']);
      input.tested_tree = git(['rev-parse', env.GITHUB_SHA + '^{tree}']);
      input.published_version = release.tag_name.slice(1);
      const {manifestVersion} = await import('./release.mjs');
      input.tested_version = manifestVersion(gitBytes(['show',env.GITHUB_SHA+':Cargo.toml']).toString('utf8'));
    }
  } else { base = event.before; head = env.GITHUB_SHA; }
  promotion(input);
  if (base && !/^0+$/.test(base)) {
    ensure(SHA.test(base) && SHA.test(head), 'Invalid commit range');
    const commits = git(['rev-list', '--reverse', base + '..' + head]).split('\n').filter(Boolean).map(sha => ({
      message: git(['show', '-s', '--format=%B', sha]),
      parents: git(['rev-list', '--parents', '-n', '1', sha]).split(' ').length - 1,
    }));
    commitPolicy(commits);
  } else if (input.event === 'push' && input.branch.startsWith('feature/')) {
    const forkPoint = git(['merge-base', 'HEAD', 'origin/develop']);
    commitPolicy(git(['rev-list', forkPoint + '..HEAD']).split('\n').filter(Boolean).map(sha => ({
      message: git(['show', '-s', '--format=%B', sha]), parents: git(['rev-list', '--parents', '-n', '1', sha]).split(' ').length - 1,
    })));
  }
  return input;
}

export async function setupLinux() {
  const asset = jsonFile(path.join(ciRoot, 'toolchain.json')).assets['actionlint-linux'];
  const root = path.join(repoRoot, '.build', 'ci-tools');
  mkdirSync(root, { recursive: true });
  const response = await fetch(asset.url, { signal: AbortSignal.timeout(60000) });
  ensure(response.ok, 'Pinned actionlint download failed');
  const bytes = Buffer.from(await response.arrayBuffer());
  ensure(bytes.length < 32 * 1024 * 1024 && digest(bytes) === asset.sha256, 'Actionlint archive checksum mismatch');
  const archive = path.join(root, 'actionlint.tar.gz'); writeFileSync(archive, bytes);
  execFileSync('tar', ['-xzf', archive, '-C', root, 'actionlint'], { timeout: 10000 });
  return path.join(root, 'actionlint');
}

export async function policyRun(root, actionlint) {
  const context = await executionContext('policy');
  mkdirSync(root, { recursive: true }); writeJson(path.join(root, 'context.json'), context);
  const testFiles = readdirSync(path.join(ciRoot, 'tests')).filter(x => x.endsWith('.test.mjs')).sort().map(x => path.join(ciRoot, 'tests', x));
  const steps = [
    { gate: 'ci-support', command: [process.execPath, '--test', '--test-reporter=tap', ...testFiles] },
    { gate: 'workflow', command: [actionlint, '-color=false'] },
  ];
  let exit = 0;
  for (const step of steps) {
    const directory = path.join(root, step.gate); mkdirSync(directory);
    const started = new Date().toISOString(), before = performance.now();
    let validationError = null;
    if (step.gate === 'workflow') {
      try {
        workflowPolicy(parseYaml(readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8')));
        await promotionFromEvent();
      } catch (error) { validationError = error.message; }
    }
    const result = spawnSync(step.command[0], step.command.slice(1), { cwd: repoRoot, encoding: 'utf8', timeout: 480000, maxBuffer: 32 * 1024 * 1024 });
    writeFileSync(path.join(directory, 'run.stdout.log'), result.stdout ?? '');
    writeFileSync(path.join(directory, 'stdout.log'), result.stdout ?? '');
    writeFileSync(path.join(directory, 'stderr.log'), (result.stderr ?? '') + (validationError ?? ''));
    const receipt = makeReceipt(step.gate, context, {
      completed: !result.error, timed_out: result.error?.code === 'ETIMEDOUT', exit_code: result.status,
      duration_ms: Math.round(performance.now() - before), started_at: started, completed_at: new Date().toISOString(),
      command: step.command, reason: validationError ?? result.error?.message,
    }, root);
    if (validationError) { receipt.status = 'fail'; receipt.reason = validationError; }
    writeJson(path.join(directory, 'gate.json'), receipt);
    if (receipt.status !== 'pass') exit = Math.max(exit, receipt.status === 'fail' ? 1 : 2);
  }
  return exit;
}

export function makeReceipt(gate, context, result, evidenceRoot) {
  ensure(gateIds.has(gate), 'Unknown gate');
  const raw = [];
  for (const file of filesBelow(path.join(evidenceRoot, gate)).filter(x => !['result.json', 'gate.json'].includes(path.basename(x)))) {
    const relative = safeRelativePath(path.relative(evidenceRoot, file));
    raw.push({ path: relative, sha256: digest(readFileSync(containedFile(evidenceRoot, relative))) });
  }
  const incomplete = result.timed_out || !result.completed || result.exit_code === null;
  let status = incomplete ? 'incomplete' : result.exit_code === 0 ? 'pass' : 'fail';
  let reason = status === 'pass' ? null : (result.reason || (result.timed_out ? 'Child process timed out' : 'Gate did not complete successfully'));
  let measurements = result.measurements ?? null;
  if (!incomplete) {
    try {
      measurements = gateMeasurement(gate, evidenceRoot) ?? measurements;
      if (measurements?.status && measurements.status !== 'pass') {
        status = measurements.status; reason = measurements.reason ?? 'Measured gate policy failed';
      }
    } catch (error) { status = 'incomplete'; reason = 'Invalid/missing analyzer evidence: ' + error.message; }
  }
  if (['unit', 'integration', 'ui', 'coverage', 'complexity', 'duplication', 'dependencies', 'mutation-rust', 'mutation-ci', 'package'].includes(gate) && !measurements) {
    if (status !== 'incomplete') reason = 'Required measurement output is missing';
    status = 'incomplete';
  }
  const receipt = {
    schema_version: 1, gate, context, status, required: true, applicable: true,
    completed: Boolean(result.completed && !result.timed_out), exit_code: result.exit_code,
    started_at: result.started_at, completed_at: result.completed_at,
    duration_ms: counter(result.duration_ms, 'duration'), raw_outputs: raw,
    command: result.command ?? [], measurements,
    ...(['unit', 'integration', 'ui'].includes(gate) && measurements ? { counts: Object.fromEntries(['listed', 'passed', 'failed', 'ignored'].map(key => [key, measurements[key]])) } : result.counts ? { counts: result.counts } : {}),
    reason: reason === null ? null : String(reason).replace(/[\x00-\x1f]/g, ' ').slice(0, 4096),
  };
  return validateReceipt(receipt, context);
}

export function git(args, cwd = repoRoot) {
  return gitBytes(args, cwd).toString('utf8').trim();
}

export function gitBytes(args, cwd = repoRoot) {
  return execFileSync('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
}

export function cliOptions(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) {
    ensure(/^--[a-z-]+$/.test(argv[i]) && argv[i + 1] !== undefined, 'Expected --option value');
    const key = argv[i].slice(2);
    ensure(!(key in result), 'Duplicate command option');
    result[key] = argv[i + 1];
  }
  return result;
}

export async function githubJson(endpoint, { token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN, method = 'GET', body } = {}) {
  ensure(endpoint.startsWith('/repos/') && !endpoint.includes('..') && !endpoint.includes('?url='), 'Unexpected GitHub endpoint');
  const response = await fetch('https://api.github.com' + endpoint, {
    method, signal: AbortSignal.timeout(30000),
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
  });
  ensure(response.ok, 'GitHub request failed (' + response.status + ')');
  return response.status === 204 ? null : response.json();
}

export async function executionContext(job = 'local', env = process.env, api = githubJson, readGit = git) {
  const policy = loadPolicy();
  const sha = readGit(['rev-parse', 'HEAD']);
  const ctx = {
    schema_version: 1, kind: 'local', repository: policy.repository, repository_id: null,
    head_repository_id: null, workflow_id: null, workflow_path: null, workflow_sha: sha,
    event: 'local', branch: readGit(['branch', '--show-current']) || 'detached',
    source_sha: sha, tested_sha: sha, run_id: env.RUSTCORDER_CI_RUN_ID || ('local-' + Date.now()), run_attempt: 1, job_id: job,
    policy_sha256: digest(readFileSync(path.join(ciRoot, 'policy.json'))),
    toolchain_sha256: digest(readFileSync(path.join(ciRoot, 'toolchain.json'))),
    dirty: readGit(['status', '--porcelain']).length > 0,
  };
  if (env.GITHUB_ACTIONS === 'true') {
    ensure(!ctx.dirty, 'Hosted evidence requires a clean source checkout');
    ensure(env.GITHUB_REPOSITORY === policy.repository, 'Unexpected workflow repository');
    const event = jsonFile(env.GITHUB_EVENT_PATH);
    const run = await api('/repos/' + policy.repository + '/actions/runs/' + env.GITHUB_RUN_ID);
    const source = event.pull_request?.head?.sha ?? env.GITHUB_SHA;
    ensure(sha === env.GITHUB_SHA, 'Checkout does not match the tested workflow SHA');
    ensure(run.id === Number(env.GITHUB_RUN_ID) && run.run_attempt === Number(env.GITHUB_RUN_ATTEMPT), 'Stale or substituted run attempt');
    ensure(run.event === env.GITHUB_EVENT_NAME && run.head_sha === source, 'Run event/source mismatch');
    ensure(run.head_branch === (env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME), 'Run branch mismatch');
    ensure(run.repository?.id === Number(env.GITHUB_REPOSITORY_ID) && run.repository?.full_name === policy.repository, 'Run repository mismatch');
    Object.assign(ctx, {
      kind: 'hosted', repository_id: Number(env.GITHUB_REPOSITORY_ID),
      head_repository_id: event.pull_request?.head?.repo?.id ?? run.head_repository?.id ?? run.repository?.id,
      workflow_id: run.workflow_id, workflow_path: run.path?.split('@')[0] ?? '.github/workflows/ci.yml',
      workflow_sha: env.GITHUB_WORKFLOW_SHA, event: env.GITHUB_EVENT_NAME,
      branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME,
      source_sha: event.pull_request?.head?.sha ?? env.GITHUB_SHA,
      tested_sha: env.GITHUB_SHA, run_id: Number(env.GITHUB_RUN_ID), run_attempt: Number(env.GITHUB_RUN_ATTEMPT),
      job_id: env.GITHUB_JOB || job,
    });
    delete ctx.dirty;
  }
  return validateContext(ctx);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = cliOptions(args);
  if (command === 'context') {
    const current = await executionContext(options.job);
    if (options.expected) validateContext(jsonFile(options.expected), current);
    return writeJson(options.out, current);
  }
  if (command === 'policy') return validatePolicy(jsonFile(options.file ?? path.join(ciRoot, 'policy.json')));
  if (command === 'setup-linux') return console.log(await setupLinux());
  if (command === 'provision-vad') return provisionVad();
  if (command === 'policy-run') { process.exitCode = await policyRun(path.resolve(options.root), options.actionlint); return; }
  if (command === 'record-mutation') {
    const root=path.resolve(options.root), directory=path.join(root,options.gate);
    const context=jsonFile(path.join(root,'context.json'));
    let execution={completed:false,exit_code:null,started_at:new Date().toISOString(),completed_at:new Date().toISOString()};
    try {execution=jsonFile(path.join(directory,'raw/execution.json'));}catch{}
    const result={...execution,duration_ms:Math.max(0,Date.parse(execution.completed_at)-Date.parse(execution.started_at)),
      command:['node','scripts/ci/run-mutation.mjs'],reason:'Missing/incomplete fresh mutation output'};
    try {
      const measured=gateMeasurement(options.gate,root);
      result.exit_code=measured.status==='pass'?0:measured.status==='fail'?1:2;
    }catch{}
    const receipt=makeReceipt(options.gate,context,result,root);
    writeJson(path.join(directory,'gate.json'),receipt);
    process.exitCode=receipt.status==='pass'?0:receipt.status==='fail'?1:2;
    return;
  }
  if (command === 'mutation-summary') {
    const context=await executionContext('report'), collected=collectEvidence(path.resolve(options.root),context);
    const needs=JSON.parse(process.env.CI_NEEDS??'{}'), reasons=collected.errors.map(x=>x.reason);
    for (const [job,gate] of [['mutation_rust','mutation-rust'],['mutation_ci','mutation-ci']]) {
      const receipts=collected.receipts.filter(x=>x.gate===gate);
      if (needs[job]?.result!=='success'||receipts.length!==1||receipts[0].status!=='pass'||receipts[0].measurements?.profile!=='full')
        reasons.push('Missing, failed or incomplete full mutation: '+gate);
    }
    const result={schema_version:1,kind:'full-mutation-report',context,ready:reasons.length===0,reasons,receipts:collected.receipts};
    writeJson(path.join(options.out,'full-mutation.json'),result);
    const markdown='# Full mutation report\n\n'+(result.ready?'Both engines passed.':'Blocked: '+reasons.join('; '))+
      '\n\nThis report does not certify ordinary CI or release readiness.\n\n'+JSON.stringify(result.receipts.map(x=>({gate:x.gate,measurements:x.measurements})),null,2)+'\n';
    mkdirSync(options.out,{recursive:true});writeFileSync(path.join(options.out,'full-mutation.md'),markdown);
    if(process.env.GITHUB_STEP_SUMMARY)writeFileSync(process.env.GITHUB_STEP_SUMMARY,markdown,{flag:'a'});
    process.exitCode=result.ready?0:1; return;
  }
  if (command === 'report') {
    const context=await executionContext('report');
    const needs=JSON.parse(process.env.CI_NEEDS??'{}');
    const jobs=Object.fromEntries(Object.entries(needs).map(([key,value])=>[key,value.result]));
    jobs.report='in_progress';
    const {writeReport}=await import('./report.mjs');
    return writeReport({root:path.resolve(options.root),context,jobs,out:options.out,summaryPath:process.env.GITHUB_STEP_SUMMARY??null});
  }
  if (command === 'readiness') {
    const context = await executionContext('readiness');
    const collected = collectEvidence(path.resolve(options.root), context);
    const report = jsonFile(options.report);
    validateContext(report.context, context);
    const reportOk = report.schema_version === 1 && report.receipts_sha256 === digest(JSON.stringify(collected.receipts)) &&
      report.collection_errors?.length === 0 && collected.errors.length === 0;
    const needs = JSON.parse(process.env.CI_NEEDS ?? '{}');
    const jobs = Object.fromEntries(Object.entries(needs).map(([key, value]) => [key, value.result]));
    const result = readiness(context, collected.receipts, jobs, reportOk);
    writeJson(options.out, result);
    console.log(result.ready ? 'All applicable CI gates passed' : result.reasons.join('\n'));
    process.exitCode = result.ready ? 0 : 1;
    return;
  }
  if (command === 'record') {
    const result = jsonFile(options.result);
    const context = jsonFile(options.context);
    const receipt = makeReceipt(options.gate, context, result, options.root);
    writeJson(options.out, receipt);
    process.exitCode = receipt.status === 'pass' ? 0 : receipt.status === 'fail' ? 1 : 2;
    return;
  }
  throw new Error('Unsupported gate command: ' + command);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 2; });
}
