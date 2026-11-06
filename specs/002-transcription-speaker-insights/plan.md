# Implementation Plan: Accurate Transcription and Speaker Insights

**Branch**: `main` (unchanged) | **Date**: 2026-11-05 | **Spec**: [spec.md](spec.md)

**Input**: `specs/002-transcription-speaker-insights/spec.md`

Planning is complete through Phase 1. This document does not claim model acceptance
or authorize release. The setup script reports the feature directory basename as
`BRANCH`; read-only Git status confirms the actual branch is `main`.
During validation, another workflow moved `.specify/feature.json` to feature 003.
That concurrent change is preserved; this plan and its checks explicitly target
feature 002. Downstream Spec Kit work must select this feature deliberately.

## Summary

Add completed-recording quality transcription and optional anonymous speaker
analysis to the existing Windows app. Use a provisioned, isolated **WhisperX
3.8.6 worker** as the initial integration target, with explicit Portuguese/English,
Whisper large-v3 or turbo, local alignment assets and Community-1 diarization.
Measure CPU and CUDA configurations before recommending a quality profile.
Keep base/small CPU recording/live workflows unchanged.

Retain overlapping speaker activity separately from text. Compute duration, speech
share and turns in pure Rust; display and export the same validated result.
Reuse existing job supervision, bounded pipes, cancellation and exclusive-job
guards. Native Parakeet/Nemotron is a benchmark-only challenger, not a second
production integration or a plugin system.

**First implementation gate**: freeze runtime/assets and references, prove offline
compatibility and raw overlap, then run the spec's accuracy/resource comparison.
Do not advertise higher accuracy or enable a recommended profile before evidence
passes. If WhisperX fails, evaluate the challenger and revise the selected boundary
from evidence before building another adapter. Do not relax acceptance silently.

## Technical Context

**Language/Version**: Existing Rust 2024 / MSRV 1.95; Python 3.12 release line for
the optional quality worker. Freeze the exact Python patch, all wheels and hashes
in the first compatibility gate; unpinned environments are not distributable.

**Primary Dependencies**: Keep current eframe 0.37, whisper-rs 0.16, serde,
symphonia and WASAPI stack. Quality profile targets WhisperX 3.8.6 with matching
PyTorch/torchaudio 2.8, CTranslate2/faster-whisper, PyAV, pyannote.audio 4 and
complete local alignment/VAD/tokenizer resources. Resolve and lock the full
Windows CPU/CUDA wheel graph separately; no runtime package installation.

**Storage**: Original audio stays read-only. Preferences remain schema 1 with
additive defaulted quality-profile/device fields; readiness and results are
transient. Keep a last complete result plus one current attempt in memory.
Export text/reports explicitly. Job-owned local PCM scratch supports decoding;
no database, transcript history or automatic report persistence.

**Testing**: Existing Cargo unit/integration suite; standard-library Python unit
tests for framing, path checks and output conversion using fakes without weights.
Explicit real-model, CPU/GPU, network, UI and package checks supplement cheap tests.

**Target Platform**: Windows x64. Reference: i7-11800H, approximately 64 GiB RAM,
RTX 3070 Laptop with 8192 MiB VRAM. Core app continues to work without a quality
runtime or GPU. Clean-host validation is required for the optional package.

**Project Type**: Single native desktop application with one directly supervised
optional analysis process; no network listener, service or cloud integration.

**Performance Goals**: SC-001 through SC-008 unchanged: per-language held-out WER
reduction >=20%, DER <=15%, count gates, duration accuracy, 10-minute analysis in
<=20 minutes on the declared device, cancellation acknowledged within 2 seconds.
These are acceptance targets, not achieved results. See [evaluation contract](contracts/evaluation.md).

**Constraints**: All assets local; zero attempted downloads/telemetry; explicit
device and language, no silent fallback. Only one active job. GPU stages release
unused models before subsequent stages; memory fit must be measured including
the UI. Use 16 kHz integer ticks and bounded transport; no live diarization scope.

**Scale/Scope**: One finished WAV/MP3 or saved recording per request, initially
validated for one through four participants. Include a sustained 60-minute case
and existing long-input boundaries; never silently truncate oversized work.

## Constitution Check

| Gate | Before research | After design |
| --- | --- | --- |
| Current branch and existing changes preserved | Pass: `main`; no branch hooks | Pass: documentation only; existing content preserved and concurrent feature-selector update respected |
| Bounded requested changes | Pass: spec defines saved-file quality and participation | Pass: no capture rewrite, live labels, semantic summaries, queues or history |
| Test-first executable work | Pass: no executable edits in planning | Pass: failing-test obligations and narrow boundaries defined below |
| Simplicity / selection workflows | Pass: both repository selection skills read | Pass: existing ownership retained; two cohesive Rust modules and one actual external adapter |
| Documentation locations | Pass: feature artifacts under `specs/` | Pass: user-facing design explanation directly under `docs/` |
| Release policy | Pass: no completion/release signal | Pass: no version, release entry, tag, commit or push action |

No constitution exception is requested. Target at least 90% cheap unit tests for
new behavior where feasible. Audit actual test types/counts rather than treating
every library test as cheap or padding counts. Preserve necessary model/process/
filesystem checks; document any justified ratio shortfall. No existing test is removed.

## Project Structure

### Documentation (this feature)

```text
specs/002-transcription-speaker-insights/
  spec.md
  plan.md
  research.md
  data-model.md
  quickstart.md
  checklists/requirements.md
  contracts/desktop-and-analysis.md
  contracts/evaluation.md
docs/
  transcription-speaker-research.md
  transcription-speaker-plan.md
```

`tasks.md` is deliberately not generated by this command; `/speckit-tasks` owns it.

### Source Code (repository root)

The following additions are planned, not already implemented:

```text
src/
  app.rs                         # exclusive actions and quality readiness
  ui.rs                          # retained result, summary, filter, report actions
  settings.rs                    # additive defaulted quality preferences
  transcription/
    mod.rs                       # coordinated private protocol v2
    jobs.rs                      # existing supervision + analyze job
    worker.rs                    # legacy inference behavior preserved
    transcript.rs                # legacy/live merge behavior preserved
    analysis.rs                  # new result/profile/status validation and reports
    participation.rs             # new pure intervals, labels, shares and turns
workers/
  quality_worker.py              # sole selected quality adapter
scripts/
  benchmark-conversations.ps1    # separate local experiment/evidence runner
  package-quality.ps1            # optional frozen runtime assembly/validation
tests/
  integration.rs                 # registers added boundary scenarios
  integration/
    worker_protocol.rs
    transcription_actions.rs
    speaker_analysis.rs          # explicit real-model boundary scenarios
  fixtures/README.md
workers/tests/                   # lightweight adapter unit tests, no model import
assets/quality/                  # manifests/locks/notices; no weights in Git
```

**Structure Decision**: Preserve the current controller -> job -> child boundary.
Use plain functions and explicit owned data. `analysis.rs` owns analysis-specific
state/validation/rendering; `participation.rs` owns deterministic arithmetic.
One Python boundary translates the selected external pipeline. No backend registry,
ports hierarchy, new service layer or dependency injection framework is justified.
Architecture/pattern rationale is recorded in [the design explanation](../../docs/transcription-speaker-plan.md).

## Implementation sequencing

1. **Compatibility and evidence gate.** Lock the isolated Windows runtime and all
   local resources; exercise real CPU/CUDA loading, overlap, selected language,
   count hints, missing-asset failures and cancellation. Freeze licensed human
   references and baseline settings. Compare legacy base/small, larger native
   Whisper controls, WhisperX large-v3/turbo and the native challenger. Stop
   production integration on failed quality/offline/resource gates.
2. **Pure result and participation slice.** First demonstrate failing cases for
   interval validation/unions, 7999/8000/8001-tick joins, coverage gaps, unknown and
   three-way overlap, deterministic labels, denominator zero and report rendering.
3. **Private protocol and worker slice.** Update parent, legacy worker, quality
   worker and fake fixtures together to v2. Keep old request behavior identical.
   First prove failure for bounded batches, invalid identities/intervals, stage
   progress, missing local resources, malformed output and terminal uniqueness.
4. **Controller and UI slice.** Add quality readiness independent of legacy model
   readiness, one explicit Analyze action after saving, stage status, partial
   retention, summary/filter and separate report actions. First fail tests for
   replacing a complete result, speaker-stage failure retaining text, stale events,
   save conflicts and unsaved-result close behavior. Preserve staged layout/races.
5. **Package and acceptance slice.** Supply the optional isolated CPU/CUDA runtime
   and user-provisioned licensed model assets. Validate clean Windows, no developer
   caches, all SC gates, long input, exports and zero network attempts. Record
   model hashes and honest failures; keep the core CPU package functional.

The quality-profile default model/compute settings are selected by that first
gate, not by model reputation. Use batch size 1 initially; tune only on development
recordings. A selected CPU configuration may be slower; the existing CPU path
remains available regardless of quality-backend readiness.

## Validation and risk controls

- Do not feed analysis through `Transcript::commit`: its single stable boundary
  can discard overlapping words. Keep ordinary diarization intervals independent.
- Decode in the quality child through local PyAV into owned scratch; use bounded
  decode buffers and a memory-mapped 16 kHz waveform where the pipeline permits.
  Preflight scratch capacity and estimated model memory; terminate with an explicit
  resource error rather than truncate or destabilize capture. Actual peak memory
  and long-input support are required measurements, not inferred from mapping.
- Load ASR, alignment and diarization sequentially; preserve the ASR text checkpoint
  before later stages. Run diarization with whole-recording identity context, not
  independently numbered short windows. Do not claim an unprocessed tail is silence.
- Freeze exact artifact revisions, hashes, notices and complete PT/EN tokenizer,
  NLTK, VAD and alignment resources. Explicit offline loaders and preflight prevent
  library convenience paths from attempting downloads. Verify by network trace.
- Use the existing supervisor with new command-specific deadlines and bounded
  event batches; arbitrary heartbeat/log output cannot renew a deadline. Directly
  launch the isolated Python worker, not a shell/package manager/HTTP service.
- No optional profile is ready until its exact packaged runtime passes local
  model and device validation. Do not rely on Python/CUDA already on the host.

See [data model](data-model.md), [application/worker contract](contracts/desktop-and-analysis.md)
and [quickstart](quickstart.md) for validation details.

## Complexity Tracking

No unjustified violations. The optional runtime is necessary to evaluate a real
multilingual words/alignment/diarization pipeline; it stays outside the core
package and current live inference. Only the selected adapter ships. Native
challengers remain bounded experiments until evidence warrants replacing it.

## Planning validation

Phase 0 decisions and Phase 1 data/contracts/quickstart are complete. Reviewed
cross-artifact consistency and corrected simultaneous-overlap detection, immutable
word-batch timing, UTF-8 text spans, unassigned-word scoring and control-run gate
semantics. Local links, required template sections, Markdown tables, absence of
unresolved placeholders and artifact completeness pass content checks.

Explicit read-only path resolution targets feature 002; shared feature 003 state
is retained. Existing staged content and the feature spec/checklist retain their
pre-planning hashes. `.specify/extensions.yml` is absent, so before/after planning
hooks are skipped. No runtime tests or model benchmarks were run for this
documentation-only phase. Continue with `/speckit-tasks` explicitly targeting this
feature; implementation and performance acceptance remain future work.
