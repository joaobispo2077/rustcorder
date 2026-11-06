# Desktop and Local Analysis Contract

Date: 2026-11-05. [Plan](../plan.md) / [data model](../data-model.md).
This extends the existing desktop/private-worker boundary; it is not an HTTP API.
Names below define planned operations and events, not implemented callable APIs.

## Desktop operations

| Operation | Guard and outcome |
| --- | --- |
| Choose quality profile/device/language | No active recording/job; provisioned local profile; explicit CPU/CUDA and PT/EN; validate independently of the legacy model |
| Request quality transcription | Readable WAV/MP3 or retained saved recording; one active job; no speakers required; original bytes unchanged |
| Enable speaker analysis / optional known count | Per attempt; validated profile capabilities; count hint cleared on source change |
| Analyze saved recording | Explicit action after audio finalization; never makes saving wait for inference |
| Cancel analysis | Immediately mark cancelling and invalidate generation; preserve available text/draft/last complete; background owner kills/reaps worker |
| Inspect a person | Filter timestamped passages only; full summary and result remain unchanged |
| Copy/save text | Existing plain-text semantics, including incomplete labels and UTF-8/no silent overwrite |
| Copy/save speaker report | Explicit action; one report from the same validated result/summary; include provenance, warnings, partial coverage and available passages |
| Close | Retain current recording/unsaved-result guards; offer keep-open or explicit cancel/discard choices; already saved audio remains intact |

Label result count as estimated or supplied-hint mode, and expose observed count.
An outside-range estimate is visibly unvalidated. Missing/failed speaker analysis
is not zero speakers. Partial ordinals/statistics are provisional. Controls remain
keyboard reachable within the current sidebar/workspace layout. Existing legacy
live transcription and its model selection continue independently.

## Launch and packaging

Legacy jobs continue launching the same executable with `--asr-worker`.
Quality jobs directly launch the **verified profile's own** Python executable with
isolated, UTF-8, unbuffered execution and the fixed bundled `quality_worker.py`.
Use inherited private pipes; no shell, pip, uv, server or arbitrary manifest command.
Hide the child window and drain bounded stderr concurrently. No parent/UI process
loads Torch or model bytes.

The quality child decodes through local PyAV, passes waveform data to the models,
and does not invoke external FFmpeg or multiprocessing helpers. Trace and verify
this assumption; if an adopted dependency creates descendants, supervise the
whole owned process tree before it is eligible to ship. Cleanup may remove only
scratch files created and owned by that attempt; never remove the input/profile.

Validate the complete local profile before ready: runtime lock, required DLLs,
models/tokenizers, NLTK PT/EN resources, explicit local HF aligners, VAD and optional
Community-1 dependencies. Set `HF_HUB_OFFLINE=1`, `TRANSFORMERS_OFFLINE=1` and
`PYANNOTE_METRICS_ENABLED=0`; use local loaders, not flags alone. Missing resources
fail locally before calling library download paths. No credentials are required
for ordinary execution and no global environment/settings are changed.

## Private protocol v2

Upgrade the bundled parent, legacy worker, quality worker and fake fixtures
together. Reject incompatible v1 workers cleanly; do not add dual-version support.
Legacy requests retain existing semantics and sample/payload limits.

Reuse request framing: 4-byte little-endian header length, 1–65536 UTF-8 JSON bytes,
then declared payload (<=1 MiB). All headers contain `protocol: 2`, monotonic `id`,
`job_generation`, `kind` and `payload_bytes`. Quality file/profile requests carry
no PCM payload and include attempt/source identity.

| New request | Required information | Terminal response |
| --- | --- | --- |
| `ValidateAnalysisProfile` | Canonical profile root, language, device, whether speakers are requested | `AnalysisProfileValidated` or `Error` |
| `AnalyzeFile` | Canonical audio path, validated profile identity, immutable analysis options and attempt/source IDs | `AnalysisFinished` or `Error` |

`AnalyzeFile` rechecks the profile/source snapshot. Startup `Ready` uses zero IDs;
all request events echo their IDs. `Shutdown` retains the existing bounded exit/EOF
contract. Changing readiness never silently selects another device/model/language.

Child stdout is UTF-8 JSON Lines only, <=1 MiB per line. Adapt native/Python logs
to stderr while keeping protocol writes on a dedicated stream; native print paths
must be proven harmless. Max 1024 records per batch as well as the byte limit.
Cap accumulated analysis data at 128 MiB; exceedance is a visible resource failure
with preserved partial text, not silent truncation. This bound excludes separately
measured model/scratch memory.

## Analysis events

| Event | Semantics |
| --- | --- |
| `AnalysisProfileValidated` | Ready/not-ready, exact asset identity, actual device/capabilities and actionable local error |
| `AnalysisProgress` | Stage, stage-local completed/total work, stage transition and optional bounded status; cannot prove output coverage |
| `AnalysisTextBatch` | Ordered ASR passage IDs/text/available coarse timing and committed transcription coverage; checkpoint before later stages |
| `AnalysisActivityBatch` | Ordinary overlapping activity, timed unknown activity, source cluster IDs and committed diarization coverage |
| `AnalysisWordBatch` | Passage/UTF-8 text-span references, available alignment and explicit assignment/overlap state; each word is emitted once after alignment and requested diarization resolve or fail |
| `AnalysisFinished` | All stage outcomes, final roster/count provenance, coverage and warnings; exactly one terminal result |
| `Error` | Terminal code/stage/message for a failed request; parent retains all previously valid batches |

Batches carry monotonic stream-specific sequence numbers and immutable IDs.
Immediate ASR passages are the recoverable checkpoint while later stages run;
word batches add separate word records and never update already emitted IDs.
Unknown cluster IDs must be declared in the same or an earlier activity batch.
Foreign IDs/generations, invalid UTF-8, duplicate IDs, skipped/repeated sequences,
invalid ranges, overflowing allocations and inconsistent text references are
protocol failures. Do not deduplicate legitimate simultaneous content using the
legacy transcript boundary. Final reconciliation maps opaque cluster keys to the
canonical roster without rewriting original text.

Exactly one terminal response per work request is accepted. Duplicate or late
terminal/events cannot change a cancelled or promoted result. `AnalysisFinished`
may validly contain complete transcription plus failed speaker analysis; it is a
partial report, not a generic empty failure. An unexpected EOF/crash produces a
parent-side incomplete outcome. Never infer completion from progress=100 or exit 0
without a valid terminal result.

## Deadlines, backpressure and cancellation

Reuse the existing bounded normal queue and reserved terminal queue. Blocking
pipe/native work runs only in the background owner/child. UI cancellation feedback
must occur within 2 seconds, even if a model call is uninterruptible; terminate and
reap the directly owned child in the background and release resources before
another analysis starts. Never reuse a possibly corrupted model context.

Initial hard budgets for the compatibility test are: startup 60 seconds, local
profile validation/model-loading stage 180 seconds, and total analysis
`max(300 seconds, 2 * audio_seconds + 180 seconds)`. They are safety deadlines,
not performance acceptance; the 10-minute acceptance limit remains 1200 seconds.
Before duration is known, decoding gets 180 seconds. Established compatible-device
budgets are frozen in the profile and recorded in evidence; they cannot be
extended by logs, a repeated percentage or arbitrary heartbeat.

For stages exposing genuine progress, reject regressions and renew a 120-second
idle deadline only for increasing work in the correct current stage. For an
opaque stage without reliable callbacks, show indeterminate progress and use its
fixed remaining hard budget rather than inventing a renewable heartbeat. Keep
per-stage order explicit so a percentage reset in a new stage is not a regression.
No successful message can renew the hard total deadline.

No automatic retry, cloud fallback, device downgrade or model substitution.
Explicit retry starts a fresh generation. Recording is never active concurrently
with this file-analysis job, and securing a stopped recording never depends on it.

## Reports and validation

Report source name/duration, selected language/profile/device, completion and
coverage, count mode/requested/observed count, Person labels, durations/shares/
turns, overlap, unknown and uncovered time, warnings and timestamped passages.
Keep source details local. Preserve unaligned text and clearly label missing timing.
Use the same pure renderer for clipboard/file export and summary formatting rules
from [the data model](../data-model.md); reuse current non-overwriting save behavior.

Contract tests cover all bounds/identities, stdout contamination, stale results,
progress reset/heartbeats, queue saturation, terminal uniqueness, stage failures,
kill/reaping and old-result retention. Real-model checks establish local assets,
language, raw overlap, CPU/GPU behavior and zero network attempts separately.
