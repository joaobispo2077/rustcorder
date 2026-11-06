[CmdletBinding()]
param([ValidateSet('package','publish')][string]$Mode, [string]$InputFile)
$ErrorActionPreference = 'Stop'
$flowInput = Get-Content -LiteralPath $InputFile -Raw | ConvertFrom-Json -AsHashtable
$flowRoot = [IO.Path]::GetFullPath($flowInput.root)
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'package.ps1')
Assert-CiArchiveRoot $flowRoot | Out-Null
$flowUtf8 = [Text.UTF8Encoding]::new($false)
function Write-FlowJson([string]$Path, $Value) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 64), $flowUtf8)
}
# Fixture transport is the only backend. Even accidental default use cannot publish.
function Invoke-CiGitHubTransport { throw 'Network publication is forbidden in release-flow fixtures.' }

if ($Mode -eq 'package') {
    $flowScope = $flowInput.scope
    $flowPayload = Join-Path $flowRoot 'payload'
    $flowEvidence = Join-Path $flowRoot 'evidence/package'
    foreach ($flowDirectory in @($flowPayload, (Join-Path $flowPayload 'licenses'), (Join-Path $flowEvidence 'native'))) {
        [IO.Directory]::CreateDirectory($flowDirectory) | Out-Null
    }
    [IO.File]::WriteAllText((Join-Path $flowPayload 'rustcorder.exe'), 'Synthetic executable fixture only', $flowUtf8)
    [IO.File]::WriteAllText((Join-Path $flowPayload $flowScope.vad.filename), 'abc', $flowUtf8)
    [IO.File]::WriteAllText((Join-Path $flowPayload 'licenses/silero-vad-MIT-LICENSE.txt'), 'synthetic license', $flowUtf8)
    [IO.File]::WriteAllBytes((Join-Path $flowPayload 'silero-vad.json'), [Convert]::FromBase64String($flowInput.vad_json))
    foreach ($flowName in @('THIRD-PARTY-NOTICES.md','START-HERE.txt','native-imports.txt')) {
        [IO.File]::WriteAllText((Join-Path $flowPayload $flowName), 'Synthetic contract fixture only', $flowUtf8)
    }
    $flowInfo = [ordered]@{
        product_version=$flowScope.version;source_sha=$flowScope.source_sha;source_tree_sha=$flowScope.tree_sha
        source_dirty=$false;source_verification='fresh-clean-build';profile='Release';target='x86_64-pc-windows-msvc'
        static_crt=$true;asr_models_bundled=$false;vad_model_bundled=$true;direct_imports=@('KERNEL32.dll')
        executable_sha256=(Get-FileSha256 (Join-Path $flowPayload 'rustcorder.exe'))
        vad_filename=$flowScope.vad.filename;vad_sha256=$flowScope.vad.sha256;vad_bytes=$flowScope.vad.bytes
        vad_source_revision=$flowScope.vad.revision;vad_license_sha256=$flowScope.vad.license_sha256
        vad_metadata_sha256=$flowScope.vad_metadata_sha256;clean_disconnected_machine_validation='pending'
        inventory_excludes=@('package-info.json');files=@(Get-PackageFileInventory $flowPayload)
    }
    Write-FlowJson (Join-Path $flowPayload 'package-info.json') $flowInfo
    $flowWindow = @{pid=123;handle=456;title='Synthetic contract fixture';bounds=@{left=0;top=0;width=1;height=1}}
    $flowControls = @(
        @{name='Record';role='ControlType.Button';pid=123;enabled=$true;offscreen=$false;bounds=@{left=0;top=0;width=0.3;height=0.3}},
        @{name='Transcribe file';role='ControlType.Button';pid=123;enabled=$true;offscreen=$false;bounds=@{left=0.4;top=0;width=0.3;height=0.3}}
    )
    $flowNative = Join-Path $flowEvidence 'native'
    Write-FlowJson (Join-Path $flowNative 'accessibility-tree.json') @{window=$flowWindow;nodes=$flowControls}
    [IO.File]::WriteAllBytes((Join-Path $flowNative 'window.png'), [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5S8AAAAASUVORK5CYII='))
    Write-FlowJson (Join-Path $flowNative 'native-smoke.json') @{
        schema_version=1;kind='native';status='pass';completed=$true;normal_close_requested=$true;exit_code=0
        run_nonce=('1'*32);pid=123;executable_sha256=$flowInfo.executable_sha256;version=$flowScope.version;window=$flowWindow
        capabilities=@{interactive=$true;input_desktop=$true;uia=$true;screenshot=$true;session_id=1}
        started_at='2026-11-06T04:00:00Z';completed_at='2026-11-06T04:00:01Z';platform='Synthetic contract fixture only'
        navigation=@(@{screen='Record';landmark='Capture mode';pid=123},@{screen='Transcribe file';landmark='No file selected';pid=123},@{screen='Record';landmark='Capture mode';pid=123})
        diagnostics=@(@{path='accessibility-tree.json';sha256=(Get-FileSha256 (Join-Path $flowNative 'accessibility-tree.json'))},@{path='window.png';sha256=(Get-FileSha256 (Join-Path $flowNative 'window.png'))})
    }
    $flowManifest = New-CiPackageArchive -PackageDirectory $flowPayload -OutputDirectory $flowEvidence -InnerRoot 'rustcorder-contract-fixture' -Scope $flowScope
    Write-FlowJson (Join-Path $flowRoot 'package-result.json') @{manifest=$flowManifest;measurement=(Test-CiPackageArchive $flowEvidence $flowScope)}
    exit 0
}

. (Join-Path (Split-Path -Parent $PSScriptRoot) 'publish.ps1')
function Invoke-CiGitHubTransport { throw 'Network publication is forbidden in release-flow fixtures.' }
$flowCandidate = $flowInput.candidate
$flowPrefix = '/repos/'+$flowCandidate.repository
$flowStatePath = Join-Path $flowRoot 'mock-publication-state.json'
$flowState = if (Test-Path -LiteralPath $flowStatePath) {
    Get-Content -LiteralPath $flowStatePath -Raw | ConvertFrom-Json -AsHashtable
} else { @{tag=$null;ref=$null;release=$null;assets=@();calls=@();fault_injected=$false} }
$flowTransport = {
    param($Request)
    Get-PublishRequestUri $Request | Out-Null
    $flowState.calls += @{method=$Request.method;path=$Request.path;ref=$Request.body.ref}
    $flowTail = $Request.path.Substring($flowPrefix.Length)
    if ($Request.method -eq 'GET') {
        if ($flowTail -eq '/git/ref/heads/release') { return @{status=200;body=@{ref='refs/heads/release';object=@{type='commit';sha=$flowCandidate.source_sha}}} }
        if ($flowTail -eq ('/actions/runs/'+$flowCandidate.ci.run_id)) {
            $flowRepository=@{id=$flowCandidate.ci.repository_id;full_name=$flowCandidate.repository}
            return @{status=200;body=@{id=$flowCandidate.ci.run_id;run_attempt=$flowCandidate.ci.run_attempt;workflow_id=$flowCandidate.ci.workflow_id
                head_sha=$flowCandidate.source_sha;path='.github/workflows/ci.yml';event='push';head_branch='release'
                repository=$flowRepository;head_repository=$flowRepository;status='completed';conclusion='success'}}
        }
        if ($flowTail -eq ('/git/ref/tags/v'+$flowCandidate.version)) {
            if ($flowState.ref) { return @{status=200;body=$flowState.ref} }; return @{status=404}
        }
        if ($flowTail -eq ('/git/tags/'+$flowState.tag.sha)) { return @{status=200;body=$flowState.tag} }
        if ($flowTail -eq '/releases?per_page=100&page=1') { return @{status=200;body=@(if($flowState.release){$flowState.release})} }
        if ($flowTail -eq '/releases/77') { return @{status=200;body=$flowState.release} }
        if ($flowTail -eq '/releases/77/assets?per_page=100&page=1') { return @{status=200;body=@($flowState.assets)} }
        if ($Request.download -and $flowTail -match '^/releases/assets/([0-9]+)$') {
            $flowAsset = @($flowState.assets | Where-Object id -EQ ([long]$Matches[1]))[0]
            return @{status=200;bytes=[Convert]::FromBase64String($flowAsset.base64)}
        }
    }
    if ($Request.method -eq 'POST') {
        if ($flowTail -eq '/git/tags') {
            $flowState.tag=@{sha=('e'*40);tag=$Request.body.tag;message=$Request.body.message;object=@{type=$Request.body.type;sha=$Request.body.object}}
            return @{status=201;body=$flowState.tag}
        }
        if ($flowTail -eq '/git/refs') {
            $flowState.ref=@{ref=$Request.body.ref;object=@{type='tag';sha=$Request.body.sha}}
            return @{status=201;body=$flowState.ref}
        }
        if ($flowTail -eq '/releases') {
            $flowState.release=@{id=77;tag_name=$Request.body.tag_name;target_commitish=$Request.body.target_commitish
                body=$Request.body.body;draft=$Request.body.draft;prerelease=$Request.body.prerelease}
            return @{status=201;body=$flowState.release}
        }
        if ($flowTail -match '^/releases/77/assets\?name=(.+)$') {
            $flowName=$Matches[1]
            if (@($flowState.assets | Where-Object name -CEQ $flowName).Count) { throw 'Fixture refuses duplicate upload.' }
            $flowBytes=[IO.File]::ReadAllBytes($Request.file)
            $flowAsset=@{id=(80+$flowState.assets.Count);name=$flowName;size=$flowBytes.Length;state='uploaded';base64=[Convert]::ToBase64String($flowBytes)}
            $flowState.assets += $flowAsset
            if ($flowInput.fail_after_first_upload -and -not $flowState.fault_injected) {
                $flowState.fault_injected=$true;throw 'Controlled interruption after the first stored upload.'
            }
            return @{status=201;body=$flowAsset}
        }
    }
    if ($Request.method -eq 'PATCH' -and $flowTail -eq '/releases/77') {
        $flowState.release.draft=$Request.body.draft
        return @{status=200;body=$flowState.release}
    }
    throw ('Unexpected fixture request: '+$Request.method+' '+$Request.path)
}
try {
    $flowResult = Invoke-CiPublish -Candidate $flowCandidate -Root $flowInput.attachments -Authorization $flowInput.authorization -Transport $flowTransport
    Write-PublishReceipt $flowResult $flowInput.attachments | Out-Null
    Write-FlowJson $flowStatePath $flowState
    Write-FlowJson (Join-Path $flowRoot 'publish-result.json') @{result=$flowResult;state=$flowState}
} catch {
    Write-FlowJson $flowStatePath $flowState
    Write-FlowJson (Join-Path $flowRoot 'publish-result.json') @{error=$_.Exception.Message;state=$flowState;attempted_result=$flowResult}
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 3
}
