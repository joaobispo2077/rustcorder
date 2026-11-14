import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, realpathSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeCommits } from '@semantic-release/commit-analyzer';
import { generateNotes } from '@semantic-release/release-notes-generator';
import semver from 'semver';
import {
  ensure, counter, textValue, SHA, SHA256, ciRoot, repoRoot, git, gitBytes, digest,
  validateContext, validatePolicy, loadPolicy, jsonFile, writeJson, cliOptions, githubJson, jobNames, safeRelativePath,
  collectEvidence, readiness, isModuleDeclarations, boundedBytes, containedFile, filesBelow,
} from './gates.mjs';

const logger = { log() {} };

const automaticDigests = Object.freeze({
  'automatic-preparation': 'preparation_sha256',
  'metadata-intent': 'intent_sha256',
  'automatic-candidate': 'candidate_sha256',
  'automatic-publication-authority': 'authority_sha256',
  'automatic-publication-receipt': 'receipt_sha256',
});

export function validateReleasePolicy(policy) {
  ensure(policy && typeof policy === 'object' && !Array.isArray(policy) &&
    Object.keys(policy).sort().join('|') === 'automation_enabled|initial_version|schema_version', 'Invalid automatic release policy fields');
  ensure(policy.schema_version === 1 && typeof policy.automation_enabled === 'boolean', 'Invalid automatic release policy');
  ensure(policy.initial_version === null || (typeof policy.initial_version === 'string' &&
    semver.valid(policy.initial_version) === policy.initial_version && !semver.prerelease(policy.initial_version) &&
    !policy.initial_version.includes('+')), 'Initial release version must be explicit stable SemVer or null');
  return policy;
}

export function loadReleasePolicy(cwd = repoRoot) {
  return validateReleasePolicy(jsonFile(path.join(cwd, 'scripts/ci/release-policy.json')));
}

export function sealAutomaticRecord(kind, body) {
  ensure(Object.hasOwn(automaticDigests, kind), 'Unknown automatic release record kind');
  const field = automaticDigests[kind];
  ensure(!Object.hasOwn(body, field), 'Automatic record is already sealed');
  const value = { ...structuredClone(body), schema_version: 2, kind };
  return validateAutomaticRecord({ ...value, [field]: canonicalDigest(value) }, kind);
}

export function validateAutomaticRecord(record, kind) {
  ensure(Object.hasOwn(automaticDigests, kind) && record?.schema_version === 2 && record.kind === kind, 'Automatic release record schema/kind mismatch');
  const field = automaticDigests[kind], { [field]: checksum, ...body } = record;
  ensure(typeof checksum === 'string' && SHA256.test(checksum) && canonicalDigest(body) === checksum, 'Automatic record digest mismatch');
  ensure(record.repository === loadPolicy().repository && typeof record.source_sha === 'string' && SHA.test(record.source_sha), 'Automatic record source/repository mismatch');
  ensure(typeof record.release_policy_sha256 === 'string' && SHA256.test(record.release_policy_sha256), 'Missing automatic release policy identity');
  ensure(typeof record.version === 'string' && semver.valid(record.version) === record.version &&
    !semver.prerelease(record.version) && !record.version.includes('+'), 'Invalid automatic record version');
  counter(record.control?.run_id, 'automatic control run', true);
  counter(record.control.run_attempt, 'automatic control attempt', true);
  counter(record.control.workflow_id, 'automatic control workflow', true);
  ensure(typeof record.control.source_sha === 'string' && SHA.test(record.control.source_sha), 'Invalid automatic control SHA');
  return record;
}

export function validateAutomaticAuthority(candidate, authority, policy) {
  validateAutomaticRecord(candidate, 'automatic-candidate');
  validateAutomaticRecord(authority, 'automatic-publication-authority');
  validateReleasePolicy(policy);
  ensure(authority.actor==='automatic-ci' && Object.keys(authority).sort().join('|')===
    'actor|authority_sha256|candidate_sha256|control|intent_sha256|kind|preparation_sha256|release_policy_sha256|repository|schema_version|source_sha|version',
  'Automatic authority cannot contain manual approval identity or fields');
  ensure(policy.automation_enabled === true && candidate.release_policy_sha256 === canonicalDigest(policy), 'Automatic publication is disabled or its policy changed');
  for (const field of ['repository', 'source_sha', 'version', 'release_policy_sha256', 'candidate_sha256', 'intent_sha256', 'preparation_sha256']) {
    ensure(typeof candidate[field] === 'string' && authority[field] === candidate[field], 'Automatic authority binding mismatch: ' + field);
  }
  ensure(SHA256.test(candidate.intent_sha256) && SHA256.test(candidate.preparation_sha256) &&
    canonicalDigest(candidate.control) === canonicalDigest(authority.control), 'Automatic authority control/intent mismatch');
  return true;
}

export function releaseHeadings(changelog) {
  ensure(typeof changelog === 'string' && Buffer.byteLength(changelog) <= 8 * 1024 * 1024 && !changelog.includes('\0'), 'Invalid release notes source');
  const pattern = /^(#{1,2}) (?:\[v?(\d+\.\d+\.\d+)\](?:\([^\r\n]*\))?|v?(\d+\.\d+\.\d+))(?: - (\d{4}-\d{2}-\d{2})| \((\d{4}-\d{2}-\d{2})\))\r?$/gm;
  return [...changelog.matchAll(pattern)].map(match => {
    const version = match[2] ?? match[3], date = match[4] ?? match[5];
    ensure(semver.valid(version) === version && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date, 'Invalid release heading version/date');
    return { version, date, index: match.index, end: match.index + match[0].length, angular: Boolean(match[5]) };
  });
}

export function releaseEntry(changelog, version) {
  ensure(semver.valid(version) === version, 'Invalid release notes version');
  const headings = releaseHeadings(changelog), matches = headings.filter(entry => entry.version === version);
  ensure(matches.length === 1, 'Missing/ambiguous confirmed release notes');
  const entry = matches[0], next = headings.find(heading => heading.index > entry.index);
  const notes = changelog.slice(entry.angular ? entry.index : entry.end, next?.index ?? changelog.length).trim();
  ensure(notes.length > 0 && Buffer.byteLength(notes) <= 262144, 'Missing/oversized release notes');
  return notes;
}

export function verifyArtifactMetadata(raw, frozen, runId) {
  counter(frozen.id, 'artifact ID', true); counter(frozen.size_in_bytes, 'artifact bytes', true);
  ensure(/^sha256:[a-f0-9]{64}$/.test(frozen.api_digest) && frozen.size_in_bytes <= 512 * 1024 * 1024, 'Invalid bounded artifact');
  ensure(raw.id === frozen.id && raw.name === frozen.name && raw.size_in_bytes === frozen.size_in_bytes &&
    raw.digest === frozen.api_digest && raw.expired === false && raw.workflow_run?.id === runId, 'Immutable artifact metadata changed');
  return true;
}

export async function downloadArtifact(repository, frozen, runId, target, api = githubJson, request = fetch) {
  const endpoint = '/repos/' + repository + '/actions/artifacts/' + frozen.id;
  verifyArtifactMetadata(await api(endpoint), frozen, runId);
  const response = await request('https://api.github.com' + endpoint + '/zip', {
    headers: { Authorization: 'Bearer ' + process.env.GH_TOKEN, Accept: 'application/vnd.github+json' },
    redirect: 'manual', signal: AbortSignal.timeout(60000),
  });
  let bytes;
  if (response.status === 302) {
    const url = new URL(response.headers.get('location'));
    ensure(url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /(^|\.)(actions\.githubusercontent\.com|blob\.core\.windows\.net|githubusercontent\.com)$/.test(url.hostname), 'Untrusted artifact redirect');
    bytes = await boundedBytes(await request(url, { redirect: 'error', signal: AbortSignal.timeout(60000) }), 512 * 1024 * 1024);
  } else bytes = await boundedBytes(response, 512 * 1024 * 1024);
  ensure(bytes.length === frozen.size_in_bytes && 'sha256:' + digest(bytes) === frozen.api_digest, 'Artifact archive digest/byte count mismatch');
  const archive = target + '.zip';
  writeFileSync(archive, bytes, {flag:'wx'});
  execFileSync('pwsh', ['-NoProfile', '-File', path.join(ciRoot, 'setup-windows.ps1'),
    '-ExtractArchive', archive, '-ExtractDestination', target], {cwd:repoRoot,timeout:60000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']});
  return target;
}

export async function controlArtifact(id, kind, api = githubJson, { allowHistorical = false, activeControl = null } = {}) {
  counter(id, 'control artifact ID', true);
  ensure(['proposal','preparation','candidate'].includes(kind), 'Unknown control artifact kind');
  const prefix = '/repos/' + loadPolicy().repository;
  const raw = await api(prefix + '/actions/artifacts/' + id);
  counter(raw.workflow_run?.id, 'artifact control run', true);
  let run = await api(prefix + '/actions/runs/' + raw.workflow_run.id);
  if (allowHistorical) {
    const name = raw.name?.match(new RegExp('^' + kind + '-(?:[a-f0-9]{40}-)?' + raw.workflow_run.id + '-([1-9][0-9]*)$'));
    ensure(name, 'Malformed exact-attempt control artifact name');
    const attempt = Number(name[1]); counter(attempt, 'artifact creator attempt', true);
    run = await api(prefix + '/actions/runs/' + raw.workflow_run.id + '/attempts/' + attempt);
  }
  const workflow = await api(prefix + '/actions/workflows/release.yml');
  counter(run.run_attempt, 'control artifact attempt', true);
  const active = activeControl && run.status === 'in_progress' && run.id === activeControl.run_id &&
    run.run_attempt === activeControl.run_attempt && run.head_sha === activeControl.source_sha;
  const recovered = allowHistorical && run.status === 'completed' && ['failure','cancelled'].includes(run.conclusion) &&
    await controlProducerPassed(run,kind==='preparation'?'Prepare automatic release metadata':'Freeze automatic publication candidate',api,
      kind==='preparation'?['Freeze verified preparation','Persist verified preparation']:[]);
  ensure(((run.status === 'completed' && run.conclusion === 'success') || active || recovered) &&
    ['workflow_run','workflow_dispatch'].includes(run.event) && run.head_branch === 'main' &&
    run.repository?.full_name === loadPolicy().repository && run.repository.id === run.head_repository?.id &&
    run.path?.split('@')[0] === '.github/workflows/release.yml' && workflow.path === '.github/workflows/release.yml' &&
    run.workflow_id === workflow.id && raw.workflow_run.head_sha === run.head_sha &&
    (raw.name === kind + '-' + run.id + '-' + run.run_attempt || (kind==='preparation' &&
      new RegExp('^preparation-[a-f0-9]{40}-'+run.id+'-'+run.run_attempt+'$').test(raw.name))), 'Untrusted/stale control artifact provenance');
  if (active) {
    const expected = kind === 'preparation' ? 'Prepare automatic release metadata' : kind === 'candidate' ? 'Freeze automatic publication candidate' : null;
    ensure(expected, 'Unsupported active control artifact role');
    const jobs = await paginate(api, prefix + '/actions/runs/' + run.id + '/attempts/' + run.run_attempt + '/jobs', 'jobs');
    const matches = jobs.filter(job => job.name === expected);
    ensure(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success', 'Control artifact producer job is incomplete');
  }
  const frozen = {id:raw.id,name:raw.name,api_digest:raw.digest,size_in_bytes:raw.size_in_bytes};
  verifyArtifactMetadata(raw,frozen,run.id);
  const target = path.join(releaseScratch('release-input-'),kind);
  await downloadArtifact(loadPolicy().repository,frozen,run.id,target,api);
  return {root:target,artifact:frozen,run};
}

export async function metadataIntentArtifact(id, source, api = githubJson, { activeControl = null, download = downloadArtifact } = {}) {
  counter(id, 'metadata intent artifact', true);
  ensure(typeof source === 'string' && SHA.test(source), 'Invalid metadata intent source');
  const repository=loadPolicy().repository,prefix='/repos/'+repository;
  const raw=await api(prefix+'/actions/artifacts/'+id);
  const name=raw.name?.match(/^metadata-([a-f0-9]{40})-([1-9][0-9]*)-([1-9][0-9]*)$/);
  ensure(name && name[1]===source && raw.workflow_run?.id===Number(name[2]), 'Wrong metadata intent artifact name/origin');
  const runId=Number(name[2]),attempt=Number(name[3]);counter(runId,'intent creator run',true);counter(attempt,'intent creator attempt',true);
  const run=await api(prefix+'/actions/runs/'+runId+'/attempts/'+attempt);
  const workflow=await api(prefix+'/actions/workflows/release.yml');
  const active=activeControl && run.status==='in_progress' && run.id===activeControl.run_id &&
    run.run_attempt===activeControl.run_attempt && run.head_sha===activeControl.source_sha;
  const recoverable=run.status==='completed' && ['failure','cancelled'].includes(run.conclusion);
  const producer=(active || recoverable) && await controlProducerPassed(run,'Write bounded release metadata',api,
    ['Create exact metadata objects','Persist metadata intent']);
  ensure(((run.status==='completed' && run.conclusion==='success') || producer) && run.id===runId && run.run_attempt===attempt &&
    run.event==='workflow_run' && run.head_branch==='main' && run.repository?.full_name===repository &&
    run.repository.id===run.head_repository?.id && workflow.path==='.github/workflows/release.yml' && workflow.state==='active' &&
    run.workflow_id===workflow.id && run.path?.split('@')[0]===workflow.path && raw.workflow_run.head_sha===run.head_sha,
  'Untrusted exact-attempt metadata writer provenance');
  const frozen={id:raw.id,name:raw.name,api_digest:raw.digest,size_in_bytes:raw.size_in_bytes};
  verifyArtifactMetadata(raw,frozen,runId);ensure(frozen.size_in_bytes<=1024*1024,'Metadata intent archive exceeds bound');
  const root=path.join(releaseScratch('release-intent-'),'intent');
  await download(repository,frozen,runId,root,api);
  const entries=filesBelow(root);ensure(entries.length===1 && path.basename(entries[0])==='metadata-intent.json','Unexpected metadata intent archive files');
  const bytes=readFileSync(containedFile(root,'metadata-intent.json'));ensure(bytes.length<=1024*1024,'Metadata intent JSON exceeds bound');
  const record=validateAutomaticRecord(JSON.parse(utf8(bytes)),'metadata-intent');
  ensure(record.source_sha===source && record.control.run_id===runId && record.control.run_attempt===attempt &&
    record.control.source_sha===run.head_sha && record.control.workflow_id===workflow.id &&
    record.control.actor===run.actor?.login && typeof record.parent_sha==='string' && SHA.test(record.parent_sha) &&
    typeof record.expected_tree==='string' && SHA.test(record.expected_tree) && SHA256.test(record.preparation_sha256),
  'Metadata intent record/control identity mismatch');
  metadataWriter(record);
  return {record,artifact:frozen,run,root};
}

async function controlProducerPassed(run,name,api,steps=[]) {
  const jobs=await paginate(api,'/repos/'+loadPolicy().repository+'/actions/runs/'+run.id+'/attempts/'+run.run_attempt+'/jobs','jobs');
  const found=jobs.filter(job=>job.name===name);
  if(found.length!==1 || found[0].run_id!==run.id || found[0].run_attempt!==run.run_attempt)return false;
  if(!steps.length)return found[0].status==='completed' && found[0].conclusion==='success';
  return steps.every(name=>{const matches=found[0].steps?.filter(step=>step.name===name);return matches?.length===1 &&
    matches[0].status==='completed' && matches[0].conclusion==='success';});
}

export function metadataWriter(record) {
  ensure(Boolean(record.app) !== Boolean(record.writer), 'Exactly one authenticated metadata writer is required');
  if(record.app){
    counter(record.app.id,'intent App ID',true);counter(record.app.bot_id,'intent App bot ID',true);
    ensure(typeof record.app.slug==='string' && /^[a-z0-9][a-z0-9-]{0,98}$/.test(record.app.slug) &&
      record.app.login===record.app.slug+'[bot]','Invalid metadata App identity');
    return {id:record.app.bot_id,login:record.app.login};
  }
  counter(record.writer?.id,'token writer identity',true);
  ensure(record.writer.kind==='token' && typeof record.writer.login==='string' &&
    /^[A-Za-z0-9][A-Za-z0-9-]{0,98}(?:\[bot\])?$/.test(record.writer.login),'Invalid authenticated token identity');
  return {id:record.writer.id,login:record.writer.login};
}

export function frozenSourceScope(source, kind = 'hosted', cwd = repoRoot) {
  ensure(SHA.test(source), 'Invalid frozen source');
  const entries = gitBytes(['ls-tree','-r','-z',source,'--','src'],cwd).toString('utf8').split('\0').filter(Boolean);
  ensure(entries.length > 0 && entries.length <= 10000, 'Invalid frozen Rust inventory');
  const contents = new Map(entries.map(entry => {
    const match = entry.match(/^(100644|100755) blob ([a-f0-9]{40})\t(.+\.rs)$/);
    ensure(match, 'Unsupported frozen Rust source entry');
    return [safeRelativePath(match[3]),gitBytes(['cat-file','blob',match[2]],cwd)];
  }));
  const all = [...contents.keys()].sort();
  const declarations = all.filter(file => isModuleDeclarations(contents.get(file).toString('utf8')));
  const inventory = {all,executable:all.filter(file => !declarations.includes(file)),
    non_executable:declarations.map(file => ({path:file,reason:'Only module declarations/comments: no executable lines; below the 50-token duplication population',sha256:digest(contents.get(file))}))};
  const blob = file => gitBytes(['show',source+':'+file],cwd);
  const policy = JSON.parse(blob('scripts/ci/policy.json')); validatePolicy(policy);
  const vad = blob('assets/silero-vad.json');
  return {inventory,policy,policy_sha256:digest(blob('scripts/ci/policy.json')),toolchain_sha256:digest(blob('scripts/ci/toolchain.json')),
    package:{version:manifestVersion(blob('Cargo.toml').toString('utf8')),source_sha:source,
      tree_sha:git(['rev-parse',source+'^{tree}'],cwd),kind,vad:JSON.parse(vad),vad_metadata_sha256:digest(vad)}};
}

function candidateDigest(candidate) {
  const {candidate_sha256,...body} = candidate;
  return canonicalDigest(body);
}

export function validateCandidateRequest(candidate) {
  const automatic = candidate?.schema_version === 2 && candidate.kind === 'automatic-candidate';
  if (automatic) validateAutomaticRecord(candidate, 'automatic-candidate');
  ensure((automatic || (candidate?.schema_version === 1 && candidate.kind === 'release-candidate')) &&
    candidate.repository === loadPolicy().repository && candidate.candidate_sha256 === candidateDigest(candidate), 'Frozen candidate digest/schema mismatch');
  const {candidate_sha256,release_sha256,control,...releaseIdentity} = candidate;
  ensure(SHA256.test(release_sha256) && release_sha256 === canonicalDigest(releaseIdentity), 'Frozen release identity mismatch');
  ensure(typeof candidate.source_sha==='string' && typeof candidate.tree_sha==='string' && SHA.test(candidate.source_sha) && SHA.test(candidate.tree_sha) &&
    semver.valid(candidate.version) === candidate.version && !semver.prerelease(candidate.version) && !candidate.version.includes('+'), 'Invalid frozen candidate identity');
  counter(candidate.control?.run_id,'frozen control run',true); counter(candidate.control.run_attempt,'frozen control attempt',true);
  ensure(SHA.test(candidate.control.source_sha), 'Invalid frozen control SHA');
  ensure(Array.isArray(candidate.files) && candidate.files.length >= 5 && candidate.files.length <= 20, 'Incomplete candidate attachments');
  const names = new Set(), paths = new Set();
  for (const file of candidate.files) {
    ensure(safeRelativePath(file.name) === file.name && !file.name.includes('/') && !names.has(file.name), 'Unsafe/duplicate attachment name');
    ensure(!paths.has(safeRelativePath(file.path)) && SHA256.test(file.sha256), 'Unsafe/duplicate attachment path/hash');
    counter(file.bytes,'attachment bytes',true); names.add(file.name); paths.add(file.path);
  }
  return candidate;
}

export async function prepareFromArtifact({id,reviewed,confirmation,control,out}, api = githubJson) {
  const input = await controlArtifact(id,'proposal',api);
  const proposal = jsonFile(containedFile(input.root,'proposal.json'));
  ensure(proposal.control?.run_id === input.run.id && proposal.control.run_attempt === input.run.run_attempt &&
    proposal.control.source_sha === input.run.head_sha, 'Proposal control provenance mismatch');
  await verifySourceAttempt({repository:proposal.repository,run_id:proposal.context.run_id,
    run_attempt:proposal.context.run_attempt,source_sha:proposal.source_sha},api);
  const refreshed = await createProposal({source_sha:proposal.source_sha,context:proposal.context,
    evidence:proposal.evidence,control:proposal.control,date:proposal.date,initial_version:proposal.previous ? null : proposal.version,
    published:await publishedReleases(proposal.repository,api)});
  ensure(proposalDigest(refreshed) === reviewed, 'Proposal or previous release changed after review');
  const result = await prepareProposal({proposal,reviewed_sha256:reviewed,confirmation,control,fetch:true});
  await verifySourceAttempt({repository:proposal.repository,run_id:proposal.context.run_id,
    run_attempt:proposal.context.run_attempt,source_sha:proposal.source_sha},api);
  const latestPrevious=releaseHistory(repoRoot,proposal.source_sha,await publishedReleases(proposal.repository,api)).previous;
  ensure(canonicalDigest(latestPrevious)===canonicalDigest(proposal.previous),'Release state changed during confirmed preparation');
  mkdirSync(out,{recursive:true});
  for (const file of filesBelow(result.output)) writeFileSync(path.join(out,path.basename(file)),readFileSync(file),{flag:'wx'});
  return result.manifest;
}

export async function certifyReleaseSource(request, { api = githubJson, download = downloadArtifact,
  cwd = repoRoot, scope = frozenSourceScope(request.source_sha, 'hosted', cwd), requireReport = true } = {}) {
  const evidence = await verifySourceAttempt(request,api);
  const root = path.join(releaseScratch('release-candidate-'),'inputs'); mkdirSync(root);
  for (const [kind,artifact] of Object.entries(evidence.artifacts)) {
    await download(request.repository,artifact,request.run_id,path.join(root,kind),api);
  }
  const certificationFile = containedFile(path.join(root,'certification'),'certification.json');
  const certification = jsonFile(certificationFile), context = certification.context;
  validateContext(context);
  ensure(context.kind === 'hosted' && context.source_sha === request.source_sha && context.tested_sha === request.source_sha &&
    context.run_id === request.run_id && context.run_attempt === request.run_attempt && context.event === 'push' &&
    context.branch === 'release' && context.repository === request.repository && context.repository_id === evidence.repository_id &&
    context.head_repository_id === evidence.repository_id && context.workflow_id === evidence.workflow_id &&
    context.policy_sha256 === scope.policy_sha256 && context.toolchain_sha256 === scope.toolchain_sha256, 'Wrong final certification context');
  // Quality contains the validated collection. Package has a separate immutable archive.
  const collected = collectEvidence(path.join(root,'quality'),context,scope);
  ensure(collected.errors.length === 0, 'Final evidence collection failed: '+JSON.stringify(collected.errors));
  const jobs = Object.fromEntries(Object.keys(jobNames).map(id => [id,'success']));
  ensure(certification.ready === true && readiness(context,collected.receipts,jobs,true,scope.policy).ready, 'Final candidate is not ready');
  const packageReceipts = collected.receipts.filter(x => x.gate === 'package');
  ensure(packageReceipts.length === 1 && packageReceipts[0].measurements?.kind === 'hosted-release-package', 'Missing final native package certification');
  const pkgRoot = path.join(root,'package','package');
  const packageMeasurement = (await import('./gates.mjs')).gateMeasurement('package',path.join(root,'package'),scope.policy,cwd,scope);
  ensure(canonicalDigest(packageMeasurement) === canonicalDigest(packageReceipts[0].measurements), 'Package artifact differs from quality receipt');
  const packageManifest = jsonFile(containedFile(pkgRoot,'package-manifest.json'));
  let report = null;
  if (requireReport) {
    report = jsonFile(containedFile(path.join(root, 'quality'), 'report/report.json'));
    validateContext(report.context);
    const { job_id: reportJob, ...reportIdentity } = report.context;
    const { job_id: certificationJob, ...certificationIdentity } = context;
    ensure(report.schema_version === 1 && canonicalDigest(reportIdentity) === canonicalDigest(certificationIdentity) &&
      report.receipts_sha256 === digest(JSON.stringify(collected.receipts)), 'Source quality report differs from certified evidence');
  }
  await verifySourceAttempt(request, api);
  return { root, scope, evidence, context, collected, certification, certificationFile, pkgRoot, packageManifest, report };
}

export async function preflight({preparationId,request,control,out,intent = null,cwd=repoRoot,
  loadPreparation=controlArtifact,certify=certifyReleaseSource}, api = githubJson) {
  const prepared = await loadPreparation(preparationId,'preparation',api,{allowHistorical:Boolean(intent)});
  const manifest = validatePreparation(jsonFile(containedFile(prepared.root,'preparation.json')));
  const preparationControl = manifest.schema_version === 2 ? manifest.control : {
    run_id:manifest.confirmation.run_id,run_attempt:manifest.confirmation.run_attempt,source_sha:manifest.confirmation.workflow_sha };
  ensure(preparationControl.run_id === prepared.run.id && preparationControl.run_attempt === prepared.run.run_attempt &&
    preparationControl.source_sha === prepared.run.head_sha, 'Preparation artifact/control mismatch');
  if (manifest.schema_version === 2) {
    ensure(manifest.control.workflow_id===prepared.run.workflow_id && manifest.control.actor===prepared.run.actor?.login,
      'Automatic preparation creator workflow/actor changed');
    validateAutomaticRecord(intent?.record, 'metadata-intent');
    ensure(intent.record.source_sha === request.source_sha && intent.record.parent_sha === manifest.source_sha &&
      intent.record.expected_tree === manifest.expected_tree && intent.record.version === manifest.version &&
      intent.record.preparation_sha256 === manifest.preparation_sha256 && intent.record.preparation.id === prepared.artifact.id &&
      canonicalDigest(intent.record.preparation) === canonicalDigest(prepared.artifact), 'Final metadata intent/preparation mismatch');
    ensure(prepared.run.event==='workflow_run','Automatic preparation requires CI control provenance');
    const policy = loadReleasePolicy(cwd);
    ensure(policy.automation_enabled && canonicalDigest(policy) === manifest.release_policy_sha256, 'Automatic candidate policy is disabled or changed');
  } else ensure(!intent, 'Manual preparation cannot enter automatic continuation');
  ensure(digest(readFileSync(containedFile(prepared.root,'preparation.patch'))) === manifest.patch_sha256, 'Preparation patch hash mismatch');
  const scope = frozenSourceScope(request.source_sha,'hosted',cwd);
  verifyCandidate(manifest,{sha:request.source_sha,tree_sha:scope.package.tree_sha,
    parents:git(['rev-list','--parents','-n','1',request.source_sha],cwd).split(' ').slice(1),version:scope.package.version});
  ensure(scope.policy_sha256 === manifest.policy_sha256 && scope.toolchain_sha256 === manifest.toolchain_sha256, 'Prepared policy/tool identity changed');
  const published = await publishedReleases(request.repository,api);
  const previous = releaseHistory(cwd,manifest.source_sha,published.filter(x =>
    !(x.tag_name === 'v'+manifest.version && x.target_sha === request.source_sha))).previous;
  ensure(canonicalDigest(previous) === canonicalDigest(manifest.previous), 'Published release state changed since preparation');
  const { evidence, root, context, collected, certificationFile, pkgRoot, packageManifest } =
    await certify(request, { api, scope,cwd, requireReport: manifest.schema_version === 2 });
  mkdirSync(out,{recursive:true});
  const attachments = [
    [containedFile(pkgRoot,packageManifest.zip.path),packageManifest.zip.path],
    [containedFile(pkgRoot,'SHA256SUMS'),'SHA256SUMS'],
    [containedFile(pkgRoot,'package-manifest.json'),'package-manifest.json'],
    [certificationFile,'certification.json'],
  ];
  if (manifest.schema_version === 2) {
    const intentPath = path.join(out,'metadata-intent.json'); writeJson(intentPath,intent.record);
    const policyPath = path.join(out,'release-policy.json'); writeJson(policyPath,loadReleasePolicy(cwd));
    attachments.push([containedFile(prepared.root,'preparation.json'),'preparation.json'],
      [containedFile(path.join(root,'quality'),'report/report.json'),'quality-report.json']);
  }
  const noteText=releaseEntry(gitBytes(['show',request.source_sha+':CHANGELOG.md'],cwd).toString('utf8'),manifest.version);
  const notes = Buffer.from(noteText+'\n');
  const notesPath = path.join(out,'release-notes.md'); writeFileSync(notesPath,notes,{flag:'wx'});
  const files = attachments.map(([src,name]) => {
    writeFileSync(path.join(out,name),readFileSync(src),{flag:'wx'});
    return {name,path:name,bytes:readFileSync(src).length,sha256:digest(readFileSync(src))};
  });
  if (manifest.schema_version === 2) for (const name of ['metadata-intent.json','release-policy.json']) {
    const bytes=readFileSync(path.join(out,name));files.push({name,path:name,bytes:bytes.length,sha256:digest(bytes)});
  }
  files.push({name:'release-notes.md',path:'release-notes.md',bytes:notes.length,sha256:digest(notes)});
  const body = {schema_version:manifest.schema_version,kind:manifest.schema_version === 2 ? 'automatic-candidate' : 'release-candidate',repository:request.repository,version:manifest.version,
    source_sha:request.source_sha,tree_sha:scope.package.tree_sha,previous:manifest.previous,
    preparation:prepared.artifact,preparation_sha256:manifest.preparation_sha256,
    ci:{...request,workflow_id:evidence.workflow_id,repository_id:evidence.repository_id},artifacts:evidence.artifacts,control,files,notes:noteText};
  if (manifest.schema_version === 2) Object.assign(body,{release_policy_sha256:manifest.release_policy_sha256,
    intent_sha256:intent.record.intent_sha256,metadata_intent:intent.artifact});
  const {control:excludedControl,...releaseIdentity} = body;
  const frozen = {...body,release_sha256:canonicalDigest(releaseIdentity)};
  const candidate = {...frozen,candidate_sha256:canonicalDigest(frozen)}; validateCandidateRequest(candidate);
  writeJson(path.join(out,'candidate.json'),candidate);
  writeFileSync(path.join(out,'candidate.md'),'# Publication candidate\n\nVersion: '+candidate.version+'\n\nCommit: '+candidate.source_sha+
    '\n\nEvidence digest: '+candidate.candidate_sha256+'\n\nRequested actions: annotated tag, verified draft attachments, publication.\n\n'+
    (candidate.schema_version===2 ? 'Authorized by the enabled automatic policy and this commit’s complete final CI evidence.\n' :
      'Enter this exact review comment in the protected environment approval:\n\n'+approvalText(candidate)+'\n'));
  // Recheck mutable state after all downloads and hashing, before exposing approval.
  await verifySourceAttempt(request,api);
  return candidate;
}

export async function authorizePublication(candidate, root, control, api = githubJson, cwd = repoRoot,
  {loadPreparation=controlArtifact,loadIntent=metadataIntentArtifact}={}) {
  validateCandidateRequest(candidate);
  ensure(canonicalDigest(candidate.control) === canonicalDigest(control), 'Frozen control run/attempt changed');
  await verifySourceAttempt(candidate.ci,api);
  const now = await loadPreparation(candidate.preparation.id,'preparation',api,{allowHistorical:candidate.schema_version === 2});
  ensure(canonicalDigest(now.artifact) === canonicalDigest(candidate.preparation), 'Frozen preparation artifact changed');
  const scope = frozenSourceScope(candidate.source_sha,'hosted',cwd);
  ensure(scope.package.version === candidate.version && scope.package.tree_sha === candidate.tree_sha, 'Frozen candidate source changed');
  for (const file of candidate.files) {
    const bytes = readFileSync(containedFile(root,file.path));
    ensure(bytes.length === file.bytes && digest(bytes) === file.sha256, 'Frozen attachment changed');
  }
  const state = await verifySourceAttempt(candidate.ci,api);
  ensure(canonicalDigest(state.artifacts) === canonicalDigest(candidate.artifacts), 'Final CI artifact substitution after approval');
  const history = releaseHistory(cwd,candidate.source_sha,(await publishedReleases(candidate.repository,api))
    .filter(x => !(x.tag_name === 'v'+candidate.version && x.target_sha === candidate.source_sha)));
  ensure(canonicalDigest(history.previous) === canonicalDigest(candidate.previous), 'Previous release changed after approval');
  if (candidate.schema_version === 2) {
    const policy=loadReleasePolicy(cwd);
    const intent=await loadIntent(candidate.metadata_intent.id,candidate.source_sha,api);
    ensure(canonicalDigest(intent.artifact)===canonicalDigest(candidate.metadata_intent) &&
      intent.record.intent_sha256===candidate.intent_sha256 && intent.record.preparation_sha256===candidate.preparation_sha256,
    'Automatic metadata intent changed after candidate freeze');
    const authority=sealAutomaticRecord('automatic-publication-authority', {repository:candidate.repository,
      source_sha:candidate.source_sha,version:candidate.version,release_policy_sha256:candidate.release_policy_sha256,
      candidate_sha256:candidate.candidate_sha256,intent_sha256:candidate.intent_sha256,
      preparation_sha256:candidate.preparation_sha256,control,actor:'automatic-ci'});
    validateAutomaticAuthority(candidate,authority,policy);
    const final=await verifySourceAttempt(candidate.ci,api);
    ensure(canonicalDigest(final.artifacts) === canonicalDigest(candidate.artifacts), 'Automatic final CI artifact substitution');
    return authority;
  }
  const prefix = '/repos/'+candidate.repository;
  const approval = verifyApproval(candidate,await api(prefix+'/environments/release-publish'),
    await api(prefix+'/actions/runs/'+control.run_id+'/approvals'));
  const final = await verifySourceAttempt(candidate.ci,api);
  ensure(canonicalDigest(final.artifacts) === canonicalDigest(candidate.artifacts), 'Final CI artifacts changed while checking approval');
  return {...approval,control};
}
export function approvalText(request) {
  return 'Approve ' + request.candidate_sha256 + ' run ' + request.control.run_id + ' attempt ' + request.control.run_attempt;
}

export function verifyApproval(request, environment, reviews) {
  ensure(SHA256.test(request.candidate_sha256) && environment?.name === 'release-publish', 'Invalid frozen approval/environment');
  counter(environment.id, 'environment ID', true);
  const rule = environment.protection_rules?.filter(x => x.type === 'required_reviewers');
  ensure(rule?.length === 1 && Array.isArray(rule[0].reviewers) && rule[0].reviewers.length > 0, 'Required reviewer protection is missing');
  const users = rule[0].reviewers.filter(x => x.type === 'User').map(x => x.reviewer?.id);
  ensure(users.length > 0 && users.every(x => Number.isSafeInteger(x) && x > 0), 'Configure an explicit user reviewer for release publication');
  ensure(Array.isArray(reviews), 'Missing approval history');
  const matches = reviews.filter(x => x.comment?.trim() === approvalText(request) &&
    x.environments?.some(e => e.id === environment.id && e.name === environment.name));
  ensure(!matches.some(x => x.state === 'rejected'), 'Frozen publication request was rejected');
  const approvals = matches.filter(x => x.state === 'approved' && users.includes(x.user?.id));
  ensure(approvals.length > 0, 'No configured reviewer approved the exact frozen request/run/attempt');
  return { actor: textValue(approvals[0].user.login, 'reviewer'), environment_id: environment.id,
    candidate_sha256: request.candidate_sha256, comment: approvalText(request) };
}
export const semanticConfig = {
  preset: 'conventionalcommits',
  parserOpts: { noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES', 'BREAKING', 'BREAKING-CHANGE'] },
  releaseRules: [
    { breaking: true, release: 'major' },
    { type: 'feat', release: 'minor' },
    { type: 'fix', release: 'patch' },
    { type: 'docs', scope: 'release', release: 'patch' },
    { type: 'chore', scope: 'release', release: false },
  ],
};

function semanticCommits(messages) {
  return messages.map((entry, index) => typeof entry === 'string' ?
    { message: entry, hash: String(index).padStart(40, '0') } : { message: entry.message, hash: entry.sha ?? entry.hash });
}

export async function semanticImpact(messages, cwd = repoRoot) {
  return analyzeCommits(semanticConfig, { commits: semanticCommits(messages), cwd, logger });
}

export function notesInputs(messages) {
  ensure(Array.isArray(messages) && messages.length <= 10000, 'Invalid notes commit population');
  return semanticCommits(messages).map(entry => {
    ensure(typeof entry.message === 'string' && Buffer.byteLength(entry.message) <= 262144 &&
      typeof entry.hash === 'string' && SHA.test(entry.hash), 'Invalid notes commit identity');
    const [header, ...rest] = entry.message.replaceAll('\r\n', '\n').split('\n');
    const bang = header.match(/^\w+(?:\([^\r\n)]*\))?!: (.+)$/);
    let normalized = header.replace(/^docs(\(release\))(!?): /, 'fix$1$2: ');
    let body = rest.join('\n');
    if (bang) {
      normalized = normalized.replace(/!: /, ': ');
      if (!/^(?:BREAKING CHANGE|BREAKING CHANGES|BREAKING-CHANGE|BREAKING)(?::|[ \t])+/m.test(body)) body += '\n\nBREAKING CHANGE: ' + bang[1];
    }
    return { ...entry, message: normalized + (body ? '\n' + body : '') };
  });
}

export async function generateReleaseNotes({ commits, version, previous = null, repository,
  source_sha, date = new Date().toISOString().slice(0, 10), cwd = repoRoot }) {
  ensure(typeof repository === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), 'Invalid notes repository');
  ensure(typeof source_sha === 'string' && SHA.test(source_sha) && semver.valid(version) === version &&
    !semver.prerelease(version) && !version.includes('+'), 'Invalid notes version/source');
  ensure(previous === null || semver.valid(previous) === previous, 'Invalid previous notes version');
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date, 'Invalid notes date');
  return generateNotes({ preset: 'angular', parserOpts: semanticConfig.parserOpts,
    writerOpts: { commitsSort: ['subject', 'scope'], finalizeContext: context => ({ ...context, date }) } }, {
    cwd, logger, commits: notesInputs(commits), options: { repositoryUrl: 'https://github.com/' + repository },
    lastRelease: previous ? { version: previous, gitTag: 'v' + previous } : {},
    nextRelease: { version, gitTag: 'v' + version, gitHead: source_sha }, branch: { name: 'release' },
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  ensure(value === null || ['string', 'boolean', 'number'].includes(typeof value), 'Noncanonical release data');
  if (typeof value === 'number') ensure(Number.isFinite(value), 'Nonfinite release data');
  return value;
}

export function canonicalDigest(value) { return digest(JSON.stringify(canonical(value))); }
export function proposalDigest(proposal) {
  const { proposal_sha256, ...body } = proposal;
  return canonicalDigest(body);
}

export function manifestVersion(text) {
  const sections = [...text.matchAll(/^\[package\][ \t]*(?:#[^\r\n]*)?\r?$/gm)];
  ensure(sections.length === 1, 'Expected one literal root package');
  const start = sections[0].index + sections[0][0].length;
  const tail = text.slice(start);
  const next = tail.search(/^\[/m);
  const body = next < 0 ? tail : tail.slice(0, next);
  const names = [...body.matchAll(/^name[ \t]*=[ \t]*"([^"\r\n]+)"[ \t]*(?:#[^\r\n]*)?\r?$/gm)];
  const versions = [...body.matchAll(/^version[ \t]*=[ \t]*"([^"\r\n]+)"[ \t]*(?:#[^\r\n]*)?\r?$/gm)];
  ensure(names.length === 1 && names[0][1] === 'rustcorder' && versions.length === 1, 'Inherited/ambiguous root name or version');
  const version = versions[0][1];
  ensure(semver.valid(version) === version && !semver.prerelease(version) && !version.includes('+'), 'Root version must be stable SemVer');
  return version;
}

function utf8(bytes) {
  ensure(Buffer.isBuffer(bytes), 'Expected original file bytes');
  const text = bytes.toString('utf8');
  ensure(Buffer.from(text, 'utf8').equals(bytes), 'Version files require valid UTF-8');
  return text;
}

function versionToken(text, offset = 0) {
  const matches = [...text.matchAll(/^version[ \t]*=[ \t]*"([^"\r\n]+)"[ \t]*(?:#[^\r\n]*)?\r?$/gm)];
  ensure(matches.length === 1, 'Ambiguous/missing literal version token');
  const match = matches[0], start = offset + match.index + match[0].indexOf('"') + 1;
  return { start, end: start + match[1].length, version: match[1] };
}

export function editVersionFiles(manifestBytes, lockBytes, nextVersion) {
  const manifest = utf8(manifestBytes), lock = utf8(lockBytes);
  const previous = manifestVersion(manifest);
  ensure(semver.valid(nextVersion) === nextVersion && !semver.prerelease(nextVersion) &&
    !nextVersion.includes('+') && semver.gte(nextVersion, previous), 'Invalid/downgraded release version');
  const packageHeader = [...manifest.matchAll(/^\[package\][ \t]*(?:#[^\r\n]*)?\r?$/gm)][0];
  const start = packageHeader.index + packageHeader[0].length;
  const tail = manifest.slice(start), next = tail.search(/^\[/m);
  const manifestToken = versionToken(next < 0 ? tail : tail.slice(0, next), start);
  const markers = [...lock.matchAll(/^\[\[package\]\][ \t]*\r?$/gm)];
  ensure(markers.length > 0 && [...lock.slice(0, markers[0].index).matchAll(/^version[ \t]*=[ \t]*4[ \t]*\r?$/gm)].length === 1, 'Only Cargo lockfile version 4 is supported');
  const roots = [];
  for (const [index, marker] of markers.entries()) {
    const block = lock.slice(marker.index + marker[0].length, markers[index + 1]?.index ?? lock.length);
    const names = [...block.matchAll(/^name[ \t]*=[ \t]*"([^"\r\n]+)"[ \t]*\r?$/gm)];
    ensure(names.length === 1, 'Ambiguous lock package name');
    if (names[0][1] === 'rustcorder' && !/^source[ \t]*=/m.test(block)) {
      roots.push(versionToken(block, marker.index + marker[0].length));
    }
  }
  ensure(roots.length === 1 && roots[0].version === previous, 'Root manifest/lock version mismatch or ambiguity');
  const replace = (text, token) => Buffer.from(text.slice(0, token.start) + nextVersion + text.slice(token.end), 'utf8');
  return { manifest: replace(manifest, manifestToken), lock: replace(lock, roots[0]), previous_version: previous };
}

export function preparedChangelog(original, version, date, notes) {
  ensure(typeof original === 'string' && /^# Changelog\r?\n/.test(original), 'Expected existing changelog header');
  ensure(semver.valid(version) === version && !semver.prerelease(version) && !version.includes('+'), 'Invalid changelog version');
  ensure(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date, 'Invalid preparation date');
  ensure(typeof notes === 'string' && Buffer.byteLength(notes) <= 262144 && !notes.includes('\0'), 'Invalid bounded release notes');
  const headings = releaseHeadings(original);
  ensure(!headings.some(entry => entry.version === version), 'Version already has a changelog entry; reuse its original preparation manifest');
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const normalized = notes.replaceAll('\r\n', '\n').trim();
  const supplied = releaseHeadings(normalized);
  let entry;
  if (supplied.length) {
    ensure(supplied.length === 1 && supplied[0].index === 0 && supplied[0].angular &&
      supplied[0].version === version && supplied[0].date === date, 'Release notes heading identity/date mismatch');
    entry = normalized.replaceAll('\n', eol) + eol;
  } else {
    // Historical interactive preparation accepts plain notes; automated notes have their own Angular heading.
    const text = normalized.replace(/^#+[^\n]*\n+/, '').replace(/^## /gm, '### ') || 'Initial release.';
    entry = '## ' + version + ' - ' + date + eol + eol + text.replaceAll('\n', eol) + eol;
  }
  const placeholder = 'No product release has been recorded. Add a release entry only after explicit' + eol +
    'user confirmation that the task is finished and working.' + eol;
  const retained = headings.length ? original : original.replace(placeholder, '');
  const first = releaseHeadings(retained)[0];
  if (first) return retained.slice(0, first.index) + entry + eol + retained.slice(first.index);
  return retained + (retained.endsWith(eol + eol) ? '' : retained.endsWith(eol) ? eol : eol + eol) + entry;
}

export function reconcileUnpublishedChangelog(original, metadata=[]) {
  ensure(Array.isArray(metadata) && metadata.length<=20,'Unpublished metadata population exceeds bound');
  let result=original;
  for(const [index,record] of [...metadata].reverse().entries()){
    ensure(typeof record.source_sha==='string' && SHA.test(record.source_sha),'Invalid authenticated metadata source');
    const headings=releaseHeadings(result),matches=headings.filter(entry=>entry.version===record.version);
    if(index>0 && !matches.length)continue; // A later authenticated preparation already replaced this entry.
    ensure(matches.length===1,'Unpublished entry changed or conflicts with authenticated metadata');
    const entry=matches[0],next=headings.find(item=>item.index>entry.index);
    const existing=result.slice(entry.index,next?.index??result.length);
    ensure(entry.date===record.date && existing.trim()===record.notes.trim(),'Unpublished entry changed or conflicts with authenticated metadata');
    result=result.slice(0,entry.index)+result.slice(next?.index??result.length);
  }
  return result;
}

export function confirmPreparation(proposal, confirmation) {
  ensure(['bootstrap', 'release'].includes(proposal.state) && typeof proposal.version === 'string' &&
    semver.valid(proposal.version) === proposal.version, 'No version is eligible for preparation');
  ensure(confirmation?.completion === true, 'Explicit completion confirmation is required');
  if (proposal.state === 'bootstrap') ensure(confirmation.bootstrap === true, 'Explicit first-version confirmation is required');
  return true;
}

export function verifyMetadataGraph(before, after, oldVersion, nextVersion) {
  function normalized(metadata, expectedVersion) {
    ensure(Array.isArray(metadata.packages), 'Missing Cargo package graph');
    const roots = metadata.packages.filter(x => x.name === 'rustcorder' && x.source === null);
    ensure(roots.length === 1 && roots[0].version === expectedVersion, 'Cargo root identity/version mismatch');
    const root = roots[0].id;
    textValue(root, 'opaque root Cargo ID', 4096);
    ensure(metadata.resolve?.root === root && Array.isArray(metadata.resolve.nodes), 'Incomplete Cargo resolution graph');
    const value = structuredClone(metadata);
    const id = input => input === root ? '$ROOT_ID' : input;
    for (const pkg of value.packages) {
      if (pkg.id === root) { pkg.id = '$ROOT_ID'; pkg.version = '$ROOT_VERSION'; }
    }
    for (const field of ['workspace_members', 'workspace_default_members']) {
      ensure(Array.isArray(value[field]), 'Missing Cargo workspace identities');
      value[field] = value[field].map(id);
    }
    value.resolve.root = id(value.resolve.root);
    for (const node of value.resolve.nodes) {
      node.id = id(node.id);
      ensure(Array.isArray(node.dependencies), 'Missing Cargo node dependencies');
      node.dependencies = node.dependencies.map(id);
      for (const dependency of node.deps ?? []) dependency.pkg = id(dependency.pkg);
    }
    return value;
  }
  ensure(canonicalDigest(normalized(before, oldVersion)) === canonicalDigest(normalized(after, nextVersion)), 'Non-root Cargo metadata/dependency graph drift');
  return true;
}

export function releaseScratch(prefix) {
  const boundary = path.join(repoRoot, '.build');
  mkdirSync(boundary, { recursive: true });
  ensure(realpathSync(boundary).startsWith(realpathSync(repoRoot) + path.sep), 'Redirected preparation cache');
  return mkdtempSync(path.join(realpathSync(boundary), prefix));
}

export function exportSource(cwd, source, target) {
  const entries = gitBytes(['ls-tree', '-r', '-z', '--full-tree', source], cwd).toString('utf8').split('\0').filter(Boolean);
  ensure(entries.length > 0 && entries.length <= 10000, 'Invalid/bounded source inventory');
  let total = 0;
  for (const entry of entries) {
    const match = entry.match(/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/);
    ensure(match, 'Source export refuses symlinks, submodules and unsupported modes');
    const relative = safeRelativePath(match[3]);
    ensure(!relative.split('/').some(x => x.toLowerCase() === '.git'), 'Source export cannot contain Git control files');
    const bytes = gitBytes(['cat-file', 'blob', match[2]], cwd);
    total += bytes.length;
    ensure(bytes.length <= 32 * 1024 * 1024 && total <= 256 * 1024 * 1024, 'Source export exceeded byte limits');
    const destination = path.join(target, relative);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: 'wx', mode: match[1] === '100755' ? 0o755 : 0o644 });
  }
  return entries.length;
}

export function cargoMetadata(directory, { fetch = false } = {}) {
  ensure(process.platform === 'win32', 'Confirmed preparation requires the pinned Windows Cargo environment');
  const env = { ...process.env, RUSTUP_TOOLCHAIN: jsonFile(path.join(ciRoot, 'toolchain.json')).rust };
  const prefix = ['-NoProfile', '-File', path.join(repoRoot, 'scripts/dev.ps1')];
  const manifest = path.join(directory, 'Cargo.toml');
  // Cargo discovers configuration from cwd. Keep the trusted control checkout as
  // cwd and pass the candidate manifest explicitly; never enter its .cargo tree.
  const run = args => execFileSync('powershell.exe', [...prefix, ...args], {
    cwd: repoRoot, env, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (fetch) run(['fetch', '--locked', '--manifest-path', manifest]);
  return JSON.parse(run(['metadata', '--locked', '--offline', '--manifest-path', manifest,
    '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc']));
}

export async function prepareProposal({
  proposal, reviewed_sha256, confirmation, control, cwd = repoRoot,
  date = proposal.date ?? new Date().toISOString().slice(0, 10), metadata = cargoMetadata, fetch = false, automatic_authority = null,
}) {
  if (automatic_authority) validateSourcePreparationAuthority(automatic_authority, proposal);
  else confirmPreparation(proposal, confirmation);
  ensure(typeof reviewed_sha256 === 'string' && SHA256.test(reviewed_sha256) &&
    proposal.proposal_sha256 === reviewed_sha256 && proposalDigest(proposal) === reviewed_sha256, 'Reviewed proposal digest mismatch');
  const source = proposal.source_sha;
  ensure(SHA.test(source), 'Invalid preparation source');
  counter(control?.run_id, 'confirmation run', true); counter(control.run_attempt, 'confirmation attempt', true);
  textValue(control.actor, 'completion actor');
  const scratch = releaseScratch('release-preparation-');
  const exported = path.join(scratch, 'source'); mkdirSync(exported);
  exportSource(cwd, source, exported);
  const files = Object.fromEntries(['Cargo.toml', 'Cargo.lock', 'CHANGELOG.md'].map(name => [name, readFileSync(path.join(exported, name))]));
  if (automatic_authority) {
    const snapshot = path.join(exported, 'docs/quality-metrics.md');
    files['docs/quality-metrics.md'] = existsSync(snapshot) ? readFileSync(snapshot) : Buffer.alloc(0);
  }
  ensure(manifestVersion(utf8(files['Cargo.toml'])) === proposal.manifest_version, 'Source version changed after proposal');
  const before = await metadata(exported, { fetch });
  const edited = editVersionFiles(files['Cargo.toml'], files['Cargo.lock'], proposal.version);
  ensure(readFileSync(path.join(exported, 'Cargo.lock')).equals(files['Cargo.lock']) &&
    readFileSync(path.join(exported, 'Cargo.toml')).equals(files['Cargo.toml']), 'Cargo changed locked source files before preparation');
  const changelog = Buffer.from(preparedChangelog(reconcileUnpublishedChangelog(utf8(files['CHANGELOG.md']),proposal.authenticated_metadata??[]), proposal.version, date, proposal.notes));
  const changes = { 'Cargo.toml': edited.manifest, 'Cargo.lock': edited.lock, 'CHANGELOG.md': changelog };
  if (automatic_authority) changes['docs/quality-metrics.md'] = Buffer.from(automatic_authority.quality_snapshot);
  for (const [name, bytes] of Object.entries(changes)) {
    mkdirSync(path.dirname(path.join(exported, name)), { recursive: true });
    writeFileSync(path.join(exported, name), bytes);
  }
  const after = await metadata(exported, { fetch: false });
  verifyMetadataGraph(before, after, edited.previous_version, proposal.version);
  for (const [name, bytes] of Object.entries(changes)) ensure(readFileSync(path.join(exported, name)).equals(bytes), 'Cargo changed prepared file bytes: ' + name);
  const objects = path.join(scratch, 'objects'), hooks = path.join(scratch, 'hooks');
  mkdirSync(objects); mkdirSync(hooks);
  const env = { ...process.env, GIT_DIR: git(['rev-parse', '--absolute-git-dir'], cwd),
    GIT_WORK_TREE: exported, GIT_INDEX_FILE: path.join(scratch, 'index'),
    GIT_OBJECT_DIRECTORY: objects,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: path.resolve(cwd, git(['rev-parse', '--git-path', 'objects'], cwd)),
    GIT_OPTIONAL_LOCKS: '0' };
  const indexGit = (args, input) => execFileSync('git', ['-c', 'core.hooksPath=' + hooks, '-c', 'core.fsmonitor=false',
    '-c', 'core.sparseCheckout=false', ...args], { cwd, env, input, maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] });
  indexGit(['read-tree', source]);
  const changed = [];
  for (const [name, bytes] of Object.entries(changes)) {
    if (bytes.equals(files[name])) continue;
    changed.push(name);
    const blob = indexGit(['hash-object', '-w', '--no-filters', '--stdin'], bytes).toString('utf8').trim();
    const existingMode = git(['ls-tree', source, '--', name], cwd).split(' ')[0];
    const mode = existingMode || (automatic_authority && name === 'docs/quality-metrics.md' ? '100644' : '');
    ensure(mode === '100644' || mode === '100755', 'Unexpected prepared file mode');
    indexGit(['update-index', '--add', '--cacheinfo', mode + ',' + blob + ',' + name]);
  }
  ensure(changed.length > 0, 'Preparation produced no changes; reuse the original preparation');
  const expectedTree = indexGit(['write-tree']).toString('utf8').trim();
  const patch = indexGit(['diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--binary', '--full-index', source, '--', ...Object.keys(changes)]);
  ensure(SHA.test(expectedTree) && patch.length > 0, 'Missing preparation tree/patch');
  const body = {
    schema_version: 1, kind: 'confirmed-preparation', repository: proposal.repository,
    source_sha: source, previous: proposal.previous, version: proposal.version, date,
    proposal_sha256: reviewed_sha256, policy_sha256: proposal.context.policy_sha256,
    toolchain_sha256: proposal.context.toolchain_sha256, source_ci: proposal.context,
    confirmation: { completion: true, bootstrap: proposal.state === 'bootstrap' ? true : null,
      workflow_sha: control.source_sha, workflow_id: control.workflow_id,
      run_id: control.run_id, run_attempt: control.run_attempt, actor: control.actor },
    patch_sha256: digest(patch), expected_tree: expectedTree,
    permitted_paths: Object.keys(changes), changed_paths: changed,
    metadata_graph_verified: true,
  };
  const { confirmation: manualConfirmation, schema_version: legacySchema, kind: legacyKind, ...common } = body;
  const manifest = automatic_authority ? sealAutomaticRecord('automatic-preparation', {
    ...common, control, release_policy_sha256: canonicalDigest(automatic_authority.policy),
    source_tree_sha: git(['rev-parse', source + '^{tree}'], cwd),
    source_authority: automatic_authority, commit_date: automatic_authority.commit_date, notes: proposal.notes,
    authenticated_metadata: proposal.authenticated_metadata??[],
    files: Object.fromEntries(Object.entries(changes).map(([name, bytes]) => [name, { bytes: bytes.length, sha256: digest(bytes) }])),
  }) : { ...body, preparation_sha256: canonicalDigest(body) };
  validatePreparation(manifest);
  const output = path.join(scratch, 'artifacts'); mkdirSync(output);
  writeFileSync(path.join(output, 'preparation.patch'), patch);
  writeJson(path.join(output, 'preparation.json'), manifest);
  if (automatic_authority) writeJson(path.join(output,'proposal.json'),proposal);
  if (automatic_authority) writeJson(path.join(output, 'prepared-files.json'), Object.fromEntries(Object.entries(changes)
    .map(([name, bytes]) => [name, { encoding: 'base64', content: bytes.toString('base64') }])));
  writeFileSync(path.join(output, 'apply-instructions.md'),
    automatic_authority ? '# Automatic release preparation\n\nVersion: ' + manifest.version + '\n\nSource: ' + source +
    '\n\nExpected tree: ' + expectedTree + '\n\nOnly the trusted metadata writer may advance the existing release ref after persisting its intent. The resulting commit requires its own complete CI/package/native proof.\n' :
    '# Confirmed release preparation\n\nVersion: ' + manifest.version + '\n\nSource: ' + source +
    '\n\nExpected tree: ' + expectedTree + '\n\nPatch SHA-256: ' + manifest.patch_sha256 +
    '\n\nApply the reviewed patch on the existing release branch. Commit it with exactly this source as its single parent, then push it yourself. ' +
    'The final commit must pass its own release-push CI, package and native-smoke gates. Publication requires a separate protected approval.\n');
  return { manifest, patch, output, scratch };
}

export function validateSourcePreparationAuthority(authority, proposal) {
  validateReleasePolicy(authority?.policy);
  ensure(authority.policy.automation_enabled && authority.complete === true && authority.source_sha === proposal.source_sha &&
    canonicalDigest(authority.source_ci) === canonicalDigest(proposal.context), 'Unverified automatic source preparation authority');
  validateContext(authority.source_ci);
  const context = authority.source_ci, pr = authority.pr;
  ensure(context.kind === 'hosted' && context.event === 'push' && context.branch === 'release' &&
    context.source_sha === authority.source_sha && context.tested_sha === authority.source_sha &&
    context.repository_id === context.head_repository_id, 'Wrong automatic source evidence');
  counter(pr?.number, 'merged release PR', true);
  ensure(pr.merged === true && pr.merge_commit_sha === authority.source_sha && pr.base?.ref === 'release' &&
    pr.head?.ref === 'develop' && pr.base.repo.id === context.repository_id && pr.head.repo.id === context.repository_id,
  'Automatic preparation requires the exact merged develop-to-release PR');
  ensure(typeof authority.quality_snapshot === 'string' && authority.quality_snapshot.startsWith('# Quality metrics\n') &&
    Buffer.byteLength(authority.quality_snapshot) <= 65536, 'Missing bounded preparation quality snapshot');
  ensure(typeof authority.commit_date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(authority.commit_date) &&
    Number.isFinite(Date.parse(authority.commit_date)), 'Invalid frozen metadata commit date');
  ensure(authority.artifacts && ['quality', 'certification', 'package'].every(kind => {
    const artifact = authority.artifacts[kind];
    return artifact && Number.isSafeInteger(artifact.id) && artifact.id > 0 && /^sha256:[a-f0-9]{64}$/.test(artifact.api_digest);
  }), 'Missing frozen automatic source artifacts');
  if (proposal.previous === null) ensure(authority.policy.initial_version === proposal.version, 'Automatic bootstrap policy/version mismatch');
  return true;
}

export function validateAutomaticPreparation(preparation) {
  validateAutomaticRecord(preparation, 'automatic-preparation');
  validateSourcePreparationAuthority(preparation.source_authority, { source_sha: preparation.source_sha,
    context: preparation.source_ci, previous: preparation.previous, version: preparation.version });
  ensure(preparation.release_policy_sha256 === canonicalDigest(preparation.source_authority.policy), 'Preparation release policy mismatch');
  ensure(preparation.metadata_graph_verified === true && SHA.test(preparation.expected_tree) && SHA.test(preparation.source_tree_sha) &&
    SHA256.test(preparation.patch_sha256) && SHA256.test(preparation.proposal_sha256), 'Incomplete automatic preparation tree/graph');
  ensure(preparation.source_ci.policy_sha256 === preparation.policy_sha256 &&
    preparation.source_ci.toolchain_sha256 === preparation.toolchain_sha256, 'Automatic preparation source policy/toolchain drift');
  const allowed = ['Cargo.toml', 'Cargo.lock', 'CHANGELOG.md', 'docs/quality-metrics.md'];
  ensure(Array.isArray(preparation.permitted_paths) && [...preparation.permitted_paths].sort().join('|') === [...allowed].sort().join('|') &&
    Array.isArray(preparation.changed_paths) && preparation.changed_paths.length > 0 &&
    new Set(preparation.changed_paths).size === preparation.changed_paths.length && preparation.changed_paths.every(name => allowed.includes(name)), 'Automatic preparation path drift');
  ensure(preparation.files && Object.keys(preparation.files).sort().join('|') === [...allowed].sort().join('|'), 'Automatic prepared files are incomplete');
  for (const file of Object.values(preparation.files)) {
    counter(file.bytes, 'prepared file bytes', true);
    ensure(file.bytes <= 8 * 1024 * 1024 && typeof file.sha256 === 'string' && SHA256.test(file.sha256), 'Invalid bounded prepared file');
  }
  return preparation;
}

export function validatePreparation(preparation) {
  if (preparation?.schema_version === 2) return validateAutomaticPreparation(preparation);
  ensure(preparation?.schema_version === 1 && preparation.kind === 'confirmed-preparation', 'Unknown preparation schema');
  const { preparation_sha256, ...body } = preparation;
  ensure(typeof preparation_sha256 === 'string' && SHA256.test(preparation_sha256) && canonicalDigest(body) === preparation_sha256, 'Preparation digest mismatch');
  ensure(preparation.repository === loadPolicy().repository && typeof preparation.version === 'string' &&
    semver.valid(preparation.version) === preparation.version && !semver.prerelease(preparation.version) && !preparation.version.includes('+'), 'Preparation repository/version mismatch');
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(preparation.date) && new Date(preparation.date + 'T00:00:00Z').toISOString().slice(0, 10) === preparation.date, 'Invalid preparation date');
  if (preparation.previous === null) ensure(preparation.confirmation?.bootstrap === true, 'Missing bootstrap confirmation');
  for (const field of ['source_sha', 'expected_tree']) ensure(typeof preparation[field] === 'string' && SHA.test(preparation[field]), 'Invalid preparation ' + field);
  for (const field of ['patch_sha256', 'proposal_sha256', 'policy_sha256', 'toolchain_sha256']) ensure(typeof preparation[field] === 'string' && SHA256.test(preparation[field]), 'Invalid preparation ' + field);
  validateContext(preparation.source_ci);
  ensure(preparation.source_ci.kind === 'hosted' && preparation.source_ci.event === 'push' && preparation.source_ci.branch === 'release' &&
    preparation.source_ci.repository === preparation.repository && preparation.source_ci.repository_id === preparation.source_ci.head_repository_id &&
    preparation.source_ci.source_sha === preparation.source_sha && preparation.source_ci.tested_sha === preparation.source_sha &&
    preparation.source_ci.policy_sha256 === preparation.policy_sha256 && preparation.source_ci.toolchain_sha256 === preparation.toolchain_sha256, 'Preparation source evidence mismatch');
  ensure(preparation.confirmation?.completion === true && preparation.metadata_graph_verified === true, 'Missing confirmed/verified preparation');
  counter(preparation.confirmation.run_id, 'preparation control run', true);
  counter(preparation.confirmation.run_attempt, 'preparation control attempt', true);
  counter(preparation.confirmation.workflow_id, 'preparation control workflow', true);
  ensure(typeof preparation.confirmation.workflow_sha === 'string' && SHA.test(preparation.confirmation.workflow_sha), 'Missing preparation control SHA');
  textValue(preparation.confirmation.actor, 'preparation actor');
  const allowed = ['Cargo.toml', 'Cargo.lock', 'CHANGELOG.md'];
  ensure(Array.isArray(preparation.permitted_paths) && [...preparation.permitted_paths].sort().join('|') === [...allowed].sort().join('|'), 'Preparation allowed-path drift');
  ensure(Array.isArray(preparation.changed_paths) && preparation.changed_paths.length > 0 &&
    new Set(preparation.changed_paths).size === preparation.changed_paths.length && preparation.changed_paths.every(x => allowed.includes(x)), 'Preparation changed unexpected paths');
  return preparation;
}

export function verifyCandidate(preparation, candidate) {
  validatePreparation(preparation);
  ensure(typeof candidate.sha === 'string' && SHA.test(candidate.sha) && candidate.sha !== preparation.source_sha, 'Invalid final candidate SHA');
  ensure(candidate.tree_sha === preparation.expected_tree, 'Final candidate tree differs from confirmed preparation');
  ensure(Array.isArray(candidate.parents) && candidate.parents.length === 1 && candidate.parents[0] === preparation.source_sha, 'Final candidate must have one exact prepared source parent');
  ensure(candidate.version === preparation.version && candidate.dirty !== true, 'Candidate version/clean-source identity mismatch');
  return true;
}

export function releaseHistory(cwd, source, published) {
  ensure(typeof source === 'string' && SHA.test(source), 'Invalid source SHA');
  ensure(git(['rev-parse', '--is-shallow-repository'], cwd) === 'false', 'Complete history is required; shallow repository refused');
  ensure(git(['cat-file', '-t', source], cwd) === 'commit', 'Source is not a commit');
  const objects = git(['rev-list', '--objects', '--missing=print', source], cwd);
  ensure(!objects.split('\n').some(x => x.startsWith('?')), 'Incomplete source history');
  const stable = published.filter(x => x.published && /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(x.tag_name) && semver.valid(x.tag_name.slice(1)));
  stable.sort((a, b) => semver.rcompare(a.tag_name.slice(1), b.tag_name.slice(1)));
  const previous = stable[0] ?? null;
  if (previous) {
    ensure(SHA.test(previous.tag_object) && git(['cat-file', '-t', previous.tag_object], cwd) === 'tag', 'Previous release requires an annotated tag');
    const tag = git(['cat-file', '-p', previous.tag_object], cwd);
    ensure(tag.startsWith('object ' + previous.target_sha + '\ntype commit\ntag ' + previous.tag_name + '\n'), 'Annotated release identity mismatch');
    ensure(SHA.test(previous.target_sha) && git(['rev-parse', previous.tag_object + '^{}'], cwd) === previous.target_sha, 'Wrong prior tag target');
    try { git(['merge-base', '--is-ancestor', previous.target_sha, source], cwd); }
    catch { throw new Error('Latest published release is outside source ancestry; synchronize released history'); }
  }
  const range = previous ? previous.target_sha + '..' + source : source;
  const shas = git(['rev-list', '--reverse', '--topo-order', range], cwd).split('\n').filter(Boolean);
  const commits = shas.map(sha => ({
    sha, message: git(['show', '-s', '--format=%B', sha], cwd),
    parents: git(['rev-list', '--parents', '-n', '1', sha], cwd).split(' ').slice(1),
  }));
  return { previous, commits };
}

export function releaseReferences(cwd, source, commits, repository) {
  const messages = commits.map(x => x.message).join('\n');
  const references = new Set();
  const tickets = new Set([...messages.matchAll(/\bRCR-[1-9][0-9]*\b/g)].map(x => x[0]));
  if (tickets.size) {
    const guide = gitBytes(['show', source + ':docs/branching.md'], cwd).toString('utf8');
    const template = guide.match(/\[RCR-[0-9]+\]\((https:\/\/[^\s)]+\/RCR-)[0-9]+\)/);
    ensure(template, 'Ticket references require a configured RCR URL in docs/branching.md');
    for (const ticket of tickets) references.add('[' + ticket + '](' + template[1] + ticket.slice(4) + ')');
  }
  const docs = new Set(gitBytes(['ls-tree', '-r', '-z', '--name-only', source, '--', 'docs'], cwd).toString('utf8').split('\0'));
  const paths = new Set([...messages.matchAll(/\bdocs\/([a-z0-9]+(?:-[a-z0-9]+)*)\.md\b/g)].map(x => x[0]));
  for (const match of messages.matchAll(/\bfeature\/([a-z0-9]+(?:-[a-z0-9]+)*)\b/g)) paths.add('docs/' + match[1] + '.md');
  for (const filename of paths) if (docs.has(filename)) references.add('[' + filename + '](https://github.com/' + repository + '/blob/' + source + '/' + filename + ')');
  return [...references].sort().map(x => '- ' + x).join('\n');
}

export async function createProposal({ cwd = repoRoot, source_sha, context, published = [], evidence = null, control = null, initial_version = null, automatic = false, authenticated_metadata = [], date = new Date().toISOString().slice(0, 10) }) {
  validateContext(context);
  ensure(context.source_sha === source_sha && context.tested_sha === source_sha, 'Proposal needs actual source push evidence');
  const manifest_version = manifestVersion(git(['show', source_sha + ':Cargo.toml'], cwd));
  let state = 'no-release', impact = null, version = null, previous = null, commits = [], notes = '';
  if (context.branch === 'release') {
    ensure(context.kind === 'hosted' && context.event === 'push' &&
      context.repository_id === context.head_repository_id, 'Proposal needs same-repository release-push evidence');
    const history = releaseHistory(cwd, source_sha, published);
    ({ previous, commits } = history);
    ensure(Array.isArray(authenticated_metadata) && authenticated_metadata.length<=20 && (automatic || !authenticated_metadata.length),'Invalid authenticated metadata population');
    const excluded=new Set();
    for(const record of authenticated_metadata){
      ensure(typeof record.source_sha==='string' && SHA.test(record.source_sha) && commits.some(commit=>commit.sha===record.source_sha) &&
        !excluded.has(record.source_sha) && SHA256.test(record.preparation_sha256) && SHA256.test(record.intent_sha256),'Invalid authenticated metadata exclusion');
      excluded.add(record.source_sha);
    }
    commits=commits.filter(commit=>!excluded.has(commit.sha));
    impact = await semanticImpact(commits, cwd);
    state = impact ? previous ? 'release' : 'bootstrap' : 'no-release';
    if (state === 'bootstrap') {
      ensure(initial_version !== null, 'Explicit initial-version adoption setting is required');
      validateReleasePolicy({ schema_version: 1, automation_enabled: false, initial_version });
      version = initial_version;
    } else version = impact ? semver.inc(previous.tag_name.slice(1), impact) : null;
    if (previous) ensure(semver.gte(manifest_version, previous.tag_name.slice(1)), 'Manifest version is behind published ancestry');
    if(automatic && version)ensure(!git(['for-each-ref','--format=%(refname)','refs/tags/v'+version],cwd).split('\n').includes('refs/tags/v'+version),'Version is already reserved; do not replace its commit');
    const eligible = [];
    for (const commit of commits) if (await semanticImpact([commit], cwd)) eligible.push(commit);
    if (version) {
      notes = await generateReleaseNotes({ commits: eligible, version, previous: previous?.tag_name.slice(1) ?? null,
        repository: context.repository, source_sha, date, cwd });
      notes += '\nSee [release guidance](https://github.com/' + context.repository + '/blob/' + source_sha + '/docs/ci-quality-release-plan.md).\n';
      const references = releaseReferences(cwd, source_sha, eligible, context.repository);
      if (references) notes += '\nReferences:\n\n' + references + '\n';
    }
  } else ensure(context.branch === 'main', 'Version proposals are limited to release/main');
  const proposal = {
    schema_version: 1, state, repository: context.repository, source_sha, context, evidence, control,
    manifest_version, version, impact, previous, commits, notes, date,
    ...(automatic?{authenticated_metadata}:{}),
    completion_confirmation_required: !automatic && state !== 'no-release',
    bootstrap_confirmation_required: !automatic && state === 'bootstrap',
    publication_approval_required: !automatic && state !== 'no-release',
  };
  return { ...proposal, proposal_sha256: proposalDigest(proposal) };
}

export async function paginate(api, endpoint, key) {
  const entries = [];
  let expected = null;
  for (let page = 1; page <= 100; page++) {
    const response = await api(endpoint + (endpoint.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
    const values = key ? response[key] : response;
    ensure(Array.isArray(values) && values.length <= 100, 'Malformed paginated API response');
    if (key) {
      counter(response.total_count, 'API collection count');
      if (expected === null) expected = response.total_count;
      ensure(expected === response.total_count, 'API collection changed during pagination');
    }
    entries.push(...values);
    if (values.length < 100 || (expected !== null && entries.length === expected)) {
      ensure(expected === null || entries.length === expected, 'Truncated API collection');
      for (const entry of entries) counter(entry.id, 'API entry ID', true);
      ensure(new Set(entries.map(x => x.id)).size === entries.length, 'Duplicate paginated API identity');
      return entries;
    }
  }
  throw new Error('API collection exceeded bounded pagination');
}

export async function verifySourceAttempt(input, api = githubJson) {
  const { repository, run_id, run_attempt, source_sha } = input;
  ensure(repository === loadPolicy().repository, 'Unexpected release repository');
  counter(run_id, 'source CI run', true); counter(run_attempt, 'source CI attempt', true);
  ensure(typeof source_sha === 'string' && SHA.test(source_sha), 'Invalid source CI SHA');
  const prefix = '/repos/' + repository;
  const repo = await api(prefix);
  const workflow = await api(prefix + '/actions/workflows/ci.yml');
  ensure(workflow.path === '.github/workflows/ci.yml' && workflow.state === 'active', 'Wrong/disabled CI workflow');
  counter(repo.id, 'release repository ID', true);
  const runEndpoint = prefix + '/actions/runs/' + run_id;
  function validateRun(run) {
    ensure(run.id === run_id && run.run_attempt === run_attempt, 'Stale/substituted source run attempt');
    ensure(run.repository?.id === repo.id && run.repository?.full_name === repository &&
      run.head_repository?.id === repo.id && run.head_repository?.full_name === repository, 'Source CI repository/origin mismatch');
    ensure(run.workflow_id === workflow.id && run.path?.split('@')[0] === workflow.path, 'Source workflow substitution');
    ensure(run.event === 'push' && run.head_branch === 'release' && run.head_sha === source_sha, 'Source CI is not the intended actual release push');
    ensure(run.status === 'completed' && run.conclusion === 'success', 'Source CI has not completed successfully');
    return run;
  }
  const run = validateRun(await api(runEndpoint));
  const jobs = await paginate(api, runEndpoint + '/attempts/' + run_attempt + '/jobs', 'jobs');
  for (const [id, name] of Object.entries(jobNames)) {
    const matches = jobs.filter(job => job.name === name);
    ensure(matches.length === 1, 'Missing/ambiguous required source job: ' + id);
    const job = matches[0];
    ensure(job.run_id === run_id && (job.run_attempt === undefined || job.run_attempt === run_attempt) &&
      job.head_sha === source_sha && job.status === 'completed' && job.conclusion === 'success', 'Required source job failed/incomplete: ' + id);
  }
  const collection = await paginate(api, runEndpoint + '/artifacts', 'artifacts');
  const names = { quality: 'quality-' + run_id + '-' + run_attempt,
    certification: 'certification-' + run_id + '-' + run_attempt,
    package: 'evidence-' + run_id + '-' + run_attempt + '-package' };
  const artifacts = {};
  for (const [key, name] of Object.entries(names)) {
    const matches = collection.filter(artifact => artifact.name === name);
    ensure(matches.length === 1, 'Missing/ambiguous immutable source artifact: ' + name);
    const artifact = matches[0];
    counter(artifact.id, 'artifact ID', true); counter(artifact.size_in_bytes, 'artifact bytes', true);
    ensure(artifact.expired === false && typeof artifact.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(artifact.digest), 'Expired/malformed source artifact digest');
    ensure(artifact.size_in_bytes <= 512 * 1024 * 1024, 'Source artifact exceeded download bound');
    artifacts[key] = { id: artifact.id, name, api_digest: artifact.digest, size_in_bytes: artifact.size_in_bytes };
  }
  const tip = await api(prefix + '/git/ref/heads/release');
  ensure(tip.ref === 'refs/heads/release' && tip.object?.type === 'commit' && tip.object.sha === source_sha, 'Release tip changed since source CI');
  validateRun(await api(runEndpoint));
  return { repository_id: repo.id, workflow_id: workflow.id, run, jobs, artifacts };
}

export async function publishedReleases(repository, api = githubJson) {
  const releases = await paginate(api, '/repos/' + repository + '/releases', null);
  const result = [];
  for (const release of releases.filter(x => !x.draft && !x.prerelease && /^v[0-9]+\.[0-9]+\.[0-9]+$/.test(x.tag_name))) {
    const ref = await api('/repos/' + repository + '/git/ref/tags/' + encodeURIComponent(release.tag_name));
    ensure(ref.object?.type === 'tag' && SHA.test(ref.object.sha), 'Published version has a lightweight/malformed tag');
    const tag = await api('/repos/' + repository + '/git/tags/' + ref.object.sha);
    ensure(tag.tag === release.tag_name && tag.object?.type === 'commit' && SHA.test(tag.object.sha), 'Published annotated tag identity mismatch');
    result.push({ release_id: release.id, tag_name: release.tag_name, tag_object: ref.object.sha,
      target_sha: tag.object.sha, published: true });
  }
  return result;
}

export async function trustedControl(env = process.env, api = githubJson, readGit = git) {
  const repository = loadPolicy().repository;
  ensure(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === repository &&
    env.GITHUB_REF === 'refs/heads/main' && env.GITHUB_WORKFLOW_REF === repository + '/.github/workflows/release.yml@refs/heads/main',
  'Release controls must execute from trusted main');
  ensure(typeof env.GITHUB_WORKFLOW_SHA === 'string' && SHA.test(env.GITHUB_WORKFLOW_SHA) &&
    readGit(['rev-parse', 'HEAD']) === env.GITHUB_WORKFLOW_SHA, 'Checkout is not the frozen trusted workflow commit');
  ensure(readGit(['status', '--porcelain']).length === 0, 'Trusted release control checkout must be clean');
  ensure(['workflow_run', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME), 'Unsupported release-control event');
  const runId = Number(env.GITHUB_RUN_ID), attempt = Number(env.GITHUB_RUN_ATTEMPT);
  counter(runId, 'control run', true); counter(attempt, 'control attempt', true);
  const run = await api('/repos/' + repository + '/actions/runs/' + runId);
  const workflow = await api('/repos/' + repository + '/actions/workflows/release.yml');
  ensure(workflow.path === '.github/workflows/release.yml' && workflow.state === 'active', 'Control workflow identity mismatch');
  ensure(run.id === runId && run.run_attempt === attempt && run.event === env.GITHUB_EVENT_NAME &&
    run.status === 'in_progress' && run.head_sha === env.GITHUB_WORKFLOW_SHA && run.head_sha === env.GITHUB_SHA &&
    run.actor?.login === env.GITHUB_ACTOR &&
    run.head_branch === 'main' && run.repository?.full_name === repository &&
    run.repository?.id === Number(env.GITHUB_REPOSITORY_ID) && run.head_repository?.id === run.repository.id &&
    run.workflow_id === workflow.id && run.path?.split('@')[0] === '.github/workflows/release.yml',
  'Control workflow/run/attempt/repository identity mismatch');
  return { source_sha: env.GITHUB_WORKFLOW_SHA, run_id: runId, run_attempt: attempt,
    workflow_id: workflow.id, actor: textValue(run.actor.login, 'control actor') };
}

export function sourceRequest(env = process.env) {
  const event = jsonFile(env.GITHUB_EVENT_PATH);
  if (env.GITHUB_EVENT_NAME === 'workflow_run') {
    ensure(event.workflow_run?.conclusion === 'success', 'Preview needs successful upstream CI completion');
    return { repository: loadPolicy().repository, run_id: event.workflow_run.id,
      run_attempt: event.workflow_run.run_attempt, source_sha: event.workflow_run.head_sha };
  }
  return { repository: loadPolicy().repository, run_id: Number(env.SOURCE_RUN_ID),
    run_attempt: Number(env.SOURCE_RUN_ATTEMPT), source_sha: env.SOURCE_SHA };
}

export async function preview(request, control, out, api = githubJson) {
  const evidence = await verifySourceAttempt(request, api);
  const context = {
    schema_version: 1, kind: 'hosted', repository: request.repository,
    repository_id: evidence.repository_id, head_repository_id: evidence.repository_id,
    workflow_id: evidence.workflow_id, workflow_path: '.github/workflows/ci.yml',
    workflow_sha: request.source_sha, event: 'push', branch: 'release', job_id: 'release-preview',
    source_sha: request.source_sha, tested_sha: request.source_sha,
    run_id: request.run_id, run_attempt: request.run_attempt,
    policy_sha256: digest(gitBytes(['show', request.source_sha + ':scripts/ci/policy.json'])),
    toolchain_sha256: digest(gitBytes(['show', request.source_sha + ':scripts/ci/toolchain.json'])),
  };
  const proposal = await createProposal({
    source_sha: request.source_sha, context, evidence, control,
    published: await publishedReleases(request.repository, api),
  });
  writeJson(out, proposal);
  writeFileSync(path.join(path.dirname(out), 'proposal.md'),
    '# Version proposal\n\nState: ' + proposal.state + '\n\nSource: ' + proposal.source_sha +
    '\n\nVersion: ' + (proposal.version ?? 'No release') + '\n\nProposal SHA-256: ' + proposal.proposal_sha256 +
    '\n\n' + proposal.notes + '\nCompletion confirmation, confirmed preparation and final-commit publication approval remain required.\n');
  return proposal;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const options = cliOptions(args);
  if (command === 'preview') {
    const control = await trustedControl();
    return preview(sourceRequest(), control, options.out);
  }
  if (command === 'prepare') {
    const control = await trustedControl();
    return prepareFromArtifact({id:Number(process.env.PROPOSAL_ARTIFACT_ID),reviewed:process.env.REVIEWED_PROPOSAL_SHA256,
      confirmation:{completion:process.env.COMPLETION_CONFIRMED === 'true',bootstrap:process.env.BOOTSTRAP_CONFIRMED === 'true'},
      control,out:options.out});
  }
  if (command === 'preflight') {
    const control = await trustedControl();
    const candidate = await preflight({preparationId:Number(process.env.PREPARATION_ARTIFACT_ID),
      request:sourceRequest(),control,out:options.out});
    if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT,'candidate_sha256='+candidate.candidate_sha256+'\n',{flag:'a'});
    return candidate;
  }
  if (command === 'publish') {
    const control = await trustedControl();
    const id = Number(process.env.CANDIDATE_ARTIFACT_ID);
    counter(id,'candidate artifact ID',true);
    const raw = await githubJson('/repos/'+loadPolicy().repository+'/actions/artifacts/'+id);
    const frozen = {id,name:'candidate-'+control.run_id+'-'+control.run_attempt,
      size_in_bytes:raw.size_in_bytes,api_digest:process.env.CANDIDATE_ARTIFACT_DIGEST};
    verifyArtifactMetadata(raw,frozen,control.run_id);
    const root = path.join(releaseScratch('release-approved-'),'candidate');
    await downloadArtifact(loadPolicy().repository,frozen,control.run_id,root);
    const filename = containedFile(root,'candidate.json');
    const candidate = validateCandidateRequest(jsonFile(filename));
    ensure(candidate.candidate_sha256 === process.env.CANDIDATE_SHA256, 'Frozen preflight output changed');
    const authorization = await authorizePublication(candidate,root,control);
    const authPath = path.join(root,'authorization.json'); writeJson(authPath,authorization);
    return execFileSync('pwsh',['-NoProfile','-File',path.join(ciRoot,'publish.ps1'),
      '-CandidateFile',filename,'-AuthorizationFile',authPath,'-Root',root],{cwd:repoRoot,timeout:600000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
  }
  throw new Error('Unsupported release command: ' + command + ' ' + Object.keys(options).join(','));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 2; });
}
