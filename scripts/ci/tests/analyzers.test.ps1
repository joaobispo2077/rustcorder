$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'ci.ps1')
. (Join-Path $taskCiRoot 'setup-windows.ps1')

$taskCalibrationRoot = Join-Path $taskRepoRoot ('.build/analyzer-calibration-' + [Guid]::NewGuid().ToString('N'))
Assert-CiOwnedDirectory $taskCalibrationRoot | Out-Null
[IO.Directory]::CreateDirectory($taskCalibrationRoot) | Out-Null
$taskRca = Join-Path $taskRepoRoot '.build/ci-tools/rca/target/release/rust-code-analysis-cli.exe'
$taskAst = Join-Path $taskCiRoot 'node_modules/@ast-grep/cli-win32-x64-msvc/ast-grep.exe'
$taskNode = Get-CiNode

function Invoke-AnalyzerProbe([string]$Program, [string[]]$Arguments, [string]$Label) {
    $taskProbeResult = Invoke-CiChild $Program $Arguments $taskRepoRoot 30
    Write-CiUtf8 (Join-Path $taskCalibrationRoot ($Label + '.stdout.log')) $taskProbeResult.stdout
    Write-CiUtf8 (Join-Path $taskCalibrationRoot ($Label + '.stderr.log')) $taskProbeResult.stderr
    if ($taskProbeResult.timed_out) { throw ('Analyzer calibration timed out: ' + $Label) }
    return $taskProbeResult
}

try {
    $taskGood = Join-Path $taskCalibrationRoot 'good.rs'
    $taskBad = Join-Path $taskCalibrationRoot 'malformed.rs'
    Write-CiUtf8 $taskGood @'
pub fn simple(flag: bool) -> u8 {
    if flag { 1 } else { 0 }
}
pub fn outer(flag: bool) -> u8 {
    fn nested(flag: bool) -> u8 {
        if flag { 2 } else { 3 }
    }
    let branch = |flag: bool| if flag { 4 } else { 5 };
    nested(flag) + branch(flag)
}
'@
    Write-CiUtf8 $taskBad 'pub fn malformed( {'
    $taskMetrics = Join-Path $taskCalibrationRoot 'metrics'
    [IO.Directory]::CreateDirectory($taskMetrics) | Out-Null
    $taskGoodRelative = $taskGood.Substring($taskRepoRoot.Length + 1).Replace('\', '/')
    $taskBadRelative = $taskBad.Substring($taskRepoRoot.Length + 1).Replace('\', '/')
    $taskGoodParse = Invoke-AnalyzerProbe $taskRca @('-p', $taskGoodRelative, '-C', 'error') 'good-parse'
    $taskBadParse = Invoke-AnalyzerProbe $taskRca @('-p', $taskBadRelative, '-C', 'error') 'bad-parse'
    $taskMetricResult = Invoke-AnalyzerProbe $taskRca @('-p', $taskGoodRelative, '-m', '-O', 'json', '-o', $taskMetrics) 'metrics'
    if ($taskGoodParse.exit_code -ne 0 -or $taskBadParse.exit_code -ne 0 -or $taskMetricResult.exit_code -ne 0) {
        throw 'RCA calibration command did not complete.'
    }
    $taskCheck = @'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { complexityMeasurement, rcaParseProof, filesBelow } from './scripts/ci/gates.mjs';
const root = process.argv[1];
const read = name => readFileSync(path.join(root, name), 'utf8');
assert.equal(rcaParseProof(read('good-parse.stdout.log')), true);
assert.throws(() => rcaParseProof(read('bad-parse.stdout.log')));
const metrics = filesBelow(path.join(root, 'metrics')).filter(file => file.endsWith('.json'));
assert.equal(metrics.length, 1, 'Exactly the requested source must be analyzed');
const raw = JSON.parse(readFileSync(metrics[0], 'utf8'));
const result = complexityMeasurement([raw], [raw.name.replaceAll('\\', '/')], []);
const named = name => result.functions.find(fn => fn.symbol === name);
assert.equal(result.functions.length, 4, 'Named functions and closure must all be accounted for');
assert.equal(named('simple').value, 2);
assert.equal(named('outer').value, 1);
assert.equal(named('outer::nested').value, 2);
const closure = result.functions.filter(fn => fn.symbol.startsWith('outer::<anonymous>@'));
assert.equal(closure.length, 1);
assert.equal(closure[0].value, 2);
const aggregate = raw.spaces.find(fn => fn.name === 'outer').metrics.cyclomatic.sum;
assert.equal(aggregate, 5);
assert.notEqual(named('outer').value, aggregate, 'Aggregate complexity must not masquerade as own-function complexity');
console.log('RCA calibrated: simple=2, outer=1 (aggregate=5), nested=2, closure=2; malformed source rejected.');
'@
    $taskCheckResult = Invoke-AnalyzerProbe $taskNode @('--input-type=module', '-e', $taskCheck, $taskCalibrationRoot) 'normalization'
    if ($taskCheckResult.exit_code -ne 0) { throw ('RCA normalization calibration failed: ' + $taskCheckResult.stderr) }
    Write-Output $taskCheckResult.stdout.Trim()

    # Deliberately classify a forbidden edge as valid in a disposable fixture.
    $taskFaultTests = Join-Path $taskCalibrationRoot 'fault-tests'
    [IO.Directory]::CreateDirectory($taskFaultTests) | Out-Null
    Write-CiUtf8 (Join-Path $taskFaultTests 'seeded-boundary-test.yml') (@{
        id = 'ui-native-boundary'
        valid = @('use whisper_rs::WhisperContext;')
        invalid = @()
    } | ConvertTo-Json -Depth 5)
    $taskFault = Invoke-AnalyzerProbe $taskAst @('test', '--config', (Join-Path $taskCiRoot 'sgconfig.yml'), '--test-dir', $taskFaultTests, '--skip-snapshot-tests') 'seeded-boundary'
    if ($taskFault.exit_code -eq 0 -or $taskFault.stdout -notmatch 'FAIL ui-native-boundary') {
        throw 'The seeded forbidden native dependency was not detected by its actual rule.'
    }
    Write-Output 'ast-grep seeded fault rejected: forbidden native import cannot pass as a valid UI edge.'
} finally {
    $taskResolved = Assert-CiOwnedDirectory $taskCalibrationRoot
    if ($taskResolved -ne [IO.Path]::GetFullPath($taskCalibrationRoot) -or
        -not $taskResolved.StartsWith([IO.Path]::GetFullPath((Join-Path $taskRepoRoot '.build')) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing calibration cleanup outside its owned .build folder.'
    }
    Remove-Item -LiteralPath $taskResolved -Recurse
}
