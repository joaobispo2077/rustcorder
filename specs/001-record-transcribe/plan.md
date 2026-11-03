# Implementation Plan: Desktop Voice Recording and Transcription MVP

**Branch**: `main` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

**Input**: `specs/001-record-transcribe/spec.md`

**Status**: Native implementation and default automated checks completed; real
device/operator, clean-machine and end-to-end performance acceptance still tracked
in tasks.md and docs/implementation-validation.md.

## Summary

Use native Rust egui/eframe for two desktop task screens, WASAPI for mic/output
loopback capture, streaming WAV storage, and whisper-rs/whisper.cpp in a hidden
local inference child. Portuguese is the default; user-selected compatible local
models provide optional English. No cloud, server, downloader or meeting API.

The user requested technical planning for the existing specification, not a second
feature. Explanation: [local desktop technical plan](../../docs/local-desktop-technical-plan.md).

## Technical Context

**Language/Version**: Rust MSVC x64; installed rustc/Cargo 1.95.0 verified. Native
whisper.cpp C/C++ code is embedded through Rust bindings. Pin the tested toolchain
and resolved dependency set at the first compatible build.

**Primary Dependencies**: egui/eframe, rfd, wasapi, rubato, hound, Symphonia,
whisper-rs, serde/serde_json. Documentation snapshots and sources: [research.md](research.md).

**Storage**: Settings JSON under `%LOCALAPPDATA%/rustcorder/`; selected-folder WAV
and UTF-8 TXT. Model folder is read-only to the app; no database.

**Testing**: Rust unit tests for state, mixing/alignment, silence, file naming,
model/language validation and transcript overlap; native boundary/process tests;
limited Windows device/UI acceptance. Failing tests before implementation.

**Target Platform**: Windows x64, initial validation on Windows 11 x64. Windows 10
compatibility is not claimed before a separate validation pass.

**Project Type**: Single desktop Cargo package/executable, with an internal hidden
inference-worker entry mode. No workspace, web frontend, services or plugin system.

**Performance Goals**: SC-001–SC-011: one-hour recording, <=250 ms source alignment,
<=5 s live phrase latency for 95% of phrases, <=20% clean-speech word error rate,
and <=30 s finalization. Proposed acceptance targets, not proven library properties.

**Constraints**: CPU inference baseline; no runtime network dependency/request;
bounded queues/windows; no hour-sized PCM buffer; native failure isolation; single
recording/transcription task; no silent file replacement.

**Scale/Scope**: One local user, four stories, Portuguese and optional English,
one mic/output. Proposed disclosed six-hour recording cap protects RIFF WAV size.

## Constitution Check

*Reviewed before research and again after design.*

| Gate | Before | After-design evidence |
| --- | --- | --- |
| Current branch only | Pass | `main` unchanged; no installed extension hooks |
| Authorized scope/preservation | Pass | Existing four stories; no app implementation or unrelated changes |
| Test-first, unit-first | Pass | Failure-first sequence and native checks in quickstart |
| Architecture/pattern diagnosis | Pass | Both selection skills read; one package with real I/O boundaries |
| Documentation placement | Pass | User explanation under docs/; workflow artifacts in this directory |
| Release controls | Pass | No changelog release entry, tag recommendation, tag or push |

Architecture diagnosis: small greenfield desktop app, capture and transcription
capabilities, external audio/filesystem/native inference boundaries. Use lightweight
Ports and Adapters through ordinary modules and injected test inputs. No Clean
Architecture hierarchy, DDD framework, Singleton or speculative provider registry.

The inference child is justified by FR-014/SC-008: a Rust thread cannot contain a
native inference crash. Parent owns audio capture/storage; only child loads models.
An audio adapter has a real Windows integration responsibility; no extra pattern
framework is needed.

The setup script's BRANCH field returned `001-record-transcribe`: its helper falls
back to the feature-directory name. Actual read-only Git verification reports
`main`. This does not authorize branch operations or require a tooling rewrite.

## Project Structure

### Documentation (this feature)

```text
specs/001-record-transcribe/
  spec.md
  plan.md
  research.md
  data-model.md
  quickstart.md
  contracts/desktop-and-worker.md
  checklists/requirements.md
```

`tasks.md` is owned by `/speckit-tasks`; it is not created by this planning step.

### Source Code (proposed, not scaffolded)

```text
Cargo.toml
Cargo.lock
rust-toolchain.toml
src/
  main.rs                  # desktop vs internal inference-worker entry
  lib.rs                   # testable modules
  app.rs                   # task state, commands/events
  ui.rs                    # record/file/model controls
  audio/
    mod.rs                 # normalization, timeline, mix, queues
    windows.rs             # WASAPI endpoints/capture ownership
  recording.rs             # unique files, WAV streaming/finalization
  transcription/
    mod.rs                 # child lifecycle and parent-side state
    worker.rs              # model load, file decode, inference, pipes
    transcript.rs          # pending/stable text and coverage gaps
  models.rs                # compatible folder/language validation
  settings.rs              # local config persistence
tests/
  integration/
  fixtures/                # small redistributable audio, no private calls/models
```

**Structure Decision**: One package. Create modules only when a delivery slice needs
them; no empty layer scaffolding. Unit tests live next to logic. Native integration
tests must be discoverable through a top-level Cargo test harness or declared test
targets; a nested directory alone does not register tests.

## Phase 0: Decisions and Feasibility Gates

Design decisions and alternatives are resolved in [research.md](research.md).
Hardware measurements are implementation proof, not unresolved product questions.

1. Resolve/build/lock the Windows dependency set and parent/worker modes. Verify
   native runtime packaging on a clean disconnected Windows machine.
2. Benchmark multilingual base versus small on real Brazilian Portuguese/English
   fixtures, recording actual CPU/RAM/model hash/build/thread count. If accuracy
   and live-speed targets cannot both pass, stop and present measured alternatives;
   do not silently weaken criteria or switch to cloud.
3. Prove mic plus loopback with silent output, unequal device rates, default/source
   changes and one-hour drift. Confirm inference CPU load/crash cannot lose audio.

If simple silence gating fails the specified no-speech/quiet-speech tests, make an
explicit offline VAD-asset decision; do not assume an undeclared model is available.

## Phase 1: Design and Contracts

- [Data model and state transitions](data-model.md).
- [Desktop/model/worker contracts](contracts/desktop-and-worker.md).
- [Development and acceptance guide](quickstart.md).

Audio completion and transcription completion are independent. Capture threads
never wait on inference or perform disk writes. A mixer/writer owns the saved WAV.
The child receives bounded windows; native errors, exits and timeouts preserve
parent-owned audio and finalized text. No sockets or HTTP endpoints are needed.

## Delivery Sequence

1. Locked native build and model/inference feasibility, with failing tests first.
2. Mic recording/WAV saving plus minimal Record UI.
3. Combined capture/alignment, device/storage faults and one-hour proof.
4. Local model settings, imported-file transcription and Copy/Save.
5. Live windows/stable text, bounded finalization and inference-child fault tests.
6. Disconnected packaging, keyboard/Narrator and focused end-to-end acceptance.

Use small feasibility harnesses, not an unrelated benchmark framework. Planning
ends here; no application code or tasks were generated.

## Complexity Tracking

No constitutional exceptions. The hidden child is the sole deliberate additional
runtime boundary needed for native crash isolation; a parent thread is insufficient.
