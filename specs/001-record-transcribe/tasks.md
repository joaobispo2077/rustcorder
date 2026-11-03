# Tasks: Desktop Voice Recording and Transcription MVP

**Input**: Design documents in `specs/001-record-transcribe/`.

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts](contracts/desktop-and-worker.md), and
[quickstart.md](quickstart.md). Repository constitution 1.0.0 applies.

**Branch**: Work only on the existing `main` branch. Do not create/switch branches.

**Status**: Implementation and default automated checks pass as of 2026-11-02; required external acceptance remains open below.
All four stories remain required MVP scope.

**Speech-gate refinement (2026-11-02)**: After the observed noise/tone failure, T038/T045/T059 now include the explicitly documented offline Silero VAD asset and tests; T061 includes its pinned bytes/license. These checks are open until rerun. No target or required feature was removed.

**Execution refinement (2026-11-02)**: The user authorized continuing implementation
while external acceptance is pending. Native builds and all four CPU corpus
comparisons passed. Clean-machine packaging (T012), operator call checks and long
hardware runs remain required open acceptance items; they do not prevent independent
code/test work. No pending item is treated as passed or removed from MVP completion.

**Evidence reconciliation (2026-11-02)**: The default suite passes 88 library unit
and 62 integration cases, with four real-model/device cases ignored; formatting
and all-target Clippy pass. Checked implementation/test tasks do not imply their
story's real-device, corpus, UI or packaging acceptance is complete. See
[implementation validation](../../docs/implementation-validation.md) for failure-first
evidence, the library-unit share/exception and the FR/SC evidence mapping.

**Recorded refinements**: Scheduler and job logic is cohesive in
`src/transcription/live.rs` and `src/transcription/jobs.rs`, exposed through the
planned transcription module. Lower-layer/controller tests cover some proposed
scenario assertions without duplicate tests solely to match a file location.
T015/T025 remain open: their synthetic boundary suites now pass, but a separate
first-fail cycle and all named close/recovery/device scenarios have not been
demonstrated there. T026 remains open: selected-endpoint loopback is implemented,
but fixed-ID health polling replaces the specified notification registration;
actual disconnect/default-change acceptance is still T030. T066 remains open
despite the evidence table because its acceptance gaps are not yet resolved.

## Execution Rules

- Every task uses `- [ ] Tnnn [P?] [USn?] description with exact file paths`.
- `[P]` identifies tasks that can run together only after their prerequisites pass
  and when their files differ. It does not bypass a failing-test or feasibility gate.
- Write the listed tests before their matching behavior implementations and record
  an assertion-level failure, then demonstrate passing focused checks. Missing tools,
  missing models and compilation errors alone are not regression proof. Introduce
  only the minimal compiling seam needed to express a missing behavior.
- Register native/scenario tests in the Cargo-discovered `tests/integration.rs`
  harness as files are introduced; serialize harness edits when tests are written
  in parallel. Serialize shared Rust module-declaration edits too; only the
  distinct test bodies/files run in parallel. Unit tests stay next to their modules.
- Unit checks must run without hardware or large weights. Real device/model tests
  remain explicit, separately invoked checks; lack of assets is pending, not a pass.
- Prefix shell commands with `rtk`; use `rtk proxy` for unsupported commands.
- Store concise failure/pass evidence and benchmark results in
  `docs/implementation-validation.md`. Do not put private call audio, large model
  weights or machine-identifying secrets in Git. Record actual hardware class,
  model hash, build, devices and test conditions needed to reproduce measurements.
- Dependency versions in research are candidates, not an already tested lockfile.
  No runtime cloud, downloader, telemetry, online activation or network listener.
- The proposed six-hour recording limit is the plan's RIFF safety choice. Disclose
  it in UI/docs and test the byte/frame boundary without a six-hour automated run;
  do not imply unlimited duration or silently modify the stated one-hour criteria.

## Phase 1: Setup (Shared Infrastructure)

**Goal**: A reproducible Windows package and discoverable tests, without speculative
module scaffolding. No feature behavior is complete at this checkpoint.

- [X] T001 Initialize the single `rustcorder` Cargo package in `Cargo.toml`, `src/main.rs` and `src/lib.rs`, preserving existing instructions/docs and adding modules only as their tasks need them.
- [X] T002 Verify Rust MSVC, Windows SDK/C++ tools, CMake and LLVM/Clang prerequisites; resolve the researched native UI/audio/ASR dependencies with minimal features in `Cargo.toml`, pin the tested toolchain in `rust-toolchain.toml`, and create a compatible `Cargo.lock` through a successful Windows build; record actual prerequisites in `docs/implementation-validation.md`.
- [X] T003 [P] Establish the discoverable integration harness in `tests/integration.rs` and fixture guidance in `tests/fixtures/README.md`, separating synthetic unit inputs from explicitly supplied real-model/device tests and recording speech/reference-text provenance and normalization rules.
- [X] T004 [P] Add generated build/model/private recording exclusions in `.gitignore` and document local model preparation, initial offline package prerequisites and bounded validation commands in `docs/development.md`, without adding a release pipeline.

**Checkpoint**: T001–T004 complete; locked native dependencies build on Windows.

## Phase 2: Foundational (Blocking Prerequisites)

**Goal**: Establish minimal state/settings and the retained inference boundary, then
prove that the selected native stack is viable before expanding the application UI.

- [X] T005 Add failing controller tests in `src/app.rs` for one active task, immutable active configuration, source/storage preflight errors, distinct audio/text completion, and Start blocked while an earlier transcript is finalizing.
- [X] T006 Implement only the shared controller values, transitions, command guards and actionable error categories exercised by T005 in `src/app.rs`; keep external operations injectable with small explicit seams rather than a general service framework.
- [X] T007 Add failing settings tests in `src/settings.rs` for missing/corrupt/newer-schema data, remembered paths/endpoint IDs/language, no persisted readiness or transcript content, and old-file preservation on failed replacement.
- [X] T008 Implement schema-version-1 local JSON settings and verified Windows atomic replacement behavior in `src/settings.rs`, using `%LOCALAPPDATA%/rustcorder/settings.json` and revalidation flags instead of silently trusting saved paths.
- [X] T009 Add failing fake-worker contract tests in `tests/integration/worker_protocol.rs` for bounded framing/PCM, partial reads/writes, malformed/native stdout, bounded stderr, EOF/crashes/hangs, duplicate/stale generations, cancellation, deadlines and child reaping; register through `tests/integration.rs`.
- [X] T010 Implement the same-executable hidden worker entry before UI startup in `src/main.rs` and the minimal supervisor/framing/model-load/window-inference path in `src/transcription/mod.rs` and `src/transcription/worker.rs`, making T009 pass; only the child may call native inference/model APIs, and no shell/socket is permitted.
- [X] T011 Use the retained worker with declared multilingual base/small assets and prepared mono PCM Portuguese/English fixtures in `tests/integration/asr_feasibility.rs` to measure native load, raw-window inference time/throughput, clean-speech word error and silence/quiet-speech behavior; record model SHA-256, CPU/RAM, thread count and GPU-disabled state in `docs/implementation-validation.md`, preserving failures before tuning and labeling these as feasibility estimates rather than completed live-pipeline proof.
- [ ] T012 Perform an initial clean Windows parent/child launch and native-runtime packaging smoke test from the T002 build, recording required shipped runtime files and actual T011 outcomes in `docs/implementation-validation.md`; stop dependent work on an unmet native-build/ASR gate and report measured alternatives without cloud fallback or silently weakened criteria.

**Checkpoint**: T005–T012 pass. Retain this small worker implementation; do not
build a second inference path for later stories. Unknown performance is resolved by
measurements, not by claiming model sizes imply target accuracy/speed. If silence
gating cannot pass, make an explicit compatible local VAD-asset decision and update
affected design/tasks before adding it; do not invent a hidden model dependency.
The early gate proves native compatibility and whether a CPU model is a viable
candidate. It does not require building the later live scheduler in foundation or
prove end-to-end phrase latency/finalization: T058–T060 own that evidence.

## Phase 3: User Story 1 — Record My Voice (Priority: P1)

**Goal**: Deliver the smallest useful app: microphone recording and reliable saving.

**Independent Test**: With transcription disabled, select a mic/folder, speak,
stop, open the WAV in an ordinary player, then restart the app and confirm the file
remains. Check missing access, unwritable output and an existing filename safely.

### Tests First

- [X] T013 [P] [US1] Add failing WAV/file tests in `src/recording.rs` for unique create-new paths, streamed PCM/header correctness, explicit finalization/write failures, partial output and the RIFF safety boundary without allocating a full long recording.
- [X] T014 [P] [US1] Add failing audio-core tests in `src/audio/mod.rs` for device-format normalization, mono-to-stereo conversion, frame-based duration, silence handling and bounded capture/writer queues with visible overflow rather than silent drops.
- [ ] T015 [P] [US1] Add failing action/integration tests in `tests/integration/microphone_recording.rs` for source/destination preflight, Start/Stop, second-session rejection, interrupted/save-failed outcomes and close/save/cancel, using synthetic capture and injected write errors.

### Implementation and Validation

- [X] T016 [US1] Implement non-overwriting streaming 48 kHz stereo PCM16 WAV creation/finalization and bounded-size stop in `src/recording.rs`, making T013 pass and preserving recoverable partial-file paths honestly.
- [X] T017 [US1] Implement mic endpoint enumeration/stable IDs and shared-mode mic capture in `src/audio/windows.rs`, with COM initialization/client lifetime on the owning thread and prompt packet release into bounded queues.
- [X] T018 [US1] Implement normalized microphone resampling, bounded mixer/writer delivery, frame-count timing and Stop/drain behavior in `src/audio/mod.rs`, making T014 pass without capture-thread disk or inference waits.
- [X] T019 [US1] Bind mic/source/save-folder settings, guarded session lifecycle and save-independent close handling in `src/app.rs` and `src/settings.rs`, making T015 pass with no model requirement when live transcription is off.
- [X] T020 [US1] Implement the native eframe Record screen and rfd folder selection in `src/ui.rs` and `src/main.rs`, including mic choice, input indication, elapsed time, Start/Stop, visible six-hour limit, disabled conflicting controls and actual saved/partial/error paths.
- [X] T021 [US1] Integrate microphone permission/device-loss/sleep and disk-full/finalization failures across `src/audio/windows.rs`, `src/recording.rs` and `src/app.rs`, extending the earlier failure-first tests before any newly exposed handling and preventing false Recording/Completed states.
- [ ] T022 [US1] Run focused synthetic checks and a short real-mic start/speak/stop/play/restart plus close/cancel/folder-error pass using `tests/integration/microphone_recording.rs`; record audible results, SC-001 timing and recovery outcomes in `docs/implementation-validation.md`.
- [ ] T023 [US1] Run the 60-minute microphone acceptance case and measure stop/save timing, scheduled-phrase retention, file duration/readability and bounded memory using `tests/integration/microphone_recording.rs`; record SC-002 evidence in `docs/implementation-validation.md` before declaring US1 complete.

**Checkpoint / first usable increment**: Microphone recording works independently
with live transcription off. This is a demonstration checkpoint, not permission to
remove the other three required capabilities or publish a release.

## Phase 4: User Story 2 — Record Both Sides of a Call (Priority: P1)

**Goal**: Add reliable microphone plus selected computer-output capture.

**Dependency**: US1's capture/writer/lifecycle is required. Transcription is not.

**Independent Test**: With headphones and transcription off, record alternating and
overlapping local/remote phrases in operator-arranged Meet and Discord tests. Both
sides must be audible even when the mic does not pick up the computer output.

### Tests First

- [X] T024 [P] [US2] Add failing timestamp/alignment tests in `src/audio/mod.rs` for unequal source rates, startup offsets, independent clock drift, packet flags, conservative stereo mixing and healthy silent-output timeline advancement.
- [ ] T025 [P] [US2] Add failing combined-source action tests in `tests/integration/combined_recording.rs` for missing either source, all-or-nothing startup/cleanup, no silent single-source fallback, default-device changes, device invalidation and unrecoverable discontinuity/overflow.

### Implementation and Validation

- [ ] T026 [US2] Extend `src/audio/windows.rs` with selected render-endpoint shared/event-driven loopback capture, timestamp/flag transport, endpoint notifications and cleanup of partially started combined sessions.
- [X] T027 [US2] Implement common-timeline alignment, rubato drift/rate adjustment and headroom-preserving mic/output mix in `src/audio/mod.rs`, making T024 pass without blocking mic audio when a healthy output produces no packets.
- [X] T028 [US2] Bind the combined mode/output selector and whole-output/notification capture notice in `src/app.rs`, `src/ui.rs` and `src/settings.rs`, freezing selected source IDs during capture and making combined startup tests pass.
- [X] T029 [US2] Complete combined-source interruption/finalization handling in `src/audio/windows.rs`, `src/audio/mod.rs` and `src/app.rs`, making T025 pass while preserving partial audio and avoiding automatic source replacement.
- [ ] T030 [US2] Exercise quiet output, 44.1/48 kHz device combinations, selected-source disconnects, default changes and sleep using `tests/integration/combined_recording.rs`; record real-device results in `docs/implementation-validation.md`.
- [ ] T031 [US2] Execute separate operator-arranged Google Meet and Discord headphone acceptance runs from `specs/001-record-transcribe/quickstart.md`, verifying both voices, overlap and unrelated output sounds without bots/account links; record SC-003 evidence in `docs/implementation-validation.md`.
- [ ] T032 [US2] Run the one-hour combined capture with known beginning/end alignment signals through `tests/integration/combined_recording.rs`, proving no missing scheduled phrases and <=250 ms relative alignment plus stop/save bounds; record SC-002 evidence in `docs/implementation-validation.md`.

**Checkpoint**: Both recording modes deliver playable files without transcription.

## Phase 5: User Story 3 — Transcribe an Existing Recording (Priority: P2)

**Goal**: Add model-folder configuration, offline file transcription and text export.

**Dependency**: Foundation worker/settings/controller. This story can be verified
without recording stories, although the default execution order finishes P1 first.
Shared `src/app.rs`/`src/ui.rs` edits must be integrated serially with recording work.

**Independent Test**: Select a compatible local model and WAV/MP3 file, transcribe
offline in Portuguese, repeat English with a supporting model, copy/save text and
verify the original audio hash is unchanged. Check cancellation and invalid assets.

### Tests First

- [X] T033 [P] [US3] Add failing folder/language tests in `src/models.rs` for supported direct-folder files, actual detected capabilities, renamed `.en` rejection for Portuguese, mixed valid/invalid candidates, unavailable assets and remembered-but-revalidated selections.
- [X] T034 [P] [US3] Add failing file-processing tests in `tests/integration/file_transcription.rs` for WAV/MP3 decode/resampling, corrupt/unsupported/empty/unreadable inputs, silence/quiet speech, Portuguese/English output, progress/cancel/retry and unchanged original hashes.
- [X] T035 [P] [US3] Add failing export/job-guard tests in `tests/integration/transcription_actions.rs` for single-job/conflicting-start guards, partial/completed UTF-8 copy/save, incomplete labels, overwrite protection, export retry and close with unsaved text.

### Implementation and Validation

- [X] T036 [US3] Implement immediate-folder candidate discovery, serial child validation with progress/cancel, supported-model/language selection and metadata-based readiness in `src/models.rs`, using the retained worker rather than loading native models in the parent.
- [X] T037 [US3] Add incremental Symphonia WAV/PCM/MP3 decode and mono 16 kHz normalization/resampling to `src/transcription/worker.rs`, reusing the inference path and producing bounded progress/segment events without modifying the input.
- [X] T038 [US3] Implement tested silence gating, explicit `pt`/`en` selection, disabled translation/detection and distinct no-speech/decode/model errors in `src/transcription/worker.rs`, making T034 pass without automatic model downloads or fallback.
- [X] T039 [US3] Complete file-job supervision, progress assembly, stale-event rejection, cancellation/deadline cleanup and retry in `src/transcription/mod.rs`, reusing T009 protections and retaining completed partial text on failure.
- [X] T040 [US3] Add the Transcribe file tab, WAV/MP3 picker and shared model-folder/model/language/readiness controls in `src/ui.rs`, keeping loading off the UI thread and plain recording usable when transcription is unavailable.
- [X] T041 [US3] Implement finalized transcript presentation and non-overwriting UTF-8 export/clipboard actions with incomplete labels and retryable save failure in `src/transcription/transcript.rs` and `src/ui.rs`, satisfying T035 text-outcome checks.
- [X] T042 [US3] Bind persisted model/folder/language choices and restart/missing-file revalidation in `src/settings.rs`, `src/models.rs` and `src/app.rs`, preventing invalid/absent English assets from blocking usable Portuguese models.
- [X] T043 [US3] Integrate file-task/model-operation guards and close/cancel/unsaved-text handling in `src/app.rs` and `src/ui.rs`, making T035 pass and rejecting new capture/transcription while earlier work or finalization is active.
- [ ] T044 [US3] Run offline WAV/MP3 Portuguese and optional English acceptance through `tests/integration/file_transcription.rs`, verifying matching-language text, Unicode copy/export and unchanged inputs; record FR-016/FR-017 outcomes in `docs/implementation-validation.md`.
- [ ] T045 [US3] Run model/input negative cases and restart recovery through `tests/integration/file_transcription.rs` and `tests/integration/transcription_actions.rs`, including corrupt/incomplete/multiple models and speech-free inputs; record actionable statuses and no fallback in `docs/implementation-validation.md`.
- [ ] T046 [US3] Exercise cancellation, worker crash/hang, retry, incomplete export and close-with-unsaved-text through `tests/integration/transcription_actions.rs`, proving original audio and available finalized words survive; record results in `docs/implementation-validation.md`.
- [ ] T047 [US3] Measure the completed imported-file pipeline against the declared >=10-minute clean Portuguese/English sets for <=20% word error and <=duration processing time, using `tests/integration/file_transcription.rs`; record SC-004/SC-005 model-specific evidence in `docs/implementation-validation.md` and stop on unmet targets.

**Checkpoint**: Existing-file transcription works without a recording session or
network connection, using only compatible local assets and user-selected storage.

## Phase 6: User Story 4 — Read Transcription While Recording (Priority: P2)

**Goal**: Combine the proven capture and inference paths without risking audio.

**Dependencies**: US1 + US3 for microphone live text; US2 is additionally required
for the complete combined-source acceptance scope. All are required for completion.

**Independent Test**: Enable live text in each capture mode, speak separated phrases,
verify text before Stop, then verify independently saved audio and final/explicitly
incomplete text. Kill the worker and confirm recording continues.

### Tests First

- [X] T048 [P] [US4] Add failing transcript-window tests in `src/transcription/transcript.rs` for absolute sample offsets, stable-boundary monotonicity, pending replacement, time/token deduplication that preserves genuinely repeated phrases, silence coverage and incomplete-gap permanence.
- [X] T049 [P] [US4] Add failing live scheduler tests in `src/transcription/mod.rs` for one in-flight/one latest pending window, bounded sample payloads, skipped-coverage detection, lag without audio blocking, stale results and Stop/final-tail deadline handling.
- [X] T050 [P] [US4] Add failing lifecycle/fault integration tests in `tests/integration/live_recording.rs` for both capture modes, worker crash/hang/cancel, finalized-text retention, audio-save independence and new Start blocked during prior finalization.

### Implementation and Validation

- [X] T051 [US4] Implement bounded rolling-window scheduling and sample-range coverage bookkeeping in `src/transcription/mod.rs`, using the 8-second/2-second research candidate only as a tunable starting point and making T049 queue checks pass.
- [X] T052 [US4] Implement timestamp/token overlap reconciliation, revisable tail and stable segment commits in `src/transcription/transcript.rs`, making T048 pass without deleting legitimate repeated speech or hiding coverage gaps.
- [X] T053 [US4] Connect the mixed recording stream to an independent bounded mono 16 kHz ASR branch in `src/audio/mod.rs` and `src/transcription/mod.rs`, preserving the writer's ownership/priority and never feeding inference delay into capture backpressure.
- [X] T054 [US4] Bind the live toggle, selected immutable model/language snapshot and pending/final/lagging/incomplete presentation in `src/app.rs` and `src/ui.rs`, covering microphone and combined modes while keeping copy/save available for stable partial text.
- [X] T055 [US4] Implement bounded final-tail flushing, 30-second finalization deadline, explicit incomplete results and cancel/close guards in `src/transcription/mod.rs` and `src/app.rs`, making T049/T050 pass with audio capture stopped and saved before text finishes.
- [ ] T056 [US4] Run real worker termination/protocol-failure/hang during recording in `tests/integration/live_recording.rs`, proving the parent continues capture, retains finalized text and saves playable audio; record SC-008 evidence in `docs/implementation-validation.md`.
- [ ] T057 [US4] Stress slow/CPU-heavy inference and independently induced writer pressure through `tests/integration/live_recording.rs`, verifying bounded memory, ASR gaps labeled incomplete and capture/storage failures reported rather than silently dropped; record conditions in `docs/implementation-validation.md`.
- [ ] T058 [US4] Measure Portuguese and selected-English live transcription in both recording modes using >=20 separated phrases over ten minutes plus clean reference text, through `tests/integration/live_recording.rs`; record SC-004/SC-006 accuracy and >=95% <=5-second phrase latency in `docs/implementation-validation.md`.
- [ ] T059 [US4] Verify quiet speech, silence, repeated phrases, overlapping-window revisions and deliberate uncovered periods in `tests/integration/live_recording.rs`, confirming no duplicated stable tail, no fabricated speech on the declared speech-free set and no false Completed label.
- [ ] T060 [US4] Execute final-tail Stop, delayed/failing transcript save, cancel-close and new-session-after-finalization acceptance from `tests/integration/live_recording.rs`, recording independent <=1-second capture stop, <=5-second audio-save indication and <=30-second text outcome in `docs/implementation-validation.md`.

**Checkpoint**: Live text works in both modes, with audio surviving transcription
failure and all stated performance/quality claims backed by reference-machine evidence.

## Phase 7: Polish and Cross-Cutting Completion

**Goal**: Prove the complete packaged MVP; no unrelated cleanup or extra features.

- [ ] T061 Package the completed Windows executable and its actually required native runtime/license files using the locked `Cargo.toml`/`Cargo.lock` build, then validate clean disconnected first launch and parent/child operation; document reproducible packaging in `docs/development.md` and results in `docs/implementation-validation.md`.
- [ ] T062 Run all four capabilities with network disabled and separately trace connected parent/child network attempts/listeners per `specs/001-record-transcribe/quickstart.md`, using local played audio for disconnected combined capture; record SC-010/SC-011 and zero app network activity in `docs/implementation-validation.md`.
- [ ] T063 Verify keyboard-only operation, visible names/errors, Narrator/AccessKit and Windows display scaling for both tabs, model selection and close/export flows in `src/ui.rs`; add a failing reproducer before fixing any discovered issue and record outcomes in `docs/implementation-validation.md`.
- [ ] T064 Run formatting, locked all-targets Clippy, unit/integration checks and required real-device/model acceptance from `specs/001-record-transcribe/quickstart.md`; record the actual cheap-unit-test ratio, justified exceptions, benchmark failures and any unexecuted checks in `docs/implementation-validation.md` without padding counts.
- [X] T065 Update `README.md`, `docs/project-overview.md`, `docs/development.md` and `specs/001-record-transcribe/quickstart.md` with verified run/build/model/packaging steps, format/language/recording-limit support and recovery behavior, removing planned-only claims only where implementation evidence exists.
- [ ] T066 Reconcile FR-001–FR-022 and SC-001–SC-011 against the evidence in `docs/implementation-validation.md` and this `specs/001-record-transcribe/tasks.md`, checking only genuinely completed tasks and reporting remaining limits while preserving `main`; do not add a release entry, recommend tags or execute release actions here.

## Dependencies and Execution Order

```text
Setup T001–T004
  -> Foundation T005–T012 (native-build/ASR feasibility gate)
       -> US1 T013–T023 -> US2 T024–T032
       -> US3 T033–T047 (independent file-transcription proof)
            US1 + US3 -> microphone live text
            US1 + US2 + US3 -> complete US4 T048–T060
                 -> Completion T061–T066
```

Default sequential order is task-ID order. The graph shows conceptual story
dependencies, not permission to edit shared files concurrently. For US3-first work,
provide the same minimal native shell rather than depending on US1's UI implementation;
serially integrate `src/app.rs`, `src/ui.rs`, `src/main.rs` and settings changes.

Within phases, pair tests with implementation: T005->T006, T007->T008, T009->T010;
T013->T016, T014->T017/T018, T015->T019–T021; T024->T026/T027,
T025->T026/T028/T029; T033->T036/T042, T034->T037/T038,
T009+T035->T039–T043; T048->T052, T049->T051/T053/T055,
T050->T053–T055. Validation tasks follow their completed slice; no test may be
checked off as passing because later implementation has not yet been written.

## Parallel Opportunities and Examples

The only marked parallel batches are independent files after the relevant phase's
entry dependencies. Register scenario modules in the harness serially before running
them. Do not concurrently edit implementation files just because stories differ.

| Phase/story | Parallel batch | Shared work kept serial |
| --- | --- | --- |
| Setup after T002 | T003 harness/fixture guidance + T004 exclusions/development docs | Cargo/toolchain changes |
| US1 after foundation | T013 recording tests + T014 audio tests + T015 scenario tests | Controller/UI/audio adapter integration |
| US2 after US1 | T024 alignment tests + T025 combined scenario tests | Shared audio module and source lifecycle implementation |
| US3 after foundation | T033 model tests + T034 file scenario tests + T035 action/export tests | Native worker, settings, controller/UI integration |
| US4 after prerequisites | T048 overlap tests + T049 scheduler tests + T050 live scenario tests | ASR branch, controller/UI binding and finalization |

These are concrete per-story examples, not new tasks or independent worktrees.
All implementation follows already-failing tests and the relevant feasibility gate.

## Requirements Traceability

| Requirement/outcome | Primary task coverage |
| --- | --- |
| FR-001–FR-003: modes, source selection, visible states | T005/T006, T015/T019/T020, T025/T028, T050/T054 |
| FR-004/FR-005: combined capture/scope | T024–T032 |
| FR-006–FR-008: safe WAV/startup/interruption | T013–T023, T025/T029/T030 |
| FR-009/FR-010: imports/progress/cancel | T034, T037–T040, T044–T046 |
| FR-011: complete/partial Unicode export | T035/T041/T046, T054/T059/T060 |
| FR-012–FR-014: live text, independent save, failure survival | T048–T060 |
| FR-015/FR-019: concurrency, close and task guards | T005/T006/T015/T019, T035/T043/T046, T050/T055/T060 |
| FR-016/FR-017: offline/Portuguese/optional English | T011/T012, T033/T036/T038/T044, T058/T062 |
| FR-018/FR-021/FR-022: model readiness/folder/persistence | T007/T008, T033/T036/T040/T042/T045 |
| FR-020: no-speech result | T011/T034/T038/T045/T059 |
| SC-001–SC-003: capture usability/duration/calls | T022/T023, T030–T032, T060 |
| SC-004–SC-006: accuracy/throughput/live latency | T011/T047/T058/T060 |
| SC-007–SC-009: honest failures, survival, Unicode/no overwrite | T013–T015/T021, T025/T029, T034/T035/T045/T046, T050/T056/T057/T059/T060 |
| SC-010/SC-011: offline operation and model cases | T033/T036/T042/T044/T045, T061/T062 |

## Implementation Strategy

Deliver the smallest working microphone-only increment after setup/foundation,
verify it independently, then add combined audio, file transcription and live text.
Do not discard any of the four requested capabilities because the first increment
is usable. Keep source/model/storage failures observable and retain audio priority.
Run focused proof after each behavior slice; broaden checks when integration changes
or an unresolved risk justifies them. The one-hour tests and final disconnected
package pass are required evidence, not tests to repeat on every small change.

This command creates tasks only. `/speckit-implement` executes them. Task completion
is not user approval of a product release; changelog release entries and tag actions
remain subject to the separate constitutional gates.
