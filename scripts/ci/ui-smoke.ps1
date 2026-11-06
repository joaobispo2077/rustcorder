[CmdletBinding()]
param(
    [string]$Executable,
    [string]$ExpectedSha256,
    [string]$Version,
    [string]$EvidenceDirectory,
    [ValidateRange(5, 120)][int]$TimeoutSeconds = 60,
    [switch]$Worker,
    [string]$RunNonce
)

$ErrorActionPreference = 'Stop'
$taskSmokeRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$taskSmokeScript = $PSCommandPath
$taskSmokeUtf8 = New-Object Text.UTF8Encoding($false)

function Get-SmokeHash([string]$Path) {
    $taskAlgorithm = [Security.Cryptography.SHA256]::Create()
    $taskStream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($taskAlgorithm.ComputeHash($taskStream)).Replace('-', '').ToLowerInvariant() }
    finally { $taskStream.Dispose(); $taskAlgorithm.Dispose() }
}

function Assert-SmokeExecutable([string]$Path, [string]$Hash, [string]$ProductVersion) {
    if ($Hash -cnotmatch '^[a-f0-9]{64}$' -or $ProductVersion -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw 'Invalid executable hash/stable version binding.' }
    $taskFull = [IO.Path]::GetFullPath($Path)
    $taskAllowed = [IO.Path]::GetFullPath($taskSmokeRoot) + [IO.Path]::DirectorySeparatorChar
    if (-not $taskFull.StartsWith($taskAllowed, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $taskFull -PathType Leaf) -or [IO.Path]::GetExtension($taskFull) -ine '.exe') { throw 'Packaged executable must be an existing executable in this checkout.' }
    $taskAncestor = $taskFull
    while ($taskAncestor.Length -ge $taskSmokeRoot.Length) {
        if ((Get-Item -LiteralPath $taskAncestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected executable paths are forbidden.' }
        $taskAncestor = Split-Path -Parent $taskAncestor
    }
    if ((Get-SmokeHash $taskFull) -cne $Hash) { throw 'Packaged executable SHA-256 mismatch.' }
    return $taskFull
}

function Assert-SmokeVersion($Probe, [string]$ProductVersion) {
    if ($Probe.timed_out -isnot [bool] -or $Probe.timed_out -or -not (Test-SmokeInteger $Probe.exit_code 0 0) -or $Probe.stdout -isnot [string] -or $Probe.stderr -isnot [string] -or $Probe.stdout.Trim() -cne ('rustcorder ' + $ProductVersion) -or $Probe.stderr.Trim()) { throw 'Bounded executable version probe did not match the packaged version.' }
}

function Test-SmokeInteger($Value, [long]$Minimum = 0, [long]$Maximum = [int]::MaxValue) {
    return ($Value -is [int] -or $Value -is [long] -or $Value -is [uint32] -or $Value -is [uint64] -or $Value -is [int16] -or $Value -is [byte]) -and $Value -ge $Minimum -and $Value -le $Maximum
}

function Assert-SmokeDesktop($Capabilities) {
    foreach ($taskCapability in @('interactive', 'input_desktop', 'uia', 'screenshot')) {
        $taskValue = $Capabilities.$taskCapability
        if ($taskValue -isnot [bool] -or -not $taskValue) { throw ('Native desktop capability is unavailable: ' + $taskCapability) }
    }
    if (-not (Test-SmokeInteger $Capabilities.session_id 1)) { throw 'An interactive, non-service desktop session is required.' }
}

function Assert-SmokeWindow($Window, [int]$OwnProcessId) {
    if ($OwnProcessId -lt 1 -or -not (Test-SmokeInteger $Window.pid 1) -or $Window.pid -ne $OwnProcessId -or -not (Test-SmokeInteger $Window.handle 1 ([long]::MaxValue)) -or $Window.title -isnot [string] -or -not $Window.title -or $Window.title.Length -gt 1024) { throw 'Missing or foreign native process/window identity.' }
    foreach ($taskDimension in @('left', 'top', 'width', 'height')) {
        $taskValue = $Window.bounds.$taskDimension
        if ($null -eq $taskValue -or $taskValue -is [bool] -or $taskValue -is [string] -or [double]::IsNaN($taskValue) -or [double]::IsInfinity($taskValue)) { throw 'Invalid native window bounds.' }
        if ($taskDimension -in @('width', 'height') -and ($taskValue -le 0 -or $taskValue -gt 8192)) { throw 'Native window dimensions are outside the bound.' }
    }
}

function Assert-SmokeControls([object[]]$Controls, $Window) {
    Assert-SmokeWindow $Window ([int]$Window.pid)
    foreach ($taskName in @('Record', 'Transcribe file')) {
        $taskMatches = @($Controls | Where-Object { $_.name -ceq $taskName -and $_.role -ceq 'ControlType.Button' })
        if ($taskMatches.Count -ne 1) { throw ('Missing/ambiguous native tab: ' + $taskName) }
        $taskControl = $taskMatches[0]
        if ($taskControl.name -isnot [string] -or $taskControl.role -isnot [string]) { throw 'Native tab names/roles must be strings.' }
        Assert-SmokeWindow @{ pid = $taskControl.pid; handle = $Window.handle; title = $taskName; bounds = $taskControl.bounds } ([int]$Window.pid)
        if ($taskControl.pid -ne $Window.pid -or $taskControl.enabled -isnot [bool] -or -not $taskControl.enabled -or $taskControl.offscreen -isnot [bool] -or $taskControl.offscreen -or $taskControl.bounds.width -le 0 -or $taskControl.bounds.height -le 0) { throw ('Native tab is foreign, disabled or invisible: ' + $taskName) }
        if ($taskControl.bounds.left -lt $Window.bounds.left -or $taskControl.bounds.top -lt $Window.bounds.top -or $taskControl.bounds.left + $taskControl.bounds.width -gt $Window.bounds.left + $Window.bounds.width + 1 -or $taskControl.bounds.top + $taskControl.bounds.height -gt $Window.bounds.top + $Window.bounds.height + 1) { throw 'Native tab is outside its owned window.' }
    }
}

function Assert-SmokeClose([bool]$Requested, [bool]$Exited, [int]$ExitCode) {
    if (-not $Requested -or -not $Exited -or $ExitCode -ne 0) { throw 'Packaged application did not close normally within the bound.' }
}

function Assert-SmokeObservation($Proof, [string]$Hash, [string]$ProductVersion, [string]$Nonce) {
    if (-not (Test-SmokeInteger $Proof.schema_version 1 1) -or $Proof.kind -isnot [string] -or $Proof.kind -cne 'native' -or $Proof.completed -isnot [bool] -or -not $Proof.completed -or $Proof.normal_close_requested -isnot [bool] -or -not (Test-SmokeInteger $Proof.exit_code 0 0) -or -not (Test-SmokeInteger $Proof.pid 1) -or $Proof.executable_sha256 -isnot [string] -or $Proof.executable_sha256 -cne $Hash -or $Proof.version -isnot [string] -or $Proof.version -cne $ProductVersion -or $Proof.run_nonce -isnot [string] -or $Proof.run_nonce -cne $Nonce -or $Nonce -cnotmatch '^[a-f0-9]{32}$') { throw 'Missing, stale or mismatched native observation.' }
    Assert-SmokeDesktop $Proof.capabilities
    Assert-SmokeWindow $Proof.window ([int]$Proof.pid)
    Assert-SmokeClose $Proof.normal_close_requested $Proof.completed ([int]$Proof.exit_code)
    $taskScreens = @('Record', 'Transcribe file', 'Record')
    $taskLandmarks = @('Capture mode', 'No file selected', 'Capture mode')
    if (@($Proof.navigation).Count -ne 3) { throw 'Incomplete native navigation.' }
    for ($taskIndex = 0; $taskIndex -lt 3; $taskIndex++) {
        $taskStep = $Proof.navigation[$taskIndex]
        if ($taskStep.screen -isnot [string] -or $taskStep.landmark -isnot [string] -or -not (Test-SmokeInteger $taskStep.pid 1) -or $taskStep.screen -cne $taskScreens[$taskIndex] -or $taskStep.landmark -cne $taskLandmarks[$taskIndex] -or $taskStep.pid -ne $Proof.pid) { throw 'Native navigation did not reach the intended screen in its own process.' }
    }
    $taskTimestamps = @(
        foreach ($taskTimestamp in @($Proof.started_at, $Proof.completed_at)) {
            # Current PowerShell JSON parsing materializes ISO timestamps as DateTime.
            if ($taskTimestamp -is [DateTime] -and $taskTimestamp.Kind -eq [DateTimeKind]::Utc) { $taskTimestamp.ToString('o') }
            elseif ($taskTimestamp -is [string] -and $taskTimestamp -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$') { $taskTimestamp }
            else { throw 'Native observation needs UTC timestamps.' }
        }
    )
    $taskStart = [DateTimeOffset]::Parse($taskTimestamps[0], [Globalization.CultureInfo]::InvariantCulture)
    $taskEnd = [DateTimeOffset]::Parse($taskTimestamps[1], [Globalization.CultureInfo]::InvariantCulture)
    if ($taskEnd -lt $taskStart) { throw 'Native observation timestamps are inconsistent.' }
}

function New-SmokeStartInfo([string]$Path, [string]$SettingsDirectory, [string]$Arguments) {
    $taskInfo = New-Object Diagnostics.ProcessStartInfo
    $taskInfo.FileName = $Path; $taskInfo.Arguments = $Arguments
    $taskInfo.WorkingDirectory = Split-Path -Parent $Path
    $taskInfo.UseShellExecute = $false
    $taskInfo.CreateNoWindow = $false
    $taskInfo.EnvironmentVariables['LOCALAPPDATA'] = $SettingsDirectory
    $taskInfo.RedirectStandardOutput = $true; $taskInfo.RedirectStandardError = $true
    $taskInfo.StandardOutputEncoding = $taskSmokeUtf8; $taskInfo.StandardErrorEncoding = $taskSmokeUtf8
    return $taskInfo
}

function Write-SmokeJson([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 12), $taskSmokeUtf8)
}

function New-SmokeEvidenceRoot([string]$Path) {
    . (Join-Path $PSScriptRoot 'setup-windows.ps1')
    $taskRoot = Assert-CiOwnedDirectory $Path
    if (Test-Path -LiteralPath $taskRoot) { throw 'Native-smoke evidence already exists; use a fresh directory.' }
    [IO.Directory]::CreateDirectory($taskRoot) | Out-Null
    return $taskRoot
}

function Get-SmokeDesktop {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) { throw 'Native smoke requires Windows.' }
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    Add-Type -AssemblyName System.Drawing
    Add-Type -AssemblyName System.Windows.Forms
    if (-not ('RustcorderCi.InputDesktop' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace RustcorderCi {
    public static class InputDesktop {
        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool CloseDesktop(IntPtr desktop);
        public static bool Available() {
            var desktop = OpenInputDesktop(0, false, 0x0001);
            if (desktop == IntPtr.Zero) return false;
            return CloseDesktop(desktop);
        }
    }
}
'@
    }
    $taskScreen = [Windows.Forms.SystemInformation]::VirtualScreen
    $taskCapabilities = @{
        interactive = [Environment]::UserInteractive
        input_desktop = [RustcorderCi.InputDesktop]::Available()
        uia = $null -ne [Windows.Automation.AutomationElement]::RootElement
        screenshot = $taskScreen.Width -gt 0 -and $taskScreen.Height -gt 0
        session_id = [Diagnostics.Process]::GetCurrentProcess().SessionId
    }
    Assert-SmokeDesktop $taskCapabilities
    return $taskCapabilities
}

function Stop-SmokeOwnedProcess([Diagnostics.Process]$Process) {
    try { $taskExited = $Process.HasExited }
    catch [InvalidOperationException] { return }
    if (-not $taskExited) {
        $Process.Kill($true)
        if (-not $Process.WaitForExit(5000)) { throw 'Owned native process did not terminate during cleanup.' }
    }
}

function Invoke-SmokeVersionProbe([string]$Path, [string]$SettingsDirectory) {
    $taskProcess = New-Object Diagnostics.Process
    $taskProcess.StartInfo = New-SmokeStartInfo $Path $SettingsDirectory '--version'
    $taskProcess.StartInfo.CreateNoWindow = $true
    try {
        if (-not $taskProcess.Start()) { throw 'Could not start packaged version probe.' }
        $taskOut = $taskProcess.StandardOutput.ReadToEndAsync()
        $taskErr = $taskProcess.StandardError.ReadToEndAsync()
        $taskTimedOut = -not $taskProcess.WaitForExit(5000)
        if ($taskTimedOut) { Stop-SmokeOwnedProcess $taskProcess }
        if (-not $taskOut.Wait(1000) -or -not $taskErr.Wait(1000)) { throw 'Version probe output did not close.' }
        return @{ stdout = $taskOut.Result; stderr = $taskErr.Result; exit_code = $taskProcess.ExitCode; timed_out = $taskTimedOut }
    } finally {
        Stop-SmokeOwnedProcess $taskProcess
        $taskProcess.Dispose()
    }
}

function Get-SmokeWindowData($Element) {
    $taskCurrent = $Element.Current
    $taskBounds = $taskCurrent.BoundingRectangle
    return @{
        pid = $taskCurrent.ProcessId; handle = $taskCurrent.NativeWindowHandle
        title = $taskCurrent.Name
        bounds = @{ left = $taskBounds.Left; top = $taskBounds.Top; width = $taskBounds.Width; height = $taskBounds.Height }
    }
}

function Get-SmokeTree($Element, [int]$OwnProcessId) {
    $taskWindow = Get-SmokeWindowData $Element
    Assert-SmokeWindow $taskWindow $OwnProcessId
    $taskElements = $Element.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)
    if ($taskElements.Count -gt 2048) { throw 'Native accessibility tree exceeded its bounded inventory.' }
    $taskNodes = @(
        foreach ($taskElement in $taskElements) {
            $taskCurrent = $taskElement.Current
            if ($taskCurrent.ProcessId -ne $OwnProcessId) { throw 'Foreign process appeared in the native accessibility tree.' }
            if ($taskCurrent.Name.Length -gt 4096) { throw 'Native accessibility label exceeded its bound.' }
            $taskBounds = $taskCurrent.BoundingRectangle
            @{
                name = $taskCurrent.Name; role = $taskCurrent.ControlType.ProgrammaticName
                pid = $taskCurrent.ProcessId; enabled = $taskCurrent.IsEnabled; offscreen = $taskCurrent.IsOffscreen
                bounds = @{ left = $taskBounds.Left; top = $taskBounds.Top; width = $taskBounds.Width; height = $taskBounds.Height }
            }
        }
    )
    return @{ window = $taskWindow; nodes = $taskNodes }
}

function Test-SmokeApplicationWindow($Window, [int]$OwnProcessId, [long]$NativeHandle) {
    if ($OwnProcessId -lt 1 -or -not (Test-SmokeInteger $Window.pid 1) -or $Window.pid -ne $OwnProcessId -or
        -not (Test-SmokeInteger $Window.handle 1 ([long]::MaxValue)) -or $NativeHandle -lt 1 -or $Window.handle -ne $NativeHandle) { throw 'UIA startup window does not match the launched process HWND/PID.' }
    if ($Window.title -isnot [string] -or $Window.title.Length -gt 1024) { throw 'Invalid native application window title.' }
    # Winit briefly exposes an owned unnamed event-target pane before the app window.
    if ($Window.title -cne 'rustcorder') { return $false }
    Assert-SmokeWindow $Window $OwnProcessId
    return $true
}

function Wait-SmokeWindow([Diagnostics.Process]$Process, [DateTime]$Deadline) {
    do {
        $Process.Refresh()
        if ($Process.HasExited) { throw 'Packaged process exited before its native window became accessible.' }
        $taskHandle = $Process.MainWindowHandle
        if ($taskHandle -ne [IntPtr]::Zero) {
            $taskElement = [Windows.Automation.AutomationElement]::FromHandle($taskHandle)
            if ($null -ne $taskElement) {
                if (Test-SmokeApplicationWindow (Get-SmokeWindowData $taskElement) $Process.Id $taskHandle.ToInt64()) { return $taskElement }
            }
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $Deadline)
    throw 'Native window/accessibility startup timed out.'
}

function Wait-SmokeElement($Root, [string]$Name, [int]$OwnProcessId, [DateTime]$Deadline, [switch]$Button) {
    do {
        $taskCondition = New-Object Windows.Automation.PropertyCondition ([Windows.Automation.AutomationElement]::NameProperty), $Name
        $taskElements = $Root.FindAll([Windows.Automation.TreeScope]::Descendants, $taskCondition)
        $taskMatches = @(
            foreach ($taskElement in $taskElements) {
                $taskCurrent = $taskElement.Current
                if ($taskCurrent.ProcessId -ne $OwnProcessId) { throw 'Native navigation resolved a foreign-process element.' }
                if (-not $taskCurrent.IsOffscreen -and (-not $Button -or $taskCurrent.ControlType -eq [Windows.Automation.ControlType]::Button)) { $taskElement }
            }
        )
        if ($taskMatches.Count -gt 0) {
            if ($Button -and $taskMatches.Count -ne 1) { throw 'Native tab resolved more than one button.' }
            return $taskMatches[0]
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $Deadline)
    throw ('Native screen/control was not reached: ' + $Name)
}

function Save-SmokeScreenshot($Window, [string]$Path) {
    $taskLeft = [int][Math]::Floor($Window.bounds.left)
    $taskTop = [int][Math]::Floor($Window.bounds.top)
    $taskWidth = [int][Math]::Ceiling($Window.bounds.width)
    $taskHeight = [int][Math]::Ceiling($Window.bounds.height)
    $taskScreen = [Windows.Forms.SystemInformation]::VirtualScreen
    $taskRectangle = New-Object Drawing.Rectangle $taskLeft, $taskTop, $taskWidth, $taskHeight
    if (-not $taskScreen.Contains($taskRectangle)) { throw 'Native window is outside the capturable desktop.' }
    $taskImage = New-Object Drawing.Bitmap $taskWidth, $taskHeight
    $taskGraphics = [Drawing.Graphics]::FromImage($taskImage)
    try {
        $taskGraphics.CopyFromScreen($taskLeft, $taskTop, 0, 0, $taskImage.Size)
        $taskImage.Save($Path, [Drawing.Imaging.ImageFormat]::Png)
    } finally { $taskGraphics.Dispose(); $taskImage.Dispose() }
}

function Invoke-SmokeCore([string]$Path, [string]$Hash, [string]$ProductVersion, [string]$OutputDirectory, [int]$Seconds, [string]$Nonce) {
    . (Join-Path $PSScriptRoot 'setup-windows.ps1')
    $OutputDirectory = Assert-CiOwnedDirectory $OutputDirectory
    if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container) -or @(Get-ChildItem -LiteralPath $OutputDirectory -Force).Count -ne 0) { throw 'Internal native worker needs the fresh owned evidence directory.' }
    $taskStarted = [DateTime]::UtcNow
    $taskDeadline = $taskStarted.AddSeconds($Seconds - 2)
    $taskExecutable = Assert-SmokeExecutable $Path $Hash $ProductVersion
    $taskSettings = Join-Path $OutputDirectory 'settings'
    if (Test-Path -LiteralPath $taskSettings) { throw 'Native smoke requires a new empty settings root.' }
    [IO.Directory]::CreateDirectory($taskSettings) | Out-Null
    $taskProbe = Invoke-SmokeVersionProbe $taskExecutable $taskSettings
    [IO.File]::WriteAllText((Join-Path $OutputDirectory 'version.stdout.log'), $taskProbe.stdout, $taskSmokeUtf8)
    [IO.File]::WriteAllText((Join-Path $OutputDirectory 'version.stderr.log'), $taskProbe.stderr, $taskSmokeUtf8)
    Assert-SmokeVersion $taskProbe $ProductVersion
    $taskCapabilities = Get-SmokeDesktop
    $taskProcess = New-Object Diagnostics.Process
    $taskProcess.StartInfo = New-SmokeStartInfo $taskExecutable $taskSettings ''
    $taskWindow = $null
    try {
        if (-not $taskProcess.Start()) { throw 'Could not launch the packaged native application.' }
        $taskOut = $taskProcess.StandardOutput.ReadToEndAsync()
        $taskErr = $taskProcess.StandardError.ReadToEndAsync()
        $taskWindow = Wait-SmokeWindow $taskProcess $taskDeadline
        $taskTree = Get-SmokeTree $taskWindow $taskProcess.Id
        Assert-SmokeControls $taskTree.nodes $taskTree.window
        $taskNavigation = @()
        foreach ($taskScreen in @(
            @{ name = 'Record'; landmark = 'Capture mode' },
            @{ name = 'Transcribe file'; landmark = 'No file selected' },
            @{ name = 'Record'; landmark = 'Capture mode' }
        )) {
            $taskTab = Wait-SmokeElement $taskWindow $taskScreen.name $taskProcess.Id $taskDeadline -Button
            if (-not $taskTab.Current.IsEnabled) { throw 'Native tab is disabled.' }
            $taskPattern = $taskTab.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
            $taskPattern.Invoke()
            $taskLandmark = Wait-SmokeElement $taskWindow $taskScreen.landmark $taskProcess.Id $taskDeadline
            $taskNavigation += @{ screen = $taskScreen.name; landmark = $taskLandmark.Current.Name; pid = $taskProcess.Id }
        }
        $taskTree = Get-SmokeTree $taskWindow $taskProcess.Id
        Assert-SmokeControls $taskTree.nodes $taskTree.window
        Write-SmokeJson (Join-Path $OutputDirectory 'accessibility-tree.json') $taskTree
        Save-SmokeScreenshot $taskTree.window (Join-Path $OutputDirectory 'window.png')
        $taskRequested = $taskProcess.CloseMainWindow()
        $taskRemaining = [Math]::Min(10000, [Math]::Max(1, ($taskDeadline - [DateTime]::UtcNow).TotalMilliseconds))
        $taskExited = $taskProcess.WaitForExit([int]$taskRemaining)
        $taskExitCode = if ($taskExited) { $taskProcess.ExitCode } else { -1 }
        Assert-SmokeClose $taskRequested $taskExited $taskExitCode
        if (-not $taskOut.Wait(1000) -or -not $taskErr.Wait(1000)) { throw 'Native application output did not close.' }
        [IO.File]::WriteAllText((Join-Path $OutputDirectory 'app.stdout.log'), $taskOut.Result, $taskSmokeUtf8)
        [IO.File]::WriteAllText((Join-Path $OutputDirectory 'app.stderr.log'), $taskErr.Result, $taskSmokeUtf8)
        Assert-SmokeExecutable $taskExecutable $Hash $ProductVersion | Out-Null
        return @{
            schema_version = 1; kind = 'native'; completed = $true; exit_code = $taskExitCode
            normal_close_requested = $taskRequested; run_nonce = $Nonce; pid = $taskProcess.Id
            executable_sha256 = $Hash; version = $ProductVersion; window = $taskTree.window
            started_at = $taskStarted.ToString('o'); completed_at = [DateTime]::UtcNow.ToString('o')
            navigation = $taskNavigation; capabilities = $taskCapabilities
            platform = [Environment]::OSVersion.VersionString
        }
    } catch {
        if ($null -ne $taskWindow) {
            try {
                $taskTree = Get-SmokeTree $taskWindow $taskProcess.Id
                Write-SmokeJson (Join-Path $OutputDirectory 'accessibility-tree.json') $taskTree
                Save-SmokeScreenshot $taskTree.window (Join-Path $OutputDirectory 'window.png')
            } catch { }
        }
        throw
    } finally {
        Stop-SmokeOwnedProcess $taskProcess
        $taskProcess.Dispose()
    }
}

function Assert-SmokeDiagnostics([string]$Root, $Proof) {
    $taskTreePath = Join-Path $Root 'accessibility-tree.json'
    $taskImagePath = Join-Path $Root 'window.png'
    if (-not (Test-Path -LiteralPath $taskTreePath -PathType Leaf) -or -not (Test-Path -LiteralPath $taskImagePath -PathType Leaf)) { throw 'Native diagnostics are incomplete.' }
    foreach ($taskDiagnosticPath in @($taskTreePath, $taskImagePath)) {
        if ((Get-Item -LiteralPath $taskDiagnosticPath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected native diagnostics are forbidden.' }
    }
    if ((Get-Item -LiteralPath $taskTreePath).Length -gt 4194304 -or (Get-Item -LiteralPath $taskImagePath).Length -gt 67108864) { throw 'Native diagnostics exceed their size bounds.' }
    $taskTree = Get-Content -LiteralPath $taskTreePath -Raw | ConvertFrom-Json
    Assert-SmokeWindow $Proof.window ([int]$Proof.pid)
    Assert-SmokeWindow $taskTree.window ([int]$Proof.pid)
    if ($taskTree.window.handle -ne $Proof.window.handle -or $taskTree.window.title -cne $Proof.window.title) { throw 'Native diagnostics refer to another window.' }
    foreach ($taskDimension in @('left', 'top', 'width', 'height')) {
        if ($taskTree.window.bounds.$taskDimension -ne $Proof.window.bounds.$taskDimension) { throw ('Native diagnostic window ' + $taskDimension + ' contradicts the observation.') }
    }
    Assert-SmokeControls $taskTree.nodes $taskTree.window
    Add-Type -AssemblyName System.Drawing
    $taskImage = [Drawing.Image]::FromFile($taskImagePath)
    try {
        if ($taskImage.RawFormat.Guid -ne [Drawing.Imaging.ImageFormat]::Png.Guid -or $taskImage.Width -ne [Math]::Ceiling($Proof.window.bounds.width) -or $taskImage.Height -ne [Math]::Ceiling($Proof.window.bounds.height)) { throw 'Screenshot format/dimensions do not match the tested native window.' }
    } finally { $taskImage.Dispose() }
    return @(
        @{ path = 'accessibility-tree.json'; sha256 = (Get-SmokeHash $taskTreePath) },
        @{ path = 'window.png'; sha256 = (Get-SmokeHash $taskImagePath) }
    )
}

function Invoke-SmokeWorker([string]$Path, [string]$Hash, [string]$ProductVersion, [string]$OutputDirectory, [int]$Seconds, [string]$Nonce) {
    . (Join-Path $PSScriptRoot 'ci.ps1')
    $taskShell = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
    $taskArguments = @('-NoProfile', '-File', $taskSmokeScript, '-Worker', '-Executable', $Path,
        '-ExpectedSha256', $Hash, '-Version', $ProductVersion, '-EvidenceDirectory', $OutputDirectory,
        '-TimeoutSeconds', [string]$Seconds, '-RunNonce', $Nonce)
    return Invoke-CiChild -FilePath $taskShell -Arguments $taskArguments -WorkingDirectory $taskSmokeRoot -TimeoutSeconds $Seconds
}

function Invoke-NativeSmoke([string]$Path, [string]$Hash, [string]$ProductVersion, [string]$OutputDirectory, [int]$Seconds) {
    $taskRoot = New-SmokeEvidenceRoot $OutputDirectory
    $taskStarted = [DateTime]::UtcNow.ToString('o')
    $taskNonce = [Guid]::NewGuid().ToString('N')
    try {
        if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Native smoke requires PowerShell 7 for bounded process-tree cancellation.' }
        $taskExecutable = Assert-SmokeExecutable $Path $Hash $ProductVersion
        $taskChild = Invoke-SmokeWorker $taskExecutable $Hash $ProductVersion $taskRoot $Seconds $taskNonce
        [IO.File]::WriteAllText((Join-Path $taskRoot 'worker.stdout.log'), $taskChild.stdout, $taskSmokeUtf8)
        [IO.File]::WriteAllText((Join-Path $taskRoot 'worker.stderr.log'), $taskChild.stderr, $taskSmokeUtf8)
        if ($taskChild.timed_out -or $taskChild.exit_code -ne 0) { throw 'Bounded native worker failed or timed out; native launch is not certified.' }
        $taskProof = Get-Content -LiteralPath (Join-Path $taskRoot 'native-observation.json') -Raw | ConvertFrom-Json
        Assert-SmokeObservation $taskProof $Hash $ProductVersion $taskNonce
        $taskDiagnostics = Assert-SmokeDiagnostics $taskRoot $taskProof
        $taskProof | Add-Member -NotePropertyName diagnostics -NotePropertyValue $taskDiagnostics
        $taskProof | Add-Member -NotePropertyName status -NotePropertyValue 'pass'
        Write-SmokeJson (Join-Path $taskRoot 'native-smoke.json') $taskProof
        return 0
    } catch {
        Write-SmokeJson (Join-Path $taskRoot 'native-smoke.json') @{
            schema_version = 1; kind = 'native'; status = 'incomplete'; completed = $false
            executable_sha256 = $Hash; version = $ProductVersion; run_nonce = $taskNonce
            started_at = $taskStarted; completed_at = [DateTime]::UtcNow.ToString('o')
            reason = $_.Exception.Message; platform = [Environment]::OSVersion.VersionString
        }
        [Console]::Error.WriteLine($_.Exception.Message)
        return 2
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        if ($Worker) {
            if ($PSVersionTable.PSVersion.Major -lt 7 -or $RunNonce -cnotmatch '^[a-f0-9]{32}$') { throw 'Invalid internal native-worker invocation.' }
            $taskObservation = Invoke-SmokeCore $Executable $ExpectedSha256 $Version $EvidenceDirectory $TimeoutSeconds $RunNonce
            Write-SmokeJson (Join-Path $EvidenceDirectory 'native-observation.json') $taskObservation
            exit 0
        }
        $taskCode = Invoke-NativeSmoke $Executable $ExpectedSha256 $Version $EvidenceDirectory $TimeoutSeconds
        exit $taskCode
    } catch {
        [Console]::Error.WriteLine($_.Exception.Message)
        exit 2
    }
}
