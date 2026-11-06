import { createHash } from 'node:crypto';

const floors = Object.freeze({ light: 40, full: 50 });
const rustGenres = new Set(['FnValue', 'BinaryOperator', 'UnaryOperator', 'MatchArm', 'MatchArmGuard', 'StructField']);

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function record(value, label) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), label + ' must be an object');
  return value;
}

function count(value, label, positive = false) {
  requireValue(Number.isSafeInteger(value) && value >= (positive ? 1 : 0), 'Invalid ' + label);
  return value;
}

function text(value, label, allowEmpty = false) {
  requireValue(typeof value === 'string' && value.length <= 1024 * 1024 &&
    (allowEmpty || value.length > 0) && !value.includes('\0'), 'Invalid ' + label);
  return value;
}

function relative(value) {
  const name = text(value, 'source path').replaceAll('\\', '/');
  requireValue(!name.startsWith('/') && !/[<>:"|?*\x00-\x1f]/.test(name), 'Unsafe source path');
  for (const part of name.split('/')) {
    requireValue(part && part !== '.' && part !== '..' && !/[. ]$/.test(part) &&
      !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part), 'Unsafe source segment');
  }
  return name;
}

function timestamp(value, label) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|\+00:00)$/.test(value), 'Invalid ' + label);
  const parsed = Date.parse(value);
  requireValue(Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19), 'Invalid ' + label);
  return parsed;
}

function unique(values, label) {
  requireValue(new Set(values).size === values.length, 'Duplicate ' + label);
  return values;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function position(value, firstCoordinate) {
  record(value, 'source position');
  return { line: count(value.line, 'source line', firstCoordinate === 1), column: count(value.column, 'source column', firstCoordinate === 1) };
}

function span(value, firstCoordinate) {
  record(value, 'source span');
  const start = position(value.start, firstCoordinate), end = position(value.end, firstCoordinate);
  requireValue(end.line > start.line || (end.line === start.line && end.column > start.column), 'Empty/reversed source span');
  return { start, end };
}

function noCachedFlags(value) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    requireValue(!(['cached', 'reused', 'from_cache', 'fromCache'].includes(key) && child !== false), 'Cached/reused outcome data is forbidden');
    if (child !== null && typeof child === 'object') noCachedFlags(child);
  }
}

function executionInfo(execution, engine) {
  record(execution, 'execution');
  noCachedFlags(execution);
  requireValue(Object.hasOwn(floors, execution.profile), 'Unknown mutation profile');
  requireValue(execution.completed === true && execution.fresh === true && execution.cached === false, 'Mutation execution is unfinished or not fresh');
  requireValue(Number.isSafeInteger(execution.exit_code) &&
    (execution.exit_code === 0 || (engine === 'cargo-mutants' && execution.exit_code === 2)), 'Mutation child did not complete normally');
  const started = timestamp(execution.started_at, 'execution start'), ended = timestamp(execution.completed_at, 'execution completion');
  requireValue(ended >= started, 'Mutation completion preceded start');
  requireValue(Array.isArray(execution.scope) && execution.scope.length > 0, 'Missing mutation scope');
  const scope = unique(execution.scope.map(relative), 'scope file').sort();
  const baseline = record(execution.baseline, 'baseline');
  requireValue(baseline.completed === true && count(baseline.passed, 'baseline passed', true) > 0 &&
    count(baseline.failed, 'baseline failed') === 0, 'Baseline failed or was empty');
  count(baseline.ignored, 'baseline ignored');
  return { profile: execution.profile, floor: floors[execution.profile], scope, started, ended, baseline: { ...baseline } };
}

function verifyScope(files, scope) {
  const actual = [...new Set(files)].sort();
  requireValue(actual.length === scope.length && actual.every((file, index) => file === scope[index]), 'Generated mutation file scope is incomplete or substituted');
}

function assessment(engine, version, info, outcomes) {
  const inventories = { detected: [], survived: [], nonviable: [] };
  for (const outcome of outcomes) inventories[outcome.status].push(outcome.id);
  for (const inventory of Object.values(inventories)) inventory.sort();
  const detected = inventories.detected.length, survived = inventories.survived.length;
  const nonviable = inventories.nonviable.length, viable = detected + survived;
  requireValue(viable > 0, 'No positive viable mutation population');
  const accepted = BigInt(detected) * 100n >= BigInt(info.floor) * BigInt(viable);
  return { schema_version: 1, engine, engine_version: version, profile: info.profile, scope: info.scope,
    baseline: info.baseline, status: accepted ? 'pass' : 'fail', completed: true,
    total: outcomes.length, detected, survived, nonviable, viable, score: 100 * detected / viable,
    min_percent: info.floor, inventories, outcomes, reason: accepted ? null : 'Mutation score below the ' + info.floor + '% ' + info.profile + ' floor' };
}

function incomplete(engine, version, execution, error) {
  return { schema_version: 1, engine, engine_version: version,
    profile: typeof execution?.profile === 'string' ? execution.profile : null,
    scope: null, baseline: null, status: 'incomplete', completed: false,
    total: null, detected: null, survived: null, nonviable: null, viable: null, score: null,
    min_percent: Object.hasOwn(floors, execution?.profile) ? floors[execution.profile] : null,
    inventories: null, outcomes: null,
    reason: String(error.message).replace(/[\x00-\x1f]/g, ' ').slice(0, 4096) };
}

export function cargoMutantId(mutant) {
  record(mutant, 'Cargo mutant');
  const identity = {
    name: text(mutant.name, 'Cargo mutant name'), package: text(mutant.package, 'Cargo package'),
    file: relative(mutant.file), span: span(mutant.span, 1),
    replacement: text(mutant.replacement, 'Cargo replacement', true), genre: text(mutant.genre, 'Cargo genre'),
    function: null,
  };
  requireValue(rustGenres.has(identity.genre), 'Unknown Cargo mutant genre');
  if (mutant.function !== null) {
    const fn = record(mutant.function, 'Cargo mutant function');
    identity.function = { function_name: text(fn.function_name, 'Cargo function name'),
      return_type: text(fn.return_type, 'Cargo return type', true), span: span(fn.span, 1) };
  }
  return hash(identity);
}

function rustPhase(phase) {
  record(phase, 'Cargo phase');
  requireValue(['Build', 'Test'].includes(phase.phase), 'Unsupported/incomplete Cargo phase');
  requireValue(typeof phase.duration === 'number' && Number.isFinite(phase.duration) && phase.duration >= 0, 'Invalid Cargo phase duration');
  requireValue(Array.isArray(phase.argv) && phase.argv.length > 0 && phase.argv.every(value => typeof value === 'string' && !value.includes('\0')), 'Missing Cargo phase command');
  let status;
  if (phase.process_status === 'Success') status = 'success';
  else {
    const raw = record(phase.process_status, 'Cargo child status');
    requireValue(Object.keys(raw).length === 1 && Number.isSafeInteger(raw.Failure) && raw.Failure !== 0, 'Unknown/timeout Cargo child status');
    status = 'failure';
  }
  return { phase: phase.phase, status };
}

function rustScenario(outcome, expected) {
  requireValue(Array.isArray(outcome.phase_results), 'Missing Cargo phases');
  const phases = outcome.phase_results.map(rustPhase);
  if (expected === 'nonviable') {
    requireValue(phases.length === 1 && phases[0].phase === 'Build' && phases[0].status === 'failure', 'Nonviable Cargo outcome has no failed build');
  } else {
    requireValue(phases.length === 2 && phases[0].phase === 'Build' && phases[0].status === 'success' && phases[1].phase === 'Test', 'Cargo test phase is missing or build failed');
    requireValue(phases[1].status === (expected === 'detected' ? 'failure' : 'success'), 'Cargo summary contradicts child status');
  }
}

export function normalizeRustMutation(input = {}) {
  let execution;
  try {
    const { mutants, outcomes } = record(input, 'Cargo adapter input');
    execution = input.execution;
    const info = executionInfo(execution, 'cargo-mutants');
    noCachedFlags(mutants);
    noCachedFlags(outcomes);
    requireValue(Array.isArray(mutants) && mutants.length > 0, 'Missing generated Cargo mutant inventory');
    const generated = new Map(mutants.map(mutant => [cargoMutantId(mutant), relative(mutant.file)]));
    requireValue(generated.size === mutants.length, 'Duplicate generated Cargo mutant');
    verifyScope([...generated.values()], info.scope);
    record(outcomes, 'Cargo lab outcome');
    requireValue(outcomes.cargo_mutants_version === '27.1.0', 'Cargo engine version mismatch');
    const started = timestamp(outcomes.start_time, 'Cargo start'), ended = timestamp(outcomes.end_time, 'Cargo completion');
    requireValue(started >= info.started && ended <= info.ended && ended >= started, 'Stale/unbound Cargo execution timestamps');
    requireValue(Array.isArray(outcomes.outcomes), 'Missing Cargo scenarios');
    const baselines = outcomes.outcomes.filter(outcome => outcome.scenario === 'Baseline');
    requireValue(baselines.length === 1 && baselines[0].summary === 'Success', 'Cargo baseline is absent, duplicate or failed');
    rustScenario(baselines[0], 'survived');
    const normalized = [];
    for (const outcome of outcomes.outcomes) {
      if (outcome.scenario === 'Baseline') continue;
      record(outcome.scenario, 'Cargo mutant scenario');
      requireValue(Object.keys(outcome.scenario).length === 1, 'Unknown Cargo scenario');
      const id = cargoMutantId(outcome.scenario.Mutant);
      requireValue(generated.has(id), 'Unknown/substituted Cargo mutant outcome');
      const status = { CaughtMutant: 'detected', MissedMutant: 'survived', Unviable: 'nonviable' }[outcome.summary];
      requireValue(status !== undefined, 'Unresolved Cargo outcome: ' + outcome.summary);
      rustScenario(outcome, status);
      normalized.push({ id, file: generated.get(id), raw_status: outcome.summary, status });
    }
    unique(normalized.map(outcome => outcome.id), 'Cargo outcome');
    requireValue(normalized.length === generated.size, 'Missing Cargo mutant outcome');
    const counts = { total_mutants: normalized.length, caught: normalized.filter(x => x.status === 'detected').length,
      missed: normalized.filter(x => x.status === 'survived').length, unviable: normalized.filter(x => x.status === 'nonviable').length, timeout: 0, success: 0 };
    for (const [name, value] of Object.entries(counts)) requireValue(count(outcomes[name], 'Cargo ' + name) === value, 'Cargo summary counter mismatch: ' + name);
    requireValue(execution.exit_code === (counts.missed > 0 ? 2 : 0), 'Cargo exit contradicts complete survivor inventory');
    return assessment('cargo-mutants', '27.1.0', info, normalized);
  } catch (error) { return incomplete('cargo-mutants', '27.1.0', execution, error); }
}

function strykerFile(file, projectRoot) {
  let normalized = text(file, 'Stryker filename').replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    const root = text(projectRoot, 'Stryker project root').replaceAll('\\', '/').replace(/\/$/, '');
    const insensitive = /^[A-Za-z]:/.test(root);
    requireValue((insensitive ? normalized.toLowerCase() : normalized).startsWith((insensitive ? root.toLowerCase() : root) + '/'), 'Stryker file escaped project root');
    normalized = normalized.slice(root.length + 1);
  }
  return relative(normalized);
}

function strykerIdentity(mutant, file) {
  record(mutant, 'Stryker mutant');
  return { id: text(mutant.id, 'Stryker mutant ID'), file,
    mutatorName: text(mutant.mutatorName, 'Stryker mutator'), location: span(mutant.location, 1),
    replacement: text(mutant.replacement, 'Stryker replacement', true) };
}

function strykerBaseline(dryRun) {
  record(dryRun, 'Stryker dry run');
  requireValue(dryRun.result?.status === 'complete' && Array.isArray(dryRun.result.tests) && dryRun.result.tests.length > 0, 'Stryker dry run is incomplete or empty');
  unique(dryRun.result.tests.map(test => text(test.id, 'dry-run test ID')), 'dry-run test');
  requireValue(dryRun.result.tests.every(test => test.status === 0), 'Stryker dry-run tests failed/skipped or have invalid status');
}

export function normalizeCiMutation(input = {}) {
  let execution;
  try {
    const { report, plan, dryRun } = record(input, 'Stryker adapter input');
    execution = input.execution;
    const info = executionInfo(execution, 'stryker');
    requireValue(info.baseline.ignored === 0, 'CI-helper baseline cannot skip tests');
    noCachedFlags(report); noCachedFlags(plan); noCachedFlags(dryRun);
    record(report, 'Stryker report');
    requireValue(report.schemaVersion === '1.0' && report.framework?.name === 'StrykerJS' && report.framework.version === '10.1.1', 'Stryker report/engine version mismatch');
    requireValue(report.config?.incremental === false && report.config.inPlace === false, 'Stryker must run fresh, outside the working tree');
    strykerBaseline(dryRun);
    requireValue(Array.isArray(plan?.mutantPlans) && plan.mutantPlans.length > 0, 'Missing Stryker generated plan');
    const generated = new Map();
    const generatedIds = [];
    for (const item of plan.mutantPlans) {
      requireValue(item.plan === 'Run', 'Early/reused Stryker results cannot certify fresh execution');
      const mutant = record(item.mutant, 'Stryker planned mutant'), location = span(mutant.location, 0);
      // Stryker 10.1.1 objectUtils.toSchemaPosition adds one to both internal
      // plan coordinates before reporting; retain exact identity in that schema basis.
      for (const edge of ['start', 'end']) {
        location[edge] = position({ line: location[edge].line + 1, column: location[edge].column + 1 }, 1);
      }
      const identity = strykerIdentity({ ...mutant, location }, strykerFile(mutant.fileName, report.projectRoot));
      generatedIds.push(identity.id); generated.set(identity.id, identity);
    }
    unique(generatedIds, 'generated Stryker ID');
    verifyScope([...generated.values()].map(x => x.file), info.scope);
    record(report.files, 'Stryker files');
    const files = Object.keys(report.files).map(file => strykerFile(file, report.projectRoot));
    unique(files, 'Stryker report file'); verifyScope(files, info.scope);
    const normalized = [];
    for (const [filename, result] of Object.entries(report.files)) {
      const file = strykerFile(filename, report.projectRoot);
      text(result.language, 'Stryker source language'); text(result.source, 'Stryker original source');
      requireValue(Array.isArray(result.mutants) && result.mutants.length > 0, 'Empty Stryker file outcome');
      for (const mutant of result.mutants) {
        const identity = strykerIdentity(mutant, file), expected = generated.get(identity.id);
        requireValue(expected && hash(expected) === hash(identity), 'Unknown/substituted Stryker mutant');
        const status = { Killed: 'detected', Survived: 'survived', CompileError: 'nonviable' }[mutant.status];
        requireValue(status !== undefined, 'Unresolved Stryker outcome: ' + mutant.status);
        if (mutant.testsCompleted !== undefined) count(mutant.testsCompleted, 'Stryker tests completed');
        normalized.push({ id: identity.id, file, raw_status: mutant.status, status });
      }
    }
    unique(normalized.map(outcome => outcome.id), 'Stryker outcome ID');
    requireValue(normalized.length === generated.size, 'Missing Stryker mutant outcome');
    return assessment('stryker', '10.1.1', info, normalized);
  } catch (error) { return incomplete('stryker', '10.1.1', execution, error); }
}
