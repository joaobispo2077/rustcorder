import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  ensure, counter, SHA, SHA256, githubJson, repoRoot, digest, writeJson, filesBelow, gitBytes, git,
  jsonFile, cliOptions, containedFile, loadPolicy,
} from './gates.mjs';
import {
  verifySourceAttempt, paginate, certifyReleaseSource, createProposal, prepareProposal,
  publishedReleases, canonicalDigest, validateReleasePolicy, loadReleasePolicy,
  sealAutomaticRecord, validateAutomaticRecord, validateAutomaticPreparation, editVersionFiles, preparedChangelog, metadataIntentArtifact,
  trustedControl, sourceRequest, controlArtifact, validatePreparation, proposalDigest, preflight,
  validateCandidateRequest, authorizePublication, metadataWriter, releaseHistory, verifyCandidate, manifestVersion, reconcileUnpublishedChangelog,
} from './release.mjs';
import { measurementSummary } from './report.mjs';

const preparedPaths = ['Cargo.toml', 'Cargo.lock', 'CHANGELOG.md', 'docs/quality-metrics.md'];

export async function verifyMergedSource(request, api = githubJson) {
  const evidence = await verifySourceAttempt(request, api);
  const prefix = '/repos/' + request.repository;
  const associated = await paginate(api, prefix + '/commits/' + request.source_sha + '/pulls', null);
  ensure(associated.length <= 20, 'Ambiguous release PR association population');
  const eligible = [];
  for (const hint of associated) {
    counter(hint.number, 'associated PR number', true);
    const pr = await api(prefix + '/pulls/' + hint.number);
    if (pr.number === hint.number && pr.merged === true && pr.state === 'closed' &&
      pr.merge_commit_sha === request.source_sha && pr.base?.ref === 'release' && pr.head?.ref === 'develop' &&
      pr.base.repo?.id === evidence.repository_id && pr.head.repo?.id === evidence.repository_id &&
      pr.base.repo.full_name === request.repository && pr.head.repo.full_name === request.repository) {
      eligible.push({ number: pr.number, merged: true, state: pr.state, merge_commit_sha: pr.merge_commit_sha,
        base: { ref: pr.base.ref, repo: { id: pr.base.repo.id, full_name: pr.base.repo.full_name } },
        head: { ref: pr.head.ref, repo: { id: pr.head.repo.id, full_name: pr.head.repo.full_name } } });
    }
  }
  ensure(eligible.length === 1, 'Source is not the exact eligible merged develop-to-release PR');
  return { ...evidence, pr: eligible[0] };
}

export function qualitySnapshot(proof) {
  ensure(proof.certification?.ready === true && proof.collected?.errors?.length === 0, 'Quality baseline requires complete source certification');
  const context = proof.context;
  const escape = value => String(value).slice(0, 1024).replace(/[&<>|`@\r\n]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '|': '&#124;', '`': '&#96;', '@': '&#64;', '\r': ' ', '\n': ' ' })[character]);
  const lines = ['# Quality metrics', '', 'Preparation baseline; final metadata-commit evidence is attached to its release.', '',
    'Source: ' + context.source_sha + '.', 'CI run: ' + context.run_id + ', attempt: ' + context.run_attempt + '.', '',
    '| Gate | Result | Measurements / thresholds |', '| --- | --- | --- |'];
  for (const receipt of proof.collected.receipts) lines.push('| ' + [receipt.gate, receipt.status, measurementSummary(receipt, proof.scope.policy)].map(escape).join(' | ') + ' |');
  const result = lines.join('\n') + '\n';
  ensure(Buffer.byteLength(result) <= 65536, 'Quality baseline exceeds bound');
  return result;
}

export async function prepareSource({ request, control, policy = loadReleasePolicy(), api = githubJson,
  cwd = repoRoot, out = null, certify = certifyReleaseSource, prepare = prepareProposal }) {
  validateReleasePolicy(policy);
  if (!policy.automation_enabled) return { state: 'disabled', reason: 'Owner activation is disabled' };
  const merged = await verifyMergedSource(request, api);
  const proof = await certify(request, { api, cwd });
  ensure(canonicalDigest(proof.evidence.artifacts) === canonicalDigest(merged.artifacts), 'Source artifacts changed during recollection');
  const reusable=await findSourcePreparation(request,api,policy);
  if(reusable){
    await verifyPreparationForWrite(reusable,{api,policy,cwd,certify});
    if(out)copyPreparation(reusable.root,out);
    return {state:'prepared',preparation:reusable.manifest,output:reusable.root,artifact_id:reusable.artifact.id,reused:true};
  }
  ensure(typeof merged.run.created_at === 'string' && Number.isFinite(Date.parse(merged.run.created_at)), 'Missing frozen source date');
  const published=await publishedReleases(request.repository,api);
  const authenticated_metadata=await loadUnpublishedMetadata(request.source_sha,published,{api,cwd});
  const proposal = await createProposal({ cwd, source_sha: request.source_sha, context: proof.context,
    evidence: proof.evidence, control, published,authenticated_metadata,
    initial_version: policy.initial_version, automatic: true, date: merged.run.created_at.slice(0, 10) });
  if (proposal.state === 'no-release') return { state: 'no-release', proposal };
  const authority = { policy, source_sha: request.source_sha, source_ci: proof.context, complete: true,
    pr: merged.pr, artifacts: proof.evidence.artifacts, commit_date: merged.run.created_at, quality_snapshot: qualitySnapshot(proof) };
  const result = await prepare({ cwd, proposal, reviewed_sha256: proposal.proposal_sha256, control,
    automatic_authority: authority, fetch: true });
  await verifySourceAttempt(request, api);
  if (out) {
    mkdirSync(out, { recursive: true });
    for (const name of ['preparation.json', 'preparation.patch', 'prepared-files.json', 'proposal.json']) {
      writeFileSync(path.join(out, name), readFileSync(path.join(result.output, name)), { flag: 'wx' });
    }
    writeJson(path.join(out, 'state.json'), { state: 'prepared', version: result.manifest.version, source_sha: request.source_sha });
  }
  return { state: 'prepared', preparation: result.manifest, output: result.output };
}

function copyPreparation(root,out) {
  mkdirSync(out,{recursive:true});
  for(const name of ['preparation.json','preparation.patch','prepared-files.json','proposal.json'])writeFileSync(path.join(out,name),readFileSync(containedFile(root,name)),{flag:'wx'});
}

export function selectSourcePreparation(entries,request,policy) {
  const matching=entries.filter(entry=>entry.manifest.source_sha===request.source_sha &&
    entry.manifest.source_ci.run_id===request.run_id && entry.manifest.source_ci.run_attempt===request.run_attempt);
  if(!matching.length)return null;
  for(const entry of matching){validateAutomaticPreparation(entry.manifest);counter(entry.artifact.id,'reused preparation ID',true);
    ensure(entry.manifest.release_policy_sha256===canonicalDigest(policy),'Preparation uses a different automatic policy; explicit recovery is required');}
  const material=entry=>{const{preparation_sha256,control,proposal_sha256,...body}=entry.manifest;return canonicalDigest(body);};
  ensure(matching.every(entry=>material(entry)===material(matching[0])),'Conflicting verified preparations for the same source attempt');
  return matching.sort((a,b)=>a.artifact.id-b.artifact.id)[0];
}

export async function findSourcePreparation(request,api=githubJson,policy=loadReleasePolicy(),load=controlArtifact) {
  const prefix='/repos/'+request.repository,artifacts=await paginate(api,prefix+'/actions/artifacts','artifacts'),entries=[];
  for(const raw of artifacts.filter(item=>item.name?.startsWith('preparation-'+request.source_sha+'-'))){
    const name=raw.name.match(/^preparation-([a-f0-9]{40})-([1-9][0-9]*)-([1-9][0-9]*)$/);
    if(!name || !Number.isSafeInteger(Number(name[2])) || !Number.isSafeInteger(Number(name[3])) || raw.workflow_run?.id!==Number(name[2]))continue;
    const run=await api(prefix+'/actions/runs/'+name[2]+'/attempts/'+name[3]);
    if(run.path?.split('@')[0]!=='.github/workflows/release.yml' || run.event!=='workflow_run' || run.head_branch!=='main' ||
      run.repository?.full_name!==request.repository || !Number.isSafeInteger(run.repository.id) || run.repository.id!==run.head_repository?.id)continue;
    ensure(!raw.expired,'Source preparation provenance expired; explicit recovery is required');
    const input=await load(raw.id,'preparation',api,{allowHistorical:true,activeControl:{run_id:run.id,run_attempt:run.run_attempt,source_sha:run.head_sha}});
    const manifest=validateAutomaticPreparation(jsonFile(containedFile(input.root,'preparation.json')));
    ensure(manifest.source_sha===request.source_sha && manifest.control.run_id===input.run.id &&
      manifest.control.run_attempt===input.run.run_attempt && manifest.control.source_sha===input.run.head_sha,'Reusable preparation creator/source mismatch');
    entries.push({...input,manifest});ensure(entries.length<=20,'Source preparation population exceeds bound');
  }
  return selectSourcePreparation(entries,request,policy);
}

function sourceRequestFor(preparation) {
  return { repository: preparation.repository, source_sha: preparation.source_sha,
    run_id: preparation.source_ci.run_id, run_attempt: preparation.source_ci.run_attempt };
}

export function validatePreparedPayload(preparation, files, sourceFiles) {
  validateAutomaticPreparation(preparation);
  ensure(files && Object.keys(files).sort().join('|') === [...preparedPaths].sort().join('|'), 'Prepared file allowlist/scope mismatch');
  const bytes = Object.fromEntries(Object.entries(files).map(([name, value]) => {
    ensure(typeof value === 'string' || Buffer.isBuffer(value), 'Prepared file must be bounded bytes');
    const valueBytes = Buffer.from(value);
    ensure(valueBytes.length === preparation.files[name].bytes && digest(valueBytes) === preparation.files[name].sha256, 'Prepared file bytes changed');
    return [name, valueBytes];
  }));
  const edit = editVersionFiles(Buffer.from(sourceFiles['Cargo.toml']), Buffer.from(sourceFiles['Cargo.lock']), preparation.version);
  ensure(bytes['Cargo.toml'].equals(edit.manifest) && bytes['Cargo.lock'].equals(edit.lock), 'Prepared versions/dependency graph drift');
  const changelog = preparedChangelog(reconcileUnpublishedChangelog(Buffer.from(sourceFiles['CHANGELOG.md']).toString('utf8'),preparation.authenticated_metadata??[]), preparation.version, preparation.date, preparation.notes);
  ensure(bytes['CHANGELOG.md'].equals(Buffer.from(changelog)) &&
    bytes['docs/quality-metrics.md'].equals(Buffer.from(preparation.source_authority.quality_snapshot)), 'Prepared changelog/quality snapshot changed');
  return bytes;
}

export async function createMetadataCommit({ preparation, files, app, writer, api = githubJson, policy = loadReleasePolicy(),
  sourceFiles = null, cwd = repoRoot, preparationArtifact = null, control = preparation.control }) {
  validateReleasePolicy(policy);
  ensure(policy.automation_enabled === true && canonicalDigest(policy) === preparation.release_policy_sha256, 'Automatic metadata policy is disabled or changed');
  sourceFiles ??= Object.fromEntries(['Cargo.toml', 'Cargo.lock', 'CHANGELOG.md'].map(name => [name,
    gitBytes(['show', preparation.source_sha + ':' + name], cwd)]));
  const bytes = validatePreparedPayload(preparation, files, sourceFiles);
  const principal=metadataWriter(app ? {app} : {writer});
  const request = sourceRequestFor(preparation), prefix = '/repos/' + preparation.repository;
  const guard = async () => {
    const current = await verifyMergedSource(request, api);
    ensure(current.pr.number === preparation.source_authority.pr.number &&
      canonicalDigest(current.artifacts) === canonicalDigest(preparation.source_authority.artifacts), 'Metadata source authority changed');
  };
  const tree = [];
  for (const name of preparedPaths) {
    await guard();
    const blob = await api(prefix + '/git/blobs', { method: 'POST', body: { encoding: 'base64', content: bytes[name].toString('base64') } });
    const expected = createHash('sha1').update('blob ' + bytes[name].length + '\0').update(bytes[name]).digest('hex');
    ensure(blob.sha === expected, 'Git blob API returned different bytes');
    tree.push({ path: name, mode: '100644', type: 'blob', sha: expected });
  }
  await guard();
  const builtTree = await api(prefix + '/git/trees', { method: 'POST', body: { base_tree: preparation.source_tree_sha, tree } });
  ensure(builtTree.sha === preparation.expected_tree, 'Metadata Git tree differs from verified preparation');
  const message = 'chore(release): ' + preparation.version + '\n\n' + preparation.notes + '\n\nRustcorder-Preparation: ' + preparation.preparation_sha256;
  const identity = { name: principal.login, email: principal.id + '+' + principal.login + '@users.noreply.github.com', date: preparation.commit_date };
  await guard();
  const commit = await api(prefix + '/git/commits', { method: 'POST', body: {
    tree: preparation.expected_tree, parents: [preparation.source_sha], message, author: identity, committer: identity,
  } });
  ensure(typeof commit.sha === 'string' && SHA.test(commit.sha) && commit.tree?.sha === preparation.expected_tree &&
    commit.parents?.length === 1 && commit.parents[0].sha === preparation.source_sha, 'Metadata commit parent/tree response mismatch');
  const intent = sealAutomaticRecord('metadata-intent', { repository: preparation.repository, source_sha: commit.sha,
    parent_sha: preparation.source_sha, expected_tree: preparation.expected_tree, version: preparation.version,
    release_policy_sha256: preparation.release_policy_sha256, control, source_ci: preparation.source_ci,
    preparation: preparationArtifact, preparation_sha256: preparation.preparation_sha256,
    ...(app?{app}:{writer}), commit_date: preparation.commit_date, message_sha256: digest(message) });
  return { commit, intent };
}

export async function advanceMetadata({ intent, artifact, api = githubJson, policy = loadReleasePolicy(), loadIntent = metadataIntentArtifact }) {
  ensure(artifact && Number.isSafeInteger(artifact.id) && artifact.id > 0, 'Uploaded immutable intent artifact is required');
  validateAutomaticRecord(intent, 'metadata-intent'); validateReleasePolicy(policy);
  ensure(policy.automation_enabled && canonicalDigest(policy) === intent.release_policy_sha256, 'Metadata advancement policy is disabled or changed');
  ensure(typeof intent.parent_sha === 'string' && SHA.test(intent.parent_sha) &&
    intent.preparation && Number.isSafeInteger(intent.preparation.id), 'Intent lacks frozen preparation identity');
  const prefix = '/repos/' + intent.repository;
  const uploaded=await loadIntent(artifact.id,intent.source_sha,api,{activeControl:intent.control});
  ensure(canonicalDigest(uploaded.artifact)===canonicalDigest(artifact) && uploaded.record.intent_sha256===intent.intent_sha256,
    'Uploaded metadata intent bytes/artifact identity changed');
  const ref = prefix + '/git/ref/heads/release', update = prefix + '/git/refs/heads/release';
  const current = await api(ref);
  ensure(current.ref === 'refs/heads/release' && current.object?.type === 'commit', 'Unexpected existing release ref');
  if (current.object.sha === intent.source_sha) return { state: 'awaiting-final-CI', source_sha: intent.source_sha };
  ensure(current.object.sha === intent.parent_sha, 'Competing release tip prevents metadata advancement');
  await verifySourceAttempt({ repository: intent.repository, source_sha: intent.parent_sha,
    run_id: intent.source_ci.run_id, run_attempt: intent.source_ci.run_attempt }, api);
  try {
    const advanced = await api(update, { method: 'PATCH', body: { sha: intent.source_sha, force: false } });
    ensure(advanced.ref === 'refs/heads/release' && advanced.object?.sha === intent.source_sha, 'Release ref response mismatch');
  } catch (error) {
    const observed = await api(ref);
    if (observed.ref !== 'refs/heads/release' || observed.object?.sha !== intent.source_sha) throw error;
  }
  return { state: 'awaiting-final-CI', source_sha: intent.source_sha };
}

export async function findMetadataIntent(source, api = githubJson) {
  ensure(typeof source === 'string' && SHA.test(source), 'Invalid intent lookup source');
  const prefix='/repos/'+loadPolicy().repository;
  const artifacts=await paginate(api,prefix+'/actions/artifacts','artifacts');
  const matches=[];let expired=false;
  for(const artifact of artifacts.filter(item=>item.name?.startsWith('metadata-'+source+'-'))) {
    const name=artifact.name.match(/^metadata-([a-f0-9]{40})-([1-9][0-9]*)-([1-9][0-9]*)$/);
    if(!name || !Number.isSafeInteger(Number(name[2])) || !Number.isSafeInteger(Number(name[3])) || artifact.workflow_run?.id!==Number(name[2]))continue;
    const run=await api(prefix+'/actions/runs/'+name[2]+'/attempts/'+name[3]);
    if(run.path?.split('@')[0]!=='.github/workflows/release.yml' || run.event!=='workflow_run' || run.head_branch!=='main' ||
      run.repository?.full_name!==loadPolicy().repository || run.repository.id!==run.head_repository?.id)continue;
    if(artifact.expired){expired=true;continue;}
    matches.push(await metadataIntentArtifact(artifact.id,source,api));
  }
  if(!matches.length){ensure(!expired,'Metadata provenance expired; explicit recovery is required');return null;}
  const material=entry=>{const{intent_sha256,control,...value}=entry.record;return canonicalDigest(value);};
  ensure(matches.every(entry=>material(entry)===material(matches[0])),'Conflicting trusted metadata intents');
  return matches.sort((a,b)=>a.artifact.id-b.artifact.id)[0];
}

export async function loadUnpublishedMetadata(source,published,{api=githubJson,cwd=repoRoot,loadIntent=findMetadataIntent,loadPreparation=controlArtifact}={}) {
  const {commits}=releaseHistory(cwd,source,published),result=[];
  for(const commit of commits){
    // A header is a lookup hint only; without verified artifacts it remains a real commit.
    if(!/^chore\(release\): [0-9]+\.[0-9]+\.[0-9]+(?:\r?\n|$)/.test(commit.message))continue;
    const found=await loadIntent(commit.sha,api);if(!found)continue;
    const intent=validateAutomaticRecord(found.record,'metadata-intent');metadataWriter(intent);
    const input=await loadPreparation(intent.preparation?.id,'preparation',api,{allowHistorical:true});
    const prepared=validateAutomaticPreparation(jsonFile(containedFile(input.root,'preparation.json')));
    ensure(prepared.preparation_sha256===intent.preparation_sha256 && prepared.source_sha===intent.parent_sha &&
      prepared.expected_tree===intent.expected_tree && canonicalDigest(input.artifact)===canonicalDigest(intent.preparation),'Prior metadata preparation identity changed');
    verifyCandidate(prepared,{sha:commit.sha,parents:commit.parents,tree_sha:git(['rev-parse',commit.sha+'^{tree}'],cwd),
      version:manifestVersion(git(['show',commit.sha+':Cargo.toml'],cwd))});
    ensure(digest(commit.message.trimEnd())===digest(('chore(release): '+prepared.version+'\n\n'+prepared.notes+'\n\nRustcorder-Preparation: '+prepared.preparation_sha256).trimEnd()),'Prior metadata message changed');
    const changed=git(['diff-tree','--no-commit-id','-r','--name-only',intent.parent_sha,commit.sha],cwd).split('\n').filter(Boolean).sort();
    ensure(canonicalDigest(changed)===canonicalDigest([...prepared.changed_paths].sort()),'Prior metadata changed unrelated paths');
    for(const[name,file]of Object.entries(prepared.files)){
      const bytes=gitBytes(['show',commit.sha+':'+name],cwd);ensure(bytes.length===file.bytes && digest(bytes)===file.sha256,'Prior metadata bytes changed');
    }
    result.push({source_sha:commit.sha,version:prepared.version,date:prepared.date,notes:prepared.notes,
      preparation_sha256:prepared.preparation_sha256,intent_sha256:intent.intent_sha256});
    ensure(result.length<=20,'Unpublished metadata population exceeds bound');
  }
  return result;
}

export async function releaseRoute(request, api = githubJson, policy = loadReleasePolicy()) {
  validateReleasePolicy(policy);
  if(!policy.automation_enabled)return {state:'disabled',reason:'Owner activation is disabled'};
  const current=await verifySourceAttempt(request,api);
  const published=await publishedReleases(request.repository,api);
  const existing=published.filter(release=>release.target_sha===request.source_sha);
  if(existing.length){ensure(existing.length===1,'Ambiguous already published source');return {state:'published',version:existing[0].tag_name.slice(1),source_sha:request.source_sha};}
  const intent=await findMetadataIntent(request.source_sha,api);
  if(intent){
    const writer=metadataWriter(intent.record);
    ensure(current.run.actor?.id===writer.id && current.run.actor.login===writer.login,
      'Metadata CI was not triggered by the authenticated writer');
    return {state:'final',source_sha:request.source_sha,intent_artifact_id:intent.artifact.id,preparation_artifact_id:intent.record.preparation.id};
  }
  await verifyMergedSource(request,api);
  return {state:'source',source_sha:request.source_sha};
}

export async function configuredApp(slug, api = githubJson) {
  ensure(typeof slug==='string' && /^[a-z0-9][a-z0-9-]{0,98}$/.test(slug),'Missing configured App slug');
  const app=await api('/apps/'+slug),bot=await api('/users/'+encodeURIComponent(slug+'[bot]'));
  counter(app.id,'configured App ID',true);counter(bot.id,'configured bot ID',true);
  ensure(app.slug===slug && bot.login===slug+'[bot]' && bot.type==='Bot','Configured App/bot identity mismatch');
  return {id:app.id,bot_id:bot.id,slug,login:bot.login};
}

export async function configuredToken(token,api=githubJson) {
  ensure(typeof token==='string' && token.length>0,'Missing GH_TOKEN metadata token');
  const user=await api('/user',{token});
  const writer={kind:'token',id:user.id,login:user.login};metadataWriter({writer});
  ensure(['User','Bot'].includes(user.type),'Invalid token owner identity');
  return writer;
}

export function preparedPayload(input) {
  const value=jsonFile(containedFile(input.root,'prepared-files.json'));
  ensure(value && Object.keys(value).sort().join('|')===[...preparedPaths].sort().join('|'),'Prepared payload file scope mismatch');
  return Object.fromEntries(preparedPaths.map(name=>{
    const file=value[name];ensure(file?.encoding==='base64' && typeof file.content==='string' && file.content.length<=12*1024*1024,'Invalid bounded prepared payload');
    const bytes=Buffer.from(file.content,'base64');ensure(bytes.toString('base64')===file.content,'Noncanonical prepared payload encoding');return [name,bytes];
  }));
}

export async function verifyPreparationForWrite(input, {api=githubJson,policy=loadReleasePolicy(),cwd=repoRoot,certify=certifyReleaseSource}={}) {
  const preparation=validateAutomaticPreparation(jsonFile(containedFile(input.root,'preparation.json')));
  ensure(preparation.control.run_id===input.run.id && preparation.control.run_attempt===input.run.run_attempt &&
    preparation.control.source_sha===input.run.head_sha && preparation.control.workflow_id===input.run.workflow_id &&
    preparation.control.actor===input.run.actor?.login,'Preparation creator binding changed');
  validateReleasePolicy(policy);ensure(policy.automation_enabled && canonicalDigest(policy)===preparation.release_policy_sha256,'Preparation activation/policy changed');
  const proposal=jsonFile(containedFile(input.root,'proposal.json'));
  ensure(proposalDigest(proposal)===preparation.proposal_sha256 && digest(readFileSync(containedFile(input.root,'preparation.patch')))===preparation.patch_sha256,'Preparation proposal/patch changed');
  const request=sourceRequestFor(preparation),merged=await verifyMergedSource(request,api),proof=await certify(request,{api,cwd});
  ensure(merged.pr.number===preparation.source_authority.pr.number &&
    canonicalDigest(proof.evidence.artifacts)===canonicalDigest(preparation.source_authority.artifacts) &&
    qualitySnapshot(proof)===preparation.source_authority.quality_snapshot &&
    git(['rev-parse',preparation.source_sha+'^{tree}'],cwd)===preparation.source_tree_sha,'Prepared source/tree/quality evidence changed');
  const published=await publishedReleases(preparation.repository,api);
  const authenticated_metadata=await loadUnpublishedMetadata(preparation.source_sha,published,{api,cwd});
  const recalculated=await createProposal({cwd,source_sha:preparation.source_sha,context:proposal.context,
    evidence:proposal.evidence,control:proposal.control,published,authenticated_metadata,
    initial_version:policy.initial_version,automatic:true,date:proposal.date});
  ensure(proposalDigest(recalculated)===preparation.proposal_sha256,'Version or release history changed since preparation');
  const files=preparedPayload(input);
  const sourceFiles=Object.fromEntries(['Cargo.toml','Cargo.lock','CHANGELOG.md'].map(name=>[name,gitBytes(['show',preparation.source_sha+':'+name],cwd)]));
  validatePreparedPayload(preparation,files,sourceFiles);
  return {preparation,files,sourceFiles};
}

function outputDirectory(value) {
  const target=path.resolve(repoRoot,value??'.build/automatic-release');
  const relative=path.relative(path.join(repoRoot,'.build'),target);
  ensure(relative && !relative.startsWith('..') && !path.isAbsolute(relative),'Automatic output must be inside checkout .build');
  mkdirSync(target,{recursive:true});return target;
}

function publishOutputs(value,env=process.env) {
  if(env.GITHUB_OUTPUT)for(const[key,item]of Object.entries(value)){
    ensure(/^[a-z_]+$/.test(key) && ['string','number','boolean'].includes(typeof item) && !/[\r\n]/.test(String(item)),'Unsafe workflow output');
    appendFileSync(env.GITHUB_OUTPUT,key+'='+item+'\n');
  }
  if(env.GITHUB_STEP_SUMMARY)appendFileSync(env.GITHUB_STEP_SUMMARY,'## Automatic release\n\n'+Object.entries(value).map(([key,item])=>key+': '+String(item).replace(/[<>&`@]/g,'')).join('\n\n')+'\n');
}

function metadataApi(token,repository,readApi=githubJson) {
  ensure(typeof token==='string' && token.length>0,'Missing repository-scoped metadata App token');
  const prefix='/repos/'+repository+'/git/';
  return (endpoint,options={})=>{
    const method=options.method??'GET';if(method==='GET')return readApi(endpoint,options);
    ensure((method==='POST' && ['blobs','trees','commits'].some(kind=>endpoint===prefix+kind)) ||
      (method==='PATCH' && endpoint===prefix+'refs/heads/release' && options.body?.force===false), 'Metadata credential requested an unrelated write');
    return githubJson(endpoint,{...options,token});
  };
}

export async function main(argv=process.argv.slice(2),env=process.env) {
  const[command,...args]=argv,options=cliOptions(args);
  ensure(['route','prepare','metadata','advance','preflight','publish'].includes(command),'Unknown automatic release command');
  for(const key of Object.keys(options))ensure(['out','root'].includes(key),'Unsupported automatic release option');
  const out=outputDirectory(options.out??options.root),policy=loadReleasePolicy();
  if(!policy.automation_enabled){const value={state:'disabled'};writeJson(path.join(out,'state.json'),value);publishOutputs(value,env);return value;}
  const control=await trustedControl(env),request=sourceRequest(env);
  if(command!=='route')ensure(env.GITHUB_EVENT_NAME==='workflow_run','Automatic writes require verified upstream CI, never manual dispatch');
  if(command==='route'){
    const value=await releaseRoute(request);
    if(env.GITHUB_EVENT_NAME==='workflow_dispatch')value.state='preview';
    writeJson(path.join(out,'state.json'),value);publishOutputs(value,env);return value;
  }
  if(command==='prepare'){
    const value=await prepareSource({request,control,policy,out});
    publishOutputs({state:value.state,...(value.preparation?{version:value.preparation.version}:{}),
      ...(value.reused?{reused:true,artifact_id:value.artifact_id}:{})},env);return value;
  }
  if(command==='metadata'){
    const id=Number(env.PREPARATION_ARTIFACT_ID);counter(id,'preparation artifact',true);
    const supplied=await controlArtifact(id,'preparation',githubJson,{allowHistorical:true,activeControl:control});
    // Serialization may expose an earlier equivalent preparation uploaded by another controller.
    const input=await findSourcePreparation(request,githubJson,policy)??supplied;
    const prepared=await verifyPreparationForWrite(input,{policy});
    ensure(prepared.preparation.source_sha===request.source_sha && prepared.preparation.source_ci.run_id===request.run_id &&
      prepared.preparation.source_ci.run_attempt===request.run_attempt,'Metadata preparation does not match the triggering source attempt');
    const principal=env.RELEASE_APP_SLUG ? {app:await configuredApp(env.RELEASE_APP_SLUG)} : {writer:await configuredToken(env.RELEASE_WRITE_TOKEN)};
    const result=await createMetadataCommit({...prepared,...principal,policy,control,preparationArtifact:input.artifact,
      api:metadataApi(env.RELEASE_WRITE_TOKEN,request.repository)});
    writeJson(path.join(out,'metadata-intent.json'),result.intent);
    publishOutputs({state:'intent-ready',source_sha:result.intent.source_sha,version:result.intent.version},env);return result;
  }
  if(command==='advance'){
    const intent=validateAutomaticRecord(jsonFile(containedFile(out,'metadata-intent.json')),'metadata-intent');
    ensure(canonicalDigest(intent.control)===canonicalDigest(control),'Metadata writer control changed');
    const id=Number(env.INTENT_ARTIFACT_ID);counter(id,'uploaded intent artifact',true);
    const raw=await githubJson('/repos/'+request.repository+'/actions/artifacts/'+id);
    const artifact={id:raw.id,name:raw.name,api_digest:env.INTENT_ARTIFACT_DIGEST,size_in_bytes:raw.size_in_bytes};
    const value=await advanceMetadata({intent,artifact,policy,api:metadataApi(env.RELEASE_WRITE_TOKEN,request.repository)});
    writeJson(path.join(out,'advance.json'),value);publishOutputs(value,env);return value;
  }
  if(command==='preflight'){
    const id=Number(env.INTENT_ARTIFACT_ID);counter(id,'metadata intent artifact',true);
    const intent=await metadataIntentArtifact(id,request.source_sha);
    const source=await verifySourceAttempt(request);
    const writer=metadataWriter(intent.record);
    ensure(source.run.actor?.id===writer.id && source.run.actor.login===writer.login,'Final metadata CI writer identity changed');
    const candidate=await preflight({preparationId:intent.record.preparation.id,request,control,out,intent});
    publishOutputs({state:'candidate',candidate_sha256:candidate.candidate_sha256},env);return candidate;
  }
  const id=Number(env.CANDIDATE_ARTIFACT_ID);counter(id,'candidate artifact',true);
  const input=await controlArtifact(id,'candidate',githubJson,{allowHistorical:true,activeControl:control});
  const candidate=validateCandidateRequest(jsonFile(containedFile(input.root,'candidate.json')));
  ensure(candidate.schema_version===2 && candidate.source_sha===request.source_sha && candidate.ci.run_id===request.run_id &&
    candidate.ci.run_attempt===request.run_attempt,'Automatic candidate does not match triggering CI');
  const authority=await authorizePublication(candidate,input.root,control);
  const authorityFile=path.join(input.root,'authorization.json');writeJson(authorityFile,authority);
  execFileSync('pwsh',['-NoProfile','-File',path.join(repoRoot,'scripts/ci/publish.ps1'),
    '-CandidateFile',path.join(input.root,'candidate.json'),'-AuthorizationFile',authorityFile,'-Root',input.root],
  {cwd:repoRoot,env:process.env,encoding:'utf8',maxBuffer:1024*1024,timeout:600000,stdio:['ignore','pipe','pipe']});
  for(const name of ['publication.json','candidate.json','authorization.json'])writeFileSync(path.join(out,name),readFileSync(path.join(input.root,name)),{flag:'wx'});
  const value={state:'published',version:candidate.version,source_sha:candidate.source_sha};publishOutputs(value,env);return value;
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  main().catch(error=>{console.error(error.message);process.exitCode=2;});
}
