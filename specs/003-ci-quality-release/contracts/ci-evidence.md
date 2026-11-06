# Contract: CI gates, execution and evidence

This contract defines proposed implementation interfaces. The scripts/workflows
do not exist yet. It supplements [the model](../data-model.md) and [plan](../plan.md).

## Events and promotion policy

| Event | Eligible context | Required result |
| --- | --- | --- |
| Feature push | Branch starts with feature/ and has a nonempty safe suffix | Complete ordinary validation |
| PR to develop | Head feature/ branch, including same-named fork contribution | Validate source policy and tested merge |
| PR to release | Head develop in this repository | Validate promotion and tested merge |
| PR to main | Head release in this repository | Validate promotion of the published release, without publishing again |
| Release push | Literal release in this repository | Ordinary validation plus package/native smoke |
| Full mutation | Weekly or manual trusted workflow | Both full profiles, independent of PR readiness |

Other promotion pairs fail. A main-promotion head must identify the approved
published candidate; its proposed merge must preserve the release's product
tree/version. Release-metadata synchronization goes through user-owned feature
work targeting develop; no reverse-promotion exception or automatic merge exists.

Only stable named checks are configured as branch requirements. `CI readiness`
requires every gate applicable to the event; it cannot infer that a skipped job
was optional. Report and image delivery are not evidence of a gate pass.

## Local gate entry point

Proposed `scripts/ci/ci.ps1` takes a fixed `-Gate` value, an evidence directory,
and `-Profile light|full` only for mutation. Supported gate IDs:

`prerequisites`, `format`, `lint`, `build`, `unit`, `integration`, `ui`,
`coverage`, `complexity`, `deadcode`, `duplication`, `architecture`,
`dependencies`, `package`, `mutation-rust`, `mutation-ci`, `readiness`, `report`.

The `quality` convenience value runs the fixed format/lint/coverage/complexity/
deadcode/duplication/architecture/dependency collection, preserving child failures.
It does not imply integration, native smoke or mutation ran.

Commands are fixed arrays, not strings assembled from branch names or artifact
data. A local invocation records `local`, source SHA and dirty status; no input
flag can relabel it as hosted proof. A successful tool exit without valid
required output is an incomplete gate.

Exit convention for the wrapper: 0 accepted, 1 measured policy/test failure,
2 incomplete/setup/schema failure. Both nonzero states fail the job. Preserve
the original child's exit code in its receipt.

## Gate command and output contract

All Cargo product commands run through the existing Windows environment runner.
Provisioning may fetch locked dependencies; later offline checks require that
cache and fail if it is absent.

| Gate | Command family | Required evidence |
| --- | --- | --- |
| format | cargo fmt --all -- --check | Captured exit/log, no source rewrite |
| lint/deadcode | cargo clippy --locked --all-targets -- -D warnings | Compiler diagnostics and narrow expectation inventory |
| build | cargo build --locked | Supported target result and tool identities |
| unit | cargo test --locked --lib | Listed inventory and complete execution counts |
| integration | cargo test --locked --test integration | Boundary population, ignored external identities |
| ui | cargo test --locked --lib ui::tests | Nonzero actual draw/input population and matrix assertions |
| coverage | cargo llvm-cov --locked --all-targets --json | First-party file inventory, covered/total lines and raw JSON |
| complexity | RCA count-error, then metrics JSON | Nonempty parsed scope, calibrated own-function metrics |
| duplication | Locked jscpd Rust CLI | Raw duplicated/total lines, settings and source inventory |
| architecture | Locked ast-grep test and scan | Rule fixtures plus product findings |
| dependencies | cargo deny check and locked npm audit | Rust/npm findings, source/license policy, duplicate-version advisory |
| package | Existing package self-check/assembly plus adapter | Version/source inventory, ZIP/checksums and required native smoke |

Do not pass unstable libtest JSON flags. List and execute the same selected
population using pinned Rust; count actual results, including ignored cases.
Reject duplicate summaries, truncated output and unexpected test disappearance.
An empty binary test harness may be recorded as no tests, but cannot satisfy a
required library/integration/UI population.

Coverage excludes third-party/native dependency code. Record what embedded Rust
test code is instrumented; do not call the mixed population pure-unit coverage.
Complexity and duplication analyze the fixed handwritten `src` Rust population,
including embedded tests. Scope/settings changes are policy changes.

## Receipt and artifact format

Each gate writes:

- Raw stdout/stderr log and analyzer output when produced.
- A schema-versioned `gate.json` with the model's attempt identity, child exit,
  execution completion, scope/counts, threshold and reason.
- SHA-256 references to raw files; no fabricated output for an unexecuted step.

Collector artifact names include run ID, run attempt and job/gate identity.
Upload immutable artifacts with 14-day retention. Never select an artifact merely
because its name is latest; bind its ID, attempt-specific name and API digest.
An API archive digest and the digest of a JSON file inside it are distinct fields.

Unified output is `quality-metrics.json` plus `quality-gates.md`. Report builders
use available receipts and actual GitHub job states. Missing measurements remain
null with a reason; malformed evidence makes the corresponding gate incomplete.
Reporting cannot promote fail/incomplete to pass.
Build/upload the required report before the final CI readiness job. A successful
report may describe failed gates; a failed report builder prevents readiness.
Its calculated gate decision is not a claim that the later readiness job ran.

## Mutation normalization

| Engine raw result | Normalized classification |
| --- | --- |
| cargo-mutants CaughtMutant | detected |
| cargo-mutants MissedMutant | survived |
| cargo-mutants Unviable | nonviable, excluded from viable score |
| Stryker Killed | detected |
| Stryker Survived | survived |
| Stryker CompileError | nonviable, excluded from viable score |
| Timeout, missing tests/coverage, runtime/baseline errors, pending, unknown | incomplete; withhold score |

Require baseline success, positive expected test population and a completed
outcome for each generated mutant. Reconcile identity sets, not just a summary's
total. Reject duplicates, conflicting counts and unjustified exclusions.

Score is `100 * detected / (detected + survived)` with positive denominator.
Each engine independently requires 40% light / 50% full. Rust exit 2 may mean
survivors and is interpreted with complete output; it is not blindly accepted or
rejected. Stryker's built-in timeout-as-detection score is never authoritative.
No fresh result may be inferred from restored mutation outcomes.

## UI and native smoke

The deterministic matrix covers Record/Transcribe file; idle/ready/busy/
stopping-saving/failure/completed; 1040x880, 760x600 and 2048x1117 logical size;
100% and 200% scale. Check both stopping and saving subcases.

Proposed `ui-smoke.ps1` accepts packaged executable, expected SHA-256/version,
evidence directory and bounded timeout. It must:

1. Verify executable/manifest identity and desktop/UI Automation capability.
2. Start the actual package with a child-specific empty settings root.
3. Identify only its own PID/window, wait for accessible controls and navigate
   both screens without capture, model loading or native file dialogs.
4. Retain accessibility tree/window bounds and screenshot diagnostics.
5. Request normal close, require clean bounded exit, and terminate only the
   launched PID if cleanup after failure is necessary.

A simulated harness cannot write a native-launch success receipt. Missing
capability is incomplete/failure, never skip-as-pass. Hosted Server proof is
labelled with its actual platform; Windows 11/hardware acceptance stays separate.

## Readiness and release certification

Readiness evaluates the fixed required set and both actual job states and
receipt validity. Required failure/skip/cancellation/timeout/unknown/missing
evidence fails readiness. Event-excluded package work is explicitly excluded.

Release certification additionally requires repository/head repository,
workflow path/ID, push event, release branch, final SHA and exact successful
latest run attempt. Paginate attempt jobs and artifact lists. Downloaded data is
validated within size/path limits and never executed with publication credentials.

## Minimum failing-first contract fixtures

Invalid promotion/fork origin; missing required job; expected-zero tests;
truncated/contradictory logs; ignored-case loss; raw coverage below floor despite
rounded display; complexity nested-function accounting; stale exceptions;
duplicate scope changes; dependency scan outage; every mutation outcome class;
cross-attempt artifact substitution; missing UI Cancel/navigation; wrong native
PID/hash; missing desktop; close timeout; malformed receipt and unsafe archive path.
