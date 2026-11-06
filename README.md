# rustcorder

A local Windows desktop recorder built with Rust. Record a microphone, record a microphone plus computer output, transcribe WAV/MP3 files, or show transcription during recording.

Transcription runs locally with whisper.cpp GGML base/small models and a bundled small Silero speech detector. Brazilian Portuguese is the default; compatible models also support English. No accounts, cloud calls, model downloads or meeting integrations are part of the app.

## Run and build

The current portable preview is `dist/rustcorder-windows-layout-preview-final/rustcorder.exe`.
Keep its bundled speech detector and license files beside it. For development
transcription checks, select this repository's `models` folder in the app.

See [development instructions](docs/development.md) for the pinned Windows toolchain, build wrapper and portable packaging. Choose a microphone and a writable save folder in the Record tab. Computer mode records every sound on the selected output, including notifications; use headphones during calls.

For text, choose a folder containing ggml-base.bin, ggml-small.bin, ggml-base.en.bin or ggml-small.en.bin. Actual model bytes are validated locally. CTranslate2/faster-whisper and WhisperX folders are incompatible with this engine. Multilingual base/small supports Portuguese and English; .en supports English only. The development models are in the ignored models/ directory. Portable packages include the required speech detector beside the executable; development builds can find that same file beside the selected ASR weights. See assets/silero-vad.json for the pinned detector hash and license.

Recordings are streamed as unique 48 kHz stereo PCM16 WAV files, with a six-hour safety limit. Text exports use new UTF-8 TXT files and refuse existing filenames. Transcription failure leaves recording independent. Partial text is labeled incomplete.

## Validation status

The native implementation and automated checks are under active validation. Both model sizes passed preliminary ten-minute Portuguese/English CPU accuracy and throughput checks. The added speech detector passes the declared silence/noise/tone controls while retaining attenuated real speech. These checks do not establish full live phrase latency. Real call quality, one-hour device alignment, clean disconnected first launch and accessibility acceptance remain open until executed. See [actual evidence and remaining checks](docs/implementation-validation.md); do not treat this as a validated release.

## Project instructions

- [Agent instructions](AGENTS.md)
- [Constitution 1.0.0](.specify/memory/constitution.md)
- [Project overview](docs/project-overview.md)
- [Branch policy](docs/branching.md)
- [Versioning and releases](docs/versioning.md)
- [Changelog](CHANGELOG.md)
- [Feature specification](specs/001-record-transcribe/spec.md)
- [Implementation tasks](specs/001-record-transcribe/tasks.md)

Spec Kit workflows are installed under .agents/skills/. Work remains on the current branch and follows test-first validation. No product release has been approved.
