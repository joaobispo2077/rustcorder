# Commit grouping plan

Prepared 2026-11-06 for review. These are proposed commits; staging does not
create a commit, branch, tag or remote change. The user authorized branches,
commits and pushes, and explicitly requires approval of these groups first.

The starting branch is `main` at `8b200d21c07d668e2e492c68139970031b923c65`.
After approval, create `feature/ci-quality-release` from that commit, commit
these groups in order, then push the completed branch. Keep the reviewed branch
available for the initial workflow adoption on main before using the release
controller. Installation on main is still a separate adoption step; a feature
branch push alone does not establish required checks or release protections.

The branch permission is a session-specific exception to the standing
user-owned-branch rule. It does not amend project governance. No product release,
version bump, changelog release entry or tag publication is included.

## Ordering and review

Documentation precedes test infrastructure, tests, product behavior and CI
infrastructure. There is one dependency exception: the desktop layout fix
precedes its UI tests because the tests call drawing methods introduced by the
fix. Test-only observation hooks stay with those tests. Other test commits may
be intentionally red until their later implementation commits. Push the complete
sequence together and validate the final tree. There is no standalone refactor
or cleanup scope.

Separate temporary Git indexes and numbered binary patches under the ignored
`.build/commit-groups/` directory retain each proposed delta. The ordinary
index holds the final tree. The original index and staged/unstaged patches are
backed up there. Each numbered snapshot is cumulative; its review patch compares
it with the preceding snapshot. No commit object is needed to prepare this review.

After the approved commits, resume T080 (the final local release-flow integration
fixture) before hosted acceptance and adoption tasks T081–T087. The local fixture
is not blocked by missing remote branches. New work will receive its own logical
groups and approval before further commits.

## Proposed sequence

| Order | Proposed Conventional Commit | Reason |
| --- | --- | --- |
| 01 | `docs(ui): document corrected desktop layout` | Keep the existing desktop layout guidance together. |
| 02 | `docs(speech): plan speaker and transcript insights` | Preserve the separate transcription and speaker feature plan without adding its product behavior. |
| 03 | `docs(ci): specify quality and release controls` | Keep the CI requirements, design decisions, evidence contracts and implementation checklist together. |
| 04 | `docs(ci): document operation and adoption` | Explain local reproduction, measured limits, remote adoption and the proposed commit sequence. |
| 05 | `build(test): add egui interaction harness` | Keep the Rust test dependency and its resolved lockfile together. |
| 06 | `build(test): expose package helpers to tests` | Allow the package script to be loaded by tests without running package assembly. |
| 07 | `build(ci): pin reproducible quality tools` | Bind CI tool versions, the dependency lock, install policy, source bytes and generated-output ignores. |
| 08 | `test(settings): cover unreadable directory input` | Add the focused settings error-path regression independently of CI configuration. |
| 09 | `test(cli): cover version and worker dispatch` | Prove executable identity and preserve worker dispatch behavior before the version change. |
| 10 | `test(ci): enforce quality evidence contracts` | Cover context, measurements, dependency policy, test populations, receipt validation and architecture-rule fixtures. |
| 11 | `test(ci): verify workflow safety and reproduction` | Cover tool setup, dispatch, analyzer boundaries, workflow permissions and documented reproduction. |
| 12 | `test(report): cover bounded quality summaries` | Verify readable reports, retained evidence and output limits independently of their implementation. |
| 13 | `test(release): cover approval and package retries` | Exercise semantic decisions, preparation, exact approval, package integrity, native adapters and safe publication retries with isolated fixtures. |
| 14 | `test(mutation): reject incomplete outcomes` | Keep mutation inventory, outcome and profile regression coverage separate from the adapters. |
| 15 | `fix(ui): restore sidebar and workspace layout` | Keep the existing desktop layout behavior and window geometry together, excluding every added test and test hook. |
| 16 | `test(ui): cover layout states and input` | Add rendering and interaction tests plus test-only observation hooks after the drawing methods they require. |
| 17 | `feat(cli): report built application version` | Add the narrow executable version response without mixing in packaging or workflow changes. |
| 18 | `feat(package): bind bundles to build provenance` | Attach verified executable version, source identity and inventory to portable packages. |
| 19 | `ci(policy): define Rust quality thresholds` | Keep measured quality floors, source boundaries, dependency rules and test populations together. |
| 20 | `ci(mutation): normalize fresh mutation outcomes` | Add the shared data-only adapter for complete Rust and Node mutation inventories. |
| 21 | `ci(quality): collect and enforce Rust evidence` | Keep the evidence collector, Windows gate dispatcher and pinned-tool setup in one runnable quality lane. |
| 22 | `ci(report): render bounded quality scorecards` | Add the readable quality report as its own CI responsibility. |
| 23 | `ci(package): verify packaged native windows` | Keep package archive checks and native desktop smoke evidence together. |
| 24 | `ci(release): prepare approved release candidates` | Add semantic proposals, confirmed preparation and exact candidate authorization independently of publication. |
| 25 | `ci(release): publish verified annotated releases` | Keep privileged annotated-tag and release publication, retry checks and asset verification isolated. |
| 26 | `ci(mutation): run bounded light and full profiles` | Keep the mutation runner, selected function ranges and Rust/Node profile configurations together. |
| 27 | `ci(workflows): wire quality and release pipelines` | Connect the completed adapters last, keeping hosted orchestration separate from executable product behavior. |

## File responsibility

Repeated paths are intentional partial snapshots: desktop documentation and
window geometry retain the pre-existing staged changes; UI production changes
exclude added tests; package test loading is separated from provenance behavior.

## 01: docs(ui): document corrected desktop layout

Keep the existing desktop layout guidance together.

- `README.md`
- `docs/development.md` (partial snapshot)
- `docs/implementation-validation.md`
- `docs/ui-layout-correction.md`

## 02: docs(speech): plan speaker and transcript insights

Preserve the separate transcription and speaker feature plan without adding its product behavior.

- `docs/transcription-speaker-plan.md`
- `docs/transcription-speaker-research.md`
- `specs/002-transcription-speaker-insights/checklists/requirements.md`
- `specs/002-transcription-speaker-insights/contracts/desktop-and-analysis.md`
- `specs/002-transcription-speaker-insights/contracts/evaluation.md`
- `specs/002-transcription-speaker-insights/data-model.md`
- `specs/002-transcription-speaker-insights/plan.md`
- `specs/002-transcription-speaker-insights/quickstart.md`
- `specs/002-transcription-speaker-insights/research.md`
- `specs/002-transcription-speaker-insights/spec.md`
- `specs/002-transcription-speaker-insights/tasks.md`

## 03: docs(ci): specify quality and release controls

Keep the CI requirements, design decisions, evidence contracts and implementation checklist together.

- `.specify/feature.json`
- `docs/ci-quality-release-plan.md`
- `docs/ci-quality-release-reference.md`
- `specs/003-ci-quality-release/checklists/requirements.md`
- `specs/003-ci-quality-release/contracts/ci-evidence.md`
- `specs/003-ci-quality-release/contracts/release.md`
- `specs/003-ci-quality-release/data-model.md`
- `specs/003-ci-quality-release/plan.md`
- `specs/003-ci-quality-release/quickstart.md`
- `specs/003-ci-quality-release/research.md`
- `specs/003-ci-quality-release/spec.md`
- `specs/003-ci-quality-release/tasks.md`

## 04: docs(ci): document operation and adoption

Explain local reproduction, measured limits, remote adoption and the proposed commit sequence.

- `docs/branching.md`
- `docs/development.md`
- `docs/versioning.md`
- `docs/ci-quality-release-validation.md`
- `docs/commit-grouping-plan.md`

## 05: build(test): add egui interaction harness

Keep the Rust test dependency and its resolved lockfile together.

- `Cargo.toml`
- `Cargo.lock`

## 06: build(test): expose package helpers to tests

Allow the package script to be loaded by tests without running package assembly.

- `scripts/package.ps1` (partial snapshot)

## 07: build(ci): pin reproducible quality tools

Bind CI tool versions, the dependency lock, install policy, source bytes and generated-output ignores.

- `.gitignore`
- `.gitattributes`
- `scripts/ci/.npmrc`
- `scripts/ci/package.json`
- `scripts/ci/package-lock.json`
- `scripts/ci/toolchain.json`

## 08: test(settings): cover unreadable directory input

Add the focused settings error-path regression independently of CI configuration.

- `src/settings.rs`

## 09: test(cli): cover version and worker dispatch

Prove executable identity and preserve worker dispatch behavior before the version change.

- `tests/integration.rs`
- `tests/integration/binary_identity.rs`

## 10: test(ci): enforce quality evidence contracts

Cover context, measurements, dependency policy, test populations, receipt validation and architecture-rule fixtures.

- `scripts/ci/tests/context.test.mjs`
- `scripts/ci/tests/contracts.test.mjs`
- `scripts/ci/tests/dependencies.test.mjs`
- `scripts/ci/tests/measurements.test.mjs`
- `scripts/ci/tests/collector.test.mjs`
- `scripts/ci/tests/populations.test.mjs`
- `scripts/ci/tests/fixtures/context.json`
- `scripts/ci/tests/fixtures/receipts.json`
- `scripts/ci/rule-tests/__snapshots__/native-gui-boundary-snapshot.yml`
- `scripts/ci/rule-tests/__snapshots__/ui-native-boundary-snapshot.yml`
- `scripts/ci/rule-tests/boundaries-test.yml`
- `scripts/ci/rule-tests/native-gui-test.yml`

## 11: test(ci): verify workflow safety and reproduction

Cover tool setup, dispatch, analyzer boundaries, workflow permissions and documented reproduction.

- `scripts/ci/tests/analyzers.test.ps1`
- `scripts/ci/tests/dispatcher.test.ps1`
- `scripts/ci/tests/setup-windows.test.ps1`
- `scripts/ci/tests/setup.test.mjs`
- `scripts/ci/tests/reproduction.test.mjs`
- `scripts/ci/tests/security.test.mjs`
- `scripts/ci/tests/workflows.test.mjs`

## 12: test(report): cover bounded quality summaries

Verify readable reports, retained evidence and output limits independently of their implementation.

- `scripts/ci/tests/report.test.mjs`

## 13: test(release): cover approval and package retries

Exercise semantic decisions, preparation, exact approval, package integrity, native adapters and safe publication retries with isolated fixtures.

- `scripts/ci/tests/authorization.test.mjs`
- `scripts/ci/tests/preparation.test.mjs`
- `scripts/ci/tests/preview-workflow.test.mjs`
- `scripts/ci/tests/promotion.test.mjs`
- `scripts/ci/tests/proposal.test.mjs`
- `scripts/ci/tests/release-decisions.test.mjs`
- `scripts/ci/tests/semantic.test.mjs`
- `scripts/ci/tests/git-fixture.mjs`
- `scripts/ci/tests/package-archive.test.ps1`
- `scripts/ci/tests/package.test.ps1`
- `scripts/ci/tests/publish.test.ps1`
- `scripts/ci/tests/ui-smoke.test.ps1`

## 14: test(mutation): reject incomplete outcomes

Keep mutation inventory, outcome and profile regression coverage separate from the adapters.

- `scripts/ci/tests/mutation.test.mjs`
- `scripts/ci/tests/mutation-config.test.mjs`
- `scripts/ci/tests/mutation-rust-config.test.mjs`

## 15: fix(ui): restore sidebar and workspace layout

Keep the existing desktop layout behavior and window geometry together, excluding every added test and test hook.

- `src/ui.rs` (partial snapshot)
- `src/main.rs` (partial snapshot)

## 16: test(ui): cover layout states and input

Add rendering and interaction tests plus test-only observation hooks after the drawing methods they require.

- `src/ui.rs`

## 17: feat(cli): report built application version

Add the narrow executable version response without mixing in packaging or workflow changes.

- `src/main.rs`

## 18: feat(package): bind bundles to build provenance

Attach verified executable version, source identity and inventory to portable packages.

- `scripts/package.ps1`

## 19: ci(policy): define Rust quality thresholds

Keep measured quality floors, source boundaries, dependency rules and test populations together.

- `scripts/ci/policy.json`
- `scripts/ci/deny.toml`
- `scripts/ci/jscpd.json`
- `scripts/ci/sgconfig.yml`
- `scripts/ci/test-populations.json`
- `scripts/ci/rules/boundaries.yml`
- `scripts/ci/rules/native-gui.yml`

## 20: ci(mutation): normalize fresh mutation outcomes

Add the shared data-only adapter for complete Rust and Node mutation inventories.

- `scripts/ci/mutation.mjs`

## 21: ci(quality): collect and enforce Rust evidence

Keep the evidence collector, Windows gate dispatcher and pinned-tool setup in one runnable quality lane.

- `scripts/ci/gates.mjs`
- `scripts/ci/ci.ps1`
- `scripts/ci/setup-windows.ps1`

## 22: ci(report): render bounded quality scorecards

Add the readable quality report as its own CI responsibility.

- `scripts/ci/report.mjs`

## 23: ci(package): verify packaged native windows

Keep package archive checks and native desktop smoke evidence together.

- `scripts/ci/package.ps1`
- `scripts/ci/ui-smoke.ps1`

## 24: ci(release): prepare approved release candidates

Add semantic proposals, confirmed preparation and exact candidate authorization independently of publication.

- `scripts/ci/release.mjs`

## 25: ci(release): publish verified annotated releases

Keep privileged annotated-tag and release publication, retry checks and asset verification isolated.

- `scripts/ci/publish.ps1`

## 26: ci(mutation): run bounded light and full profiles

Keep the mutation runner, selected function ranges and Rust/Node profile configurations together.

- `scripts/ci/run-mutation.mjs`
- `scripts/ci/stryker.config.mjs`
- `scripts/ci/mutants-light.toml`
- `scripts/ci/mutants-full.toml`

## 27: ci(workflows): wire quality and release pipelines

Connect the completed adapters last, keeping hosted orchestration separate from executable product behavior.

- `.github/workflows/ci.yml`
- `.github/workflows/mutation-full.yml`
- `.github/workflows/release.yml`

## Approved execution: 2026-11-06

The user approved the sequence above. All 27 commits were created in that order
on `feature/ci-quality-release` and pushed, ending at
`aa8d19c47405bb67529602b653b7668e2eb4d9a0`. The final tree is
`998b94b52f307b380f5c5f60448924027b19ebd0`, exactly matching the reviewed staged
tree. Main and all product tags were preserved. The user-authorized develop and
release branches were subsequently created at the original main baseline to
establish the requested promotion path. First hosted results and T080 evidence
are recorded in [validation](ci-quality-release-validation.md).

## Follow-up groups awaiting approval

The next task, T080, added the joined release-flow fixture and exposed a
fresh-process publication-receipt ordering bug. The following four groups keep
documentation, fixture infrastructure, acceptance tests and the one-line
implementation fix separate. They are proposed for the existing feature branch.

| Order | Proposed Conventional Commit | Responsibility and files |
| --- | --- | --- |
| 28 | `docs(ci): record joined release-flow acceptance` | Verification/adoption evidence: docs/ci-quality-release-validation.md, docs/commit-grouping-plan.md, specs/003-ci-quality-release/tasks.md |
| 29 | `build(test): add isolated release-flow backend` | Synthetic package and network-free publisher backend: scripts/ci/tests/release-flow.fixture.ps1 |
| 30 | `test(release): join candidate and retry acceptance` | Real-adapter acceptance and cross-process retry regression: scripts/ci/tests/release-flow.test.mjs |
| 31 | `fix(release): stabilize publication receipt order` | Deterministic asset field order: scripts/ci/publish.ps1 |

Each follow-up has a separate cumulative index and review patch under the ignored
`.build/commit-groups-followup/` directory. No follow-up commit or push is approved
by the previous 27-group approval. Test and fixture commits precede the fix, so
the regression is intentionally red until the final group; push the complete
reviewed sequence together. No release entry or tag execution is proposed.
