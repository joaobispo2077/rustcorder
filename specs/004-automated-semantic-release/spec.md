# Feature Specification: Automated Semantic Releases and PR Quality Reports

**Feature Branch**: `feature/transcription-speaker-insights`

**Created**: 2026-11-14

**Status**: Draft — requirements validated; ready for planning

**Input**: User description: "Set up automated semantic releases in Rustcorder similar to AVO: automatically create versions after release-branch PRs pass all gates and publish quality reports as PR comments. Deeply research Rust packages/libraries against AVO's actual release.config.mjs, semantic rules and CHANGELOG publishing pattern."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Receive a release after an eligible change passes validation (Priority: P1)

As a maintainer, I want merging an eligible PR into release to start automatic
versioning and publication, so I do not repeat version preparation, tagging and
publication approvals after the agreed quality checks succeed.

**Why this priority**: The existing flow stops at a proposal and requires manual
preparation/publication; removing that handoff is the primary requested change.

**Independent Test**: Merge a releasable change into release in an isolated
rehearsal. Observe one version update, its own successful validation, an annotated
tag and a published release with matching tested assets, without another human
action after the merge.

**Acceptance Scenarios**:

1. **Given** an eligible PR is merged into release and its exact resulting commit
   passes every applicable gate, **When** automation evaluates the new changes,
   **Then** it records the next version and changelog automatically.
2. **Given** the version update creates a new commit, **When** that commit receives
   its own successful quality, package and actual native-window validation,
   **Then** automation creates its annotated tag and publishes the verified assets.
3. **Given** a PR is still open, targets another branch, or has only PR validation,
   **When** those checks succeed, **Then** no product version is published.
4. **Given** any required check fails, is cancelled, times out or lacks evidence,
   **When** release eligibility is evaluated, **Then** publication is blocked and
   the missing or failed condition is visible.
5. **Given** automation cannot write the bounded version update under repository
   permissions, **When** it attempts that step, **Then** it stops with an actionable
   reason and does not bypass protection or publish a different commit.

---

### User Story 2 - Read the quality result directly on a PR (Priority: P1)

As a contributor or reviewer, I want a readable quality report in the PR
conversation, so I can understand the gate decisions without searching job logs.

**Why this priority**: This is the second explicit user outcome and is useful
independently of automatic publication.

**Independent Test**: Run passing, failing and incomplete PR validation. Verify
the conversation reports the correct current result, counts, thresholds and
evidence links, with a visible fallback when comment delivery is unavailable.

**Acceptance Scenarios**:

1. **Given** a PR targets develop, release or main, **When** its current validation
   finishes, **Then** its automation-owned comment identifies the PR head, tested
   revision, run/attempt, overall readiness and each applicable gate result.
2. **Given** a gate fails or cannot complete, **When** a report is available,
   **Then** the comment shows failure or incompleteness rather than a green result.
3. **Given** a newer head or attempt supersedes an older result, **When** reporting
   processes either result, **Then** an older success cannot replace the newer
   state; there is at most one current automation-owned report comment per PR.
4. **Given** a fork or permission/service failure prevents commenting, **When**
   reporting completes, **Then** the readable report remains available with the
   run evidence and the delivery limitation is visible.
5. **Given** a gate does not apply to this PR event, **When** the report is shown,
   **Then** it explains the exclusion instead of claiming that gate passed.

---

### User Story 3 - Keep predictable version and changelog semantics (Priority: P1)

As a release consumer, I want the version and changelog to follow the agreed
commit rules and AVO presentation, so the impact and contents of each release
remain predictable even when different release tooling is used.

**Why this priority**: Similar tool names or defaults do not establish equivalent
behavior; AVO has a specific configuration and Rustcorder has approved extensions.

**Independent Test**: Compare a shared corpus of commit histories and changelog
expectations against the configured reference and the chosen release processor.

**Acceptance Scenarios**:

1. **Given** unreleased fixes, performance improvements, features or breaking
   changes, **When** the next version is selected, **Then** the highest applicable
   PATCH, MINOR or MAJOR impact wins across all newly reachable merged commits.
2. **Given** a bang-only breaking header or a BREAKING CHANGE, BREAKING CHANGES
   or BREAKING footer, **When** impact is selected, **Then** it is MAJOR, including
   transition from a zero-major version to the next major version.
3. **Given** a release-documentation correction, **When** impact is selected,
   **Then** it is PATCH; ordinary documentation, test, refactor, CI and maintenance
   changes without a breaking marker do not create a release by themselves.
4. **Given** a releasable history, **When** its changelog entry is generated,
   **Then** the entry uses AVO-style dated version headings, meaningful grouped
   changes, scopes and traceable commit/change links; old published entries remain
   unchanged and no earlier release history is invented.
5. **Given** no published release exists, **When** the first eligible release is
   processed, **Then** it uses the explicitly configured initial product version,
   records a first-release entry and does not infer a different starting version.

---

### User Story 4 - Recover safely from retries and concurrent changes (Priority: P2)

As a maintainer, I want repeated events and interrupted runs to converge on the
same release, so retries do not create extra versions or replace published bytes.

**Why this priority**: Automatic writes must remain reliable without per-run
manual supervision.

**Independent Test**: Deliver duplicate completion events, advance the release
tip during processing, and interrupt after version, tag, draft and asset steps.

**Acceptance Scenarios**:

1. **Given** the same eligible change is processed repeatedly, **When** retries
   complete, **Then** there is one version update, one changelog entry, one tag
   and one published release for that candidate.
2. **Given** a newer change advances release before publication, **When** the
   older candidate is rechecked, **Then** its publication is stopped; subsequent
   evaluation includes all still-unreleased changes without losing either PR.
3. **Given** the automation's own version commit passes validation, **When**
   completion is handled, **Then** it completes that candidate rather than
   starting another version bump or an endless validation/release loop.
4. **Given** a partial draft/tag/asset state, **When** automation retries,
   **Then** it resumes identical verified state or refuses conflicting state;
   published tags and release assets are never overwritten.

---

### User Story 5 - Preserve release trust and normal branch ownership (Priority: P2)

As the repository owner, I want automatic release authority limited to validated
release changes, so untrusted contributions and reporting cannot gain publication
power and main continues to receive the same published product version.

**Why this priority**: Automation replaces a manual authorization step while
retaining the existing evidence and integrity boundaries.

**Independent Test**: Substitute source/evidence identities, attempt writes from
untrusted contributions, and promote an already published candidate to main.

**Acceptance Scenarios**:

1. **Given** unrelated, expired, substituted or stale evidence, **When** it is
   supplied to release processing, **Then** no version is published.
2. **Given** an untrusted PR or report payload, **When** it is validated or shown,
   **Then** it cannot execute with release authority or alter release records.
3. **Given** an already published release is promoted to main, **When** main is
   validated, **Then** it retains that version and creates no second release.

### Edge Cases

- A successful PR validation precedes a merge whose resulting commit fails.
- All code gates pass, but evidence/report construction or native package proof fails.
- A stale successful attempt finishes after a newer failed or cancelled attempt.
- Multiple eligible PRs or release jobs race with the automated metadata update.
- An unpublished metadata version exists when another change becomes eligible.
- History contains merged features, recognized reverts, zero-major versions,
  several breaking-footer spellings, or only generated metadata changes.
- A tag name already exists with a different object, version, commit or bytes.
- Publication stops after a tag, draft or partial asset upload.
- Report data is oversized, malformed, stale, or contains unsafe markup/links.
- Comment permission is unavailable, the PR closes or changes head during delivery,
  or the prior automation-owned comment was removed.
- A branch rule or credential prevents metadata writes or subsequent validation.
- The initial version or prior release ancestry cannot be established reliably.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Preserve feature/* → develop → release → main. Automatic product
  releases MUST originate from eligible changes merged into release in this
  repository; passing an open PR alone MUST NOT authorize publication.
- **FR-002**: Before selecting a releasable candidate, require the exact current
  release result to pass every applicable existing gate with complete evidence.
  Failure, cancellation, timeout, missing evidence or stale attempts MUST block it.
- **FR-003**: After one-time owner setup, eligible merge plus successful required
  validation MUST authorize automatic version preparation, tagging and publication
  without a separate per-release completion confirmation or reviewer approval.
- **FR-004**: Select the highest impact since the last published ancestor:
  breaking changes MAJOR, compatible features MINOR, compatible fixes/performance
  improvements/recognized reverts and release-documentation corrections PATCH.
- **FR-005**: Recognize bang breaking headers and the three approved footer
  keywords: BREAKING CHANGE, BREAKING CHANGES and BREAKING. A breaking change MUST
  increment MAJOR even when the current major version is zero.
- **FR-006**: Nonbreaking ordinary docs, tests, refactors, CI and maintenance
  changes MUST produce an explicit no-release outcome. Authenticated generated
  release metadata MUST NOT independently trigger another version.
- **FR-007**: Bootstrap MUST use an explicit initial-version setting established
  at adoption; missing/ambiguous history or configuration MUST stop with a reason.
- **FR-008**: Automatically update only the approved application-version
  declarations, root application lock entry, new release notes and bounded quality
  snapshot. Product source, dependency resolutions and unrelated files MUST remain
  unchanged. Unpublished metadata may be reconciled; published history is immutable.
- **FR-009**: New changelog entries MUST match AVO's presentation contract: newest
  release first, dated version heading, comparison link when a predecessor exists,
  grouped Features/Bug Fixes/Performance Improvements/BREAKING CHANGES as applicable,
  useful scopes/subjects, subject-then-scope ordering and traceable changes. Heading
  levels MUST follow the reference's major/minor versus patch convention. Approved
  release-documentation corrections MUST also be described. Existing published
  entries MUST be preserved.
- **FR-010**: A generated version commit MUST receive its own full applicable
  validation and version-matching package/native proof. Earlier source checks or
  a skipped validation trigger MUST NOT certify the changed commit.
- **FR-011**: Only after that final proof, automatically create an annotated
  vMAJOR.MINOR.PATCH tag and publish a release whose version, source, notes,
  checksums, quality evidence and tested package agree. Do not publish to a package
  registry or add prerelease channels as part of this feature.
- **FR-012**: Recheck current source, evidence freshness and intended release
  identity before each externally visible release write. A changed tip or newer
  attempt MUST invalidate superseded publication work.
- **FR-013**: Duplicate events and retries MUST converge on one release per
  candidate. Conflicting existing tags, notes or assets MUST be refused; matching
  partial state may resume without overwriting published records.
- **FR-014**: Serialize competing publication decisions and retain all still-
  unreleased changes. Automated version commits MUST complete their own candidate
  rather than cause recursive release or validation loops.
- **FR-015**: Promotion from release to main MUST retain the already published
  product version and introduce no additional version or publication.
- **FR-016**: Publish a readable quality comment for PR validation targeting
  develop, release and main, covering success, failure and incomplete results
  whenever available. Direct-push reports MUST remain available through run and
  release evidence without inventing a PR association.
- **FR-017**: The comment MUST identify the PR head and tested revision, run and
  attempt, overall readiness, named gate states, available counts/measurements,
  thresholds, exclusion reasons and links to full evidence. Distinguish test
  failure, unavailable evidence and comment-delivery failure.
- **FR-018**: Maintain at most one current automation-owned report comment per PR.
  Updates MUST verify current PR identity/head/attempt, never replace newer results
  with older success, and leave human or unrelated automation comments untouched.
  Superseded results MUST not be presented as current approval.
- **FR-019**: If comment publication is forbidden or unavailable, retain a readable
  report in run evidence and visibly explain delivery status. Delivery failure
  alone MUST NOT change a valid gate decision; failed report construction MUST
  remain a failure under the existing readiness policy.
- **FR-020**: Untrusted contributions, report contents and validation artifacts
  MUST NOT gain release-write authority. Reporting authority MUST be bounded to
  the verified PR and release authority to the verified release candidate.
- **FR-021**: Candidate assessment MUST demonstrate the approved semantic and
  changelog behavior against shared fixtures; compatible terminology or package
  defaults alone MUST NOT count as equivalence. Rust-native tooling research MUST
  be available to planning with capabilities, gaps and evidence limits identified.
- **FR-022**: Before activation, governance and release guidance MUST reflect the
  user-approved automatic authorization model and AVO-style future entries while
  retaining annotated tags, immutable publication, source validation and normal
  user ownership of branch operations. There MUST be no conflicting manual-only rule.
- **FR-023**: Release and reporting outcomes MUST remain auditable by version,
  source revision, originating PR where applicable, validation run/attempt and
  evidence. Missing owner setup, denied writes and resumable failure MUST be
  distinguishable from a successful no-release result.

### Key Entities *(include if feature involves data)*

- **Eligible release change**: merged PR and resulting release revision, its
  ancestry and current complete validation; distinct from an unmerged PR head.
- **Version decision**: prior published version, analyzed changes, impact,
  next version or no-release result, and initial-version configuration if needed.
- **Release candidate**: version metadata commit, origin, exact validation
  identity, tested package, notes, checksums and quality snapshot.
- **Published release**: immutable annotated tag, matching public release and
  verified assets, with a traceable relation to its candidate.
- **PR quality report**: current PR/run identity, gate states, measurements,
  evidence links, owned comment identity and delivery status.
- **Release attempt**: processing identity and observed partial/completed state
  used to deduplicate retries, detect conflicts and supersede stale candidates.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An eligible merged-change rehearsal produces exactly one aligned
  version/changelog update, annotated tag and published verified package without
  any human action after merge and successful validation.
- **SC-002**: Every failed, incomplete, stale, foreign-source or mismatched-asset
  acceptance case produces zero product publications.
- **SC-003**: Every approved version-rule fixture, including merged history,
  zero-major breaking changes, three footer keywords, release docs, recognized
  reverts and no-release changes, produces the expected decision; changelog
  fixtures preserve grouping, links, dates and prior published history.
- **SC-004**: Three reruns and five duplicate completion events for one candidate
  still produce one version update, one entry, one tag and one public release.
- **SC-005**: In representative runs with service/permissions available, at least
  95% of terminal PR reports appear in the conversation within five minutes of
  their conclusive quality result, with at most one current owned report per PR.
- **SC-006**: Two successive PR heads and three attempts cannot leave an older
  success presented as the current report; delivery-refusal scenarios retain a
  readable fallback and a visible delivery explanation in every case.
- **SC-007**: Final-package validation proves that the published binary reports
  the selected product version and its files/checksums match the certified
  candidate; earlier-commit evidence cannot satisfy this condition.
- **SC-008**: All preservation cases retain published history/tags/assets and
  unrelated product/dependency content; promoting a published version to main
  creates zero additional releases.

## Assumptions

- A release means the existing stable desktop-product delivery on GitHub, with
  the existing platform/package scope. Registry publication, additional platforms,
  automatic PR merging and new prerelease channels are out of scope.
- Reports cover the PR targets already handled by CI. Existing quality floors,
  gate applicability, mutation profiles, native proof and evidence retention remain
  authoritative; this feature changes orchestration and delivery, not thresholds.
- AVO's checked-in configuration and observed output are the comparison baseline.
  The explicitly approved Rustcorder rule differences are intentional, not claimed
  byte-for-byte copies of AVO's parser behavior. Only future entries adopt its style.
- Owner provisioning of narrowly scoped automation authority and compatible branch
  rules is required before enabling writes. These prerequisites do not reintroduce
  an approval for each successfully validated release.
- Tool selection belongs to planning and must use the evidence in
  [the Rust tooling research](../../docs/automated-semantic-release-research.md).
  Documentation/source review is not a claim that a Rust candidate already passes
  Rustcorder's complete parity and hosted-acceptance suite.

### Confirmed decisions — 2026-11-14

- The user chose fully automatic versioning and publication after gates, matching
  AVO, instead of keeping a publication approval for each release.
- The user chose to preserve Rustcorder's breaking-header and release-documentation
  rules while adopting AVO automation, its additional footer keywords and format.
- These decisions authorize the specification and a bounded future governance
  change, not an actual version update, tag, publication or PR comment in this task.

## Preservation and validation constraints

Keep the current branch feature/transcription-speaker-insights and all existing
dirty transcription/speaker work unchanged. This invocation creates one feature
directory, its quality checklist and requested research document, and updates the
active-feature locator. It makes no product-code, CI workflow, constitution, product
version, changelog-release, branch, commit, tag or remote-comment changes.

The approved future policy exception replaces Constitution IV's manual per-release
confirmation/approval with eligible merge plus complete current validation for the
bounded automated flow. Planning must align canonical and derived guidance before
activation. Annotated immutable tags and source/evidence integrity remain required;
interactive agents receive no general branch-operation exemption from this decision.

Implementation must first demonstrate failing behavior checks for wrong source or
attempt, no-release decisions, final-version validation, recursion, duplicates,
conflicting publication and stale/forbidden comment delivery. Prefer cheap rule
and report tests, with justified boundary/hosted cases for actual release and
native package proof. Specification-only validation checks content, references,
coverage of requirements and preservation; it does not run or certify a release.
