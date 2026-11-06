# CI quality gates and release reference

This supports [the specification](../specs/003-ci-quality-release/spec.md), using
evidence inspected on 2026-11-05. CI and remote protections are not installed by
this documentation task.

## Confirmed flow

The user confirmed `feature/* -> develop -> release -> main`, with stable
version creation on the literal `release` branch, as in Avo. `main` receives the
same version. Branch operations remain user-owned.

| Stage | Expected result |
| --- | --- |
| Feature push / feature to develop | Validate; publish no version |
| Develop to release | Apply required checks and preserve semantic change history |
| Release push | Validate the actual branch commit; propose a version read-only |
| Confirmed completion | Prepare version/changelog metadata and an exact candidate |
| Final candidate | Validate versioned tree/package; request explicit execution authorization |
| Authorized release | Create annotated immutable tag and publish verified draft/package |
| Release to main | Validate promotion; retain the existing version |

This task chooses no release version and recommends no tag execution.

## Evidence and limits

Rustcorder was inspected on `main`, with existing staged UI/layout changes and a
separate transcription/speaker feature. It has a Windows desktop Cargo
application, no `.github/workflows` directory and no local tags. Local absence
does not establish remote tag history. The manifest declares `0.1.0`,
`publish = false`, edition 2024 and Rust 1.95; the pinned toolchain is
`1.95.0-x86_64-pc-windows-msvc`.

Current sources: [manifest](../Cargo.toml), [toolchain](../rust-toolchain.toml),
[build runner](../scripts/dev.ps1), [package runner](../scripts/package.ps1),
[UI](../src/ui.rs), [test registration](../tests/integration.rs),
[development](development.md) and [validation evidence](implementation-validation.md).

The Avo memory reference uses workspace `default`, project `joaobispo2077-avo`.
It records checkout commit `51f567c9d15e181613fdf16b77dd89923ac2b26e` on
`feature/avo-ways`, not a fresh CI measurement or remote protection audit:

- [Exact gate policy and mutation profiles](http://127.0.0.1:49374/web/w/default/joaobispo2077-avo/p/concepts/avo-quality-gates-configuration.md#scriptscimutation-configjson).
- [Workflow topology and release certification](http://127.0.0.1:49374/web/w/default/joaobispo2077-avo/p/procedures/avo-ci-quality-workflows.md).
- [Captured supporting workflows](http://127.0.0.1:49374/web/w/default/joaobispo2077-avo/p/concepts/avo-ci-supporting-workflows-source.md).

Avo's live `main` resolved to `906572af642432f25747d476d525a5bbaa88dbbf`.
Release configuration/workflow were re-read at that immutable revision and
matched the initial source reads:

- [Release configuration](https://github.com/joaobispo2077/avo/blob/906572af642432f25747d476d525a5bbaa88dbbf/release.config.mjs)
  selects only `release`, includes merged change history, updates changelog and
  project versions, and initially creates a draft release.
- [Release workflow](https://github.com/joaobispo2077/avo/blob/906572af642432f25747d476d525a5bbaa88dbbf/.github/workflows/release.yml)
  follows successful release-push CI or manual dispatch, calculates a dry-run
  version, carries a quality snapshot and checks version alignment.
- [CI workflow](https://github.com/joaobispo2077/avo/blob/main/.github/workflows/ci.yml)
  was read from `main`: feature/release pushes, PRs to develop/release/main,
  prerequisites, unit/integration, software quality, usability, light mutation,
  readiness and reports.

The GitHub connector fetch capability was unavailable. Browser access reached
the repository landing page but not requested source pages; read-only GitHub API
requests supplied the live source above. The memory snapshot is the evidence
for historical Avo thresholds. No Avo tests or live protection audits were run.

## Adapt controls to Rustcorder

| Avo control | Rustcorder requirement |
| --- | --- |
| Prerequisites / workflow lint | Pinned Windows/MSVC setup, CMake, libclang, locked dependencies and valid workflow definitions |
| Python/JS format and lint | Rust formatting/static analysis; validate any helper language actually introduced |
| Unit / integration jobs | Cheap logic and explicit process/filesystem boundaries; separate ignored external tests |
| Historical unit coverage floor 68% | Measure Rustcorder logic/UI and freeze its own positive baseline floor |
| Complexity / accepted debt | Function complexity limit 10; exact measured exceptions with reasons/owners |
| Dead code / duplication | Block unwaived unused code; at most 2% duplicated product lines with fixed scope/settings |
| Dependency audit / tree | Locked Rust advisories and reviewed source/license policy; advisory duplicate-version inventory |
| Import contracts | Enforce existing ownership; avoid application restructuring for a new gate |
| Light / full mutation | Explicit Rust populations, initial 40%/50% floors and complete accounting |
| Usability / runtime | Deterministic UI drawing/interactions plus actual packaged-desktop release smoke |
| Unified report | Readable and machine-readable run/attempt-bound evidence, including missing data |
| Release snapshot | Final candidate, matching package and explicit owner authorization |

The constitution's 90% cheap-unit target concerns test composition, not coverage.
Existing evidence leaves that ratio unaudited; test-file placement cannot prove
it. Coverage must include product logic and UI, state numerator/denominator,
selection/exclusions, and use raw percentages for decisions.

Complexity, duplication and mutation numbers are initial acceptance targets
adapted from the requested reference, not current passing Rustcorder scores.
Measure first, preserve failures, and review narrow existing debt. Rust analyzer
semantics must be documented rather than assuming Python measurements transfer.

Rust mutations that do not compile are not test detections. Report them
separately and exclude them from `detected + survived`; reconcile every generated
outcome. Timeouts remain incomplete. Zero viable mutations cannot establish a
passing score. Initial budgets are light 20 minutes, full 60 minutes, and a
45-minute warm-cache ordinary promotion path. These are targets to validate.

## Desktop proof

Existing egui tests draw actual interfaces, assert geometry at default/wide and
minimum/high-DPI sizes, and protect populated combined settings and Cancel while
stopping/saving. Reuse them and add deterministic navigation/action checks.

Drawing alone does not prove Windows window creation, accessibility, real
clipboard behavior or recording. Before release, require clean-environment
portable-app launch, both-screen navigation and shutdown. Missing interactive
desktop capability fails setup rather than becoming a skipped pass.

Ordinary CI uses synthetic audio, fake workers and temporary files. Large ASR
weights, private recordings and physical devices stay outside that path. Hosted
setup can obtain the 885,098-byte VAD from its
[pinned provenance](../assets/silero-vad.json) and verify its hash/license before
packaging. This must not introduce a product runtime downloader.

## Planning constraints

The [constitution](../.specify/memory/constitution.md),
[versioning](versioning.md) and [branching rules](branching.md) require completion
confirmation, explicit tag execution authorization and annotated immutable tags.
Matching Avo does not waive them. Update their descriptions of unimplemented
automation consistently when implementation is completed.

The requested semantic-release tooling may be CI-only, without becoming a
product runtime dependency. Cargo and lockfile project metadata need
stack-appropriate updates in place of Avo's package/pyproject helpers.

Stock semantic-release requires adaptation: the inspected
[upstream tag implementation](https://github.com/semantic-release/semantic-release/blob/master/lib/git.js)
creates tags without annotation arguments. Its
[branch configuration](https://semantic-release.org/foundation/workflow-configuration/)
does not itself enforce this project's approval/annotation policy. Planning must
establish an integration that never publishes lightweight tags; rewriting an
already published tag is prohibited.

Other requirements that Avo source alone cannot establish for Rustcorder:

- Earlier source checks cannot certify a later version-metadata commit. Validate
  the final versioned identity and retain both identities.
- Proposed-merge PR checks cannot alone certify a release tip.
- Manual dispatch must obey the same identity and authorization gates.
- Preview is read-only; actual version/changelog changes follow completion
  confirmation, and tag/publication follows explicit execution authorization.
- Stage package/notes/evidence in a draft before public publication.
- Main receives the same version; document user-performed synchronization back
  to development without automatic branch management.
- Inspect remote tags before confirming first-release behavior; a manifest
  version and no local tags cannot justify invented history or a default major.
- Configure and verify required checks and approvals remotely. Documentation
  alone cannot establish merge blocking.

## Tool feasibility and security references

These are candidates to verify during planning, not installed dependencies:

- [cargo-llvm-cov](https://github.com/taiki-e/cargo-llvm-cov#platform-support)
  documents Windows MSVC support; prove this project's native/binary coverage.
- [cargo-mutants](https://mutants.rs/) supports Rust mutation testing; calibrate
  populations, accounting and timing on the actual project.
- [cargo-audit](https://github.com/rustsec/rustsec/tree/main/cargo-audit) provides
  dependency-advisory checks.
- [cargo-deny](https://embarkstudios.github.io/cargo-deny/) covers advisories,
  bans, licenses and sources; avoid unnecessary duplication of overlapping checks.
- [GitHub workflow security](https://docs.github.com/en/actions/reference/security/secure-use)
  supports least privilege, immutable action identities and isolation of
  contribution code from privileged release execution.
- [GitHub deployment controls](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
  describe approval/concurrency mechanisms; verify actual repository availability
  and settings during implementation.

The baseline needs no architecture migration, dashboard service or automatic
branch manager. Preserve modules and reuse build/package entry points.
