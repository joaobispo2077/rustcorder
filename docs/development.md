# Windows development

The native Windows implementation and default automated checks are present.
Real-device, full transcription and disconnected-package acceptance remain open;
see [validation evidence](implementation-validation.md) and the
[implementation checklist](../specs/001-record-transcribe/tasks.md).

## Prerequisites

- Windows x64; the initial product validation target is Windows 11 x64.
- Rust `1.95.0-x86_64-pc-windows-msvc`, rustfmt and Clippy, as pinned in
  [rust-toolchain.toml](../rust-toolchain.toml).
- Visual Studio 2022 C++ Build Tools and a Windows SDK. Verified here: Build Tools
  17.5.4, MSVC 14.35.32215 and SDK 10.0.22000.0.
- CMake and an accessible Windows `libclang.dll` for generating correct bindings.
  Visual Studio's bundled CMake is used by the runner when available.

The initially installed Chocolatey Rust uses the GNU target. That installation was
not changed. This checkout instead has ignored development tools under `.build/`:
MSVC rustup/Cargo caches, and libclang 18.1.1 under `.build/python-deps/clang/native`.
The Python package supplies a development DLL; Python is not a product requirement.

On another development machine, standard global rustup/MSVC and LLVM/libclang also
work. Install the pinned Rust toolchain, put CMake on PATH if it is not bundled with
Visual Studio, and set `LIBCLANG_PATH` to the folder containing `libclang.dll`.
The runner preserves that setting unless the checkout's local libclang is present.
Obtaining developer dependencies may need network access; the app's runtime must not.

## Build runner

From this repository root, use the runner so MSVC environment variables, local
toolchain selection and binding generation match the successful dependency build:

```powershell
rtk proxy powershell -NoProfile -File scripts/dev.ps1 build --locked --offline
rtk proxy powershell -NoProfile -File scripts/dev.ps1 test --locked --offline
rtk proxy powershell -NoProfile -File scripts/dev.ps1 fmt --check
rtk proxy powershell -NoProfile -File scripts/dev.ps1 clippy --locked --offline --all-targets -- -D warnings
```

`--offline` requires the toolchain and locked dependency cache to exist already.
Initial cache preparation can use `fetch --locked` through the same runner when
network access is authorized. A missing dependency is a setup failure, not a passing
offline-runtime test. The runner returns Cargo's exit code and forwards arguments.

The runner discovers Visual Studio through `vswhere`, initializes its x64 developer
environment, exposes bundled CMake, and selects `.build/cargo`/`.build/rustup` when
present. It sets `GGML_NATIVE=OFF` and disables persistent MSBuild node reuse.
Do not set `WHISPER_DONT_GENERATE_BINDINGS`: the published bundled bindings caused
a Windows layout failure (`E0080`). This build generates platform-correct bindings
using libclang instead. A successful build is not an audio/model benchmark.

## Local model folder

The user owns the external model directory; the app must never modify its weights.
The ASR compatibility contract accepts these files directly inside that folder:

```text
ggml-base.bin
ggml-small.bin
ggml-base.en.bin
ggml-small.en.bin
```

Base/small multilingual models support Portuguese and English; `.en` variants are
English-only. Portuguese uses `pt` and is the default. The actual native metadata
and successful load must establish compatibility, rather than a filename alone.
One valid multilingual model is sufficient; all four files are not required.

Use compatible assets linked from the [official whisper.cpp model guide](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md).
Users obtain them separately and can copy them by removable storage. CTranslate2
faster-whisper `model.bin`, WhisperX/Python package folders, GGUF and arbitrary AI
model layouts are not interchangeable with these GGML files. Existing user assets
must remain untouched. Model acquisition is outside the application's runtime;
there is no automatic model downloader or cloud fallback.

## Local speech detector

Transcription also requires the CPU Silero VAD v6.2.0 speech-activity model,
`ggml-silero-v6.2.0.bin` (885,098 bytes), separately from the selected ASR weights.
The real speech-free gate found invented text for noise and a tone with the earlier
digital-zero-only gate. The detector is an explicit local dependency introduced
for that failure; it does not establish universal hallucination prevention.
The updated Release worker passes the declared eight-second exact-zero, seeded
quiet-noise, moderate-noise and 440 Hz tone controls with empty NoSpeech results;
quiet Portuguese speech at 1% gain still produces text. This is evidence for those
controls, not universal speech/noise recognition or completed live acceptance.

The portable package bundles this small detector beside `rustcorder.exe`. For
development, obtain the exact asset specified in
[the pinned provenance](../assets/silero-vad.json) separately, then place it under
`models/ggml-silero-v6.2.0.bin` beside the development ASR model. Its SHA-256 is
`2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987`.
The source revision is `9ffd54a1e1ee413ddf265af9913beaf518d1639b`; the
[Silero MIT license](../assets/LICENSE.silero-vad.txt) is retained and copied into
the package. Large model files remain ignored by Git.

The worker first looks beside the executable; only when that path is absent does
it try beside the selected ASR model. An existing corrupt, unreadable or non-file
detector path fails rather than silently selecting the fallback. Model validation
and loading require a usable detector and show an actionable local-asset error if
it is missing. Restore the asset locally; no runtime download, installer, service
or network request is used. Plain recording without transcription still needs no
ASR or VAD model.

## Testing and packaging boundaries

Use small synthetic inputs for ordinary tests. Device/model tests require explicitly
available compatible weights and reference recordings with known text; do not treat
missing assets, skipped tests or zero tests as product validation. Keep large weights
and private recordings outside Git. Capture failing behavior tests before fixes.

At the current checkpoint, native dependencies build and CPU-only base/small
Portuguese/English corpus runs pass their preliminary feasibility gates. Those
results do not establish full live-transcription or actual microphone/call-device
acceptance. They predate the new speech detector and are not proof of its accuracy.
A real speech-free gate initially failed on noise/tone. After the explicit offline
VAD change, all four declared silence/noise/tone controls return NoSpeech and
attenuated real Portuguese speech still returns text. That small probe does not
establish quiet-speech accuracy. A clean disconnected distribution has not passed
acceptance. Record corpus/live checks separately.
Follow the [validation guide](../specs/001-record-transcribe/quickstart.md) and retain
hardware/model/build details and unexecuted checks in the validation evidence.

## Static Windows runtime and portable package

[.cargo/config.toml](../.cargo/config.toml) selects
`x86_64-pc-windows-msvc` explicitly and enables Rust `+crt-static`. The runner also
sets `CMAKE_POLICY_DEFAULT_CMP0091=NEW` and
`CMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded` so the bundled native whisper.cpp build
uses the static MSVC runtime too. Changing Rust alone would not prove native C++
objects use the same runtime. The locked `cc` crate observes `crt-static`; `cmake`
uses its compiler flags, and whisper-rs-sys forwards the `CMAKE_` definitions.

Artifacts now appear under `target/x86_64-pc-windows-msvc/debug/` or `release/`.
Do not accidentally inspect or distribute a stale `target/debug/rustcorder.exe`
from the earlier implicit-target build.

Build/package through the local runner:

```powershell
rtk proxy powershell -NoProfile -File scripts/package.ps1 -SelfCheck
rtk proxy powershell -NoProfile -File scripts/package.ps1 -Profile Release -Name rustcorder-windows-preview-vad
```

The package script defaults to `--locked --offline` Release and creates a new
`dist/rustcorder-win-x64-<UTC-timestamp>/` folder. `-Profile Debug -SkipBuild` can
inspect/package an existing explicit-target debug build for local validation;
`-SkipBuild` never bypasses asset/hash or import inspection. `-Name local-validation` selects a
safe directory name, and an existing destination is always refused. Packaging does
not tag, publish, upload or create a product changelog release entry.

Before building or creating a package directory, the script requires the pinned
VAD asset under `models/`, its matching provenance under `assets/`, and its
hash-verified MIT license. It refuses missing/corrupt files and metadata that
disagrees with the pinned filename, revision, hashes or source. Package copies are
hash-checked again. Acquiring those development files is a separate setup step;
the packaging script performs no download.

The folder contains the executable, bundled VAD detector, `silero-vad.json`, native
whisper.cpp and Silero MIT licenses, locked dependency notices and available
license texts, `START-HERE.txt`, native import evidence and `package-info.json`.
The manifest records executable/VAD/license/provenance SHA-256 hashes and explicitly
distinguishes bundled VAD from unbundled ASR weights. Users choose separate local
ASR weights copied by removable storage; recording without transcription needs
neither model. No WebView, model/runtime downloader or inference server is added.

A Release validation snapshot with the corrected worker was produced at
`dist/rustcorder-windows-preview-vad/`. Its copied executable is 17,884,672 bytes,
SHA-256 `6e0f64e9d6f3e4d8610dea02db57611d8b78e2ad0993eaf7f96fbaa2c382ee36`.
The manifest and executable/VAD/license/provenance copies passed hash checks;
the folder contains 384 available dependency/native license files and 19 direct
Windows/system API-set imports. No ASR weights or incomplete-assembly marker are
present. Earlier `rustcorder-windows-preview` artifacts predate the required VAD.

An actual packaged-child smoke check validates a local ASR model in a separate
folder using the detector beside the executable. Separate missing/corrupt-detector
copies produce actionable not-ready errors; a corrupt adjacent detector does not
silently use a valid detector beside the ASR model. These checks do not establish
GUI operation, clean-host startup or full recording acceptance.

Before marking the package complete, `dumpbin /dependents` must show no direct MSVCP,
VCRUNTIME, UCRT, OpenMP, whisper/ggml DLL, libclang or Python dependency. Remaining
direct imports must be Windows system libraries or OS API-set loader contracts
(which do not necessarily have a physical DLL in System32). This import check proves
the inspected binary does not directly need the VC redistributable DLLs; it is
not a substitute for running on a clean disconnected Windows machine. Windows
system DLLs and an appropriate graphics/audio driver remain OS prerequisites.
The script inspects and hashes its copied executable snapshot so a concurrent
developer rebuild cannot change the inspected artifact. A failed assembly retains
`PACKAGE-INCOMPLETE.txt`; choose a new package name rather than overwriting it.
Windows API-set behavior is documented by
[Microsoft](https://learn.microsoft.com/en-us/windows/win32/apiindex/windows-apisets).

`-SelfCheck` verifies safe-name/path guards and existing-directory overwrite
refusal, plus valid/missing/corrupt VAD hash checks, without building or launching
the app or requiring model weights. Both missing and corrupt asset assertions
were observed failing before validation was implemented, then passed. Native build/import inspection and
package creation are separate checks. T012/T061 clean-machine offline startup is
still pending because no clean VM was available in this session.

End users must not need Rust, CMake, libclang, Python, developer caches, API keys,
an AI server or a first-run download. Retain pending clean-machine validation even
after a development-machine launch/import check succeeds.

## Corrected desktop layout preview

The latest local UI build is
`dist/rustcorder-windows-layout-preview-final/rustcorder.exe`, also available in
the ZIP with the same folder name. It retains the bundled speech detector and
licenses from the validated packaging procedure above. The source changes restore
the agreed fixed sidebar and flexible transcript workspace; the recording and
inference engines are unchanged. Earlier preview paths above describe historical
packaging checkpoints. See [layout correction](ui-layout-correction.md) for actual
rendering checks, native inspection and the proposed commit split.

## Reproducing CI locally

Review the named complexity ceilings and version-scoped dependency allowances
before their recorded expiry. Remove an exception when its code improves or
disappears; new debt needs an explicit owner, reason and review date. Do not
replace a symbol exception with a broad path exclusion or reduce a gate floor.

Run these PowerShell 7 (`pwsh`) examples from the repository root on Windows
x64. They reproduce local checks and retain their raw evidence. The
[ordinary workflow](../.github/workflows/ci.yml) and
[full mutation workflow](../.github/workflows/mutation-full.yml) remain the
declarations of hosted job order and conditions. These instructions are commands
to run, not a claim that every gate or device acceptance has passed.

First install the reviewed Windows tools and locked CI dependencies. Setup may
download the pinned public developer tools; application runtime stays offline.
The dispatcher prefers the checkout's Node 24.22.2 and falls back to
`node.exe` on PATH. Require the same exact version for the dependency command:

```powershell
rtk proxy pwsh -NoProfile -File scripts/ci/setup-windows.ps1 -Install
$ciNode = Join-Path $PWD '.build/ci-tools/node/node-v24.22.2-win-x64/node.exe'
if (-not (Test-Path -LiteralPath $ciNode)) { $ciNode = (Get-Command node.exe -ErrorAction Stop).Source }
$ciVersion = rtk proxy $ciNode --version
if (($ciVersion | Out-String).Trim() -cne 'v24.22.2') { throw 'Use the pinned Node 24.22.2 before continuing.' }
$ciNpm = Join-Path (Split-Path -Parent $ciNode) 'node_modules/npm/bin/npm-cli.js'
rtk proxy $ciNode $ciNpm ci --prefix scripts/ci --omit=peer --ignore-scripts
```

The exact pins and dependency policy live in
[toolchain.json](../scripts/ci/toolchain.json) and
[policy.json](../scripts/ci/policy.json). Keep the source commit and dirty state
stable during a collection. Choose a fresh directory under this checkout's
`.build/` for every attempt; each gate refuses existing output. Reuse that one
directory for different gates in the same collection so context and receipts
stay together.

```powershell
$ciEvidence = [IO.Path]::GetFullPath((Join-Path $PWD ('.build/ci-evidence/local-' + [Guid]::NewGuid().ToString('N'))))
$env:RUSTCORDER_CI_RUN_ID = 'local-' + [Guid]::NewGuid().ToString('N')
rtk proxy $ciNode scripts/ci/gates.mjs policy-run --root $ciEvidence --actionlint .build/ci-tools/actionlint-windows/actionlint.exe
rtk proxy pwsh -NoProfile -File scripts/ci/ci.ps1 -Gate quality -EvidenceDirectory $ciEvidence
rtk proxy pwsh -NoProfile -File scripts/ci/ci.ps1 -Gate mutation-rust -Profile light -EvidenceDirectory $ciEvidence
rtk proxy pwsh -NoProfile -File scripts/ci/ci.ps1 -Gate mutation-ci -Profile light -EvidenceDirectory $ciEvidence
```

The `quality` alias collects 13 gates and retains individual failures while
continuing the collection. Policy, the two mutation engines and native packaging
run separately.

Quality selection: `prerequisites`, `format`, `lint`, `build`, `unit`,
`integration`, `ui`, `coverage`, `complexity`, `deadcode`, `duplication`,
`architecture`, `dependencies`.

To isolate a failure, replace `-Gate quality` with one of those exact names and
use a fresh evidence directory. An unset measurement, missing raw output, failed
child or incomplete population must retain its actual blocking status.

The adopted limits are a 72% coverage floor using exact covered/total line counts
from raw all-target LLVM JSON; complexity 10 by default with 15 legacy exceptions
that retain their named ceilings, owners and expiry dates; and 2% duplication of
the declared Rust source population. The 90% cheap-unit target is a separate
repository testing-mix policy. Coverage includes embedded tests and instrumented
library/UI/integration/binary code. The five external integration scenarios in
[test-populations.json](../scripts/ci/test-populations.json) stay explicitly
ignored until their required models, corpus or devices are available. Preserve
those names and reasons; ordinary executed populations must remain nonzero.

Each mutation engine independently requires 40% light or 50% full, within
20 minutes or 60 minutes respectively. The runner first proves its declared
baseline and reconciles generated mutants with fresh outcomes. Timeouts,
execution errors, absent output and cached results remain incomplete. Full runs
use a separate fresh collection:

```powershell
$fullEvidence = [IO.Path]::GetFullPath((Join-Path $PWD ('.build/ci-evidence/full-' + [Guid]::NewGuid().ToString('N'))))
rtk proxy pwsh -NoProfile -File scripts/ci/ci.ps1 -Gate mutation-rust -Profile full -EvidenceDirectory $fullEvidence
rtk proxy pwsh -NoProfile -File scripts/ci/ci.ps1 -Gate mutation-ci -Profile full -EvidenceDirectory $fullEvidence
```

The `ui` gate runs simulated egui drawing/input checks. The separate native
package gate builds a fresh Release snapshot, checks its executable version and
hash, and requires an actual interactive Windows window: Record, Transcribe
file, then Record navigation and normal close. It retains native accessibility,
bounds and screenshot evidence. Missing desktop/UI Automation capability fails
the gate. It does not start recording or inference.

For that additional local package check, continue the ordinary collection:

```powershell
rtk proxy pwsh -NoProfile -File scripts/ci/ci.ps1 -Gate package -EvidenceDirectory $ciEvidence
```

The gate automatically provisions only the public VAD asset with the immutable
[pinned hashes and provenance](../assets/silero-vad.json); its license and copied
payload are also checked. Separate ASR weights remain user-owned. A safe unique
inner folder, canonical versioned ZIP, `package-manifest.json` and
`SHA256SUMS` retain source/build identity and file hashes. Package and evidence
destinations enforce no-overwrite. A local dirty build keeps that provenance;
hosted release-package certification requires a clean, fresh Release build.
Real-device recording, real-model accuracy and clean disconnected-machine
acceptance remain separate checks in the
[validation evidence](ci-quality-release-validation.md).

Finally generate the available-evidence report, then inspect readiness using the
same ordinary collection:

```powershell
rtk proxy pwsh -NoProfile -File scripts/ci/ci.ps1 -Gate report -EvidenceDirectory $ciEvidence
rtk proxy pwsh -NoProfile -File scripts/ci/ci.ps1 -Gate readiness -EvidenceDirectory $ciEvidence
```

Read `report/report.md`, `report/report.json`, `certification.json`, each gate's
`gate.json`, stdout/stderr logs and retained raw outputs. A successfully written
report can describe missing, failed or incomplete gates; it does not convert them
to success. Local evidence cannot certify hosted readiness, so the local
readiness command remains blocked and records its reasons even when executed
checks pass. A full-mutation-only collection also lacks ordinary quality evidence.

Hosted artifacts retain available evidence for 14 days, including failed runs
when upload can execute. Keep a needed local copy before expiry, and link raw
measurements when reporting a failure. These reproduction commands create local
validation data; publication follows the separate
[versioning guidance](versioning.md).
