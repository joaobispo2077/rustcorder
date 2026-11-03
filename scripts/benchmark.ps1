param(
    [ValidateSet('base', 'small')][string]$ModelName = 'base',
    [ValidateSet('pt', 'en')][string]$Language = 'pt',
    [string]$ReportName = 'baseline',
    [ValidateSet('window', 'file')][string]$Pipeline = 'window',
    [ValidateSet('Debug', 'Release')][string]$Profile = 'Release'
)

$ErrorActionPreference = 'Stop'
if ($ReportName -notmatch '^[a-z0-9-]+$') { throw 'Use a lowercase report name containing letters, digits and hyphens.' }
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskReport = Join-Path $taskRoot ".build\benchmarks\$ModelName-$Language-$ReportName.json"
if (Test-Path -LiteralPath $taskReport) {
    throw "A report already exists at $taskReport. Choose a new name to preserve the previous evidence."
}
$env:RUSTCORDER_BENCH_MODEL = $ModelName
$env:RUSTCORDER_BENCH_LANG = $Language
$env:RUSTCORDER_BENCH_REPORT = $taskReport
$env:RUSTCORDER_BENCH_PIPELINE = $Pipeline
$taskArguments = @('test', '--locked', '--offline', '--test', 'integration',
    'asr_feasibility::local_cpu_corpus_baseline', '--', '--ignored', '--exact', '--nocapture', '--test-threads=1')
if ($Profile -eq 'Release') { $taskArguments = @('test', '--release') + $taskArguments[1..($taskArguments.Count - 1)] }
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'dev.ps1') @taskArguments
exit $LASTEXITCODE
