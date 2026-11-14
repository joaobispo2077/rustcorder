# Implementation Plan: Automated Semantic Releases and PR Quality Reports

## Implementation clarification — 2026-11-14

Owner implementation clarification: use AVO’s GH_TOKEN secret name on the existing origin. A fine-grained repository token is supported alongside the planned optional App. Resolve the authenticated numeric writer identity through GitHub and match C’s CI actor; no job-token fallback may suppress C’s push CI.

**Branch**: `feature/transcription-speaker-insights` | **Date**: 2026-11-14 | **Spec**: [spec.md](spec.md)

**Input**: `specs/004-automated-semantic-release/spec.md`

## Summary

Continue the existing trusted-main release controller automatically after a
merged develop-to-release PR and complete release-push CI. Prepare a bounded
metadata commit, push it to the existing release ref with the authenticated GH_TOKEN
owner or optional repository-scoped App, wait for its own quality/package/native proof, then reuse the
annotated-tag and immutable-asset publisher. Main promotion preserves the version.

Keep the installed official semantic-release analyzer/notes hooks. Add AVO's
Angular presentation and footer keywords while preserving Rustcorder's bang,
release-doc and existing hyphenated-footer behavior. Native tooling was assessed;
git-cliff remains a future qualification candidate rather than an additional
dependency in this implementation. Never invoke semantic-release's publishing core.

Publish PR quality comments from a separate trusted workflow, using a bounded
report projection and authoritative final CI state. Ordinary CI stays read-only.
All design decisions are resolved in [research.md](research.md); the readable
implementation explanation is [under docs/](../../docs/automated-semantic-release-plan.md).

## Technical Context

**Language/Version**: Existing Rust 2024 / Windows MSVC toolchain
`1.95.0-x86_64-pc-windows-msvc`; existing PowerShell packaging/publisher;
Node `24.22.2` for CI-only analysis, decisions, report rendering and GitHub I/O.
No desktop runtime or Cargo dependency changes.

**Primary Dependencies**: Retain analyzer `13.0.1`, Conventional Commits preset
`9.1.0`, semver `7.7.3` and existing YAML/tool pins. Update notes generator to
`14.1.1`; explicitly pin Angular preset `8.3.1` and lockfile integrity. Retain the
unused semantic-release peer override; do not call its release lifecycle. Add the
official App-token action `v3.3.0`, pinned to
`64ab729a6294000f5aa4a4bc0b73d1f32bc45510`, to the existing toolchain inventory.
No sticky-comment action, Rust release executable or new service.

**Storage**: Existing 14-day CI artifacts and published release evidence; small
versioned preparation, metadata-intent and publication records; one bounded owned
comment per PR. Add `scripts/ci/release-policy.json` for an explicit disabled/enabled
adoption switch and nullable initial version. No database, state branch or state file
inside the application tree. Expired unpublished intent requires recovery, never
trust from a copied commit message.

**Testing**: Existing Node built-in runner and injected GitHub/process fixtures;
existing PowerShell publisher boundary suite; fixed-date analyzer/notes corpus;
workflow policy/actionlint checks; hosted final-version Windows package/native
smoke. Reuse existing tests and fixture backend rather than a second harness.

**Target Platform**: Existing Windows x64 product CI/package/native jobs;
Windows read-only Cargo preparation; Ubuntu 24.04 trusted metadata-write,
publication and comment control jobs. Product platform scope remains unchanged.

**Project Type**: Existing desktop app with repository-local CI support.

**Performance Goals**: At least 95% of available terminal PR reports within five
minutes of the conclusive result; one candidate after three reruns/five duplicate
events. Retain current quality floors, job budgets and artifact retention.

**Constraints**: Main-controlled code only in write jobs; no candidate execution,
candidate dependencies or candidate caches with write credentials. Full proof on
the generated metadata SHA. No per-release confirmation or environment reviewer.
No automatic PR merging, new branch creation, tag replacement, asset overwrite,
registry publication or additional platforms. Preserve unrelated dirty work.

**Scale/Scope**: One Cargo product; existing develop/release/main targets; modify
the release and CI workflows, add one PR-comment workflow, extend the existing CI
support modules and add two cohesive modules for metadata writes and comment I/O.

## Constitution Check

Pre-research and post-design reviews pass with the **explicit user-authorized
bounded release-policy exception** below. This planning task does not activate it.

| Principle | Pre-research | Post-design evidence |
| --- | --- | --- |
| I: User-owned branches / bounded changes | Pass | Actual checked-out branch retained. Interactive agents get no branch authority. Future CI may update only the existing release ref with the exact allowlisted metadata tree after validation. |
| II: Test first | Pass | Failing semantic, intent, authority, race and reporting fixtures precede behavior changes; existing boundary/native proof is retained. |
| III: Simplicity | Pass | Reuse release/report/gate modules and publisher. Plain functions and explicit I/O; no generic workflow framework or application restructuring. |
| IV: Controlled release | Authorized exception | User chose fully automatic after gates and Rustcorder rules with AVO format. Implement canonical/derived policy alignment before enabling writes; annotated tags and immutable publication remain mandatory. |
| V: Durable docs / honest evidence | Pass | Explanation under docs/; workflow artifacts here; probe limits and future hosted acceptance distinguished. |

Before activation, amend Constitution IV and its Sync Impact Report, AGENTS.md,
applicable agent/versioning instructions and template wording together. Explicitly
authorize the narrow CI metadata update without weakening interactive branch
ownership. Replace manual-only current release guidance, while marking old feature
003 documents as historical instead of rewriting their evidence. Shipping remains
disabled until governance, owner App setup and branch rules are consistent.

Architecture/pattern selection instructions were consulted. Keep existing modules;
the actual new I/O responsibilities justify `release-automation.mjs` and
`pr-comment.mjs`. Do not add a plugin system, state-machine framework or Rust
application layer for CI. New pure decisions should meet the project's 90% cheap
unit-test target where feasible; count actual populations and explain necessary
GitHub/filesystem/native exceptions without padding tests.

## Project Structure

### Documentation (this feature)

```text
specs/004-automated-semantic-release/
  spec.md
  plan.md
  research.md
  data-model.md
  quickstart.md
  contracts/
    release-automation.md
    pr-quality-report.md
  checklists/requirements.md
docs/
  automated-semantic-release-research.md
  automated-semantic-release-plan.md
```

`tasks.md` is generated by the next `/speckit-tasks` phase, not this command.

### Source Code (repository root)

```text
.github/workflows/
  ci.yml                       # compact report input; existing gates retained
  release.yml                  # source preparation + metadata continuation
  quality-comment.yml          # new trusted PR reporting workflow
scripts/ci/
  release.mjs                  # semantic/notes/preparation/final authorization seams
  release-automation.mjs       # new bounded intent/ref I/O and routing
  release-policy.json          # new explicit adoption settings
  report.mjs                   # compact projection + safe PR renderer
  pr-comment.mjs               # new verified PR resolution/comment I/O
  publish.ps1                  # automatic-authority checks, existing publisher
  gates.mjs                    # narrowly scoped workflow-policy extensions
  package.json, package-lock.json, toolchain.json
  test-populations.json, stryker.config.mjs
  tests/                       # extend current corpus/fixtures; no second backend
docs/quality-metrics.md         # future bounded preparation-baseline snapshot
```

**Structure Decision**: CI-only additions with cohesive responsibilities. Existing
`src/`, transcription workers, desktop tests and package layout remain outside this
change. Tests/config coverage includes both new helper modules; extend executable
syntax checks and the mutation/test-population inventory when those modules land.

## Phase 0 — Resolved decisions

1. Keep official hooks; configure AVO-style notes on cloned inputs, preserving
   original hashes/messages and the existing `BREAKING-CHANGE` alias.
2. Separate read-only Windows preparation from trusted Ubuntu metadata writes.
3. Use an App-token push to preserve the existing actual release-push evidence
   contract; create an immutable intent before advancing the existing ref.
4. Route authenticated metadata to final validation/publication, never another bump.
5. Replace manual approval fields in both Node and PowerShell with versioned exact
   automatic authority. Preserve all independent identity and integrity guards.
6. Use a separate report workflow with safe data-only artifacts, current PR checks,
   numeric bot ownership and per-PR serialization.
7. Bootstrap only from an explicit adoption version and releasable history. An
   absent setting blocks initial publication; nonbreaking maintenance stays no-release.

See [decision evidence](research.md) and [records/state transitions](data-model.md).
There are no unresolved design clarifications; owner provisioning is an activation
prerequisite, not an assumed available credential or proof of deployed settings.

## Phase 1 — Design and delivery sequence

1. Align governance/current release docs with the approved future authorization;
   retain disabled adoption settings. Review atomic commit groups before any commit.
2. Pin reference notes packages/action, add fixed synthetic histories/snapshots and
   extend the existing fixture backend only for needed GitHub operations.
3. Demonstrate failing tests for semantics/format, source authority, bounded writes,
   final metadata validation, duplicate/conflicting recovery and stale comments.
4. Implement the small hook/config/heading changes and the two boundary modules.
   Add versioned authority checks in Node and PowerShell without weakening old
   digest, provenance, latest-attempt, package or native checks.
5. Wire trusted workflows and narrow permissions; keep ordinary CI read-only.
   Add pinned action/workflow-policy checks and mutation/test-population coverage.
6. Validate locally, then in a disposable repository/runner with synthetic product
   fixtures. Verify real App-triggered final CI, comment permissions and native
   package identity before enabling the production adoption switch.

The [release contract](contracts/release-automation.md) and
[PR report contract](contracts/pr-quality-report.md) define behavior at GitHub
interfaces. The [quickstart](quickstart.md) separates current commands from future
acceptance and supplies no production tag/publication command.

Rollback disables the adoption switch and revokes the release App credential if
needed. Ordinary CI and report artifacts continue. Preserve existing commits,
tags, releases and assets; revert code through reviewed normal changes rather
than moving published records. Comment delivery can be disabled independently.

## Complexity Tracking

| Authorized exception | Why needed | Bound and remediation |
| --- | --- | --- |
| Replace Constitution IV's per-release confirmation/environment approval for this flow | Explicit user choice: fully automatic after gates, matching AVO | Only verified merged release changes and authenticated metadata continuation; policy/governance alignment and owner setup precede activation; immutable annotated tags and agent branch limits retained. |
