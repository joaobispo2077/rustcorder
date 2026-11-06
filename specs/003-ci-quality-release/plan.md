# Implementation Plan: CI Quality Gates and Controlled Semantic Releases

**Branch**: `main` | **Date**: 2026-11-05 | **Spec**: [spec.md](spec.md)

**Input**: `specs/003-ci-quality-release/spec.md`

## Summary

Build three GitHub workflows around the existing Windows/MSVC application:
ordinary validation, weekly/manual full mutation, and controlled release.
Reuse `scripts/dev.ps1`, `scripts/package.ps1` and the private UI test fixtures.
Keep CI support in `scripts/ci/`; introduce no application workspace or service.

Use official semantic-release commit analysis and release-notes hooks for version
calculation. Do not invoke its publishing core, which creates lightweight tags.
CI prepares a version/changelog patch after completion confirmation; the user
commits it on the existing `release` branch. Validate that final commit, then use
an explicit protected-environment approval to authorize annotated tagging,
draft assembly and publication. Promotion to `main` retains that version.

This completes design, not executable implementation. The readable explanation
is [under docs/](../../docs/ci-quality-release-plan.md); primary-source decisions
are in [research.md](research.md).

## Technical Context

**Language/Version**: Existing Rust 2024, pinned
`1.95.0-x86_64-pc-windows-msvc`; PowerShell for Windows setup/process/packaging;
Node `24.22.2` for CI-only policy, reporting, tests and version analysis.

**Primary Dependencies**: Existing eframe `0.37.0`; dev-only egui_kittest
`=0.37.0`. CI tools: actionlint `1.7.12`, cargo-llvm-cov `0.9.1`, cargo-mutants `27.1.0`,
cargo-deny `0.20.2`, rust-code-analysis CLI `0.0.25`, jscpd `5.4.2`,
ast-grep CLI `0.51.1`, Stryker `10.1.1`. Semantic analyzer `13.0.1`, notes
generator `14.1.0`, Conventional Commits preset `9.1.0`, semver `7.7.3`;
semantic-release `25.0.8` satisfies their peer dependency but is never invoked.

**Storage**: Checked-in policy, exact tool pins and test selections; ephemeral
JSON/log/package artifacts retained 14 days; published evidence retained as
release attachments. No database or runtime network dependency.

**Testing**: Existing Cargo/libtest suites, egui drawing/accessibility input tests,
Node built-in test runner, ast-grep rule fixtures, Rust and Node mutation engines,
and one native packaged-app smoke. Stable libtest output is normalized against a
listed test inventory; compiler JSON is not test execution evidence.

**Target Platform**: Windows x64 MSVC for all product gates and package smoke;
Ubuntu 24.04 for Node policy tests/mutation, reporting and read-only previews.
Start native smoke on `windows-2025` with mandatory capability preflight.
Hosted Windows Server smoke does not certify Windows 11 device acceptance.

**Project Type**: Existing local desktop application plus repository CI support.

**Performance Goals**: Three warm-cache ordinary runs at most 45 minutes each.
Each light mutation engine has a 20-minute job limit; full engines 60 minutes.
These remain acceptance measurements, not demonstrated timings.

**Constraints**: Preserve current branch and dirty work, offline product runtime,
models/private audio boundaries, existing tests and approved UI behavior.
No bot branch creation, branch switching, automatic merging or version-commit
pushes. Tag/publication credentials are confined to the explicitly approved job.

**Scale/Scope**: One Cargo package, two desktop screens, three promotion pairs,
three workflows, one evidence schema and two mutation profiles per engine.
Initial remote inspection found only `main`, no tags, no environments/rulesets
and no classic protection on main. Workflow token defaults are already read-only.

## Constitution Check

Pre-research review passed. Phase 1 review also passes with no requested amendment.

| Principle | Pre-research | Post-design evidence |
| --- | --- | --- |
| User-owned branches / bounded changes | Pass | Work stays on `main`; prepared patch is user-committed; automation writes no branch refs |
| Test first / unit-first proof | Pass | Failure fixtures precede helpers/workflows; real boundary and native-window proof is reserved for what pure tests cannot establish |
| Simplicity / explicit boundaries | Pass | Existing application modules and scripts retained; functions and declarative rules, no pattern framework |
| Controlled versions / releases | Pass | Completion confirmation precedes metadata patch; final-SHA approval precedes annotated tag and publication |
| Durable docs / honest evidence | Pass | Explanation under docs/, generated designs under specs/; no claimed CI or device pass |

New policy/accounting/version functions should achieve at least 90% cheap
pure-unit tests where feasible. Count actual execution populations, not library
file placement. Retain necessary process/filesystem/UI integration; document the
ratio and justification rather than adding padding tests.

Architecture and pattern selection skills were consulted: recommendation is no
application architecture change. The only new boundary is CI-only tooling. Small
normalizers isolate analyzer/GitHub formats from pure gate decisions; no generic
plugin registry or custom dependency framework is justified.

## Project Structure

### Documentation (this feature)

```text
specs/003-ci-quality-release/
  spec.md
  plan.md
  research.md
  data-model.md
  quickstart.md
  contracts/
    ci-evidence.md
    release.md
  checklists/requirements.md
docs/
  ci-quality-release-reference.md
  ci-quality-release-plan.md
```

`tasks.md` belongs to the next `/speckit-tasks` phase and is not generated here.

### Source Code (planned implementation)

```text
.github/workflows/
  ci.yml
  mutation-full.yml
  release.yml
scripts/ci/
  ci.ps1
  setup-windows.ps1
  ui-smoke.ps1
  publish.ps1
  gates.mjs
  release.mjs
  report.mjs
  package.json
  package-lock.json
  policy.json
  toolchain.json
  test-populations.json
  mutants-light.toml
  mutants-full.toml
  stryker.config.mjs
  sgconfig.yml
  rules/
  tests/
src/
  main.rs                 # bounded --version behavior
  ui.rs                   # existing fixtures plus dev-only accessibility tests
scripts/dev.ps1           # reuse supported command forwarding
scripts/package.ps1       # preserve guards; add version/source metadata
Cargo.toml                # one matching UI dev dependency
Cargo.lock
.gitignore                # CI reports, npm tools and mutation output
docs/development.md
docs/versioning.md
docs/branching.md
```

**Structure Decision**: Keep the one-package application intact. `ci.ps1` is a
small fixed gate dispatcher; `gates.mjs` owns pure policy/evidence normalization,
`release.mjs` owns proposal/preparation, and `report.mjs` renders existing data.
`publish.ps1` is a narrow privileged adapter, not a branch manager. Avoid creating
one script per analyzer when a fixed command and shared receipt capture suffice.

## Validation workflow

| Job/check name | Runner / limit | Responsibility |
| --- | --- | --- |
| CI policy | Ubuntu 24.04 / 10m | Workflow lint, promotion and commit policy, schema/config checks, nonzero Node unit population |
| Rust and quality | Windows 2025 / 35m | Setup, fmt, Clippy, build, unit/UI/integration, coverage, maintainability, dependency policy, package self-check |
| Mutation Rust light | Windows 2025 / 20m | Declared critical Rust mutations after successful native baseline |
| Mutation CI light | Ubuntu 24.04 / 20m | Declared pure gate/release helper mutations after Node baseline |
| Package smoke | Windows 2025 / 20m | Release-push only: versioned portable ZIP, native startup/navigation/close, checksums |
| Quality report | Ubuntu 24.04 / 5m | After gate jobs, always summarize available evidence; preserve original failures |
| CI readiness | Ubuntu 24.04 / 5m | After reporting, require every applicable job and valid report/receipts to succeed |

Triggers match the requested reference: feature pushes, PRs to develop/release/main,
and every release push. No path filters suppress required checks. PRs validate
the merge result and record head/base separately; release certification requires
a push run at the actual final commit. Duplicate suppression is deferred.

Run Node light mutation in parallel with product work. Rust light starts after
the native baseline and restores compatible build caches, never outcome caches.
Use unique release-push concurrency groups to retain each candidate run. Older
feature/PR runs may be cancelled, remaining visibly incomplete.

A fixed event matrix determines required jobs before execution. Package smoke is
not required for ordinary PRs; it is mandatory for release-push certification.
Branch rules require the stable checks CI policy, Rust and quality, both light
mutation jobs and CI readiness. Do not mark a skipped required job successful.
The report precedes final readiness, avoiding a green aggregate when unified
evidence could not be built. A report can successfully describe failed gates;
the readiness decision still fails those gates. There is no dependency cycle.

## Gate implementation decisions

- Validate workflows with pinned actionlint, Node helpers with `node --check`
  plus their tests, and PowerShell helpers with the built-in parser plus focused
  boundary fixtures. No new general-purpose linter framework is needed.
- Provision the existing Rust target/components and MSVC environment through the
  existing runner. Extract the reviewed libclang 18.1.1 wheel into `.build/`;
  no Python installation/runtime is needed. Record runner image, compiler, CMake
  and Git versions alongside exact analyzer/tool identities.
- Use `fmt --all -- --check`, locked all-target Clippy with denied warnings, and
  listed/nonempty library and integration test populations. UI is already a
  library module. Add binary version/startup checks without changing worker dispatch.
- Run LLVM coverage over normal targets, including UI, binary and integration.
  Name this mixed ordinary-test population honestly. Record numerator/denominator
  and explicit source inventory; freeze the first verified positive floor only
  after reviewing the measured baseline. Never substitute Avo's historical 68%.
- Use RCA per-function cyclomatic values, fixed handwritten `src` scope including
  embedded tests, exact symbol exceptions, parser-error preflight and calibration
  fixtures. Use compiler warnings for unused code; explicitly document public-API
  reachability limits. Source/test scope is fixed rather than silently filtered.
- Use jscpd's Rust tokenizer with 5-line/50-token minimum, 2% ceiling and nonempty
  inventory; ast-grep syntax rules enforce the existing module boundaries.
  Test aliases, grouped paths and comments, and acknowledge that this is not a
  whole-program resolved dependency graph.
- Use cargo-deny for advisory, source and reviewed dependency-license policy.
  Inventory duplicate versions as advisory. Audit the CI npm lock too: unwaived
  advisories block. Scan errors fail; lockfiles are never automatically upgraded.
- Normalize both mutation engines independently under the same accounting rules.
  Rust Caught/Missed and Node Killed/Survived provide detected/survived counts.
  Non-compiling mutations are separate. Timeouts and missing outcomes fail as
  incomplete even where an engine's built-in score treats them as detections.
- UI matrix is two screens, six state families, three logical sizes and two
  scales, plus distinct stopping/saving variants. Reuse existing geometry tests
  and add dev-only egui_kittest input/AccessKit checks with bounded frame steps.
- Fetch the small VAD only from pinned provenance and verify its hash/license.
  Reuse package assembly and direct-import checks; create a versioned outer ZIP
  around a safe inner folder name, since the existing name guard rejects dots.
  Native smoke uses isolated child settings, PID-bound UI Automation and clean
  close. It never records audio or loads ASR weights.
- Keep artifact/report writes separate from gate truth. Logs, raw measurements,
  normalized receipts and job summaries remain useful after failures; missing
  values stay absent. Images and PR comments are not required in the initial slice.

## Controlled release design

1. Successful actual release-push CI may trigger read-only preview in `release.yml`.
   Validate repository/workflow/event/commit/run/attempt before proposing a version.
2. After the user confirms completion, manual prepare generates a patch and
   preparation manifest in an isolated checkout. It changes only root version
   tokens and a dated high-level changelog entry. No branch push occurs.
   Use an isolated source export/temporary index; no branch operation is needed.
3. The user applies, commits and pushes the prepared tree on existing `release`.
   Require a single parent equal to the prepared source and the exact expected
   tree. Ordinary CI tests that final commit, builds the versioned package and
   performs native smoke.
4. Manual publish identifies the final SHA/version, preparation artifact and
   exact final CI run/attempt/artifact digest. A read-only preflight freezes
   that binding and displays it before `release-publish` environment approval.
5. The privileged job runs trusted default-branch publisher code, rechecks all
   binding fields after approval and treats candidate artifacts only as data.
   Serialize publication with cancellation disabled. Create the annotated tag,
   stage the draft against that existing tag, attach/verify tested bytes and
   evidence, then publish. Conflicts fail; retries preserve existing state.
6. The user promotes release to main and synchronizes metadata to ongoing
   development through normal feature work targeting develop. Preserve released
   ancestry as well as version text; no reverse-promotion exception is added.
   CI validates main promotion without creating another version.

The public repository supports required-reviewer environments in the documented
GitHub plans, but none exists yet. Configure owner/release-reviewer approval,
disable administrator bypass where available, and restrict workflow execution
to trusted main control code. Self-review may be allowed for a solo owner:
an explicit owner approval remains mandatory.

## Delivery sequence and verification

1. **Foundation**: test-first policy/config/receipt parsers, exact tool pins,
   workflow fixtures and nonzero population checks; establish cold-cache setup.
2. **Quality gates**: integrate existing Rust checks, measure real coverage and
   debt, review narrow exceptions, add compiler/complexity/duplication/dependency/
   boundary checks and truthful reporting.
3. **UI and mutation**: seed the Cancel/navigation regressions first; complete the
   matrix, both mutation profiles and engine accounting. Prove 20/60-minute budgets.
4. **Package evidence**: add bounded version reporting/package metadata and native
   smoke; verify clean child settings, invalid asset/hash cases and archive integrity.
5. **Release**: fixture-test semantic precedence/bootstrap, exact-tree preparation,
   stale approvals/reruns/concurrency and retry state. Use temporary Git repos and
   mocked GitHub responses; no real release is required to test the publisher.
6. **Hosted adoption**: user establishes branches/promotions, required checks and
   the approval environment; verify enforcement and three warm runs. Keep
   publication disabled until baseline, native capability and authorization tests pass.

Every executable slice first demonstrates a failing relevant test. This plan
does not claim those tests have run. Full mutation runs weekly at Monday 06:00
UTC (03:00 America/Sao_Paulo) and on request, with separate engine results.

## Requirement coverage and readiness

| Requirements | Owning design |
| --- | --- |
| FR-001–FR-005 | CI policy, supported Windows setup, existing tests and execution inventory |
| FR-006–FR-011 | Native quality gates, exact scopes/ratchets and reviewed exceptions |
| FR-012–FR-013 | UI matrix, package adapter and native smoke |
| FR-014–FR-018 | Both mutation engines, readiness, receipts and reports |
| FR-019–FR-026 | Semantic hook analysis, preparation manifest and approved publisher |
| FR-027–FR-029 | Trusted control code, least privilege, documentation and timed adoption |

Phase 0 decisions are resolved; Phase 1 contracts and validation guide are
complete. Installation, baseline measurements, analyzer checksums where upstream
does not publish one, Windows desktop capability and hosted timings are explicit
implementation acceptance work. There are no unresolved product questions.

## Planning validation evidence

Content/link checks cover all seven generated documents, required template
sections, balanced code fences, unique feature context and unresolved markers.
All 21 relative links resolve. The 51 pre-existing Markdown/source/manifest/pointer
files captured before planning retain their content hashes. Current branch is
main; no extension file exists, so before/after-plan hooks are skipped.
No executable source, release record or remote setting changed in this phase.
