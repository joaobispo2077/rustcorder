# Analysis Data Model

Date: 2026-11-05. [Specification](spec.md) / [plan](plan.md).
These are planned internal value types, not a database schema or a public API.

## Time and validation

Reuse the current analysis timeline: 16,000 samples per second, `u64` indices,
half-open `[start, end)` intervals. The turn join limit is exactly 8,000 ticks.
Recording duration comes from decoded samples, not wall-clock job time.

Convert upstream finite nonnegative seconds with checked nearest-tick rounding
(`floor(seconds * 16000 + 0.5)`). Reject overflow and activity outside the decoded
duration, reversed intervals and zero-length activity. Preserve text whose word
timing is absent/invalid as untimed text with a warning; never fabricate timing.
Do not use alignment interpolation to invent missing word timestamps. No general
clamping of invalid model output is allowed. Rebase any bounded ASR/alignment
windows onto the original timeline before validation.

## Entities

### RecordingRef

| Field | Meaning |
| --- | --- |
| `source_id` | Attempt-local association with the selected source; no global identity |
| `path` | Absolute canonical local WAV/MP3 path, read-only |
| `language` | Explicit `pt` or `en` |
| `duration_ticks` | Available after successful decode |
| `source_fingerprint` | File identity/size/modified-time snapshot; acceptance runs also retain SHA-256 |

Reject source changes detected during a job; never attach its results to a different
recording. Source hashes for benchmarks prove preservation, not real-world identity.

### AnalysisProfile

| Field | Meaning |
| --- | --- |
| `profile_id`, `manifest_schema` | Known profile and supported manifest schema |
| `root`, `manifest_hash` | Canonical local assets/runtime root and pinned identity |
| `runtime_version`, `runtime_lock_hash` | Exact Python, WhisperX and wheel/native-library lock |
| `asset_records` | Relative paths, revisions, byte lengths, SHA-256 and notices for every required artifact |
| `device_configs` | Explicit CPU/CUDA configurations with compute type, thread/batch limits and memory estimates |
| `languages` | Supported, validated subset of PT/EN with explicit local aligners |
| `speaker_capabilities` | Anonymous diarization, overlap, automatic count, hinted count and validated range 1–4 |
| `limits` | Declared resource/deadline/result budgets; no implicit unlimited allocation |

This is a data-only manifest for the one built-in quality adapter, not a plugin
description. No shell commands, remote URLs for runtime loading, arbitrary Python
modules or executable arguments are interpreted from it. Resolve all relative
artifact paths under the canonical profile root; reject traversal and escaping
links/junctions. Validate required notices and exact local bytes before readiness.
An ASR-only request does not require optional diarization assets.

### AnalysisOptions

`profile_id`, `manifest_hash`, explicit `device`, `language`,
`speaker_analysis: bool`, `requested_count: Option<u32>` and `job_generation`.
The known count is per attempt, cleared for a new source, and allowed only when
speakers are requested and the profile advertises it. Hints outside the advertised
range fail preflight. Options are immutable once processing starts.

### AnalysisResult

Own `result_id`, `job_generation`, `RecordingRef`, frozen `AnalysisOptions`, selected
runtime/asset identity, stage outcomes, coverage, ASR passages, optional aligned
words, raw speaker activity, timed unassigned activity, roster, warnings and the
derived summary. Events must match both source/attempt and generation.

Store a successful ASR text checkpoint before alignment or diarization. Word
records reference passage IDs and text spans; alignment/attribution supplements
the original text rather than creating a duplicate transcript. Untimed words stay
in their original passage order. No passage may silently disappear because it
overlaps another speaker.

### StageOutcome and Coverage

Stages: decode, transcribe, align, diarize, finalize. Each records `not_requested`,
`pending`, `running`, `complete`, `cancelled` or `failed`, with an optional bounded
error/warning and processed work information. A cancelled/failed later stage
does not downgrade an already complete transcript to missing text.

Transcription and diarization each own a union of **known processed coverage**.
Coverage states whether an interval was evaluated, including intervals with no
speech. Only trust committed output batches, not percentage messages, as evidence
of coverage. Final success requires full `[0, duration_ticks)` coverage for each
requested stage that defines coverage. Unknown tails/holes remain uncovered.

Alignment may complete with individual untimed words and warnings. A whole-stage
failure retains ASR text and any valid independent speaker analysis; it makes the
combined report incomplete. Fatal speaker failure leaves transcript export usable.

### Speaker

`source_cluster_key` (opaque bounded string), attempt-scoped `speaker_id`,
`first_activity_tick`, `final_ordinal: Option<u32>` and provisional/final status.
Discard empty clusters from the observed count. On successful final reconciliation,
order speakers by first activity and then source key for deterministic ties.
Render final ordinals as Person 1, Person 2, etc. A rerun is a new result and does
not imply the same ordinal identifies the same person.

Keep count provenance separate: `count_mode = automatic | hinted`,
`requested_count`, `observed_count` from nonempty identities, and any conflict
warning. Never set `observed_count` to the supplied hint. A result outside the
validated 1–4 range is labelled outside the validated range, not truncated to four.

### ActivityInterval and UnassignedActivity

Attributed activity is `{speaker_id, start_tick, end_tick}`. Multiple intervals
from different speakers can overlap. Normalize duplicates/nesting per speaker
before deriving any totals. Raw output remains separate from word labels.

Timed unassigned activity records detected speech that cannot be assigned, with
its origin/reason. It can coexist with attributed activity when supported by
actual evidence. Untimed or unassigned text alone does not establish an extra
speaker or a measured duration. Keep unassigned words distinct from unassigned
activity; VAD speech not covered by attributed activity can establish unknown
speech, but do not infer additional overlapping voices from a text-label gap.

If text indicates speech and the analyzer reports no attributed activity, retain
the text and signal unassigned/inconsistent analysis; do not present a confident
completed zero-speaker report. True no-speech requires successful relevant analysis.

### TranscriptPassage and AlignedWord

A passage has stable ID, original-language text, original order, optional timing
and available word references. A word has passage ID/text span, optional interval,
optional dominant speaker and an attribution state: attributed, unassigned or
ambiguous-overlap. Preserve all text even when timing or speaker identity is absent.

Choose a dominant speaker only for a unique greatest positive intersection with
the word interval. Ties stay ambiguous; no positive overlap means unassigned.
Mark detected overlap only when the word has positive-duration intersection with
the actual timeline where at least two distinct speakers are simultaneously active.
A word spanning adjacent, non-overlapping turns can have ambiguous attribution
without being overlapping speech.
Do not fill from the nearest person or interpolate identity across silence.
This readable assignment never replaces raw activity for statistics.

Emit each word once, after alignment and requested diarization resolve or fail.
The earlier ASR passages are the recoverable text checkpoint; no word upsert or
replacement protocol is needed. Text spans use half-open UTF-8 byte offsets into
the original passage and must end on character boundaries. If a word cannot be
mapped to original text, retain the passage and report missing word mapping.

### ParticipationSummary

| Field | Derivation |
| --- | --- |
| Per-person `speaking_ticks` | Union length of that person's activity |
| Per-person `share` | Person duration / sum of all attributed person durations; absent for zero denominator |
| Per-person `turn_count` | Chains under the rule below |
| `attributed_speaker_ticks` | Sum of per-person duration; can exceed elapsed speech |
| `attributed_elapsed_ticks` | Union length across attributed activity |
| `any_speech_ticks` | Union length of attributed and timed unassigned activity |
| `overlap_ticks` | Time at least two distinct attributed speaker IDs are active |
| `unassigned_ticks` | Union length of timed unassigned activity |
| `no_detected_speech_ticks` | Known diarization coverage minus any detected speech inside that coverage |
| `uncovered_ticks` | Recording timeline minus known diarization coverage |
| `provisional` | True until requested speaker analysis and final reconciliation complete |

Unknown and attributed elapsed time need not be disjoint; never add their totals
to derive any-speech. Three simultaneous speakers contribute one elapsed overlap
interval, not three pairwise intersections. A duplicate interval must not create
overlap with itself. Compute using integer ticks and distinct active IDs.

For turns, first union one speaker's overlapping/touching intervals. Join remaining
successive intervals only when their gap is <=8000 ticks, fully covered, and has
no positive-duration other-speaker or unassigned activity. Overlap inside an ongoing
interval does not split a turn. Joined silence adds no duration. Text chunking,
punctuation and filtering do not affect this computation.

Keep full precision until rendering. Show seconds with one decimal and shares
with one decimal percentage using deterministic decimal half-up rounding; use
integer/rational arithmetic for ties. Explain rounding and the person-time
denominator. Reuse the same summary for UI and report; filtering changes passages
only. See the worked example in [the spec](spec.md).

## State transitions and ownership

```text
idle -> validating -> running(decode/transcribe/align/diarize/finalize)
     -> complete | partial_failed | cancelled
```

Only requested stages run; ASR-only skips diarization. A valid no-speech result
can skip unnecessary model stages with an explicit successful no-speech outcome.
Unrequested speaker data is unavailable, not zero. Finalization validates all
identities, coverage, batches and counts before completion.

The UI owns `last_complete` and `current_attempt` separately. Starting a replacement
after the existing unsaved-result guard creates a draft; failure/cancellation
retains that draft with partial status and leaves `last_complete` intact. Success
promotes the new result. Permit explicit inspection/export of either retained
result without adding persistent history. Maintain independent text/report unsaved
state and existing close guards. No action waits on native inference in the UI.

## Preferences and compatibility

Add optional defaulted `analysis_profile_root`, `analysis_device` and quality-mode
preference to existing settings schema 1. Old files load with standard CPU behavior;
readiness is always revalidated. Keep existing model/config fields intact. Do not
persist speaker hints, text, raw voices, readiness or complete results in settings.
Preserve existing malformed/newer-schema rejection and atomic save behavior.
