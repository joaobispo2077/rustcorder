$ErrorActionPreference = 'Stop'
$taskScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'ci.ps1'
if (-not (Test-Path -LiteralPath $taskScript)) { throw 'CI command runner contract is absent.' }
. $taskScript
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
$taskPowerShell = (Get-Command powershell.exe -ErrorAction Stop).Source
$taskResult = Invoke-CiChild -FilePath $taskPowerShell -Arguments @('-NoProfile', '-Command', '[Console]::Write("hello"); exit 7') -WorkingDirectory $PSScriptRoot -TimeoutSeconds 10
Assert-True ($taskResult.exit_code -eq 7) 'Child failure must retain exit code 7.'
Assert-True ($taskResult.stdout -eq 'hello') 'Child stdout must be retained.'
$taskTimeout = Invoke-CiChild -FilePath $taskPowerShell -Arguments @('-NoProfile', '-Command', 'Start-Sleep -Seconds 30') -WorkingDirectory $PSScriptRoot -TimeoutSeconds 1
Assert-True $taskTimeout.timed_out 'Hung child must time out.'
Assert-True ($taskTimeout.duration_ms -lt 15000) 'Timeout cleanup must remain bounded.'
foreach ($taskArgument in @('', 'has space', 'C:\some folder\', 'a"b', 'a&b', '$(bad)', '`literal')) {
    $taskQuoted = ConvertTo-CiArgument $taskArgument
    Assert-True (-not [string]::IsNullOrEmpty($taskQuoted)) 'Each argument must have a native representation.'
}
$taskRejected = $false
try { ConvertTo-CiArgument ("bad" + [char]0) | Out-Null } catch { $taskRejected = $true }
Assert-True $taskRejected 'NUL command argument must be rejected.'
Write-Output 'Dispatcher boundary checks passed.'
$taskEnvironmentBefore = [Environment]::GetEnvironmentVariable('RUSTCORDER_CI_CHILD_FIXTURE', 'Process')
$taskEnvironmentChild = Invoke-CiChild -FilePath $taskPowerShell -Arguments @('-NoProfile', '-Command', '[Console]::Write([Environment]::GetEnvironmentVariable("RUSTCORDER_CI_CHILD_FIXTURE")); exit 0') -WorkingDirectory $PSScriptRoot -TimeoutSeconds 10 -Environment @{ RUSTCORDER_CI_CHILD_FIXTURE = 'owned-child' }
Assert-True ($taskEnvironmentChild.stdout -eq 'owned-child') 'Child-specific environment must reach only the child.'
Assert-True ([Environment]::GetEnvironmentVariable('RUSTCORDER_CI_CHILD_FIXTURE', 'Process') -ceq $taskEnvironmentBefore) 'The parent environment must be unchanged.'

$taskReadinessRoot = Join-Path $taskRepoRoot ('.build/dispatcher-readiness-' + [Guid]::NewGuid().ToString('N'))
. (Join-Path $taskCiRoot 'setup-windows.ps1')
$taskReadinessEnvironment = @{ GITHUB_ACTIONS = 'false'; GITHUB_STEP_SUMMARY = ''; RUSTCORDER_CI_RUN_ID = ('local-' + [Guid]::NewGuid().ToString('N')) }
$taskReadinessShell = (Get-Command pwsh -ErrorAction Stop).Source
try {
    $taskReportProbe = Invoke-CiChild -FilePath $taskReadinessShell -Arguments @('-NoProfile','-File',$taskScript,'-Gate','report','-EvidenceDirectory',$taskReadinessRoot) -WorkingDirectory $taskRepoRoot -TimeoutSeconds 30 -Environment $taskReadinessEnvironment
    Assert-True ($taskReportProbe.exit_code -eq 0) ('Available local evidence must render a report: ' + $taskReportProbe.stderr)
    $taskReadinessProbe = Invoke-CiChild -FilePath $taskReadinessShell -Arguments @('-NoProfile','-File',$taskScript,'-Gate','readiness','-EvidenceDirectory',$taskReadinessRoot) -WorkingDirectory $taskRepoRoot -TimeoutSeconds 30 -Environment $taskReadinessEnvironment
    Assert-True ($taskReadinessProbe.exit_code -eq 1) 'Blocked local readiness must retain exit 1 despite diagnostic stdout.'
    $taskCertificate = Get-Content -LiteralPath (Join-Path $taskReadinessRoot 'certification.json') -Raw | ConvertFrom-Json
    Assert-True (-not $taskCertificate.ready) 'A rendered report cannot certify local execution as hosted readiness.'
} finally {
    if (Test-Path -LiteralPath $taskReadinessRoot) {
        Assert-CiOwnedDirectory $taskReadinessRoot | Out-Null
        Remove-Item -LiteralPath $taskReadinessRoot -Recurse -Force
    }
}
