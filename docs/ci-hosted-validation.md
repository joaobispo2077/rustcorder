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

## Second-run diagnostics and portability fixes

Groups 32–36 were approved, committed and pushed through
`2671e8b958c160284afd830749f5f16697288510`. Their
[run 42162378323](https://github.com/joaobispo2077/rustcorder/actions/runs/42162378323)
contains the publisher scope and native scratch-path fixes. It does not contain
the following later fixture identity and tool-download changes.

The preceding run at `a3bb571726ff1b80444a602cf2c4991d5967b3da` confirmed that
workflow/promotion validation passes after develop was created. Its Node support
step failed because the new release-flow fixture used an ambient Git author for
its final candidate commit. Local Git configuration had hidden this dependency.
The fixture now uses its existing `gitFixture` command wrapper, which supplies a
fixed synthetic author/committer, and asserts that identity. Its complete seven
reported tests pass with user.name and user.email explicitly empty. No real Git
configuration is changed. Retained evidence is `red-no-git-identity.*` and
`green-no-git-identity.*` under `.build/ci-evidence/release-flow/`.

That run's Rust mutation provisioning also received HTTP 503 before evidence
initialization. The failing job log is retained as
`.build/hosted-ci/42161606371/mutation-setup.log`; no mutation outcome or successful
setup receipt is invented for that failure. The existing required-job and
missing-evidence checks still block readiness. A later feature push cancelled
the remaining work in that run, so it is not a completed acceptance attempt.

Pinned Windows tool downloads now request two retries, a two-second retry
interval, and 120-second connection and stalled-stream timeouts. PowerShell
documents these controls, including server Retry-After handling; the stream
timeout is a stall bound, not an overall download duration. See the
[official Invoke-WebRequest reference](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/invoke-webrequest?view=powershell-7.4).
Downloads still use the pinned HTTPS URL, verify the exact checksum before
promoting a partial file, and refuse a changed cached file. The new boundary
test exercises the real asset helper with mocked request bytes and checks these
arguments and cache/hash behavior; it does not claim to simulate the HTTP
cmdlet's internal retry loop or prove external service recovery.

The final local support suite passes 355/355 with no skipped or cancelled tests
and Git author settings explicitly empty. The standalone publisher suite also
passes. Final command/exit records and raw logs use the fresh
`portable-final-all-node.*` and `portable-final-publisher.*` labels. The explicit
connection/stream timeout test passes as well. Hosted confirmation of the complete
final tree remains pending, along with T081–T087.

## First complete hosted readiness

[Run 42168293447](https://github.com/joaobispo2077/rustcorder/actions/runs/42168293447),
attempt 1, passed for `49dee970193a774ef3b34625757414c50cfa6cbd`. All six applicable
jobs passed: policy, Rust quality, Rust light mutation, Node light mutation,
report and readiness. Package smoke was correctly excluded on this feature push.

The downloaded final certification reports ready=true. Independent raw-file hash
verification, data-only remeasurement and readiness recomputation accepted all
17 applicable receipts with zero collection errors. Source and tested SHAs both
match the commit above. Retained evidence and `verified-summary.json` are under
`.build/hosted-ci/42168293447/`.

| Measurement | Accepted result |
| --- | --- |
| Node support tests | 355/355, zero skipped/cancelled |
| Rust library tests | 101/101 |
| Integration tests | 64 passed; five explicitly named external cases ignored |
| Headless UI tests | 15/15; simulated rendering/input remains distinct from a native window |
| Coverage | 4,037/5,394 = 74.84%, floor 72% |
| Duplication | 0.6274%, ceiling 2% |
| Rust light mutation | 35 detected, zero survived, one nonviable; 35/35 viable = 100%; 701,626 ms / 11.69 minutes |
| Node light mutation | 382 detected, 298 survived, zero nonviable; 382/680 = 56.18%; 278,955 ms / 4.65 minutes |

The whole run took 18 minutes 41 seconds, from 02:24:59 to 02:43:40 on
2026-11-06 in America/Sao_Paulo. It restored the native cache from commit
`2671e8b958c160284afd830749f5f16697288510`; the Rust job log records the cache hit.
This is one complete warm ordinary-CI attempt. It is not a cold-cache acceptance
run, three warm attempts, hosted full mutation or release-package acceptance.
T081–T087 therefore remain unchecked.

The user approved groups 37–40, and they were committed and pushed in order.
The working tree was clean after all 40 approved commits. Main, develop and
release still pointed to the original baseline, and no product version,
changelog entry or tag was changed.

Draft [PR #1](https://github.com/joaobispo2077/rustcorder/pull/1) now proposes
feature/ci-quality-release to develop. It was created at the verified commit
above, without merging or requesting reviewers. Its PR-specific CI is a separate
attempt; a successful feature-push run does not substitute for those checks.
The [promotion review](ci-promotion-review.md) proposes the next controlled
branch steps required to exercise the release-only native package lane.

## Promotion checks and cold-start correction

The user approved documentation group 41 and the two conditional promotion merges.
Group 41 was committed and pushed as
`ded51f43066c8c719667ac1aaea5ea17e4e60ba6`. Neither promotion was performed:
the latest PR-specific checks did not pass for that head.

[PR run 42241814972](https://github.com/joaobispo2077/rustcorder/actions/runs/42241814972)
cancelled Rust light mutation after the outer job limit. GitHub's annotation for
job 127974513261 explicitly reports the 30-minute maximum execution time.
The job started at 15:19:58 UTC and its mutation step started at 15:33:13 UTC:
13 minutes 15 seconds of checkout, setup and preceding work had already elapsed.
The outer 30-minute limit therefore could not preserve the engine's full
20-minute window. This is a job-budget failure, not evidence that cancelled
mutants were detected. The retained job log is
`.build/hosted-ci/42241814972/mutation-rust-job.log`.

The parallel [feature run 42241804561](https://github.com/joaobispo2077/rustcorder/actions/runs/42241804561)
completed Rust light mutation: 101 passing baseline tests, 35 detected mutants,
zero survivors and one nonviable mutant. Its fresh execution took 14 minutes
11 seconds. That run instead failed the support suite when PowerShell startup
exceeded the fixture's 15-second limit while creating a tiny ZIP, before the
download/extraction adapter was exercised. The exact failure is in
`.build/hosted-ci/42241804561/policy/ci-support/run.stdout.log`; raw mutation
evidence is under that run's `mutation_rust/mutation-rust/raw/` directory.
Neither run supplies complete readiness.

The proposed correction reserves cold setup and evidence-upload time in the
outer Windows job limits: light mutation 30 to 40 minutes, native package 25 to
40, and full mutation 70 to 80. The latter two lanes share Windows provisioning;
their limits are adjusted from the observed setup allowance, not from a claimed
hosted failure in those lanes. Engine limits remain 20/60 minutes and the package
limit remains 20. Mutation floors, timeout classification and fresh-baseline
requirements are unchanged. The ordinary Windows job caps remain below the
45-minute warm-pipeline target; this alone does not prove pipeline timing.

Three new regression cases failed against the previous workflow limits, then
passed with the correction. The ZIP fixture now uses fixed synthetic archive
bytes instead of launching an extra PowerShell process to construct them. The
existing boundary test still uses real PowerShell extraction and checks payload,
digest/size mismatch, redirect refusal and credential stripping.

All 358 support tests pass with Git author settings explicitly empty, and the
standalone publisher boundary suite passes. Raw local logs and command/exit
records use `cold-start-final-all-node.*` and `cold-start-final-publisher.*` under
`.build/ci-evidence/release-flow/`. These corrections require their own commit
review and a fresh hosted PR run. Groups 42–43 remain pending; their approval
must cover the new reviewed tree before either merge. T081–T087 remain unchecked,
and no version, changelog release entry, product tag or publication was created.
