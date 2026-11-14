# Versioning and releases

Product versions use MAJOR.MINOR.PATCH. Breaking changes increment MAJOR, including
0.x to 1.0.0; compatible features increment MINOR; fixes, performance improvements,
recognized reverts and release-documentation corrections increment PATCH. Ordinary
maintenance has no independent release impact. The product manifest remains 0.1.0
during this implementation. Constitution 2.0.0 is separate governance metadata.

Interactive release work still requires explicit completion confirmation before a
new entry/version recommendation, and explicit execution authorization for tags or
publication. Inspect actual published history first. Tags must be annotated and
published tags/assets immutable. Never invent historical changelog entries.

## Automatic release flow

The owner authorized fully automatic releases after gates, preserving Rustcorder's
rules with AVO's configured Angular changelog format. The controller is implemented
on trusted main; production activation remains disabled pending acceptance/setup.
The official pinned commit analyzer and notes generator run only in CI. They add
no Node runtime to the Rust application. See the [research](automated-semantic-release-research.md)
for the Rust-native alternatives and exact configuration comparison.

1. A merged develop-to-release PR produces source P. Its actual release-push CI
   must pass every required job, raw-evidence check and native package check.
2. Read-only Windows preparation computes the version from published annotated-tag
   ancestry and all real unreleased commits. Only root Cargo version tokens,
   CHANGELOG.md and docs/quality-metrics.md may change. Before/after Cargo graphs
   must agree apart from the root version. The snapshot names P as a baseline.
3. The isolated writer creates deterministic commit C with P as its only parent,
   persists an immutable intent artifact, then advances only the existing release
   ref without forcing. It runs no candidate scripts or Cargo with write credentials.
4. C must trigger and pass its own ordinary full CI, both light mutation lanes,
   version-matching Release ZIP and real native launch/navigation/close. P's proof
   cannot substitute. The authenticated token/App identity must match C's CI actor.
5. Trusted preflight freezes C, its artifacts, preparation, intent, exact attachment
   bytes and automatic policy. The independent publisher rechecks current evidence,
   creates an annotated tag, verifies draft uploads/downloads, then publishes.
   The enabled flow has no recurring environment reviewer or manual publish dispatch.

Bang headers and BREAKING CHANGE, BREAKING CHANGES, BREAKING and BREAKING-CHANGE
footers retain MAJOR behavior. docs(release) remains PATCH. Future entries use
dated linked Angular version headings and grouped changes; old published bytes
remain unchanged. Main promotion requires the exact published commit/tree/version
and never calculates or publishes another version.

## One-time owner setup

Install both controllers on main through the normal reviewed promotion process.
Configure a fine-grained repository token named GH_TOKEN with contents-write for
Rustcorder, matching AVO's secret name. The workflow resolves its numeric owner
identity rather than trusting a supplied login. The metadata push cannot use the
default job token because a normal new CI push run is required. Alternatively,
configure RELEASE_APP_CLIENT_ID and RELEASE_APP_PRIVATE_KEY for the pinned official
App action; its repository-scoped installation token is revoked by the action.
The publisher uses its own job token; the reporter receives no release credentials.

Set an explicit stable initial_version in scripts/ci/release-policy.json when no
published history exists. No version is inferred from the manifest. Keep
automation_enabled false until acceptance and owner activation. Missing/expired
credentials, incomplete rules or disabled policy cannot authorize a release.

## Retries and evidence

Matching partial tags/drafts/assets resume after fresh revalidation. Conflicting
versions, lightweight tags, different bytes or a changed release tip stop; nothing
is overwritten or repointed. An uncertain ref response is resolved by reading the
existing ref. Short metadata/publication locks never wait for C's later CI run.

New PRs above unpublished C recompute from the last published ancestry. Only
artifact-authenticated generated commits are excluded from impact; copied messages
remain real commits. Exact generated unpublished entries may be replaced, while a
human-edited conflicting entry requires explicit recovery. Every real unreleased
commit remains in the analysis. Reserved versions cannot be reassigned to a new C.
Expired unpublished provenance requires owner intervention. A trusted producer's
successful object/intent-upload steps can support recovery after a later failed
ref step; fresh full C proof is still mandatory.

Published attachments retain the preparation, intent, enabled policy, final quality
report/certification, package manifest/checksums and release notes. Per-control
authority/receipt audit artifacts retain the existing fourteen-day lifetime.
Local proof cannot certify real token permissions, GitHub triggers, native hosted
behavior or comment latency. See [implementation evidence](automated-semantic-release-validation.md)
and [branch setup](branching.md).
