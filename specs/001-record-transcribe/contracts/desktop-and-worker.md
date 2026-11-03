# Desktop actions and local worker contract

This contract implements [the plan](../plan.md) and [data model](../data-model.md).
It defines local Rust actions and inherited child-process pipes, not an HTTP API.

## Desktop actions

| Action | Guard and result |
| --- | --- |
| SelectSources / SelectMode / SelectSaveFolder | Idle only; identify selected source and whole-output capture scope |
| SelectModelFolder / SelectModel / SelectLanguage | No recording or transcription active; list supported candidates, validate locally, remember successful selection |
| StartRecording | No active recording, transcription/finalization or model-changing operation; preflight sources and writable folder; live enabled additionally requires loaded compatible model; report active only after capture starts |
| StopRecording | Stop sources, drain owned audio, explicitly finalize WAV, publish saved/partial/error result; pending text is independent |
| SelectAudioFile / TranscribeFile | No recording or transcription job; supported readable WAV/MP3 and ready selected model/language required |
| CancelTranscription | Invalidate generation, kill/reap worker; preserve original/audio and available stable text; mark incomplete |
| CopyText / SaveText | Available completed or stable partial text; incomplete label retained; no silent overwrite; save failure keeps text |
| RequestClose | During capture offer stop/save-and-close or keep-open; during transcription offer cancel-and-close or keep-open, with unsaved-text handling |

All controls are keyboard reachable and have explicit labels/status. Disabled
actions explain their unmet prerequisite. Model failures never disable recording
with live transcription off. Portuguese is default; English is selectable only
when a compatible selected model supports it. No language/model fallback occurs.

## Child lifecycle and transport

Launch the same executable as hidden `--asr-worker`, with inherited stdin/stdout
pipes and separately drained stderr; use no listening socket. Only the child
loads whisper-rs/native inference code, decodes imports or reads model assets.
The parent does not test native models in its own process.

A dedicated IPC owner serializes requests and drains bounded responses. The UI
and capture threads never wait on pipe I/O, inference, model loading or child exit.
Parent queues, stdout events and diagnostic stderr all have finite memory limits;
excess diagnostics may be truncated but must never block child progress.

Parent request framing, in order:

1. Four-byte unsigned little-endian JSON-header length (`1..65536`).
2. Exactly that many bytes of UTF-8 JSON.
3. Exactly `payload_bytes` bytes of payload (`0..1048576`).

Every header contains `protocol: 1`, `id` (monotonic request integer),
`job_generation` (monotonic job integer), `kind`, and `payload_bytes`.
Reject invalid UTF-8/JSON, unsupported protocol, lengths, non-finite samples,
unrecognized request kinds and inconsistent payload metadata before processing.
The child must not use header lengths to allocate unbounded storage.

| Request kind | Additional fields | Payload / completion |
| --- | --- | --- |
| `ValidateModel` | Absolute local `model_path` | None; validate metadata and actual native load, emit `ModelValidated`, then release context |
| `LoadModel` | `model_path`, `language` (`pt`/`en`) | None; replace existing context, validate language; `Ready` or `Error` |
| `TranscribeFile` | Absolute local `audio_path`, `language` | None; requires loaded compatible model; decode source read-only; progress, then terminal segments/no-speech/error |
| `TranscribeWindow` | `language`, absolute 16 kHz `start_sample`, `end_sample`, `sample_count`, `final_window` | Mono 16 kHz little-endian float32 PCM; `payload_bytes = sample_count * 4`; `end-start = sample_count`; bounded results |
| `Shutdown` | No additional fields | None; free resources and exit; parent still applies a bounded exit deadline |

The 1 MiB payload permits at most 262144 mono samples (16.384 seconds). Live
window design must remain within that bound. Transport carries no recording WAV
data back to the parent; WAV writing never depends on a child response.

## Worker events

Child stdout is UTF-8 JSON Lines only, maximum 1 MiB per line. Native loader/
inference diagnostics must be redirected to stderr; accidental non-JSON stdout
is a protocol failure. Capture all native print paths in the worker spike.

Every event contains `protocol`, `id`, `job_generation`, `kind`; startup `Ready`
uses ID/generation zero. All other events echo their originating request IDs.

- `Ready`: startup handshake or successfully loaded model/language.
- `ModelValidated`: path, valid flag, model family, supported language subset and
  actionable validation failure when invalid; a filename alone is insufficient.
- `Progress`: finite percentage when duration is known, otherwise stage/processed
  samples; progress is advisory and cannot establish task completion.
- `Segments`: bounded list of absolute start/end sample offsets and text,
  processed coverage interval, and `terminal` flag. Emit multiple bounded lines
  for a file job. Parent controls stable/pending presentation and overlap merging.
- `NoSpeech`: processed coverage interval and `terminal` flag; empty text is not
  automatically an error, and silence still counts as processed coverage.
- `Error`: bounded code, stage and user-actionable reason; request is terminal.

Exactly one terminal response ends each work request; `Ready`, `ModelValidated`
and `Error` are terminal for their respective requests. `Shutdown` instead ends
with successful child exit/EOF within its deadline. Ignore duplicate completions.
Interpret offsets relative to the full file/session, not receipt time. The child
converts native relative timestamps using the request's origin sample. Never
include source audio, model dumps or unrestricted diagnostic output in events.

## Cancellation, backpressure and failure

One inference request may be in flight and one latest live window pending. The
IPC owner replaces pending work rather than building a growing backlog. Parent
coverage bookkeeping marks any skipped interval still uncovered by later overlap
as incomplete. Request IDs and job generations prevent late results from changing
a cancelled/replaced task. File transcription is a single cancellable job.

Cancel/timeout/protocol error kills and reaps the child through the IPC owner;
restart only for the next explicitly requested job. Retain finalized text, label
it incomplete, and leave capture running. After recording Stop, enforce the spec's
30-second text finalization deadline independently of audio save completion.
Model-load/startup and stalled-file deadlines are explicit bounded supervisor
settings, established by the reference-machine spike; no indefinite UI waits.
No silent retry with another language/model or cloud service is allowed.

Contract tests use a fake child for invalid lengths, malformed lines, hangs,
partial writes, EOF/crashes, duplicate/stale responses, cancellation and queue
replacement. Real-model/device boundary tests remain separate validation gates.
