param(
    [ValidateSet('Debug', 'Release')][string]$Profile = 'Release',
    [switch]$SkipBuild,
    [string]$Name = ('rustcorder-win-x64-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff')),
    [switch]$SelfCheck
)

$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskTarget = 'x86_64-pc-windows-msvc'
$taskDist = Join-Path $taskRoot 'dist'
$taskPowerShell = Join-Path $PSHOME 'powershell.exe'
if (-not (Test-Path -LiteralPath $taskPowerShell)) { $taskPowerShell = Join-Path $PSHOME 'pwsh.exe' }
$taskVadFileName = 'ggml-silero-v6.2.0.bin'
$taskVadSha256 = '2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987'
$taskVadLicenseSha256 = '2e63e9a38b6e8fc0c7bc37ce174caca1862870856c6daf5697cfb785e925520b'
$taskVadRevision = '9ffd54a1e1ee413ddf265af9913beaf518d1639b'

function Resolve-PackageDestination([string]$PackageName) {
    if ($PackageName -notmatch '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$' -or $PackageName -match '^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$') {
        throw 'Package name must be a nonreserved name containing only letters, digits, hyphens or underscores.'
    }
    if (Test-Path -LiteralPath $taskDist) {
        $existing = Get-Item -LiteralPath $taskDist -Force
        if (-not $existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'dist must be a real directory inside this checkout, not a file or redirected directory.'
        }
    }
    $destination = [IO.Path]::GetFullPath((Join-Path $taskDist $PackageName))
    if (-not $destination.StartsWith($taskDist + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Package destination must remain under the checkout dist directory.'
    }
    if (Test-Path -LiteralPath $destination) { throw 'Package destination already exists; refusing to overwrite it.' }
    return $destination
}

function Get-FileSha256([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try {
        return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $stream.Dispose()
        $algorithm.Dispose()
    }
}

function Resolve-VerifiedVadAsset([string]$AssetPath, [string]$ExpectedSha256) {
    if (-not (Test-Path -LiteralPath $AssetPath -PathType Leaf)) {
        throw "Required offline VAD asset is missing: $AssetPath"
    }
    $resolved = (Get-Item -LiteralPath $AssetPath).FullName
    $actual = Get-FileSha256 $resolved
    if ($ExpectedSha256 -notmatch '^[a-fA-F0-9]{64}$' -or $actual -ne $ExpectedSha256.ToLowerInvariant()) {
        throw "Offline VAD asset SHA-256 verification failed: $resolved"
    }
    return $resolved
}

if ($MyInvocation.InvocationName -eq '.') { return }

if ($SelfCheck) {
    $valid = Resolve-PackageDestination ('self-check-valid-' + [Guid]::NewGuid().ToString('N'))
    if (-not $valid.StartsWith($taskDist + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Self-check failed: destination escaped dist.'
    }
    foreach ($invalid in @('', '..', '../escape', 'nested/name', 'C:\outside', 'bad name')) {
        $rejected = $false
        try { Resolve-PackageDestination $invalid | Out-Null } catch { $rejected = $true }
        if (-not $rejected) { throw "Self-check failed: unsafe name '$invalid' was accepted." }
    }
    New-Item -ItemType Directory -Path $taskDist -Force | Out-Null
    $probe = Join-Path $taskDist ('self-check-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $probe | Out-Null
    try {
        $rejected = $false
        try { Resolve-PackageDestination (Split-Path -Leaf $probe) | Out-Null } catch { $rejected = $true }
        if (-not $rejected) { throw 'Self-check failed: existing destination was accepted.' }
        $vadProbe = Join-Path $probe 'test-vad.bin'
        [IO.File]::WriteAllBytes($vadProbe, [byte[]](0x61, 0x62, 0x63))
        $vadProbeHash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
        $failures = @()
        foreach ($bad in @(
            @{ Path = (Join-Path $probe 'missing-vad.bin'); Hash = $vadProbeHash },
            @{ Path = $vadProbe; Hash = ('0' * 64) }
        )) {
            $rejected = $false
            try { Resolve-VerifiedVadAsset $bad.Path $bad.Hash | Out-Null } catch { $rejected = $true }
            if (-not $rejected) { $failures += $bad.Path }
        }
        if ((Resolve-VerifiedVadAsset $vadProbe $vadProbeHash) -ne $vadProbe) {
            throw 'Self-check failed: a valid VAD asset was rejected.'
        }
        if ($failures.Count) { throw ('Self-check failed: missing/corrupt VAD assets were accepted: ' + ($failures -join ', ')) }
    } finally {
        if (-not ([IO.Path]::GetFullPath($probe)).StartsWith($taskDist + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing cleanup outside the package test directory.'
        }
        Remove-Item -LiteralPath (Join-Path $probe 'test-vad.bin') -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $probe
    }
    Write-Output 'Package self-check passed: path/overwrite guards and valid/missing/corrupt VAD asset checks.'
    exit 0
}

$taskDestination = Resolve-PackageDestination $Name
$taskVadSource = Resolve-VerifiedVadAsset (Join-Path $taskRoot ('models\' + $taskVadFileName)) $taskVadSha256
$taskVadLicense = Resolve-VerifiedVadAsset (Join-Path $taskRoot 'assets\LICENSE.silero-vad.txt') $taskVadLicenseSha256
$taskVadMetadataPath = Join-Path $taskRoot 'assets\silero-vad.json'
$taskVadMetadata = Get-Content -LiteralPath $taskVadMetadataPath -Raw | ConvertFrom-Json
if ($taskVadMetadata.filename -ne $taskVadFileName -or $taskVadMetadata.sha256 -ne $taskVadSha256 -or
    $taskVadMetadata.bytes -ne 885098 -or $taskVadMetadata.revision -ne $taskVadRevision -or
    $taskVadMetadata.repository -ne 'ggml-org/whisper-vad' -or $taskVadMetadata.license -ne 'MIT' -or
    $taskVadMetadata.license_file -ne 'assets/LICENSE.silero-vad.txt' -or
    $taskVadMetadata.license_sha256 -ne $taskVadLicenseSha256 -or
    $taskVadMetadata.url -ne ('https://huggingface.co/ggml-org/whisper-vad/resolve/' + $taskVadRevision + '/' + $taskVadFileName)) {
    throw 'VAD provenance metadata does not match the pinned offline asset and license.'
}
$taskVadMetadataSha256 = Get-FileSha256 $taskVadMetadataPath
if (-not $SkipBuild) {
    $taskBuildArgs = @('build', '--locked', '--offline', '--target', $taskTarget)
    if ($Profile -eq 'Release') { $taskBuildArgs += '--release' }
    & $taskPowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev.ps1') @taskBuildArgs
    if ($LASTEXITCODE -ne 0) { throw 'Static Windows package build failed.' }
}
$taskExecutable = Join-Path $taskRoot ('target\' + $taskTarget + '\' + $Profile.ToLowerInvariant() + '\rustcorder.exe')
if (-not (Test-Path -LiteralPath $taskExecutable -PathType Leaf)) { throw "Built executable is missing: $taskExecutable" }
New-Item -ItemType Directory -Path $taskDist -Force | Out-Null
New-Item -ItemType Directory -Path $taskDestination | Out-Null
'Package assembly is incomplete. Do not distribute this folder.' | Set-Content -LiteralPath (Join-Path $taskDestination 'PACKAGE-INCOMPLETE.txt') -Encoding UTF8
Copy-Item -LiteralPath $taskExecutable -Destination (Join-Path $taskDestination 'rustcorder.exe')
Copy-Item -LiteralPath $taskVadSource -Destination (Join-Path $taskDestination $taskVadFileName)
Copy-Item -LiteralPath $taskVadMetadataPath -Destination (Join-Path $taskDestination 'silero-vad.json')
Resolve-VerifiedVadAsset (Join-Path $taskDestination $taskVadFileName) $taskVadSha256 | Out-Null
Resolve-VerifiedVadAsset (Join-Path $taskDestination 'silero-vad.json') $taskVadMetadataSha256 | Out-Null
# Inspect/hash the immutable package snapshot, not a binary Cargo could relink.
$taskExecutable = Join-Path $taskDestination 'rustcorder.exe'

$taskVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$taskVsRoot = & $taskVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $taskVsRoot) { throw 'Visual Studio dumpbin is required to inspect portable package imports.' }
$taskToolchains = Get-ChildItem -LiteralPath (Join-Path $taskVsRoot 'VC\Tools\MSVC') -Directory | Sort-Object { [Version]$_.Name } -Descending
$taskDumpbin = $taskToolchains | ForEach-Object { Join-Path $_.FullName 'bin\Hostx64\x64\dumpbin.exe' } | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $taskDumpbin) { throw 'dumpbin.exe was not found.' }
$taskImportsText = (& $taskDumpbin /nologo /dependents $taskExecutable 2>&1 | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect executable imports.' }
$taskImports = @([regex]::Matches($taskImportsText, '(?im)^\s*([a-z0-9_.-]+\.dll)\s*$') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique)
if ($taskImports.Count -eq 0) { throw 'No DLL imports were parsed; refusing an unverified package.' }
$taskForbidden = @($taskImports | Where-Object { $_ -match '^(?:vcruntime\d+.*|msvcp\d+.*|concrt\d+.*|vcomp\d+.*|ucrtbase|api-ms-win-crt-.*|whisper|ggml.*|libclang|python.*)\.dll$' })
if ($taskForbidden.Count) { throw ('Portable package still imports nonportable native runtimes: ' + ($taskForbidden -join ', ')) }
foreach ($taskImport in $taskImports) {
    # Windows API-set names are loader contracts, not necessarily physical DLLs.
    if ($taskImport -match '^(?:api|ext)-ms-win-[a-z0-9-]+\.dll$') { continue }
    if (-not (Test-Path -LiteralPath (Join-Path $env:WINDIR ('System32\' + $taskImport)))) {
        throw "Unaccounted native import: $taskImport"
    }
}

$taskMetadataText = (& $taskPowerShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev.ps1') metadata --locked --offline --format-version 1 --filter-platform $taskTarget | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Could not collect locked dependency/license metadata.' }
$taskMetadata = $taskMetadataText | ConvertFrom-Json
$taskNative = $taskMetadata.packages | Where-Object { $_.name -eq 'whisper-rs-sys' } | Select-Object -First 1
$taskNativeLicense = Join-Path (Split-Path -Parent $taskNative.manifest_path) 'whisper.cpp\LICENSE'
if (-not (Test-Path -LiteralPath $taskNativeLicense -PathType Leaf)) { throw 'The native whisper.cpp MIT license is missing.' }

$taskLicenseRoot = Join-Path $taskDestination 'licenses'
New-Item -ItemType Directory -Path $taskLicenseRoot | Out-Null
Copy-Item -LiteralPath $taskNativeLicense -Destination (Join-Path $taskLicenseRoot 'whisper.cpp-MIT-LICENSE.txt')
Copy-Item -LiteralPath $taskVadLicense -Destination (Join-Path $taskLicenseRoot 'silero-vad-MIT-LICENSE.txt')
Resolve-VerifiedVadAsset (Join-Path $taskLicenseRoot 'silero-vad-MIT-LICENSE.txt') $taskVadLicenseSha256 | Out-Null
$taskNotice = @(
    '# Third-party dependency notices', '',
    'Generated from the locked Windows dependency graph, including build/test dependencies.',
    'License texts available in crate source are copied under licenses/. ASR model weights are not bundled.',
    ('Silero VAD v6.2.0 (MIT) is bundled as ' + $taskVadFileName + '; license: licenses/silero-vad-MIT-LICENSE.txt.'),
    ('Pinned VAD source: ' + $taskVadMetadata.url + '; SHA-256: ' + $taskVadSha256 + '.'),
    'The project does not yet declare a rustcorder distribution license; this is a local validation package.', '',
    '| Package | Declared license | Repository |', '| --- | --- | --- |'
)
foreach ($taskPackage in ($taskMetadata.packages | Where-Object { $_.source } | Sort-Object name, version)) {
    $taskLicense = if ($taskPackage.license) { $taskPackage.license } else { 'Not declared; review required' }
    $taskNotice += '| ' + $taskPackage.name + ' ' + $taskPackage.version + ' | ' + $taskLicense + ' | ' + $taskPackage.repository + ' |'
    $taskSourceRoot = Split-Path -Parent $taskPackage.manifest_path
    $taskLicenseFiles = @(Get-ChildItem -LiteralPath $taskSourceRoot -Recurse -File | Where-Object { $_.Name -match '^(?:LICEN[CS]E|COPYING|NOTICE)(?:[-_.].*)?$|[-_]licen[cs]e.*\.txt$' })
    foreach ($taskLicenseFile in $taskLicenseFiles) {
        $taskRelative = $taskLicenseFile.FullName.Substring($taskSourceRoot.Length).TrimStart('\', '/')
        $taskLicenseCopy = Join-Path (Join-Path $taskLicenseRoot ($taskPackage.name + '-' + $taskPackage.version)) $taskRelative
        New-Item -ItemType Directory -Path (Split-Path -Parent $taskLicenseCopy) -Force | Out-Null
        Copy-Item -LiteralPath $taskLicenseFile.FullName -Destination $taskLicenseCopy
    }
}
$taskNotice | Set-Content -LiteralPath (Join-Path $taskDestination 'THIRD-PARTY-NOTICES.md') -Encoding UTF8
$taskImportsText | Set-Content -LiteralPath (Join-Path $taskDestination 'native-imports.txt') -Encoding UTF8
$taskExecutableHash = Get-FileSha256 $taskExecutable
@{
    target = $taskTarget; profile = $Profile; built_at_utc = [DateTime]::UtcNow.ToString('o')
    executable_sha256 = $taskExecutableHash
    static_crt = $true; direct_imports = $taskImports; asr_models_bundled = $false
    vad_model_bundled = $true; vad_filename = $taskVadFileName; vad_sha256 = $taskVadSha256
    vad_bytes = 885098; vad_source_revision = $taskVadRevision
    vad_license_sha256 = $taskVadLicenseSha256; vad_metadata_sha256 = $taskVadMetadataSha256
    clean_disconnected_machine_validation = 'pending'
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskDestination 'package-info.json') -Encoding UTF8
@'
Run rustcorder.exe. Choose your local save folder and compatible model folder.
ASR weights are separate. A local multilingual GGML base/small model supports Portuguese and English.
The verified Silero VAD speech-activity model is bundled beside the executable; keep it there.
Recording without transcription works without a model. No first-run model/runtime download is used.
This local validation package still requires a clean disconnected Windows acceptance test.
'@ | Set-Content -LiteralPath (Join-Path $taskDestination 'START-HERE.txt') -Encoding UTF8
Remove-Item -LiteralPath (Join-Path $taskDestination 'PACKAGE-INCOMPLETE.txt')
Write-Output "Portable package created: $taskDestination"
