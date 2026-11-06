import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  cliOptions, collectEvidence, digest, ensure, jobNames, jsonFile, loadPolicy, object,
  readiness, safeRelativePath, textValue, utcTime, validateContext, validatePolicy,
  validateReceipt, writeJson,
} from './gates.mjs';

const jobStates = new Set(['success', 'failure', 'cancelled', 'skipped', 'timed_out',
  'action_required', 'neutral', 'stale', 'pending', 'queued', 'in_progress', 'missing', 'unknown']);
const labels = { ui: 'UI draw/input', package: 'Native package smoke' };

function markdownText(value) {
  if (value === null || value === undefined) return 'Not reported';
  const text = String(value);
  const shown = text.length > 512 ? text.slice(0, 512) + '… (complete value in report.json)' : text;
  return shown.replace(/[&<>]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character])
    .replace(/[|\\`*_\[\]]/g, '\\$&').replace(/[\r\n]/g, ' ');
}

function jsonBlock(value) {
  const text = JSON.stringify(value, null, 2);
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), match => match[0].length));
  const fence = '`'.repeat(longest + 1);
  return fence + 'json\n' + text + '\n' + fence;
}

function displayPreview(value, depth = 0) {
  if (typeof value === 'string') return value.length > 512 ? value.slice(0, 512) + '… (complete value in report.json)' : value;
  if (Array.isArray(value)) {
    if (value.length > 16) return { total_items: value.length,
      sample: value.slice(0, 2).map(item => displayPreview(item, depth + 1)), full_data: 'report.json' };
    return value.map(item => displayPreview(item, depth + 1));
  }
  if (value !== null && typeof value === 'object') {
    if (depth >= 5) return { total_fields: Object.keys(value).length, full_data: 'report.json' };
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, displayPreview(item, depth + 1)]));
  }
  return value;
}

function missingGate(gate, reason) {
  return { gate, status: 'incomplete', required: true, applicable: true, completed: false,
    exit_code: null, duration_ms: null, measurements: null, counts: null, raw_outputs: [], reason };
}

function measurementSummary(row, policy) {
  const measurement = row.measurements;
  if (!measurement) return 'Not reported';
  if (row.gate === 'coverage') return ratioSummary(measurement.covered, measurement.total) +
    '; floor ' + (measurement.floor ?? policy.coverage.floor ?? 'unset') + '%';
  if (row.gate === 'duplication') return ratioSummary(measurement.duplicated, measurement.total) +
    '; maximum ' + policy.duplication.max_percent + '%';
  if (row.gate === 'complexity') return 'Per-function maximum ' + policy.complexity.max +
    '; ' + policy.complexity.exceptions.length + ' exact legacy exceptions';
  if (row.gate === 'ui') return measurement.kind ?? 'UI evidence kind not reported';
  if (row.gate === 'package') return measurement.native?.kind ?? measurement.kind ?? 'Native evidence kind not reported';
  if (row.gate.startsWith('mutation-')) return 'detected ' + (measurement.detected ?? 'Not reported') +
    '; survived ' + (measurement.survived ?? 'Not reported') + '; nonviable ' + (measurement.nonviable ?? 'Not reported') +
    '; ' + ratioSummary(measurement.detected, measurement.viable) + '; floor ' +
    (measurement.min_percent ?? policy.mutation[measurement.profile]?.min_percent ?? 'Not reported') + '% ' +
    (measurement.profile ?? 'profile not reported');
  return 'Raw measurements below';
}

function ratioSummary(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) return 'Ratio not reported';
  const ratio = numerator + '/' + denominator;
  return denominator > 0 ? ratio + ' (' + (100 * numerator / denominator).toFixed(2) + '%, display only)' : ratio + ' (percentage unavailable)';
}

function renderMarkdown(report) {
  const { context, assessment, gates, jobs, policy, collection_errors: errors } = report;
  const identity = context.kind === 'local' ? 'Local evidence; dirty: ' + context.dirty : 'Hosted evidence';
  const lines = [
    '# CI quality report', '',
    identity + '. Run ' + markdownText(context.run_id) + ', attempt ' + context.run_attempt + '.',
    'Repository: ' + markdownText(context.repository) + '; branch: ' + markdownText(context.branch) +
      '; event: ' + markdownText(context.event) + '.',
    'Source SHA: ' + context.source_sha + '; tested SHA: ' + context.tested_sha + '.',
    'Workflow SHA: ' + context.workflow_sha + '; generated: ' + report.generated_at + '.', '',
    'Assessment before final CI readiness: **' + (assessment.ready ? 'eligible' : 'blocked') + '**.',
    'This report does not certify the later final CI readiness job or authorize a release.',
    'Percentages are rounded for display only; receipt decisions and raw counts are preserved.', '',
    '| Gate | Result | Duration ms | Measurement / threshold | Reason |',
    '| --- | --- | ---: | --- | --- |',
  ];
  for (const row of gates) lines.push('| ' + [
    labels[row.gate] ?? row.gate, row.status, row.duration_ms,
    measurementSummary(row, policy), row.reason,
  ].map(markdownText).join(' | ') + ' |');
  lines.push('', '| Actual job | State at report construction |', '| --- | --- |');
  const expectedJobs = [...policy.jobs.ordinary, ...(assessment.required_gates.includes('package') ? policy.jobs.release : [])];
  const ids = [...new Set([...expectedJobs, ...Object.keys(jobs)])];
  for (const id of ids) lines.push('| ' + markdownText(jobNames[id] ?? id) + ' | ' + markdownText(jobs[id] ?? 'missing') + ' |');
  lines.push('', 'The report job may still be in progress in this snapshot; the subsequent readiness job verifies its completion.', '', '## Blocking reasons', '');
  if (assessment.reasons.length === 0) lines.push('None in the supplied evidence and job-state snapshot.');
  else for (const reason of assessment.reasons) lines.push('- ' + markdownText(reason));
  if (errors.length) {
    lines.push('', '## Collection errors', '');
    for (const error of errors) lines.push('- ' + markdownText(error.path) + ': ' + markdownText(error.reason));
  }
  lines.push('', '## Gate details', '',
    'Missing measurements are null. Zero counts remain zero. UI drawing/input evidence and native package evidence retain their own kinds and platforms.',
    'Library coverage includes embedded tests; external device/model tests remain explicitly ignored.',
    'Complete measurements, outcome inventories, exclusions and raw file paths/hashes are retained in [report.json](report.json).',
    'Long arrays show their total count and a small sample; long values/deep objects point to the complete JSON.', '');
  if (context.kind === 'hosted') lines.push('[Open this run and its quality-' + context.run_id + '-' + context.run_attempt +
    ' artifact](https://github.com/' + context.repository + '/actions/runs/' + context.run_id + '/attempts/' + context.run_attempt + ').', '');
  for (const row of gates) {
    lines.push('### ' + markdownText(row.gate), '', jsonBlock(displayPreview({
      status: row.status, counts: row.counts ?? null, measurements: row.measurements,
      command: row.command ?? null, raw_outputs: { total_files: row.raw_outputs.length, full_data: 'report.json' },
    })), '');
  }
  lines.push('## Policy scopes and exceptions', '', jsonBlock(displayPreview({
    coverage: policy.coverage, complexity: policy.complexity, duplication: policy.duplication,
    dependencies: policy.dependencies, mutation: policy.mutation, exceptions: policy.exceptions,
  })), '');
  return lines.join('\n');
}

export function renderReport({ context, receipts, errors = [], jobs = {}, policy = loadPolicy(),
  generatedAt = new Date().toISOString() }) {
  validateContext(context);
  validatePolicy(policy);
  utcTime(generatedAt, 'report timestamp');
  ensure(context.repository === policy.repository, 'Report repository/policy mismatch');
  ensure(Array.isArray(receipts) && Array.isArray(errors), 'Report evidence/errors must be arrays');
  object(jobs, 'actual job states');
  for (const [id, state] of Object.entries(jobs)) {
    ensure(/^[A-Za-z0-9_-]+$/.test(id) && jobStates.has(state), 'Invalid actual job identity/state');
  }
  const seen = new Set();
  for (const receipt of receipts) {
    validateReceipt(receipt, context);
    ensure(!seen.has(receipt.gate), 'Duplicate report gate: ' + receipt.gate);
    seen.add(receipt.gate);
  }
  for (const error of errors) {
    object(error, 'collection error'); safeRelativePath(error.path);
    textValue(error.reason, 'collection error reason', 4096);
  }
  const assessment = readiness(context, receipts, jobs, true, policy);
  for (const error of errors) assessment.reasons.push('Collection error ' + error.path + ': ' + error.reason);
  assessment.ready = assessment.reasons.length === 0;
  const gates = assessment.required_gates.map(gate => {
    const receipt = receipts.find(item => item.gate === gate);
    return receipt ? { ...receipt, counts: receipt.counts ?? null, measurements: receipt.measurements ?? null } :
      missingGate(gate, 'Required evidence is missing');
  });
  for (const excluded of assessment.excluded_gates) gates.push({
    ...missingGate(excluded.gate, excluded.reason), status: 'excluded', required: false, applicable: false,
  });
  const json = structuredClone({ schema_version: 1, generated_at: generatedAt, context, assessment,
    jobs, gates, receipts_sha256: digest(JSON.stringify(receipts)), collection_errors: errors, policy });
  return { json, markdown: renderMarkdown(json) };
}

export function writeReport({ root, context, jobs = {}, out = root, summaryPath = null }) {
  let collection;
  try { collection = collectEvidence(root, context); }
  catch (error) { collection = { receipts: [], errors: [{ path: 'collection', reason: error.message }] }; }
  const rendered = renderReport({ context, jobs, ...collection });
  mkdirSync(out, { recursive: true });
  writeJson(path.join(out, 'report.json'), rendered.json);
  writeFileSync(path.join(out, 'report.md'), rendered.markdown, 'utf8');
  if (summaryPath) {
    try { appendFileSync(summaryPath, rendered.markdown + '\n', 'utf8'); }
    catch (error) { console.error('Optional job-summary delivery failed: ' + error.message); }
  }
  return rendered;
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const options = cliOptions(argv);
  for (const name of Object.keys(options)) ensure(['root', 'context', 'jobs', 'out'].includes(name), 'Unsupported report option');
  ensure(options.root && options.context, 'Report requires --root and --context');
  const jobs = options.jobs ? jsonFile(options.jobs) : JSON.parse(env.CI_JOB_STATES ?? '{}');
  return writeReport({ root: path.resolve(options.root), context: jsonFile(options.context), jobs,
    out: path.resolve(options.out ?? options.root), summaryPath: env.GITHUB_STEP_SUMMARY ?? null });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
