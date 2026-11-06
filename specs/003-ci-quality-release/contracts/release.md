# Contract: proposal, preparation and approved publication

This is a design contract, not authorization to release. Product release entries,
tags and publication remain subject to repository confirmation rules.
See [the model](../data-model.md) and [CI evidence](ci-evidence.md).

## Control workflow

`release.yml` is installed on main and supports:

| Mode | Trigger / permissions | Output |
| --- | --- | --- |
| preview | Successful actual release-push CI completion; read-only | Proposal JSON and readable notes |
| prepare | Maintainer dispatch from trusted main; explicit completion confirmation; read-only remote access | Version/changelog patch and preparation manifest |
| publish preflight | Maintainer dispatch from trusted main; read-only | Frozen exact-candidate authorization request |
| publish | Protected release-publish environment approval; contents-write only here | Annotated tag, verified draft/assets and public release |

Reject dispatches executing another branch's control workflow. Record the
trusted workflow SHA, separate from the release candidate SHA. Prepare/publish
must not accept arbitrary executable paths or command text.

## Proposal input and semantic rules

Input: repository identity, actual release source SHA, exact qualifying CI
run/attempt, policy/tool identities and complete Git history/tags.

Find the latest published release in the intended ancestry, verifying its tag
type/target. Refuse incomplete history or an unsynchronized release ancestry.
Analyze all relevant reachable commits, not just merge subjects. Structural
merge messages may be exempt from conventional syntax; new nonmerge messages,
including squash messages, must carry the intended classification.

Classification:

- Breaking bang/footer change: MAJOR, including docs(release) with breaking text.
- Compatible feat: MINOR.
- Compatible fix or docs(release): PATCH.
- Ordinary docs, test, refactor, CI and chore without breaking impact: no release.
- Generated chore(release) bookkeeping does not create another release.

The shared analyzer/notes configuration explicitly preserves breaking precedence.
Notes retain existing explanatory docs/configured ticket links; the actual
changelog entry is dated and high-level.

No tags is an explicit bootstrap state. Preview reports the manifest version;
prepare requires confirmation that this is the intended first version.
Do not silently choose an initial major or invent historical entries.

Output records analyzed commits, previous tag/object or bootstrap, change impact,
proposed version or no-release, source/evidence identities and notes.
Preview changes no version/changelog/tag/release record.

## Preparation input and patch guarantees

Required input: exact successful source CI attempt, reviewed proposal digest,
explicit completion confirmation and, when needed, bootstrap confirmation.
The named source must still be the release tip and previous release state must
still match the proposal.

Prepare an isolated source export and temporary Git index without branch operations.
The user workspace is never rewritten. Before and after, query locked/offline
Cargo metadata at the explicit root manifest.

Supported current format is one literal root package named rustcorder and one
source-less root entry in lockfile version 4. Change only their version-string
token spans and the intended changelog insertion. Preserve every other byte,
including line endings, comments and dependency versions. Reject inherited
workspace versions, ambiguous fields/blocks and unexpected shapes. Never call
cargo update or regenerate the lockfile.

Validate the root identity/version and unchanged non-root graph, treating Cargo
IDs as opaque and normalizing only the before/after root IDs. Produce:

- Patch bytes, patch SHA-256 and an explicit list of permitted paths.
- Preparation JSON: source SHA, previous tag/object, version/date, proposal/
  policy/tool digests, confirmation run/actor, patch digest and expected tree SHA.
- Readable application instructions without an automatic commit/push.

Expected tree is computed from the isolated index and stored outside that tree,
avoiding a self-referential manifest hash. Bootstrap may leave version tokens
unchanged; notes still require confirmed completion.
An already prepared matching version/changelog entry must not be inserted again;
return an explicit existing-preparation/no-change result or require its original
manifest rather than generating a duplicate metadata commit.

## User commit and final CI

The user applies the patch on existing release, commits and pushes.
Final candidate has exactly one parent equal to prepared source and the expected
tree. It may have different author/signature metadata; additional code changes
or a different parent invalidate the preparation.

Normal release-push CI validates this final SHA, including light mutation,
version alignment, package integrity and native smoke. Earlier source results
are provenance only, never final-commit certification.

The package includes the compiled application version, source SHA, verified VAD/
license and file hashes. Its safe inner directory can use a SHA or hyphenated
version; canonical SemVer remains in metadata and outer ZIP filename.

## Publication request and approval binding

Publication input identifies final SHA/version, preparation run/attempt/artifact
ID/digest, final CI run/attempt and certification artifact ID/digest.

Read-only preflight:

1. Resolve branch tip and previous release state again.
2. Verify preparation and exact candidate tree/parent/version.
3. Query the exact latest CI run attempt and all required jobs, with pagination;
   require intended repository/head repository, workflow ID/path, push event,
   release branch, matching SHA and success.
4. Validate receipt schema, required outcomes, both mutation engines and package/
   native-smoke provenance; match archive/file digests and reject unsafe paths.
5. Freeze canonical candidate JSON and its SHA-256 as outputs/artifact, showing
   version, full SHA, evidence and requested actions in the approval job.

Only then may the protected `release-publish` job await its configured reviewer.
Dispatch inputs or a green workflow are not enough. For a solo owner, explicit
owner self-approval may be enabled; preventing self-review is optional, not a
requirement to appoint a second person.

After approval, rerun identity/tip/latest-attempt/hash checks. Any changed binding
requires a new preflight and authorization. A newer run attempt invalidates the
previous attempt's pending request even when the commit is unchanged.

## Privileged publication order

The privileged adapter runs from trusted main code; it does not run candidate
scripts, npm hooks, executables or archive contents. Candidate data is validated
with fixed bounded parsers and file inventories.

Serialize the publication job without cancelling active execution:

1. Verify there is no conflicting annotated tag/release and recheck final tip.
2. Create an annotated tag at the exact validated final SHA; push only that
   explicit tag ref, never all local tags.
3. Create the GitHub draft using the already verified existing tag. Do not use
   any API/CLI behavior that silently creates a tag at the default branch.
4. Attach the exact tested ZIP, SHA256SUMS, package manifest, notes and final
   certification evidence.
5. Download/verify staged attachment hashes and version/source alignment.
6. Publish that verified draft and retain its release ID/tag/object/assets.

No branch ref is created, switched, merged or pushed by this workflow.
An approved tag may exist if later transport fails; retry follows reconciliation
below rather than rewriting it.

## Retry, concurrency and recovery

Identical reruns resume at the last verified state. Before reusing an existing
tag, require annotated type, exact target and matching bound release identity.
Existing assets must have the expected digest; skip identical bytes and fail
different bytes. Never overwrite, force-push or move a published tag.

Changing final SHA/version/preparation/run attempt/artifact digest is a different
request. Conflicting state, expired required artifacts or unavailable original
bytes blocks automatic recovery; retain diagnostics for owner intervention.
Pending jobs cancelled by concurrency policy remain incomplete, not authorized.

Promotion to main validates the published candidate/version and performs no
version calculation/publication. User-controlled feature work synchronizes
released ancestry/metadata to develop before subsequent release preparation.

## Required failing-first proof

Test in temporary repositories and mocked GitHub APIs: conventional precedence
including docs(release)!; no-release/bootstrap; incomplete history; wrong prior
tag; LF/CRLF and ambiguous token edits; dependency graph drift; dirty user tree;
parent/tree substitution; PR evidence used as push proof; wrong repository;
rerun-attempt/artifact substitution; approval without frozen binding; changed tip
after approval; lightweight/conflicting tag; duplicate/different asset bytes;
failure between tag/draft/upload/publish; repeated publication and main promotion.

No fixture is allowed to target the real remote or create a real product tag.
