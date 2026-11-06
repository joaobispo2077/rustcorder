# Transcription and speaker-analysis design

Date: 2026-11-05. This explains the [feature plan](../specs/002-transcription-speaker-insights/plan.md).
The user confirmed local-only processing and comparison of CPU/GPU options.

## Selected approach

Use **WhisperX 3.8.6 as the first quality integration target**, with larger
multilingual Whisper weights, local word alignment and Community-1 speaker
analysis. Keep current base/small CPU recording and live text available. The
quality option processes completed recordings and runs in its own supervised
process, using a separately provisioned offline runtime.

This is a deployment/design choice, not a claim that the candidate already improves
accuracy. First freeze the local environment and compare the exact recordings on
CPU and GPU. A recommended quality profile must satisfy the spec's gates before
the app calls it more accurate. Model weights, full dependency locks and clean-host
results have not been produced during planning.

Stable source supports explicit selected language, known-count hints and ordinary
speaker activity. Native NeMo-Speech.cpp v0.3.0 also has released Windows packages,
so Parakeet/Nemotron remains a useful comparison. Its selected-language, hint and
raw CLI behavior still need eligibility proof; do not ship two production adapters
before that evidence exists. [WhisperX release](https://github.com/m-bain/whisperX/releases/tag/v3.8.6),
[NeMo release](https://github.com/NVIDIA/NeMo-Speech.cpp/releases/tag/v0.3.0).

## Preserve the existing application

The project is one Windows desktop app. Its controller already owns exclusive
actions, background jobs supervise a child, and audio capture/storage remain
independent. Preserve those boundaries instead of adding a service architecture.
The new external pipeline needs one adapter because its results differ from the
app's contract. Plain owned values and functions are enough; no backend registry
or general plugin framework is needed.

The repository's architecture-selection and design-pattern-selection skills were
consulted. The concrete additions are a completed-analysis result module, a pure
participation module and one quality worker. Core source behavior is unchanged
by this planning work.

Do not route speaker results through the existing live transcript merger. It
advances one stable boundary and can discard overlapping content. Analysis instead
retains original passages, optional word timing and independent overlapping speaker
activity. The existing live merge logic stays intact.

## Speaker statistics users can trust

Number final speakers by first detected appearance within a recording. Keep supplied
count hints separate from observed voices. Return the same number when someone
speaks again, while clearly labelling uncertainty and estimates. There is no real-name
recognition or identity matching between recordings.

Calculate speaking time from each person's union of activity intervals, excluding
silence. Count turns using the agreed half-second gap convention, without counting
text chunks. Keep overlapping activity, unknown speech and uncovered analysis
separate. Unprocessed audio must not become silence. Use the same calculated
summary for display and export; filtering one person changes visible passages only.

Save the recording before analysis starts. Keep the previous completed result
while a new attempt runs. If speaker analysis fails, successful text remains usable
and partial statistics stay visibly incomplete. Export remains explicit; no
database or automatic conversation history is added.

## Offline and resource controls

The quality runtime must include every model companion and tokenizer/sentence
resource. Stable WhisperX code has convenience paths that can download missing
NLTK or alignment resources; preflight complete local paths and fail readiness
before those paths run. Verify zero attempted connections with tracing, as well
as disconnected operation. [Pinned alignment source](https://github.com/m-bain/whisperX/blob/v3.8.6/whisperx/alignment.py).

The reference GPU has 8 GB. Start with small batches and release unused stage
models before loading the next. Measure combined peak memory with the UI running;
do not silently downgrade quality or switch devices after a failure. The CPU
baseline remains usable without the optional package. Assets, licenses and gated
acquisition instructions are provisioned outside normal analysis.

## Evidence and delivery boundary

The plan begins with a reproducible compatibility/corpus comparison, then pure
analytics, the bounded worker contract, UI/export and clean-host acceptance. Each
executable slice starts with failing tests. Preserve necessary real process/model
tests and document any justified shortfall from the cheap-unit test ratio target.

Generated design artifacts are the [research decisions](../specs/002-transcription-speaker-insights/research.md),
[data model](../specs/002-transcription-speaker-insights/data-model.md),
[worker/UI contract](../specs/002-transcription-speaker-insights/contracts/desktop-and-analysis.md),
[evaluation contract](../specs/002-transcription-speaker-insights/contracts/evaluation.md)
and [validation guide](../specs/002-transcription-speaker-insights/quickstart.md).
Task generation and implementation follow separately. No branch operations,
runtime installation, release entry or tag action occurred during planning.
