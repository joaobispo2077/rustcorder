$ErrorActionPreference = 'Stop'
$taskScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'setup-windows.ps1'
if (-not (Test-Path -LiteralPath $taskScript)) { throw 'Windows provisioning contract is absent.' }
. $taskScript
function Assert-Rejected([scriptblock]$Action, [string]$Message) {
    $taskRejected = $false
    try { & $Action | Out-Null } catch { $taskRejected = $true }
    if (-not $taskRejected) { throw $Message }
}
foreach ($taskPath in @('../escape', '/root', 'C:\outside', 'folder/../x', 'CON.txt', 'bad:stream')) {
    Assert-Rejected { Assert-CiRelativePath $taskPath } ('Unsafe asset entry accepted: ' + $taskPath)
}
if ((Assert-CiRelativePath 'clang/native/libclang.dll') -ne 'clang/native/libclang.dll') {
    throw 'Valid asset-relative path was rejected.'
}
$taskMissing = Join-Path $PSScriptRoot 'not-a-real-downloaded-tool.zip'
Assert-Rejected { Assert-CiFileHash $taskMissing ('0' * 64) } 'Missing tool must fail hash verification.'
$taskProbe = Join-Path ([IO.Path]::GetTempPath()) ('rustcorder-ci-hash-' + [Guid]::NewGuid().ToString('N'))
[IO.File]::WriteAllBytes($taskProbe, [byte[]](97, 98, 99))
try {
    $taskHash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    Assert-CiFileHash $taskProbe $taskHash | Out-Null
    Assert-Rejected { Assert-CiFileHash $taskProbe ('0' * 64) } 'Corrupt archive must not pass.'
} finally {
    Remove-Item -LiteralPath $taskProbe
}
Write-Output 'Windows setup boundary checks passed.'
foreach ($taskMissingCapability in @('msvc', 'cmake', 'libclang', 'git', 'rust')) {
    $taskCapabilities = @{ msvc = 'compiler'; cmake = 'cmake'; libclang = 'clang'; git = 'git'; rust = 'rustc' }
    $taskCapabilities.Remove($taskMissingCapability)
    Assert-Rejected { Assert-CiCapabilities $taskCapabilities } ('Missing prerequisite accepted: ' + $taskMissingCapability)
}
$taskCapabilities = @{ msvc = 'compiler'; cmake = 'cmake'; libclang = 'clang'; git = 'git'; rust = 'rustc' }
Assert-CiCapabilities $taskCapabilities | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$taskProbeRoot = Join-Path $taskSetupRoot ('.build/setup-test-' + [Guid]::NewGuid().ToString('N'))
$taskExternal = Join-Path ([IO.Path]::GetTempPath()) ('ci-redirect-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($taskProbeRoot) | Out-Null
[IO.Directory]::CreateDirectory($taskExternal) | Out-Null
$taskZipPath = Join-Path $taskProbeRoot 'probe.zip'
$taskZip = [IO.Compression.ZipFile]::Open($taskZipPath, [IO.Compression.ZipArchiveMode]::Create)
$taskEntry = $taskZip.CreateEntry('probe.txt')
$taskWriter = New-Object IO.StreamWriter($taskEntry.Open())
$taskWriter.Write('probe'); $taskWriter.Dispose(); $taskZip.Dispose()
$taskLink = Join-Path $taskProbeRoot 'redirect'
try {
    $taskLinkType=if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT){'Junction'}else{'SymbolicLink'}
    New-Item -ItemType $taskLinkType -Path $taskLink -Target $taskExternal | Out-Null
    Assert-Rejected { Expand-CiZip $taskZipPath $taskLink } 'A redirected extraction directory escaped .build.'
} finally {
    if (Test-Path -LiteralPath $taskLink) { [IO.Directory]::Delete($taskLink) }
    Remove-Item -LiteralPath $taskZipPath
    if (Test-Path -LiteralPath (Join-Path $taskExternal 'probe.txt')) { Remove-Item -LiteralPath (Join-Path $taskExternal 'probe.txt') }
    [IO.Directory]::Delete($taskExternal)
    [IO.Directory]::Delete($taskProbeRoot)
}

$taskArchiveRoot=Join-Path $taskSetupRoot ('.build/setup-archives-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($taskArchiveRoot) | Out-Null
function New-SetupArchive([string[]]$Names) {
    $path=Join-Path $taskArchiveRoot ([Guid]::NewGuid().ToString('N')+'.zip')
    $zip=[IO.Compression.ZipFile]::Open($path,[IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach($name in $Names){$entry=$zip.CreateEntry($name);if(-not $name.EndsWith('/')){$stream=$entry.Open();try{$stream.WriteByte(1)}finally{$stream.Dispose()}}}
    } finally {$zip.Dispose()}
    return $path
}
function Invoke-SetupExtraction([string[]]$Arguments) {
    . (Join-Path (Split-Path -Parent $PSScriptRoot) 'ci.ps1')
    return Invoke-CiChild -FilePath ([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName) -Arguments (@('-NoProfile','-File',$taskScript)+$Arguments) -WorkingDirectory $taskSetupRoot -TimeoutSeconds 15
}
try {
    $valid=New-SetupArchive @('native/','native/proof.json','package.zip')
    $target=Join-Path $taskArchiveRoot 'fresh'
    Expand-CiZip $valid $target -NoOverwrite
    [IO.File]::WriteAllText((Join-Path $target 'package.zip'),'keep this existing file')
    Assert-Rejected { Expand-CiZip $valid $target -NoOverwrite } 'Artifact extraction overwrote an existing destination.'
    if([IO.File]::ReadAllText((Join-Path $target 'package.zip')) -cne 'keep this existing file'){throw 'Rejected extraction changed an existing file.'}
    Expand-CiZip $valid $target
    if((Get-Item (Join-Path $target 'package.zip')).Length -ne 1){throw 'Trusted tool re-extraction stopped replacing an existing file.'}
    foreach($names in @(
        @('../escape'),@('/root'),@('C:\outside'),@('native/../escape'),@('native\..\escape'),@('CON.txt'),
        @('x','x'),@('x','X'),@('Dir/a','dir/b'),@('x','x/child'),@('dir//')
    )){
        $bad=New-SetupArchive $names
        Assert-Rejected { Expand-CiZip $bad (Join-Path $taskArchiveRoot ([Guid]::NewGuid().ToString('N'))) -NoOverwrite } 'An unsafe/duplicate/conflicting artifact path was accepted.'
    }
    foreach($flag in @(-1610612736,1024)){
        $bad=New-SetupArchive @('link');$zip=[IO.Compression.ZipFile]::Open($bad,[IO.Compression.ZipArchiveMode]::Update)
        try{$zip.Entries[0].ExternalAttributes=$flag}finally{$zip.Dispose()}
        Assert-Rejected { Expand-CiZip $bad (Join-Path $taskArchiveRoot ([Guid]::NewGuid().ToString('N'))) -NoOverwrite } 'A symlink/reparse artifact member was accepted.'
    }
    foreach($bound in @('count','entry','actual-stream')){
        $bad=New-SetupArchive @('bounded');$raw=[IO.File]::ReadAllBytes($bad);$end=$raw.Length-22
        if($bound -ceq 'count'){
            [BitConverter]::GetBytes([uint16]10001).CopyTo($raw,$end+8);[BitConverter]::GetBytes([uint16]10001).CopyTo($raw,$end+10)
        }else{
            $central=[BitConverter]::ToUInt32($raw,$end+16)
            $length=if($bound -ceq 'entry'){[uint32]268435457}else{[uint32]2}
            [BitConverter]::GetBytes($length).CopyTo($raw,[int]$central+24)
        }
        [IO.File]::WriteAllBytes($bad,$raw)
        Assert-Rejected { Expand-CiZip $bad (Join-Path $taskArchiveRoot ([Guid]::NewGuid().ToString('N'))) -NoOverwrite } ('Artifact bound was not enforced: '+$bound)
    }
    $cliTarget=Join-Path $taskArchiveRoot 'cli'
    $cli=Invoke-SetupExtraction @('-ExtractArchive',$valid,'-ExtractDestination',$cliTarget)
    if($cli.timed_out -or $cli.exit_code -ne 0 -or $cli.stderr -or ($cli.stdout|ConvertFrom-Json).kind -cne 'artifact-extraction'){throw 'Portable extraction CLI did not bypass Windows provisioning.'}
    foreach($arguments in @(
        @('-ExtractArchive',$valid,'-ExtractDestination',$cliTarget),
        @('-ExtractArchive',$valid),
        @('-ExtractArchive',$valid,'-ExtractDestination',(Join-Path $taskArchiveRoot 'install'),'-Install'),
        @('-ExtractArchive',$valid,'-ExtractDestination',(Join-Path $taskArchiveRoot 'check'),'-CheckOnly')
    )){
        $cli=Invoke-SetupExtraction $arguments
        if($cli.timed_out -or $cli.exit_code -eq 0 -or $cli.stdout){throw 'Invalid/overwriting extraction CLI emitted success.'}
    }
    Write-Output 'Portable artifact extraction boundary checks passed.'
}finally{
    $full=[IO.Path]::GetFullPath($taskArchiveRoot);$boundary=[IO.Path]::GetFullPath((Join-Path $taskSetupRoot '.build'))+[IO.Path]::DirectorySeparatorChar
    if(-not $full.StartsWith($boundary,[StringComparison]::OrdinalIgnoreCase) -or ((Get-Item -LiteralPath $full).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Unsafe setup fixture cleanup.'}
    Remove-Item -LiteralPath $full -Recurse -Force
}
