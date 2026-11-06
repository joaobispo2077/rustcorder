import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// This parser is an installed dependency of the pinned Stryker instrumenter.
import { parse } from '@babel/parser';

export const mutationRepoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const ciRoot = fileURLToPath(new URL('./', import.meta.url));
export const criticalFunctions = Object.freeze({
  'gates.mjs': Object.freeze(['validateContext', 'validateReceipt', 'promotion', 'commitPolicy', 'requiredGates', 'readiness']),
  'release.mjs': Object.freeze(['verifyArtifactMetadata', 'verifyApproval', 'confirmPreparation', 'verifyCandidate']),
  'report.mjs': Object.freeze(['missingGate', 'measurementSummary', 'ratioSummary', 'renderReport']),
  'mutation.mjs': Object.freeze(['normalizeRustMutation', 'normalizeCiMutation', 'assessment', 'executionInfo', 'verifyScope']),
});
// Policy CI discovers every helper suite once. Per-mutant runs use pure decision
// tests so Git preparation and native archive extraction do not repeat 670 times.
const lightTests = Object.freeze(['contracts', 'context', 'promotion', 'workflows', 'release-decisions']);

function assertProfile(profile) {
  if (profile !== 'light' && profile !== 'full') throw new Error('Unknown mutation profile');
}

export function mutationTestFiles(profile = 'light') {
  assertProfile(profile);
  return [...lightTests, ...(profile === 'full' ? ['report', 'mutation'] : [])].map(name => 'scripts/ci/tests/' + name + '.test.mjs');
}

function shellQuote(value) {
  if (process.platform === 'win32') {
    if (/["%!\r\n]/.test(value)) throw new Error('Unsupported shell metacharacter in Node executable path');
    return '"' + value + '"';
  }
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export function mutationCommand(profile = 'light') {
  // Per-mutant TAP repeats the entire successful suite inside every failure report.
  // The separate baseline retains TAP counts; compact mutant diagnostics preserve exits.
  return [shellQuote(process.execPath), '--test', '--test-reporter=dot', ...mutationTestFiles(profile)].join(' ');
}

export function namedMutationRanges(source, filename, names) {
  const functions = parse(source, { sourceType: 'module' }).program.body.map(node => node.type === 'ExportNamedDeclaration' ? node.declaration : node)
    .filter(node => node?.type === 'FunctionDeclaration');
  return names.map(name => {
    const matches = functions.filter(node => node.id?.name === name);
    if (matches.length !== 1) throw new Error('Missing/ambiguous critical function: ' + filename + ':' + name);
    const { start, end } = matches[0].loc;
    // Stryker 10 ranges use one-based lines and zero-based columns.
    return filename + ':' + start.line + ':' + start.column + '-' + end.line + ':' + end.column;
  });
}

function ownedOutput(directory) {
  if (typeof directory !== 'string' || !directory) throw new Error('Mutation evidence directory must be a path');
  const absolute = path.resolve(directory), boundary = path.join(mutationRepoRoot, '.build');
  const relative = path.relative(boundary, absolute);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Mutation evidence escaped checkout .build');
  for (let current = absolute; path.relative(mutationRepoRoot, current) !== ''; current = path.dirname(current)) {
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('Redirected mutation evidence path'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return absolute;
}

export function createStrykerConfig(profile = 'light', { evidenceDirectory = path.join(mutationRepoRoot, '.build', 'mutation-ci-' + randomUUID()), dryRunOnly = false } = {}) {
  assertProfile(profile);
  if (typeof dryRunOnly !== 'boolean') throw new Error('dryRunOnly must be a boolean');
  const evidence = ownedOutput(evidenceDirectory);
  const sources = ['gates.mjs', 'release.mjs', ...(profile === 'full' ? ['report.mjs', 'mutation.mjs'] : [])];
  const mutate = sources.flatMap(name => namedMutationRanges(readFileSync(path.join(ciRoot, name), 'utf8'), 'scripts/ci/' + name, criticalFunctions[name]));
  for (const test of mutationTestFiles(profile)) if (!existsSync(path.join(mutationRepoRoot, test))) throw new Error('Missing declared mutation test: ' + test);
  const modules = path.join(ciRoot, 'node_modules');
  if (!existsSync(modules)) throw new Error('Install the locked CI dependencies before mutation testing');
  // Stryker's automatic link discovery walks unrelated build outputs. Link only
  // our installed dependencies, inside its copied sandbox, before test startup.
  const link = "require('node:fs').symlinkSync(Buffer.from('" + Buffer.from(modules).toString('base64') + "','base64').toString('utf8'),'scripts/ci/node_modules','" + (process.platform === 'win32' ? 'junction' : 'dir') + "')";
  return {
    testRunner: 'command', commandRunner: { command: mutationCommand(profile) }, plugins: [],
    mutate, coverageAnalysis: 'off', allowEmpty: false,
    incremental: false, inPlace: false, symlinkNodeModules: false,
    // buildCommand uses execaCommand token parsing, not the command runner shell.
    buildCommand: process.execPath.replaceAll(' ', '\\ ') + ' -e ' + link,
    ignorePatterns: ['/.build', '/dist', '/target', '/reports', '/.agents', '/.claude', '/.codex', '/.specify', '/specs'],
    reporters: ['json', 'event-recorder'],
    jsonReporter: { fileName: path.join(evidence, 'stryker-report.json') },
    eventReporter: { baseDir: path.join(evidence, 'stryker-events') },
    // Timeout leftovers can contain a dependency link; keep source copies out
    // of raw evidence so incomplete receipts can still be written and uploaded.
    tempDirName: ownedOutput(path.join(mutationRepoRoot, '.build', 'ci-mutation-scratch-' + randomUUID())), cleanTempDir: 'always',
    concurrency: 2, timeoutMS: 5000, timeoutFactor: 1.5, dryRunTimeoutMinutes: 2,
    thresholds: { high: 80, low: 60, break: null },
    dryRunOnly, logLevel: 'warn',
  };
}

export default createStrykerConfig;
