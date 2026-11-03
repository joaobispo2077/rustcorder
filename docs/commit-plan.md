# Scoped commit plan

Prepared for approval. No commits have been created. Git has one staging area;
the complete staged snapshot must be divided according to this plan rather than
committed in one operation. Models, recordings, build caches and packages remain
ignored. Work stays on the existing branch.

## Order and responsibility

Each row is a separate proposed Conventional Commit. Documentation comes first.
The native Cargo bootstrap must precede executable checks. Production and test
commits are then interleaved by responsibility: tests refer to new symbols that
do not exist in the current README-only HEAD. This dependency adjustment keeps
tests separate without deliberately introducing missing-module commits. There
are no unrelated refactors or cleanup changes to invent.

| # | Proposed commit | Responsibility and contents |
| --- | --- | --- |
| 1 | `docs(governance): define project contribution rules` | Shared policy: AGENTS.md, constitution, CHANGELOG.md without release entries, branching/versioning/instruction-research docs, and this commit plan. |
| 2 | `docs(agents): align editor and agent instructions` | CLAUDE.md, .cursor/rules/, .github/ instruction files and the two .claude/ diagnostic skills; consistent policy across agent entry points. |
| 3 | `docs(spec): define the offline recording MVP` | specs/001-record-transcribe/ requirements, checklist, plan, research, data model, worker contract and tasks; docs/local-desktop-technical-plan.md. Excludes quickstart. |
| 4 | `docs(app): explain local setup and operation` | README.md, docs/project-overview.md, docs/development.md and the feature quickstart; user/developer operating instructions. |
| 5 | `docs(validation): record results and open checks` | docs/implementation-validation.md; measured evidence and explicitly pending acceptance. |
| 6 | `build(rust): pin the Windows native toolchain` | Cargo.toml, Cargo.lock, rust-toolchain.toml, .cargo/config.toml and scripts/dev.ps1; minimal Cargo target entry scaffolding, subsequently replaced by feature wiring. |
| 7 | `build(test): add isolated worker test support` | tests/support/fake_worker.rs, tests/fixtures/README.md and initial integration harness; reusable test support without behavior assertions or premature module registrations. |
| 8 | `build(bench): add the offline corpus runner` | scripts/benchmark.ps1; selecting and running the local quality/throughput measurements. |
| 9 | `feat(core): guard tasks and persist preferences` | Non-test portions of src/app.rs and src/settings.rs, plus their library declarations; exclusive task lifecycle and versioned local settings. |
| 10 | `test(core): cover task guards and preferences` | Inline tests in src/app.rs and src/settings.rs; lifecycle, immutable configuration and settings preservation. |
| 11 | `feat(recording): stream recoverable WAV files` | Non-test src/recording.rs and library declaration; unique paths, bounded streaming and explicit finalization. |
| 12 | `test(recording): cover WAV storage failures` | Inline recording tests; PCM/header boundaries, collisions, partial output and injected write/finalization faults. |
| 13 | `feat(audio): capture microphone and loopback` | Non-test src/audio/mod.rs and src/audio/windows.rs plus library declaration; fixed endpoints, timeline/mix, capture ownership and audio-priority delivery. |
| 14 | `test(audio): cover capture and source lifecycles` | Audio unit tests, microphone_recording.rs, combined_recording.rs and their harness registrations; combined tests retain their microphone helper dependency. |
| 15 | `feat(ipc): isolate local inference workers` | Non-test src/transcription/mod.rs and library declaration, with child submodule exports introduced only when their files exist; framing, cancellation and deadlines. |
| 16 | `test(ipc): cover worker framing and failures` | worker_protocol.rs and harness registration; bounded pipes, malformed output, crash/hang, progress deadlines and child reaping. |
| 17 | `feat(asr): transcribe files with local models` | Non-test src/models.rs and transcription/worker.rs, required module/worker-entry wiring, assets/silero-vad.json and its MIT notice; local model capabilities, file decoding and offline speech gating. |
| 18 | `test(asr): cover model and speech recognition` | Models/worker unit tests, file_transcription.rs, asr_feasibility.rs, asr_speech_gate.rs and matching harness registrations; source preservation and explicit real-model quality checks. |
| 19 | `feat(transcription): supervise jobs and live text` | Non-test transcription/jobs.rs, live.rs and transcript.rs with submodule exports; bounded job ownership, rolling windows, coverage and stable/pending text. |
| 20 | `test(transcription): cover live jobs and exports` | Matching inline tests, transcription_actions.rs, live_recording.rs and harness registrations; keep shared file/live fake-worker helpers together. |
| 21 | `feat(ui): expose offline recording workflows` | Non-test src/ui.rs and final src/main.rs/src/lib.rs wiring; native screens, source/model choices, audio/text outcomes and close/export actions. |
| 22 | `test(ui): cover close and finalization races` | src/ui.rs test module and the test-only Session::test_session helper in audio/mod.rs; actual UI-state orchestration regressions. |
| 23 | `build(speckit): add the local workflow runtime` | .specify/ configuration, integration manifests, scripts, workflow registry and .constitution-template.json; excludes the already committed constitution and command templates. |
| 24 | `build(speckit): install planning commands` | Constitution/specify/clarify/plan/checklist skills and their constitution/spec/plan/checklist templates; requirement and design workflows. |
| 25 | `build(speckit): install delivery commands` | Tasks/analyze/converge/implement/taskstoissues skills and tasks template; implementation and consistency workflows. |
| 26 | `build(package): assemble the offline preview` | Production scripts/package.ps1 logic; verified executable/VAD/license copies, import inspection and non-overwriting distribution assembly. |
| 27 | `test(package): cover asset and destination guards` | Test-only -SelfCheck parameter/block in scripts/package.ps1; missing/corrupt assets and path/overwrite assertions, separate from packaging implementation. |
| 28 | `chore(git): exclude generated and private output` | .gitignore; generated binaries/models, recordings, packages, caches and local environment data. |

## Shared-file staging

- Rust `#[cfg(test)]` modules belong to the matching test rows, not production
  rows. The separate test-only Session helper belongs to row 22.
- `tests/integration.rs` starts as the harness in row 7. Each `mod` declaration is
  staged together with its test file in the corresponding later test commit.
- `src/lib.rs`, `src/main.rs` and transcription submodule declarations are staged
  incrementally so they reference only production files already introduced.
- Cargo bootstrap entry scaffolding is temporary index content, not a working-tree
  rewrite or an extra feature. The last production wiring must reproduce the
  staged final files exactly.
- PowerShell self-check assertions and their switch are separated from the
  packaging implementation. Native packaging helpers stay in row 26.
- Approval authorizes these separate commits only; it does not authorize a push,
  branch operation, tag or release entry. The final tree must match the reviewed
  staged snapshot. Intermediate dependency checks and final checks are recorded
  when the approved sequence is executed.
