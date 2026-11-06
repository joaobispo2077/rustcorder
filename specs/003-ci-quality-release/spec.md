# Feature Specification: CI Quality Gates and Controlled Semantic Releases

**Feature Branch**: `main`

**Created**: 2026-11-05

**Status**: Draft

**Input**: User description: "Build strong GitHub CI with semantic release and quality gates similar to Avo, adapted to Rustcorder with UI testing. The lifecycle is feature/* -> develop -> release -> main; versions are created on release, the same way as Avo."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Prevent unsafe changes from advancing (Priority: P1)

As a contributor, I want each promotion to prove that the application builds,
behaves correctly and meets quality policy, so broken changes cannot advance.

**Why this priority**: Version automation needs a trustworthy readiness decision.

**Independent Test**: Submit a valid change and controlled failures for each gate
family. The valid change can advance; every failure blocks it with a named reason.

**Acceptance Scenarios**:

1. **Given** a `feature/* -> develop` change, **When** all required checks pass,
   **Then** it becomes eligible for review/merge without publishing a version.
2. **Given** a formatting, static-analysis, build, unit, integration, coverage,
   security or maintainability regression, **When** validation runs, **Then**
   the failing gate and overall readiness fail with usable diagnostics.
3. **Given** a cancelled, timed-out, missing or unexpectedly empty required check,
   **When** readiness is evaluated, **Then** it cannot be successful.
4. **Given** `develop -> release` or `release -> main`, **When** promotion is
   checked, **Then** the same quality policy applies; `feature/* -> main` fails
   the promotion policy.
5. **Given** a fork contribution or empty dependency cache, **When** checks start,
   **Then** ordinary CI needs no release credentials or private assets; a missing
   required prerequisite fails explicitly.

---

### User Story 2 - Catch desktop usability regressions (Priority: P1)

As a desktop user, I want both screens to remain readable and operable, so
controls cannot disappear while underlying application tests still pass.

**Why this priority**: Existing layout regressions justify checking the interface.

**Independent Test**: Exercise actual drawing and deterministic input, then
deliberately hide Cancel or break keyboard navigation and observe a failed gate.

**Acceptance Scenarios**:

1. **Given** both screens at default (1040 x 880), minimum (760 x 600) and wide
   (2048 x 1117) logical window sizes, each at 100% and 200% display scale,
   **When** drawn, **Then** essential settings,
   status, primary action, transcript and export controls remain reachable,
   without overlap or clipped essential content.
2. **Given** idle, ready, busy, stopping/saving, failure and completed states,
   **When** keyboard navigation and applicable actions are exercised, **Then**
   focus, enabled controls and resulting behavior match the product contract.
3. **Given** audio is stopping/saving while text work remains cancellable,
   **When** the interface is checked, **Then** Cancel remains available;
   deliberately removing it fails the check.
4. **Given** a versioned portable package, **When** launched in a clean supported
   desktop environment, **Then** its window opens, both screens are reachable and
   it closes cleanly. Missing desktop capability fails the prerequisite.

---

### User Story 3 - Prepare a version on release (Priority: P1)

As a maintainer, I want a predictable version proposal from approved changes on
`release`, without a second version when promoting to `main`.

**Why this priority**: This is the requested Avo-style versioning flow.

**Independent Test**: Evaluate change histories without writing tags or publishing.

**Acceptance Scenarios**:

1. **Given** established release history, **When** changes are analyzed, **Then**
   fixes and release-documentation corrections propose PATCH, compatible
   features MINOR and breaking changes MAJOR; the highest impact wins.
2. **Given** no releasable change, **When** preview runs, **Then** it reports no
   release and leaves version/changelog/tag records unchanged.
3. **Given** successful release-push validation, **When** preparation runs,
   **Then** the owner can review the version, changes, commit, evidence and
   remaining approval steps before execution.
4. **Given** an existing release promoted to `main`, **When** promotion completes,
   **Then** it retains that version without creating another release.
5. **Given** a manifest version without release tags, **When** preview runs,
   **Then** it identifies the bootstrap case and proposes a reviewable starting
   version without inventing past releases.

---

### User Story 4 - Publish the approved, validated candidate (Priority: P1)

As a release owner, I want publication tied to my approval of an exact validated
candidate, so unrelated or unfinished work cannot be released.

**Why this priority**: Governance requires completion confirmation, explicit tag
execution authorization and immutable annotated tags.

**Independent Test**: Use isolated release destinations; remove approval, replace
evidence, move the tip and retry an existing version. Only the valid authorized
candidate can publish.

**Acceptance Scenarios**:

1. **Given** green checks without completion confirmation, **When** preparation
   runs, **Then** only a preview is available; no actual version update,
   release changelog entry, tag or publication occurs.
2. **Given** completion confirmation and prepared version metadata, **When** the
   final candidate passes required checks, **Then** the owner can explicitly
   authorize tagging/publication for that commit, version and evidence.
3. **Given** missing/failed/mismatched evidence, a changed candidate, missing
   authorization or failed packaging, **When** publication is attempted,
   **Then** no new public release or tag is created.
4. **Given** a validated authorized candidate, **When** released, **Then** version
   records, annotated tag, package, checksums, notes and retained evidence agree.
5. **Given** repeated or overlapping attempts, **When** a version already exists,
   **Then** no duplicate is created and its published tag or different package
   bytes are never overwritten.

---

### User Story 5 - Understand and reproduce readiness (Priority: P2)

As a reviewer, I want readable reports with traceable measurements, so I can
understand a blocked candidate and reproduce failures.

**Why this priority**: Green indicators alone do not explain scope or missing data.

**Independent Test**: Inspect a complete, failed and interrupted run; verify
outcomes, measurement scope, identity and links to available evidence.

**Acceptance Scenarios**:

1. **Given** a completed run, **When** its report is read, **Then** it shows gate
   outcomes, raw measurements, thresholds, populations, exclusions and identity.
2. **Given** an earlier failure prevented a measurement, **When** reporting runs,
   **Then** it is unmeasured/incomplete, never zero, pass or an older run's value.
3. **Given** optional images/comment delivery fails, **When** checks finish,
   **Then** text and available artifacts remain accessible, preserving failures.
4. **Given** a failed gate, **When** local reproduction instructions are followed,
   **Then** the same population/policy can be selected, while local evidence
   remains distinguishable from hosted certification.

---

### User Story 6 - Prove tests detect faults (Priority: P2)

As a maintainer, I want bounded mutation checks of critical behavior, so tests
demonstrate that they catch defects rather than merely execute code.

**Why this priority**: This adapts Avo's light/full profiles without requiring the
entire source population on every contribution.

**Independent Test**: Seed detectable and surviving faults in declared scope;
compare reported accounting and acceptance with independently calculated results.

**Acceptance Scenarios**:

1. **Given** a promotion, **When** light mutation completes, **Then** its declared
   critical scope must score at least 40% for readiness.
2. **Given** a weekly/manual full run, **When** it completes, **Then** its declared
   broader scope must meet 50% and retain separate evidence; it cannot substitute
   for the candidate's missing light result.
3. **Given** no viable mutations, interruption, missing tests, timeout or
   unreconciled outcomes, **When** acceptance is evaluated, **Then** it fails as
   incomplete rather than receiving an invented passing score.

### Edge Cases

- A newer release tip appears while approval is pending: older approval/evidence
  cannot authorize the new tip.
- A pull request tested a proposed merge: it cannot alone certify the actual
  release commit.
- Version preparation creates a later commit: validate that final identity.
- A process exits successfully with missing, empty, malformed or contradictory
  evidence: required readiness fails.
- An exception expires, becomes stale or exceeds its ceiling: fail until reviewed.
- A cache contains older measurements: it may speed execution, not supply results.
- Device/model tests are outside ordinary CI: report the omission without claiming
  physical-device or real-inference acceptance.
- A partial release is retried: verify and preserve published identity/bytes;
  conflicting existing state requires intervention.
- Advisory/artifact services fail: missing evidence is not a clean audit or release.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Permit the initial promotion sequence `feature/* -> develop ->
  release -> main`; reject other pairs and expose stable required check names
  for all three destination branches. Branch creation/promotion remain user-owned.
- **FR-002**: Validate feature pushes, PRs to `develop`, `release` and `main`, and
  every release push. Certification MUST use the actual release commit.
  Optimizations MUST NOT skip required evidence or cancel active publication.
- **FR-003**: Verify workflow validity, supported build environment, pinned tools,
  locked dependencies and required test assets. Missing required setup MUST fail.
  Empty caches MUST be supported; ordinary CI MUST NOT need private recordings,
  personal paths or large inference weights.
- **FR-004**: Formatting, configured static analysis and supported-target builds
  MUST block on unwaived errors without silently rewriting source.
- **FR-005**: Required unit/boundary-integration populations MUST execute and retain
  existing coverage. Report passed, failed and ignored counts separately; fail
  unexpectedly empty selections and identify external device/model cases.
- **FR-006**: Product line coverage MUST have a positive version-controlled floor
  equal to the first verified baseline rounded down to a whole percentage point.
  Compare unrounded measurements; include first-party logic/UI and record scope,
  exclusions and selection. Missing/empty measurements MUST fail. Lowering the
  floor or widening exclusions requires explicit review.
- **FR-007**: Cyclomatic complexity above 10 per function MUST fail unless an exact
  existing-symbol exception records a measured ceiling, reason and owner.
  Reject new violations, exceeded ceilings, invalid analysis and stale exceptions.
- **FR-008**: Unwaived unused-product-code findings MUST block readiness.
  Exceptions MUST identify symbol, reason and owner; broad silent suppression
  MUST NOT replace analysis.
- **FR-009**: Duplicated first-party product lines MUST NOT exceed 2% of the
  analyzed population. Fix scope/detection settings in policy; explicitly exclude
  generated/third-party sources rather than silently changing the denominator.
- **FR-010**: Enforce existing recording, inference and UI ownership boundaries
  through explicit forbidden dependency directions where applicable, without
  reorganizing the application or introducing speculative layers.
- **FR-011**: Audit the locked dependency graph against known security advisories
  and reviewed source/license policy. Unwaived violations and scan failures MUST
  block. Report duplicate versions without automatic graph updates; duplication
  alone is advisory unless policy explicitly prohibits it.
- **FR-012**: Required UI checks MUST exercise actual drawing and deterministic
  keyboard/action inputs for both screens, the six Story 2 states and size/scale
  matrix. Detect inaccessible/clipped/overlapping essential controls, invalid
  enabled states and the cancellation regression; retain failure diagnostics.
- **FR-013**: Release readiness MUST include package integrity and actual clean
  supported-desktop launch/navigation/close smoke. Verify bundled assets/notices,
  hashes, version and runtime dependencies. Simulated UI proof MUST NOT stand in
  for native launch, physical audio or real inference.
- **FR-014**: Require light mutation for promotion readiness and a broader profile
  weekly/on request, initially scoring at least 40%/50%. Explicit selections MUST
  cover critical state, transcript and settings decisions, plus release/gate
  decisions when introduced.
- **FR-015**: Mutation score MUST equal `100 * detected / (detected + survived)`
  for a positive, fully reconciled viable population. Report non-compiling
  mutations separately, excluding them from the denominator and detections.
  Timeouts, missing tests, interruptions, invalid counters or unexplained
  outcomes MUST fail as incomplete. Cached results cannot become current proof.
- **FR-016**: Overall readiness MUST require every applicable mandatory gate to
  succeed. Failure, cancellation, timeout, absent evidence and unexpected skips
  MUST prevent success; failure-report delivery MUST NOT mask the failure.
- **FR-017**: Each completed validation attempt MUST produce readable and
  machine-readable evidence with source/tested commit, event, run/attempt,
  environment, tool/policy versions,
  populations, raw measurements, decisions and timings. Preserve available
  failure diagnostics for at least 14 days; retain published certification with
  its release. Interrupted attempts MUST remain incomplete, retaining any
  available diagnostics rather than receiving a completed report's certification.
- **FR-018**: Distinguish pass, fail, incomplete, excluded and advisory outcomes.
  Unexecuted measurements MUST NOT become zero/pass. Display rounding MUST NOT
  alter decisions; optional pictures/comments MUST NOT be needed to read results.
- **FR-019**: Only literal `release` creates stable versions. Features/develop
  validate without publication; `main` receives the existing approved version
  without a second calculation/publication. Prerelease channels are outside scope.
- **FR-020**: Propose SemVer from complete relevant history, including merged
  changes: compatible fixes/release-documentation corrections PATCH, compatible
  features MINOR, breaking changes MAJOR. Validate conventional change
  classifications before promotion. Bookkeeping/non-release changes MUST NOT
  trigger release loops. Confirm bootstrap behavior from actual manifests/tags.
- **FR-021**: Preview MUST show proposed version, changes, source, evidence and
  remaining approvals without writing version updates, release changelog entries
  or tags. No eligible change MUST produce a successful no-release outcome.
- **FR-022**: Actual version/changelog changes MUST wait for explicit confirmation
  that work is finished and working. Tagging/publication MUST require explicit
  authorization for the final commit, version and evidence. Green CI alone is
  not authorization.
- **FR-023**: After metadata changes create a new candidate commit, validate that
  identity before tagging; retain its relationship to the source, without
  relabelling earlier tests. Candidate changes invalidate prior authorization.
- **FR-024**: Tags MUST be annotated, immutable and named `vMAJOR.MINOR.PATCH`.
  Prevent concurrent conflicting execution; retries MUST verify existing state
  without rewriting tags or different published bytes.
- **FR-025**: Project version, locked project metadata, built application version,
  package, tag, changelog and notes MUST agree. Build from the validated final
  candidate and retain checksums and commit-bound evidence.
- **FR-026**: Stage a draft release with versioned package, notes and evidence.
  Public publication requires final checks and FR-022 authorization. Changelog
  entries MUST be dated, describe outcomes and link existing tickets/relevant docs.
- **FR-027**: Ordinary checks MUST use minimal read permissions and expose no
  release credentials to contribution code. Privileged work MUST verify intended
  repository, branch, commit and successful run; downloaded evidence MUST NOT
  become trusted execution. External workflow dependencies need reviewed immutable
  identities.
- **FR-028**: Document policy, local reproduction, required-check setup, approvals,
  recovery, bootstrap and user-performed metadata synchronization directly under
  `docs/`. Distinguish documented settings from verified remote enforcement;
  periodically review narrow exceptions.
- **FR-029**: Set explicit job limits: initially 20 minutes light mutation and
  60 minutes full. Target ordinary warm-cache promotions within 45 minutes over
  three representative runs. Timeouts MUST fail; reducing scope/policy to fit
  budgets requires review.

### Key Entities *(include if feature involves data)*

- **Promotion**: Source/destination branches, change identity and required policy.
- **Gate Policy**: Scope, required/advisory status, threshold, budget and exceptions.
- **Validation Evidence**: Commit/run/attempt identity, population, measurements,
  decisions, environment and diagnostics.
- **Release Candidate**: Version, source/final commits, change summary, package
  checksums and qualifying evidence.
- **Release Authorization**: Owner confirmation, exact candidate/version and
  authorized action; invalid after candidate changes.
- **Published Release**: Immutable annotated tag, matching package/version records,
  notes and certification evidence.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Controlled failures in every required gate family and invalid
  promotion pair produce zero successful readiness decisions; valid controls
  succeed at each permitted promotion boundary.
- **SC-002**: UI scenarios pass at three sizes and two scales. Removing Cancel or
  breaking keyboard navigation is detected; each release has successful native
  package launch/navigation/close proof.
- **SC-003**: Fix, feature, breaking, release-documentation, no-release and
  bootstrap history fixtures produce the expected proposals; final promotion
  creates zero additional versions.
- **SC-004**: Missing authorization, stale/mismatched evidence, changed candidates,
  failed packages and conflicting versions produce zero new public tags/releases.
  Repeating an authorized successful attempt leaves exactly one immutable release.
- **SC-005**: Every published version-bearing record, package checksum, tag target
  and certification matches the approved final candidate; an injected mismatch
  prevents publication.
- **SC-006**: Coverage satisfies its verified baseline floor; maintainability and
  security enforce declared policy. Light/full mutation meet 40%/50% with complete
  accounting. Empty, invalid or interrupted measurements never count as passes.
- **SC-007**: Every completed attempt, including failures, has a readable report
  with identity; ordinary evidence lasts at least 14 days and release evidence
  remains attached to its version.
- **SC-008**: Three representative warm-cache promotion runs each finish within
  45 minutes; light/full mutation meet 20/60-minute limits or visibly fail.
- **SC-009**: From one run summary, a maintainer can identify the blocking reason,
  evidence and reproduction instructions without private recordings, personal
  machine paths or undocumented release steps.

## Assumptions

- The user confirmed Avo's flow: stable versions on `release`, then the same
  version on `main`; the initially suggested candidate/stable split is superseded.
- `release` is a literal long-lived branch. The user performs branch operations.
- Product scope is the existing Windows x64 desktop application. Additional
  platforms, installers, automatic updates and registry publishing are excluded.
- Existing completion confirmation, explicit execution authorization and
  annotated-tag governance continue to apply.
- Coverage must be measured; Avo's historical floor and the cheap-unit ratio do
  not establish Rustcorder coverage.
- Numeric maintainability/mutation targets are acceptance policy adapted from
  Avo, not current Rustcorder measurements. Review narrow existing debt rather
  than hiding failures to manufacture a green baseline.
- Weekly full mutation is an independent required-to-pass scheduled check, not a
  replacement for candidate light results or an extra full run on every PR.
- Deterministic UI checks use synthetic data. Physical-device, long-duration and
  real-model acceptance remain separately identified and are not completed here.
- Hosted setup may obtain pinned development tools and the small verified bundled
  speech detector. Offline/local-only product runtime and separate inference
  weights remain unchanged.
- Maintainers can configure required checks/approvals; remote enforcement must be
  verified during implementation.
- Sources and adaptation details are in [the reference](../../docs/ci-quality-release-reference.md).

## Preservation and validation constraints

- Remain on existing `main`. This command creates specification artifacts, not
  branches, promotions, version bumps, release changelog entries, tags or releases.
- Future executable changes are bounded to delivery automation, policy/tests and
  minimal UI testability/version-reporting support. Preserve existing recording,
  transcription, storage, settings, cancellation and UI behavior.
- Preserve staged UI/layout work and the separate transcription/speaker feature.
  The active feature pointer intentionally selects this new specification.
- Demonstrate failing acceptance/regression tests before executable changes:
  promotion policy, aggregation, accounting, identity/authorization and UI
  regressions. Release tests must use isolated destinations.
- Prefer cheap pure checks, then boundary tests, then necessary native UI/package
  proof. Target 90% cheap unit tests where feasible; document actual exceptions,
  never infer the ratio from test-file placement.
- This phase uses content/link/consistency/preservation checks and claims no
  runtime, hosted CI or remote-protection pass.
