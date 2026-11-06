[CmdletBinding()]
param(
    [string]$PackageDirectory,
    [ValidateSet('skipped-build', 'dirty-build', 'fresh-clean-build')][string]$ExpectedSourceVerification
)

$ErrorActionPreference = 'Stop'
$taskPackageScript = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'package.ps1'
. $taskPackageScript

function Assert-PackageTest([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Assert-PackageRejects([scriptblock]$Action, [string]$Message) {
    $taskRejected = $false
    try { & $Action | Out-Null } catch { $taskRejected = $true }
    Assert-PackageTest $taskRejected $Message
}

if ($PackageDirectory) {
    $taskPackage = [IO.Path]::GetFullPath($PackageDirectory)
    $taskAllowed = [IO.Path]::GetFullPath((Join-Path $taskRoot 'dist')) + [IO.Path]::DirectorySeparatorChar
    Assert-PackageTest ($taskPackage.StartsWith($taskAllowed, [StringComparison]::OrdinalIgnoreCase)) 'Package acceptance must stay in this checkout dist.'
    $taskInfo = Get-Content -LiteralPath (Join-Path $taskPackage 'package-info.json') -Raw | ConvertFrom-Json
    $taskManifest = Get-Content -LiteralPath (Join-Path $taskRoot 'Cargo.toml') -Raw
    $taskExpectedVersion = [regex]::Match($taskManifest, '(?m)^version\s*=\s*"([^"]+)"').Groups[1].Value
    Assert-PackageTest ($taskInfo.product_version -ceq $taskExpectedVersion) 'Package metadata must bind the actual Cargo-built product version.'
    $taskActualHead = (& git -C $taskRoot rev-parse --verify HEAD).Trim()
    Assert-PackageTest ($LASTEXITCODE -eq 0 -and $taskInfo.source_sha -ceq $taskActualHead) 'Package source SHA must be the actual checked-out commit.'
    $taskActualTree = (& git -C $taskRoot rev-parse --verify 'HEAD^{tree}').Trim()
    Assert-PackageTest ($LASTEXITCODE -eq 0 -and $taskInfo.source_tree_sha -ceq $taskActualTree) 'Package tree must be the actual checked-out tree.'
    Assert-PackageTest ($taskInfo.source_dirty -is [bool]) 'Package dirty identity must be explicit.'
    Assert-PackageTest ($taskInfo.source_verification -is [string] -and $taskInfo.source_verification -cin @('skipped-build', 'dirty-build', 'fresh-clean-build')) 'Package must state whether the source context was verified by a build.'
    if ($ExpectedSourceVerification) { Assert-PackageTest ($taskInfo.source_verification -ceq $ExpectedSourceVerification) 'Package build/source verification does not match the requested acceptance case.' }
    if ($taskInfo.source_verification -ceq 'fresh-clean-build') { Assert-PackageTest (-not $taskInfo.source_dirty) 'A dirty source cannot claim a fresh clean build.' }
    if ($taskInfo.source_verification -ceq 'dirty-build') { Assert-PackageTest $taskInfo.source_dirty 'A dirty-build claim must retain the dirty flag.' }
    Assert-PackageTest ($taskInfo.clean_disconnected_machine_validation -ceq 'pending') 'Native device validation must not be invented.'
    Assert-PackageTest (@($taskInfo.inventory_excludes).Count -eq 1 -and $taskInfo.inventory_excludes[0] -ceq 'package-info.json') 'Only package-info.json has an inventory self-reference exclusion.'
    $taskActualInventory = @(Get-PackageFileInventory $taskPackage)
    Assert-PackageTest ($taskActualInventory.Count -gt 5 -and @($taskInfo.files).Count -eq $taskActualInventory.Count) 'Package inventory must cover every distributed file.'
    foreach ($taskExpected in $taskActualInventory) {
        $taskRecorded = @($taskInfo.files | Where-Object { $_.path -ceq $taskExpected.path })
        Assert-PackageTest ($taskRecorded.Count -eq 1 -and $taskRecorded[0].sha256 -ceq $taskExpected.sha256 -and $taskRecorded[0].bytes -eq $taskExpected.bytes) ('Package inventory mismatch: ' + $taskExpected.path)
    }
    Assert-PackageTest (-not (Test-Path -LiteralPath (Join-Path $taskPackage 'PACKAGE-INCOMPLETE.txt'))) 'Completed package must not retain the incomplete marker.'
    Assert-PackageTest ($taskInfo.executable_sha256 -ceq (Get-FileSha256 (Join-Path $taskPackage 'rustcorder.exe'))) 'Executable snapshot hash must match metadata.'
    $taskCallerSettings = $env:LOCALAPPDATA
    $taskWrongVersion = if ($taskExpectedVersion -ceq '0.0.0') { '0.0.1' } else { '0.0.0' }
    Assert-PackageRejects { Get-PackageExecutableIdentity (Join-Path $taskPackage 'rustcorder.exe') $taskWrongVersion } 'A real binary reporting another version must not certify the package.'
    Assert-PackageRejects { Get-PackageExecutableIdentity (Join-Path $taskPackage 'missing.exe') $taskExpectedVersion } 'A missing built executable must not certify the package.'
    Assert-PackageTest ($env:LOCALAPPDATA -ceq $taskCallerSettings) 'Package probes must not mutate caller settings environment.'
}

foreach ($taskInvalid in @('', '..', '../escape', 'nested/name', 'C:\outside', 'bad name', 'CON', 'NUL', 'name.with.dots')) {
    Assert-PackageRejects { Resolve-PackageDestination $taskInvalid } ('Unsafe package name accepted: ' + $taskInvalid)
}

$taskProbeRoot = Join-Path $taskRoot ('.build\package-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($taskProbeRoot) | Out-Null
$taskDistProbe = Join-Path $taskDist ('package-test-existing-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($taskDistProbe) | Out-Null
try {
    Assert-PackageRejects { Resolve-PackageDestination (Split-Path -Leaf $taskDistProbe) } 'An existing package destination must never be overwritten.'
    $taskAsset = Join-Path $taskProbeRoot 'asset.bin'
    [IO.File]::WriteAllBytes($taskAsset, [byte[]](97, 98, 99))
    $taskAssetHash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    Assert-PackageTest ((Resolve-VerifiedVadAsset $taskAsset $taskAssetHash) -ceq $taskAsset) 'A valid immutable asset must be accepted.'
    Assert-PackageRejects { Resolve-VerifiedVadAsset $taskAsset ('0' * 64) } 'Corrupt VAD/license content must be refused.'
    Assert-PackageRejects { Resolve-VerifiedVadAsset (Join-Path $taskProbeRoot 'missing.bin') $taskAssetHash } 'Missing VAD/license content must be refused.'
    Assert-PackageRejects { Resolve-VerifiedVadAsset $taskAsset 'not-a-sha256' } 'Malformed expected hash must be refused.'

    $taskGoodProbe = @{ timed_out = $false; exit_code = 0; stdout = 'rustcorder 0.1.0'; stderr = '' }
    Assert-PackageVersionProbe $taskGoodProbe '0.1.0'
    foreach ($taskProbe in @(
        @{ timed_out = $true; exit_code = 0; stdout = 'rustcorder 0.1.0'; stderr = '' },
        @{ timed_out = $false; exit_code = 1; stdout = 'rustcorder 0.1.0'; stderr = '' },
        @{ timed_out = $false; exit_code = 0; stdout = 'rustcorder 9.9.9'; stderr = '' },
        @{ timed_out = $false; exit_code = 0; stdout = ''; stderr = '' },
        @{ timed_out = $false; exit_code = 0; stdout = 'rustcorder 0.1.0'; stderr = 'unexpected startup' },
        @{ timed_out = $false; exit_code = $false; stdout = 'rustcorder 0.1.0'; stderr = '' },
        @{ timed_out = $false; exit_code = 0; stdout = @('rustcorder 0.1.0'); stderr = '' }
    )) {
        Assert-PackageRejects { Assert-PackageVersionProbe $taskProbe '0.1.0' } 'Incomplete or mismatched binary version evidence must be refused.'
    }
    Assert-PackageRejects { Assert-PackageVersionProbe $taskGoodProbe '0.1.0-preview.1' } 'Product package version must be stable SemVer.'
    $taskCleanSource = @{ sha = ('a' * 40); tree_sha = ('b' * 40); dirty = $false }
    $taskDirtySource = @{ sha = ('a' * 40); tree_sha = ('b' * 40); dirty = $true }
    Assert-PackageTest ((Get-PackageSourceVerification $taskCleanSource $taskCleanSource $true $false) -ceq 'skipped-build') 'Skipped builds must remain unverified even with clean source.'
    Assert-PackageTest ((Get-PackageSourceVerification $taskDirtySource $taskDirtySource $true $false) -ceq 'skipped-build') 'Skipped dirty builds must remain explicitly skipped.'
    Assert-PackageTest ((Get-PackageSourceVerification $taskDirtySource $taskDirtySource $false $true) -ceq 'dirty-build') 'A successful dirty build must remain unverified for publication.'
    Assert-PackageTest ((Get-PackageSourceVerification $taskCleanSource $taskCleanSource $false $true) -ceq 'fresh-clean-build') 'Only a successful build with unchanged clean source may be verified.'
    Assert-PackageRejects { Get-PackageSourceVerification $taskCleanSource $taskDirtySource $false $true } 'A dirty-state transition during assembly must be refused.'
    Assert-PackageRejects { Get-PackageSourceVerification $taskCleanSource @{ sha = ('c' * 40); tree_sha = ('b' * 40); dirty = $false } $false $true } 'A source commit transition during assembly must be refused.'
    Assert-PackageRejects { Get-PackageSourceVerification $taskCleanSource @{ sha = ('a' * 40); tree_sha = ('c' * 40); dirty = $false } $false $true } 'A source tree transition during assembly must be refused.'
    Assert-PackageRejects { Get-PackageSourceVerification $taskCleanSource $taskCleanSource $false $false } 'An unexecuted build must not claim verified source.'
    Assert-PackageRejects { Get-PackageSourceVerification $taskCleanSource $taskCleanSource $true $true } 'Contradictory skipped/executed build evidence must be refused.'
    $taskInventory = @(Get-PackageFileInventory $taskProbeRoot)
    Assert-PackageTest ($taskInventory.Count -eq 1 -and $taskInventory[0].path -ceq 'asset.bin' -and $taskInventory[0].sha256 -ceq $taskAssetHash -and $taskInventory[0].bytes -eq 3) 'File inventory must bind normalized relative path, bytes and SHA-256.'
    [IO.File]::WriteAllText((Join-Path $taskProbeRoot 'package-info.json'), '{}')
    Assert-PackageTest (@(Get-PackageFileInventory $taskProbeRoot).Count -eq 1) 'Package metadata must not hash itself.'
    [IO.File]::WriteAllText((Join-Path $taskProbeRoot 'PACKAGE-INCOMPLETE.txt'), 'incomplete')
    Assert-PackageRejects { Get-PackageFileInventory $taskProbeRoot } 'An incomplete package cannot produce a completed distribution inventory.'
    Remove-Item -LiteralPath (Join-Path $taskProbeRoot 'PACKAGE-INCOMPLETE.txt')
    Assert-PackageRejects { Get-PackageFileInventory ([IO.Path]::GetPathRoot($taskRoot)) } 'Inventory may not inspect paths outside this checkout.'
} finally {
    foreach ($taskOwnedPath in @($taskProbeRoot, $taskDistProbe)) {
        $taskFull = [IO.Path]::GetFullPath($taskOwnedPath)
        $taskBoundary = if ($taskOwnedPath -eq $taskProbeRoot) { [IO.Path]::GetFullPath((Join-Path $taskRoot '.build')) } else { [IO.Path]::GetFullPath($taskDist) }
        if (-not $taskFull.StartsWith($taskBoundary + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or ((Get-Item -LiteralPath $taskFull).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Refusing cleanup outside the owned package fixture directory.' }
        Remove-Item -LiteralPath $taskFull -Recurse -Force
    }
}
Write-Output 'Package boundary checks passed: identity, assets, paths, overwrite, version probe and inventory.'
