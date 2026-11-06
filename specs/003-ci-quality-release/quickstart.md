# Validation guide: CI quality and releases

**Status**: Design guide. Existing commands below can be run now; proposed CI
entry points become runnable during implementation. No step here authorizes a
real version/changelog entry, tag or publication.

Contracts: [gate/evidence behavior](contracts/ci-evidence.md),
[release stages](contracts/release.md), [data model](data-model.md).

## Prerequisites

Use the existing branch and a cleanly understood working tree. Windows x64 needs
the pinned Rust toolchain, MSVC C++ tools/SDK, CMake and compatible libclang as
described in [development](../../docs/development.md).
Ordinary tests do not need microphones, ASR weights or private recordings.

For future CI helpers, provision pinned Node 24.22.2 and the exact locked tools.
Initial dependency acquisition needs network access; product runtime does not.
Native smoke needs a usable interactive desktop and UI Automation, verified
rather than assumed.

## Existing checks available now

Run from the repository root using the existing MSVC environment runner:

```powershell
rtk git status --short --branch
rtk proxy powershell -NoProfile -File scripts/dev.ps1 fmt --all -- --check
rtk proxy powershell -NoProfile -File scripts/dev.ps1 clippy --locked --offline --all-targets -- -D warnings
rtk proxy powershell -NoProfile -File scripts/dev.ps1 test --locked --offline --lib
rtk proxy powershell -NoProfile -File scripts/dev.ps1 test --locked --offline --test integration
rtk proxy powershell -NoProfile -File scripts/dev.ps1 test --locked --offline --lib ui::tests
rtk proxy powershell -NoProfile -File scripts/package.ps1 -SelfCheck
```

Expected: formatter/analyzer accept unchanged behavior, selected tests execute
and package path/asset guards pass. Missing cache/tool prerequisites fail;
ignored external tests remain ignored and visible, not counted as passes.
These commands were not executed by this planning task.

## Proposed helper checks after implementation

```powershell
rtk proxy npm.cmd ci --prefix scripts/ci
rtk proxy npm.cmd test --prefix scripts/ci
rtk proxy powershell -NoProfile -File scripts/ci/ci.ps1 -Gate prerequisites
rtk proxy powershell -NoProfile -File scripts/ci/ci.ps1 -Gate quality
rtk proxy powershell -NoProfile -File scripts/ci/ci.ps1 -Gate integration
rtk proxy powershell -NoProfile -File scripts/ci/ci.ps1 -Gate ui
rtk proxy powershell -NoProfile -File scripts/ci/ci.ps1 -Gate mutation-rust -Profile light
rtk proxy powershell -NoProfile -File scripts/ci/ci.ps1 -Gate mutation-ci -Profile light
```

The wrapper derives repository paths and writes ignored local evidence. Expected:
nonempty Node/Rust baselines, strict policy/config validation, unrounded
measurement decisions, distinct mutation engine receipts and readable reports.
Local receipts cannot certify a hosted release.

Before implementing helper logic, add focused failing tests for its contract.
The final helper suite must use temporary Git repositories and mocked API data;
publishing adapters are never tested against the real remote.

## Acceptance demonstrations

| Scenario | Action in isolated tests / disposable CI | Expected evidence |
| --- | --- | --- |
| Promotion | Supply each permitted pair and an invalid feature-to-main pair | Correct readiness; invalid pair fails |
| Gate failure | Inject one controlled failure per required gate family | Named failure and failed readiness |
| Test inventory | Remove all selected tests or truncate output | Incomplete, never successful zero |
| Coverage | Use fixture counts just below floor but rounding to it | Failure using raw ratio |
| Maintainability | Exceed ceiling, remove stale exception, inject duplicate block | Correct violation and scope identity |
| Dependency scan | Supply advisory, malformed output and unavailable service | Policy failure or incomplete; no fake clean audit |
| UI | Remove Cancel during stopping/saving; break tab navigation | Initial failing actual-interface test, then restored pass |
| Matrix | Two screens, seven states, three sizes, two scales | Accessible actions, valid geometry and bounded frames |
| Mutation | Supply survivors, nonviable, timeout and omitted outcomes | Per-engine floors; timeout/omission incomplete |
| Package | Corrupt VAD/hash or archive inventory | Integrity failure before native launch/publication |
| Native smoke | Missing desktop, wrong PID, missing tab or close timeout | Failed prerequisite/assertion, retained diagnostics |
| Semantic version | Fix/feat/breaking/docs(release)/ordinary docs/bootstrap histories | Correct proposal, no actual release writes |
| Metadata | LF/CRLF, ambiguous version, graph drift, existing entry | Byte-preserving bounded patch or explicit rejection |
| Certification | Substitute another SHA/run attempt/artifact | Publication refused before tag write |
| Authorization | Omit approval or move tip after approval | Candidate invalidated |
| Recovery | Fail after tag/draft/upload, then retry | Reconcile identical state; refuse conflicting bytes |
| Main promotion | Promote published release candidate | Same version; zero new release |

## Native package lane

Implementation first fetches/verifies the VAD using
[pinned metadata](../../assets/silero-vad.json), then reuses package assembly.
The adapter creates the ZIP/checksums and invokes `ui-smoke.ps1` with exact
executable/hash/version and a private evidence directory.

Expected: actual window, both screens and clean close, with PID-bound tree/
bounds/screenshot. No recording, ASR load or real file-dialog flow is required.
The app gets only a child-specific temporary settings root; parallel tests do
not change global user environment variables.

Failing hosted Windows capability remains a failure. Establish a disposable
trusted interactive release runner if needed; do not move fork PR execution to
a persistent personal machine. Neither path claims physical-device acceptance.

## Hosted adoption and release rehearsal

Local implementation now passes the quality/policy suites, real Release-package
native smoke, publisher failure/retry fixtures and both engines' light/full
mutation profiles. See [actual measurements and limits](../../docs/ci-quality-release-validation.md).
Hosted acceptance below remains pending: remote inspection found only main,
without protection or a release-publish environment. The owner must establish the
documented prerequisites before the real workflows can be exercised. Agents have
not created branches, committed/pushed, tagged or published.

1. The user establishes develop/release and permitted promotions. Workflow files
   must exist on main for dispatch/workflow-run control execution.
2. Run cold-cache ordinary CI, establish the reviewed positive coverage floor
   and exact debt policy, then demonstrate each injected failure blocks readiness.
3. Configure/verify stable required checks on develop/release/main and the
   release-publish approval environment. Do not merely document settings.
4. Record three complete warm-cache runs within 45 minutes and each mutation
   engine's 20/60-minute budget.
5. Exercise preview, preparation and publisher state transitions against fixture
   repositories/API responses. Preview and no-release outcomes must make no
   actual release-record changes.
6. Only after completion confirmation may a real preparation run produce its
   version/changelog patch. The user commits the exact tree; final CI proves it.
7. A real publication remains a separate explicit authorization for the final
   SHA/version/evidence. This guide deliberately supplies no real tag/publish
   command or current release version recommendation.

Review [the release contract](contracts/release.md) for bootstrap, attempt
freshness and recovery before any separately authorized publication.
