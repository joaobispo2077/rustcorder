[CmdletBinding()]
param(
    [string]$Gate,
    [ValidateSet('light', 'full')][string]$Profile = 'light',
    [string]$EvidenceDirectory
)

$ErrorActionPreference = 'Stop'
$taskCiRoot = $PSScriptRoot
$taskRepoRoot = Split-Path -Parent (Split-Path -Parent $taskCiRoot)
$taskUtf8 = New-Object System.Text.UTF8Encoding($false)

function ConvertTo-CiArgument([AllowEmptyString()][string]$Value) {
    if ($Value.Contains([char]0)) { throw 'NUL command argument is forbidden.' }
    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $taskValue = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
    $taskValue = [regex]::Replace($taskValue, '(\\+)$', '$1$1')
    return '"' + $taskValue + '"'
}

function Invoke-CiChild {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$Arguments = @(),
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [ValidateRange(1, 7200)][int]$TimeoutSeconds = 1200,
        [hashtable]$Environment = @{}
    )
    $taskStart = New-Object System.Diagnostics.ProcessStartInfo
    $taskStart.FileName = $FilePath
    $taskStart.Arguments = (($Arguments | ForEach-Object { ConvertTo-CiArgument $_ }) -join ' ')
    $taskStart.WorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory)
    $taskStart.UseShellExecute = $false
    $taskStart.CreateNoWindow = $true
    $taskStart.RedirectStandardOutput = $true
    $taskStart.RedirectStandardError = $true
    $taskStart.StandardOutputEncoding = $taskUtf8
    $taskStart.StandardErrorEncoding = $taskUtf8
    foreach ($taskEntry in $Environment.GetEnumerator()) {
        if ($taskEntry.Key -isnot [string] -or $taskEntry.Key -cnotmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or $taskEntry.Value -isnot [string] -or $taskEntry.Value.Contains([char]0)) { throw 'Invalid child environment entry.' }
        $taskStart.EnvironmentVariables[$taskEntry.Key] = $taskEntry.Value
    }
    $taskProcess = New-Object System.Diagnostics.Process
    $taskProcess.StartInfo = $taskStart
    $taskWatch = [Diagnostics.Stopwatch]::StartNew()
    try {
        if (-not $taskProcess.Start()) { throw 'Could not start child process.' }
        $taskStdout = $taskProcess.StandardOutput.ReadToEndAsync()
        $taskStderr = $taskProcess.StandardError.ReadToEndAsync()
        $taskTimedOut = -not $taskProcess.WaitForExit($TimeoutSeconds * 1000)
        if ($taskTimedOut) {
            # Process handles avoid taskkill's RPC credential dependency.
            if ($taskProcess.GetType().GetMethods().Where({ $_.Name -eq 'Kill' -and $_.GetParameters().Count -eq 1 }).Count -gt 0) {
                $taskProcess.Kill($true)
            } else {
                # shortcut: legacy .NET kills the owned root; use pwsh for tree cancellation.
                $taskProcess.Kill()
            }
            if (-not $taskProcess.WaitForExit(5000)) { throw 'Owned child did not exit after timeout cleanup.' }
        }
        $taskReadFinished = $taskStdout.Wait(5000) -and $taskStderr.Wait(5000)
        if (-not $taskReadFinished) { throw 'Child output pipes did not close.' }
        $taskWatch.Stop()
        return [pscustomobject]@{
            stdout = $taskStdout.Result; stderr = $taskStderr.Result
            exit_code = $taskProcess.ExitCode; timed_out = $taskTimedOut
            duration_ms = [long]$taskWatch.ElapsedMilliseconds
        }
    } finally {
        $taskProcess.Dispose()
    }
}

function Get-CiNode {
    $taskPinned = Join-Path $taskRepoRoot '.build\ci-tools\node\node-v24.22.2-win-x64\node.exe'
    if (Test-Path -LiteralPath $taskPinned) { return $taskPinned }
    return (Get-Command node.exe -ErrorAction Stop).Source
}

function Write-CiUtf8([string]$Path, [string]$Content) {
    [IO.Directory]::CreateDirectory((Split-Path -Parent $Path)) | Out-Null
    [IO.File]::WriteAllText($Path, $Content, $taskUtf8)
}

function Get-CiSteps([string]$Name, [string]$GateRoot, [string]$MutationProfile = 'light') {
    $taskShell = (Get-Command powershell.exe -ErrorAction Stop).Source
    $taskDev = Join-Path $taskRepoRoot 'scripts/dev.ps1'
    $taskNode = Get-CiNode
    function New-Step([string]$Program, [string[]]$Arguments, [string]$Stem, [int]$Budget = 1200) {
        [pscustomobject]@{ program = $Program; arguments = $Arguments; stem = $Stem; budget = $Budget }
    }
    function New-Cargo([string[]]$Arguments, [string]$Stem = 'run') {
        New-Step $taskShell (@('-NoProfile', '-File', $taskDev) + $Arguments) $Stem
    }
    switch ($Name) {
        'prerequisites' { New-Step $taskShell @('-NoProfile', '-File', (Join-Path $taskCiRoot 'setup-windows.ps1'), '-CheckOnly') 'run' }
        'format' { New-Cargo @('fmt', '--all', '--', '--check') }
        'lint' { New-Cargo @('clippy', '--locked', '--offline', '--all-targets', '--', '-D', 'warnings') }
        'deadcode' { New-Cargo @('clippy', '--locked', '--offline', '--all-targets', '--', '-D', 'warnings', '-D', 'unfulfilled_lint_expectations') }
        'build' {
            New-Cargo @('build', '--locked', '--offline')
            New-Step $taskShell @('-NoProfile', '-File', (Join-Path $taskRepoRoot 'scripts/package.ps1'), '-SelfCheck') 'package-selfcheck'
        }
        { $_ -in @('unit', 'integration', 'ui') } {
            [string[]]$taskSelection = if ($Name -eq 'integration') { @('--test', 'integration') } else { @('--lib') }
            if ($Name -eq 'ui') { $taskSelection += 'ui::tests' }
            New-Cargo (@('test', '--locked', '--offline') + $taskSelection + @('--', '--list', '--format', 'pretty')) 'list'
            New-Cargo (@('test', '--locked', '--offline') + $taskSelection + @('--', '--format', 'pretty', '--test-threads', '1')) 'run'
        }
        'coverage' { New-Cargo @('llvm-cov', '--locked', '--offline', '--all-targets', '--json', '--summary-only', '--output-path', (Join-Path $GateRoot 'coverage.json')) }
        'complexity' {
            $taskRca = Join-Path $taskRepoRoot '.build/ci-tools/rca/target/release/rust-code-analysis-cli.exe'
            [IO.Directory]::CreateDirectory((Join-Path $GateRoot 'rca')) | Out-Null
            New-Step $taskRca @('-p', 'src', '-C', 'error') 'parse'
            New-Step $taskRca @('-p', 'src', '-m', '-O', 'json', '-o', (Join-Path $GateRoot 'rca')) 'metrics'
        }
        'duplication' { New-Step $taskNode @((Join-Path $taskCiRoot 'node_modules/jscpd/run-jscpd.js'), '--config', (Join-Path $taskCiRoot 'jscpd.json'), '--output', $GateRoot, 'src') 'run' }
        'architecture' {
            $taskAst = Join-Path $taskCiRoot 'node_modules/@ast-grep/cli-win32-x64-msvc/ast-grep.exe'
            New-Step $taskAst @('test', '--config', (Join-Path $taskCiRoot 'sgconfig.yml')) 'fixtures'
            New-Step $taskShell @('-NoProfile', '-File', (Join-Path $taskCiRoot 'tests/analyzers.test.ps1')) 'calibration'
            New-Step $taskAst @('scan', '--config', (Join-Path $taskCiRoot 'sgconfig.yml'), '--json', 'src') 'run'
        }
        'dependencies' {
            New-Cargo @('deny', '--locked', '--format', 'json', '--config', (Join-Path $taskCiRoot 'deny.toml'), 'check', '--show-stats') 'rust'
            New-Step $taskNode @((Join-Path (Split-Path -Parent $taskNode) 'node_modules/npm/bin/npm-cli.js'), '--prefix', $taskCiRoot, 'audit', '--omit=peer', '--ignore-scripts', '--json') 'npm'
        }
        'package' {
            New-Step $taskNode @((Join-Path $taskCiRoot 'gates.mjs'), 'provision-vad') 'vad' 120
            New-Step (Get-Command pwsh -ErrorAction Stop).Source @('-NoProfile', '-File', (Join-Path $taskCiRoot 'package.ps1'), '-EvidenceDirectory', $GateRoot, '-ContextFile', (Join-Path (Split-Path -Parent $GateRoot) 'context.json')) 'run' 1100
        }
        { $_ -in @('mutation-rust','mutation-ci') } {
            $taskEngine = if ($Name -eq 'mutation-rust') { 'rust' } else { 'ci' }
            $taskBudget = if ($MutationProfile -eq 'full') { 3640 } else { 1240 }
            New-Step $taskNode @((Join-Path $taskCiRoot 'run-mutation.mjs'), $taskEngine, '--profile', $MutationProfile, '--root', $GateRoot) 'run' $taskBudget
        }
        default { throw ('Gate is not implemented: ' + $Name) }
    }
}

function Invoke-CiGate {
    param([string]$Name, [string]$OutputDirectory, [string]$MutationProfile = 'light')
    $taskNames = @('prerequisites', 'format', 'lint', 'build', 'unit', 'integration', 'ui',
        'coverage', 'complexity', 'deadcode', 'duplication', 'architecture', 'dependencies',
        'package', 'mutation-rust', 'mutation-ci', 'readiness', 'report', 'quality')
    if ($Name -notin $taskNames) { throw 'Unknown gate; use an explicit supported gate name.' }
    if ($Name -eq 'quality') {
        if (-not $OutputDirectory) { $OutputDirectory = Join-Path $taskRepoRoot ('.build/ci-evidence/local-' + [Guid]::NewGuid().ToString('N')) }
        $taskCollectionCode = 0
        foreach ($taskQualityGate in @('prerequisites', 'format', 'lint', 'build', 'unit', 'integration', 'ui', 'coverage', 'complexity', 'deadcode', 'duplication', 'architecture', 'dependencies')) {
            $taskGateCode = Invoke-CiGate $taskQualityGate $OutputDirectory
            if ($taskGateCode -gt $taskCollectionCode) { $taskCollectionCode = $taskGateCode }
        }
        return $taskCollectionCode
    }
    if (-not $OutputDirectory) { $OutputDirectory = Join-Path $taskRepoRoot ('.build\ci-evidence\local-' + [Guid]::NewGuid().ToString('N')) }
    $taskOutput = [IO.Path]::GetFullPath($OutputDirectory)
    $taskAllowed = [IO.Path]::GetFullPath((Join-Path $taskRepoRoot '.build')) + [IO.Path]::DirectorySeparatorChar
    if (-not $taskOutput.StartsWith($taskAllowed, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Evidence must remain inside this checkout .build directory.'
    }
    . (Join-Path $taskCiRoot 'setup-windows.ps1')
    Assert-CiOwnedDirectory $taskOutput | Out-Null
    [IO.Directory]::CreateDirectory($taskOutput) | Out-Null
    $taskNode = Get-CiNode
    $taskGates = Join-Path $taskCiRoot 'gates.mjs'
    $taskContext = Join-Path $taskOutput 'context.json'
    if (-not $env:RUSTCORDER_CI_RUN_ID) {
        $taskExistingContext = if (Test-Path -LiteralPath $taskContext) { Get-Content -LiteralPath $taskContext -Raw | ConvertFrom-Json } else { $null }
        $env:RUSTCORDER_CI_RUN_ID = if ($taskExistingContext.kind -eq 'local') { $taskExistingContext.run_id } else { 'local-' + [Guid]::NewGuid().ToString('N') }
    }
    $taskContextArguments = @('context', '--out', $taskContext, '--job', 'local')
    if (Test-Path -LiteralPath $taskContext) { $taskContextArguments += @('--expected', $taskContext) }
    & $taskNode $taskGates @taskContextArguments
    if ($LASTEXITCODE -ne 0) { throw 'Could not establish current execution identity.' }
    if ($Name -eq 'report') {
        & $taskNode $taskGates report --root $taskOutput --out (Join-Path $taskOutput 'report') | Out-Host
        return [int]$LASTEXITCODE
    }
    if ($Name -eq 'readiness') {
        & $taskNode $taskGates readiness --root $taskOutput --report (Join-Path $taskOutput 'report/report.json') --out (Join-Path $taskOutput 'certification.json') | Out-Host
        return [int]$LASTEXITCODE
    }
    $taskGateRoot = Join-Path $taskOutput $Name
    Assert-CiOwnedDirectory $taskGateRoot | Out-Null
    if (Test-Path -LiteralPath $taskGateRoot) { throw 'Gate evidence directory already exists; use a fresh evidence directory.' }
    [IO.Directory]::CreateDirectory($taskGateRoot) | Out-Null
    $taskStarted = [DateTime]::UtcNow.ToString('o')
    Write-CiUtf8 (Join-Path $taskGateRoot 'stdout.log') ''
    Write-CiUtf8 (Join-Path $taskGateRoot 'stderr.log') ('Gate implementation is incomplete: ' + $Name)
    $taskResult = @{
        completed = $false; timed_out = $false; exit_code = $null; duration_ms = 0
        started_at = $taskStarted; completed_at = [DateTime]::UtcNow.ToString('o')
        reason = ('Gate implementation is incomplete: ' + $Name); command = @()
    }
    $env:PATH = (Join-Path $taskRepoRoot '.build/ci-tools/cargo/bin') + ';' + $env:PATH
    $env:RUSTUP_TOOLCHAIN = (Get-Content (Join-Path $taskCiRoot 'toolchain.json') -Raw | ConvertFrom-Json).rust
    $env:LIBCLANG_PATH = Join-Path $taskRepoRoot '.build/ci-tools/libclang/libclang-18.1.1.data/platlib/clang/native'
    $taskStdout = New-Object Text.StringBuilder
    $taskStderr = New-Object Text.StringBuilder
    $taskCommands = @(); $taskRaw = @(); $taskDuration = 0; $taskCode = 0; $taskTimeout = $false
    try {
        foreach ($taskStep in @(Get-CiSteps $Name $taskGateRoot $MutationProfile)) {
            $taskCommands += ,(@($taskStep.program) + $taskStep.arguments)
            $taskChild = Invoke-CiChild -FilePath $taskStep.program -Arguments $taskStep.arguments -WorkingDirectory $taskRepoRoot -TimeoutSeconds $taskStep.budget
            foreach ($taskStream in @('stdout', 'stderr')) {
                $taskRawName = $taskStep.stem + '.' + $taskStream + '.log'
                Write-CiUtf8 (Join-Path $taskGateRoot $taskRawName) $taskChild.PSObject.Properties[$taskStream].Value
                $taskRaw += $Name + '/' + $taskRawName
            }
            [void]$taskStdout.AppendLine($taskChild.stdout)
            [void]$taskStderr.AppendLine($taskChild.stderr)
            $taskDuration += $taskChild.duration_ms
            $taskTimeout = $taskTimeout -or $taskChild.timed_out
            if ($taskChild.exit_code -ne 0) { $taskCode = $taskChild.exit_code }
            if ($taskTimeout -or ($taskCode -ne 0 -and $Name -ne 'dependencies')) { break }
        }
        $taskResult = @{
            completed = -not $taskTimeout; timed_out = $taskTimeout; exit_code = $taskCode; duration_ms = $taskDuration
            started_at = $taskStarted; completed_at = [DateTime]::UtcNow.ToString('o')
            command = $taskCommands; raw_files = $taskRaw
        }
    } catch {
        [void]$taskStderr.AppendLine($_.Exception.Message)
        $taskResult.reason = $_.Exception.Message
    }
    Write-CiUtf8 (Join-Path $taskGateRoot 'stdout.log') $taskStdout.ToString()
    Write-CiUtf8 (Join-Path $taskGateRoot 'stderr.log') $taskStderr.ToString()
    $taskResultPath = Join-Path $taskGateRoot 'result.json'
    Write-CiUtf8 $taskResultPath ($taskResult | ConvertTo-Json -Depth 12)
    & $taskNode $taskGates record --gate $Name --root $taskOutput --context $taskContext --result $taskResultPath --out (Join-Path $taskGateRoot 'gate.json')
    return [int]$LASTEXITCODE
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        $taskExit = Invoke-CiGate -Name $Gate -OutputDirectory $EvidenceDirectory -MutationProfile $Profile
        if ($taskExit -isnot [int]) { throw 'Gate returned diagnostics as an exit code; execution remains incomplete.' }
        exit $taskExit
    } catch {
        [Console]::Error.WriteLine($_.Exception.Message)
        exit 2
    }
}
