# Automated semantic release research

## Implementation clarification — 2026-11-14

The selected pinned hooks and Angular configuration are now implemented and locally fixture-qualified. Production remains disabled; the implementation evidence records the remaining hosted limits. The comparison below retains its original research scope.

Research date: **2026-11-14**. Scope: the proposed
[automated release and PR reporting feature](../specs/004-automated-semantic-release/spec.md).
This document compares the actual AVO configuration with Rust tooling and the
existing Rustcorder release foundation. The selected hooks now pass local semantic
and notes fixtures; no product runtime dependency was added. Hosted acceptance and
activation remain separate, as recorded in the implementation evidence.

## Recommendation

Qualify **git-cliff / git-cliff-core first**, as the version-analysis and changelog
component inside Rustcorder's existing validated release flow. Its explicit
zero-major bump controls and configurable output make it a promising fit without
replacing the current source, artifact and publication checks. This is an inference
from the capabilities and gaps below, not a claim of demonstrated parity.

**Release-plz is the strongest fuller Rust alternative**. Its released git-only
mode supports desktop/private packages without crates.io, so it deserves a real
comparison rather than dismissal as registry-only. It introduces more orchestration
to qualify. Keep Rustcorder's configured semantic-release hooks as the reference
and fallback if a native candidate needs more custom behavior than it removes.

The language of the product does not require rewriting its working release
controller. Neither candidate alone supplies Rustcorder's complete quality-evidence,
native-package and PR-comment contract. Tool choice belongs to planning after a
small, isolated parity exercise.

## AVO's checked-in configuration is the baseline

Inspected AVO at commit **76d70116f72ccec2fb559ba06eb2fa5b8ea62f27**, including the
[specific release configuration](https://github.com/joaobispo2077/avo/blob/76d70116f72ccec2fb559ba06eb2fa5b8ea62f27/release.config.mjs).
This is a pinned comparison point, not a claim that a moving branch will remain
unchanged.

| Actual AVO setting or step | Meaning for Rustcorder |
| --- | --- |
| Only `release` is a release branch | Publish after validated changes land in release; main promotion retains the version. |
| Angular analyzer and notes preset | Match this configured behavior and output rather than generic Conventional Commits defaults. |
| Three note keywords: `BREAKING CHANGE`, `BREAKING CHANGES`, `BREAKING` | Recognize all three, plus Rustcorder's approved bang-header rule. |
| `firstParent: false` | Analyze newly reachable merged history; a nonfunctional merge title must not hide a feature or breaking child commit. |
| Notes sort by subject, then scope | Snapshot this order alongside sections, scopes, dates and links. |
| Changelog plugin plus custom package and Python version writers | Update Rustcorder's approved Cargo version fields; these plugins are manifest writers, not npm/PyPI publication. |
| GitHub draft release | Public publication waits for validated deliverables. |
| Git plugin commits changelog, manifests and quality snapshots | Preserve bounded metadata writes and traceability; do not rewrite source or dependency resolutions. |
| Generated `chore(release)` version commit includes notes | Treat authenticated generated metadata as continuation of the candidate, not another release trigger. |

The custom [package writer](https://github.com/joaobispo2077/avo/blob/76d70116f72ccec2fb559ba06eb2fa5b8ea62f27/scripts/ci/semantic-release-package-version.mjs)
and [Python writer](https://github.com/joaobispo2077/avo/blob/76d70116f72ccec2fb559ba06eb2fa5b8ea62f27/scripts/ci/semantic-release-pyproject-version.mjs)
explain why installing a similarly named Cargo plugin would not reproduce AVO's
configuration by itself.

AVO's [release workflow](https://github.com/joaobispo2077/avo/blob/76d70116f72ccec2fb559ba06eb2fa5b8ea62f27/.github/workflows/release.yml)
reacts to a successful **release-branch push CI result**, selects a version, checks
the associated quality report, snapshots metrics, and prepares the version/tag/draft.
It dispatches packaging. The [binary workflow](https://github.com/joaobispo2077/avo/blob/76d70116f72ccec2fb559ba06eb2fa5b8ea62f27/.github/workflows/engine-binary.yml)
runs archive smoke checks, attaches binaries/checksums, then makes the draft public.
An open PR turning green is therefore not the publication trigger.

The observed [CHANGELOG](https://github.com/joaobispo2077/avo/blob/76d70116f72ccec2fb559ba06eb2fa5b8ea62f27/CHANGELOG.md)
has newest-first dated version headings, predecessor comparison links, scoped
subjects and short commit links. Major/minor entries use a level-one heading;
patch entries use level two. Sections include Bug Fixes, Features and Performance
Improvements; breaking notes belong in BREAKING CHANGES when applicable. This is
Angular-style generated output, rather than an Added/Changed/Fixed template.
Rustcorder will preserve old published entries and adopt this style for future ones.

AVO's [CI reporting](https://github.com/joaobispo2077/avo/blob/76d70116f72ccec2fb559ba06eb2fa5b8ea62f27/.github/workflows/ci.yml)
builds a unified report, checks PR freshness, and supplies readable fallbacks when
delivery fails. Its sticky-comment header includes the run ID: that is a per-run
identity, not one persistent report across every run on a PR. Rustcorder's proposed
one-current-owned-comment rule is an explicit improvement. Older run history stays
in evidence; stale success cannot replace a newer failure. Report construction
failure remains significant even though comment transport can fail independently.

AVO's asset attachment uses an overwrite option. Rustcorder must retain its own
published-asset immutability rule instead of copying that detail. Likewise, final
Rustcorder metadata must receive fresh CI and native proof before tagging; the
reference's draft orchestration is not evidence that a different commit was tested.

## Executed configuration probe and approved differences

An isolated, read-only probe used the installed official commit-analyzer **13.0.1**
and Angular preset **8.3.1**, matching the inspected AVO lockfile. The known analyzer
options were supplied as data; upstream configuration/plugins were not executed.
The same messages were evaluated against Rustcorder's existing configured analyzer.
These are classification results, not a full release rehearsal.

| Commit fixture | Exact AVO configuration | Current Rustcorder | Agreed target |
| --- | --- | --- | --- |
| `feat(core): …` | MINOR | MINOR | MINOR |
| `fix(core): …` | PATCH | PATCH | PATCH |
| `perf(core): …` | PATCH | PATCH | PATCH |
| Ordinary `docs: …` | No release | No release | No release |
| `docs(release): …` | No release | PATCH | PATCH |
| Generated `chore(release): …` | No release | No release | No recursive bump |
| Nonbreaking `refactor: …` | No release | No release | No release |
| Bang-only `feat(core)!: …` | No release | MAJOR | MAJOR |
| Standard `BREAKING CHANGE` footer | MAJOR | MAJOR | MAJOR |
| `BREAKING CHANGES` footer | MAJOR | PATCH in the fix fixture | MAJOR |
| `BREAKING` footer | MAJOR | PATCH in the fix fixture | MAJOR |
| Breaking docs with standard footer | MAJOR | MAJOR | MAJOR |
| Recognized revert with original commit identity | PATCH | PATCH | PATCH |

The user chose **preserve Rustcorder rules with AVO format**. Therefore exact AVO
edge-case equality is intentionally rejected for bang headers and release docs;
the extra footer spellings are added to the target. The highest releasable impact
wins, including MAJOR for a breaking change while the product is still at 0.x.
Ordinary nonbreaking maintenance alone produces no release.

The local notes generator is **14.1.0**, while the inspected AVO lockfile records
**14.1.1**. Consequently this probe establishes the analyzer differences only.
Exact rendered Markdown parity still needs snapshots using the pinned reference
notes generator, fixed dates, repository URLs and synthetic commit identities.

## Rust candidates

Versions below were verified against the publishers' latest GitHub releases on
the research date. They identify examined releases, not dependency selections.

| Candidate | Verified release | Suitable responsibility | Main qualification gap |
| --- | --- | --- | --- |
| git-cliff / git-cliff-core | [2.14.2, Sep 18](https://github.com/orhun/git-cliff/releases/tag/v2.14.2) | Commit analysis and configurable changelog, CLI or reusable library | Scoped no-release rules, custom footers/reverts and exact AVO output need proof. |
| Release-plz | [0.4.3, Nov 2](https://github.com/release-plz/release-plz/releases/tag/release-plz-v0.4.3) | Cargo versions, changelogs, release PRs and git/forge releases | Needs a controlled path fitting final-commit gates without a second human release PR. |
| cargo-release | [1.1.7, Oct 21](https://github.com/crate-ci/cargo-release/releases/tag/v1.1.7) | Cargo metadata and separable release operations | Needs an external commit classifier and notes generator. |
| Cocogitto | [7.0.0, Mar 4](https://github.com/cocogitto/cocogitto/releases/tag/7.0.0) | Conventional-commit versioning, changelog, hooks and tags | Documented automatic 0.x behavior conflicts with the required breaking MAJOR rule. |

### git-cliff and git-cliff-core

The [bump configuration](https://git-cliff.org/docs/configuration/bump/) exposes
feature-always-MINOR, breaking-always-MAJOR including 0→1, and an explicit initial
tag. Those controls align with the required numeric policy. Its exclusion regex
matches **commit type**, so excluding all docs would also suppress the required
`docs(release)` PATCH; this is not a proven configuration-only replacement.

The [commit processing configuration](https://git-cliff.org/docs/configuration/git/)
supports preprocessing, conventional parsing, grouping and links. A small controlled
normalization/classification step may cover scoped exceptions and the extra footer
forms, but must preserve original notes and identifiers. Test breaking notes on
otherwise ignored types and recognized revert behavior before accepting it.

[Templates](https://git-cliff.org/docs/templating/examples/) can express the AVO
heading/section/link arrangement. The existence of templates does not prove identical
ordering, escaping, revert cancellation or byte-preserving changelog insertion.
The tool does not by itself update all manifests, coordinate final CI, publish
certified desktop assets or maintain Rustcorder's PR quality comment.

The [2.14.2 core manifest](https://github.com/orhun/git-cliff/blob/v2.14.2/git-cliff-core/Cargo.toml)
confirms a reusable Rust library with MSRV 1.88.0, below Rustcorder's pinned 1.95.0.
That establishes compiler-version compatibility only. Repository access is a
default feature; remote-provider/network support is optional. The core also uses
`git-conventional` and `semver`: those are useful parser/version building blocks,
not complete release systems. Planning should compare the pinned CLI with a small
CI-only core integration before adding any library to the desktop application's
runtime dependencies.

### Release-plz

[Git-only configuration](https://release-plz.dev/docs/config#the-git_only-field)
uses tags as its version baseline, skips registry publication and supports
`publish = false` packages. The [0.4.3 git-only integration tests](https://github.com/release-plz/release-plz/blob/release-plz-v0.4.3/crates/release_plz/tests/all/git_only.rs)
confirm that this is a released capability, not merely an unreleased documentation
promise. Those tests were read, not run here.

Its [update command](https://release-plz.dev/docs/usage/update) prepares versions
and changelogs; the separate release operations make a staged integration plausible.
Using update inside a bounded controller could avoid introducing another
human-approved metadata PR. Its normal release-PR workflow is a different user
flow from automatically continuing a maintainer's merged release PR.

Additional [configuration](https://release-plz.dev/docs/config) supports draft
releases and custom changelogs. Feature-MINOR behavior before 1.0 requires explicit
configuration. Custom major/minor regexes match conventional commit **types**, not
arbitrary footer text; they do not alone prove the three-keyword rule. Disabling
general dependency updates still permits a workspace lock update, so unchanged
dependency resolution must be verified rather than assumed. Default changelog
presentation also differs from AVO.

The pinned [release implementation](https://github.com/release-plz/release-plz/blob/release-plz-v0.4.3/crates/release_plz_core/src/command/release.rs)
selects either a local signed-tag path or provider tag creation. The local path
uses the [git wrapper](https://github.com/release-plz/release-plz/blob/release-plz-v0.4.3/crates/git_cmd/src/lib.rs)
with a tag message. This does not establish the object type of every provider path:
qualification must inspect the resulting annotated tag object for the chosen mode.
Zero-major breaking decisions, bounded writes, stale-source refusal and native
proof before public publication remain required acceptance tests.

### cargo-release

The [1.1.7 reference](https://github.com/crate-ci/cargo-release/blob/v1.1.7/docs/reference.md)
documents separate version, replacement, hook, commit, publish, tag and push steps,
with dry-run as the default. It accepts an explicit version or increment level;
it does not replace AVO's commit-impact analyzer. Changelog production requires
another component. A nonempty tag message creates an annotated tag; an empty one
creates a lightweight tag.

It could handle only the metadata stage if that reduces existing code. Running
the complete release command would not establish Rustcorder's required pause for
fresh final-version CI. Workspace/dependent-version mutations also need checks.
There is no reason to add it merely to replace a small existing bounded writer.

### Cocogitto and narrower packages

[Cocogitto's automatic bump guide](https://docs.cocogitto.io/guide/bump) describes
analysis, hooks, changelog, version commit and tag as one sequence. It explicitly
keeps automatic 0.y.z bumps below 1.0.0 even for breaking changes. That conflicts
with the chosen policy. Explicit-major orchestration could work around it, but
would no longer be a direct replacement for its automatic decisions. Templates
and custom commit types do not remove the need for footer, scope and final-CI
qualification. It is therefore a lower-priority option for this feature.

[semantic-release-cargo](https://github.com/semantic-release-cargo/semantic-release-cargo)
is a Rust integration **with** the existing semantic-release engine. It documents
both registry publishing and preparing versioned binaries, so it is not solely
a crates.io publisher. Its documented platform tables omit Windows. It may be an
adapter candidate if retaining that engine, but it does not replace the analyzer,
notes generator or Rustcorder's evidence/publisher boundaries. No claim of Windows
incompatibility was established; support would need testing.

[semantic-release-rust](https://docs.rs/crate/semantic-release-rust/1.0.0-alpha.8)
similarly delegates analysis to semantic-release and documents registry-token
verification. [cargo-semantic-release](https://docs.rs/crate/cargo-semantic-release/1.0.0)
documents Gitmoji analysis and version recommendations, which does not establish
AVO's configured Conventional Commits and publishing behavior. Neither was
qualified as a full alternative. The [semver library](https://docs.rs/semver/latest/semver/)
parses and compares versions; it supplies no commit-to-impact or publication policy.

## Integration boundaries that remain necessary

Rustcorder already has bounded preparation and a publisher that checks exact
source, attempts, packages and native acceptance. See the current
[release controller](../scripts/ci/release.mjs), [release workflow](../.github/workflows/release.yml),
[CI workflow](../.github/workflows/ci.yml) and [versioning guide](versioning.md).
Those currently describe manual preparation/publication; this feature proposes
automatic continuation while retaining their integrity checks.

The candidate flow is: eligible merged release change → complete source gates →
bounded version/changelog/quality metadata commit → **fresh validation of that
commit** → annotated tag and verified public release. Release-to-main promotion
retains the published version. Retries resume identical state; changed tips,
newer attempts and conflicting published records stop superseded work.

A push made with the repository `GITHUB_TOKEN` does **not** start another push
workflow. Explicit dispatch can start validation; an appropriately scoped App
installation token is another option. Current GitHub documentation also describes
approval-required runs for certain PR events created with `GITHUB_TOKEN`, which
would undermine a fully automatic design if relied upon. Planning must select an
authorized trigger path and prove that the generated commit actually ran every
required gate. [GitHub workflow-trigger documentation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

A privileged completion workflow must treat PR reports and artifacts as data,
validate their source/run/attempt and bound its writes. It must not execute
untrusted candidate code with publication credentials. This matters particularly
for [workflow-run triggered workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).
Report delivery needs its own verified PR identity and limited comment authority;
it must never confer release authority. Forks without write permission retain
the readable run/artifact fallback.

## Qualification before selecting a tool

| Area | Required evidence |
| --- | --- |
| Commit semantics | All thirteen probed fixtures, each breaking marker on ignored types, combined highest-impact histories, zero-major rules and recognized revert/cancellation cases. |
| Reachability | Nonfunctional merge titles with releasable child commits, multiple merged PRs, missing/shallow history and last published ancestor selection. |
| Initial adoption | Explicit initial version, no fabricated history, and refusal when adoption settings or ancestry are ambiguous. |
| Changelog | Fixed-date snapshots against the pinned configured reference: heading levels, subject/scope order, sections, compare/commit links, escaping and preserved old bytes; document the approved release-doc extension. |
| Metadata | Only approved application version fields, root lock entry and bounded notes/quality snapshots change; no dependency/source drift. |
| Publication | Final metadata commit gets fresh quality/package/native proof; inspect annotated tag objects and exact asset/version/checksum identities. |
| Recovery | Duplicates, interruption after each write, conflicting tags/assets, superseded tips and self-generated metadata cannot create duplicate or recursive releases. |
| PR reports | Success/failure/incomplete/excluded gates, two heads and three attempts, stale completion, deleted owned comment, malformed data and forbidden delivery. |
| Hosted setup | Owner-authorized token/branch rules, actual generated-commit triggers, no per-release approval and no credential exposure to PR code. |

## Decisions and evidence limits

The user approved **fully automatic release after gates**, and **Rustcorder rules
with AVO format**. Before activation, planning must align the constitution and
derived release guidance with that bounded authorization. Annotated immutable tags,
published history and normal user ownership of branch operations remain required.
Specification approval does not create a product release or authorize one during
this research task.

The AVO sources and native project documentation/source were inspected; the
official existing analyzer was probed. No native candidate was installed,
compiled, benchmarked or run through an end-to-end release. No claim of native
semantic/output parity or hosted acceptance is made. The notes-generator version
difference above remains a concrete qualification gap.

The linked ai-memory service at `127.0.0.1:49374` was unavailable with a connection
refused response. The GitHub connector was unavailable to this session, so public
repository sources were read through GitHub's API instead. No knowledge was
invented from the inaccessible memory page. Existing transcription/speaker work
is outside scope and is checked for preservation separately.
