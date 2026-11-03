# Technical Research: Local Recording and Transcription

**Date**: 2026-11-02 | **Feature**: [spec.md](spec.md) | **Status**: Design decisions resolved

This is a researched design, not a working-build or performance claim. Versions below
were observed in documentation; a compatible Windows build and Cargo.lock are still required.
User policy is Windows, Rust, offline processing, Brazilian Portuguese first and optional English.

## 1. Desktop UI

**Decision**: Use egui/eframe 0.37.0, rfd 0.17.2 native file/folder dialogs and one renderer.
Enable AccessKit, clipboard and embedded default fonts; omit unused web/browser features.
Use one window with Record, Transcribe File and Models/settings views. Main-thread UI sends
commands to the controller and displays status/events; it never performs capture/inference.

**Rationale**: A Rust desktop UI avoids a separate frontend runtime and can ship local assets.
Keyboard traversal, labels, focus and accessibility still need application-level testing.
**Alternatives**: Tauri can operate offline, but introduces frontend assets and Windows WebView2
deployment considerations; neither is necessary for this small Rust-only interface.
**Sources**: [eframe](https://docs.rs/eframe/0.37.0/eframe/),
[rfd](https://docs.rs/rfd/latest/rfd/), [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

## 2. Microphone and computer output

**Decision**: Use wasapi 0.26.0 for separate shared-mode microphone capture and render-endpoint
loopback. Pin endpoint identities at Start, initialize COM on capture threads, and keep device
handling outside the UI. Treat silence as silence; a quiet output is not a source failure.

**Rationale**: WASAPI loopback captures the selected output without Meet/Discord APIs or a bot.
It captures other audio on that output too; the UI must disclose this. Exclusive-mode and
protected-content scenarios are not assumptions of the successful call acceptance baseline.
**Alternatives**: Direct windows bindings offer more control but require additional unsafe/API
plumbing. Microphone pickup of speakers is insufficient; per-process capture is outside scope.
**Sources**: [Microsoft loopback](https://learn.microsoft.com/en-us/windows/win32/coreaudio/loopback-recording),
[wasapi](https://docs.rs/wasapi/latest/wasapi/).

Implementation source inspection of locked wasapi 0.26.0 found two boundaries
requiring narrow native handling: its capture readers copy the returned pointer
before considering SILENT flags, and its event wait maps failed waits to timeout.
For capture, retain wrapper enumeration/client/format setup but use a small Windows
GetBuffer/ReleaseBuffer and wait adapter that checks silence/null/length/flags
before copying and distinguishes failed waits. Keep unsafe code in that adapter
and cover the conversion/flag rules with tests. This is source evidence, not a
claim that a particular installed audio driver has already exhibited the issue.

## 3. Timing, mixing and audio files

**Decision**: Preserve packet device/QPC timestamps and flags. Normalize channels and adapt each
source using rubato 5.0.1 onto a common 48 kHz timeline before mixing. Handle startup offsets,
silent packets and discontinuities explicitly; do not assume equal nominal rates mean equal clocks.
Use headroom and saturating PCM conversion, then stream stereo PCM16 WAV via hound 3.5.1.
Feed a separate mono 16 kHz float branch to ASR; never make the writer wait for transcription.

**Rationale**: Independent input/output clocks drift. Adaptive alignment is a design requirement,
not proof of the 250 ms acceptance budget. At 48 kHz stereo PCM16, one hour is 691,200,000 audio
bytes (about 659 MiB). Classic RIFF size limits require a checked file-size stop before overflow;
never truncate or silently wrap. Flush/finalize headers explicitly and report writer errors.
**Alternatives**: Concatenating callbacks loses timing; buffering the whole call wastes memory.
RF64 and automatic file splitting are deferred unless long-session requirements demand them.
**Sources**: [capture timestamps/flags](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudiocaptureclient-getbuffer),
[rubato](https://docs.rs/rubato/latest/rubato/), [WAV writer](https://docs.rs/hound/latest/hound/struct.WavWriter.html).

## 4. Existing WAV/MP3 recordings

**Decision**: Use Symphonia 0.6.1 with only WAV/PCM/MP3 support required by the specification.
Decode incrementally, normalize channels, resample to 16 kHz mono float, and reuse the ASR path.
Leave originals unchanged. Distinguish format, decode, access and speech-free results.
**Rationale**: Offline decoding needs no external ffmpeg installation or conversion service.
**Alternatives**: Spawning ffmpeg is practical but adds a shipped executable, licensing/build
decisions and another failure boundary; it is unnecessary for the accepted two formats.
**Source**: [Symphonia](https://docs.rs/symphonia/latest/symphonia/).

## 5. Local speech recognition and model folders

**Decision**: Use whisper-rs 0.16.0 and its bundled whisper.cpp dependency with GPU disabled.
Input is 16 kHz mono f32. Begin with multilingual base for latency and small for accuracy trials.
Their official files are 142 MiB and 466 MiB; these are storage sizes, not total app memory.
The old GitHub wrapper repository migrated to Codeberg; published crate documentation remains available.

**Rationale**: This runs native inference without Python, accounts or cloud services. Brazilian
Portuguese uses explicit `pt`; the engine does not expose a distinct `pt-BR` language guarantee.
Use explicit `en` when selected, disable detection and translation. Multilingual models can serve
both languages; `.en` models serve English only. English assets cannot be required for Portuguese.
**Alternatives**: Cloud ASR conflicts with scope. GPU acceleration and other engines await evidence
that CPU reference models cannot meet targets; no model is claimed to meet accuracy/latency yet.
**Sources**: [published wrapper](https://docs.rs/crate/whisper-rs/0.16.0),
[model table and format](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md),
[decoder parameters](https://docs.rs/whisper-rs/0.16.0/whisper_rs/struct.FullParams.html).

**Pack contract**: The chosen folder directly contains `ggml-base.bin`, `ggml-small.bin` and/or
their `.en` variants in whisper.cpp custom GGML format. No manifest is needed. Arbitrary GGUF,
ONNX, PyTorch, nested repositories and executable model installers are unsupported. Probe files
and validate the selected model using loader metadata, not its extension/name alone. Remember
selection, revalidate after restart and report missing/corrupt/incompatible assets without fallback.
Users acquire compatible files separately; the app never downloads them.
**Source**: [model loading/introspection](https://docs.rs/whisper-rs/0.16.0/whisper_rs/struct.WhisperContext.html).

## 6. Live text and failure isolation

**Decision**: Run every native model operation in a hidden child mode of the same application,
using private local pipes. Parent owns capture and WAV writing. No localhost HTTP server.
Allow one inference request in flight and one latest pending window. Initial tuning hypothesis:
an 8-second rolling window every 2 seconds, with pending-tail replacement and timestamp/text
overlap reconciliation. Commit stable passages once; dropped coverage must mark text incomplete.

**Rationale**: A Rust worker thread avoids UI stalls but cannot isolate a C/C++ abort. A child
exit can be reported while parent recording continues. At Stop, save audio first, then process
only a bounded tail; after the 30-second finalization budget cancel and retain incomplete text.
Silence gating and final-tail rules need corpus tests; do not promise hallucination prevention.
**Alternatives**: Upstream streaming example is a prototype, not a complete transcript-stability
algorithm. Its slow-processing audio-drop behavior must never affect recording. Model-based VAD
would require another local asset; begin without that dependency and measure silence behavior.
**Sources**: [upstream stream example](https://github.com/ggml-org/whisper.cpp/blob/master/examples/stream/stream.cpp),
[VAD prerequisite](https://docs.rs/whisper-rs/0.16.0/whisper_rs/struct.FullParams.html#method.enable_vad).

## 7. Build, offline boundary and feasibility gates

**Decision**: Target Windows x64 MSVC with Rust/Cargo 1.95.0 observed locally. Developer builds
need Visual C++ tools/Windows SDK, CMake and LLVM/Clang as required by native bindings. Other
native tools were not found on the inspected PATH; that does not prove they are uninstalled.
Hardware inventory via CIM was unavailable; reference CPU/RAM/devices remain a validation input.
**Source**: [wrapper Windows build notes](https://docs.rs/crate/whisper-rs/0.16.0/source/BUILDING.md).

**Rationale**: Development dependency acquisition is separate from runtime. The distributed app
must run with local assets and disabled networking, without model downloads, telemetry, updater,
CDN fonts, API credentials or network listeners. Test the packaged build on a clean Windows host.
**Alternatives**: Installing native compilers/Python on end-user machines is not an MVP requirement.

Before full implementation, prove: (1) clean native build/package; (2) simultaneous capture,
silence/disconnect handling and 60-minute drift; (3) base/small pt-BR and English accuracy/speed;
(4) live-tail dedupe and bounded lag; (5) child-crash isolation with audio still saving;
(6) zero application network activity and keyboard/accessibility flows. Failures require an explicit
design adjustment or acceptance discussion, not fabricated passing results. These are executable
feasibility gates, not unresolved product questions. No gate has been executed by this research.


## Offline speech-gate decision (2026-11-02)

The observed release base-model probe failed three declared speech-free controls: quiet/moderate seeded noise and a 440 Hz tone produced music labels. Digital silence passed, and attenuated real Portuguese speech remained nonempty. This is a failed FR-020 gate, retained before tuning.

Decision: use the existing whisper.cpp standalone CPU Silero VAD to gate each bounded inference window. Bundle ggml-silero-v6.2.0.bin beside the executable; development may read that same named file beside the selected ASR model when the executable-adjacent file is absent. Invalid adjacent assets must fail rather than fall back. Validate VAD before model readiness, retain default probability/minimum-duration settings initially, and keep full original window audio/timestamps for Whisper when speech is detected. Never gate by loudness alone or add a runtime downloader. The parent never loads native models. Plain recording remains independent.

The official converted asset is MIT-licensed ([model repository](https://huggingface.co/ggml-org/whisper-vad)); upstream describes local VAD integration in the [whisper.cpp guide](https://github.com/ggml-org/whisper.cpp#voice-activity-detection-vad). Pinned source revision, SHA-256, size and license hash are in assets/silero-vad.json; model bytes remain ignored under models/. Size is 885098 bytes, SHA-256 2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987. Redistribution includes the Silero MIT notice. ASR base/small weights remain user-selected, separate assets. Packages now include this small VAD model; earlier no-models-bundled statements refer to superseded pre-VAD packages.

Required proof: rerun all declared noise/tone/quiet-speech controls, both languages through the imported-file corpus, model-missing/corrupt statuses and packaging asset checks. This design decision does not count those checks as passed. No cloud fallback or acceptance target was changed.
