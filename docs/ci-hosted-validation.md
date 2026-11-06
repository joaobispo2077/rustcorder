# Hosted CI validation

## First actual run: 2026-11-06

[Run 42158351603](https://github.com/joaobispo2077/rustcorder/actions/runs/42158351603)
tested `aa8d19c47405bb67529602b653b7668e2eb4d9a0`, attempt 1. Its final readiness
failed; individual passing gates do not override the failed required jobs.

| Responsibility | Observed result |
| --- | --- |
| Rust quality receipts | All 13 passed; downloaded raw hashes and measurements independently verified |
| Coverage | 4,037/5,394 lines, 74.84%, against the frozen 72% floor |
| CI support tests | 344/344 passed at that commit |
| Workflow syntax | Passed; promotion validation separately failed because develop was absent |
| Node light mutation | 382/680 detected, 298 survived, no nonviable outcomes; 56.18% in 277,021 ms |
| Rust light mutation | Unmutated scratch build failed; no mutants were tested, no score accepted |
| PowerShell boundary suites | All preceding suites passed; publisher fixture failed when invoked from the workflow script scope |
| Report | Passed and retained the failures |
| Native package smoke | Excluded on this feature push; no hosted native launch claimed |

The user authorized creation and pushing of develop and release. Both now point
to the unchanged original main baseline
`8b200d21c07d668e2e492c68139970031b923c65`. This addresses the missing develop
reference for subsequent checkouts. It does not establish branch protections,
required checks, environment reviewers or initial trusted-main workflow adoption.

## Publisher fixture scope

The same boundary suite passed when started as `pwsh -File`, but failed when
called from another PowerShell script, as GitHub invokes the workflow's commands.
Its mock transport uses `GetNewClosure`; helper functions declared in the calling
script were unavailable inside that closure. The failure occurred at the first
mock CI-run response, before any publication operation.

`scripts/ci/tests/publisher-scope.test.mjs` reproduced that invocation and failed
before the fix. Capturing the copy and assertion helper scriptblocks explicitly
in `New-PublishFixture` makes them available to the closure in either invocation.
The invoked-script regression and the original standalone publisher suite pass.
This change affects the test backend, not the real publication transport.

## Native mutation scratch paths

The hosted workspace's unmutated 101-test baseline passed. Cargo-mutants then
copied the source into its default Windows temporary directory and rebuilt the
native dependency there. MSBuild failed with FTK1011 while creating its tracking
logs. The observed `link-cvtres.write.1.tlog` path is 263 characters, beyond the
legacy 260-character path bound. The mutation adapter correctly withheld a score.

The proposed fix gives hosted Rust mutation children a short owned temporary
root, `D:\a\rustcorder\rustcorder\.build\t`, through TEMP and TMP. The same
observed tracking path then has 259 characters. The helper rejects a hosted
checkout whose temporary prefix exceeds 35 characters, with an explicit short
checkout diagnostic. Local runs retain their existing temporary settings, and
the parent process environment is unchanged. The existing owned-directory check
rejects redirected roots before creating the directory. Cargo-mutants still
creates fresh isolated copies and runs the unmutated baseline; engine budgets,
source selection, outcome accounting and score floors remain unchanged.

The path regression first failed with the inherited hosted temporary root, then
passed with the shorter root. A separate local CMake probe configured and built
successfully at a short path; the deeper probe failed. This is supporting local
evidence, not confirmation that the complete hosted mutation lane now passes.
That requires a new run containing the fix. No generator change was introduced.

## Current evidence and remaining acceptance

The four T080 follow-up groups were approved, committed and pushed through
`a3bb571726ff1b80444a602cf2c4991d5967b3da`. The release-flow fixture and ordered
publication receipt are in that commit. Its new
[run 42161606371](https://github.com/joaobispo2077/rustcorder/actions/runs/42161606371)
does not contain the two compatibility fixes described above.

With those fixes in the working tree, all 354 Node support tests pass, including
the joined release-flow test, the publisher invocation regression and native
path-budget checks. The standalone publisher boundary suite passes as well.
Logs and command/exit records are in `.build/ci-evidence/release-flow/`; downloaded
first-run artifacts remain under `.build/hosted-ci/42158351603/`.

The first hosted attempt proved the 13 Rust quality gates and Node light lane,
but not complete CI readiness. T080 is complete; T081–T087 remain unchecked.
Hosted native package proof, full/warm timing attempts, final security review,
remote enforcement and the final acceptance matrix remain necessary. Current
version and changelog are unchanged, with no product tag or publication.

See [release-flow evidence](ci-quality-release-validation.md) and the
[commit review](commit-grouping-plan.md) for the reviewed implementation history.
