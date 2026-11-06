$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'ui-smoke.ps1')

function Assert-SmokeTest([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Assert-SmokeRejected([scriptblock]$Action, [string]$Message) {
    $taskRejected = $false
    try { & $Action | Out-Null } catch { $taskRejected = $true }
    if (-not $taskRejected) { throw $Message }
}
function New-TestWindow {
    @{ pid = 314; handle = 17; title = 'rustcorder'; bounds = @{ left = 0; top = 0; width = 1040; height = 880 } }
}
function New-TestControls {
    @(
        @{ name = 'Record'; role = 'ControlType.Button'; pid = 314; enabled = $true; offscreen = $false; bounds = @{ left = 20; top = 60; width = 80; height = 36 } },
        @{ name = 'Transcribe file'; role = 'ControlType.Button'; pid = 314; enabled = $true; offscreen = $false; bounds = @{ left = 110; top = 60; width = 150; height = 36 } }
    )
}

$taskTestRoot = Join-Path $taskSmokeRoot ('.build\ui-smoke-test-' + [Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($taskTestRoot) | Out-Null
$taskProbe = Join-Path $taskTestRoot 'rustcorder.exe'
$taskHash = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
[IO.File]::WriteAllBytes($taskProbe, [byte[]](97, 98, 99))
try {
    Assert-SmokeExecutable $taskProbe $taskHash '0.1.0' | Out-Null
    Assert-SmokeRejected { Assert-SmokeExecutable (Join-Path $taskTestRoot 'missing.exe') $taskHash '0.1.0' } 'Missing executable accepted.'
    Assert-SmokeRejected { Assert-SmokeExecutable $taskProbe ('0' * 64) '0.1.0' } 'Corrupt executable accepted.'
    foreach ($taskInvalidVersion in @('v0.1.0', '0.1', '01.2.3', '0.1.0 extra', '0.1.0-rc.1')) {
        Assert-SmokeRejected { Assert-SmokeExecutable $taskProbe $taskHash $taskInvalidVersion } 'Invalid stable version accepted.'
    }
    Assert-SmokeVersion @{ stdout = "rustcorder 0.1.0`r`n"; stderr = ''; exit_code = 0; timed_out = $false } '0.1.0'
    foreach ($taskProbeResult in @(
        @{ stdout = 'rustcorder 0.2.0'; stderr = ''; exit_code = 0; timed_out = $false },
        @{ stdout = "rustcorder 0.1.0`nGUI started"; stderr = ''; exit_code = 0; timed_out = $false },
        @{ stdout = 'rustcorder 0.1.0'; stderr = ''; exit_code = 7; timed_out = $false },
        @{ stdout = 'rustcorder 0.1.0'; stderr = ''; exit_code = 0; timed_out = $true }
    )) { Assert-SmokeRejected { Assert-SmokeVersion $taskProbeResult '0.1.0' } 'Invalid/hung version probe accepted.' }

    $taskCapabilities = @{ interactive = $true; input_desktop = $true; uia = $true; screenshot = $true; session_id = 1 }
    Assert-SmokeDesktop $taskCapabilities
    foreach ($taskCapability in @('interactive', 'input_desktop', 'uia', 'screenshot')) {
        $taskMissing = $taskCapabilities.Clone(); $taskMissing[$taskCapability] = $false
        Assert-SmokeRejected { Assert-SmokeDesktop $taskMissing } ('Missing desktop capability accepted: ' + $taskCapability)
        $taskMissing[$taskCapability] = 'true'
        Assert-SmokeRejected { Assert-SmokeDesktop $taskMissing } 'Nonboolean desktop proof accepted.'
    }
    $taskMissing = $taskCapabilities.Clone(); $taskMissing.session_id = 0
    Assert-SmokeRejected { Assert-SmokeDesktop $taskMissing } 'Service session accepted as interactive desktop.'

    Assert-SmokeWindow (New-TestWindow) 314
    Add-Type -AssemblyName System.Drawing
    $taskHostedWindow = New-TestWindow
    $taskHostedWindow.bounds = @{ left = 104; top = 104; width = 1040; height = 807 }
    $taskDesktop = [Drawing.Rectangle]::new(0, 0, 1024, 728)
    $taskPlacement = Get-SmokeCapturePlacement $taskHostedWindow 314 $taskDesktop
    Assert-SmokeTest ($taskDesktop.Contains($taskPlacement)) 'Hosted default window must fit the real desktop before capture.'
    Assert-SmokeTest ($taskPlacement.Width -eq 992 -and $taskPlacement.Height -eq 696) 'Fit must reserve frame room without enlarging the window.'
    $taskLargeDesktop = [Drawing.Rectangle]::new(0, 0, 1920, 1040)
    $taskUnchanged = Get-SmokeCapturePlacement $taskHostedWindow 314 $taskLargeDesktop
    Assert-SmokeTest ($taskUnchanged -eq [Drawing.Rectangle]::new(104,104,1040,807)) 'A fully visible window must retain its geometry.'
    $taskLeftDesktop = [Drawing.Rectangle]::new(-1280, -100, 1024, 728)
    Assert-SmokeTest ($taskLeftDesktop.Contains((Get-SmokeCapturePlacement $taskHostedWindow 314 $taskLeftDesktop))) 'Negative monitor origins must be preserved.'
    Assert-SmokeRejected { Get-SmokeCapturePlacement $taskHostedWindow 315 $taskDesktop } 'Placement accepted another process window.'
    Assert-SmokeRejected { Get-SmokeCapturePlacement $taskHostedWindow 314 ([Drawing.Rectangle]::new(0,0,32,32)) } 'A desktop with no bounded capture area was accepted.'
    $taskStartupPane=New-TestWindow
    $taskStartupPane.title=''
    $taskStartupPane.bounds=@{left=0;top=0;width=16;height=16}
    Assert-SmokeTest (-not (Test-SmokeApplicationWindow $taskStartupPane 314 17)) 'An owned unnamed Winit event-target pane must be deferred during startup.'
    Assert-SmokeTest (Test-SmokeApplicationWindow (New-TestWindow) 314 17) 'The exact owned rustcorder window must become ready.'
    $taskOtherTitle=New-TestWindow;$taskOtherTitle.title='another owned helper'
    Assert-SmokeTest (-not (Test-SmokeApplicationWindow $taskOtherTitle 314 17)) 'An unrelated owned window title must not certify application startup.'
    Assert-SmokeRejected { Test-SmokeApplicationWindow (New-TestWindow) 315 17 } 'A foreign UIA PID became the application window.'
    Assert-SmokeRejected { Test-SmokeApplicationWindow (New-TestWindow) 314 18 } 'A UIA HWND differing from the owned process HWND was accepted.'
    $taskWrongWindow = New-TestWindow; $taskWrongWindow.pid = 315
    Assert-SmokeRejected { Assert-SmokeWindow $taskWrongWindow 314 } 'Window from another process accepted.'
    $taskWrongWindow = New-TestWindow; $taskWrongWindow.handle = 0
    Assert-SmokeRejected { Assert-SmokeWindow $taskWrongWindow 314 } 'Missing native window accepted.'
    $taskWrongWindow = New-TestWindow; $taskWrongWindow.bounds.width = 0
    Assert-SmokeRejected { Assert-SmokeWindow $taskWrongWindow 314 } 'Empty native bounds accepted.'
    Assert-SmokeControls (New-TestControls) (New-TestWindow)
    Assert-SmokeRejected { Assert-SmokeControls @((New-TestControls)[0]) (New-TestWindow) } 'Missing tab accepted.'
    $taskBadControls = New-TestControls; $taskBadControls[1].pid = 315
    Assert-SmokeRejected { Assert-SmokeControls $taskBadControls (New-TestWindow) } 'Foreign-process tab accepted.'
    $taskBadControls = New-TestControls; $taskBadControls[1].offscreen = $true
    Assert-SmokeRejected { Assert-SmokeControls $taskBadControls (New-TestWindow) } 'Offscreen tab accepted.'
    $taskBadControls = New-TestControls; $taskBadControls[1].bounds.left = [double]::NaN
    Assert-SmokeRejected { Assert-SmokeControls $taskBadControls (New-TestWindow) } 'Invalid tab geometry accepted.'

    $taskNativeProof = @{
        schema_version = 1; kind = 'native'; completed = $true; exit_code = 0; normal_close_requested = $true
        executable_sha256 = $taskHash; version = '0.1.0'; pid = 314
        run_nonce = ('a' * 32); window = (New-TestWindow)
        capabilities = $taskCapabilities.Clone()
        started_at = '2026-11-05T12:00:00.000Z'; completed_at = '2026-11-05T12:00:01.000Z'
        navigation = @(
            @{ screen = 'Record'; landmark = 'Capture mode'; pid = 314 },
            @{ screen = 'Transcribe file'; landmark = 'No file selected'; pid = 314 },
            @{ screen = 'Record'; landmark = 'Capture mode'; pid = 314 }
        )
    }
    Assert-SmokeObservation $taskNativeProof $taskHash '0.1.0' ('a' * 32)
    $taskJsonProof = $taskNativeProof | ConvertTo-Json -Depth 10 | ConvertFrom-Json
    Assert-SmokeObservation $taskJsonProof $taskHash '0.1.0' ('a' * 32)
    foreach ($taskField in @('completed', 'normal_close_requested')) {
        $taskBadProof = $taskNativeProof.Clone(); $taskBadProof[$taskField] = $false
        Assert-SmokeRejected { Assert-SmokeObservation $taskBadProof $taskHash '0.1.0' ('a' * 32) } 'Failed native lifecycle accepted.'
    }
    $taskBadProof = $taskNativeProof.Clone(); $taskBadProof.exit_code = 9
    Assert-SmokeRejected { Assert-SmokeObservation $taskBadProof $taskHash '0.1.0' ('a' * 32) } 'Unclean native exit accepted.'
    $taskBadProof = $taskNativeProof.Clone(); $taskBadProof.navigation = @($taskNativeProof.navigation[0])
    Assert-SmokeRejected { Assert-SmokeObservation $taskBadProof $taskHash '0.1.0' ('a' * 32) } 'Missing navigation accepted.'
    $taskBadProof = $taskNativeProof.Clone(); $taskBadProof.navigation = @(
        @{ screen = 'Record'; landmark = 'Capture mode'; pid = 314 },
        @{ screen = 'Transcribe file'; landmark = 'Capture mode'; pid = 314 },
        @{ screen = 'Record'; landmark = 'Capture mode'; pid = 314 }
    )
    Assert-SmokeRejected { Assert-SmokeObservation $taskBadProof $taskHash '0.1.0' ('a' * 32) } 'Tab invocation without screen transition accepted.'
    Assert-SmokeRejected { Assert-SmokeObservation $taskNativeProof $taskHash '0.1.0' ('b' * 32) } 'Stale smoke attempt accepted.'
    $taskBadProof = $taskNativeProof.Clone(); $taskBadProof.completed_at = 'tomorrow'
    Assert-SmokeRejected { Assert-SmokeObservation $taskBadProof $taskHash '0.1.0' ('a' * 32) } 'Malformed native timestamp accepted.'
    $taskBadProof = $taskNativeProof.Clone(); $taskBadProof.pid = '314'
    Assert-SmokeRejected { Assert-SmokeObservation $taskBadProof $taskHash '0.1.0' ('a' * 32) } 'String-coerced PID accepted.'
    $taskBadProof = $taskNativeProof.Clone(); $taskBadProof.executable_sha256 = @($taskHash)
    Assert-SmokeRejected { Assert-SmokeObservation $taskBadProof $taskHash '0.1.0' ('a' * 32) } 'Array-coerced executable binding accepted.'
    Assert-SmokeRejected { Assert-SmokeClose $false $true 0 } 'No normal close request accepted.'
    Assert-SmokeRejected { Assert-SmokeClose $true $false 0 } 'Close timeout accepted.'
    Assert-SmokeRejected { Assert-SmokeClose $true $true 3 } 'Failed clean-close exit accepted.'
    Assert-SmokeClose $true $true 0
    $taskParentSettings = $env:LOCALAPPDATA
    $taskInfo = New-SmokeStartInfo $taskProbe (Join-Path $taskTestRoot 'settings') ''
    Assert-SmokeTest ($taskInfo.EnvironmentVariables['LOCALAPPDATA'] -eq (Join-Path $taskTestRoot 'settings')) 'Child settings were not isolated.'
    Assert-SmokeTest ($env:LOCALAPPDATA -eq $taskParentSettings) 'Parent settings environment changed.'
    Assert-SmokeTest (-not $taskInfo.UseShellExecute) 'Native launch must use the exact executable.'
    $taskDiagnosticsRoot = Join-Path $taskTestRoot 'diagnostics'
    [IO.Directory]::CreateDirectory($taskDiagnosticsRoot) | Out-Null
    Assert-SmokeRejected { Assert-SmokeDiagnostics $taskDiagnosticsRoot $taskNativeProof } 'Missing native diagnostics accepted.'
    Write-SmokeJson (Join-Path $taskDiagnosticsRoot 'accessibility-tree.json') @{ window = (New-TestWindow); nodes = (New-TestControls) }
    Add-Type -AssemblyName System.Drawing
    $taskImage = New-Object Drawing.Bitmap 1040, 880
    try { $taskImage.Save((Join-Path $taskDiagnosticsRoot 'window.png'), [Drawing.Imaging.ImageFormat]::Png) }
    finally { $taskImage.Dispose() }
    $taskDiagnostics = Assert-SmokeDiagnostics $taskDiagnosticsRoot $taskNativeProof
    Assert-SmokeTest ($taskDiagnostics.Count -eq 2 -and $taskDiagnostics[0].sha256 -cmatch '^[a-f0-9]{64}$') 'Native diagnostic hashes were not retained.'
    $taskDifferentWindow = New-TestWindow
    $taskDifferentWindow.bounds.width = 2048; $taskDifferentWindow.bounds.height = 1117
    Write-SmokeJson (Join-Path $taskDiagnosticsRoot 'accessibility-tree.json') @{ window = $taskDifferentWindow; nodes = (New-TestControls) }
    Assert-SmokeRejected { Assert-SmokeDiagnostics $taskDiagnosticsRoot $taskNativeProof } 'Tree from a 2048x1117 window accepted with a 1040x880 observation/screenshot.'
    $taskDifferentWindow = New-TestWindow; $taskDifferentWindow.title = 'Another rustcorder window'
    Write-SmokeJson (Join-Path $taskDiagnosticsRoot 'accessibility-tree.json') @{ window = $taskDifferentWindow; nodes = (New-TestControls) }
    Assert-SmokeRejected { Assert-SmokeDiagnostics $taskDiagnosticsRoot $taskNativeProof } 'Contradictory native window title accepted.'
    foreach ($taskDimension in @('left', 'top', 'width', 'height')) {
        $taskDifferentWindow = New-TestWindow
        $taskDifferentWindow.bounds[$taskDimension] += 1
        Write-SmokeJson (Join-Path $taskDiagnosticsRoot 'accessibility-tree.json') @{ window = $taskDifferentWindow; nodes = (New-TestControls) }
        Assert-SmokeRejected { Assert-SmokeDiagnostics $taskDiagnosticsRoot $taskNativeProof } ('Contradictory native window ' + $taskDimension + ' accepted.')
    }
    Write-SmokeJson (Join-Path $taskDiagnosticsRoot 'accessibility-tree.json') @{ window = (New-TestWindow); nodes = (New-TestControls) }
    $taskImage = New-Object Drawing.Bitmap 1, 1
    try { $taskImage.Save((Join-Path $taskDiagnosticsRoot 'window.png'), [Drawing.Imaging.ImageFormat]::Png) }
    finally { $taskImage.Dispose() }
    Assert-SmokeRejected { Assert-SmokeDiagnostics $taskDiagnosticsRoot $taskNativeProof } 'Screenshot for another window size accepted.'
    if ($PSVersionTable.PSVersion.Major -ge 7) {
        $taskOriginalWorker = $taskSmokeScript
        $taskSmokeScript = Join-Path $taskTestRoot 'hung-worker.ps1'
        [IO.File]::WriteAllText($taskSmokeScript, 'Start-Sleep -Seconds 30', $taskSmokeUtf8)
        try {
            $taskWatch = [Diagnostics.Stopwatch]::StartNew()
            $taskCode = Invoke-NativeSmoke $taskProbe $taskHash '0.1.0' (Join-Path $taskTestRoot 'watchdog') 1
            $taskWatch.Stop()
            Assert-SmokeTest ($taskCode -eq 2 -and $taskWatch.ElapsedMilliseconds -lt 12000) 'Native worker timeout was not bounded.'
            $taskTimeoutProof = Get-Content -LiteralPath (Join-Path $taskTestRoot 'watchdog/native-smoke.json') -Raw | ConvertFrom-Json
            Assert-SmokeTest ($taskTimeoutProof.status -eq 'incomplete' -and -not $taskTimeoutProof.completed) 'Timed-out worker fabricated native success.'
        } finally { $taskSmokeScript = $taskOriginalWorker }
    }
    Write-Output 'Native-smoke boundary checks passed: identity, desktop, PID/tabs, navigation, close and child settings.'
} finally {
    $taskResolved = [IO.Path]::GetFullPath($taskTestRoot)
    $taskExpectedParent = [IO.Path]::GetFullPath((Join-Path $taskSmokeRoot '.build')) + [IO.Path]::DirectorySeparatorChar
    if (-not $taskResolved.StartsWith($taskExpectedParent, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing cleanup outside the owned test directory.' }
    Remove-Item -LiteralPath $taskResolved -Recurse -Force
}
