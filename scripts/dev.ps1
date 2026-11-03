$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLocalCargo = Join-Path $taskRoot '.build\cargo\bin\cargo.exe'
if (Test-Path -LiteralPath $taskLocalCargo) {
    $env:CARGO_HOME = Join-Path $taskRoot '.build\cargo'
    $env:RUSTUP_HOME = Join-Path $taskRoot '.build\rustup'
    $env:PATH = (Split-Path -Parent $taskLocalCargo) + ';' + $env:PATH
    $taskCargo = $taskLocalCargo
} else {
    $taskCargo = (Get-Command cargo -ErrorAction Stop).Source
}

$taskVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $taskVswhere)) {
    throw 'Visual Studio C++ Build Tools discovery is unavailable. Install the Windows C++ workload first.'
}
$taskVsRoot = & $taskVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $taskVsRoot) { throw 'Visual Studio C++ Build Tools were not found.' }
$taskDevCmd = Join-Path $taskVsRoot 'Common7\Tools\VsDevCmd.bat'
$taskDevInvocation = 'call "{0}" -arch=x64 -host_arch=x64 >nul && set' -f $taskDevCmd
$taskEnvironment = & cmd.exe /d /c $taskDevInvocation
if ($LASTEXITCODE -ne 0) { throw 'Could not initialize the MSVC developer environment.' }
foreach ($taskLine in $taskEnvironment) {
    if ($taskLine -match '^([^=]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
$taskCmakeBin = Join-Path $taskVsRoot 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin'
if (Test-Path -LiteralPath $taskCmakeBin) { $env:PATH = $taskCmakeBin + ';' + $env:PATH }
# The bundled sys bindings contain Linux layouts; generate Windows bindings instead.
Remove-Item Env:\WHISPER_DONT_GENERATE_BINDINGS -ErrorAction SilentlyContinue
$taskClang = Join-Path $taskRoot '.build\python-deps\clang\native'
if (Test-Path -LiteralPath (Join-Path $taskClang 'libclang.dll')) {
    $env:LIBCLANG_PATH = $taskClang
}
$env:GGML_NATIVE = 'OFF'
$env:MSBUILDDISABLENODEREUSE = '1'
$env:CMAKE_POLICY_DEFAULT_CMP0091 = 'NEW'
$env:CMAKE_MSVC_RUNTIME_LIBRARY = 'MultiThreaded'

Push-Location -LiteralPath $taskRoot
try {
    & $taskCargo @args
    $taskExit = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $taskExit
