# CI promotion review

## Reviewed implementation

The first 40 approved commits on feature/ci-quality-release ended at
`49dee970193a774ef3b34625757414c50cfa6cbd`. Their
[complete CI run](https://github.com/joaobispo2077/rustcorder/actions/runs/42168293447)
passed, and all 17 applicable raw-evidence receipts and final readiness were
independently verified. See [hosted validation](ci-hosted-validation.md).

Draft [PR #1](https://github.com/joaobispo2077/rustcorder/pull/1) targets develop.
Main, develop and release remain at
`8b200d21c07d668e2e492c68139970031b923c65`. The user subsequently approved group 41
and conditional merges 42–43. Group 41 is pushed as
`ded51f43066c8c719667ac1aaea5ea17e4e60ba6`; neither merge occurred because its
PR-specific checks exposed a cold Windows job timeout. A parallel feature run
also exposed a redundant ZIP fixture startup timeout. Their exact evidence and
the bounded corrections are in [hosted validation](ci-hosted-validation.md).
Product release approval remains separate.

## Proposed commits and purpose

| Group | Conventional Commit | Responsibility and status |
| --- | --- | --- |
| 41 | `docs(ci): record hosted readiness and promotion` | Approved, committed and pushed |
| 42 | `chore(ci): promote quality foundation to develop` | Approved for the previous tree; deferred pending renewed tree approval and passing current-head PR checks |
| 43 | `chore(ci): promote quality foundation to release` | Approved for the previous tree; deferred pending renewed tree approval and passing current-head PR checks |
| 44 | `docs(ci): record cold runner budget evidence` | Proposed: update hosted evidence, this review, the grouping plan and quickstart |
| 45 | `build(test): remove redundant ZIP setup process` | Proposed: replace only archive-fixture construction in scripts/ci/tests/authorization.test.mjs |
| 46 | `test(ci): cover cold Windows startup allowance` | Proposed: three failing-then-passing budget checks in scripts/ci/tests/windows-budget.test.mjs |
| 47 | `ci(workflows): reserve cold Windows setup time` | Proposed: outer Windows job limits in ci.yml and mutation-full.yml |

Group 41 contains only docs/ci-hosted-validation.md, docs/ci-promotion-review.md,
docs/commit-grouping-plan.md and specs/003-ci-quality-release/quickstart.md. Its
separate staging snapshot and patch are retained under the ignored
`.build/commit-groups-readiness/` directory for review.

Groups 44–47 have separate cumulative indexes and patches under the ignored
`.build/commit-groups-cold-start/` directory. They require new approval, including
renewal of the two promotion merges for their final reviewed tree. Group numbers
42–43 are retained for the deferred merges; new corrective commits execute first,
in documentation, test infrastructure, tests and workflow order.

Groups 42 and 43 preserve all reviewed atomic commits. They introduce no additional
implementation, and both resulting trees must equal the newly approved feature
tree including groups 44–47. The merge messages identify branch promotion as
their sole responsibility.

## Execution conditions after approval

1. Commit and push only corrective groups 44–47 on the existing feature branch.
   PR #1 will receive fresh checks for that new head. Documentation group 41 has
   already been committed and pushed; do not recreate it.
2. Verify the PR head/tree, develop destination and latest PR-specific CI. Mark
   the draft ready and merge only after every applicable check succeeds. Abort
   for a changed source scope or an unexpected destination change.
3. Open the develop-to-release PR using the verified first merge result. Verify
   that its tree still equals the reviewed feature tree, that release remains at
   the reviewed baseline, and that its own latest checks succeed before merging.
4. Follow the actual release-push CI. Its package job must build a fresh Release
   ZIP, verify executable/version/source identity, and observe the real Windows
   window's Record / Transcribe file / Record navigation and normal close.

The workflow's native package job applies to an actual release push, so a feature
push or PR cannot complete T081. A missing interactive desktop or failed native
observation remains a failed acceptance result. Retain the diagnostics and obtain
the explicitly required approval for a trusted disposable interactive runner if
the hosted Windows runner lacks capability. Do not certify simulated controls
as a native observation.

These promotions stop at release. They do not authorize a release preparation,
version/changelog release entry, product tag or GitHub Release publication.
Trusted-main controller installation, required-check enforcement, reviewer
environment setup, full/warm acceptance and final security review remain pending.
The existing main-promotion rule continues to require the published candidate;
initial controller adoption needs its own bounded bootstrap review.

## Approval boundary

The user authorized branch creation, commits and pushes, but separately requires
review and approval of each proposed commit group before committing. Groups
44–47 remain proposals, and promotions 42–43 require approval of their changed
tree before execution. All 358 support tests and publisher boundary checks pass
locally; fresh hosted proof remains required. Approval of these corrections and
promotions does not authorize a product release or publication.
