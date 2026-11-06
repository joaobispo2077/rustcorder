# CI promotion review

## Completed promotions

All 45 approved feature commits are pushed through
e176912791cdb84ee2fee376bb97725d84c9f1ce. Their feature/PR CI passed and the
applicable raw receipts were independently verified. Groups 41 and 44–47 are
committed; do not recreate them.

Promotion group 42 merged [PR #1](https://github.com/joaobispo2077/rustcorder/pull/1)
to develop as 3dc4301ec3fa5a0ee491733c3ddc03be1b078226. Group 43 merged
[PR #2](https://github.com/joaobispo2077/rustcorder/pull/2) to release as
26d2742e5d9b80da77f54f4c51af21b300e3662c after its latest PR and associated
push checks passed. Both trees equal f8c2115cbec6c66033aec714d422cd52dfcd5763.
Main remains at 8b200d21c07d668e2e492c68139970031b923c65.

The owner authorized continuation to main and a one-time initial-controller
bootstrap exception for that tree. The normal published-candidate rule stays
intact. [PR #3](https://github.com/joaobispo2077/rustcorder/pull/3) remains draft
because actual release-push package acceptance failed when the real window
extended outside the capturable desktop. Main has not been merged.
See [hosted validation](ci-hosted-validation.md) for the exact retained evidence.

## Proposed correction and renewed promotions

| Group | Proposed Conventional Commit | Responsibility |
| --- | --- | --- |
| 48 | docs(ci): record native capture failure | Record promotions, failure and revised review |
| 49 | test(ci): cover bounded native window placement | Smaller/large desktops, negative origins and ownership refusal |
| 50 | ci(smoke): fit the owned window to the desktop | Fit the test-owned window before navigation; preserve strict capture and lifecycle checks |
| 51 | chore(ci): promote native smoke fix to develop | Next feature-to-develop merge after latest associated checks pass |
| 52 | chore(ci): promote native smoke fix to release | Next develop-to-release merge after latest associated checks pass |
| 53 | chore(ci): promote quality foundation to main | PR #3 after fresh native proof and renewed bootstrap conditions |

Group 48 contains docs/ci-hosted-validation.md, docs/ci-promotion-review.md,
docs/commit-grouping-plan.md and specs/003-ci-quality-release/quickstart.md.
Group 49 contains scripts/ci/tests/ui-smoke.test.ps1. Group 50 contains only
scripts/ci/ui-smoke.ps1. Separate cumulative indexes and patches are retained
under the ignored .build/commit-groups-native-placement/ directory. Tests precede
the adapter fix; push the complete reviewed sequence together.

The correction changes no product code, desktop resolution, engine budget or
quality floor. Geometry, native API ownership, smoke boundary, 358 support and
publisher checks pass locally. Corrected hosted native acceptance remains
unproved until the new tree is pushed.

## Execution conditions after approval

1. Commit and push groups 48–50 on the existing feature branch. Freeze their final
   tree in the review manifest; every promotion must retain that tree.
2. Open the next feature-to-develop PR. Verify source/destination SHAs, latest
   PR evidence, raw hashes, recomputed readiness and associated checks before
   merging with history preserved. The reviewed develop baseline is
   3dc4301ec3fa5a0ee491733c3ddc03be1b078226.
3. Repeat for develop-to-release. Its reviewed release baseline is
   26d2742e5d9b80da77f54f4c51af21b300e3662c.
4. Verify the new actual release-push CI: fresh Release ZIP, real PID-bound
   Record / Transcribe file / Record navigation, full-window screenshot and normal
   close. Missing capability or failed assertion still blocks main. Capture
   cropping and simulated native success remain forbidden.
5. Renew the bootstrap exception for this corrected tree, then verify PR #3's
   latest head and every other check. Only absent published-candidate policy and
   its dependent readiness failure may be excepted. Abort for any other failure,
   changed tree or destination movement. Main's reviewed baseline remains
   8b200d21c07d668e2e492c68139970031b923c65.
6. Merge to main preserving history, then verify main's own complete push CI.

If the hosted runner genuinely lacks desktop capability, retain the failure and
obtain the separately required approval for a trusted disposable interactive
runner. Do not use a persistent personal runner or certify simulated controls.

## Approval boundary

The user requires approval of each proposed commit group. Groups 48–53 await
approval; earlier approval covered the previous tree. The renewed main exception
is limited to initial controller installation and preserves future policy.
No version change, release entry, product tag or publication is included.
Timing/full runs, actual remote enforcement and remaining acceptance tasks stay
pending until proved.
