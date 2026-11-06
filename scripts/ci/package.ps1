[CmdletBinding()]
param([string]$EvidenceDirectory, [string]$ContextFile, [switch]$VerifyOnly)

$ErrorActionPreference = 'Stop'
$archiveRequestedRoot = $EvidenceDirectory
$archiveRequestedContext = $ContextFile
$archiveVerifyMode = $VerifyOnly
$archiveImported = $MyInvocation.InvocationName -eq '.'
$archiveScriptRoot = $PSScriptRoot
$archiveRepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$archiveUtf8 = New-Object Text.UTF8Encoding($false)
. (Join-Path $archiveRepoRoot 'scripts/package.ps1')
. (Join-Path $archiveScriptRoot 'setup-windows.ps1')
. (Join-Path $archiveScriptRoot 'ui-smoke.ps1')
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Assert-CiArchiveRoot([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    $boundary = [IO.Path]::GetFullPath((Join-Path $archiveRepoRoot '.build')) + [IO.Path]::DirectorySeparatorChar
    $comparison = if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
    if (-not $full.StartsWith($boundary, $comparison)) { throw 'Package evidence escaped this checkout .build.' }
    return Assert-CiOwnedDirectory $full
}

function Resolve-CiArchiveFile([string]$Root, $Relative) {
    if ($Relative -isnot [string]) { throw 'Archive paths must be scalar strings.' }
    $safe = Assert-CiRelativePath $Relative
    $file = Assert-CiArchiveRoot (Join-Path $Root $safe)
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw ('Missing package evidence: ' + $safe) }
    return $file
}

function Read-CiArchiveJson([string]$Path, [int]$Maximum = 4194304) {
    if ((Get-Item -LiteralPath $Path).Length -gt $Maximum) { throw 'Package JSON exceeded its bound.' }
    return [IO.File]::ReadAllText($Path, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

function Assert-CiArchiveHash($Value) {
    if ($Value -isnot [string] -or $Value -cnotmatch '^[a-f0-9]{64}$') { throw 'Invalid scalar package SHA-256.' }
}

function Assert-CiArchiveScope($Scope) {
    if ($Scope.version -isnot [string] -or $Scope.version -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' -or
        $Scope.source_sha -isnot [string] -or $Scope.source_sha -cnotmatch '^[a-f0-9]{40}$' -or
        $Scope.tree_sha -isnot [string] -or $Scope.tree_sha -cnotmatch '^[a-f0-9]{40}$' -or
        $Scope.kind -isnot [string] -or $Scope.kind -cnotin @('local','hosted')) { throw 'Invalid expected package scope.' }
    Assert-CiArchiveHash $Scope.vad.sha256
    Assert-CiArchiveHash $Scope.vad.license_sha256
    Assert-CiArchiveHash $Scope.vad_metadata_sha256
    if ($Scope.vad.filename -isnot [string] -or (Assert-CiRelativePath $Scope.vad.filename).Contains('/') -or
        -not (Test-SmokeInteger $Scope.vad.bytes 1 268435456) -or $Scope.vad.revision -isnot [string] -or
        $Scope.vad.revision -cnotmatch '^[a-f0-9]{40}$' -or $Scope.vad.license -isnot [string] -or $Scope.vad.license -cne 'MIT') { throw 'Invalid pinned VAD scope.' }
}

function Get-CiArchiveFiles($Files) {
    $result = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::Ordinal)
    $folded = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in @($Files)) {
        if ($file.path -isnot [string]) { throw 'Missing package file path.' }
        $relative = Assert-CiRelativePath $file.path
        Assert-CiArchiveHash $file.sha256
        if (-not (Test-SmokeInteger $file.bytes 0 268435456) -or -not $folded.Add($relative)) { throw 'Invalid/duplicate package file binding.' }
        if ($relative -cnotin @('rustcorder.exe','ggml-silero-v6.2.0.bin','silero-vad.json','package-info.json','native-imports.txt','THIRD-PARTY-NOTICES.md','START-HERE.txt') -and -not $relative.StartsWith('licenses/', [StringComparison]::Ordinal)) { throw 'Unexpected package payload member.' }
        $result.Add($relative, $file)
    }
    if ($result.Count -lt 6 -or $result.Count -gt 10000) { throw 'Empty/oversized package payload inventory.' }
    return ,$result
}

function Assert-CiPackageInfo($Info, $Scope, $Files) {
    foreach ($field in @('target','vad_filename','vad_sha256','vad_source_revision','vad_license_sha256','vad_metadata_sha256','executable_sha256','clean_disconnected_machine_validation')) {
        if ($Info.$field -isnot [string]) { throw 'Package metadata requires scalar string identities.' }
    }
    if ($Info.product_version -isnot [string] -or $Info.product_version -cne $Scope.version -or
        $Info.source_sha -isnot [string] -or $Info.source_sha -cne $Scope.source_sha -or
        $Info.source_tree_sha -isnot [string] -or $Info.source_tree_sha -cne $Scope.tree_sha -or
        $Info.source_dirty -isnot [bool] -or $Info.source_verification -isnot [string] -or
        $Info.source_verification -cnotin @('skipped-build','dirty-build','fresh-clean-build') -or
        $Info.profile -isnot [string] -or $Info.profile -cnotin @('Debug','Release') -or
        $Info.target -cne 'x86_64-pc-windows-msvc') { throw 'Package version/source/build identity mismatch.' }
    if ($Scope.kind -ceq 'hosted' -and ($Info.profile -cne 'Release' -or $Info.source_dirty -or $Info.source_verification -cne 'fresh-clean-build')) { throw 'Hosted certification requires a fresh clean Release build.' }
    if (($Info.source_verification -ceq 'fresh-clean-build' -and $Info.source_dirty) -or ($Info.source_verification -ceq 'dirty-build' -and -not $Info.source_dirty)) { throw 'Contradictory source verification.' }
    foreach ($field in @('static_crt','vad_model_bundled')) { if ($Info.$field -isnot [bool] -or -not $Info.$field) { throw 'Missing portable/VAD package proof.' } }
    if ($Info.asr_models_bundled -isnot [bool] -or $Info.asr_models_bundled -or $Info.clean_disconnected_machine_validation -cne 'pending') { throw 'Unproven model/device package claim.' }
    if (-not (Test-SmokeInteger $Info.vad_bytes 1 268435456) -or $Info.vad_filename -cne $Scope.vad.filename -or $Info.vad_sha256 -cne $Scope.vad.sha256 -or
        $Info.vad_bytes -ne $Scope.vad.bytes -or $Info.vad_source_revision -cne $Scope.vad.revision -or
        $Info.vad_license_sha256 -cne $Scope.vad.license_sha256 -or $Info.vad_metadata_sha256 -cne $Scope.vad_metadata_sha256) { throw 'Pinned VAD/license provenance mismatch.' }
    if (@($Info.inventory_excludes).Count -ne 1 -or $Info.inventory_excludes[0] -cne 'package-info.json') { throw 'Package inventory self-reference scope changed.' }
    $recorded = Get-CiArchiveFiles $Info.files
    if ($recorded.ContainsKey('package-info.json') -or $recorded.Count + 1 -ne $Files.Count) { throw 'Incomplete package metadata inventory.' }
    foreach ($name in $recorded.Keys) {
        if (-not $Files.ContainsKey($name) -or $recorded[$name].sha256 -cne $Files[$name].sha256 -or $recorded[$name].bytes -ne $Files[$name].bytes) { throw 'Package metadata/ZIP inventory drift.' }
    }
    foreach ($required in @('rustcorder.exe',$Scope.vad.filename,'silero-vad.json','licenses/silero-vad-MIT-LICENSE.txt','native-imports.txt','THIRD-PARTY-NOTICES.md','START-HERE.txt','package-info.json')) {
        if (-not $Files.ContainsKey($required)) { throw ('Missing required package member: ' + $required) }
    }
    if ($Files['rustcorder.exe'].bytes -lt 1 -or $Info.executable_sha256 -cne $Files['rustcorder.exe'].sha256 -or
        $Files[$Scope.vad.filename].bytes -ne $Scope.vad.bytes -or $Files[$Scope.vad.filename].sha256 -cne $Scope.vad.sha256 -or
        $Files['licenses/silero-vad-MIT-LICENSE.txt'].sha256 -cne $Scope.vad.license_sha256 -or
        $Files['silero-vad.json'].sha256 -cne $Scope.vad_metadata_sha256) { throw 'Executable/VAD/license bytes do not match package identity.' }
    if (@($Info.direct_imports).Count -lt 1 -or @($Info.direct_imports).Count -gt 128) { throw 'Missing native import inventory.' }
    foreach ($import in $Info.direct_imports) {
        if ($import -isnot [string] -or $import -notmatch '^[a-z0-9_.-]+\.dll$' -or $import -match '^(?:vcruntime\d+.*|msvcp\d+.*|concrt\d+.*|vcomp\d+.*|ucrtbase|api-ms-win-crt-.*|whisper|ggml.*|libclang|python.*)\.dll$') { throw 'Unverified portable native import.' }
    }
}

function Read-CiZipPayload($Entry, [long]$ExpectedBytes, [switch]$Capture) {
    if ($Entry.Length -ne $ExpectedBytes -or $ExpectedBytes -gt 268435456) { throw 'ZIP entry length mismatch/overflow.' }
    $stream = $Entry.Open(); $hash = [Security.Cryptography.SHA256]::Create()
    $buffer = New-Object byte[] 65536; $total = 0L
    $copy = if ($Capture) { New-Object IO.MemoryStream } else { $null }
    try {
        while (($read = $stream.Read($buffer,0,$buffer.Length)) -gt 0) {
            $total += $read
            if ($total -gt $ExpectedBytes -or ($Capture -and $total -gt 4194304)) { throw 'ZIP stream exceeded its declared bound.' }
            [void]$hash.TransformBlock($buffer,0,$read,$buffer,0)
            if ($Capture) { $copy.Write($buffer,0,$read) }
        }
        if ($total -ne $ExpectedBytes) { throw 'Truncated ZIP entry.' }
        [void]$hash.TransformFinalBlock([byte[]]@(),0,0)
        return @{ sha256 = [BitConverter]::ToString($hash.Hash).Replace('-','').ToLowerInvariant(); bytes = $total; content = if ($Capture) { $copy.ToArray() } else { $null } }
    } finally { $stream.Dispose(); $hash.Dispose(); if ($copy) { $copy.Dispose() } }
}

function Assert-CiZipPopulation([string]$Path) {
    # Bound central-directory allocation before ZipArchive materializes its entries.
    $stream=[IO.File]::OpenRead($Path)
    try {
        $tail=New-Object byte[] ([int][Math]::Min($stream.Length,65557))
        [void]$stream.Seek(-$tail.Length,[IO.SeekOrigin]::End)
        if($stream.Read($tail,0,$tail.Length) -ne $tail.Length){throw 'Truncated ZIP directory trailer.'}
        $end=-1
        for($i=$tail.Length-22;$i -ge 0;$i--){
            if([BitConverter]::ToUInt32($tail,$i) -eq 101010256 -and $i+22+[BitConverter]::ToUInt16($tail,$i+20) -eq $tail.Length){$end=$i;break}
        }
        if($end -lt 0 -or ($end -ge 20 -and [BitConverter]::ToUInt32($tail,$end-20) -eq 117853008)){throw 'Missing or unsupported ZIP64 trailer.'}
        $count=[BitConverter]::ToUInt16($tail,$end+10)
        if([BitConverter]::ToUInt16($tail,$end+4) -ne 0 -or [BitConverter]::ToUInt16($tail,$end+6) -ne 0 -or
            [BitConverter]::ToUInt16($tail,$end+8) -ne $count -or $count -lt 1 -or $count -gt 10000){throw 'Split/oversized ZIP population.'}
        $size=[BitConverter]::ToUInt32($tail,$end+12);$offset=[BitConverter]::ToUInt32($tail,$end+16)
        $directoryEnd=$stream.Length-$tail.Length+$end
        if([long]$offset+[long]$size -ne $directoryEnd){throw 'Invalid ZIP central-directory extent.'}
        $stream.Position=$offset;$header=New-Object byte[] 46;$seen=0;$total=0L
        while($stream.Position -lt $directoryEnd){
            if(++$seen -gt $count -or $directoryEnd-$stream.Position -lt 46 -or $stream.Read($header,0,46) -ne 46 -or
                [BitConverter]::ToUInt32($header,0) -ne 33639248){throw 'Invalid/bounded ZIP central-directory population.'}
            $bytes=[BitConverter]::ToUInt32($header,24);$total+=$bytes
            $variable=[long][BitConverter]::ToUInt16($header,28)+[BitConverter]::ToUInt16($header,30)+[BitConverter]::ToUInt16($header,32)
            if($bytes -gt 268435456 -or $total -gt 536870912 -or [BitConverter]::ToUInt16($header,34) -ne 0 -or
                $stream.Position+$variable -gt $directoryEnd){throw 'ZIP entry extent/uncompressed population exceeded bound.'}
            [void]$stream.Seek($variable,[IO.SeekOrigin]::Current)
        }
        if($seen -ne $count){throw 'ZIP directory count mismatch.'}
    } finally {$stream.Dispose()}
}

function Assert-CiArchiveNative([string]$Root, $Binding, $Info) {
    if ($Binding.path -isnot [string] -or $Binding.path -cne 'native/native-smoke.json') { throw 'Unexpected native-proof path.' }
    Assert-CiArchiveHash $Binding.sha256
    $proofPath = Resolve-CiArchiveFile $Root $Binding.path
    if ((Get-Item -LiteralPath $proofPath).Length -gt 4194304) { throw 'Native proof exceeded its JSON bound.' }
    if ((Get-FileSha256 $proofPath) -cne $Binding.sha256) { throw 'Native-proof hash mismatch.' }
    $proof = Read-CiArchiveJson $proofPath
    if ($proof.status -isnot [string] -or $proof.status -cne 'pass') { throw 'Native launch is not certified.' }
    Assert-SmokeObservation $proof $Info.executable_sha256 $Info.product_version $proof.run_nonce
    $diagnostics = @($proof.diagnostics)
    if ($diagnostics.Count -ne 2) { throw 'Incomplete native diagnostics binding.' }
    foreach ($name in @('accessibility-tree.json','window.png')) {
        $matches = @($diagnostics | Where-Object { $_.path -ceq $name })
        if ($matches.Count -ne 1) { throw 'Missing/ambiguous native diagnostics.' }
        if ($matches[0].path -isnot [string]) { throw 'Native diagnostics require scalar paths.' }
        Assert-CiArchiveHash $matches[0].sha256
        $file = Resolve-CiArchiveFile $Root ('native/' + $name)
        $maximum = if ($name -ceq 'window.png') { 67108864 } else { 4194304 }
        if ((Get-Item -LiteralPath $file).Length -gt $maximum) { throw 'Native diagnostic exceeded its byte bound.' }
        if ((Get-FileSha256 $file) -cne $matches[0].sha256) { throw 'Native diagnostics hash mismatch.' }
    }
    $tree = Read-CiArchiveJson (Resolve-CiArchiveFile $Root 'native/accessibility-tree.json')
    Assert-SmokeWindow $tree.window ([int]$proof.pid)
    if ($tree.window.handle -ne $proof.window.handle -or $tree.window.title -cne $proof.window.title) { throw 'Native tree window identity mismatch.' }
    foreach ($dimension in @('left','top','width','height')) { if ($tree.window.bounds.$dimension -ne $proof.window.bounds.$dimension) { throw 'Native tree/observation bounds mismatch.' } }
    Assert-SmokeControls $tree.nodes $tree.window
    $pngPath = Resolve-CiArchiveFile $Root 'native/window.png'
    if ((Get-Item $pngPath).Length -lt 33 -or (Get-Item $pngPath).Length -gt 67108864) { throw 'Invalid/bounded native PNG size.' }
    $header = New-Object byte[] 24; $stream = [IO.File]::OpenRead($pngPath)
    try { if ($stream.Read($header,0,24) -ne 24) { throw 'Truncated native PNG.' } } finally { $stream.Dispose() }
    if ([BitConverter]::ToString($header[0..7]) -cne '89-50-4E-47-0D-0A-1A-0A' -or [BitConverter]::ToString($header[8..11]) -cne '00-00-00-0D' -or [Text.Encoding]::ASCII.GetString($header,12,4) -cne 'IHDR') { throw 'Invalid native PNG signature/header.' }
    $width = ([long]$header[16] * 16777216) + ([long]$header[17] * 65536) + ([long]$header[18] * 256) + $header[19]
    $height = ([long]$header[20] * 16777216) + ([long]$header[21] * 65536) + ([long]$header[22] * 256) + $header[23]
    if ($width -ne [Math]::Ceiling($proof.window.bounds.width) -or $height -ne [Math]::Ceiling($proof.window.bounds.height)) { throw 'Native PNG dimensions contradict observation.' }
}

function Write-CiArchiveChecksums([string]$Root, $Manifest) {
    $text = $Manifest.zip.sha256 + '  ' + $Manifest.zip.path + "`n" + (Get-FileSha256 (Join-Path $Root 'package-manifest.json')) + "  package-manifest.json`n"
    [IO.File]::WriteAllText((Join-Path $Root 'SHA256SUMS'),$text,$archiveUtf8)
}

function Test-CiPackageArchive([string]$OutputDirectory, $Scope) {
    Assert-CiArchiveScope $Scope
    $root = Assert-CiArchiveRoot $OutputDirectory
    $manifestPath = Resolve-CiArchiveFile $root 'package-manifest.json'
    $manifest = Read-CiArchiveJson $manifestPath
    foreach ($field in @('kind','version','source_sha','source_tree_sha','source_verification')) { if($manifest.$field -isnot [string]){throw 'Manifest identities require scalar strings.'} }
    if (-not (Test-SmokeInteger $manifest.schema_version 1 1) -or $manifest.kind -cne 'release-package' -or
        $manifest.version -cne $Scope.version -or $manifest.source_sha -cne $Scope.source_sha -or $manifest.source_tree_sha -cne $Scope.tree_sha) { throw 'Package manifest source/version/schema mismatch.' }
    if ($manifest.inner_root -isnot [string] -or $manifest.inner_root -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$' -or (Assert-CiRelativePath $manifest.inner_root).Contains('/')) { throw 'Unsafe ZIP inner root.' }
    $filename = 'rustcorder-v' + $Scope.version + '-windows-x64.zip'
    if ($manifest.zip.path -isnot [string] -or $manifest.zip.path -cne $filename -or -not (Test-SmokeInteger $manifest.zip.bytes 1 536870912)) { throw 'Unexpected/bounded canonical ZIP identity.' }
    Assert-CiArchiveHash $manifest.zip.sha256
    $zipPath = Resolve-CiArchiveFile $root $filename
    if ((Get-Item $zipPath).Length -ne $manifest.zip.bytes -or (Get-FileSha256 $zipPath) -cne $manifest.zip.sha256) { throw 'ZIP archive bytes/hash mismatch.' }
    $expectedSums = $manifest.zip.sha256 + '  ' + $filename + "`n" + (Get-FileSha256 $manifestPath) + "  package-manifest.json`n"
    $sumsPath = Resolve-CiArchiveFile $root 'SHA256SUMS'
    if ((Get-Item -LiteralPath $sumsPath).Length -gt 1024 -or [IO.File]::ReadAllText($sumsPath).Replace("`r`n","`n") -cne $expectedSums) { throw 'SHA256SUMS does not bind ZIP and manifest.' }
    $files = Get-CiArchiveFiles $manifest.files
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    Assert-CiZipPopulation $zipPath
    $zip = [IO.Compression.ZipFile]::OpenRead($zipPath); $total = 0L; $info = $null
    try {
        if ($zip.Entries.Count -lt 1 -or $zip.Entries.Count -gt 10000) { throw 'ZIP entry count exceeded bound.' }
        foreach ($entry in $zip.Entries) {
            $name = Assert-CiRelativePath $entry.FullName
            if (-not $name.StartsWith($manifest.inner_root + '/', [StringComparison]::Ordinal) -or
                -not $seen.Add($name) -or ($entry.ExternalAttributes -shr 16 -band 61440) -eq 40960 -or
                ($entry.ExternalAttributes -band 1024)) { throw 'Unexpected/duplicate/symlink ZIP member.' }
            $relative = $name.Substring($manifest.inner_root.Length + 1)
            if (-not $files.ContainsKey($relative)) { throw 'ZIP contains an unbound payload member.' }
            $total += $entry.Length
            if ($entry.Length -lt 0 -or $total -gt 536870912) { throw 'ZIP uncompressed population exceeded bound.' }
            $captured = Read-CiZipPayload $entry $files[$relative].bytes -Capture:($relative -ceq 'package-info.json')
            if ($captured.sha256 -cne $files[$relative].sha256) { throw 'ZIP payload SHA-256 mismatch.' }
            if ($relative -ceq 'package-info.json') { $info = $archiveUtf8.GetString($captured.content).TrimStart([char]0xFEFF) | ConvertFrom-Json }
        }
        if ($seen.Count -ne $files.Count -or $null -eq $info) { throw 'ZIP omitted required inventory members.' }
    } finally { $zip.Dispose() }
    Assert-CiPackageInfo $info $Scope $files
    if ($manifest.source_dirty -isnot [bool] -or $manifest.source_dirty -ne $info.source_dirty -or $manifest.source_verification -cne $info.source_verification) { throw 'Manifest/metadata build provenance mismatch.' }
    Assert-CiArchiveNative $root $manifest.native $info
    return [pscustomobject][ordered]@{ status='pass'; version=$Scope.version; source_sha=$Scope.source_sha; tree_sha=$Scope.tree_sha
        zip_sha256=$manifest.zip.sha256; native_sha256=$manifest.native.sha256; files=$files.Count
        kind=if($Scope.kind -ceq 'hosted'){'hosted-release-package'}else{'local-package'} }
}

function New-CiPackageArchive([string]$PackageDirectory, [string]$OutputDirectory, [string]$InnerRoot, $Scope) {
    Assert-CiArchiveScope $Scope
    $root = Assert-CiArchiveRoot $OutputDirectory
    [IO.Directory]::CreateDirectory($root) | Out-Null
    if ($InnerRoot -cnotmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$' -or (Assert-CiRelativePath $InnerRoot).Contains('/')) { throw 'Unsafe package inner folder.' }
    $filename = 'rustcorder-v' + $Scope.version + '-windows-x64.zip'
    foreach ($name in @($filename,'package-manifest.json','SHA256SUMS')) { if(Test-Path -LiteralPath (Join-Path $root $name)){throw 'Package archive/evidence already exists; refusing overwrite.'} }
    $infoPath = Join-Path $PackageDirectory 'package-info.json'
    $info = Read-CiArchiveJson $infoPath
    $inventory = @(Get-PackageFileInventory $PackageDirectory) + @([pscustomobject]@{path='package-info.json';bytes=(Get-Item $infoPath).Length;sha256=(Get-FileSha256 $infoPath)})
    $files = Get-CiArchiveFiles $inventory
    Assert-CiPackageInfo $info $Scope $files
    $native = [pscustomobject]@{path='native/native-smoke.json';sha256=(Get-FileSha256 (Resolve-CiArchiveFile $root 'native/native-smoke.json'))}
    Assert-CiArchiveNative $root $native $info
    $zipPath = Join-Path $root $filename
    $stream = [IO.File]::Open($zipPath,[IO.FileMode]::CreateNew)
    $zip = New-Object IO.Compression.ZipArchive($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
    try {
        foreach ($item in ($inventory | Sort-Object path -CaseSensitive)) {
            $entry = $zip.CreateEntry($InnerRoot + '/' + $item.path,[IO.Compression.CompressionLevel]::Optimal)
            $source = [IO.File]::OpenRead((Join-Path $PackageDirectory $item.path)); $target = $entry.Open()
            try { $source.CopyTo($target) } finally { $source.Dispose(); $target.Dispose() }
        }
    } finally { $zip.Dispose(); $stream.Dispose() }
    $manifest = [pscustomobject][ordered]@{schema_version=1;kind='release-package';version=$Scope.version
        source_sha=$Scope.source_sha;source_tree_sha=$Scope.tree_sha;source_dirty=$info.source_dirty;source_verification=$info.source_verification
        inner_root=$InnerRoot;zip=[pscustomobject]@{path=$filename;bytes=(Get-Item $zipPath).Length;sha256=(Get-FileSha256 $zipPath)}
        files=$inventory;native=$native}
    [IO.File]::WriteAllText((Join-Path $root 'package-manifest.json'),($manifest | ConvertTo-Json -Depth 12),$archiveUtf8)
    Write-CiArchiveChecksums $root $manifest
    Test-CiPackageArchive $root $Scope | Out-Null
    return $manifest
}

function Invoke-CiPackage([string]$Root, [string]$ContextPath) {
    if ($PSVersionTable.PSVersion.Major -lt 7 -or [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Release packaging requires Windows PowerShell 7.' }
    . (Join-Path $archiveScriptRoot 'ci.ps1')
    $rootPath = Assert-CiArchiveRoot $Root
    [IO.Directory]::CreateDirectory($rootPath) | Out-Null
    $context = Read-CiArchiveJson (Assert-CiArchiveRoot $ContextPath) 65536
    if ($context.kind -isnot [string] -or $context.kind -cnotin @('local','hosted') -or $context.tested_sha -isnot [string] -or $context.tested_sha -cnotmatch '^[a-f0-9]{40}$') { throw 'Missing package execution context.' }
    if ($context.kind -ceq 'hosted' -and ($context.event -cne 'push' -or $context.branch -cne 'release' -or $context.repository_id -ne $context.head_repository_id)) { throw 'Hosted packaging is limited to same-repository release pushes.' }
    $observed = Get-PackageSourceIdentity
    if ($observed.sha -cne $context.tested_sha) { throw 'Package checkout changed after execution context.' }
    $cargo = [IO.File]::ReadAllText((Join-Path $archiveRepoRoot 'Cargo.toml'))
    $packageSection = [regex]::Match($cargo, '(?ms)^\[package\]\s*\r?\n(.*?)(?=^\[|\z)').Groups[1].Value
    $versionMatch = [regex]::Match($packageSection, '(?m)^version\s*=\s*"((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))"\s*$')
    if (-not $versionMatch.Success) { throw 'Cannot read the root Cargo stable product version.' }
    $productVersion = $versionMatch.Groups[1].Value
    $run = [string]$context.run_id
    if ($run -cnotmatch '^[A-Za-z0-9_-]{1,64}$' -or -not (Test-SmokeInteger $context.run_attempt 1)) { throw 'Unsafe package run identity.' }
    $name = 'candidate-' + $context.tested_sha.Substring(0,12) + '-' + $run + '-' + $context.run_attempt
    $shell = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $built = Invoke-CiChild -FilePath $shell -Arguments @('-NoProfile','-File',(Join-Path $archiveRepoRoot 'scripts/package.ps1'),'-Profile','Release','-Name',$name) -WorkingDirectory $archiveRepoRoot -TimeoutSeconds 1000
    Write-CiUtf8 (Join-Path $rootPath 'assembly.stdout.log') $built.stdout
    Write-CiUtf8 (Join-Path $rootPath 'assembly.stderr.log') $built.stderr
    if ($built.timed_out -or $built.exit_code -ne 0) { throw 'Fresh Release package assembly failed/incomplete.' }
    $package = Join-Path $archiveRepoRoot ('dist/' + $name)
    $info = Read-CiArchiveJson (Join-Path $package 'package-info.json')
    $smoke = Invoke-CiChild -FilePath $shell -Arguments @('-NoProfile','-File',(Join-Path $archiveScriptRoot 'ui-smoke.ps1'),
        '-Executable',(Join-Path $package 'rustcorder.exe'),'-ExpectedSha256',$info.executable_sha256,
        '-Version',$productVersion,'-EvidenceDirectory',(Join-Path $rootPath 'native'),'-TimeoutSeconds','60') -WorkingDirectory $archiveRepoRoot -TimeoutSeconds 75
    Write-CiUtf8 (Join-Path $rootPath 'smoke.stdout.log') $smoke.stdout
    Write-CiUtf8 (Join-Path $rootPath 'smoke.stderr.log') $smoke.stderr
    if ($smoke.timed_out -or $smoke.exit_code -ne 0) { throw 'Actual packaged native-window smoke failed/incomplete.' }
    $vadPath = Join-Path $archiveRepoRoot 'assets/silero-vad.json'
    $scope = [pscustomobject]@{version=$productVersion;source_sha=$context.tested_sha;tree_sha=$observed.tree_sha;kind=$context.kind
        vad=(Read-CiArchiveJson $vadPath);vad_metadata_sha256=(Get-FileSha256 $vadPath)}
    New-CiPackageArchive $package $rootPath $name $scope | Out-Null
    return Test-CiPackageArchive $rootPath $scope
}

if (-not $archiveImported) {
    try {
        if ($archiveVerifyMode) {
            $inputText = New-Object Text.StringBuilder
            while (($next = [Console]::In.Read()) -ge 0) {
                if ($inputText.Length -ge 65536) { throw 'Expected package scope exceeded 64KiB.' }
                [void]$inputText.Append([char]$next)
            }
            if ($archiveUtf8.GetByteCount($inputText.ToString()) -gt 65536) { throw 'Expected package scope exceeded 64KiB.' }
            $scope = $inputText.ToString() | ConvertFrom-Json
            Test-CiPackageArchive $archiveRequestedRoot $scope | ConvertTo-Json -Depth 6 -Compress
        } else { Invoke-CiPackage $archiveRequestedRoot $archiveRequestedContext | ConvertTo-Json -Depth 6 -Compress }
    } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 2 }
}
