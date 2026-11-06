# CI promotion review

## Reviewed implementation

The user approved and pushed 40 atomic commits on feature/ci-quality-release,
ending at `49dee970193a774ef3b34625757414c50cfa6cbd`. Its
[complete CI run](https://github.com/joaobispo2077/rustcorder/actions/runs/42168293447)
passed, and all 17 applicable raw-evidence receipts and final readiness were
independently verified. See [hosted validation](ci-hosted-validation.md).

Draft [PR #1](https://github.com/joaobispo2077/rustcorder/pull/1) targets develop.
At review preparation, main, develop and release each pointed to
`8b200d21c07d668e2e492c68139970031b923c65`. This review proposes adding only the
documentation group below, then promoting that reviewed feature tree through
develop and release. Source changes outside this reviewed scope require a new
review. Product release approval remains separate.

## Proposed commits and purpose

| Group | Proposed Conventional Commit | Responsibility |
| --- | --- | --- |
| 41 | `docs(ci): record hosted readiness and promotion` | Record successful hosted evidence, current adoption status and this proposal |
| 42 | `chore(ci): promote quality foundation to develop` | Merge PR #1 after its current-head checks pass |
| 43 | `chore(ci): promote quality foundation to release` | Merge a subsequent develop-to-release PR after its current-head checks pass |

Group 41 contains only docs/ci-hosted-validation.md, docs/ci-promotion-review.md,
docs/commit-grouping-plan.md and specs/003-ci-quality-release/quickstart.md. Its
separate staging snapshot and patch are retained under the ignored
`.build/commit-groups-readiness/` directory for review.

Groups 42 and 43 are branch-promotion merge commits, preserving all previously
reviewed atomic commits rather than squashing their changes into one commit.
They introduce no additional implementation. Their expected trees are exactly
the reviewed feature tree including documentation group 41. The merge messages
above identify branch promotion as their sole responsibility.

## Execution conditions after approval

1. Commit and push only documentation group 41 on the existing feature branch.
   PR #1 will then receive fresh checks for that new head.
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
41–43 therefore remain proposals until that approval is received. A permitted
branch-promotion path is not evidence that a merge or product release was approved.
