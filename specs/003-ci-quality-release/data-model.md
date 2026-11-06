# Data model: CI and release evidence

**Scope**: Versioned files/artifacts, not a database. Contract examples and
interfaces are in [CI evidence](contracts/ci-evidence.md) and
[release](contracts/release.md).

## Shared validation rules

- JSON objects have an explicit `schema_version`; reject unsupported versions,
  duplicate identities, missing required fields and malformed types.
- Full commit/tree hashes are lowercase 40-hex Git object IDs for this repository.
  SHA-256 digests are lowercase 64-hex, with API digest algorithm recorded.
- IDs/counters are nonnegative safe integers; counts reject booleans, strings,
  fractions, negative/nonfinite values. IDs that must exist are positive.
- UTC timestamps use ISO 8601. Release dates are explicit calendar dates.
- Repository paths use normalized relative separators and reject traversal,
  drive/UNC/absolute paths, ambiguous case collisions and symlink escapes.
- Unmeasured values are absent/null with a reason, never invented zero.
- Comparisons use integer numerators/denominators or exact cross-products;
  rounded display percentages are informational.

## GatePolicy

Stored as `scripts/ci/policy.json`, with its byte digest retained in every result.

| Field | Meaning / constraint |
| --- | --- |
| schema_version, policy_id | Supported format and stable policy identity |
| promotion_pairs | feature-prefix to develop, develop to release, release to main |
| event_requirements | Fixed applicable/required gate IDs by event |
| populations | Root product paths, test selections, external cases, exclusions |
| thresholds | Coverage floor, complexity 10, duplication 2%, mutation 40%/50% |
| baseline | Coverage counts, tested source, run/attempt and measurement identity |
| exceptions | Exact path/symbol/advisory/rule, reason, owner, ceiling where relevant, review/expiry metadata |
| budgets | Per-job limits, light 20m/full 60m and warm-path 45m target |

The initial coverage floor is unset until a verified positive baseline is
reviewed; unset cannot certify readiness. Its accepted value is the baseline
percentage rounded down to a whole point. No automatic downward ratchet.
Stale, expired, duplicated or exceeded exceptions fail.

## ToolchainIdentity

Stored as `scripts/ci/toolchain.json`; records exact Rust/Node/tool versions,
download source/digest, Action commit pins and required capabilities. Receipts
also capture actual OS image, target, MSVC/CMake/Git versions and active hashes.
Missing/unverified required binary checksums block provisioning.

## ValidationAttempt

| Field | Meaning |
| --- | --- |
| repository_id, head_repository_id, repository | Actual source repository identity |
| workflow_id, workflow_path, workflow_sha | Validated workflow/control identity |
| event, branch, source_sha, tested_sha | PR source versus tested merge, or actual push commit |
| base_sha, pull_request_number | Present only for PR context |
| run_id, run_attempt, job_id | Distinguish reruns and actual job execution |
| policy_sha256, toolchain_sha256 | Policy/tool contract used |
| started_at, completed_at, environment | Execution provenance |

`local` attempts use an explicit local identity and dirty-tree indicator.
They cannot pass hosted release certification.

## GateReceipt

One receipt per gate and attempt, with its raw output/log references.

Fields: gate ID; ValidationAttempt identity; applicable/required; status
(`pass`, `fail`, `incomplete`, `excluded`, `advisory`); command/selection;
start/end/duration; exit code; scope; counts/measurements; threshold decision;
exception identities; raw artifact digests; diagnostic reasons.

Only an executed, reconciled applicable required gate may become `pass`.
Not-required-by-event is `excluded`, not a required skipped success.
Transport/cancellation failures remain incomplete. Compiler diagnostics are
distinct from actual test counts.

## TestPopulation

Fields: population ID, target/filter, listed test names, expected exclusions,
executed/passed/failed/ignored/filtered counts, completion state and raw log.
Selected required populations are nonempty. Reconcile list and execution, retaining
the names/reasons of external device/model cases. Do not infer test cost from file
placement. Rust and Node baselines are distinct.

## Measurements

- **Coverage**: covered/total product lines, exact file inventory, excluded paths,
  population and tool identity; positive denominator and complete execution.
- **Complexity**: path, qualified function identity, kind/span, own cyclomatic
  value, applicable limit/exception; module aggregate values are not functions.
- **Duplication**: duplicated/total analyzed lines, tokenizer/settings, source
  inventory and exact raw ratio. Empty source is incomplete.
- **Dependencies**: ecosystem, locked graph identity, advisory/source/license
  findings, waiver identities, duplicate versions as a separate advisory list.
- **UI**: tab, state, logical size, scale, input/action, geometry/accessibility
  assertions and diagnostics. Native smoke additionally binds executable
  checksum/version, process/window identity and clean exit.

## MutationResult

Fields: engine/profile; declared source/test selection; baseline receipt;
generated IDs; each outcome; detected/survived/nonviable/unresolved counts;
tool exit code; completion time; score numerator/denominator and floor.

States: `not_started -> baseline -> running -> complete | incomplete`.
Only complete results with positive `detected + survived` receive a score.
Generated IDs must equal the unique classified outcome set. Nonviable is
separate; timeout/missing tests/unknown outcomes cannot become detections.
Never average engines, and never reuse cached outcomes as fresh evidence.

## ReleaseProposal and PreparationManifest

**Proposal**: source commit, prior annotated tag/object or explicit bootstrap,
analyzed commit IDs, highest release impact, proposed version or no-release,
notes, referenced docs/tickets, policy/tools and source CI attempt.

**PreparationManifest**: proposal digest, confirmation actor/run/time, source
parent, previous-release identity, target version/date, allowed edited paths,
patch digest, expected resulting tree and before/after metadata graph digests.

Prepared paths are limited to Cargo.toml, the root Cargo.lock version token and
CHANGELOG.md. Initial bootstrap may leave version tokens unchanged. Support-tool
npm versions are not product versions and are not bumped with the application.

## ReleaseCandidate and PackageManifest

Candidate fields: version, final commit, sole source parent, expected tree,
preparation identity/digest, final successful CI run/attempt, evidence artifact
IDs/digests and package manifest.

Package fields: safe inner folder, canonical outer ZIP name, target/profile,
built version/source, file inventory/hashes, VAD provenance/license, direct native
imports, ZIP checksum and native-smoke receipt. Keep existing pending real-device/
disconnected-host acceptance explicit; do not manufacture a product acceptance pass.

## ReleaseAuthorization and PublishedRelease

Authorization binds candidate digest, SHA/version, preparation, exact successful
latest run attempt, artifact IDs/digests, publisher workflow SHA and requested
action. Store preflight outputs before reviewer approval and record reviewer
decision. A changed bound field invalidates authorization.

Release states:

`proposed -> completion_confirmed -> patch_prepared -> user_committed ->
validated_candidate -> awaiting_authorization -> authorized -> tagged ->
draft_verified -> published -> promoted`

No-release terminates at proposal. Failures stop at the last verified state;
retry reconciles existing objects. Published release records retain annotated
tag/object/target, GitHub release ID, final asset hashes, notes and certification.
Existing conflicting tag targets or asset bytes are terminal conflicts requiring
intervention, never force updates.
