# Validation Guide: Automatic Releases and PR Reports

## Implementation clarification — 2026-11-14

The owner selected the existing origin and AVO’s GH_TOKEN secret convention. The workflow now supports a fine-grained contents-write token or the optional App. Do not use production as disposable release data. Hosted synthetic publication acceptance remains pending until an owner-approved environment is available; ordinary origin CI/report observation can proceed after approved commits/installations.

Status: **design guide**. Current commands below exist; new fixtures and automatic
GitHub behavior become available during implementation. This guide does not
authorize a production version entry, tag, publication or PR comment now.

Contracts: [release](contracts/release-automation.md),
[PR reporting](contracts/pr-quality-report.md), [records](data-model.md).

## Prerequisites

Use the current branch and preserve existing dirty work. Install pinned Node
24.22.2 and locked CI tools; initial dependency acquisition needs network.
Windows boundary checks require the current PowerShell/MSVC environment. Native
acceptance needs the existing real desktop capability preflight. No microphone,
private audio or ASR model is needed.

Do not run write-path tests against the production repository. Use the existing
injected API/fixture backend. The owner selected origin for ordinary CI/report
observations. Publication rehearsal needs a separately owner-approved version and
environment boundary; do not treat origin's product tags as disposable fixtures. Do not create or switch
local branches as part of this guide.

## Existing checks, reused after implementation

From the repository root:

```powershell
rtk git status --short --branch
rtk proxy npm.cmd ci --prefix scripts/ci --omit=peer --ignore-scripts
rtk proxy npm.cmd test --prefix scripts/ci
rtk proxy npm.cmd run check --prefix scripts/ci
rtk proxy powershell -NoProfile -File scripts/ci/tests/publish.test.ps1
```

Expected: existing support/publisher checks stay green. Implementation adds focused
tests to the same suite and extends syntax/workflow/mutation coverage to new modules.
These commands were not run by this documentation-only planning task; the read-only
option probe is narrower evidence.

## Test-first implementation acceptance

Before each behavior change, show the focused new test fails for the intended
reason, implement the smallest change, then rerun it and relevant existing checks.
Keep fixtures synthetic; published product records are never scratch data.

| Scenario | Expected result |
| --- | --- |
| Original 13 semantic fixtures plus hyphen footer and ignored-type bang | Approved impact, including zero-major MAJOR and release-doc PATCH; maintenance no release |
| Fixed-date notes 14.1.1/Angular 8.3.1 snapshots | Correct order, heading levels, sections/links, release docs and unchanged originals/history |
| Merged child feature, mixed impacts, feature/revert histories | Full-history highest impact and reference revert behavior |
| Bootstrap missing explicit version; maintenance-only history | Actionable block or no-release, no inferred start |
| Wrong PR/repository/source/run/attempt/report bytes | Zero metadata writes/publications |
| Bounded preparation, CRLF/history, dependency graph | Only four allowed paths/root version tokens change; published bytes retained |
| Intent upload fails before ref advancement | No ref update; deterministic C reusable |
| Lost ref response, duplicate intent, copied bot message | Matching C resumes; forged/conflicting provenance stops |
| Generated metadata CI with breaking notes body | Own full validation then continuation, zero recursive bumps |
| New tip/newer failed attempt during writes | Superseded work stops, unreleased changes retained |
| Interrupted tag/draft/asset write | Matching state resumes; conflicts never overwrite |
| Two PR heads, three attempts, distinct runs out of order | New pending/failure cannot be replaced by stale success; one current owned comment |
| Fork identity, absent/malformed projection/certification | Verified report or incomplete/fallback, never fabricated green |
| Human marker, lost POST, deleted/duplicate owned comment | Only owned comments reconciled |
| Oversized/unsafe text, zero versus missing counts | Safe bounded rendering and verified links |
| Forbidden/service-failed comment delivery | Visible fallback, upstream readiness unchanged |
| Release-to-main promotion | Same published version, zero additional releases |

## Hosted rehearsal before activation

1. Install controller/reporter on the owner-approved repository's default main branch
   through its normal owner-managed process. Local fixtures cannot prove actual
   workflow_run installation or token permissions.
2. Configure the GH_TOKEN contents-write secret for the trusted writer, or the
   optional RELEASE_APP_CLIENT_ID/RELEASE_APP_PRIVATE_KEY App setup. Verify narrowly scoped
   existing-release-ref rules; no recurring environment reviewer.
3. Supply an explicit stable initial version for the synthetic product and enable
   adoption only after governance/rules align.
4. Merge an eligible synthetic PR into release. Confirm source gates, intent
   persistence before ref advancement, and normal CI triggered by authenticated-writer-created C.
5. Confirm C's version-matching package/native smoke and every required gate.
   Inspect annotated tag object type, source, notes, asset checksums, authority/intent
   and final quality report. Source-P results alone must fail.
6. Repeat three reruns and five duplicate events, interrupt boundary writes and
   introduce a racing PR. Expect one matching release or an explicit conflict.
7. Exercise passing/failing/incomplete/fork PRs, two heads and three attempts.
   Verify final-readiness overlay, ownership, pending state and fallback. Measure
   the 95%-within-five-minutes target under working service/permissions.
8. Verify main promotion, disabled adoption and credential revocation. Record actual
   timing/evidence and limits before production activation.

Production setup is a separate owner operation after implementation is proven.
This plan supplies no product tag/publish command and performs no remote setup.
