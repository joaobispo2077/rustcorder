# Release Automation Contract

## Implementation clarification — 2026-11-14

Implementation clarification authorized by the owner: GH_TOKEN is the metadata-write secret, matching AVO. The optional official App action remains supported. Token mode freezes its authenticated numeric user ID/login instead of an App bot ID; C’s actual CI actor must match. All other source/intent/final-proof boundaries apply equally. A successful exact producer job, or successful object/intent-upload steps before a failed ref step, can validate historical artifacts; no failed preparation or upload is accepted.

Scope: the trusted controller's GitHub interfaces and version/notes behavior.
The existing [release integrity contract](../../003-ci-quality-release/contracts/release.md)
still applies except its superseded manual-only authorization and entry format.
Records and transitions are defined in [the data model](../data-model.md).

## Trigger and permissions

- Release processing listens to completed CI runs for release. Validate actual
  workflow/repository/event/SHA/attempt; only successful actual release-push evidence
  can authorize processing. Open-PR checks and other branches cannot publish.
- Ordinary source must be introduced through a verified merged develop→release PR.
  Metadata continuation instead requires the trusted intent. Neither a title nor
  a chore(release) body grants authority.
- All controller code/dependencies come from its trusted main workflow SHA. Preview
  may remain read-only dispatch; remove dispatch prepare/publish and manual booleans
  from the enabled automatic path. Rerunning verified failed work is a retry, not
  a new approval. Detached user-supplied source cannot bypass eligibility.
- Read-only preparation has no contents-write/App key. Metadata writer alone receives
  the owner-supplied GH_TOKEN contents-write secret or optional repository-scoped App token. Publisher
  has job-scoped contents-write/actions-read without the App key. No recurring
  protected-environment reviewer is allowed in the automatic flow.
- Owner configures GH_TOKEN, or optional RELEASE_APP_CLIENT_ID/RELEASE_APP_PRIVATE_KEY,
  and only the necessary existing-release-ref rule exception. Credential permissions cannot
  enforce a path allowlist; the writer must enforce it. Missing setup stops visibly.

## Version and notes contract

| Input | Impact / notes |
| --- | --- |
| Bang header or recognized breaking footer, including on otherwise ignored types | MAJOR, including 0.x→1.0.0; BREAKING CHANGES notes |
| feat | MINOR; Features |
| fix, perf, recognized revert | PATCH; applicable Angular sections/reference revert behavior |
| docs(release) | PATCH; Bug Fixes through notes-only type normalization |
| Ordinary nonbreaking docs/test/refactor/CI/chore | No independent release |
| Authenticated generated metadata | Continuation/excluded from new impact; never recursively bump |

Recognize the three required footer keywords plus the existing BREAKING-CHANGE
alias. Analyze original reachable commits since the last published ancestor, not
only first-parent merge titles. Preserve recognized feature/revert behavior through
reference fixtures. Highest impact wins. Missing/full-history ambiguity blocks.

No published ancestor requires a nonnull explicit initial version and releasable
history. Do not infer an initial version from an engine default or silently release
maintenance. Stable SemVer only; no registry or prerelease publication in this feature.

Notes use pinned Angular generation, subject-then-scope order, scopes, commit links,
dated version headings and comparison links where a predecessor exists. Major/minor
headings are level one; patch headings level two. Preserve historical bytes and line
endings. Notes-only cloned normalization retains original hashes/messages. Do not
duplicate a synthetic breaking note when a recognized footer already exists.
Retain relevant RCR/docs reference enrichment without inventing tickets.

Update both entry generation and extraction; a plain-level-two parser would miss
or truncate the new format. Replace an unpublished entry only with its verified
preparation/intent identity. Ambiguous or published history remains immutable.

## Record versions

Release preparation, intent, candidate, authority and publication records use
schema_version 2 and explicit kinds: automatic-preparation, metadata-intent,
automatic-candidate, automatic-publication-authority and automatic-publication-receipt.
Keep existing gate/context/certification records at their current version. Reject
manual release records on the automatic path rather than interpreting confirmation
fields as authority. The new release-policy file uses schema_version 1 with exactly
automation_enabled and initial_version settings; its initial shipped state is
disabled with a null initial version. Hash it into automatic authority.

## Source → metadata → final candidate

1. Revalidate current source P and latest source CI. Download/freeze source report
   and certification bytes and recollect required evidence. Preview alone grants
   no metadata authority. Verify merged PR eligibility and enabled release policy.
2. Read-only Windows job verifies the before/after Cargo graph and produces the
   bounded patch, expected tree and source-baseline quality snapshot. Allowed paths:
   Cargo.toml, Cargo.lock, CHANGELOG.md and docs/quality-metrics.md. In the manifests,
   only approved application-version tokens/root lock entry may change; source,
   other lock entries and dependency resolutions must remain unchanged.
3. Trusted writer validates exact preparation bytes, creates allowlisted Git blobs/
   tree and deterministic single-parent C with parent P, and checks API identities.
   No candidate script, Cargo, hook, filter or cache executes with the App credential.
4. Upload immutable intent naming C before updating refs/heads/release. Locate by
   exact C-based artifact name; validate trusted workflow, creator attempt and digests.
   The non-forced update requires current P or already C; competing advancement
   blocks. No other ref update, branch creation or force update is permitted.
5. Authenticated GH_TOKEN/App push starts ordinary release-push CI for C. Release serialization is
   not held while waiting. No skip-ci marker or source-P result can certify C.
6. C completion verifies intent, exact single parent/tree/version and current latest
   complete C evidence/package/native smoke. Historic P provenance is checked
   separately; P is no longer required to remain the current tip.
7. Freeze final candidate and automatic authority. Node and PowerShell independently
   verify actual trusted-main workflow_run provenance, candidate/policy digests and
   source/final/intent identity. Reject old manual-schema confusion.
8. Reuse publisher checks before each write: annotated immutable vMAJOR.MINOR.PATCH
   tag, matching draft notes, tested bytes/checksums/evidence, then public release.
   Retain final report/intent/authority with release evidence. Main promotion keeps
   the published version and creates no release.

## Concurrency, recovery and outcomes

Serialize short release decisions/writes per repository, cancel-in-progress false.
Do not assume event queue order. Recheck the ref and newest evidence after obtaining
the lock and before each write. Changed tips invalidate superseded work without
losing real unreleased commits.

Matching existing C/tag/draft/assets resume. Lost responses require reads before
retries. A ref already C is success; a tag bound to another SHA or mismatched bytes
is a conflict. No clobber, force push, delete/recreate or silent version jump to hide
a conflict. Bounded network retries may end in a resumable failure.

When a newer PR lands above unpublished metadata, recompute from the last published
ancestor, exclude authenticated generated commits and reconcile only the verified
unpublished entry/snapshot. If the version is already tagged for another SHA, stop
for owner recovery. Expired provenance also stops; copied messages cannot replace it.

Expose distinct no-release, disabled/setup-blocked, invalid/stale, conflict,
resumable-failure, awaiting-final-CI and published outcomes, with version/source,
control and evidence identities. PR comment delivery is not a publication gate.

## Implemented retry preparation identity

Automatic preparations are named preparation-P-RUN-ATTEMPT, binding the source SHA
as a lookup hint and retaining exact creator provenance. Reruns reuse the earliest
verified equivalent preparation artifact. Recheck this choice after writer
serialization; a new controller identity must not change the original commit
message/preparation hash. Source/run/attempt/policy/material conflicts stop.
A reused preparation keeps its original artifact ID and is not uploaded as if a
new controller had issued it. Producer workflow/actor and source proof are rechecked.
