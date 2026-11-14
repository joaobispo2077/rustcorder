# Automatic Release Implementation Plan

Date: **2026-11-14**. Local implementation is validated; hosted acceptance remains
pending and production activation stays disabled. The detailed
[Spec Kit plan](../specs/004-automated-semantic-release/plan.md),
[release contract](../specs/004-automated-semantic-release/contracts/release-automation.md)
and [report contract](../specs/004-automated-semantic-release/contracts/pr-quality-report.md)
define implementation and validation.

## Implemented reporting and credential decisions

The owner requested AVO's existing secret convention during implementation:
`secrets.GH_TOKEN` supplies only the bounded metadata writer. Its authenticated
numeric user ID/login are resolved through GitHub, frozen in the intent and matched
to the actual metadata-push CI actor. There is no fallback to the job token for
this push, because that would suppress the required new CI run. The planned
repository-scoped App remains optional when `RELEASE_APP_CLIENT_ID` and
`RELEASE_APP_PRIVATE_KEY` are supplied; its official token action is pinned.
Publication uses its own contents-write job token. Reporting receives no release
credential. The inspected origin listed no repository secret names; no secret was
created, copied or read. AVO's [release workflow](https://github.com/joaobispo2077/avo/blob/main/.github/workflows/release.yml)
references `GH_TOKEN`.

The reporter handles PRs targeting develop, release and main, including verified
forks. The upstream CI report remains preliminary. The trusted reporter reads
exact-attempt jobs and the separate final certification before displaying a pass.
Missing/invalid evidence stays incomplete; failed, cancelled and timed-out attempts
remain failed. Requested/in-progress callbacks replace old success with pending.
Older callbacks resolve the newest applicable run and compare attempt numbers only
within the same run. Only the fixed numeric GitHub Actions bot owns the leading
marker; human lookalikes are untouched. Per-PR serialization and pre/post-write
checks bound comment races. Closed reports name historical evidence.

Compact JSON is bounded to 1 MiB and rendered Markdown to 48 KiB. Links are built
from verified GitHub identities; text/mentions are escaped. Denied delivery retains
a readable job summary and delivery artifact without changing upstream readiness.
Real fork delivery, API races and report timing remain hosted acceptance work.

## Release flow

The lifecycle remains feature/* → develop → release → main. After an eligible
develop-to-release PR merges and the exact resulting commit passes all gates, the
trusted controller prepares the next version, changelog and quality baseline. A
narrowly scoped bot commits only that metadata to the existing release ref. That
commit gets its own full CI, package and native-window validation. Only then does
the existing publisher create its annotated tag and verified public release. Main
receives that published version without another bump.

There is no separate per-release completion confirmation or environment review.
One-time owner setup supplies the App credential, explicit initial-version setting
and compatible release rules. Governance/current guidance must align first. Ordinary
CI receives no write credentials; the metadata writer executes trusted controller
code only, and the publisher does not need the App key.

## Tool selection after research

The [deep research](automated-semantic-release-research.md) provisionally suggested
qualifying git-cliff first. Planning compared that option with the installed
controller and probed its configuration. **Keep the official semantic-release
analyzer/notes libraries for this feature**: they fit the existing evidence and
publishing boundary. A native replacement adds another tool and behavior to qualify.
The publishing core is not invoked.

Pin AVO's notes-generator/Angular versions and use its headings, sections, links
and sorting. Keep Rustcorder's bang-breaking and release-doc PATCH rules, add
AVO's three footer forms and retain the existing hyphenated alias. Release-doc
corrections appear in Bug Fixes. Small cloned notes-input conversions preserve
original commit hashes/messages; exact snapshots are required.

The selected-hook probe passed 15 classification cases and structural notes checks
with installed notes 14.1.0. Planned notes 14.1.1 still needs its pinned snapshot
suite. Native tools were assessed, not executed or rejected by failed tests.
git-cliff remains the preferred future native candidate; Release-plz's released
git-only mode remains a credible fuller alternative.

## PR reports

A separate trusted workflow maintains one owned quality comment on PRs targeting
develop, release and main. It shows the exact head/tested revision, final readiness,
gate results, measurements, thresholds, exclusions and evidence links. Pending/rerun
states replace previous success; older results cannot overwrite newer ones. Bot
identity as well as a marker establishes comment ownership.

The writer reads a small data-only projection, actual jobs and final certification.
It never runs candidate code with comment permission. Fork/service restrictions
retain the readable report and delivery explanation. A delivery outage cannot turn
failed gates green or invalidate upstream test results.

GitHub has no atomic head check on comment edits. Per-PR serialization, checks
before/after writes and exact-head wording provide reconciliation; immediate updates
during outages are not promised.

## Implementation order and recovery

Align governance/docs, pin reference fixtures, demonstrate failing tests, implement
small helpers, then wire trusted workflows and owner setup. Keep commits atomic
by functional scope; obtain approval of proposed groups before committing. Hosted
rehearsal uses a disposable repository and synthetic product, including real
App-triggered final CI and Windows native package proof.

Retries use a persisted intent tying the bot commit to validated preparation.
Matching partial publication resumes; conflicting tags/assets stop. Newer release
changes supersede older work without losing unreleased commits. Disabling adoption
and revoking the App credential stops new writes while preserving releases. Recovery
never moves published tags or replaces assets.

The next step is `/speckit-tasks`. No implementation, production release, remote
comment delivery or owner configuration was performed during planning.
