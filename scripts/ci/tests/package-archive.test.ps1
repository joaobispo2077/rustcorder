[CmdletBinding()]
param([switch]$ScopeOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'package.ps1')
function Assert-ArchiveTest([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-ArchiveRejects([scriptblock]$Action, [string]$Message) {
    $taskRejected = $false
    try { & $Action | Out-Null } catch { $taskRejected = $true }
    Assert-ArchiveTest $taskRejected $Message
}
function Copy-ArchiveValue($Value) { return $Value | ConvertTo-Json -Depth 20 | ConvertFrom-Json }
$archiveTestScope = [pscustomobject]@{
    version = '0.1.0'; source_sha = ('a' * 40); tree_sha = ('b' * 40); kind = 'local'
    vad = [pscustomobject]@{ filename = 'ggml-silero-v6.2.0.bin'; sha256 = ('c' * 64); bytes = 3
        revision = ('d' * 40); license = 'MIT'; license_sha256 = ('e' * 64) }
    vad_metadata_sha256 = ('f' * 64)
}
Assert-CiArchiveScope $archiveTestScope
foreach ($field in @('source_sha','tree_sha','kind')) {
    $archiveBadScope = Copy-ArchiveValue $archiveTestScope
    $archiveBadScope.PSObject.Properties[$field].Value = @($archiveBadScope.PSObject.Properties[$field].Value)
    Assert-ArchiveRejects { Assert-CiArchiveScope $archiveBadScope } 'Array-coerced scope identity was accepted.'
}
if ($ScopeOnly) { Write-Output 'Archive scope checks passed.'; exit 0 }

$archiveTestRoot = Join-Path $archiveRepoRoot ('.build/package-archive-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($archiveTestRoot) | Out-Null
function Write-ArchiveFixtureJson([string]$Path, $Value) { [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 20), $archiveUtf8) }
function New-ArchiveFixture([switch]$Hosted) {
    $caseRoot = Join-Path $archiveTestRoot ([Guid]::NewGuid().ToString('N'))
    $payload = Join-Path $caseRoot 'payload'; $evidence = Join-Path $caseRoot 'evidence'
    foreach ($directory in @($payload, (Join-Path $payload 'licenses'), $evidence, (Join-Path $evidence 'native'))) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
    [IO.File]::WriteAllBytes((Join-Path $payload 'rustcorder.exe'), [Text.Encoding]::UTF8.GetBytes('synthetic executable bytes'))
    [IO.File]::WriteAllBytes((Join-Path $payload 'ggml-silero-v6.2.0.bin'), [byte[]](97,98,99))
    [IO.File]::WriteAllText((Join-Path $payload 'licenses/silero-vad-MIT-LICENSE.txt'), 'synthetic license', $archiveUtf8)
    foreach ($name in @('THIRD-PARTY-NOTICES.md','START-HERE.txt','native-imports.txt')) { [IO.File]::WriteAllText((Join-Path $payload $name), 'synthetic fixture', $archiveUtf8) }
    $scope = Copy-ArchiveValue $archiveTestScope
    if ($Hosted) { $scope.kind='hosted' }
    $scope.vad.sha256 = Get-FileSha256 (Join-Path $payload $scope.vad.filename)
    $scope.vad.license_sha256 = Get-FileSha256 (Join-Path $payload 'licenses/silero-vad-MIT-LICENSE.txt')
    Write-ArchiveFixtureJson (Join-Path $payload 'silero-vad.json') $scope.vad
    $scope.vad_metadata_sha256 = Get-FileSha256 (Join-Path $payload 'silero-vad.json')
    $info = [ordered]@{
        product_version = $scope.version; source_sha = $scope.source_sha; source_tree_sha = $scope.tree_sha
        source_dirty = (-not $Hosted); source_verification = $(if($Hosted){'fresh-clean-build'}else{'skipped-build'}); profile = $(if($Hosted){'Release'}else{'Debug'}); target = 'x86_64-pc-windows-msvc'
        static_crt = $true; asr_models_bundled = $false; vad_model_bundled = $true; direct_imports = @('KERNEL32.dll')
        executable_sha256 = Get-FileSha256 (Join-Path $payload 'rustcorder.exe')
        vad_filename = $scope.vad.filename; vad_sha256 = $scope.vad.sha256; vad_bytes = 3; vad_source_revision = $scope.vad.revision
        vad_license_sha256 = $scope.vad.license_sha256; vad_metadata_sha256 = $scope.vad_metadata_sha256
        clean_disconnected_machine_validation = 'pending'; inventory_excludes = @('package-info.json')
        files = @(Get-PackageFileInventory $payload)
    }
    Write-ArchiveFixtureJson (Join-Path $payload 'package-info.json') $info
    $window = @{ pid = 123; handle = 456; title = 'Synthetic fixture'; bounds = @{ left = 0; top = 0; width = 1; height = 1 } }
    $controls = @(
        @{ name = 'Record'; role = 'ControlType.Button'; pid = 123; enabled = $true; offscreen = $false; bounds = @{ left = 0; top = 0; width = 0.3; height = 0.3 } },
        @{ name = 'Transcribe file'; role = 'ControlType.Button'; pid = 123; enabled = $true; offscreen = $false; bounds = @{ left = 0.4; top = 0; width = 0.3; height = 0.3 } }
    )
    $native = Join-Path $evidence 'native'
    Write-ArchiveFixtureJson (Join-Path $native 'accessibility-tree.json') @{ window = $window; nodes = $controls }
    [IO.File]::WriteAllBytes((Join-Path $native 'window.png'), [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5S8AAAAASUVORK5CYII='))
    $proof = @{ schema_version = 1; kind = 'native'; status = 'pass'; completed = $true; normal_close_requested = $true
        exit_code = 0; run_nonce = ('1' * 32); pid = 123; executable_sha256 = $info.executable_sha256; version = $scope.version
        window = $window; capabilities = @{ interactive=$true; input_desktop=$true; uia=$true; screenshot=$true; session_id=1 }
        started_at='2026-11-05T12:00:00Z'; completed_at='2026-11-05T12:00:01Z'; platform='Synthetic fixture only'
        navigation=@(@{screen='Record';landmark='Capture mode';pid=123},@{screen='Transcribe file';landmark='No file selected';pid=123},@{screen='Record';landmark='Capture mode';pid=123})
        diagnostics=@(@{path='accessibility-tree.json';sha256=(Get-FileSha256 (Join-Path $native 'accessibility-tree.json'))},@{path='window.png';sha256=(Get-FileSha256 (Join-Path $native 'window.png'))})
    }
    Write-ArchiveFixtureJson (Join-Path $native 'native-smoke.json') $proof
    $manifest = New-CiPackageArchive -PackageDirectory $payload -OutputDirectory $evidence -InnerRoot 'rustcorder-fixture' -Scope $scope
    return @{ root=$caseRoot; payload=$payload; evidence=$evidence; scope=$scope; manifest=$manifest }
}
function Save-ArchiveFixtureManifest($Case) {
    Write-ArchiveFixtureJson (Join-Path $Case.evidence 'package-manifest.json') $Case.manifest
    Write-CiArchiveChecksums $Case.evidence $Case.manifest
}
function Invoke-ArchiveFixtureVerifier($Case, [string]$InputText) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $start.UseShellExecute = $false; $start.CreateNoWindow = $true
    foreach ($argument in @('-NoProfile','-File',(Join-Path $archiveScriptRoot 'package.ps1'),'-VerifyOnly','-EvidenceDirectory',$Case.evidence)) { [void]$start.ArgumentList.Add($argument) }
    $start.RedirectStandardInput=$true; $start.RedirectStandardOutput=$true; $start.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process; $process.StartInfo=$start
    try {
        [void]$process.Start()
        $outputTask=$process.StandardOutput.ReadToEndAsync(); $errorTask=$process.StandardError.ReadToEndAsync()
        $process.StandardInput.Write($InputText); $process.StandardInput.Close()
        if(-not $process.WaitForExit(15000)){ $process.Kill(); throw 'Read-only archive verifier exceeded fixture budget.' }
        return @{code=$process.ExitCode;stdout=$outputTask.GetAwaiter().GetResult();stderr=$errorTask.GetAwaiter().GetResult()}
    } finally { $process.Dispose() }
}
try {
    $case = New-ArchiveFixture
    $result = Test-CiPackageArchive $case.evidence $case.scope
    Assert-ArchiveTest ($result.status -ceq 'pass' -and $result.kind -ceq 'local-package' -and $result.files -gt 5) 'A complete synthetic archive must validate as local data only.'
    $hostedCase=New-ArchiveFixture -Hosted
    Assert-ArchiveTest ((Test-CiPackageArchive $hostedCase.evidence $hostedCase.scope).kind -ceq 'hosted-release-package') 'Synthetic clean Release data failed hosted provenance policy.'
    foreach ($field in @('target','vad_filename','vad_sha256','vad_source_revision','vad_license_sha256','vad_metadata_sha256','executable_sha256','clean_disconnected_machine_validation')) {
        $badInfo=Read-CiArchiveJson (Join-Path $case.payload 'package-info.json')
        $badInfo.PSObject.Properties[$field].Value=@($badInfo.PSObject.Properties[$field].Value)
        Assert-ArchiveRejects { Assert-CiPackageInfo $badInfo $case.scope (Get-CiArchiveFiles $case.manifest.files) } 'Array-coerced package metadata was accepted.'
    }
    $cli=Invoke-ArchiveFixtureVerifier $case ($case.scope | ConvertTo-Json -Depth 12 -Compress)
    Assert-ArchiveTest ($cli.code -eq 0 -and -not $cli.stderr -and ($cli.stdout | ConvertFrom-Json).kind -ceq 'local-package') 'Read-only CLI did not produce one JSON measurement.'
    $cli=Invoke-ArchiveFixtureVerifier $case ('x'*65537)
    Assert-ArchiveTest ($cli.code -ne 0 -and -not $cli.stdout) 'Oversized stdin was accepted or emitted success.'
    Assert-ArchiveRejects { New-CiPackageArchive $case.payload $case.evidence 'rustcorder-fixture' $case.scope } 'Archive overwrite was allowed.'
    foreach ($change in @(@{version='9.9.9'},@{source_sha=('2'*40)},@{tree_sha=('2'*40)},@{kind='hosted'})) {
        $bad = Copy-ArchiveValue $case.scope
        foreach ($entry in $change.GetEnumerator()) { $bad.PSObject.Properties[$entry.Key].Value = $entry.Value }
        Assert-ArchiveRejects { Test-CiPackageArchive $case.evidence $bad } 'Mismatched version/source/tree or unverified hosted data was accepted.'
    }
    foreach ($badRoot in @('../escape','CON','root/child','root.with.dots')) {
        $bad = New-ArchiveFixture; $bad.manifest.inner_root = $badRoot; Save-ArchiveFixtureManifest $bad
        Assert-ArchiveRejects { Test-CiPackageArchive $bad.evidence $bad.scope } 'Unsafe inner root was accepted.'
    }
    foreach ($badName in @('../escape.txt','rustcorder-fixture/../escape.txt','rustcorder-fixture\..\escape.txt','rustcorder-fixture/RUSTCORDER.EXE','rustcorder-fixture/rustcorder.exe')) {
        $bad = New-ArchiveFixture
        $zipPath = Join-Path $bad.evidence $bad.manifest.zip.path
        $zip = [IO.Compression.ZipFile]::Open($zipPath,[IO.Compression.ZipArchiveMode]::Update)
        try { $entry=$zip.CreateEntry($badName); $stream=$entry.Open(); $stream.WriteByte(1); $stream.Dispose() } finally { $zip.Dispose() }
        $bad.manifest.zip.sha256 = Get-FileSha256 $zipPath; $bad.manifest.zip.bytes = (Get-Item $zipPath).Length; Save-ArchiveFixtureManifest $bad
        Assert-ArchiveRejects { Test-CiPackageArchive $bad.evidence $bad.scope } 'Traversal/duplicate ZIP entry was accepted.'
    }
    $bad=New-ArchiveFixture; $bad.manifest.files[0].sha256=('0'*64); Save-ArchiveFixtureManifest $bad
    Assert-ArchiveRejects { Test-CiPackageArchive $bad.evidence $bad.scope } 'Corrupt payload binding was accepted.'
    $bad=New-ArchiveFixture; $zipPath=Join-Path $bad.evidence $bad.manifest.zip.path
    $zip=[IO.Compression.ZipFile]::Open($zipPath,[IO.Compression.ZipArchiveMode]::Update)
    try { $zip.GetEntry('rustcorder-fixture/rustcorder.exe').ExternalAttributes=-1610612736 } finally { $zip.Dispose() }
    $bad.manifest.zip.sha256=Get-FileSha256 $zipPath; $bad.manifest.zip.bytes=(Get-Item $zipPath).Length; Save-ArchiveFixtureManifest $bad
    Assert-ArchiveRejects { Test-CiPackageArchive $bad.evidence $bad.scope } 'A symlink ZIP entry was accepted.'
    foreach ($bound in @('count','entry-bytes')) {
        $bad=New-ArchiveFixture;$zipPath=Join-Path $bad.evidence $bad.manifest.zip.path;$bytes=[IO.File]::ReadAllBytes($zipPath);$end=$bytes.Length-22
        if($bound -ceq 'count') {
            [BitConverter]::GetBytes([uint16]10001).CopyTo($bytes,$end+8);[BitConverter]::GetBytes([uint16]10001).CopyTo($bytes,$end+10)
        } else {
            $central=[BitConverter]::ToUInt32($bytes,$end+16)
            [BitConverter]::GetBytes([uint32]268435457).CopyTo($bytes,[int]$central+24)
        }
        [IO.File]::WriteAllBytes($zipPath,$bytes);$bad.manifest.zip.sha256=Get-FileSha256 $zipPath;Save-ArchiveFixtureManifest $bad
        Assert-ArchiveRejects { Test-CiPackageArchive $bad.evidence $bad.scope } 'Oversized ZIP population was accepted.'
    }
    foreach ($member in @('ggml-silero-v6.2.0.bin','licenses/silero-vad-MIT-LICENSE.txt')) {
        foreach ($mode in @('missing','corrupt')) {
            $bad=New-ArchiveFixture; $zipPath=Join-Path $bad.evidence $bad.manifest.zip.path
            $zip=[IO.Compression.ZipFile]::Open($zipPath,[IO.Compression.ZipArchiveMode]::Update)
            try {
                $entry=$zip.GetEntry('rustcorder-fixture/'+$member); $size=$entry.Length; $entry.Delete()
                if($mode -ceq 'corrupt'){$entry=$zip.CreateEntry('rustcorder-fixture/'+$member);$stream=$entry.Open();try{$stream.Write((New-Object byte[] $size),0,[int]$size)}finally{$stream.Dispose()}}
            } finally { $zip.Dispose() }
            $bad.manifest.zip.sha256=Get-FileSha256 $zipPath; $bad.manifest.zip.bytes=(Get-Item $zipPath).Length; Save-ArchiveFixtureManifest $bad
            Assert-ArchiveRejects { Test-CiPackageArchive $bad.evidence $bad.scope } 'Missing/corrupt archived VAD or license was accepted.'
        }
    }
    foreach ($change in @('kind','executable_sha256','version','normal_close_requested','run_nonce','pid')) {
        $bad=New-ArchiveFixture; $proofPath=Join-Path $bad.evidence 'native/native-smoke.json'
        $proof=Get-Content $proofPath -Raw | ConvertFrom-Json
        $proof.PSObject.Properties[$change].Value = switch($change){kind{'simulated'}version{'9.9.9'}normal_close_requested{$false}run_nonce{'invalid'}pid{999}default{'0'*64}}
        Write-ArchiveFixtureJson $proofPath $proof
        $bad.manifest.native.sha256=Get-FileSha256 $proofPath; Save-ArchiveFixtureManifest $bad
        Assert-ArchiveRejects { Test-CiPackageArchive $bad.evidence $bad.scope } 'Simulated/mismatched native proof was accepted.'
    }
    $bad=New-ArchiveFixture; Remove-Item -LiteralPath (Join-Path $bad.evidence 'native/native-smoke.json')
    Assert-ArchiveRejects { Test-CiPackageArchive $bad.evidence $bad.scope } 'Missing native proof was accepted.'
    foreach ($change in @('title','top','png')) {
        $bad=New-ArchiveFixture; $proofPath=Join-Path $bad.evidence 'native/native-smoke.json'; $proof=Read-CiArchiveJson $proofPath
        if($change -ceq 'png') {
            $diagnosticPath=Join-Path $bad.evidence 'native/window.png'
            $bytes=[IO.File]::ReadAllBytes($diagnosticPath);$bytes[0]=0;[IO.File]::WriteAllBytes($diagnosticPath,$bytes)
            $proof.diagnostics[1].sha256=Get-FileSha256 $diagnosticPath
        } else {
            $diagnosticPath=Join-Path $bad.evidence 'native/accessibility-tree.json';$tree=Read-CiArchiveJson $diagnosticPath
            if($change -ceq 'title'){$tree.window.title='A different window'}else{$tree.window.bounds.top=0.1}
            Write-ArchiveFixtureJson $diagnosticPath $tree;$proof.diagnostics[0].sha256=Get-FileSha256 $diagnosticPath
        }
        Write-ArchiveFixtureJson $proofPath $proof;$bad.manifest.native.sha256=Get-FileSha256 $proofPath;Save-ArchiveFixtureManifest $bad
        Assert-ArchiveRejects { Test-CiPackageArchive $bad.evidence $bad.scope } 'Hash-consistent but contradictory native diagnostics were accepted.'
    }
    foreach ($field in @('sha256','license_sha256')) {
        $badScope=Copy-ArchiveValue $case.scope; $badScope.vad.PSObject.Properties[$field].Value=('0'*64)
        Assert-ArchiveRejects { Test-CiPackageArchive $case.evidence $badScope } 'Corrupt VAD/license source binding was accepted.'
    }
    Write-Output 'Archive boundary fixtures passed; no real native launch was claimed.'
} finally {
    $full=[IO.Path]::GetFullPath($archiveTestRoot); $boundary=[IO.Path]::GetFullPath((Join-Path $archiveRepoRoot '.build'))+[IO.Path]::DirectorySeparatorChar
    if(-not $full.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase) -or ((Get-Item $full).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Unsafe archive fixture cleanup.'}
    Remove-Item -LiteralPath $full -Recurse -Force
}
