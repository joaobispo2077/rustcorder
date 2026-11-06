# CI quality and release implementation evidence

Implementation began on 2026-11-05 on `main`. Existing staged UI/layout changes
and the independent transcription/speaker design are preserved. This document
records executed checks and limits; it is not release authorization.

## Starting baseline

- Pinned Windows/MSVC default suite: 96 library tests and 62 integration tests
  passed; five explicit model/device tests remained ignored. Binary/doc harnesses
  contain zero tests and are not counted as a tested population.
- Formatting and all-target locked/offline Clippy passed.
- Local tools initially report Node 24.19.0 and npm 11.17.0. Hosted CI will enforce
  the reviewed Node 24.22.2 contract; local tool identity is recorded honestly.
- Application version remains 0.1.0; no release entry, tag or publication is made.

Initial hashes of pre-existing files are retained in the local implementation
snapshot. Existing README/development/product-evidence and speaker artifacts are
not rewritten by CI foundation work. Product source changes are limited to the
planned tested UI/version support.

## Architecture decision

Keep the single Cargo application. Reuse the Windows build/package runners and
introduce only CI-scoped functions/configuration. No application layer migration,
service, database or branch manager is required.

## Execution evidence

Task completion and failing-first/passing checks are recorded below as they run.
Unexecuted hosted, native-desktop and performance acceptance remain pending.

### Shared foundation

The 67 evidence-contract checks and five package/tool-pin tests pass. PowerShell
boundary checks pass for quoting, preserved exit 7, bounded timeout, absent
prerequisites, checksum failure, archive paths and a real junction escape fixture.
Hash-type, timestamp, changed dirty state and unidentified-exception assertions
failed before their corrections. Initial missing-function failures are setup
checks, not counted as regression proof.

A real formatting invocation produces a passing local receipt; an unfinished
gate produced an incomplete receipt. Local identity cannot certify hosted proof.
Each invocation derives its context again, refusing stale attempts/policy/HEAD.
The Windows setup now verifies cached archives and extracted bytes before use.

Pinned setup installed llvm-cov 0.9.1, cargo-mutants 27.1.0 and cargo-deny 0.20.2.
The verified wheel stores libclang under its platlib data directory; provisioning
uses that actual location. Existing development-runner libclang matches its DLL
digest. Check-only passed with Rust 1.95.0/LLVM 22.1.2, MSVC 19.35.32217.1,
CMake 3.25.1-msvc1 and Git 2.39.0.windows.1. Hosted image identity remains pending.
Downloads and local tool installs used the ignored checkout cache; no global
toolchain or product version was changed.

### Rust quality slice

All 13 Rust-quality gate families have passing local evidence after correcting
the UI selection parser: a filtered UI selection legitimately reports unrelated
library tests as filtered out, while listed/executed selected identities must
still match. That acceptance assertion failed before the correction; the actual
UI selection then passed. Library: 96 passed; integration: 62 passed and five
named external cases ignored; existing UI selection: 16 passed.

Coverage measured 3,790/5,202 lines (72.8565936%), including embedded tests,
binary startup, actual UI drawing and boundary integration. Freeze the whole-point
floor at 72%. The module-only src/lib.rs has no instrumented executable lines;
its full source/hash remains in the inventory and the strict declaration-only
check stops excluding it if executable code is added. Duplication scanned the
same handwritten tree with 5-line/50-token minima: 44/6,755 lines (0.65137%).
The declarations-only file is below the tokenizer minimum. Neither measure is
described as pure-unit coverage.

RCA inspected all 14 source files. Fifteen existing functions/closures exceed 10;
their exact measured ceilings, concrete lifecycle/IO responsibilities, maintainer
owner and 2027-02-05 review expiry are recorded. Anonymous symbols include spans;
duplicate trait/closure names are disambiguated instead of widening exceptions.
New/exceeded or improved-away/missing exceptions fail. No product refactor was
used to make CI adoption green.

Real RCA calibration measured simple=2, outer own=1 (aggregate=5), nested=2 and
closure=2. Malformed Rust was refused. A disposable ast-grep fixture treating a
forbidden native import as valid failed; original fixtures remained unchanged.
Both boundary rule suites and their source scan pass. Fixtures live outside
ruleDirs because ast-grep otherwise parses test YAML as rule definitions.

Rust dependency scan: no advisory/source errors; seven duplicate-version warnings
are advisory. Version-specific allowances retain the existing epaint fonts,
Symphonia and whisper-rs licenses; package notices remain required. npm reports
zero vulnerabilities for the omit=peer scan; its dependency metadata total is a
resolved-graph count, not an installed-package count. No advisory waiver was added.

The initial cold coverage build stalled in restricted-host MSBuild worker startup.
Its owned CMake tree was stopped; a normal-permission single-worker native build
completed, then the full instrumented suite passed. This does not establish a
hosted cold-cache timing result. CI workflow passes actionlint 1.7.12 and the
Node policy/measurement tests pass. The GitHub connector lookup was unavailable;
the official cache Action ref and node24 manifest were read directly before
pinning its commit.

Readiness intentionally cannot pass with later report/mutation/package evidence
absent. These results prove the Rust slice, not complete hosted release readiness.

### Desktop test slice

The exact dev-only egui_kittest 0.37.0 dependency adds four packages; every
pre-existing locked package/version/source identity is retained. Product runtime
dependencies and behavior remain unchanged. The actual draw/input harness runs
84 cases: two tabs × idle/ready/busy/stopping/saving/failure/completed × three
logical sizes × two scales. Stopping and saving are separate concrete cases.
Busy repaints use bounded frame stepping, not an indefinite settle loop.

All four new UI tests pass, covering the matrix, Tab/Enter/pointer navigation,
copy output/discard and clickable cancellation during stopping/saving. Deliberately
removed Cancel and broken navigation in an isolated source export each produce
a real failed assertion. A shared-target fixture initially reused the fault
test executable; cleaning the explicit MSVC application target and rebuilding
proved the real source again. Further fault exports use their own target directory.
No source fault was applied to the working tree. All 100 library tests and strict
Clippy pass; the wrapper's 20-test UI selection passes and labels simulated egui
evidence separately from native proof.

The native adapter and its Windows PowerShell/PowerShell 7 boundary tests pass.
Wrong-PID and array-hash cases failed before fixes. A real hung watchdog test
terminates its own worker and writes incomplete evidence. The adapter requires
PowerShell 7 and a real interactive desktop, binds the executable/hash/version,
checks its own PID/window/tabs and landmarks, captures tree/window PNG, and requires
clean bounded close. It is available for the later final-package lane; no packaged
GUI or hosted desktop capability has been certified at this point.

### Read-only release proposals

Official analyzer/notes hooks now classify fix/feat/breaking and release-document
changes with explicit breaking precedence. The unconfigured official analyzer
returned no release for docs(release); that assertion failed before the custom
patch rule. Ordinary documentation, tests, refactors, CI and generated release
bookkeeping do not produce another version.

Bare temporary object databases prove complete merged ancestry, bootstrap,
no-release/main behavior, annotated prior tags, unsynchronized/shallow-history
refusals and unchanged source/ref records. They create no branch or tag refs.
API fixtures prove exact repository/workflow/push/SHA/latest-attempt binding,
pagination, retained immutable artifacts and stale/missing/skipped evidence refusal.
Further failing assertions exposed missing control-run SHA reconciliation and
missing configured ticket/document references; both corrections pass.

The preview workflow uses the frozen main control commit and read-only permissions.
It can propose a version after a successful actual release-push run; prepare and
publish modes are not enabled until their later contracts exist. No live workflow
was dispatched and no product version, changelog release entry, tag or remote
release was changed. Cross-platform evidence retains the Windows producer root;
Git attributes keep source/config bytes consistent on Windows and Linux.

- T001–T003: baseline captured; all three initial setup assertions failed before
  configuration. The configured package/pins/ignore assertions then passed.
- The first npm lock audit reported 39 moderate findings, tracing to glob,
  minimatch, qs and the initially selected YAML parser. No waiver was added.
  A new override contract failed before the patch. Reviewed patched transitive
  overrides (glob 14.0.2, minimatch 11.0.1, qs 6.16.1) and YAML 2.9.1 remove the
  active-tool paths. The remaining 35 findings are solely in the unused release
  core's bundled npm, which npm overrides cannot rewrite.
- Bounded plan adjustment: keep core 25.0.8 pinned for peer resolution in the
  lock, but omit peer-only packages from installation/audit via npm's supported
  omit=peer policy. Only official analyzer/notes hooks are used. A failing test
  requires the core to be absent and both hooks to work. No advisory waiver or
  publishing shim is introduced. This scope is explicit in receipts/audits;
  uninstalled peer metadata is not claimed vulnerability-free.

Sources: [npm advisory details](https://github.com/advisories/GHSA-g3hv-75wg-m249),
[glob cancellation advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4),
[YAML parser advisory](https://github.com/advisories/GHSA-48c2-rrv3-qjmp).

## Implemented release and reporting boundaries

All three workflows are installed locally: ordinary CI, weekly/manual full
mutation and trusted-main controlled release. Preparation emits an isolated
version/changelog patch; it does not rewrite this checkout. LF/CRLF tests,
locked/offline Cargo metadata, unchanged non-root graph, exact tree/parent and
workspace/ref preservation checks pass. The real Cargo metadata rehearsal also
proved that an exported candidate's .cargo configuration is not entered.

Approval tests bind the candidate digest and control run/attempt to a configured
user review. Artifact fixtures reject substituted IDs, names, byte counts,
digests, origins and unsafe redirects. Actual fixture ZIPs pass bounded data-only
extraction. Signed downloads receive no forwarded credentials. Outer and inner
ZIP tests cover traversal, case collisions, symlinks, overwrites and size limits.

Mocked publisher rehearsals pass annotated-tag, draft, exact attachment/hash,
identical-retry and conflict checks. Transport failures before/after each stage
remain recoverable with identical release identity and fresh approval. Review
found and fixed two pre-publication races: a same-SHA CI rerun during staging and
a draft changed during upload. Both now refuse publication before draft=false.
No real publication API mutation was called.

Reporting tests distinguish absent data from measured zero, raw threshold
decisions from rounded display, and local from hosted identity. Failed rendering,
missing receipts, changed raw bytes, mixed attempts, skipped jobs or an incorrect
mutation profile cannot produce readiness. The real local quality report was
rendered successfully; its missing CI jobs and local provenance remain blocked.
The full workflow also builds a blocked report when its artifact download fails.

## Actual local native and package proof

The first native attempt failed with an owned-window identity error. Diagnostic
capture found Winit's transient unnamed 16×16 event pane before the application's
titled window. A regression fixture reproduced that failure; the adapter now
waits for rustcorder while retaining strict PID/HWND checks. Native v2 passed
Record → Transcribe file → Record, expected landmarks and clean exit 0 in 5.38s.
The tree and screenshot hashes are retained under
`.build/ci-evidence/native-live-v2`; this was a dirty Debug package on the local
Windows NT 10.0.26200 platform.

A fresh local Release package also passed the full adapter in 214.809s:
compiled version 0.1.0, verified VAD/license, 402 ZIP inventory entries, checksum
and manifest verification, actual packaged-window navigation and normal close.
ZIP SHA-256: `43a6060604bffcb97a0de6bd348be6c12603f8cd399b91d4a402016dc72d3b21`.
Evidence: `.build/ci-evidence/package-live-v1/package`. Its kind is explicitly
local-package with a dirty build; it cannot certify a clean hosted candidate.
There was no ASR model, recording, device or file-dialog acceptance claim.

## Fresh quality and mutation measurements

The 13-gate local quality run passed formatting, Clippy, debug build, unit,
integration, simulated UI, coverage, complexity, unused-code diagnostics,
duplication, architecture and dependency policy. It recorded 100 library tests,
64 passing integration tests plus the five named external cases, and 15 selected
UI tests. The UI matrix covers 84 scenarios within its tests; it is not 84 extra
test identities. Coverage was 4019/5380 lines (74.70%) against the reviewed 72%
floor. Evidence: `.build/ci-evidence/final-quality-v1`.

The real Rust light run completed in 958.473s with 36 generated outcomes:
34 detected, one surviving, one nonviable; viable score 34/35 = 97.14%, above
40%, with no unresolved timeout accepted. The survivor exposed missing coverage
for non-NotFound settings read errors; the follow-up test is tracked with the
final rerun rather than relabelling this earlier result.

The first Node light attempt was too slow and left an incomplete scratch tree;
receipt capture correctly refused its dependency symlink instead of declaring
success. Scratch copies now live outside raw evidence. The per-mutant population
uses 102 pure decision tests; expensive preparation/archive tests remain in the
ordinary complete policy suite. Its exact baseline passed with zero skipped
tests in 2.101s in the final measured probe (earlier loaded probes: 7.9–12.5s).
Production mutation functions, sources, 40/50% floors and 20/60-minute engine
limits were preserved. Current real light/full outcomes are recorded separately
below when complete; partial populations never establish a score.

Raw adapters are cohesive functions in mutation.mjs, called by gates.mjs. Their
89 focused fixtures cover exact generated/outcome inventories, positive viable
counts, compile exclusions, malformed/cached/stale data and timeout/unknown-status
refusal. Full Node scope additionally covers report and mutation decisions.
Rust profiles select --lib for both build and test, retaining all library tests;
four test threads reduce serial test latency without dropping the population.
References: [Cargo argument selection](https://mutants.rs/cargo-args.html),
[mutation parallelism](https://mutants.rs/parallelism.html).

## Remaining hosted adoption

Read-only GitHub inspection during implementation still returned only main,
an empty environment list, no rulesets and HTTP 404 Branch not protected for
main. The owner must establish develop/release, install these files on main and
configure [the required checks and reviewer environment](branching.md).
No branch/ref operation, current release entry, tag creation or publication was
performed by implementation.

Hosted Windows desktop capability, Linux data verification in the real jobs,
the complete cross-job release rehearsal, remote enforcement and three complete
warm-cache critical-path measurements remain unproved. These acceptance tasks
stay unchecked. Local component timings are not a substitute for the 45-minute
hosted target or a Windows 11 physical-device/offline corpus acceptance.

## Final local verification and limits

The final quality rerun passed all 13 gates: 101 library tests, 64 passing
integration tests/five named external ignores, 15 simulated UI tests and
4034/5394 covered lines (74.79%). The complete policy job passed 344 Node helper
tests, including 12 workflow-security checks; actionlint passed all workflows.
PowerShell setup/extraction, dispatcher, package/archive, native-smoke and
publisher boundary suites pass. Real local reporting constructs valid evidence
and correctly refuses hosted readiness.

That last reproduction caught an exit-propagation bug: PowerShell included Node's
diagnostic stdout in the function return value, yielding shell exit 0 for blocked
local readiness. The regression failed with expected 1/actual 0. Diagnostics now
go to the host and exit values must be scalar integers; the fixture and actual
local refusal both pass. Ordinary hosted readiness already uses the direct Node
command and remained blocked correctly.

The fresh Node light gate passed in 721.915s: 680 generated/completed,
382 detected, 298 survived, zero nonviable/unresolved; 56.18% against 40%.
Earlier schema-coordinate mismatches stayed incomplete. A real-record regression
now reconciles zero-based plan locations with one-based report locations while
retaining exact ID/file/span/mutator/replacement matching (102 adapter tests).

Rust full passed in 2738.401s (45.64 minutes, within its 60-minute limit):
231 generated/completed, 135 detected, 59 survived, 37 nonviable; 135/194 = 69.59%
against 50%, with no timeouts. The settings read-error survivor received a typed
I/O regression test: the isolated exact guard mutation failed, restored complete
app/settings modules passed, and the real 101-test library suite passed.

The first complete Node full report was 40,992,885 bytes, exceeding the existing
16MiB JSON bound, and contained three timeouts. Those outcomes stayed incomplete.
All three involved large report-fixture assertion diffs. Per-mutant reporting now
uses Node's compact built-in reporter; the independent positive-population baseline
retains TAP. Large-data preservation assertions compare exact serialized digests
and counts, avoiding multi-megabyte failure dumps. Neither parser limits, mutation
populations, score floors nor timeout acceptance were relaxed. A fresh full result
is recorded below after verification.

The large report regression initially produced 2,114,839 Markdown bytes. It now
produces 15,073 bytes while preserving all 5,000 outcomes/inventory IDs and 5,000
raw path/hash records in unchanged full JSON (1,669,889 bytes). Summary display
previews identify omitted counts and link complete data; failed decisions remain
failed. The report suite passes 28 tests.

Testing-mix exception: the 101 library/344 helper labels versus 64 passing Rust
boundary tests yield an upper bound of 445/509 = 87.43% for cheap-unit composition;
some labeled helper/library tests also exercise files/processes/UI and are not
pure units. This is below the repository's 90% target. Existing boundary tests
were retained because worker protocol, executable startup, archive bytes and
native windows require their actual boundaries; inflating counts or removing them
would weaken the requested proof. New decision logic uses cheap tests, and the
new executable --version behavior has two necessary process-level tests.

Preservation checks confirm main, product version 0.1.0, no changelog release
entry and the original staged content. Unrelated working-file hashes match the
initial capture; the original 12,806 development-document bytes are unchanged.
Two existing Markdown files use CRLF in the working tree/LF in the index, so their
staged-content comparison normalizes only line endings. No staging, commit, push,
branch/tag ref or remote release mutation occurred. Fourteen relevant Markdown
documents have 70 resolvable relative links. No extension file exists; Spec Kit
post-implementation hooks are skipped.

| Success criterion | Evidence / remaining acceptance |
| --- | --- |
| SC-001 | Promotion/commit and workflow fixtures pass; remote required-check enforcement pending |
| SC-002 | 84 UI scenarios/15 tests and real local Release navigation pass; hosted/device proof pending |
| SC-003 | Official semantic hooks, bootstrap/no-release/history and confirmed preparation fixtures pass |
| SC-004 | Exact approval, stale-attempt and publisher retry/conflict fixtures pass; remote environment absent |
| SC-005 | Fresh local Release ZIP/native proof passes; clean hosted candidate still required |
| SC-006 | Coverage/complexity/duplication/dependency/architecture gates pass with explicit measured scope |
| SC-007 | Reports retain raw evidence; tampering, mixed attempts, builder failures and local certification refuse |
| SC-008 | Both engines pass light/full floors and 20/60-minute local budgets; three hosted warm attempts pending |
| SC-009 | Exact reproduction commands, retention and link checks pass; owner adoption remains pending |

### Final fresh mutation gates

All four profiles now pass with their complete generated/outcome inventories and
no unresolved outcomes. These are independent fresh local runs, not combined or
cached outcomes. Compiler caches were allowed; every mutation ran again.

| Engine/profile | Detected | Survived | Nonviable | Accepted exact ratio | Floor | Duration |
| --- | ---: | ---: | ---: | --- | ---: | --- |
| Rust light | 35 | 0 | 1 | 35/35 = 100% | 40% | 847.330s / 14.12min |
| Node light | 382 | 298 | 0 | 382/680 = 56.18% | 40% | 947.906s / 15.80min |
| Rust full | 135 | 59 | 37 | 135/194 = 69.59% | 50% | 2738.401s / 45.64min |
| Node full | 754 | 420 | 0 | 754/1174 = 64.22% | 50% | 1361.252s / 22.69min |

Evidence roots under `.build/ci-evidence/`: mutation-rust-live-v2,
mutation-ci-live-v4, mutation-rust-full-live-v1 and mutation-ci-full-live-v3.
The exact settings guard survivor is now detected in Rust light. All three former
Node timeout mutations are detected normally after compact diagnostics; the new
full report stays within the original parser bound. Earlier incomplete/cancelled
receipts remain unchanged, with their diagnostics retained separately.

Real Release-package collection also passes independent raw-file hashing and
data-only remeasurement. None of these local results authorizes a release or
substitutes for the final hosted/integration acceptance tasks T080–T087.
Their local security-review and guidance components are prepared; final review
must include any changes required by actual hosted adoption.

### 2026-11-06: approved commits and joined release-flow acceptance

The user explicitly authorized branch creation, commits and pushes, then approved
the 27 proposed groups in `docs/commit-grouping-plan.md`. They were committed on
`feature/ci-quality-release` and pushed through commit
`aa8d19c47405bb67529602b653b7668e2eb4d9a0`. Their cumulative tree exactly matches
the reviewed staging snapshots. All 103 working-file hashes were preserved;
main remains at `8b200d21c07d668e2e492c68139970031b923c65`. No product version,
changelog release entry, tag or published release was changed. Earlier statements
about no staging or branch mutations describe the preceding implementation phase.

T080 is now complete. `scripts/ci/tests/release-flow.test.mjs` joins the actual
proposal/preparation, candidate schema, frozen source inventory, package archive
verification, both mutation normalizers, raw-evidence collection, report,
readiness, reviewer approval and publisher adapters. Its companion PowerShell
fixture provides synthetic package/native observations and an in-memory API
backend persisted only inside the test's owned temporary directory. Tokens are
cleared for child fixtures; the default publication transport throws if reached.
No real publication remote, product tag or application version is mutated.

The fixture proves:

- The final commit has exactly the prepared source parent/tree and only changes
  Cargo.toml, Cargo.lock and CHANGELOG.md in the isolated bare repository.
- All 18 gate receipts pass remeasurement and join a ready report. Each of the
  seven named final jobs is independently mandatory in source-attempt validation.
- Evidence from the source commit cannot certify its prepared final commit;
  changed raw bytes, missing mutation outcomes and newer attempts block acceptance.
- A stale candidate/control approval is refused by the real publisher before any
  fixture API operation.
- An interruption after the first stored upload leaves a draft. A fresh process
  resumes with the same annotated-tag identity and existing asset bytes; another
  retry retains the same completed publication receipt without rewriting it.

The fresh-process retry initially failed even though every receipt value was
identical: asset hash-table keys changed JSON serialization order. The fix uses
an ordered asset dictionary when producing the receipt, preserving exact-byte
conflict detection. The retained failing log shows asset keys changing from
`id,name,sha256,bytes` to `sha256,id,name,bytes`. The focused fixture then passed
all seven reported tests; the complete Node support population passed 351/351
with zero skipped/cancelled tests, and existing publisher boundary checks passed.
Evidence is retained under `.build/ci-evidence/release-flow/` in
`red-receipt-order.*`, `green-receipt-order.*`, `all-node.*` and `publisher.*`.
The new seven reported tests are one integration fixture with six subtests,
not seven new cheap unit tests. Crossing the real Git, ZIP, JSON and PowerShell
boundaries is the purpose of T080 and is a justified integration exception.

The first actual hosted run is
[CI 42158351603](https://github.com/joaobispo2077/rustcorder/actions/runs/42158351603),
attempt 1, at the pushed head above. Its policy support tests passed 344/344 and
workflow syntax passed. Promotion validation failed because `origin/develop`
did not yet exist. The user-authorized develop and release branches were then
created and pushed at the unchanged main baseline. This resolves that missing
configuration for a new checkout; it does not retroactively make attempt 1 pass.
The hosted Node light mutation job passed at 382/680 detected (56.18%), with 298
survivors and no nonviable outcomes, in 277,021 ms (4.62 minutes). Its downloaded
receipt and raw outputs passed independent hash verification and remeasurement.
The Windows quality and Rust light
mutation jobs were still running at this snapshot. Package smoke is correctly
excluded on this feature push. A new complete attempt is required after the
branch configuration change; partial reruns cannot substitute evidence from a
different attempt. These hosted results do not include the uncommitted T080
fixture or receipt fix. T081–T087 remain unproved and unchecked.
