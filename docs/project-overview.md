# Project overview

Rustcorder is a single Windows x64 desktop Cargo application. Its four MVP capabilities are microphone recording, microphone plus selected computer-output recording, local WAV/MP3 transcription and live local transcription. Portuguese is the default, with English from compatible models.

## Structure

- src/ui.rs and src/app.rs: native egui screens and guarded recording/text states.
- src/audio/: owned WASAPI capture threads, bounded timestamp timeline and mixing/resampling.
- src/recording.rs: unique streaming WAV files and explicit finalization outcomes.
- src/transcription/: same-executable hidden inference child, bounded pipes, incremental import decoding, live scheduling and stable/pending transcripts.
- src/models.rs and src/settings.rs: local model discovery/metadata and versioned preferences.
- tests/: cheap synthetic logic and explicit process/device/model checks.
- scripts/: reproducible MSVC build, benchmark and portable-package entry points.

Only the inference child loads native models. The parent owns audio capture and storage, so child cancellation or failure does not terminate recording. The app contains no network service, downloader or cloud provider. Model assets and private recordings are excluded from Git.

## Governance

AGENTS.md and the constitution define current-branch work, test-first changes, simple boundaries, evidence under docs/ and user-controlled releases. Tool-specific entry points agree with them. Spec Kit artifacts live under specs/, and explanatory documentation under docs/. CHANGELOG.md contains no invented release history.

The original repository contained only its name on 2026-11-02. Product requirements and implementation were added afterward; current validation limits are recorded in [implementation evidence](implementation-validation.md).
