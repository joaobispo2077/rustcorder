# Data Model: Automatic Release and PR Reporting

## Implementation clarification — 2026-11-14

The metadata intent carries exactly one authenticated principal: app (validated App ID, bot ID/slug/login) or writer (kind token, numeric ID/login resolved using GH_TOKEN). Controls, preparation and source evidence remain schema-v2 bindings. Sealing snapshots nested identities. Published preparation/intent/policy/final-report attachments are durable; per-control authority/receipt artifacts retain fourteen days.

This extends existing context, receipt, certification, preparation and candidate
records; it does not replace the existing evidence schema or add a database.
Contracts: [release](contracts/release-automation.md),
[PR report](contracts/pr-quality-report.md).

## Common identity

Use existing repository ID/name, workflow ID/path/control SHA, run ID, run number,
attempt, source SHA, tested SHA, policy/toolchain SHA-256, artifact ID/API digest
and canonical record digests. IDs are bounded safe integers, SHAs/hashes strict
hex values. Resolve trusted control from the actual main workflow environment/API,
never from report claims. Source/final CI latest attempts are checked independently.

Automatic release preparation, intent, candidate, authority and publication records
use schema_version 2 and the explicit kinds in the release contract. Current gate
receipts remain version 1. Manual version-1 authorization must not silently
deserialize as automatic authority. Hash canonical JSON with the existing helper.
ReleasePolicy and CommentProjection start at schema_version 1; their kinds and
settings are defined in their respective contracts.

## Entities

| Entity | Fields / relationships | Validation |
| --- | --- | --- |
| ReleasePolicy | schema version, automation_enabled, initial_version | Trusted-main file and digest; stable initial SemVer or null; disabled until owner setup. Null blocks bootstrap, not already-published ancestry. |
| EligibleReleaseSource | repository, source P, merged PR number/base/head/merge identity, source CI context and frozen evidence, policy digest | Same-repository develop→release PR is merged; P is current release tip; actual successful release-push CI and complete source bytes; no missing/cancelled/stale evidence. |
| VersionDecision | previous published ancestor, analyzed original commits, impact, next version/no-release, initial-version provenance, normalized notes digest | Highest impact; full reachable history; authenticated metadata excluded; bootstrap requires impact and explicit initial setting. |
| AutomaticPreparation | kind/schema, source P, decision/proposal digest, source CI/evidence, release-policy digest, preparation control, date, permitted/changed paths, patch digest, expected tree, metadata-graph result, frozen commit identities | Read-only Windows preparation; only root version declarations/lock entry, changelog and bounded snapshot; no dependency/source drift. No completion-confirmed boolean masquerading as new authority. |
| MetadataIntent | kind/schema, preparation artifact ID/digest and record digest, P, metadata C, expected tree, version, frozen message/author/date, writer workflow/control/run/attempt, configured App identity, canonical intent digest | Successful trusted writer; exact artifact provenance; C has only parent P and expected tree; uploaded before branch advancement; message is only a lookup hint. |
| FinalCandidate | existing frozen candidate fields plus metadata intent and automatic preparation references | Current C, complete latest C release-push CI/package/native proof, exact prepared tree/version, matching assets/checksums and policy; P proof is historical. |
| AutomaticPublicationAuthority | kind/schema, candidate digest, source/final/intent/preparation identities, policy/control identity, authorization reason | Actual trusted-main automatic controller; enabled policy; no substituted bytes or stale validation. Independent Node and PowerShell checks. No reviewer/environment ID required. |
| PublicationReceipt | existing publication identities, tag object/type, release/asset IDs, digests, attempt and outcome; add automatic authority/intent linkage | Matching annotated tag and verified immutable bytes; readable reason for no-release, blocked, resumable or completed result. |
| CommentProjection | existing context, PR hints, preliminary assessment, bounded gate rows, fixed full-evidence artifact name | ≤1 MiB; known gate IDs/types; no arbitrary URLs/HTML/paths; artifact identity frozen from exact CI attempt. |
| CurrentPrEvidence | verified PR base/head repo/ref/SHA/state, tested merge SHA, upstream workflow/run/attempt, actual jobs and certification, optional projection | PR hints are cross-checked; fork head repo may differ from base; missing projection/certification cannot be green. |
| OwnedPrReport | marker/version, numeric author ID, comment ID, PR/head/tested identity, run order/attempt, phase, report digest | At most one current owned comment; unrelated/human comments untouched; metadata is parsed as bounded data and revalidated with API state. |
| CommentDelivery | desired state, status, comment ID, checked head/run/attempt, delivery reason and fallback links | Transport outcome never changes upstream gate readiness; invalid report construction remains failure. |

## Release transitions

```text
disabled / unsupported event -> no write, explain prerequisite or exclusion
verified source P -> no-release                         (no impact)
verified source P -> prepared                           (explicit version decision)
prepared -> intent persisted for C -> release ref at C   (non-forced update)
release ref at C -> awaiting final CI                    (release lock released)
authenticated C + complete fresh CI -> final candidate
final candidate -> annotated tag -> verified draft/assets -> published
```

Any missing/invalid/stale evidence blocks the next write. Partial tag/draft/asset
state resumes only when identities and bytes match. Conflicting reserved versions
stop. Do not move or delete a tag to resolve a conflict automatically.

A new merged source above unpublished metadata supersedes publication work and
recomputes from the last published ancestor. Only authenticated unpublished entry
and snapshot may be reconciled; all real unreleased commits remain in analysis.
A published candidate promoted to main produces no version decision or publication.

## Record durability and retry rules

- Freeze commit author/committer timestamps and message before creating C so a
  retry does not create a different SHA. After an uncertain ref response, read the
  ref: C means matching success, P permits an identical retry, another SHA blocks.
- Persist the metadata intent before the ref update, indexed by exact C. Multiple
  matching records may converge; conflicting records stop. A forged trailer or bot
  author cannot manufacture trusted artifact provenance.
- Intent/preparation provenance remains bound to the exact successful creator
  attempt. A rerun must not substitute latest-attempt bytes for that artifact ID.
  Inspect exact-attempt history; conflicting later intent invalidates continuation.
  Current source/final validation still requires the latest CI run/attempt.
- Expired or missing unpublished provenance blocks automatic recovery with a reason.
  Published release evidence retains the authority/intent alongside existing assets.
- The quality snapshot records source P's preparation baseline. Final C's quality
  report is attached to the release; do not edit C to embed C's own final evidence
  and create another validation loop.

## Comment transitions

```text
verified current PR/run -> pending -> passed | failed | incomplete
new head/run/attempt    -> pending or newer terminal result
old completion         -> reconcile newest state, never overwrite with old success
closed/merged PR        -> historical/closed wording, no current approval
delivery forbidden     -> fallback + explicit delivery outcome
```

Order distinct runs by verified run ordering; compare attempts only within one
run. Recheck before and after comment writes. GitHub offers no atomic head guard
on PATCH, so exact-head wording and reconciliation remain required even with
per-PR serialization. Reports convey CI evidence, never release authorization.
