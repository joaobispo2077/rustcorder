import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  cliOptions, collectEvidence, digest, ensure, jobNames, jsonFile, loadPolicy, object,
  readiness, requiredGates, safeRelativePath, textValue, utcTime, validateContext, validatePolicy,
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

export function measurementSummary(row, policy) {
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
  writeJson(path.join(out, 'pr-quality-projection.json'), prProjection(rendered.json));
  if (summaryPath) {
    try { appendFileSync(summaryPath, rendered.markdown + '\n', 'utf8'); }
    catch (error) { console.error('Optional job-summary delivery failed: ' + error.message); }
  }
  return rendered;
}

export function boundedReportValue(value, depth=0) {
  ensure(depth<=8,'Report value nesting exceeds bound');
  if(value===null || typeof value==='boolean')return value;
  if(typeof value==='number'){ensure(Number.isFinite(value) && Math.abs(value)<=Number.MAX_SAFE_INTEGER,'Invalid report number');return value;}
  if(typeof value==='string')return value.slice(0,1024);
  if(Array.isArray(value))return value.slice(0,32).map(item=>boundedReportValue(item,depth+1));
  object(value,'bounded report value');ensure(Object.keys(value).length<=128,'Report field population exceeds bound');
  return Object.fromEntries(Object.entries(value).slice(0,64).map(([key,item])=>[key.slice(0,128),boundedReportValue(item,depth+1)]));
}

export function prProjection(report) {
  ensure(report.schema_version===1,'Invalid full report schema');validateContext(report.context);
  const policy=loadPolicy(),known=new Set(Object.keys(policy.gate_owners));
  ensure(Array.isArray(report.gates) && report.gates.length<=known.size,'Invalid projection gate population');
  const seen=new Set();
  const gates=report.gates.map(row=>{
    ensure(known.has(row.gate) && !seen.has(row.gate),'Unknown or repeated projection gate');seen.add(row.gate);
    ensure(['pass','fail','incomplete','excluded'].includes(row.status),'Invalid projection gate status');
    return {gate:row.gate,status:row.status,required:row.required,applicable:row.applicable,
      reason:row.reason?.slice(0,1024)??null,counts:boundedReportValue(row.counts??null),
      measurements:boundedReportValue(row.measurements??null),summary:measurementSummary(row,report.policy).slice(0,2048)};
  });
  const projection={schema_version:1,kind:'pr-quality-projection',context:report.context,
    preliminary:{ready:report.assessment.ready,reasons:report.assessment.reasons.slice(0,64).map(item=>String(item).slice(0,1024))},
    construction_errors:boundedReportValue(report.collection_errors??[]),gates,full_artifact:'quality-'+report.context.run_id+'-'+report.context.run_attempt};
  ensure(Buffer.byteLength(JSON.stringify(projection))<=1048576,'PR projection exceeds size bound');return projection;
}

export function parsePrProjection(bytes) {
  ensure(Buffer.isBuffer(bytes) && bytes.length<=1048576,'PR projection exceeds size bound');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  ensure(value.schema_version===1 && value.kind==='pr-quality-projection','Invalid PR projection schema');validateContext(value.context);
  ensure(value.full_artifact==='quality-'+value.context.run_id+'-'+value.context.run_attempt,'Wrong full quality artifact identity');
  const known=new Set(Object.keys(loadPolicy().gate_owners)),seen=new Set();
  ensure(Array.isArray(value.gates) && value.gates.length<=known.size,'Invalid projection gates');
  const required=new Set(requiredGates(value.context));
  for(const row of value.gates){
    ensure(known.has(row.gate) && !seen.has(row.gate) && ['pass','fail','incomplete','excluded'].includes(row.status),'Invalid projection gate');seen.add(row.gate);
    ensure(row.required===required.has(row.gate) && row.applicable===required.has(row.gate) &&
      (required.has(row.gate)?row.status!=='excluded':row.status==='excluded' && typeof row.reason==='string' && row.reason.length>0),
      'Invalid projection gate applicability/exclusion');
  }
  // Reject oversized/deep structures even when their Markdown would be truncated.
  boundedReportValue(value);return value;
}

function prText(value) {
  return markdownText(value).replace(/@/g,'&#64;').replace(/\(/g,'&#40;').replace(/\)/g,'&#41;').replace(/[\u0000-\u001f\u007f]/g,' ');
}

export function renderPrReport({projection=null,pr,phase,reasons=[],jobs={},run=null}) {
  ensure(['passed','failed','incomplete','pending','superseded','historical'].includes(phase),'Invalid PR report phase');
  const context=projection?.context;
  const identity=run??{id:context.run_id,run_attempt:context.run_attempt,head_sha:context.source_sha};
  const repository=loadPolicy().repository;
  const url='https://github.com/'+repository+'/actions/runs/'+identity.id+'/attempts/'+identity.run_attempt;
  const lines=['<!-- rustcorder-quality-report:v1 -->','# CI quality: '+phase,'',
    'PR #'+pr.number+'; '+(pr.state==='open'?'head':'historical head')+': '+prText(pr.head.sha)+'.',
    'Tested SHA: '+prText(context?.tested_sha??'Not reported')+'.',
    'Run '+identity.id+', attempt '+identity.run_attempt+'. [Open CI evidence]('+url+').','',
    'This report describes this exact CI attempt and grants no release authority.','',
    '| Gate | Result | Measurement / threshold | Counts | Reason |','| --- | --- | --- | --- | --- |'];
  for(const row of projection?.gates??[])lines.push('| '+[labels[row.gate]??row.gate,row.status,row.summary,
    row.counts===null?'Not reported':JSON.stringify(row.counts),row.reason].map(prText).join(' | ')+' |');
  if(!projection)lines.push('', 'Quality report unavailable; final readiness cannot be certified.');
  lines.push('','Reasons: '+(reasons.length?reasons.map(prText).join('; '):'None.'),'',
    'Actual jobs: '+Object.entries(jobs).map(([id,state])=>prText(id)+': '+prText(state)).join('; '),
    '', 'Excluded gates retain their reasons. Missing values are unavailable; zero counts remain zero.',
    'Complete measurements and exclusions are in the full quality artifact on the linked run.');
  const result=lines.join('\n');
  if(Buffer.byteLength(result)<=49152)return result;
  const suffix='\n\nDetails truncated. Open the linked CI run for complete quality evidence.\n';
  // String slicing keeps the output valid UTF-8 and leaves ample room for suffix bytes.
  let shown=result.slice(0,45000);while(Buffer.byteLength(shown+suffix)>49152)shown=shown.slice(0,-512);
  return shown+suffix;
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
