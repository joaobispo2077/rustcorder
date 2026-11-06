# Implementation validation

## Current status: implementation present, acceptance incomplete

The four requested capabilities now have implementation and automated checks.
This is not a completed MVP acceptance claim. Real microphone/output activation,
Meet/Discord calls, one-hour recording runs, full live phrase measurements,
disconnected clean-machine launch and accessibility checks remain open. The user
authorized continued implementation while these external checks remain pending.
The checked task boxes identify completed implementation/test work, not a release.

The dated notes below preserve the order of observed failures and passing checks;
early setup counts describe those earlier checkpoints only. The latest verification
snapshot and requirement mapping follow the feasibility results.

## 2026-11-02: initial setup history

- Requirements checklist: 16 complete, 0 incomplete; implementation was authorized.
- Actual Git branch: main. Existing uncommitted governance/design files preserved.
- T001 complete: single Cargo package with binary/library entry points, edition 2024.
  `rtk proxy cargo build --offline` and `rtk proxy cargo test --offline` pass on the
  initially installed Rust 1.95.0 Windows GNU toolchain. There are no behavior tests
  or application features yet; zero tests is not acceptance evidence.
- T002 in progress: the installed compiler host is x86_64-pc-windows-gnu, correcting
  the earlier planning assumption that MSVC Rust was already present. Visual Studio
  2022 Build Tools 17.5.4, MSVC 14.35.32215, Windows SDK 10.0.22000.0, bundled CMake
  and Ninja were found. They were absent from the inspected PATH, not uninstalled.
  Preparing an isolated MSVC Rust toolchain under ignored .build/ without changing
  the global Rust installation or user PATH.
- Added Rust/build exclusions before downloading project-local development tools.
  No Docker, JavaScript publishing or infrastructure tooling exists; unrelated
  ignore/config files were not created.
- User-supplied existing model assets were inspected by path/name/size only. The
  faster-whisper large-v3 snapshot has model.bin, config/tokenizer/vocabulary files
  in CTranslate2 layout; it is not the planned whisper.cpp GGML pack. WhisperX and
  faster-whisper package directories are Python runtimes, not interchangeable
  whisper.cpp weights. Existing assets were not modified, copied or downloaded.
- No benchmark recording/reference text has been provided yet. Actual model/build
  compatibility and all accuracy/latency/device/packaging gates remain pending.

This log records proof as it occurs; a setup build is not a completed recorder.

## Native build and fixture setup

- T002 complete: project-local Rust 1.95.0 MSVC toolchain, lockfile and dependencies
  successfully built with `scripts/dev.ps1 build --locked --offline` (1m14s after
  correcting native binding generation). Versions are recorded in Cargo.lock.
- The first restricted-environment MSBuild launch stopped making progress; its
  verified project-owned process tree was stopped before retrying. The unrestricted
  native build progressed. No unrelated application or global Rust setup was changed.
- Attempting the shipped whisper-rs-sys bindings failed Windows layout assertions
  for Linux stdio structs (E0080). Kept failure evidence in this note and switched
  to target-generated bindings using project-local libclang 18.1.1. The native
  library and Rust wrapper now compile; this is not inference-quality proof.
- `scripts/dev.ps1` initializes the installed VS environment and supports the
  isolated local toolchain. Fixed argument forwarding after PowerShell's advanced
  parameter binding intercepted Cargo's `-p`; verified a deliberately nonexistent
  package reaches Cargo and returns the expected package-ID error. A resulting
  overbroad clean removed generated build cache only; sources were untouched.
- Initial reference CPU read from Windows registry: Intel Core i7-11800H, 16 logical
  processors. No full memory inventory or model-speed measurement has been made yet.
- User approved downloading compatible multilingual models for development only:
  ggml-base.bin, 147951465 bytes,
  SHA-256 60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe;
  ggml-small.bin, 487601967 bytes,
  SHA-256 1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b.
  Both match the upstream model repository's published hashes. Assets are ignored
  local files; no application downloader was added.
- T003 complete: discoverable integration-test entry and fixture provenance,
  isolation and WER normalization policy documented. Real data/device checks remain
  separately invoked and pending; zero-test setup runs are not acceptance evidence.
- Prepared ignored Google FLEURS development fixtures, CC BY 4.0, revision
  70bb2e84b976b7e960aa89f1c648e09c59f894dd: 50 pt_br WAVs totaling 603.24 seconds
  and 68 en_us WAVs totaling 610.08 seconds. Hash, mono 16 kHz float32 WAV layout
  and frame counts verified. Corpus references are not independently human-checked;
  these are development-feasibility inputs, not completed product acceptance.
- T004 complete: Rust/native output exclusions and verified Windows development
  instructions are present; local doc links and whitespace checks pass.
- T005/T006 complete: controller test-first proof using
  `scripts/dev.ps1 test --locked --offline --lib app::`: 12 assertion failures
  before implementation, then 12 passing tests. Covers task/configuration guards,
  model readiness, source/destination preflight, distinct capture/text outcomes,
  previous-finalization blocking and transcription failure not stopping capture.
- Controller review found an early-success transition: a live job could claim
  Completed/NoSpeech before capture stopped. Added a regression test, observed the
  expected assertion failure, then restricted successful terminal outcomes to
  post-stop/file states. The controller suite now passes 13 tests. The corrected
  transition preserves Stop -> Finalizing even when a native audio window ends.
- T007/T008 complete: settings tests compiled and failed before implementation
  (10 assertions failed, one existing behavior passed; the added default-path test
  also failed), then all 12 settings tests passed. Actual Windows replacement,
  readonly-destination failure, partial-write failure and temp-name collision were
  exercised; prior settings survived failures. Tests use owned target/settings-tests
  directories because this environment denied replacements in system temporary storage.
- T009 complete: 24 worker-contract tests compiled against minimal transport/
  supervisor seams; 21 assertion-level failures and 3 passing negative cases were
  observed before implementation. The fake std-only child compiled inside the
  workspace. Tests cover framing/PCM bounds, short I/O, invalid output, hang/crash,
  cancellation/reaping, duplicate/stale results and bounded stderr draining.
- T010 complete: all 24 protocol/supervisor tests now pass. Six native-helper tests
  also followed assertion-level red -> green. Full default run: 31 unit tests and
  24 integration-harness tests passed; no device/model assets are needed for that run.
- Real child-process smoke passed using downloaded base weights and an eight-second
  Portuguese corpus excerpt: Ready -> valid actual base/multilingual metadata ->
  model loaded -> digital-silence NoSpeech -> nonempty speech segments -> clean
  Shutdown. Total validate/load/infer sequence 11.751 seconds; this is not isolated
  inference latency or accuracy proof. Native stdout remained valid JSON only.
- Child CPU inference uses eight threads on the 16-logical-processor reference
  host. Physical RAM read through Windows API: approximately 63.77 GiB.
- Whole-clip worker-compatible manifests prepared without cropping reference speech:
  pt_br 52 clips / 611.28 seconds (maximum 15.9 s); en_us 70 clips / 600.96 seconds
  (maximum 16.38 s). Each fits the 1 MiB/262144-sample private-window contract.
- Native MSBuild worker communication also stalled on the first restricted lint
  build; restarted only its verified project-owned process tree outside that
  restriction. Do not mistake this environment issue for a code/benchmark failure.
- Final foundation review found two supervisor gaps: matching-ID events could
  claim the wrong audio interval, and a Shutdown Error could count as successful
  exit. Added two regressions, observed both assertion failures, then enforced
  requested coverage and clean shutdown exit. Protocol suite now passes 26 cases.
- Benchmark scoring helpers followed four assertion failures -> four passing
  tests, including Unicode NFC/diacritics, word edits, percentiles and SHA parsing.
  Full default run now passes 31 unit tests plus 30 integration-harness cases;
  the separately selected real-corpus benchmark is explicitly ignored, not counted
  as passing. Clippy all-targets passed before these last narrow protocol fixes;
  a final rerun remains required.
- After final regression fixes, the default suite again passes: 31 unit cases,
  30 integration-harness cases and one explicitly ignored corpus test. Both new
  supervisor regressions were observed failing first, then passing. Model-missing
  and corrupt-file real-child probes return structured invalid-model results with
  clean JSON stdout and normal EOF exit. Root-wide Clippy passed for the foundation
  and scoring harness before these last two narrow fixes.
- First T011 corpus measurement passed: CPU-only base/Portuguese, 52 whole clips,
  611.28 seconds of FLEURS speech; total model load plus inference 148.57 seconds,
  aggregate word error rate 0.1408. Report retained under ignored
  `.build/benchmarks/base-pt-initial-default-context.json`. Uses the corpus's
  normalized reference field with original text retained; no cropping/reference
  edits were made to improve scores. English and small-model comparisons pending.
- Reference GPU inventory: Intel UHD Graphics and NVIDIA GeForce RTX 3070 Laptop
  GPU. The current inference baseline remains CPU-only; no GPU backend was enabled.


## Completed CPU feasibility comparison

All four explicitly selected offline corpus runs passed WER <=20% and model time <=audio duration. Raw whole-clip latency is not live phrase latency.

| Model/language | Audio seconds | Load+inference seconds | WER | Raw p95 seconds |
| --- | ---: | ---: | ---: | ---: |
| base/pt | 611.28 | 148.57 | 14.08% | 4.58 |
| base/en | 600.96 | 68.86 | 9.74% | 1.15 |
| small/pt | 611.28 | 182.51 | 6.78% | 3.98 |
| small/en | 600.96 | 360.12 | 5.98% | 6.52 |

All returned NoSpeech for exact digital silence. Quiet-speech/noise acceptance remains separate; references are FLEURS dataset text, not independently human audited. Full reports remain ignored under .build/benchmarks. No experimental context tuning was applied. T011 feasibility comparison is complete; end-to-end file/live acceptance remains open.

The user authorized continued implementation on 2026-11-02 with clean-machine and manual acceptance still tracked. No clean Windows VM is available; T012 remains open rather than counting developer-machine launch as clean-machine proof.

## Recording, file transcription and live implementation

- WAV writer (T013/T016): the compiling seam produced 11 assertion failures and one
  passing negative case; implementation then passed all 12 unit cases. Checks cover
  unique create-new filenames, actual disk reopen/PCM headers, streaming 48 kHz
  stereo PCM16, finite input, recoverable interrupted output, injected write/seek/
  flush failures and the six-hour frame boundary using a small injected limit.
  Headers are checkpointed during recording; a failed finalization cannot claim
  Completed. A short synthetic file is not long-duration/hardware acceptance.
- Audio core (T014/T017/T018/T024/T027/T029): nine initial assertions failed before
  implementation, then passed. Added sleep/clock-step proof failed before its fix
  (12 passed, one failed), then all 13 passed. Resampling, quiet-output resume,
  bounded independent-clock drift and invalid-endpoint checks brought the suite to
  16 passing cases. Later ASR-failure coverage brought it to 18. Capture uses
  selected fixed endpoint IDs, owning-thread COM/client lifetime, prompt packet
  release, bounded delivery, a common QPC timeline and independent WAV ownership.
  Source failure, discontinuity, overflow and sleep/clock jumps stop the affected
  session with partial-audio status rather than silently dropping a source.
- Native loopback is implemented, but endpoint health uses fixed-ID `GetState`
  polling (at most 30 ms while idle), not registered endpoint-notification callbacks
  as T026 originally specifies. The selected source is never replaced by a new
  default. T026 remains open for this explicit plan deviation to be resolved;
  actual disconnect/default-change behavior still needs the T030 device run.
- The registered microphone scenario suite passes five cases with one actual-device
  case ignored; combined capture passes four with one actual-device case ignored.
  They exercise synthetic Start/Stop, readable partial WAVs, frozen configuration,
  missing sources and destination/save outcomes. Invalid Windows preflight probes
  do not activate a source. These scenario suites verify existing behavior; no
  separate first-fail result is claimed for them. Earlier controller/audio tests
  provide the lower-layer failure-first evidence. T015/T025 remain open for their
  full named action/scenario requirements, including close/recovery/device cases.
- Model discovery: three assertion failures became three passing tests. Immediate
  folder discovery is deterministic; loaded model metadata, rather than filename,
  controls language support. Only supported GGML base/small families are accepted.
  Serial child validation reports bad candidates without loading native models in
  the UI process. Portuguese is the default; English is explicit and translation/
  automatic language detection are disabled.
- Incremental file decoding: four behavior assertions failed while two existing
  negative cases passed; the completed decoder now passes seven focused cases.
  Synthetic WAV/MP3 checks cover stereo/rate conversion, fractional rates, short
  tails, bounded silence streaming, malformed/truncated/nonfinite input, caller
  cancellation and unchanged source bytes. Quiet nonzero samples are not discarded
  by the exact-digital-silence gate. These do not establish speech recognition
  accuracy or speech-free behavior for arbitrary real recordings.
- Transcript/scheduler: 13 initial assertion failures became 14 passing cases (the
  empty negative case already passed). Coverage includes absolute sample ranges,
  stable/pending revisions, real repeated phrases, silence, permanent gaps, bounded
  eight-second windows, a two-second stride and a short final tail. The scheduler
  keeps one latest pending window while the worker owns the in-flight request.
- Job/export scenarios pass seven file-action cases and five live cases using an
  explicitly injected fake worker. A full UI event queue first reproduced a hung
  cancellation; the fix uses cancellable bounded publication and a reserved terminal
  channel. Tests cover Unicode create-new export, retry after failed export,
  incomplete labels, retained finalized words, file cancellation/reaping, hung live
  inference, collector shutdown and synthetic WAV saving after a worker crash.
  Synthetic writer independence is not a real-device worker-termination run.
- File supervision: two advancing-file regressions timed out before the fix. The
  full protocol suite then passed 30 cases, including four new idle-deadline cases.
  File requests now have a 60-second idle deadline, renewed only by matching task/
  generation events with strictly advancing processed samples or coverage. Stale,
  foreign, stationary or rewinding events cannot keep a hung job alive. Native
  window/startup deadlines remain absolute; progress permits long valid files.
- Seven further regressions were observed failing before their fixes: duplicate
  overlap spanning several committed segments; a later cleanup error replacing
  the first failure reason; an indefinitely full UI queue without user cancellation;
  user cancellation losing its distinct Cancelled status; a dropped final ASR chunk
  falsely reporting complete; Stop during model preload unlocking actions too
  soon; and an ASR conversion failure disappearing from the UI error channel.
  The final-chunk check compares transcript coverage with saved WAV frames/3;
  converter failure uses an independent bounded error channel and disables only
  transcription. A full error channel cannot block capture. Audio saving remains
  independent and finalized text retains its original failure reason.
- Two final UI race regressions also failed before their fixes: a successful live
  worker result arriving before the saved-audio outcome, and a conversion error
  arriving just before session disposal. Tests call the actual desktop polling
  logic with synthetic sessions; successful text termination is deferred until the
  audio outcome is processed, and the independent error channel is drained before
  dropping the session. Both regressions then passed; all six UI unit cases pass.
- Native stdout is reserved for protocol JSON. Native logging is redirected and
  inference printing is disabled; fake malformed/native-output cases and actual
  child smoke checks exercise this boundary. Worker failure, cancellation and
  deadlines terminate/reap the child rather than relying on inference to cooperate.

Controller and UI bindings now provide both record modes, file/model selection,
elapsed/peak/status presentation, immutable active selections, separate audio/text
outcomes, Unicode copy/save and close/cancel/unsaved-text guards. Unit/controller
checks cover these decisions; actual desktop interaction and assistive technology
acceptance are still pending.

## Latest build and test snapshot

Before the VAD change, the default run reported by the implementation owner passed 88 library unit
cases and 62 integration-harness cases (150 passing total), with four separately
selected real-model/device cases ignored. Formatting and locked offline all-target
Clippy with warnings denied also pass after the final fixes. Ignored cases are not
counted as passes. Focused counts above describe their own runs and must not be
added together as if they were disjoint.

The planned 90% cheap-unit target is not claimed. Process framing, child crash/hang,
reaping, bounded pipe/event queues and real filesystem preservation need boundary
tests: pure mocks cannot prove those behaviors. Keep those tests rather than add
duplicate unit assertions to change a ratio. The library-unit share is 88/150,
or 58.7%, by test location; some library tests also exercise local I/O/settings or
invalid WASAPI preflight, so this is not a claimed pure/cheap-unit percentage. No
precise pure-unit ratio was audited. This process-boundary exception does not
excuse unexecuted hardware, corpus or package acceptance.

The explicit MSVC target and static CRT configuration built successfully in Debug
in 1m57s. CMake CMP0091=NEW, MSVC_RUNTIME_LIBRARY=MultiThreaded and generated
whisper/ggml-cpu project settings agree. Import inspection of the intermediate
`dist/local-static-debug-validation-2` executable found 19 Windows/system API-set
imports and no MSVCP/VCRUNTIME/UCRT imports. Its SHA-256 was
`f7e17ec0e5bf1658d151c92e32a369e32644a4a7339f90a0295a6a4b7506f39c`;
this is an intermediate Debug artifact, not the final Release package. It contained
native MIT notices, 383 dependency license texts/notices and no models. Packaging
self-checks followed red -> green and an actual existing destination was refused.
Developer-machine import inspection is not a clean Windows launch, native
deployment guarantee or disconnected end-to-end test. Final Release artifact
inventory and clean-machine evidence remain required before T061 can close.

## Requirement evidence and remaining acceptance

Every row remains subject to its listed acceptance work. Implementation and
synthetic/process evidence do not by themselves close an FR or SC acceptance gate.

| Requirement | Current implementation/check evidence | Remaining acceptance/tasks |
| --- | --- | --- |
| FR-001 | Record UI exposes microphone and combined modes; controller mode guards. | Actual desktop/source operation: T022, T030–T032, T063. |
| FR-002 | Enumerated fixed endpoint IDs, selectors and frozen active configuration. | Selected-device/default-change checks: T022, T030. |
| FR-003 | Controller lifecycle and duplicate-start guards; frame-based elapsed UI. | Visible start/stop states and timing: T022/T023, T060. |
| FR-004 | QPC alignment, adaptive resampling and two-source mixer unit checks. | Real overlap/call/one-hour alignment: T030–T032. |
| FR-005 | UI discloses capture of all sound from the selected output. | Operator notice and unrelated-output verification: T031/T063. |
| FR-006 | Create-new WAV writer, final paths and disk reopen tests. | Actual recording/playback/restart: T022/T023, T032. |
| FR-007 | Required-source/destination preflight and failed-start state tests. | Permission/recovery messaging with actual devices: T015/T022/T030. |
| FR-008 | Source/fault channels and writer partial/save-failed results; injected failures. | Actual disconnect/sleep/storage failure: T025/T030/T057. |
| FR-009 | Local picker and incremental WAV/MP3 decode; malformed-input tests. | Real spoken WAV/MP3 and negative assets: T044/T045. |
| FR-010 | File jobs publish progress; cancel/reap and source-preservation tests. | Actual-worker retry and UI flow: T044–T046. |
| FR-011 | Unicode create-new export, stable partial text and retryable save failure. | Clipboard and close/export desktop flow: T046/T060/T063. |
| FR-012 | Live toggle, bounded mixed ASR branch and stable/pending transcript UI. | Text before Stop in both real modes/languages: T058/T059. |
| FR-013 | Audio outcome independent of text; bounded tail deadline and dedup tests. | Actual Stop/audio/text timing: T056/T060. |
| FR-014 | Fake-worker failure/lag and synthetic WAV independence; explicit gap errors. | Actual worker failure during capture and CPU pressure: T056/T057. |
| FR-015 | One-task controller, frozen configuration and resource-exit UI guards. | Full conflicting-start/close action pass: T015/T046/T060. |
| FR-016 | Local-only worker/model paths; no downloader/cloud implementation. | Disconnected operation and connected network trace: T044/T061/T062. |
| FR-017 | Default Portuguese; explicit pt/en; metadata capabilities and CPU corpus runs. | Completed WAV/MP3/live paths in each language: T044/T047/T058. |
| FR-018 | Model readiness errors and plain recording without models; guard tests. | Visible prerequisite/loading/recovery UI: T045/T063. |
| FR-019 | Close-plan/unsaved guards and resource retention during worker exit. | Actual close/save/cancel and text retention: T015/T046/T060. |
| FR-020 | Exact digital silence returns NoSpeech; quiet nonzero input is retained. | Declared real speech-free/quiet set: T045/T059. |
| FR-021 | Immediate-folder candidates and serial child metadata validation. | Full mixed/corrupt/unreadable/incomplete folder/UI matrix: T045/T063. |
| FR-022 | Atomic versioned settings, remembered selections and readiness revalidation. | Restart/removal recovery through UI: T045. |
| SC-001 | Native Record screen and non-model capture path implemented. | Three-action/two-second first-use measurement: T022. |
| SC-002 | Boundary writer, clock alignment and synthetic duration checks. | Both 60-minute runs, phrases, 250 ms alignment, stop/save: T023/T032. |
| SC-003 | Selected-output loopback requires no call integration. | Operator-arranged Meet and Discord headphone calls: T031. |
| SC-004 | Four raw-window FLEURS feasibility runs meet <=20% WER. | Human-checked references and full WAV/MP3/live modes: T047/T058; dataset references are not independently audited. |
| SC-005 | Four raw-window feasibility runs take less than audio duration. | Completed ten-minute imported-file path: T047. |
| SC-006 | Bounded scheduler and 30-second finalization failure checks. | Twenty-phrase/ten-minute >=95% <=5-second live test: T058/T060. |
| SC-007 | Injected failures preserve first reason and honest partial/error outcomes. | Full real source/storage/input/worker failure matrix: T022/T030/T045/T057/T059. |
| SC-008 | Fake-worker crash with separately saved readable synthetic WAV. | Actual child termination/protocol/hang while capturing: T056. |
| SC-009 | Unicode/no-overwrite/failed-export and original-file byte checks. | Real clipboard/export/import flows: T044/T046/T060. |
| SC-010 | No runtime service/downloader; local CPU child smoke and corpus runs. | Network-disabled all-mode run and zero-attempt/listener trace: T061/T062. |
| SC-011 | Discovery/metadata/settings negative checks and real invalid-model probes. | Full model-folder UI/restart matrix: T045/T062. |

T066 remains open: this mapping records current evidence and gaps, and does not
substitute for their execution. No release entry or tag action is authorized by it.


## Offline speech-gate decision (2026-11-02)

The observed release base-model probe failed three declared speech-free controls: quiet/moderate seeded noise and a 440 Hz tone produced music labels. Digital silence passed, and attenuated real Portuguese speech remained nonempty. This is a failed FR-020 gate, retained before tuning.

Decision: use the existing whisper.cpp standalone CPU Silero VAD to gate each bounded inference window. Bundle ggml-silero-v6.2.0.bin beside the executable; development may read that same named file beside the selected ASR model when the executable-adjacent file is absent. Invalid adjacent assets must fail rather than fall back. Validate VAD before model readiness, retain default probability/minimum-duration settings initially, and keep full original window audio/timestamps for Whisper when speech is detected. Never gate by loudness alone or add a runtime downloader. The parent never loads native models. Plain recording remains independent.

The official converted asset is MIT-licensed ([model repository](https://huggingface.co/ggml-org/whisper-vad)); upstream describes local VAD integration in the [whisper.cpp guide](https://github.com/ggml-org/whisper.cpp#voice-activity-detection-vad). Pinned source revision, SHA-256, size and license hash are in assets/silero-vad.json; model bytes remain ignored under models/. Size is 885098 bytes, SHA-256 2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987. Redistribution includes the Silero MIT notice. ASR base/small weights remain user-selected, separate assets. Packages now include this small VAD model; earlier no-models-bundled statements refer to superseded pre-VAD packages.

Required proof: rerun all declared noise/tone/quiet-speech controls, both languages through the imported-file corpus, model-missing/corrupt statuses and packaging asset checks. This design decision does not count those checks as passed. No cloud fallback or acceptance target was changed.


Real imported-file component checks passed before VAD integration: actual local base-model Portuguese WAV and a derived MP3, one explicit native test per format; each emitted progress/text, exactly one terminal event and preserved the complete original bytes. MP3 was derived locally with ffmpeg from the redistributable fixture, not private audio. These are component checks, not completed T044–T047 acceptance or full-corpus results.


## Speech-gate correction and final portable preview

Observed failure was retained: without VAD, quiet/moderate seeded noise and a 440 Hz tone produced music labels; digital silence and attenuated real Portuguese speech were also tested. After the explicit CPU-only Silero integration, the optimized real-worker probe passes all four speech-free controls with empty NoSpeech (roughly 0.055-0.065 seconds for the nonzero controls). Attenuated real speech at gain 0.01, peak 0.004386 and RMS 0.000487 still produces Portuguese text in about 1.35 seconds; its cropped reference was not scored. Three VAD path/missing-asset unit tests failed first and then passed; nine worker helper tests now pass. No inference window trimming or language/model fallback was introduced.

The final local preview is dist/rustcorder-windows-preview-vad/rustcorder.exe, 17884672 bytes, SHA-256 6e0f64e9d6f3e4d8610dea02db57611d8b78e2ad0993eaf7f96fbaa2c382ee36. The pinned 885098-byte VAD, metadata and MIT notice are bundled; ASR weights remain separate. The package contains 384 license files and 19 direct system/API-set imports, with no direct VC runtime/inference/Python/libclang DLL dependency. A packaged-child check with ASR weights in a separate VAD-free folder succeeded; missing and corrupt adjacent detector copies failed actionably, and a corrupt adjacent detector did not use another valid copy. Existing output-name overwrite was refused.

The packaged-child validation overlapped the initial Portuguese imported-file benchmark for 2.84 seconds (validation/load only, no concurrent transcription). Corpus timings are reference-machine observations rather than isolated laboratory claims. Automated desktop inspection could not complete because the computer-use app-approval request timed out; no visual/accessibility or parent-window launch pass is claimed. Clean Windows, disconnected/network tracing, real microphone/call/hour runs and full live phrase-latency acceptance remain open.


## Final verification snapshot (after offline speech-gate correction)

The final default suite passes 91 library cases and 62 integration cases (153 total), with five explicitly selected model/device cases ignored. Those ignored cases are not counted as passes; the corpus, real-file and speech-gate checks were also invoked separately as recorded here. Locked offline all-target Clippy with warnings denied and formatting pass. The strict pure/cheap-unit ratio remains unaudited; library-location share is 91/153 (59.5%), retaining justified process/filesystem boundary coverage.

The optimized base-model imported-WAV pipeline with the pinned VAD passed both declared FLEURS sets, preserving original hashes:

| Language | Audio seconds | Model load + decode/inference seconds | WER | Whole-clip p95 seconds |
| --- | ---: | ---: | ---: | ---: |
| Portuguese | 611.28 | 76.31 | 13.91% | 2.20 |
| English | 600.96 | 94.56 | 9.74% | 1.76 |

Reports retain model/VAD hashes, source revision and normalized predictions under .build/benchmarks/base-pt-file-vad-release.json and base-en-file-vad-release.json. These demonstrate the implemented file pipeline on the declared dataset, not live phrase latency or independently reviewed human references. The actual Portuguese MP3 component test also passed again with the corrected VAD, retaining source bytes, progress/text and exactly one terminal event. Full MP3 corpus/human-reference and actual UI acceptance remain open under T044-T047.

Portable ZIP: dist/rustcorder-windows-preview-vad.zip, 8655035 bytes, SHA-256 2bab2168a3c8becfd9ff3f932d87b64a713154930d2eae7b280c4031b9184bb9. Archive CRCs and executable/VAD hashes were verified against the package manifest. Legacy dependency-license timestamps were clamped to the ZIP-supported range; source license contents were preserved. No commit, branch operation, release entry, tag, push or publication occurred. T012/T061-T064 and remaining operator/device acceptance are pending; this is a runnable local preview rather than a completed validated release.


## Desktop layout correction after user review

The user compared the agreed sidebar/workspace mockup with the native vertical form. The 28 approved baseline commits were created separately, validated at ten archived intermediate checkpoints, and pushed unchanged to origin/main at 8b200d21c07d668e2e492c68139970031b923c65. Their final tree exactly matched approved snapshot 99232c6d04b8df247507b15af46087351805a71c.

The new UI-only correction restores a 290-point sidebar, persistent model controls, a right-side timer/action and an expanding transcript with bottom export controls. Initial window geometry is 1040x880 with a 760x600 minimum. Three actual-render layout assertions failed first. Review then found and reproduced a missing Cancel control during stopping/saving; the original availability was restored. Native inspection caught an additional populated-combined/long-path case not covered by the empty microphone-only fixture; that new case failed before sidebar spacing/control placement was corrected. Full selected capture-mode text and language/readiness placement are now asserted. See [layout correction](ui-layout-correction.md) for measurements.

Final checks: 96 library tests plus 62 integration tests pass (158 total), five external checks remain ignored; formatting and all-target locked offline Clippy with warnings denied pass. Native Windows inspection verified both tabs, the populated combined sidebar at initial size, and maximized layout. Tab/Tab/Enter focused Record then opened Transcribe file. The model/language/readiness and action/export controls were visible. No microphone or file transcription was started during this visual check. Earlier desktop-access timeout notes are historical; access succeeded for this correction. Full Narrator, physical scaling, call/hour/live-performance and clean-host acceptance remain open.

Corrected executable: dist/rustcorder-windows-layout-preview-final/rustcorder.exe, 17923072 bytes, SHA-256 5827dec4bff747d75eabf2524c09b48a6a8d4f69d9795d3c7d8c11c546a9f8dc. ZIP: 8678605 bytes, SHA-256 7c7ef40a0b62d692c3efa5137b5a0ce50c9f2fe889158c3068e42f784cab719a. Archive CRCs and executable/VAD hashes match the package manifest. The small speech detector remains pinned at 2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987. Earlier layout previews are intermediate artifacts. These new UI changes have not been committed or pushed; separate groups await user approval.
