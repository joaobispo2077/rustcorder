# Data model: recording and local transcription

Design artifact for [the specification](spec.md) and [implementation plan](plan.md).
These are in-process Rust values and local files, not database tables or web APIs.

## Ownership and persistence

The desktop parent owns UI state, capture, mixing, WAV writing and transcript
assembly. One hidden child of the same executable owns model loading, decoding
and inference. Only a dedicated IPC owner communicates with that child.
Audio/transcript content is never put in settings or sent over a network.

| Entity | Fields and relationships | Validation / lifetime |
| --- | --- | --- |
| CaptureSource | Windows endpoint ID, display name, microphone/render role, availability, format | Enumerated locally; session snapshots IDs; never silently replace a missing source |
| LocalModel | Canonical file path, filename, discovered family, language capability, validation result | Supported direct-folder files: `ggml-base.bin`, `ggml-small.bin`, `ggml-base.en.bin`, `ggml-small.en.bin`; filename alone never proves compatibility |
| ModelSelection | Folder, selected model path, selected language (`pt` or `en`), readiness/error | Default language is Brazilian Portuguese (`pt`); `.en` models cannot enable Portuguese; multilingual models may enable both explicitly selected languages |
| RecordingSession | Session ID, mode, source snapshots, save folder, live flag, selected model/language snapshot, start/end, elapsed frames, state, error | One active session; source/model/language settings frozen until recording and transcription end |
| AudioRecording | Session ID, unique path, 48 kHz stereo PCM16 format, frames written, duration, finalization status, interruption cause | Create without overwrite; stream to disk; explicitly finalize; do not call a failed/partial file complete |
| TranscriptionJob | Job generation, file/live kind, source path or session ID, model/language snapshot, worker request IDs, state, progress, deadline | One job; file jobs cannot coexist with recording; generation changes on cancellation/replacement |
| Transcript | Job generation, stable segments, pending segments, processed coverage, uncovered gaps, completeness, optional saved path | Parent owns ordered assembly; incomplete text remains copyable/exportable with an incomplete label |
| TranscriptSegment | Start/end sample on 16 kHz timeline, text, pending/stable flag, originating request | Valid ordered bounds; window-relative inference offsets become absolute sample offsets before merge |
| CoverageGap | Start/end sample, cause (dropped window, worker failure, timeout) | An interval still unprocessed after overlapping results are reconciled makes transcript incomplete |

No model manifests, plugins, arbitrary inference formats, catalog database or
automatic downloader are introduced. Validate candidate models sequentially in
the child and release each before validating another; retain at most one loaded
inference context. Invalid candidates carry a reason, not a usable status.

## Settings file

`%LOCALAPPDATA%/rustcorder/settings.json`, JSON schema version `1`, stores:

- Model folder, selected model path and language (`pt` initially).
- Selected microphone/output endpoint IDs, recording mode, live-transcription
  preference and last selected save folder.

Write a temporary file and replace atomically. Missing settings use defaults;
invalid settings produce a recoverable settings message and safe defaults.
Never load a newer unsupported schema as if it were version 1. Revalidate paths,
models and endpoint availability on launch and before use; remembered values do
not establish readiness. Keep audio files and transcripts at user-selected paths.

## State transitions

### Recording

`Idle -> Preflight -> Starting -> Recording -> Stopping -> Saving -> Completed`.

- A preflight/startup failure becomes `Failed`; do not display active capture.
- Source loss, sleep/audio interruption or writer failure requests stop. Attempt
  finalization and produce `Interrupted` with a retained path when possible,
  otherwise `Failed` with an honest save error.
- A default-device change does not replace an existing selected endpoint.
- Valid output silence advances the timeline; it is not a device failure.
- At the proposed disclosed six-hour WAV safety cap, stop and finalize normally
  with the limit visible. This avoids reaching RIFF's size boundary; validate the
  limit in the implementation gate, rather than implying unlimited capture.
- `Completed`, `Interrupted` and `Failed` retain the latest audio result. Start
  becomes available only after any previous transcription/finalization or model
  operation has ended or been cancelled. Never start a second session over active work.

### Transcription and model readiness

`NotConfigured -> Validating -> Ready | Invalid`; changed/missing files invalidate
readiness. The child loads the selected ready model before declaring a task ready.

`Idle -> Loading -> Processing -> Finalizing -> Completed | NoSpeech`.

- File jobs process source audio incrementally; originals are read-only.
- Live jobs receive bounded windows. Recording stop closes capture/writer first;
  finalization of pending text proceeds separately for at most the spec deadline.
- Cancel, child crash/protocol error or timeout yields `Cancelled`/`Failed` and
  incomplete text. Kill/reap the child; preserve stable text and recorded audio.
- Worker failure during capture changes transcription state only. Capture stops
  only for its own source/storage failure or the user's Stop action.

## Transcript assembly invariants

Use sample offsets, not wall-clock strings, as ordering keys. A window response
replaces only its pending range; it cannot append another copy of committed text.
Keep a monotonic stable boundary, reconcile overlap before committing, and retain
unsettled text as pending. Processed silent intervals count as coverage even when
they contain no segments. A live queue keeps one in-flight and one latest pending
window: replacing pending work records any interval that later overlap never
covers. Never label that transcript complete. Drop stale generation/request events.

On stop, commit the final successful tail once; failed/unprocessed tails stay
incomplete. Save partial text with a visible incomplete heading. The speech-free
acceptance set must produce `NoSpeech`, not fabricated completed passages.

## Close and export

Closing during capture offers cancel-close or stop/save-and-close. Resolve WAV
saving independently of child cancellation. Closing during file transcription or
post-stop finalization offers keep-open or cancel-and-close; allow available text
to be copied/saved and confirm before discarding unsaved text. Export uses a new
file without silent overwrite; failure leaves text available. See the
[desktop/worker contract](contracts/desktop-and-worker.md) for action guards.


## Packaged speech detector

The offline speech-gate decision adds one fixed Silero VAD GGML asset, separate from user-selectable base/small ASR candidates. The child validates and loads it before declaring ASR readiness. Packaged location is beside the executable; an absent packaged file permits the documented development location beside the selected ASR weights. Corrupt packaged content is an error, not permission to use another copy. The parent never loads this native asset; plain recording remains model-independent. Source hash/license and exact filename are pinned in assets/silero-vad.json.
