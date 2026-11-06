# Validation Quickstart

Date: 2026-11-05. [Plan](plan.md) / [application contract](contracts/desktop-and-analysis.md)
/ [evaluation contract](contracts/evaluation.md).

**Current state**: This is the implementation validation guide. The new quality
worker, package script, conversation harness and analysis tests described below
are planned and do not exist yet. The original build/test commands already exist.
Do not report the new scenarios as passed from this guide alone.

## Prerequisites

- Existing Windows x64/MSVC Rust setup from [development.md](../../docs/development.md).
- Optional quality profile containing its own Python/runtime, exact locked wheels,
  local ASR/tokenizer, local PT/EN aligners, VAD, NLTK resources and optional
  Community-1 assets/notices. No developer cache or global Python dependency.
- CPU profile and, for GPU validation, a compatible CUDA profile and GPU driver.
  The reference GPU has 8 GB total; measure actual memory headroom with the UI open.
- Local permissioned/human-referenced corpus manifest as defined in the evaluation
  contract, including a frozen held-out split. Keep audio/references ignored.
- Read-only source fixtures and a separate writable report/scratch location.

Run from `C:\Users\vitor\dev\tools\rustcorder` on the user's current branch.
Use fresh report names so previous evidence is preserved. Do not run branch hooks.
For follow-up Spec Kit work, explicitly select this feature directory if another
workflow has moved the shared feature selector. Do not overwrite another active
feature's selector just to run read-only validation.

## 1. Preserve the existing baseline

These commands are available now; use the existing offline dependency cache:

```powershell
rtk proxy powershell -NoProfile -File C:\Users\vitor\dev\tools\rustcorder\scripts\dev.ps1 test --locked --offline
rtk proxy powershell -NoProfile -File C:\Users\vitor\dev\tools\rustcorder\scripts\dev.ps1 clippy --locked --offline --all-targets -- -D warnings
rtk proxy powershell -NoProfile -File C:\Users\vitor\dev\tools\rustcorder\scripts\dev.ps1 fmt --all -- --check
```

Expected: ordinary tests/checks pass; explicitly ignored device/model cases remain
separate and must not be counted as passes. Preserve recording, live text, legacy
model errors, export and staged sidebar/workspace layout behavior.

## 2. Implement test-first deterministic slices

Before implementing each behavior, retain its failing test output, make the narrow
change and rerun. After the planned modules/tests exist, focus Rust tests with
`test --locked --offline participation` and `test --locked --offline analysis`,
using the same `scripts/dev.ps1` wrapper above. Run the new Python adapter unit
tests with its profile's local Python and standard-library unittest discovery:

```powershell
rtk proxy C:\Users\vitor\dev\tools\rustcorder\models\quality-whisperx\runtime\python.exe -I -m unittest discover -s C:\Users\vitor\dev\tools\rustcorder\workers\tests
```

Expected: no models or network required for these cheap tests. Prove the spec's
7-second/4-second example, exact turn threshold, duplicate/nested activity,
three-way/unknown overlap, zero denominator, rounding, uncovered tails, deterministic
ordinals, hint provenance, filtering and old-result retention. Use fake children
for bounds, stdout contamination, deadlocks, stale IDs, progress and terminal rules.

## 3. Freeze and validate the optional runtime

The planned package script consumes a fully provisioned profile; it does not
download weights or install dependencies during app operation. Its planned command is:

```powershell
rtk proxy powershell -NoProfile -File C:\Users\vitor\dev\tools\rustcorder\scripts\package-quality.ps1 -ProfileRoot C:\Users\vitor\dev\tools\rustcorder\models\quality-whisperx -Device cpu
```

Repeat for `-Device cuda` using the separately frozen CUDA configuration. Expected:
all runtime/asset hashes and notices verified, an output manifest records exact
versions and settings, and a missing artifact produces a local failure. The script
must refuse to overwrite an existing package and preserve the core package.

In the app, choose this local profile, explicit PT then EN, and CPU then CUDA.
Remove an ASR tokenizer, PT/EN NLTK resource, aligner, VAD or diarizer asset from a
disposable test profile one at a time. Expected: named not-ready error without any
download attempt. ASR-only remains independent of optional speaker assets.

## 4. Run the same-conversation comparison

After the harness exists and the manifest is frozen, these are its planned calls:

```powershell
rtk proxy powershell -NoProfile -File C:\Users\vitor\dev\tools\rustcorder\scripts\benchmark-conversations.ps1 -Manifest C:\Users\vitor\dev\tools\rustcorder\.build\fixtures\conversations\evaluation.json -Candidate baseline-base -Device cpu -ReportName base-cpu-first
rtk proxy powershell -NoProfile -File C:\Users\vitor\dev\tools\rustcorder\scripts\benchmark-conversations.ps1 -Manifest C:\Users\vitor\dev\tools\rustcorder\.build\fixtures\conversations\evaluation.json -Candidate baseline-small -Device cpu -ReportName small-cpu-first
rtk proxy powershell -NoProfile -File C:\Users\vitor\dev\tools\rustcorder\scripts\benchmark-conversations.ps1 -Manifest C:\Users\vitor\dev\tools\rustcorder\.build\fixtures\conversations\evaluation.json -Candidate whisperx-large-v3 -Device cuda -ReportName whisperx-large-cuda-first
```

Also register and run `whisperx-turbo` on CPU/CUDA, `whisperx-large-v3` on CPU,
the native larger-Whisper controls and the eligible native challenger with unique
names. The manifest supplies exact local artifacts/settings; no automatic model
downloads or silent downgrades. Use development recordings for tuning, then run
held-out scoring once settings are frozen.

Expected: create-new raw/scored reports, per-language results and all acceptance
thresholds from the evaluation contract. A failed gate is retained and reported,
not relabelled as success. At exactly 12 recordings require at least 11 automatic
counts correct; among four held-out recordings require at least three. Actual
model/device tests remain explicitly selected rather than ordinary unit fixtures.

## 5. Verify the user flow

1. With the network disabled, transcribe a PT WAV and EN MP3 in quality mode with
   speakers off. Compare/copy/save plain text and verify original file hashes.
2. Enable speakers for a known alternating/reappearing conversation. Confirm
   estimated count, consistent final labels and original-timeline timestamps.
   Repeat with a known-count hint; provenance and observed count remain distinct.
3. Inspect the participation summary and one person's passages. Confirm filtering
   leaves totals unchanged. Copy/save the report and compare displayed values,
   overlap/unknown/coverage notes and partial status.
4. Record in each existing mode without a quality runtime; stop and secure audio.
   Once ready, explicitly analyze the saved recording. Stopping never waits for it.
5. Build a complete result, start a replacement, cancel during ASR and later during
   diarization, and inject child failure. The old result remains; available new
   text is retained as incomplete. Failed speakers are not reported as zero people.
6. Test one speaker, quiet replies, similar voices, returning speakers, overlap,
   silence/music/noise/tones, unsupported count hints, resource errors, unwritable
   export and close-with-unsaved-result behavior. Keep legacy live/race tests passing.

Expected: SC-007 preservation/status behavior, keyboard-accessible controls and no
UI wait for model loading or child exit. Measure cancellation acknowledgement
within 2 seconds and verify the process is reaped before the next job starts.

## 6. Prove packaging, long input and offline behavior

Validate the optional package on a clean Windows account without developer model
caches, system Python or a CUDA toolkit beyond declared distribution prerequisites.
Measure a cold/warm 10-minute conversation including all stages and report creation;
the accepted configuration finishes within 20 minutes. Run a sustained 60-minute
case, inspect peak RAM/VRAM and temporary-file cleanup, then validate existing
long-input boundaries without silent truncation.

Run disconnected **and** with connected network tracing for the parent/child tree.
Expected: zero attempted downloads, telemetry or service connections. Repeat after
removing local sentence/tokenizer resources to catch lazy downloader paths.

Record results, source/runtime hashes, exact settings, test classification counts
and remaining limits directly under `docs/`. This does not authorize release or
tag creation. The planning command ends before implementation/task generation.
