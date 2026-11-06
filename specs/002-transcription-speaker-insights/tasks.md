# Tasks: Accurate Transcription and Speaker Insights

**Feature**: `002-transcription-speaker-insights` | **Branch**: `main`, unchanged
**Created**: 2026-11-05 | **Status**: Generated; implementation has not started

**Input**: [spec](spec.md), [plan](plan.md), [research](research.md),
[data model](data-model.md), [desktop/worker contract](contracts/desktop-and-analysis.md),
[evaluation contract](contracts/evaluation.md), [quickstart](quickstart.md).

**Tests**: Required before executable changes. Record a meaningful failing test or
acceptance probe, implement the narrow fix and rerun the relevant checks. Do not
count missing fixtures/weights as a passing test. Documentation-only tasks use
content/link checks. All checkboxes below are initially unchecked.

## Format and execution rules

- Task lines use `- [ ] Tnnn [P?] [USn?] description with file paths`.
- `[P]` means independent file work within the stated ready phase, not permission
  to skip prerequisites. Shared Rust/UI/worker edits remain sequential. Actual
  delegation is subject to the active agent/user instructions.
- Paths in this file are repository-relative; resolve them against
  `C:\Users\vitor\dev\tools\rustcorder` for filesystem operations. New paths are
  implementation deliverables, not claims that files or commands exist already.
- Preserve the current branch, original audio, current base/small CPU/live behavior
  and existing staged UI work. Do not run branch hooks, commit, publish, change
  product versions or add release/changelog entries as part of these tasks.
- Feature 003 owns the current shared `.specify/feature.json` selection. Resolve
  feature 002 explicitly and use non-persisting path resolution for read-only
  checks; do not overwrite the concurrent feature's state.
- Ship one quality adapter: WhisperX 3.8.6 with local PT/EN resources. Native
  Parakeet/Nemotron is an experiment only. New `workers/evaluation.py` is a
  development-only harness helper, not a second production worker.
- Keep private audio, model/runtime binaries and raw reports under ignored local
  directories. Commit only manifests/locks/notices and sanitized documentation.

## Phase 1: Setup (Shared Infrastructure)

**Goal**: Establish the existing-check baseline and the two required local input
catalogs without modifying product behavior.

- [ ] T001 Record the current branch, existing-change hashes and baseline Cargo test/format/Clippy results using `scripts/dev.ps1` in `docs/transcription-speaker-validation.md`; identify ignored device/model checks separately and preserve current staged content.
- [ ] T002 [P] Document the permission/license, human annotation, reference hashing, 12-conversation/60-minute PT/EN corpus and four-recording held-out preparation rules in `tests/fixtures/README.md`; catalogue available inputs and explicitly identify missing references without inventing them.
- [ ] T003 [P] Document the optional CPU/CUDA profile layout, fixed worker/runtime locations, manifest fields, asset acquisition prerequisites and separate code/weight notices in `assets/quality/README.md`, following the data model and keeping normal app operation offline.

**Checkpoint**: Baseline evidence and provisioning/reference requirements are
recorded. No model has been declared more accurate by documentation alone.

## Phase 2: Foundational (Blocking Prerequisites)

**Goal**: Prove a reproducible local pipeline and comparison before integrating
it into the app. Freeze exact inputs/settings; do not build multiple adapters.

### Required failing tests

- [ ] T004 [P] Add failing standard-library unit tests in `workers/tests/test_quality_worker.py` for local-only profile checks, path escapes, missing companion/NLTK/VAD assets, lazy model imports, PT/EN/device propagation, ASR checkpoints, unaligned text and ordinary overlapping activity using fake pipeline stages.
- [ ] T005 [P] Add failing unit tests in `workers/tests/test_evaluation.py` for corpus manifest validation, aggregate per-language WER, zero-collar overlap-inclusive DER, per-recording speaker matching, hinted-count exclusion, missing-speaker duration error, unassigned words forced to dummy streams and control/candidate gate semantics.
- [ ] T006 Resolve and provision an exact compatible Python 3.12/WhisperX 3.8.6 environment for Windows CPU and CUDA; record full wheel/DLL versions and hashes in `assets/quality/runtime-cpu.lock.json` and `assets/quality/runtime-cuda.lock.json`, and compute settings plus every local model/tokenizer/aligner/VAD/NLTK/Community-1 asset in `assets/quality/profile-manifest.json`, keeping bytes in ignored `models/quality-whisperx/` and noting unavailable assets honestly.

### Minimal experiment implementation and evidence

- [ ] T007 Implement local profile/preflight helpers and lazy pipeline loading in `workers/quality_worker.py` after T004/T006, including explicit local HF aligners, supplied local VAD, complete Community-1 dependencies, offline flags and disabled telemetry; make missing assets fail before any convenience downloader is called.
- [ ] T008 Implement the frozen manifest/scoring/report helpers in development-only `workers/evaluation.py` after T005, including create-new reports, per-recording identity matching, all eligible reference speakers, full/held-out aggregates and explicit pass/fail/not-run/not-applicable outcomes.
- [ ] T009 [P] Demonstrate failing regression tests for benchmark-only medium/large-v3/turbo discovery and loaded-metadata acceptance in `src/models.rs` and `src/transcription/worker.rs`, plus benchmark-entry dispatch in `src/main.rs`, while proving ordinary application discovery/validation still rejects unsupported families.
- [ ] T010 Add the smallest explicit benchmark-only native Whisper entry and policy plumbing in `src/models.rs`, `src/transcription/worker.rs` and `src/main.rs` after T009; keep its allowlist unavailable to normal model/UI/live selection and rerun preserved legacy-family checks.
- [ ] T011 [P] Add failing runner boundary tests in `workers/tests/test_evaluation_runner.py` for `-Manifest`, `-Candidate`, CPU/CUDA selection, invalid candidate data, fixed argument handling, no-overwrite reports and nonzero execution/scoring failures using fake child commands; do not add another test framework.
- [ ] T012 Implement `scripts/benchmark-conversations.ps1` and its fixed development invocation into `workers/evaluation.py` after T008/T010/T011, using only manifest-declared local candidates and the agreed four parameters; preserve the existing `scripts/benchmark.ps1` read-speech workflow.
- [ ] T013 Prepare and human-verify the declared conversation/reference set in ignored `.build/fixtures/conversations/`, freeze `evaluation.json`, audio/text/activity hashes, annotated regions, split and reviewer provenance, and record a sanitized manifest summary in `docs/transcription-speaker-validation.md`; unavailable references remain an unmet acceptance prerequisite.
- [ ] T014 Implement the minimal reusable evaluation pipeline in `workers/quality_worker.py` after T004/T007, using local PyAV decoding/scratch, selected-language ASR, an immediate text checkpoint, local alignment without invented word timing, whole-recording ordinary diarization and sequential model release; expose it to the fixed development harness without adding a production backend selector.
- [ ] T015 Run CPU/CUDA compatibility probes through `scripts/benchmark-conversations.ps1` on declared development clips, exercising known-count hints, raw overlap, missing assets, direct-child cancellation, native stdout and zero attempted connections; preserve raw failures and runtime/memory evidence in `.build/benchmarks/` and `docs/transcription-speaker-validation.md`.
- [ ] T016 Remeasure base/small controls and WhisperX large-v3/turbo CPU/CUDA configurations on the frozen corpus through `scripts/benchmark-conversations.ps1`; tune only on development recordings, freeze final settings before held-out scoring, and retain per-language WER/DER/count/duration/resource results and candidate eligibility in `.build/benchmarks/`.
- [ ] T017 Evaluate the larger native Whisper controls and bounded NeMo-Speech.cpp v0.3.0 Parakeet/Nemotron challenger through the same harness in `scripts/benchmark-conversations.ps1`; verify explicit-language, raw-activity, hint/provenance, progress and offline eligibility before comparing applicable scores, and document ineligible capabilities rather than building a second product adapter.
- [ ] T018 Rerun foundational fake/unit/runner checks and record the selected exact WhisperX profile and first-gate verdict in `docs/transcription-speaker-validation.md`; require compatible offline operation, preserved overlap, fit on the declared device and the planned corpus quality gates before app integration, retaining failed evidence and revisiting the plan if no candidate passes.

**Checkpoint**: The engineering foundation and its evidence are ready before
production story integration. Missing assets/references do not excuse fabricated
passes: continue only independent ready test/harness work, leave blocked evidence
tasks unchecked, and obtain the missing input when it is actually needed. A
successful control run is not a candidate acceptance pass. This gate does not
claim the later UI/package checks have been completed.

## Phase 3: User Story 1 - Obtain a More Accurate Transcript (P1, MVP)

**Goal**: A user can choose a verified local quality option, transcribe PT/EN
WAV/MP3 without speakers, and copy/save text while the CPU baseline remains usable.

**Independent Test**: Analyze the same human-referenced recordings with speakers
off, compare against the better current option per language, exercise missing
assets/device failure/cancellation, and confirm text export and unchanged audio.

### Required failing tests

- [ ] T019 [P] [US1] Add failing pure value/state tests in `src/transcription/analysis.rs` for checked 16 kHz intervals, source/attempt identity, independent stage outcomes and coverage, ASR text checkpoints, complete/partial promotion and optional unavailable speaker data.
- [ ] T020 [P] [US1] Extend `tests/integration/worker_protocol.rs` and `tests/support/fake_worker.rs` with failing fake-child cases for protocol v2, analysis profile/file requests, 64 KiB headers, 1 MiB lines/payloads, 1024-record batches, 128 MiB aggregate results, sequence/identity validation, unique terminals and unchanged legacy request behavior.
- [ ] T021 [P] [US1] Add failing tests in `workers/tests/test_quality_protocol.py` for private v2 framing, UTF-8/native-log separation, bounded text/word batches, each word emitted once, source/profile rechecks and terminal outcomes after alignment or model failure.
- [ ] T022 [P] [US1] Add failing controller/preferences tests in `src/app.rs` and `src/settings.rs` proving quality readiness is independent of legacy model readiness, choices are idle-only, explicit language/device never silently fall back and old schema-1 files receive safe defaulted preferences without persisting results/hints.
- [ ] T023 [P] [US1] Add failing UI tests in `src/ui.rs` for quality profile/device/language selection, visible readiness/progress/partial status, keyboard access and plain-text copy/save availability while preserving the existing sidebar/workspace layout and legacy controls.

### Implementation

- [ ] T024 [US1] Implement `RecordingRef`, `AnalysisProfile`, immutable options, result/stage/coverage ownership and validation in `src/transcription/analysis.rs`, register the module in `src/transcription/mod.rs`, and retain original ASR passages independently of the legacy `Transcript::commit` path; include optional speaker value fields needed by the shared contract without enabling speaker behavior yet.
- [ ] T025 [US1] Upgrade `src/transcription/mod.rs`, `src/transcription/worker.rs`, `tests/support/fake_worker.rs` and protocol fixtures in `tests/integration/worker_protocol.rs` together to private protocol v2 after T020; audit hardcoded clients in `workers/evaluation.py` and native cases under `tests/integration/`, add typed analysis requests/events and strict bounds/terminal validation, preserve legacy file/live semantics and reject incompatible workers cleanly.
- [ ] T026 [US1] Implement the production `ValidateAnalysisProfile`/ASR-only `AnalyzeFile` handlers in `workers/quality_worker.py` after T021/T024/T025, reusing the proven pipeline, preserving coarse ASR text before alignment, emitting valid UTF-8 spans once, and keeping model logs off protocol stdout.
- [ ] T027 [US1] Add the analysis job/direct isolated-Python launcher in `src/transcription/jobs.rs`, reusing `WorkerProcess`, bounded queues and the reserved terminal path; implement explicit stage/hard budgets, genuine-progress rules, generation checks, source identity and cancellation/reaping without shell/package-manager startup.
- [ ] T028 [US1] Add independent quality readiness and idle/exclusive-job actions in `src/app.rs`, plus optional defaulted quality-profile/device preferences in `src/settings.rs`; preserve existing config, malformed/newer-schema rejection, atomic saves and the legacy CPU selection path.
- [ ] T029 [US1] Wire the quality controls and ASR-only results/progress/plain-text export in `src/ui.rs` after T023–T028; display actual option/language/device and local errors, preserve unaligned text and existing unsaved-text guards, and do not expose an unmeasured profile as recommended.
- [ ] T030 [US1] Define and execute explicitly selected real ASR boundary cases in `tests/integration/speaker_analysis.rs`, registered by `tests/integration.rs`, for PT WAV/EN MP3, local CPU/CUDA, speech-free/attenuated speech, missing assets, source hashes and cancellation; retain an observed failure before any new boundary fix and keep ordinary tests weight-free.
- [ ] T031 [US1] Validate the integrated ASR-only flow disconnected and with connected tracing, including missing tokenizer/NLTK/aligner/VAD, unavailable GPU and operation without the optional quality runtime, and record zero-attempt/no-fallback/text-preservation evidence in `docs/transcription-speaker-validation.md`.
- [ ] T032 [US1] Rerun US1 focused Rust/Python checks and same-recording held-out WER/end-to-end timing through the integrated worker, then record SC-001/005/006/007/008 results and limits in `docs/transcription-speaker-validation.md`; require >=20% relative WER reduction per language and preserve failures before declaring the MVP ready.

**Checkpoint**: US1 is a useful, independently demonstrable transcription increment
with speakers disabled. Its completion does not claim the speaker/report stories.

## Phase 4: User Story 2 - See Who Spoke When (P1)

**Goal**: Add estimated participant count, stable Person labels and timestamped
speaker text, retaining detected overlap/unknown activity and successful ASR.

**Independent Test**: Compare one- through four-person references, returning voices
and simultaneous speech; repeat automatic and hinted runs and force speaker-stage
failure after successful ASR. Speaker intervals can also be tested with fixed text.

### Required failing tests

- [ ] T033 [P] [US2] Add failing tests in `src/transcription/analysis.rs`, `src/app.rs` and `src/ui.rs` for nonempty observed counts versus supplied hints, deterministic first-appearance/tie labels, provisional status, outside-range warnings, per-source hint reset and ambiguous word assignment distinct from genuine simultaneous overlap.
- [ ] T034 [P] [US2] Add failing fake-pipeline tests in `workers/tests/test_quality_diarization.py` for complete local Community-1 loading, automatic/known-count propagation, whole-recording identity, ordinary overlapping activity, sequential memory release, unknown text and ASR retention when diarization fails.
- [ ] T035 [P] [US2] Add failing activity/identity/sequence/partial-terminal cases in `tests/integration/worker_protocol.rs` and `tests/support/fake_worker.rs`, and define explicit one-to-four/returning/overlap/count-hint real acceptance cases in `tests/integration/speaker_analysis.rs`; register additional cases in `tests/integration.rs` and retain red evidence before speaker implementation.

### Implementation

- [ ] T036 [US2] Implement roster/count provenance, final ordinal reconciliation, raw activity validation and word attribution in `src/transcription/analysis.rs`; require a unique greatest positive intersection, preserve ties/unassigned text, distinguish a word crossing adjacent turns from actual >=2-speaker simultaneous activity and never infer identity from the nearest voice or channel.
- [ ] T037 [US2] Enable optional whole-recording diarization and hint handling in `workers/quality_worker.py` after T034/T036, returning ordinary overlapping/unknown activity separately from words; retain ASR text first, release unused stage models and emit each word once after requested later stages resolve or fail.
- [ ] T038 [US2] Consume speaker batches and independent stage outcomes in `src/transcription/jobs.rs` and `src/transcription/analysis.rs`, tracking diarization coverage separately from ASR and preserving complete transcription on speaker failure instead of synthesizing zero speakers or complete silence.
- [ ] T039 [US2] Add per-attempt speaker enablement/capability/known-count controls and their guards in `src/app.rs` and `src/ui.rs`; show requested-versus-observed provenance and clear the hint for a new source without saving it in preferences.
- [ ] T040 [US2] Present the complete speaker-labelled timestamped transcript, estimated count, provisional/final labels and overlap/unassigned warnings in `src/ui.rs`, keeping simultaneous passages outside legacy transcript deduplication and making absent/failed insights visibly unavailable.
- [ ] T041 [US2] Execute the declared real one-to-four-person, returning-voice, simultaneous-speech and hint-conflict cases in `tests/integration/speaker_analysis.rs`; score automatic counts separately from supplied counts and preserve original input hashes and unassigned text.
- [ ] T042 [US2] Trace disconnected/connected speaker analysis with complete and deliberately incomplete disposable diarization profiles, and force a post-ASR speaker-stage failure through `tests/integration/speaker_analysis.rs`; record no download/telemetry attempts and retained usable ASR in `docs/transcription-speaker-validation.md`.
- [ ] T043 [US2] Measure complete CPU/CUDA ASR+alignment+diarization peak memory and cold/warm 10-minute timing through `scripts/benchmark-conversations.ps1`, freezing the passing device configuration and confirming the 8 GB GPU budget and explicit resource errors in `docs/transcription-speaker-validation.md`.
- [ ] T044 [US2] Rerun focused fake/unit/protocol checks and integrated held-out speaker scoring, then record SC-002/003 and speaker-attributed-word diagnostics in `docs/transcription-speaker-validation.md`; require ceil(0.9*N) overall and ceil(0.75*H) held-out exact counts and <=15% DER per held-out language with overlap/no collar.

**Checkpoint**: Speaker results work without the participation dashboard. No real
names, cross-recording identities or guaranteed recovery of every overlapping word
are implied. Pure speaker tests need neither a microphone nor a live recording.

## Phase 5: User Story 3 - Review Participation Highlights (P2)

**Goal**: Show duration, speech share and turn count per person, filter passages
and explicitly copy/save a report derived from the same validated summary.

**Independent Test**: Verify fixed intervals without models, including the 20-second
spec example, then compare the UI/export and real-reference speaker durations.

### Required failing tests

- [ ] T045 [P] [US3] Add failing pure tests in `src/transcription/participation.rs` for unsorted/duplicate/nested intervals, distinct-ID two/three-way overlap, concurrent unknown activity, coverage holes, the 7s/4s example, 7999/8000/8001-tick gaps, intervening brief speech, zero denominators and exact decimal half-up rounding.
- [ ] T046 [P] [US3] Add failing result/render/UI tests in `src/transcription/analysis.rs` and `src/ui.rs` for whole-result totals, filter invariance, available versus unrequested/failed/provisional metrics, untimed text and identical displayed/report formatting with count and coverage provenance.
- [ ] T047 [P] [US3] Add failing report clipboard/export boundary cases in `tests/integration/transcription_actions.rs` for Unicode, original-timeline timestamps, partial labels, no silent overwrite, unwritable destinations and preservation of the existing plain-text-only export.

### Implementation

- [ ] T048 [US3] Implement per-speaker interval unions and a distinct-active-ID sweep in `src/transcription/participation.rs`, register it in `src/transcription/mod.rs`, and calculate attributed person-time, elapsed any/attributed/unknown/overlap time and known-coverage silence without turning unprocessed tails into silence.
- [ ] T049 [US3] Implement turn chains, exact shares and rendering rounding in `src/transcription/participation.rs`; use the <=8000-tick fully covered gap rule without other/unknown speech, exclude joined silence from duration and keep text chunking independent of counts.
- [ ] T050 [US3] Derive the immutable whole-result `ParticipationSummary` in `src/transcription/analysis.rs` after T048/T049, with separate unknown/uncovered time, absent zero-denominator shares and provisional status tied to actual speaker coverage/reconciliation.
- [ ] T051 [US3] Render the labelled participation table and selected-person timestamped passage filter in `src/ui.rs`, using the existing layout and keyboard navigation while leaving the underlying result and all summary totals unchanged.
- [ ] T052 [US3] Implement one pure readable speaker-report renderer in `src/transcription/analysis.rs` containing source/options/status, requested/observed count, labels, duration/share/turns, overlap/unknown/uncovered notes and all available passages; preserve untimed words and use the shared formatting rules.
- [ ] T053 [US3] Wire explicit Copy report/Save report actions in `src/ui.rs` using the existing UTF-8/no-overwrite save behavior, applying only a minimal tested reuse of `src/transcription/transcript.rs` export helpers if needed; preserve Copy text/Save text semantics and retain results after save failure.
- [ ] T054 [US3] Execute deterministic complete/partial/report/filter flows through `tests/integration/transcription_actions.rs` and the existing `src/ui.rs` layout tests, confirming exact display/export agreement and original audio preservation with no model required.
- [ ] T055 [US3] Measure real per-person speaking-duration error and diagnostic turn error from the integrated outputs through `workers/evaluation.py`, including missed eligible reference speakers as predicted zero, and record SC-004 results in `docs/transcription-speaker-validation.md`.
- [ ] T056 [US3] Rerun focused participation/result/UI/export checks and validate the spec's complete arithmetic example, half-second boundary, count provenance and partial coverage report through `specs/002-transcription-speaker-insights/quickstart.md`, retaining red/green and export evidence in `docs/transcription-speaker-validation.md`.

**Checkpoint**: Deterministic participation/report behavior is independently proven
with fixed intervals; full user-facing reports integrate US1 and US2 outputs.

## Phase 6: User Story 4 - Analyze Saved Audio Without Disrupting Capture (P2)

**Goal**: Analyze an explicitly selected saved recording after audio finalization
and retain complete/partial results safely through retries, cancellation and close.

**Independent Test**: Record and save without quality assets, analyze later, then
cancel/crash replacement jobs. Audio and the prior complete result stay available,
new text stays labelled partial, and existing live behavior is preserved.

### Required failing tests

- [ ] T057 [P] [US4] Add failing saved-audio/action tests in `src/app.rs` and `tests/integration/live_recording.rs` for explicit post-finalization analysis, completed/interrupted path provenance, mutually exclusive jobs and recording/live availability without a quality profile.
- [ ] T058 [P] [US4] Add failing UI state tests in `src/ui.rs` for `last_complete` versus `current_attempt`, cancelled/failed replacement retention, explicit result inspection/export, independent unsaved text/report state and close choices while preserving existing race regressions.
- [ ] T059 [P] [US4] Extend `tests/integration/transcription_actions.rs` with failing fake-child cases for queue saturation, reserved terminal delivery, stage reset/repeated heartbeat deadlines, cancellation acknowledgement, child reaping, stale generations and successful-ASR/failed-speaker replacement outcomes.

### Implementation

- [ ] T060 [US4] Add the guarded Analyze saved recording action in `src/app.rs` and `src/ui.rs`, using the retained finalized audio path and its interruption status; never enqueue analysis automatically or delay WAV finalization/stop while waiting for quality readiness.
- [ ] T061 [US4] Complete previous-result/draft promotion, explicit inspection/export and unsaved-result close handling in `src/transcription/analysis.rs` and `src/ui.rs`, keeping a failed/cancelled draft separate from `last_complete` and avoiding persistent history or silent replacement.
- [ ] T062 [US4] Complete cancellation, stage/hard deadlines and terminal/reaping behavior in `src/transcription/jobs.rs` after T059, ensuring immediate UI acknowledgement, no indefinite heartbeat renewal, and no new analysis before the directly owned worker exits; preserve legacy scheduler semantics.
- [ ] T063 [US4] Run real saved-recording flows for microphone-only and combined capture with legacy live text enabled/disabled, no quality runtime then a provisioned one, using `tests/integration/live_recording.rs` and `tests/integration/speaker_analysis.rs`; verify audio is secured before analysis and record operator/device limits in `docs/transcription-speaker-validation.md`.
- [ ] T064 [US4] Execute replacement cancellation during ASR/diarization, injected worker failure, saturated queues, close/save/cancel and stale-result cases through `tests/integration/transcription_actions.rs` and `src/ui.rs`, then document SC-006/007 retention and <=2-second cancellation acknowledgement in `docs/transcription-speaker-validation.md`.

**Checkpoint**: Saved audio and useful text survive analysis failure. The four
stories are complete only after their recorded acceptance evidence passes.

## Phase 7: Polish and Cross-Cutting Validation

**Goal**: Prove a reproducible optional package and final acceptance, preserving
the core application and honest remaining limits. No unrelated cleanup.

- [ ] T065 Add failing package boundary tests in `workers/tests/test_quality_package.py` for complete runtime/asset hashes and notices, fixed worker location, missing DLL/resources, existing-output protection and cleanup confined to the owned staging directory before implementing `scripts/package-quality.ps1`.
- [ ] T066 Implement `scripts/package-quality.ps1` after T065 using the frozen `assets/quality/` locks/manifests, assembling separate validated CPU/CUDA optional profiles with the fixed worker and required notices; refuse downloads and overwrites and preserve the existing core `scripts/package.ps1` package behavior.
- [ ] T067 Validate both optional packages on a clean Windows account without developer caches/global Python/CUDA toolkit beyond declared prerequisites, exercising local readiness, CPU/GPU selection and unsupported-resource failures; record actual prerequisites, hashes and results in `docs/transcription-speaker-validation.md`.
- [ ] T068 Run cold/warm complete 10-minute and sustained 60-minute analyses, original input hashes, scratch-capacity/failure/owned-cleanup cases and existing long-input boundary checks through `tests/integration/speaker_analysis.rs` and `scripts/benchmark-conversations.ps1`; record peak RAM/VRAM and any unsupported long-input limits without silent truncation.
- [ ] T069 Execute the full disconnected and connected zero-attempt trace matrix for ASR-only, speakers, saved recordings and deliberately missing local resources, including child-tree inspection, through `specs/002-transcription-speaker-insights/quickstart.md`; record SC-008 proof in `docs/transcription-speaker-validation.md`, and if actual descendants exist require tested whole-owned-tree cleanup before acceptance.
- [ ] T070 Run the full existing/new cheap Rust and Python suites, explicitly selected real boundary checks, locked offline Cargo formatting/Clippy via `scripts/dev.ps1`, and audit actual cheap-unit versus boundary test counts in `docs/transcription-speaker-validation.md`; target >=90% cheap tests where feasible, document justified shortfalls and retain all necessary integration coverage.
- [ ] T071 Update `README.md`, `docs/development.md` and `docs/transcription-speaker-validation.md` with the measured profile choice, offline provisioning/notices, saved-recording/report usage, CPU/GPU requirements and actual limitations; preserve earlier staged edits and add no release entry, version change or tag recommendation.
- [ ] T072 Walk `specs/002-transcription-speaker-insights/quickstart.md` and the FR/SC coverage below against recorded evidence, confirm `main`/existing behavior/shared feature state were preserved, and finalize `docs/transcription-speaker-validation.md`; leave any unverified acceptance task unchecked and stop before release operations.

## Dependencies and Execution Order

### Phase dependencies

```text
Phase 1 Setup
  -> Phase 2 compatibility, corpus and first decision gate
    -> US1 quality transcription (MVP)
      -> US2 speaker identities
        -> US3 participation and report
          -> US4 full saved-recording/replacement flow
            -> Phase 7 package and final acceptance
```

US2 reuses US1's real worker/result transport. US3's pure calculations can be
tested from fixed intervals, but full reports consume US2 activity. US4's saved
start/cancellation tests need US1 only; its full report-retention/unsaved integration
uses US3. Delivery follows the numeric priority order to avoid shared-file conflicts.
These are real integration dependencies, not claims that every story ships alone.

### Foundational task dependencies

| Tasks | Prerequisites |
| --- | --- |
| T002, T003 | T001 |
| T004, T005, T006, T009, T011 | Phase 1 complete; test authoring is independent file work |
| T007 | T004, T006 |
| T008 | T005 |
| T010 | T009 |
| T012 | T008, T010, T011 |
| T013 | T002 and validated manifest format from T008 |
| T014 | T004, T007 |
| T015 | T006, T012, T014 and declared development references |
| T016 | T013, T015; settings frozen before held-out evaluation |
| T017 | T010, T012, T013; native eligibility checked before claiming applicable results |
| T018 | T004–T017, including actual required evidence |

### Within each story

Write and demonstrate the red cases first. Model/state implementation precedes
transport/job integration, which precedes UI wiring and native acceptance runs.
Each implementation task depends on its corresponding preceding tests, even where
not repeated inline. Later validation tasks rerun tests; they do not defer their
initial creation until after implementation. Newly found failures get a failing
regression before a fix.

### Parallel opportunities and examples

There are **20 `[P]` tasks**, grouped below. Each group starts only after its phase
prerequisites; run focused checks without concurrent mutation of shared files.

| Ready group | Independent file work |
| --- | --- |
| Setup | T002 fixture preparation documentation and T003 profile documentation |
| Foundation | T004 worker tests, T005 scoring tests, T009 native allowlist tests and T011 runner tests |
| US1 | T019 result tests, T020 Rust protocol tests, T021 Python protocol tests, T022 controller/settings tests and T023 UI tests |
| US2 | T033 result/controller/UI speaker tests, T034 Python diarization tests and T035 protocol/native case definitions |
| US3 | T045 pure participation tests, T046 result/UI formatting tests and T047 export boundary tests |
| US4 | T057 controller/live tests, T058 UI retention tests and T059 action/process boundary tests |

These groups are the per-story parallel execution examples. Do not run UI/result/
worker implementations from different stories concurrently: they share files and
depend on earlier semantics. Marking tests parallel does not authorize simultaneous
model benchmarks; hardware/timing measurements run serially on the declared device.

## Implementation Strategy

### MVP first

Complete setup and the first evidence gate, then US1 with speaker analysis off.
Demonstrate local PT/EN file transcription, explicit CPU/GPU choice, useful errors,
copy/save and measured accuracy improvement while core recording/live behavior
remains available. This is an internal validation/demo checkpoint, not release approval.

### Incremental delivery

Add speaker identities, then participation/reporting, then complete the saved-audio
and result-retention flow. Validate each story with fakes/fixed intervals before
expensive native runs. Reuse the proven pipeline rather than keeping a separate
benchmark implementation. Finish with optional packaging and the full acceptance
matrix. Do not expand to live speaker labels, semantic highlights, real names,
history, queues or additional import formats.

## Requirement and Success-Criteria Coverage

| Requirement | Principal tasks |
| --- | --- |
| FR-001 higher accuracy | T013–T018, T026, T029–T032 |
| FR-002 readiness/status/device | T004, T007, T019–T029, T062 |
| FR-003 offline/local assets | T003, T006–T007, T015, T031, T042, T066–T069 |
| FR-004 supported inputs/source preservation | T014, T024, T030, T041, T060, T063, T068 |
| FR-005 count/provenance/range | T033–T039, T041, T044 |
| FR-006 stable anonymous labels/timeline | T019, T024, T033–T041 |
| FR-007 unknown/overlap/no real identity | T014, T033–T040, T045, T048 |
| FR-008 transcript/person inspection | T040, T046, T051 |
| FR-009 speaking duration | T045, T048, T050, T055 |
| FR-010 speech share | T045, T049–T052 |
| FR-011 turn counts | T045, T049, T055–T056 |
| FR-012 coverage/speech/silence/overlap | T019, T024, T038, T045, T048–T050 |
| FR-013 rounding/explanation | T045–T046, T049–T052, T056 |
| FR-014 copy/save report and plain text | T023, T029, T046–T047, T052–T054, T061 |
| FR-015 optional/failed insights/retention | T019, T024, T033–T038, T042, T058–T064 |
| FR-016 secured audio and single-job/live behavior | T022, T027–T029, T057–T064 |
| FR-017 CPU baseline/resource failure | T006, T009–T010, T015–T018, T022, T028, T031, T043, T067 |
| SC-001 WER improvement | T005, T008, T013, T016, T018, T032 |
| SC-002 automatic count | T005, T008, T013, T033, T041, T044 |
| SC-003 DER | T005, T008, T013, T016, T041, T044 |
| SC-004 duration/arithmetic | T005, T008, T045–T056 |
| SC-005 speech-free/quiet controls | T004, T014–T016, T030, T032, T041 |
| SC-006 time/memory/cancellation | T015–T016, T020–T021, T027, T032, T043, T059, T062–T064, T068 |
| SC-007 preservation/export/partial status | T019–T023, T030–T032, T035, T038, T042, T046–T047, T052–T054, T057–T064, T068 |
| SC-008 disconnected and zero-attempt traces | T007, T015, T031, T042, T067, T069 |

## Generation and Governance Validation

Generated **72 tasks**: setup 3, foundation 15, US1 14, US2 12, US3 12, US4 8,
cross-cutting 8. All tasks have sequential IDs, unchecked checkboxes, exact paths
and the correct phase/story labels. This validates the task list, not implementation.

The setup workflow resolved feature 002 and the active core tasks template. It was
evaluated with its existing `Get-FeaturePathsEnv -NoPersist` mode in a process-local
wrapper to avoid changing the shared feature-003 selector; no repository script
was edited. Required/optional design inputs are present. Before/after task hooks
are skipped because `.specify/extensions.yml` is absent.

Validate content/links, dependency order, requirement coverage and preserved-file
hashes for this documentation-only generation. Runtime tests, model acquisition,
corpus measurements and executable edits belong to implementation. Completion
of this list never authorizes branch operations, product release entries or tags.
