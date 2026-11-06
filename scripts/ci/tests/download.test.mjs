import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('pinned tool download binds finite retries and timeout before checksum verification', () => {
  const setup = fileURLToPath(new URL('../setup-windows.ps1', import.meta.url)).replaceAll("'", "''");
  const script = `
$ErrorActionPreference='Stop'
. '${setup}'
$probeRoot=Join-Path $taskSetupRoot ('.build/download-contract-'+[Guid]::NewGuid().ToString('N'))
$requests=[Collections.Generic.List[object]]::new()
function Get-Content {
    param([string]$LiteralPath,[switch]$Raw)
    if((Split-Path -Leaf $LiteralPath) -ne 'toolchain.json'){throw 'Unexpected fixture file read'}
    return '{"assets":{"fixture":{"url":"https://fixture.invalid/tool.zip","sha256":"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"}}}'
}
function Invoke-WebRequest {
    param([switch]$UseBasicParsing,[string]$Uri,[string]$OutFile,[int]$MaximumRetryCount,[int]$RetryIntervalSec,[int]$ConnectionTimeoutSeconds,[int]$OperationTimeoutSeconds)
    $requests.Add(@{retries=$MaximumRetryCount;interval=$RetryIntervalSec;connection=$ConnectionTimeoutSeconds;operation=$OperationTimeoutSeconds;uri=$Uri})
    [IO.File]::WriteAllBytes($OutFile,[byte[]](97,98,99))
}
try {
    $asset=Get-CiAsset -Name fixture -CacheRoot $probeRoot
    if($requests.Count -ne 1 -or $requests[0].retries -ne 2 -or $requests[0].interval -ne 2 -or $requests[0].connection -ne 120 -or $requests[0].operation -ne 120){throw 'Tool download is missing its finite retry/timeout bounds'}
    if($requests[0].uri -cne 'https://fixture.invalid/tool.zip' -or (Get-CiSha256 $asset) -cne 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'){throw 'Pinned bytes changed'}
    Get-CiAsset -Name fixture -CacheRoot $probeRoot | Out-Null
    if($requests.Count -ne 1){throw 'Valid cache was downloaded again'}
    [IO.File]::WriteAllText($asset,'tampered')
    $rejected=$false
    try {Get-CiAsset -Name fixture -CacheRoot $probeRoot | Out-Null}catch{$rejected=$true}
    if(-not $rejected -or $requests.Count -ne 1){throw 'Changed cached bytes bypassed checksum validation'}
    Write-Output 'Bounded pinned download checks passed'
} finally {
    $owned=Assert-CiOwnedDirectory $probeRoot
    if((Split-Path -Parent $owned) -cne [IO.Path]::GetFullPath((Join-Path $taskSetupRoot '.build'))){throw 'Unsafe fixture cleanup'}
    if(Test-Path -LiteralPath $owned){Remove-Item -LiteralPath $owned -Recurse -Force}
}
`;
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 20000,
    env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /Bounded pinned download checks passed/);
});
