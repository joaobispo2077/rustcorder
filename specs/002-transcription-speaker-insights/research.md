# Phase 0 Research Decisions

Date: 2026-11-05. [Plan](plan.md) / [feature spec](spec.md).
The broader comparison remains in [the research report](../../docs/transcription-speaker-research.md).
The user confirmed local-only CPU/GPU operation. No new weights or runtimes were
installed and no candidate accuracy benchmark was run during this planning phase.

## R1 - One quality backend: pinned WhisperX

**Decision**: Target stable WhisperX 3.8.6 for the first quality integration;
compare large-v3 and turbo within it. Use explicit PT/EN, local alignment and
Community-1. Core base/small CPU inference remains separate and available.

**Rationale**: Verified source exposes selected language, local loading, known-count
hints and ordinary overlapping speaker activity. These match the requested
contract without requiring a new native FFI or accepting weaker semantics.
[Stable release](https://github.com/m-bain/whisperX/releases/tag/v3.8.6),
[ASR source](https://github.com/m-bain/whisperX/blob/v3.8.6/whisperx/asr.py),
[diarization source](https://github.com/m-bain/whisperX/blob/v3.8.6/whisperx/diarize.py).

**Alternatives considered**: Native-only larger Whisper improves the ASR control
but does not solve full speaker identities. NeMo remains an experiment (R2).
Qwen, Canary and VibeVoice do not need production integrations for this increment.

**Acceptance dependency**: This selection defines the adapter to build if the
compatibility/accuracy gate passes. It is not an assertion that large-v3 beats
small on the user's recordings. No candidate passing means no quality recommendation.

## R2 - Native challenger has a release, but is not contract-equivalent yet

**Decision**: Use NeMo-Speech.cpp v0.3.0 only in the comparison harness, with local
Parakeet v3 and Nemotron 3 paths. Do not expose another production backend selector.

**Rationale**: The release dated 2026-10-30 has Windows x64 CPU/CUDA/Vulkan assets.
The earlier uncertainty about whether Windows binaries exist is resolved.
[Release](https://github.com/NVIDIA/NeMo-Speech.cpp/releases/tag/v0.3.0),
[published assets](https://github.com/NVIDIA/NeMo-Speech.cpp/releases/expanded_assets/v0.3.0).

Pinned contracts show that word JSON assigns one speaker, the standalone C ABI
exposes richer speaker activity, and `max_speaker_count` in the HTTP contract is
deprecated/ignored. Parakeet's documented automatic language recognition does
not prove it honors forced PT/EN selection. Local paths must cover every companion
to avoid indexed downloads.
[CLI](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/cli.md),
[API](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/docs/api.md),
[diarization ABI](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/v0.3.0/include/nemo_speech/diar.h).

**Alternatives considered**: Building a second full adapter or native FFI now adds
integration before quality and contract eligibility are demonstrated.

**Promotion gate**: Prove explicit-language compatibility, raw overlap, count-hint
capability or honest unavailability, bounded progress/output, cancellation and all
spec acceptance gates. Then revise the selected adapter deliberately; no runtime
fallback from WhisperX to native is planned.

## R3 - Freeze a complete optional Windows environment

**Decision**: Target Python 3.12 and WhisperX 3.8.6 with matching PyTorch/torchaudio
2.8; resolve exact patches, transitive wheels, native DLLs and hashes during the
first reproducible compatibility experiment. Publish only the resulting frozen
CPU/CUDA profiles, separately from the small core app. The production launcher
uses the profile's own Python, never an arbitrary executable from PATH.

**Rationale**: Stable package metadata allows Python >=3.10 and <3.14 and pins the
PyTorch family. Its Windows architecture markers must not be assumed to choose
the intended CUDA wheels automatically. An exact tested lock is an implementation
deliverable, not a guessed dependency list.
[Pinned package metadata](https://github.com/m-bain/whisperX/blob/v3.8.6/pyproject.toml).

**Alternatives considered**: Global Python/pip, on-demand dependency installation,
and trusting the prerelease/main environment are inconsistent with offline,
repeatable operation. Baking both pipelines into the existing executable adds
unnecessary build complexity.

**Freeze rule**: Before application integration, the experiment must produce a
manifest of exact runtime versions, package hashes, model revisions, compute
settings and notices. Missing or unresolved assets make a profile unavailable;
this is a concrete build gate, not a user clarification.

## R4 - Close every hidden download path

**Decision**: Preflight complete local ASR/tokenizer resources, explicit local
English/Portuguese HF alignment directories, PT/EN NLTK `punkt_tab`, a local VAD
checkpoint and a self-contained local Community-1 pipeline/embedding dependency
tree. Supply `local_files_only` where supported; set offline environment flags,
disable pyannote telemetry and pass waveform data to avoid convenience URL loaders.

**Rationale**: Pinned alignment code calls `nltk.download` when sentence resources
are absent. Its default English torchaudio loader can download weights. The Silero
convenience VAD uses `torch.hub`; explicitly loading a local Pyannote VAD instead
has a missing-file failure path. A folder containing just the large weights is
not a complete offline model.
[Alignment](https://github.com/m-bain/whisperX/blob/v3.8.6/whisperx/alignment.py),
[Silero convenience loader](https://github.com/m-bain/whisperX/blob/v3.8.6/whisperx/vads/silero.py),
[local Pyannote VAD](https://github.com/m-bain/whisperX/blob/v3.8.6/whisperx/vads/pyannote.py).

Use the documented local pipeline path and disable `PYANNOTE_METRICS_ENABLED`.
Provisioning and gated terms acceptance happen outside normal app operation;
credentials are not placed in the package or settings. Trace connection attempts
even with networking available. [Community-1 offline use](https://huggingface.co/pyannote/speaker-diarization-community-1#offline-use),
[telemetry controls](https://github.com/pyannote/pyannote-audio#telemetry).

**Alternatives considered**: Warm developer caches, merely disconnecting the
network, remote model IDs and convenience downloads are not offline proof.

## R5 - Preserve existing ownership; adapt only the real external boundary

**Decision**: Reuse `Job`, `WorkerProcess`, controller guards and bounded queues.
Directly supervise one Python quality worker implementing private protocol v2.
Keep the legacy same-executable worker for base/small and live requests. Add
analysis/result and pure participation modules; do not create service/port layers.

**Rationale**: The current test seam can already inject a child command.
`Transcript::commit` uses a global stable boundary and cannot store simultaneous
speaker content safely. Quality readiness must not depend on a legacy model;
result storage must distinguish the old complete result from a replacement draft.
See [jobs](../../src/transcription/jobs.rs), [transcript](../../src/transcription/transcript.rs),
[UI](../../src/ui.rs), and [controller](../../src/app.rs).

Both repository selection skills were consulted. Their simpler alternative wins:
owned values, pure functions and one adapter for one mismatched external interface.
No registry, Singleton, abstract factory or application-wide architecture rewrite.

**Alternatives considered**: In-process Python risks native failures in the UI;
an HTTP sidecar adds a listener/lifecycle; a Rust bridge launching Python adds a
second process layer; changing the live merge algorithm risks unrelated behavior.

## R6 - Separate activity, words, coverage and identity

**Decision**: Canonical 16 kHz `u64` ticks; independent overlapping activity and
unaligned/unassigned text; per-stage coverage/status; provisional partial labels;
final labels ordered by first activity then opaque source key. Store the hint
separately from observed nonempty speaker identities.

**Rationale**: Word assignment chooses a dominant speaker and must not erase a
second active voice. Unknown/unprocessed intervals are not silence. One person's
label need only be consistent within the completed result, not between reruns.
The exact interval, rounding and turn rules are in [data-model.md](data-model.md).

**Alternatives considered**: Counting text chunks, treating channels as people,
exclusive diarization for duration, nearest-person filling and using the supplied
count as an observed result all produce misleading participation statistics.

## R7 - Controlled comparisons before a quality claim

**Decision**: Freeze a licensed/permissioned 12-conversation, >=60-minute corpus,
including >=30 minutes per language, one through four speakers and four held-out
conversations. Remeasure both legacy options. Pin normalization, DER collar/overlap
and reference annotations. Score all eligible speakers, including missed ones.

**Rationale**: Historical FLEURS scores are read speech, not a meeting diarization
baseline. Runtime, alignment and recognition improvements are different outcomes.
The feature's success criteria remain unchanged; [evaluation.md](contracts/evaluation.md)
makes their scoring reproducible.

**Alternatives considered**: Publisher leaderboards, supplied-count runs scored
as automatic counting, per-clip WER averages, tuning on held-out audio and timing
only inference are insufficient acceptance evidence.

## Resolution and verification status

All planning questions have decisions above; no user clarification is pending.
Actual wheel/model hashes, clean Windows compatibility, CPU/CUDA memory, raw
long-audio behavior and corpus scores are explicit implementation evidence gates.
They are not fabricated here. No upstream installer was executed. The first
production integration is bounded to the selected WhisperX worker; alternative
promotion requires revising this plan from measured evidence.
