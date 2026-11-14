# Planning Research: Automated Semantic Releases

Date: **2026-11-14**. Builds on the pinned AVO comparison and Rust candidate
assessment in [the deep research](../../docs/automated-semantic-release-research.md).
Research was split across release-engine, release-flow and PR-reporting investigations;
findings were checked against the actual repository. No production implementation
or remote mutation occurred.

## R1 — Release engine and AVO output

**Decision**: Retain analyzer 13.0.1 and Conventional Commits preset 9.1.0. Pin notes
14.1.1 plus Angular 8.3.1. Use the four-keyword union `BREAKING CHANGE`,
`BREAKING CHANGES`, `BREAKING`, `BREAKING-CHANGE`; the fourth preserves existing
parser behavior. Keep highest-impact/full merged-history analysis and Rustcorder's
bang-header and docs(release) rules.

For notes only, clone commit inputs, map docs(release) to fix(release), remove bang
syntax for Angular parsing, and add a standard breaking note from the subject only
when a bang has no recognized breaking footer. Render with subject-then-scope sorting.
This puts release-doc corrections under Bug Fixes without changing Git history or
hashes. A shared bounded heading recognizer must read both old plain-version headings
and future Angular major/minor/patch headings. Keep old published bytes unchanged.

**Rationale**: The current release controller already depends on these hooks.
A read-only option probe passed 15 classification cases and structural notes
assertions, including ignored-type breaking changes, release docs, ordering and
unchanged originals. It used installed notes 14.1.0, so exact 14.1.1 snapshots
remain an implementation acceptance test. Probe artifacts are ignored local
research evidence, not a shipped test suite.

**Alternatives considered**: git-cliff 2.14.2 remains the preferred native candidate
for a later parity exercise; its configuration alone does not prove scoped docs,
footer/revert and exact notes behavior. Release-plz 0.4.3 supports git-only delivery
but adds orchestration to qualify. cargo-release is a metadata operation tool;
Cocogitto's automatic zero-major rule conflicts. A native rewrite would add work
without removing Node reporting/publishing support. This resolves the earlier
provisional recommendation through repository reuse and probe evidence; it does
not claim any native candidate failed executed tests.

References: [pinned AVO config](https://github.com/joaobispo2077/avo/blob/76d70116f72ccec2fb559ba06eb2fa5b8ea62f27/release.config.mjs),
[analyzer options](https://github.com/semantic-release/commit-analyzer#configuration),
[notes options](https://github.com/semantic-release/release-notes-generator#configuration).

## R2 — Source eligibility and bootstrap

**Decision**: Verify a merged develop-to-release PR through commit-associated PRs
and fresh PR details, plus exact complete same-repository release-push evidence.
Automatic preparation must recollect certification/report bytes, not accept the
existing read-only preview's artifact metadata checks alone. Require releasable
history and explicit initial-version configuration when no published ancestor exists.

**Rationale**: `verifySourceAttempt` already checks current tip, workflow, successful
jobs and latest attempts. `createProposal` currently treats missing published history
as bootstrap regardless of impact and silently uses the manifest version; those
assumptions need changing. `release-policy.json` has a disabled adoption switch and
nullable stable initial version. Owner setup supplies an explicit value after
history inspection; a missing value produces an actionable blocked result.

**Alternatives considered**: Open-PR success is insufficient. Direct-push authorship
or a conventional merge title is not merged-PR authority. Guessing an initial
version or releasing ordinary maintenance would violate the specification.
[GitHub associated-PR API](https://docs.github.com/en/rest/commits/commits#list-pull-requests-associated-with-a-commit).

## R3 — Metadata writes and fresh CI

**Decision**: Read-only Windows preparation exports source and verifies the before/
after Cargo metadata graph using trusted configuration. A separate main-controlled
Ubuntu writer reconstructs allowlisted blobs/tree and a deterministic single-parent
commit through GitHub's Git API. Upload an immutable intent naming that commit before
non-forced advancement of the existing release ref. Mint a repository-scoped App token
only in this writer; run no candidate code there.

**Rationale**: Repository-token pushes do not trigger another push workflow.
An App-token push retains the existing `event=push` release certification contract.
The official token action v3.3.0 and exact tag resolve to
`64ab729a6294000f5aa4a4bc0b73d1f32bc45510`. Use explicit repository and contents-write
permission inputs; mint after read-only verification and revoke at job completion.
The App permission is broader than a path restriction, so trusted writer allowlists
and owner-configured branch rules remain necessary.

**Alternatives considered**: Explicit dispatch could work but would require a second
source-event model across current validation. A normal GITHUB_TOKEN push alone would
leave the changed commit untested. Combining Cargo evaluation with App credentials
would unnecessarily expand the write boundary.
[Workflow triggers](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow),
[pinned token action](https://github.com/actions/create-github-app-token/tree/64ab729a6294000f5aa4a4bc0b73d1f32bc45510),
[commit API](https://docs.github.com/en/rest/git/commits#create-a-commit),
[non-forced reference updates](https://docs.github.com/en/rest/git/refs#update-a-reference).

## R4 — Continuation, authority and recovery

**Decision**: Metadata identity is established by an immutable trusted-writer intent,
exact parent/tree/version and matching preparation artifact, not commit text or bot
name alone. Final CI on that SHA resumes publication. Replace manual authorization
fields with schema-versioned automatic authority in both Node and PowerShell. The
publisher uses its own job-scoped contents-write token, without the App key.

**Rationale**: `authorizePublication` calls reviewer validation; `publish.ps1` separately
requires environment authorization and workflow_dispatch. Removing YAML approval
would leave those assumptions inconsistent. Keep exact control/source identities,
artifact digests and publisher rechecks. Original source P becomes historical after
metadata C advances the ref: validate recorded P authority separately from current C.

Serialize short write stages without holding the lock while final CI runs. Compare
current tip before each write. Matching uncertain writes resume; conflicts stop.
A newer merged PR above unpublished metadata recomputes from the last published
ancestor, excludes only authenticated generated commits, and replaces only its
authenticated unpublished entry/snapshot. A version already tagged for another SHA
is a visible conflict, never an automatic overwrite or silent version jump.

**Alternatives considered**: Message-only recursion detection is forgeable, and
breaking release-note bodies can otherwise trigger another bump. A committed state
file creates circular identity and unnecessary application-tree state. A generic
release service is unnecessary. Existing receipt/artifact mechanisms suffice.

## R5 — PR comment workflow and authoritative readiness

**Decision**: Add a trusted quality-comment workflow on CI workflow_run requested,
in_progress and completed. Resolve the PR read-only, then serialize delivery per PR.
Use contents-read/actions-read/pull-requests-write only; no release credentials or
candidate execution. Do not restrict workflow_run by PR target branch filters;
verify develop/release/main through the PR API instead.

**Rationale**: Requested does not fire on reruns; in_progress neutralizes older
success while rerun validation is pending. Completion includes failed/cancelled
runs. Existing report construction precedes final readiness, so comments must overlay
the exact-attempt certification and actual job results. Run association and bounded
artifact PR-number hints are cross-checked against authoritative PR identity.

**Alternatives considered**: Adding write permissions to ordinary CI conflicts with
the current workflow policy. Pasting existing report.md would carry relative links
and excessive data. A sticky-comment package is unnecessary for one verified comment.
[Workflow-run behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run),
[PR API](https://docs.github.com/en/rest/pulls/pulls#get-a-pull-request).

## R6 — Report transport, ownership and races

**Decision**: Add a ≤1 MiB data-only comment projection; keep full existing artifacts.
Render at most 48 KiB of Markdown with trusted generated links and bounded escaped
fields. Maintain a fixed marker plus expected numeric bot-author identity. Compare
run ordering between runs and attempt ordering within one run; recheck immediately
before and after writes. Pending, closed, stale and incomplete states never imply
current approval. Use the newest authoritative state even for an old callback.

**Rationale**: GitHub comment PATCH has no atomic PR-head compare-and-swap. Per-PR
serialization, pre/post-write reconciliation and exact-head wording bound the race;
they do not promise instantaneous freshness during service outages. Recover lost
POST responses by relisting before creating another comment. Preserve fallback in
run summaries/artifacts; transport failure is separate from report construction.

**Alternatives considered**: Marker text alone lets human-forged comments be edited.
Global concurrency can discard unrelated pending PR jobs. Raw full-evidence downloads
are unnecessary and potentially large. A database is not needed.
[Comment API and permissions](https://docs.github.com/en/rest/issues/comments),
[workflow runs](https://docs.github.com/en/rest/actions/workflow-runs),
[exact-attempt jobs](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt).

## R7 — Governance and activation

**Decision**: Record the user's bounded automatic-flow exception, then implement
canonical/derived governance alignment before enabling writes. Preserve interactive
agent branch restrictions, annotated tags, immutable assets and existing quality
floors. Require one-time owner App installation, secrets/variables and compatible
release rules; no recurring environment reviewer.

**Rationale**: Current Constitution IV still explicitly preserves per-release
approval. The specification records the user's replacement authorization. Planning
can pass with that authorized exception and a bounded remediation sequence; silently
activating automation while leaving contradictory rules cannot.

**Alternatives considered**: Keeping per-release approval contradicts the answer.
Changing governance or remote rules in this documentation-only planning task would
exceed this phase. Disabling protection wholesale is unnecessary.

## Evidence limits

No Rust candidate was executed. The 15-case selected-hook probe used notes 14.1.0,
not the newly planned 14.1.1. New schemas, App-trigger behavior, report races and
automatic hosted publication are designed, not implemented or certified. The ai-memory
reference was unavailable during specification; pinned primary AVO sources supplied
the comparison. No new memory fact is assumed here.
