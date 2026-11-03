# Development and acceptance guide

The Windows app and its automated tests are implemented. This guide separates
reproducible commands from remaining device/operator acceptance. See the
[validation evidence](../../docs/implementation-validation.md) for actual results;
an unchecked acceptance run is not a pass.

## Prerequisites

- Windows x64; initial acceptance on Windows 11 x64.
- Rust MSVC 1.95.0, Visual Studio C++ Build Tools/Windows SDK, CMake and libclang
  for generated Windows bindings. The development wrapper initializes the tested
  local toolchain and C++ environment; see [development](../../docs/development.md).
- Mic, output endpoint, headphones, desktop microphone access and writable storage.
  Budget about 659 MiB per one-hour WAV plus models and ordinary free-space headroom.
- Compatible models and small redistributable Portuguese/English reference audio.

The developer toolchain may need downloads. End users should need only the packaged
app, its native runtime dependencies and local model files. Test offline startup on
a clean machine; do not assume the development environment proves packaging.

## Model provisioning

Use files linked from the [upstream model guide](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md):
multilingual `ggml-base.bin`, optionally `ggml-small.bin`, with English-only `.en`
variants optional. Match the locked native loader's supported weights and record
provenance/SHA-256/license when preparing the test/distribution assets. Copy files
directly into a selected folder, including via removable storage if offline.
The app does not download models, and multilingual models already support English.
The packaged app also requires its bundled ggml-silero-v6.2.0.bin speech detector
beside the executable. Development builds can read the pinned detector beside the
selected ASR model when the executable-adjacent detector is absent. A corrupt
packaged detector fails validation rather than silently selecting another copy.
See assets/silero-vad.json and the development guide for provenance and setup.

Choose Models folder, wait for validation, choose the model and Português (Brasil).
Verify English is available with a compatible model, `.en` cannot be selected for
Portuguese, and a missing English pack does not block Portuguese. Restart and check
remembered choices are revalidated. Model removal/corruption must not disable plain
recording or trigger a download/language fallback.

## Build and automated checks

From the repository root in PowerShell:

```powershell
rtk proxy powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1 fmt --all --check
rtk proxy powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1 clippy --locked --offline --all-targets -- -D warnings
rtk proxy powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev.ps1 test --locked --offline
rtk proxy powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package.ps1
rtk proxy .\target\x86_64-pc-windows-msvc\release\rustcorder.exe
```

For each behavior slice: add a failing targeted test, run and record the failure,
implement the narrow behavior, then rerun the target and relevant surrounding checks.
Unit tests must not require devices/models. Separate native/model/hardware tests;
do not assume CI has audio endpoints or downloaded weights. Target 90% cheap unit
tests when feasible without omitting needed boundary checks.

## Acceptance runs

| Scenario | Procedure | Expected evidence |
| --- | --- | --- |
| Mic capture | Speak with live text disabled, stop, play WAV externally | Audible phrase, unique path/duration, file survives restart |
| Combined capture | Headphones, alternating/overlapping call phrases in Meet and Discord separately | Both sources, correct timing/order, remote voice not dependent on mic pickup |
| Silent output/drift | Quiet output while mic active; one hour with known alignment signals, mixed device rates | Timeline advances, no missing scheduled phrases, <=250 ms source alignment |
| File transcription | WAV/MP3 in Portuguese, repeat English with compatible selection | Original unchanged, corresponding-language text, correct copy/save Unicode |
| Live text | Both capture modes, 20+ separated phrases in ten minutes per reference language | Text during recording, >=95% phrase latency <=5 s, no duplicated stable overlap |
| Worker failure | Terminate inference child during capture | Incomplete text, stable text retained, audio continues and WAV saves |
| Overload | Slow inference, then independently overload writer/capture queues | ASR never blocks recording; audio overrun explicitly interrupts rather than silently drops |
| Models | Valid/multiple/empty/unreadable/corrupt/incomplete/incompatible candidates | Correct readiness/errors, settings survive restart, no fallback/download |
| Input/storage | Invalid/empty/silent audio, full/unwritable storage, name collision | Actionable error/no-speech, no overwrite or false completed result |
| Device/close | Disconnect sources, change default, sleep, close/cancel | No source substitution, partial status when needed, audio secured before close |
| Accessibility | Keyboard, Narrator, Windows scaling | Labeled operable controls; status/errors do not rely on color |

Accuracy evidence needs >=10 minutes of clean human-checked speech per Portuguese
and English, fixed normalization for case/punctuation/numbers, and word-error-rate
measurement. Record actual CPU/RAM, devices, model/hash, thread count, build revision
and GPU-disabled state. Leave CPU scheduling headroom for capture. File inference
must process ten minutes in <=10 minutes; post-stop text completes or is marked
incomplete within 30 seconds. A model's file size does not prove these targets.

## Fully disconnected operation

After preparing app/models, disable networking and exercise both capture modes,
file transcription, live text, model settings/restart and export. Use local played
audio for this pass: Meet/Discord networking is unrelated to recorder networking.
Verify clean first launch requests no runtime/model download. Separately, with
networking available, trace parent/child network activity and listening ports at
process level. A disabled adapter alone does not prove the app attempted no requests;
exclude unrelated OS/call-app traffic from the evidence.

## Remaining acceptance and release controls

Use [tasks.md](tasks.md) to track unexecuted scenarios and follow the procedures above.
No release entry/tag recommendation before completion confirmation; tag execution
requires explicit authorization. No release actions are part of this run guide.
