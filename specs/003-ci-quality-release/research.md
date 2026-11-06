# Research: CI quality and controlled releases

**Date**: 2026-11-05
**Scope**: Design decisions for [the plan](plan.md), not tool installation or
evidence that quality/release gates currently pass.

## 1. Preserve the application and use a small CI-only tool layer

**Decision**: Keep the existing Cargo package and Windows/MSVC target. Use
PowerShell for existing native boundaries and Node 24.22.2 for pure CI decisions,
reports and semantic-release hooks, with one private locked npm package under
`scripts/ci/`. Use Node's built-in tests rather than a new unit-test framework.

**Rationale**: Existing build/package scripts already initialize MSVC, CMake,
libclang and static-runtime settings. A new Rust workspace, Python runtime or
application architecture migration would add responsibilities without product
value. The [official Node distribution index](https://nodejs.org/dist/index.json)
lists 24.22.2 and npm 11.19.1; use that exact Node patch, not an unbounded major.

**Alternatives considered**: A standalone Rust CI crate adds compilation and a
second manifest/tool API. Python would add another CI language; shell-only
release/accounting logic would make strict JSON and unit tests harder.

## 2. Exact tool selection

| Tool | Selected pin | Role |
| --- | --- | --- |
| Rust/rustfmt/Clippy | Existing 1.95.0 Windows MSVC | Product build and compiler checks |
| actionlint | 1.7.12 | Workflow syntax and expression validation |
| cargo-llvm-cov | 0.9.1 | First-party line coverage including UI and startup |
| cargo-mutants | 27.1.0 | Rust critical-decision mutation |
| cargo-deny | 0.20.2 | Advisory, license, source and dependency policy |
| rust-code-analysis CLI | 0.0.25 | Per-function cyclomatic measurement |
| jscpd | 5.4.2 | Rust source duplication |
| ast-grep CLI | 0.51.1 | Declarative syntax-boundary rules |
| Stryker core | 10.1.1 | Pure Node CI/release decision mutation |
| egui_kittest | =0.37.0, no default features | Dev-only accessible UI interaction |

**Decision**: Exact npm dependency declarations plus lockfile; explicit Cargo
tool versions/locked installation or checked release archives; SHA-256-pinned
binary assets. Capture versions and policy/toolchain hashes in receipts.

**Rationale**: Published manifests place llvm-cov's MSRV at 1.87 and both
cargo-mutants/cargo-deny at 1.88, compatible with product Rust 1.95.
The [coverage platform documentation](https://github.com/taiki-e/cargo-llvm-cov#platform-support)
includes x64 Windows MSVC. Sources:
[coverage manifest](https://github.com/taiki-e/cargo-llvm-cov/blob/v0.9.1/Cargo.toml),
[mutants manifest](https://github.com/sourcefrog/cargo-mutants/blob/v27.1.0/Cargo.toml),
[deny manifest](https://github.com/EmbarkStudios/cargo-deny/blob/0.20.2/Cargo.toml).

Use jscpd's npm-provided platform binary, not its current Cargo workspace, which
requires a newer Rust compiler. See its
[published package](https://github.com/kucherenko/jscpd/blob/v5.4.2/rust/jscpd/package.json)
and [Rust CLI documentation](https://github.com/kucherenko/jscpd/blob/v5.4.2/docs/rust.md).
Install ast-grep's matching native npm package; validate its reported version.
Its [rules](https://ast-grep.github.io/reference/yaml.html) support fixtures and
[project scans](https://ast-grep.github.io/guide/scan-project.html).

**Alternatives considered**: A second cargo-audit check duplicates cargo-deny's
advisory responsibility. Current cargo-modules requires a newer compiler and a
large analyzer stack; a few tested syntax rules are sufficient here.

## 3. Native setup and pinned Actions

**Decision**: Run all product/Cargo gates on Windows, avoiding a Linux attempt to
execute the repository's Windows-host toolchain. Reuse `dev.ps1`; provision
`llvm-tools-preview` for coverage and extract the same libclang wheel already
used in local development.

The [libclang 18.1.1 publication metadata](https://pypi.org/pypi/libclang/18.1.1/json)
identifies the Windows x64 wheel, 26,415,083 bytes, SHA-256
`4dd2d3b82fab35e2bf9ca717d7b63ac990a3519c7e312f19fa8e86dcc712f7fb`.
Extract the DLL from the verified archive; Python itself is not required.

Official Action release tags and their commit identities were read through the
GitHub API. All four manifests use Node 24:

| Action | Reviewed release | Immutable commit |
| --- | --- | --- |
| actions/checkout | v7.0.1 | 3d3c42e5aac5ba805825da76410c181273ba90b1 |
| actions/setup-node | v7.1.0 | 949feb2413d6458794dcd2491c4babbbce0c15c1 |
| actions/upload-artifact | v7.0.2 | cf430e030ddbb5b0abf93d22962f4752f3646cd9 |
| actions/download-artifact | v8.0.2 | 9000827ccba6bdab643e8b6fd33ac0654aef8333 |

Source manifests:
[checkout](https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/action.yml),
[setup-node](https://github.com/actions/setup-node/blob/949feb2413d6458794dcd2491c4babbbce0c15c1/action.yml),
[upload](https://github.com/actions/upload-artifact/blob/cf430e030ddbb5b0abf93d22962f4752f3646cd9/action.yml),
[download](https://github.com/actions/download-artifact/blob/9000827ccba6bdab643e8b6fd33ac0654aef8333/action.yml).

Keep hosted OS labels explicit and record image/MSVC/CMake/Git identities.
Managed images are not byte-pinned developer machines; compatibility and
cold-cache provisioning must be exercised during implementation.
The [actionlint 1.7.12 release](https://github.com/rhysd/actionlint/releases/tag/v1.7.12)
API supplies its Linux x64 archive digest
`8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8`
and Windows x64 digest
`6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9`.
Store these pins in the toolchain manifest. Node helpers get syntax checks and
unit/mutation proof; PowerShell helpers get built-in syntax parsing and focused
executable boundary fixtures rather than being treated as inert YAML.

## 4. Honest test and coverage populations

**Decision**: List selected tests before execution and normalize pinned libtest
summaries into strict receipts. Require nonzero ordinary library/integration/UI
selections and an explicit inventory of ignored external cases. Do not enable
unstable libtest JSON on the stable product toolchain.

**Rationale**: Cargo's compiler JSON does not describe test execution. Stable
libtest provides selection/listing and completion summaries:
[Cargo test](https://doc.rust-lang.org/cargo/commands/cargo-test.html),
[libtest](https://doc.rust-lang.org/rustc/tests/index.html).
Parser fixtures must reject truncated, duplicate, contradictory and empty output.

UI is exported by `src/lib.rs`; its tests already run in the library. Coverage
will include normal targets and process-boundary integration, and must be named
accordingly. Measure all first-party `src` Rust files, report missing files and
record any embedded test code the tool includes. No FFI/C++ coverage claim.

**Alternatives considered**: nextest/JUnit would add another tool solely for
counts. It becomes justified if pinned libtest normalization proves inadequate.
Avo's 68% and the constitution's 90% cheap-unit target cannot substitute for a
measured Rustcorder coverage floor.

## 5. Complexity, dead code, duplication and boundaries

**Decision**: Use the published RCA v0.0.25
[Windows archive](https://github.com/mozilla/rust-code-analysis/releases/download/v0.0.25/rust-code-analysis-win-cli-x86_64.zip).
Its release has no supplied digest: capture/review a checksum before enabling the
download in CI. Freeze source inventory and fail missing outputs/invalid metrics.

Run RCA's error-node count before its metrics. The pinned
[Rust grammar](https://github.com/tree-sitter/tree-sitter-rust/blob/v0.20.3/grammar.js)
supports the let-chain forms used by this application. Recursively inspect
function spaces, not module maxima. Calibrate own-function cyclomatic values
from nested spaces, including nested functions/closures, against small fixtures.
Scope is handwritten Rust under `src`, including embedded tests, with exact
path/qualified-symbol ceilings above 10.

RCA's [error filter](https://github.com/mozilla/rust-code-analysis/blob/v0.0.25/src/parser.rs)
detects error nodes, not all missing-node recovery. Supplement it with native
compilation and malformed/new-syntax calibration fixtures. Metric JSON alone is
not parse proof; unsupported analyzer behavior blocks adoption rather than
producing a passing zero. This limitation is explicit.

Reuse compiler/Clippy `dead_code` and stale-expectation diagnostics with narrow
reviewed symbol exceptions. This does not establish full public API reachability.
Configure duplication at 5 lines/50 tokens and maximum 2%, requiring positive
analyzed scope. Treat ast-grep rules as syntax-edge constraints, not a resolved
whole-program graph; fixture grouped imports, aliases, qualified references,
comments/strings and invalid source.

**Alternatives considered**: A custom Rust parser or application layering
migration is unjustified. Whole-repository duplication would mix generated,
vendored and documentation populations with product source.

## 6. Two mutation engines and one acceptance rule

**Decision**: Rust uses cargo-mutants with explicit TOML profiles. Node pure
helpers use Stryker's built-in command runner and Node tests, without a runner
plugin. Light Rust selects critical decisions in app/settings/transcript/live;
full expands that declared scope. Node light covers gates/release, full also
report decisions. Both engines independently need 40% light / 50% full.

Cargo-mutants raw outcomes and generated mutant inventory must reconcile.
Survivors may produce exit 2 and still meet the configured percentage; baseline
failure, timeout or execution error never does. Source:
[exit codes](https://mutants.rs/exit-codes.html),
[output inventory](https://github.com/sourcefrog/cargo-mutants/blob/v27.1.0/book/src/mutants-out.md),
[outcomes](https://github.com/sourcefrog/cargo-mutants/blob/v27.1.0/src/outcome.rs).

Stryker's normal metric counts timeouts as detected; our contract does not.
Normalize raw Killed/Survived/CompileError separately and reject Timeout,
NoCoverage, RuntimeError, Pending and unexplained Ignored outcomes as incomplete.
Disable incremental outcome reuse and its built-in break threshold; use our
validator. Prove the independent baseline test population, since the command
runner only observes process status. Sources:
[configuration](https://stryker-mutator.io/docs/stryker-js/configuration/),
[status semantics](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/),
[command runner](https://github.com/stryker-mutator/stryker-js/blob/v10.1.1/packages/core/src/test-runner/command-test-runner.ts).

**Alternatives considered**: Rust mutation alone leaves release helpers untested.
Fault-injection unit tests complement but do not replace actual mutation.
No averaging of engines or counting timeouts as kills.

## 7. UI and native package proof

**Decision**: Add only dev-only egui_kittest 0.37.0 without renderer/snapshot
features, reusing private fixtures and actual draw calls. Use accessible labels,
keyboard/click input, rectangles and emitted copy actions. Busy states advance a
bounded number of frames. No global environment mutation in parallel Rust tests.

The matching [manifest](https://github.com/emilk/egui/blob/0.37.0/crates/egui_kittest/Cargo.toml),
[usage](https://github.com/emilk/egui/blob/0.37.0/crates/egui_kittest/README.md) and
[builder](https://github.com/emilk/egui/blob/0.37.0/crates/egui_kittest/src/builder.rs)
support this approach. Preserve existing geometry and Cancel regressions.

Use Windows UI Automation for the real portable-app smoke. Existing eframe
enables AccessKit; its [adapters](https://github.com/AccessKit/accesskit#readme)
support Windows accessibility. Preflight desktop/display/UIA, isolate only the
child's LOCALAPPDATA, bind automation to its PID, navigate both screens and close.
Capture tree/bounds/screenshot; never start capture or inference.

Do not assume hosted Windows categorically lacks a GUI:
[Microsoft guidance](https://learn.microsoft.com/en-us/windows/apps/develop/ai-assisted/testing)
describes graphical CI, while [GitHub runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
does not guarantee this app's capability. A failing hosted preflight requires a
trusted disposable interactive runner for release candidates, never fork PRs.
Either way, Windows Server smoke is not a Windows 11 physical-device pass.

**Alternatives considered**: Browser testing would not exercise this native UI.
A full screenshot regression system or new public UI testing API is unnecessary.

## 8. Semantic analysis without lightweight publication

**Decision**: Call exported official analyzer/notes hooks with complete reachable
commit history. Pin analyzer 13.0.1, notes 14.1.0, conventionalcommits preset
9.1.0 and semver 7.7.3. Explicitly pin core 25.0.8 for nonoptional peer resolution,
but never import/invoke its release pipeline.

The [core tag implementation](https://github.com/semantic-release/semantic-release/blob/master/lib/git.js)
has no annotated-tag option. Exported
[analysis](https://github.com/semantic-release/commit-analyzer/blob/v13.0.1/index.js)
and [notes](https://github.com/semantic-release/release-notes-generator/blob/v14.1.0/index.js)
provide the needed calculation without those publishing side effects.
[Peer/engine requirements](https://github.com/semantic-release/semantic-release/blob/v25.0.8/package.json)
are compatible with selected Node 24.22.2.

Use a shared Conventional Commits parser supporting bang/footer breaking changes.
Custom rules include BOTH breaking-to-major and docs(scope=release)-to-patch,
since a matching custom docs rule can suppress default breaking classification.
Test that precedence. Ordinary docs/chore/test and generated chore(release)
bookkeeping remain no-release. Keep configured existing docs/RCR links in notes.

**Alternatives considered**: Forking semantic-release, replacing Git, rewriting
published tags or invoking core and repairing tags all violate simplicity or
immutability. With no tags, bootstrap requires explicit confirmation of the
manifest-derived version rather than semantic-release's default first major.

## 9. User-owned metadata commit and exact release authorization

**Decision**: CI calculates/prepares metadata; the user commits/pushes the patch.
Bind source SHA, previous tag/object, policy/tool identities, patch digest and
expected tree in a preparation artifact. Accept only its exact resulting tree
with source as the single parent. Validate the final commit in its own push run.

Known-format Cargo version token edits are sufficient for the current single
package. Verify exact manifest identity and the locked graph before/after via
[Cargo metadata](https://doc.rust-lang.org/cargo/commands/cargo-metadata.html).
Reject ambiguous/inherited syntax, preserve every unrelated byte and normalize
only root package IDs when comparing graphs. Do not regenerate the lockfile.

Freeze final commit/version/preparation/evidence identities before protected
environment approval; recheck after approval. The publisher runs trusted main
code, reads candidate files as data, creates an annotated tag only after checks
and authorization, stages the draft against the existing tag and publishes exact
tested bytes. Do not let a release API create a tag from the default branch.

GitHub sources:
[review approval](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments),
[workflow-run semantics](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run),
[run attempts](https://docs.github.com/en/rest/actions/workflow-runs#get-a-workflow-run-attempt),
[attempt jobs](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt),
[artifact identity/digests](https://docs.github.com/en/rest/actions/artifacts),
[concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).

**Alternatives considered**: A bot version commit requires branch-write
exceptions and downstream-trigger handling. A dispatch boolean without reviewed
candidate binding is not publication approval. Latest artifact by name is not
run-attempt identity.

## 10. Observed remote state and implementation proof still required

Read-only GitHub inspection on 2026-11-05 found public
`joaobispo2077/rustcorder`, default/only branch main, no remote tags, no
environments, no rulesets and an explicit "Branch not protected" response for
main. Token defaults are read-only; PR-review approval by workflows is disabled.
Remote main was `8b200d21c07d668e2e492c68139970031b923c65`.

No remote state was changed. The setup script returns feature identity
`003-ci-quality-release` in its BRANCH field; Git independently confirms actual
branch `main`. Do not mistake the feature identity for a checked-out branch.

The [earlier Avo reference](../../docs/ci-quality-release-reference.md) remains
the comparison evidence. Exact tools/dependency cleanliness, RCA checksums and
calibration, native desktop capability, baseline floors/debt and timing targets
need implementation execution. These are bounded acceptance work, not unresolved
product decisions or fabricated passes.
