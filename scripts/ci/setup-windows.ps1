[CmdletBinding()]
param([switch]$Install, [switch]$CheckOnly, [string]$ExtractArchive, [string]$ExtractDestination)

$ErrorActionPreference = 'Stop'
$taskSetupRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskExtractMode=$PSBoundParameters.ContainsKey('ExtractArchive') -or $PSBoundParameters.ContainsKey('ExtractDestination')
$taskSetupComparison=if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT){[StringComparison]::OrdinalIgnoreCase}else{[StringComparison]::Ordinal}

function Assert-CiOwnedDirectory([string]$Path) {
    $taskFull = [IO.Path]::GetFullPath($Path)
    $taskBoundary = [IO.Path]::GetFullPath((Join-Path $taskSetupRoot '.build'))
    if (-not $taskFull.StartsWith($taskBoundary + [IO.Path]::DirectorySeparatorChar, $taskSetupComparison) -and -not $taskFull.Equals($taskBoundary,$taskSetupComparison)) { throw 'Directory escaped this checkout .build.' }
    $taskParent = $taskFull
    while ($taskParent -and $taskParent.Length -ge $taskSetupRoot.Length) {
        $taskItem = Get-Item -LiteralPath $taskParent -Force -ErrorAction SilentlyContinue
        if ($taskItem) {
            if ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected CI output/tool paths are forbidden.' }
        }
        $taskParent = Split-Path -Parent $taskParent
    }
    return $taskFull
}

function Assert-CiRelativePath([string]$Path) {
    if (-not $Path -or [IO.Path]::IsPathRooted($Path) -or $Path -match '[<>:"|?*\x00-\x1f]') { throw 'Unsafe archive-relative path.' }
    $taskNormalized = $Path.Replace('\', '/')
    foreach ($taskPart in $taskNormalized.Split('/')) {
        if (-not $taskPart -or $taskPart -in @('.', '..') -or $taskPart -match '[. ]$' -or $taskPart -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
            throw 'Unsafe archive entry segment.'
        }
    }
    return $taskNormalized
}

function Get-CiSha256([string]$Path) {
    $taskHash = [Security.Cryptography.SHA256]::Create()
    $taskStream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($taskHash.ComputeHash($taskStream)).Replace('-', '').ToLowerInvariant() }
    finally { $taskStream.Dispose(); $taskHash.Dispose() }
}

function Assert-CiFileHash([string]$Path, [string]$Expected) {
    if ($Expected -notmatch '^[a-f0-9]{64}$' -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'Missing tool or invalid checksum.' }
    if ((Get-CiSha256 $Path) -cne $Expected) { throw 'Downloaded/cached tool checksum mismatch.' }
    return $Path
}

function Assert-CiCapabilities([hashtable]$Capabilities) {
    foreach ($taskCapability in @('msvc', 'cmake', 'libclang', 'git', 'rust')) {
        if (-not $Capabilities.ContainsKey($taskCapability) -or [string]::IsNullOrWhiteSpace($Capabilities[$taskCapability])) {
            throw ('Required Windows prerequisite is unavailable: ' + $taskCapability)
        }
    }
    return $Capabilities
}

function Get-CiAsset {
    param([string]$Name, [string]$CacheRoot)
    $taskPins = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'toolchain.json') -Raw | ConvertFrom-Json
    $taskAsset = $taskPins.assets.PSObject.Properties[$Name].Value
    if (-not $taskAsset -or $taskAsset.url -notmatch '^https://') { throw 'Unknown/unpinned asset.' }
    $taskFullCache = Assert-CiOwnedDirectory $CacheRoot
    $taskAllowed = [IO.Path]::GetFullPath((Join-Path $taskSetupRoot '.build')) + [IO.Path]::DirectorySeparatorChar
    if (-not $taskFullCache.StartsWith($taskAllowed, [StringComparison]::OrdinalIgnoreCase)) { throw 'Asset cache escaped this checkout.' }
    [IO.Directory]::CreateDirectory($taskFullCache) | Out-Null
    $taskArchive = Join-Path $taskFullCache ($Name + '.zip')
    if (-not (Test-Path -LiteralPath $taskArchive)) {
        $taskTemporary = $taskArchive + '.partial-' + [Guid]::NewGuid().ToString('N')
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -UseBasicParsing -Uri $taskAsset.url -OutFile $taskTemporary
            Assert-CiFileHash $taskTemporary $taskAsset.sha256 | Out-Null
            Move-Item -LiteralPath $taskTemporary -Destination $taskArchive
        } finally {
            if (Test-Path -LiteralPath $taskTemporary) { Remove-Item -LiteralPath $taskTemporary }
        }
    }
    return Assert-CiFileHash $taskArchive $taskAsset.sha256
}

function Assert-CiExtractionPopulation([string]$Archive) {
    $taskStream=[IO.File]::OpenRead($Archive)
    try {
        if($taskStream.Length -lt 22 -or $taskStream.Length -gt 536870912){throw 'Artifact ZIP compressed size exceeded bound.'}
        # Check the central directory before ZipArchive allocates entry objects.
        $taskTail=New-Object byte[] ([int][Math]::Min($taskStream.Length,65557))
        [void]$taskStream.Seek(-$taskTail.Length,[IO.SeekOrigin]::End)
        if($taskStream.Read($taskTail,0,$taskTail.Length) -ne $taskTail.Length){throw 'Truncated artifact ZIP trailer.'}
        $taskEnd=-1
        for($taskIndex=$taskTail.Length-22;$taskIndex -ge 0;$taskIndex--){
            if([BitConverter]::ToUInt32($taskTail,$taskIndex) -eq 101010256 -and $taskIndex+22+[BitConverter]::ToUInt16($taskTail,$taskIndex+20) -eq $taskTail.Length){$taskEnd=$taskIndex;break}
        }
        if($taskEnd -lt 0 -or ($taskEnd -ge 20 -and [BitConverter]::ToUInt32($taskTail,$taskEnd-20) -eq 117853008)){throw 'Missing or unsupported ZIP64 artifact trailer.'}
        $taskCount=[BitConverter]::ToUInt16($taskTail,$taskEnd+10)
        if([BitConverter]::ToUInt16($taskTail,$taskEnd+4) -ne 0 -or [BitConverter]::ToUInt16($taskTail,$taskEnd+6) -ne 0 -or
            [BitConverter]::ToUInt16($taskTail,$taskEnd+8) -ne $taskCount -or $taskCount -lt 1 -or $taskCount -gt 10000){throw 'Split/oversized artifact ZIP population.'}
        $taskSize=[BitConverter]::ToUInt32($taskTail,$taskEnd+12);$taskOffset=[BitConverter]::ToUInt32($taskTail,$taskEnd+16)
        $taskDirectoryEnd=$taskStream.Length-$taskTail.Length+$taskEnd
        if([long]$taskOffset+[long]$taskSize -ne $taskDirectoryEnd){throw 'Invalid artifact ZIP directory extent.'}
        $taskStream.Position=$taskOffset;$taskHeader=New-Object byte[] 46;$taskSeenCount=0;$taskTotal=0L
        while($taskStream.Position -lt $taskDirectoryEnd){
            if(++$taskSeenCount -gt $taskCount -or $taskDirectoryEnd-$taskStream.Position -lt 46 -or $taskStream.Read($taskHeader,0,46) -ne 46 -or
                [BitConverter]::ToUInt32($taskHeader,0) -ne 33639248){throw 'Invalid/bounded artifact directory population.'}
            $taskBytes=[BitConverter]::ToUInt32($taskHeader,24);$taskTotal+=$taskBytes
            $taskVariable=[long][BitConverter]::ToUInt16($taskHeader,28)+[BitConverter]::ToUInt16($taskHeader,30)+[BitConverter]::ToUInt16($taskHeader,32)
            if($taskBytes -gt 268435456 -or $taskTotal -gt 536870912 -or [BitConverter]::ToUInt16($taskHeader,34) -ne 0 -or
                $taskStream.Position+$taskVariable -gt $taskDirectoryEnd){throw 'Artifact ZIP uncompressed population exceeded bound.'}
            [void]$taskStream.Seek($taskVariable,[IO.SeekOrigin]::Current)
        }
        if($taskSeenCount -ne $taskCount){throw 'Artifact ZIP directory count mismatch.'}
    } finally {$taskStream.Dispose()}
}

function Expand-CiZip {
    param([string]$Archive, [string]$Destination, [switch]$NoOverwrite)
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Add-Type -AssemblyName System.IO.Compression
    $taskArchivePath=Assert-CiOwnedDirectory $Archive
    if(-not (Test-Path -LiteralPath $taskArchivePath -PathType Leaf)){throw 'Artifact ZIP must be an existing .build file.'}
    $taskTarget = Assert-CiOwnedDirectory $Destination
    $taskAllowed = [IO.Path]::GetFullPath((Join-Path $taskSetupRoot '.build')) + [IO.Path]::DirectorySeparatorChar
    if (-not $taskTarget.StartsWith($taskAllowed, $taskSetupComparison)) { throw 'ZIP extraction escaped this checkout.' }
    if($NoOverwrite -and (Test-Path -LiteralPath $taskTarget)){throw 'Artifact extraction requires a fresh destination; refusing overwrite.'}
    Assert-CiExtractionPopulation $taskArchivePath
    $taskArchive = [IO.Compression.ZipFile]::OpenRead($taskArchivePath)
    $taskSeen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $taskNodes = New-Object 'System.Collections.Generic.Dictionary[string,object]' ([StringComparer]::OrdinalIgnoreCase)
    $taskEntries = New-Object 'System.Collections.Generic.List[object]'
    try {
        if($taskArchive.Entries.Count -lt 1 -or $taskArchive.Entries.Count -gt 10000){throw 'Artifact ZIP entry count exceeded bound.'}
        $taskDeclaredTotal=0L
        foreach ($taskEntry in $taskArchive.Entries) {
            $taskName=$taskEntry.FullName.Replace('\','/');$taskDirectory=$taskName.EndsWith('/')
            $taskRelative = Assert-CiRelativePath $(if($taskDirectory){$taskName.Substring(0,$taskName.Length-1)}else{$taskName})
            if (-not $taskSeen.Add($taskRelative)) { throw 'Duplicate/case-colliding archive entry.' }
            if (($taskEntry.ExternalAttributes -shr 16 -band 61440) -eq 40960 -or ($taskEntry.ExternalAttributes -band 1024)) { throw 'Archive symlinks/reparse members are forbidden.' }
            $taskDeclaredTotal+=$taskEntry.Length
            if($taskEntry.Length -lt 0 -or $taskEntry.Length -gt 268435456 -or $taskDeclaredTotal -gt 536870912 -or ($taskDirectory -and $taskEntry.Length -ne 0)){throw 'Artifact ZIP member bytes exceeded bound.'}
            $taskParts=$taskRelative.Split('/');$taskPrefix=''
            for($taskIndex=0;$taskIndex -lt $taskParts.Length;$taskIndex++){
                $taskPrefix=if($taskPrefix){$taskPrefix+'/'+$taskParts[$taskIndex]}else{$taskParts[$taskIndex]}
                $taskIsDirectory=($taskIndex -lt $taskParts.Length-1 -or $taskDirectory)
                if($taskNodes.ContainsKey($taskPrefix)){
                    if($taskNodes[$taskPrefix].path -cne $taskPrefix -or $taskNodes[$taskPrefix].directory -ne $taskIsDirectory){throw 'Case-colliding/conflicting artifact directory member.'}
                }else{$taskNodes.Add($taskPrefix,@{path=$taskPrefix;directory=$taskIsDirectory})}
            }
            $taskPath = [IO.Path]::GetFullPath((Join-Path $taskTarget $taskRelative))
            Assert-CiOwnedDirectory $taskPath | Out-Null
            if (-not $taskPath.StartsWith($taskTarget + [IO.Path]::DirectorySeparatorChar, $taskSetupComparison)) { throw 'Archive entry escaped target.' }
            $taskEntries.Add(@{entry=$taskEntry;path=$taskPath;directory=$taskDirectory})
        }
        if($NoOverwrite){
            [IO.Directory]::CreateDirectory((Split-Path -Parent $taskTarget)) | Out-Null
            New-Item -ItemType Directory -Path $taskTarget -ErrorAction Stop | Out-Null
        }else{[IO.Directory]::CreateDirectory($taskTarget) | Out-Null}
        $taskTotal=0L;$taskBuffer=New-Object byte[] 65536
        foreach($taskMember in $taskEntries){
            Assert-CiOwnedDirectory $taskMember.path | Out-Null
            if($taskMember.directory){[IO.Directory]::CreateDirectory($taskMember.path) | Out-Null;continue}
            [IO.Directory]::CreateDirectory((Split-Path -Parent $taskMember.path)) | Out-Null
            $taskSource=$taskMember.entry.Open();$taskOutput=$null;$taskWritten=0L
            try{
                $taskMode=if($NoOverwrite){[IO.FileMode]::CreateNew}else{[IO.FileMode]::Create}
                $taskOutput=[IO.File]::Open($taskMember.path,$taskMode,[IO.FileAccess]::Write,[IO.FileShare]::None)
                while(($taskRead=$taskSource.Read($taskBuffer,0,$taskBuffer.Length)) -gt 0){
                    $taskWritten+=$taskRead;$taskTotal+=$taskRead
                    if($taskWritten -gt $taskMember.entry.Length -or $taskWritten -gt 268435456 -or $taskTotal -gt 536870912){throw 'Artifact ZIP stream exceeded declared/actual byte bounds.'}
                    $taskOutput.Write($taskBuffer,0,$taskRead)
                }
                if($taskWritten -ne $taskMember.entry.Length){throw 'Truncated artifact ZIP stream.'}
            }finally{$taskSource.Dispose();if($taskOutput){$taskOutput.Dispose()}}
        }
    } finally { $taskArchive.Dispose() }
}

function Initialize-CiWindows {
    param([switch]$InstallTools)
    $taskPins = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'toolchain.json') -Raw | ConvertFrom-Json
    $taskCache = Join-Path $taskSetupRoot '.build\ci-tools'
    if ($InstallTools) {
        foreach ($taskName in @('libclang', 'rca', 'actionlint-windows', 'node-windows')) {
            $taskArchive = Get-CiAsset -Name $taskName -CacheRoot $taskCache
            $taskFolder = if ($taskName -eq 'node-windows') { 'node' } else { $taskName }
            Expand-CiZip -Archive $taskArchive -Destination (Join-Path $taskCache $taskFolder)
        }
    }
    foreach ($taskName in @('libclang', 'rca', 'actionlint-windows', 'node-windows')) {
        $taskArchivePath = Join-Path $taskCache ($taskName + '.zip')
        Assert-CiFileHash $taskArchivePath $taskPins.assets.PSObject.Properties[$taskName].Value.sha256 | Out-Null
        $taskFolder = if ($taskName -eq 'node-windows') { 'node' } else { $taskName }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $taskArchive = [IO.Compression.ZipFile]::OpenRead($taskArchivePath)
        try {
            foreach ($taskEntry in $taskArchive.Entries) {
                if ($taskEntry.FullName.EndsWith('/')) { continue }
                $taskExtracted = Join-Path (Join-Path $taskCache $taskFolder) (Assert-CiRelativePath $taskEntry.FullName)
                Assert-CiOwnedDirectory $taskExtracted | Out-Null
                $taskAlgorithm = [Security.Cryptography.SHA256]::Create()
                $taskStream = $taskEntry.Open()
                try { $taskExpected = [BitConverter]::ToString($taskAlgorithm.ComputeHash($taskStream)).Replace('-', '').ToLowerInvariant() }
                finally { $taskStream.Dispose(); $taskAlgorithm.Dispose() }
                Assert-CiFileHash $taskExtracted $taskExpected | Out-Null
            }
        } finally { $taskArchive.Dispose() }
    }
    $taskClang = Join-Path $taskCache 'libclang\libclang-18.1.1.data\platlib\clang\native'
    if (Test-Path -LiteralPath (Join-Path $taskClang 'libclang.dll')) { $env:LIBCLANG_PATH = $taskClang }
    else { throw 'Verified libclang is unavailable; run setup with -Install.' }
    $taskLegacyClang = Join-Path $taskSetupRoot '.build\python-deps\clang\native\libclang.dll'
    if (Test-Path -LiteralPath $taskLegacyClang) { Assert-CiFileHash $taskLegacyClang (Get-CiSha256 (Join-Path $taskClang 'libclang.dll')) | Out-Null }
    $taskRustupLocal = Join-Path $taskSetupRoot '.build\cargo\bin\rustup.exe'
    if (Test-Path -LiteralPath $taskRustupLocal) {
        $env:CARGO_HOME = Join-Path $taskSetupRoot '.build\cargo'
        $env:RUSTUP_HOME = Join-Path $taskSetupRoot '.build\rustup'
        $env:PATH = (Split-Path -Parent $taskRustupLocal) + ';' + $env:PATH
    }
    $env:RUSTUP_TOOLCHAIN = $taskPins.rust
    $taskRustup = (Get-Command rustup.exe -ErrorAction Stop).Source
    if ($InstallTools) {
        & $taskRustup toolchain install $taskPins.rust --profile minimal --component rustfmt --component clippy --component llvm-tools-preview
        if ($LASTEXITCODE -ne 0) { throw 'Pinned Rust/component setup failed.' }
        $taskPowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
        $taskDev = Join-Path $taskSetupRoot 'scripts\dev.ps1'
        & $taskPowerShell -NoProfile -File $taskDev fetch --locked
        if ($LASTEXITCODE -ne 0) { throw 'Locked dependency fetch failed.' }
        $taskCargoTools = Join-Path $taskCache 'cargo'
        foreach ($taskProperty in $taskPins.cargo.PSObject.Properties) {
            $taskBinary = Join-Path $taskCargoTools ('bin\' + $taskProperty.Name + '.exe')
            [string[]]$taskVersionArguments = switch ($taskProperty.Name) { 'cargo-llvm-cov' { @('llvm-cov', '--version') }; 'cargo-mutants' { @('mutants', '--version') }; default { @('--version') } }
            $taskFound = if (Test-Path -LiteralPath $taskBinary) { (& $taskBinary @taskVersionArguments 2>&1 | Out-String).Trim() } else { '' }
            if ($taskFound -notmatch ([regex]::Escape($taskProperty.Value) + '(?:\s|$)')) {
                & $taskPowerShell -NoProfile -File $taskDev install $taskProperty.Name --locked --version $taskProperty.Value --root $taskCargoTools
                if ($LASTEXITCODE -ne 0) { throw ('Pinned Cargo tool installation failed: ' + $taskProperty.Name) }
            }
        }
    }
    $env:PATH = (Join-Path $taskCache 'cargo\bin') + ';' + $env:PATH
    foreach ($taskProperty in $taskPins.cargo.PSObject.Properties) {
        $taskBinary = Join-Path $taskCache ('cargo\bin\' + $taskProperty.Name + '.exe')
        [string[]]$taskVersionArguments = switch ($taskProperty.Name) { 'cargo-llvm-cov' { @('llvm-cov', '--version') }; 'cargo-mutants' { @('mutants', '--version') }; default { @('--version') } }
        if (-not (Test-Path -LiteralPath $taskBinary) -or (& $taskBinary @taskVersionArguments | Out-String).Trim() -notmatch ([regex]::Escape($taskProperty.Value) + '(?:\s|$)')) { throw ('Missing/mismatched pinned tool: ' + $taskProperty.Name) }
    }
    $taskComponents = (& $taskRustup component list --installed --toolchain $taskPins.rust | Out-String)
    foreach ($taskComponent in @('rustfmt', 'clippy', 'llvm-tools')) {
        if ($taskComponents -notmatch ('(?m)^' + $taskComponent)) { throw ('Missing pinned component: ' + $taskComponent) }
    }
    & (Get-Command powershell.exe -ErrorAction Stop).Source -NoProfile -File (Join-Path $taskSetupRoot 'scripts\dev.ps1') --version
    if ($LASTEXITCODE -ne 0) { throw 'Windows/MSVC environment validation failed.' }
    $taskVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $taskVsRoot = & $taskVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    $taskCompiler = Get-ChildItem -LiteralPath (Join-Path $taskVsRoot 'VC\Tools\MSVC') -Directory | Sort-Object { [Version]$_.Name } -Descending | Select-Object -First 1
    $taskCl = Join-Path $taskCompiler.FullName 'bin\Hostx64\x64\cl.exe'
    $taskCmake = Join-Path $taskVsRoot 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
    $taskIdentity = @{
        msvc = if (Test-Path -LiteralPath $taskCl) { (Get-Item -LiteralPath $taskCl).VersionInfo.FileVersion } else { '' }
        cmake = if (Test-Path -LiteralPath $taskCmake) { (& $taskCmake --version | Select-Object -First 1) } else { '' }
        libclang = if (Test-Path -LiteralPath (Join-Path $taskClang 'libclang.dll')) { Get-CiSha256 (Join-Path $taskClang 'libclang.dll') } else { '' }
        git = (& git --version | Out-String).Trim()
        rust = (& rustc -Vv | Out-String).Trim()
        image = $env:ImageOS; image_version = $env:ImageVersion
    }
    Assert-CiCapabilities $taskIdentity | ConvertTo-Json -Depth 5
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        if($taskExtractMode){
            if(-not $ExtractArchive -or -not $ExtractDestination -or $Install -or $CheckOnly){throw 'Artifact extraction requires both paths and cannot run with Install/CheckOnly.'}
            Expand-CiZip -Archive $ExtractArchive -Destination $ExtractDestination -NoOverwrite
            [Console]::Out.WriteLine('{"status":"pass","kind":"artifact-extraction"}')
        }else{Initialize-CiWindows -InstallTools:$Install}
    }
    catch { [Console]::Error.WriteLine($_.Exception.Message); exit 2 }
}
