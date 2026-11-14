# Tasks: Automated Semantic Releases and PR Quality Reports

**Input**: Design documents in `specs/004-automated-semantic-release/`.

**Prerequisites**: [plan](plan.md), [specification](spec.md), [research](research.md),
[data model](data-model.md), [release contract](contracts/release-automation.md),
[PR report contract](contracts/pr-quality-report.md), [validation guide](quickstart.md).

**Branch**: `feature/transcription-speaker-insights` — retain the actual checked-out
branch and unrelated dirty work. Paths below are repository-relative.

**Tests**: Demonstrate failing behavior checks before implementation, retain existing
passing cases, then prove the focused change and relevant regression suite. Documentation
uses content/link/consistency checks. All tasks start unchecked; generation is not
implementation evidence. Prefix shell commands with `rtk`.

## Format and execution rules

Each task has a sequential ID, optional [P], story label in story phases, and file
paths. [P] applies only to ready tasks in the explicit batches below: prerequisites
must be complete, and simultaneous tasks must not edit the same files. Default
execution follows ID order. Equal-priority US3 precedes US1 because its semantic
rules are an actual prerequisite; US2 can proceed independently after foundations.

Keep production adoption disabled until every story and hosted acceptance passes.
The first US1 demonstration uses the isolated fixture backend. Preserve the existing
annotated-tag/asset integrity boundary from the beginning; later P2 phases complete
adversarial/recovery coverage rather than grant permission to omit initial guards.

Throughout implementation, stage only this feature's reviewed changes by functional
scope. Before each commit batch, show file groups, why each exists and Conventional
Commit messages, then wait for approval. Keep documentation, test infrastructure,
tests, behavior and workflow infrastructure in separate atomic commits. This task
list authorizes no branch operations, product release, remote setup or PR comment
during generation. Owner-provisioned hosted fixtures are explicit dependencies.

## Phase 1: Setup

**Purpose**: Preserve the workspace, align the approved policy and pin the reference.

- [X] T001 Capture branch/HEAD/staging and content hashes of existing dirty work before implementation; initialize `docs/automated-semantic-release-validation.md` with scope, preservation baseline and unperformed checks. Do not stage unrelated files.
- [X] T002 [P] Amend `.specify/memory/constitution.md` and `AGENTS.md` with the approved automatic-flow exception, governance version/Sync Impact Report and narrow CI authority to update only the existing release ref; retain interactive branch restrictions, annotated tags and publication immutability.
- [X] T003 Align copied release-policy wording in `.github/instructions/versioning-and-documentation.instructions.md`, `.cursor/rules/40-versioning-and-changelog.mdc`, `.specify/templates/plan-template.md`, `.specify/templates/spec-template.md` and `.specify/templates/tasks-template.md`; check forwarding instructions in `CLAUDE.md` and `.github/copilot-instructions.md` without changing unrelated policies. Depends on T002.
- [X] T004 [P] Pin notes generator 14.1.1 and Angular preset 8.3.1 in `scripts/ci/package.json` and `scripts/ci/package-lock.json`; retain analyzer 13.0.1, Conventional Commits 9.1.0 and the noninvoked semantic-release peer override. Verify locked installation without lifecycle scripts or Cargo dependency changes.

**Checkpoint**: Governance accurately describes the bounded future flow; no release
has been enabled. T002 and T004 may run together after T001; T003 follows T002.

## Phase 2: Foundational prerequisites

**Purpose**: Reusable test inputs, strict records and workflow permission contracts.
Complete this phase before any story's implementation.

- [X] T005 [P] Extend injected API fixtures in `scripts/ci/tests/release-flow.test.mjs` and `scripts/ci/tests/release-flow.fixture.ps1` for merged PRs, exact-attempt artifacts, Git blobs/trees/commits/ref responses and immutable intents; retain network-denial defaults and the existing bare-object helper `scripts/ci/tests/git-fixture.mjs`, with no branch creation or second fixture backend.
- [X] T006 [P] Add synthetic commit histories and fixed-date oracle inputs in `scripts/ci/tests/fixtures/semantic-release.json`, with reviewed expected notes in `scripts/ci/tests/fixtures/release-notes/major.md`, `minor.md`, `patch.md` and `initial.md`; record the pinned AVO source plus intentional bang/release-doc/footer extensions without importing its executable config.
- [X] T007 Demonstrate failing policy/record tests in `scripts/ci/tests/release-decisions.test.mjs` for disabled adoption, null/invalid initial versions, v2 preparation/intent/candidate/authority/receipt kinds, canonical digests and rejection of manual-v1 authority on the automatic path.
- [X] T008 Add disabled-by-default `scripts/ci/release-policy.json` with schema_version 1, automation_enabled false and initial_version null; implement shared strict policy/v2-record validation in `scripts/ci/release.mjs`, retaining existing v1 gate/context/certification schemas. Make T007 pass.
- [X] T009 Demonstrate failing role-policy tests in `scripts/ci/tests/workflows.test.mjs` and `scripts/ci/tests/security.test.mjs` for read-only CI, read-only preparation, bounded metadata App writes, independent publisher writes and comment-only reporter authority; reject candidate execution/caches/dependencies with write credentials.
- [X] T010 Extend `scripts/ci/gates.mjs` workflow-policy validation only for those explicit roles and trusted-main controls; keep ordinary CI's no-write rule and pinned-action checks strict. Make T009 pass without adding a generic workflow framework.

**Checkpoint**: Shared fixtures and strict contracts pass. Only T005/T006 form a
parallel batch; freeze their interfaces before story test batches begin.

## Phase 3: User Story 3 — Predictable semantic versions and changelog (P1)

**Goal**: Preserve Rustcorder's impact rules with AVO's configured presentation.

**Independent Test**: Run the shared synthetic corpus with fixed dates/URLs and
pinned libraries; inspect exact decisions, notes snapshots, preserved original
messages/hashes and unchanged historical bytes. No GitHub writes are necessary.

### Tests first

- [X] T011 [P] [US3] Add failing cases in `scripts/ci/tests/semantic.test.mjs` for the thirteen reference cases, the existing BREAKING-CHANGE alias, breaking ignored types, bang headers, all required footer forms, highest impact, zero-major MAJOR, perf/revert behavior and no-release maintenance; consume T006 fixtures.
- [X] T012 [P] [US3] Add failing fixed-date rendering tests in `scripts/ci/tests/notes.test.mjs` for Angular heading levels, Bug Fixes/Features/Performance Improvements/BREAKING CHANGES, subject-then-scope ordering, links, docs(release) inclusion, no duplicate synthesized footer and unchanged original input objects.
- [X] T013 [P] [US3] Add failing insertion/extraction tests in `scripts/ci/tests/preparation.test.mjs` for historical plain headings and new linked major/minor/patch/initial headings, LF/CRLF preservation, duplicate/ambiguous heading rejection and unchanged published entries.
- [X] T014 [P] [US3] Add failing bootstrap/history tests in `scripts/ci/tests/proposal.test.mjs` for explicit initial-version selection, missing setting/history rejection, maintenance-only no-release, merged child commits and last-published-ancestor selection; reject engine-default/manifest-only bootstrap inference.

### Implementation

- [X] T015 [US3] Update `semanticConfig` and `semanticImpact` in `scripts/ci/release.mjs` with the four-keyword union and preserved Rustcorder rules/default perf/revert handling; retain full merged-history highest-impact semantics. Make T011 pass.
- [X] T016 [US3] Implement a pure cloned notes-input mapper and pinned Angular generation in `scripts/ci/release.mjs`: docs(release) becomes fix(release) only for notes; remove bang syntax for Angular and synthesize a standard breaking note only when needed; preserve hashes, reference enrichment and subject-then-scope order. Make T012 pass.
- [X] T017 [US3] Share a bounded release-heading recognizer between `preparedChangelog` and `releaseEntry` in `scripts/ci/release.mjs`; generate new Angular entries while preserving old bytes and refusing published/ambiguous duplicates. Make T013 pass.
- [X] T018 [US3] Update `createProposal`/history decisions in `scripts/ci/release.mjs` to require explicit adoption version and releasable history for bootstrap, otherwise return no-release or a precise block; preserve current published-ancestry checks. Make T014 pass.
- [X] T019 [US3] Run semantic, notes, preparation, proposal and existing release-decision suites; record exact reference versions, fixture outcomes and preservation limits in `docs/automated-semantic-release-validation.md`. Do not edit the real `CHANGELOG.md` or product version.

**Checkpoint**: US3 is independently proven and unblocks US1. T011–T014 must show
the intended red baseline before T015–T018 behavior implementation.

## Phase 4: User Story 1 — Automatic release after eligible gates (P1)

**Goal**: Source P → bounded metadata C → fresh C gates → annotated publication,
without a per-release manual confirmation or reviewer.

**Independent Test**: Use the joined fixture backend to introduce an eligible merged
PR, certify P, persist intent before advancing the simulated existing release ref,
certify C, and publish one matching synthetic release. Every missing gate blocks
the next write; open-PR success and denied setup produce no publication.

### Tests first

- [X] T020 [P] [US1] Add failing eligibility/evidence tests in `scripts/ci/tests/release-decisions.test.mjs` for merged develop→release association, same-repository actual push, latest run/attempt, complete downloaded source certification/report bytes and explicit setup/no-release outcomes; reject open PRs, unrelated direct pushes and stale metadata-only preview evidence.
- [X] T021 [P] [US1] Add failing writer-contract tests in `scripts/ci/tests/release-automation.test.mjs` for deterministic single-parent C, four-path/token allowlists, API-returned tree/SHA validation, immutable intent upload before non-forced existing-ref advancement, current P/already-C behavior and blocked credentials/rules.
- [X] T022 [P] [US1] Add failing final-candidate/automatic-authority cases in `scripts/ci/tests/authorization.test.mjs`, `scripts/ci/tests/publish.test.ps1` and the joined `scripts/ci/tests/release-flow.test.mjs`; require C's own package/native evidence, historical P provenance and independent v2 Node/PowerShell binding, with no manual environment/reviewer field.
- [X] T023 [P] [US1] Add failing automatic workflow tests in `scripts/ci/tests/preview-workflow.test.mjs` for trusted-main source, read-only Windows preparation, isolated Ubuntu writer, pinned App action, ordinary App-triggered push CI, independent publisher token and no prepare/publish dispatch or per-release environment review.

### Implementation

- [X] T024 [US1] Add source/metadata routing and verified merged-PR resolution in `scripts/ci/release-automation.mjs`; reuse `scripts/ci/release.mjs` source verification and recollect actual certification/report bytes before granting preparation authority. Make T020 pass.
- [X] T025 [US1] Extend read-only preparation in `scripts/ci/release.mjs` to emit v2 automatic preparation, policy/source authority and a bounded `docs/quality-metrics.md` preparation-baseline snapshot; preserve root version-token edits, exact expected tree and before/after Cargo graph with no candidate-config execution or dependency drift.
- [X] T026 [US1] Implement deterministic blob/tree/single-parent commit creation in `scripts/ci/release-automation.mjs` from exact prepared bytes, frozen dates/message and validated writer identity; permit only the prepared allowlist and validate API response identities. Run no Cargo/candidate scripts in the write path.
- [X] T027 [US1] Implement immutable intent persistence/lookup/provenance and the separate non-forced existing-release-ref advancement step in `scripts/ci/release-automation.mjs`; require confirmed uploaded artifact ID/digest before ref mutation and refuse message-only or bot-name-only authority. Make T021 pass.
- [X] T028 [US1] Extend `preflight`, `verifyCandidate` and control-artifact validation in `scripts/ci/release.mjs` for authenticated C continuation, exact original preparation/intent artifacts and C's latest full CI/package/native proof; validate historical P separately from current C.
- [X] T029 [P] [US1] Replace reviewer lookup/manual confirmation authority in `scripts/ci/release.mjs` with strict automatic-candidate/authority v2 bindings, enabled trusted policy and actual main workflow_run provenance; preserve canonical digests and every source/artifact freshness recheck. Depends on T028.
- [X] T030 [P] [US1] Update `Assert-PublishBinding`, trusted environment/control and receipt handling in `scripts/ci/publish.ps1` for the same automatic v2 authority/event model; retain annotated-tag, exact bytes, artifact scope and immutability checks. Depends on T028 and the frozen authority contract.
- [X] T031 [US1] Add official create-github-app-token v3.3.0 at `64ab729a6294000f5aa4a4bc0b73d1f32bc45510` to `scripts/ci/toolchain.json`; verify the planned exact release pin and retain existing action pins without adding a custom token implementation.
- [X] T032 [US1] Wire `.github/workflows/release.yml` to the automatic source/preparation/writer/final-publication paths: upload intent before ref advancement, use GH_TOKEN or mint/revoke the optional repository-scoped App token only in the writer, retain actual release-push native CI and publish with its own job token; keep adoption disabled.
- [X] T033 [US1] Integrate the concrete release jobs/action inventory with `scripts/ci/gates.mjs` and run `scripts/ci/tests/preview-workflow.test.mjs` plus workflow-policy checks; remove manual-path assumptions without weakening ordinary CI or trusting candidate control files.
- [X] T034 [US1] Run the joined source→intent→C-proof→publication fixture and publisher boundary checks; record one aligned synthetic outcome and all blocked-source cases in `docs/automated-semantic-release-validation.md`. No live product release is needed for this checkpoint.

**Checkpoint**: A fixture-backed US1 increment works after US3. Production stays
disabled until US4/US5 and Phase 8 complete. T020–T023 are the parallel red-test batch;
T029/T030 may run together only after T028 fixes the shared authority interface.

## Phase 5: User Story 2 — Quality results in PR comments (P1)

**Goal**: One current owned report per PR, including failure/incomplete/excluded
states and readable fallback, with no release authority in reporting.

**Independent Test**: Inject passing/failing/incomplete CI attempts and verified
fork/current PR identities. Verify final-readiness overlay, one bot-owned comment,
head/run/attempt ordering, safe rendering and forbidden-delivery fallback.

### Tests first

- [X] T035 [P] [US2] Add failing projection/renderer tests in `scripts/ci/tests/report.test.mjs` for schema-v1 pr-quality-projection, ≤1 MiB input, ≤48 KiB Markdown, known gates, identity, raw measurements/thresholds, exclusions, zero versus missing counts, safe text/mentions/links and report-construction failure.
- [X] T036 [P] [US2] Add failing API/state tests in `scripts/ci/tests/pr-comment.test.mjs` for verified run/PR/fork association, exact-attempt jobs/certification, missing-report diagnostics, pending/terminal states, current head/run ordering, numeric bot ownership, lost POST/duplicate recovery and forbidden/service-failed delivery.
- [X] T037 [P] [US2] Add failing workflow tests in `scripts/ci/tests/pr-comment-workflow.test.mjs` for requested/in_progress/completed events, no success-only or target-branch workflow_run filter, read-only resolver and per-PR comment-write job, trusted checkout and absence of release credentials/candidate execution.

### Implementation

- [X] T038 [US2] Add bounded compact projection construction and `renderPrReport` in `scripts/ci/report.mjs`, reusing measurement formatting/escaping; generate verified evidence links and visible truncation without copying arbitrary artifact Markdown. Make T035 pass.
- [X] T039 [US2] Implement read-only run/PR resolution and bounded exact-attempt artifact loading in `scripts/ci/pr-comment.mjs`; treat PR-number hints as untrusted, verify target/head/tested merge and head-repository identity, allow verified forks and refuse ambiguous/direct-push associations.
- [X] T040 [US2] Implement current PR evidence aggregation in `scripts/ci/pr-comment.mjs` using actual jobs plus final certification; a preliminary report alone cannot be green, and missing/cancelled/timed-out/stale results remain incomplete/failed/pending as appropriate.
- [X] T041 [US2] Implement numeric bot ownership, fixed marker, pagination, idempotent create/update and pre/post-write freshness reconciliation in `scripts/ci/pr-comment.mjs`; compare attempts only within a run, reconcile newest run state and neutralize superseded/closed approval wording.
- [X] T042 [US2] Add explicit delivery outcomes, safe summary/artifact output and bounded transport retry in `scripts/ci/pr-comment.mjs`; relist after uncertain POST, preserve original run evidence and distinguish report construction from comment transport failure. Make T036 pass.
- [X] T043 [US2] Extend `.github/workflows/ci.yml` report construction/upload to include the compact quality-comment-RUN-ATTEMPT artifact; preserve full artifacts, final readiness ordering, all gate applicability and ordinary CI read-only permissions.
- [X] T044 [US2] Add `.github/workflows/quality-comment.yml` with trusted-main pinned code/dependencies, read-only resolution then comment-only per-PR concurrency, exact source identity checks and summary/delivery artifact fallback; do not use pull_request_target or a global report queue.
- [X] T045 [US2] Integrate reporter workflow policy in `scripts/ci/gates.mjs` and run the actual-YAML checks in `scripts/ci/tests/pr-comment-workflow.test.mjs`; verify no write role can install/execute candidate code or acquire the release App credential.
- [X] T046 [US2] Update `docs/automated-semantic-release-plan.md` with the implemented comment identity/state, target branches, final-readiness overlay, fork limits and delivery fallback; label hosted behavior unproven until Phase 8.
- [X] T047 [US2] Run projection, reporter, workflow and relevant security/regression suites; record independently observed passing/failing/incomplete/forbidden scenarios in `docs/automated-semantic-release-validation.md` without posting to production PRs.

**Checkpoint**: US2 is independently useful after foundations. T035–T037 may run
together; coordinate shared gates/workflow files with US1 instead of editing them
concurrently. Old callback reconciliation must be proven locally before deployment.

## Phase 6: User Story 4 — Safe retries and concurrent changes (P2)

**Goal**: Repeated events and interruptions converge, while stale/conflicting work stops.

**Independent Test**: Three reruns/five duplicate events, competing tips, interrupted
ref/tag/draft/assets and newer PRs above unpublished metadata yield one matching
release or a precise conflict. Every real unreleased commit remains accounted for.

### Tests first

- [X] T048 [P] [US4] Add failing adversarial retry tests in `scripts/ci/tests/release-automation.test.mjs` for uncertain ref responses, deterministic C reuse, matching/conflicting duplicate intents, exact historical creator attempts, expired provenance and metadata bodies containing breaking notes.
- [X] T049 [P] [US4] Add failing interruption/race cases in `scripts/ci/tests/release-flow.test.mjs` and `scripts/ci/tests/publish.test.ps1` for three reruns/five duplicates, later failed/cancelled CI attempts, tip changes before each write and matching versus conflicting tag/draft/asset state.
- [X] T050 [P] [US4] Add failing unpublished-reconciliation cases in `scripts/ci/tests/preparation.test.mjs` for a newer merged PR above C, authentic versus forged prior metadata, retained real commits, source-baseline snapshot replacement, published-history preservation and already-reserved-version refusal.

### Implementation

- [X] T051 [US4] Complete only missing retry/continuation logic in `scripts/ci/release-automation.mjs`: reuse deterministic C, read after uncertain writes, validate exact creator-attempt artifacts, deduplicate matching intents and reject stale/conflicting/expired authority without recursively bumping.
- [X] T052 [US4] Implement bounded unpublished entry/snapshot reconciliation in `scripts/ci/release.mjs`, with reservation checks in `scripts/ci/release-automation.mjs`; recompute from last published ancestry and exclude only authenticated generated commits. Make T050 pass without changing published history.
- [X] T053 [US4] Adapt existing partial-publication recovery in `scripts/ci/publish.ps1` only where v2 bindings/new tests require it; retain matching-byte resume, annotated-object checks and refusal to clobber, delete/recreate, repoint or silently skip conflicting versions.
- [X] T054 [US4] Verify and complete short-stage concurrency/revalidation in `.github/workflows/release.yml` and `scripts/ci/release-automation.mjs`: cancel-in-progress false, no lock held while C CI runs, no queue-order assumption, current tip/latest evidence rechecked after serialization.
- [X] T055 [US4] Run the duplicate/interruption/reconciliation corpus and record exact counts, preserved commits and zero-overwrite evidence in `docs/automated-semantic-release-validation.md`; keep failures resumable and visibly distinct from no-release.

**Checkpoint**: US4 extends the guarded US1 flow. T048–T050 form a parallel test batch;
production implementations touch shared release files and run sequentially.

## Phase 7: User Story 5 — Release trust and main promotion (P2)

**Goal**: Untrusted data cannot gain release authority; main retains the published version.

**Independent Test**: Substitute repository/source/run/attempt/artifact/authority data,
inject unsafe report inputs and promote synthetic published metadata to main. All
invalid cases produce zero release writes; main produces no additional release.

### Tests first

- [X] T056 [P] [US5] Add failing negative trust cases in `scripts/ci/tests/security.test.mjs` for substituted/expired/oversized artifacts, unsafe endpoints, forged App/message/intent identity, untrusted report authority claims and candidate execution/cache/dependency paths in write jobs.
- [X] T057 [P] [US5] Add failing v2 published-candidate promotion cases in `scripts/ci/tests/promotion.test.mjs` for exact version/tree/evidence retention on release→main, missing/mismatched publication refusal and zero main-originated version/tag/publication actions.
- [X] T058 [P] [US5] Extend independent publisher boundary tests in `scripts/ci/tests/publisher-scope.test.mjs` and `scripts/ci/tests/publish.test.ps1` to reject manual-v1/schema confusion, forged control environments, wrong workflow_run provenance and every changed candidate/authority/artifact digest.

### Implementation

- [X] T059 [US5] Close negative-test gaps in `scripts/ci/release-automation.mjs` and `scripts/ci/release.mjs` using existing bounded download/API/identity helpers; preserve exact creator provenance and source/final freshness, with no fallback to copied messages or manual authority.
- [X] T060 [US5] Close reporting/permission gaps in `scripts/ci/pr-comment.mjs` and `scripts/ci/gates.mjs`; report content remains data, comment authority stays PR-scoped, and ordinary validation/fork payloads cannot obtain contents-write or App credentials.
- [X] T061 [US5] Update published-candidate promotion handling in `scripts/ci/gates.mjs` and release lookup in `scripts/ci/release.mjs` only as needed for v2 evidence/new headings; preserve the exact published product version/tree and absence of main release orchestration.
- [X] T062 [US5] Run negative authority/report/promotion and independent publisher suites; record zero-write outcomes and preservation of normal interactive branch ownership in `docs/automated-semantic-release-validation.md`.

**Checkpoint**: All stories are locally complete. T056–T058 form a parallel test batch;
do not parallelize overlapping release/gates/publisher implementations across phases.

## Phase 8: Polish and cross-cutting acceptance

**Purpose**: Integrate test accounting, prove hosted boundaries and hand off activation.

- [X] T063 Add failing integration/accounting tests in `scripts/ci/tests/mutation-config.test.mjs`, `scripts/ci/tests/populations.test.mjs` and `scripts/ci/tests/dispatcher.test.ps1` for the new helper suites, syntax coverage and critical automatic authority/report decisions; reject stale removed approval-function selectors or missing test populations.
- [X] T064 Update `scripts/ci/package.json` syntax checks, `scripts/ci/test-populations.json` and `scripts/ci/stryker.config.mjs` to cover new modules and real critical decisions; keep per-mutant selections cheap/pure, retain required boundary tests and existing floors/budgets. Make T063 pass.
- [X] T065 Run locked CI support/syntax/workflow checks, independent PowerShell publisher tests and relevant light/full mutation checks from `specs/004-automated-semantic-release/quickstart.md`; record actual results and the cheap-unit population/justified boundary ratio in `docs/automated-semantic-release-validation.md` without lowering thresholds.
- [X] T066 Reconcile current `docs/versioning.md`, `docs/branching.md`, `docs/automated-semantic-release-plan.md` and `docs/automated-semantic-release-research.md` with implemented behavior and verified limits; link historical feature-003 guidance to the replacement without rewriting old evidence. Check content/links and the complete governance-copy inventory.
- [ ] T067 Record and verify owner-provisioned hosted acceptance prerequisites in `docs/automated-semantic-release-validation.md`: default-main controllers, existing lifecycle refs/PR fixtures, GH_TOKEN or optional scoped App setup, compatible rules/no recurring reviewer and an explicit owner-approved initial version. Do not create/switch branches, expose secrets or configure production; keep this task pending if owner prerequisites are unavailable.
- [ ] T068 After T067, observe the owner-approved eligible-PR→P-gates→intent→authenticated-writer-created-C→fresh-C-gates/package/native→automatic-publication path from `specs/004-automated-semantic-release/quickstart.md`; record real run/attempt/artifact IDs, annotated tag object, binary version, checksums and final report in `docs/automated-semantic-release-validation.md`.
- [ ] T069 After T067, exercise hosted passing/failing/incomplete/fork PR reporting, two heads and three attempts; verify owned-comment recovery/fallback and measure terminal-report numerator/denominator against the 95%-within-five-minutes target. Record service/permission exclusions honestly in `docs/automated-semantic-release-validation.md`.
- [ ] T070 In the same owner-approved hosted acceptance environment, verify matching retries/competing updates, release→main version retention, disabled adoption and credential-revocation behavior; combine hosted observations with the five-duplicate fixture proof from T055 and record limits in `docs/automated-semantic-release-validation.md`.
- [X] T071 Audit all FR/SC acceptance evidence and content/link consistency against the T001 workspace baseline, accounting for reviewed feature edits and approved commits while preserving the current branch and unrelated dirty work; record owner activation steps and reviewed logical commit groups/messages in `docs/automated-semantic-release-validation.md`. Keep production `scripts/ci/release-policy.json` disabled until acceptance and owner activation; no real release or unapproved commit is part of this audit.

**Checkpoint**: Tasks requiring unavailable hosted/owner evidence remain unchecked.
Local passes do not certify GitHub App triggers, native hosted proof or comment delivery.

## Dependencies and execution order

```text
Setup T001–T004 -> Foundation T005–T010
                         |-> US3 T011–T019 -> US1 T020–T034 -> US4 T048–T055
                         |-> US2 T035–T047 -----------------------|
                                            US1 + US2 -> US5 T056–T062
US3 + US1 + US2 + US4 + US5 -> Phase 8 T063–T071 -> owner activation handoff
```

| Increment | Prerequisites | Completion criterion |
| --- | --- | --- |
| US3 / P1 semantics | Setup + foundations | Corpus, pinned snapshots, explicit bootstrap, preserved history |
| US1 / P1 release | Foundations + US3 | Joined fixture publishes one aligned synthetic candidate after its own proof |
| US2 / P1 comments | Foundations | Current owned report/fallback independent of release success |
| US4 / P2 recovery | US3 + US1 | Duplicate/interruption/race/reconciliation corpus converges or refuses conflicts |
| US5 / P2 trust/main | US1 + US2 | Negative trust/authority cases deny writes; main retains version |
| Cross-cutting / hosted | All five stories; T067 before T068–T070 | Actual hosted evidence plus owner activation handoff |

Within a story, its red-test batch precedes implementation. T029/T030 require T028.
T063 precedes T064; T065 follows T064. Hosted checks require T065 and owner setup
T067. T069 can run alongside T068 with separate owner-provisioned PR fixtures;
T070 follows the published synthetic candidate from T068. T071 follows all evidence.
Shared file ownership overrides otherwise independent story schedules.

## Parallel execution examples

These are scheduling examples, not authorization to create branches or spawn agents.

| Story | Ready parallel batch | File isolation / join |
| --- | --- | --- |
| US3 | T011 semantic tests; T012 notes tests; T013 heading tests; T014 bootstrap tests | Four distinct test files after foundations; join before T015 |
| US1 | T020 eligibility; T021 writer; T022 authority/joined flow; T023 workflow tests | Disjoint files after US3; join before T024. T029/T030 also split Node/PowerShell after T028 |
| US2 | T035 renderer; T036 API/state; T037 workflow tests | Three distinct test files after foundations; join before T038 |
| US4 | T048 intent retries; T049 publication faults; T050 unpublished reconciliation | Disjoint tests after US1; join before T051 |
| US5 | T056 security; T057 main promotion; T058 publisher binding | Disjoint tests after US1/US2; join before T059 |

Do not concurrently modify release.mjs across US3/US1/US4/US5 or gates.mjs across
US1/US2/US5. A [P] marker does not waive a prerequisite or the red-before-green rule.

## Requirement coverage

| Specification requirement | Tasks providing behavior and proof |
| --- | --- |
| FR-001 | T020, T024, T032, T057, T061 |
| FR-002 | T020, T024, T028, T049, T059 |
| FR-003 | T002, T003, T022, T029, T030, T032, T067, T068 |
| FR-004 | T011, T014, T015, T018 |
| FR-005 | T011, T012, T015, T016 |
| FR-006 | T011, T014, T018, T027, T048, T051 |
| FR-007 | T007, T008, T014, T018, T067 |
| FR-008 | T013, T021, T025, T026, T050, T052 |
| FR-009 | T006, T012, T013, T016, T017 |
| FR-010 | T022, T028, T032, T068 |
| FR-011 | T022, T030, T034, T058, T068 |
| FR-012 | T020, T021, T028, T049, T054, T059 |
| FR-013 | T021, T048, T049, T051, T053, T055, T070 |
| FR-014 | T027, T032, T048, T050, T051, T052, T054 |
| FR-015 | T057, T061, T062, T070 |
| FR-016 | T035, T036, T039, T043, T044, T069 |
| FR-017 | T035, T038, T040, T047 |
| FR-018 | T036, T041, T044, T047, T069 |
| FR-019 | T035, T036, T042, T043, T047, T069 |
| FR-020 | T009, T010, T023, T037, T045, T056, T058, T059, T060 |
| FR-021 | T004, T006, T011–T019, T066 |
| FR-022 | T002, T003, T066, T067, T071 |
| FR-023 | T001, T008, T025, T027, T030, T042, T055, T062, T071 |

| Success criterion | Acceptance evidence |
| --- | --- |
| SC-001 | T034 fixture flow; T068 actual automatic hosted flow |
| SC-002 | T020–T023, T049, T056, T058, T062 negative zero-write cases |
| SC-003 | T011–T019 corpus/snapshots/history; T050/T052 unpublished preservation |
| SC-004 | T048/T049/T055 three reruns and five duplicates; T070 hosted recovery |
| SC-005 | T035–T047 reporting contract; T069 measured terminal-report timing |
| SC-006 | T036/T041/T042/T047 local ordering/fallback; T069 actual heads/attempts |
| SC-007 | T022/T028 final-C binding; T068 actual native package/version/checksums |
| SC-008 | T013/T017/T050/T052 history; T053 immutable assets; T057/T061/T070 main; T071 workspace |

## Implementation strategy

**MVP**: Setup + foundations + US3 + fixture-backed US1. This demonstrates the primary
automatic release flow with exact version semantics while production remains disabled.
US2 is a separately deliverable reporting increment. Production activation requires
US4, US5 and cross-cutting/hosted acceptance as well; an MVP is not authorization to
skip those guards or claim deployed publication.

Deliver small functional increments, run their independent checks at checkpoints,
and keep commit groups reversible. Prefer cheap pure decisions; retain actual
process/API/native proof for boundaries that unit fixtures cannot establish. Keep
the original quality floors, mutation budgets and branch ownership unchanged.

## Governance completion checks

This generation writes only tasks.md. Implementation must preserve the current
branch and unrelated work, align the authorized automatic-flow exception before
activation, and report evidence limits. Interactive release/tag actions still
require their own authorization; user-owned branch operations remain user-owned.
