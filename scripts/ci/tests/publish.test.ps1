$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Publisher boundary tests require PowerShell 7.' }
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'publish.ps1')

function Assert-PublishTest([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}
function Assert-PublishRejects([scriptblock]$Action, [string]$Message) {
    $taskRejected = $false
    try { & $Action | Out-Null } catch { $taskRejected = $true }
    Assert-PublishTest $taskRejected $Message
}
function Copy-PublishValue($Value) { return $Value | ConvertTo-Json -Depth 20 | ConvertFrom-Json -AsHashtable -NoEnumerate }
function New-PublishFixture {
    $taskFixtureRoot = Join-Path $taskSetupRoot ('.build/publish-test-' + [Guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($taskFixtureRoot) | Out-Null
    $taskFiles = @(
        @{name='rustcorder-0.1.0-windows-x64.zip';path='app.zip';bytes=3;sha256='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'},
        @{name='notes.md';path='notes.md';bytes=3;sha256='cb8379ac2098aa165029e3938a51da0bcecfc008fd6795f401178647f96c5b34'}
    )
    [IO.File]::WriteAllBytes((Join-Path $taskFixtureRoot 'app.zip'), [byte[]](97,98,99))
    [IO.File]::WriteAllBytes((Join-Path $taskFixtureRoot 'notes.md'), [byte[]](100,101,102))
    $taskControl = @{run_id=303;run_attempt=1;workflow_id=202;source_sha=('c'*40)}
    $taskCandidate = @{schema_version=1;kind='release-candidate';repository='joaobispo2077/rustcorder';
        version='0.1.0';source_sha=('a'*40);tree_sha=('b'*40);candidate_sha256=('d'*64);release_sha256=('f'*64);
        files=$taskFiles;control=$taskControl;notes='Reviewed release notes.';
        ci=@{repository='joaobispo2077/rustcorder';repository_id=101;workflow_id=201;run_id=404;run_attempt=1;source_sha=('a'*40)}}
    $taskAuthorization = @{candidate_sha256=('d'*64);actor='maintainer';environment_id=99;control=(Copy-PublishValue $taskControl)}
    $taskState = @{calls=(New-Object 'System.Collections.Generic.List[object]');tag=$null;ref=$null;release=$null;
        assets=(New-Object 'System.Collections.Generic.List[object]');next_id=80;tip=('a'*40);fail=$null;hook=$null;
        ci=@{id=404;run_attempt=1;workflow_id=201;head_sha=('a'*40);event='push';head_branch='release';
            path='.github/workflows/ci.yml';status='completed';conclusion='success';
            repository=@{id=101;full_name='joaobispo2077/rustcorder'};head_repository=@{id=101;full_name='joaobispo2077/rustcorder'}}}
    $taskTransport = {
        param($Request)
        $taskKey = $Request.method + ' ' + $Request.path
        [void]$taskState.calls.Add($Request)
        $taskFail = $taskState.fail
        if ($taskFail -and $taskFail.key -ceq $taskKey -and $taskFail.remaining -gt 0 -and -not $taskFail.after) {
            $taskFail.remaining--; throw 'Controlled transport failure before operation.'
        }
        $taskPrefix = '/repos/joaobispo2077/rustcorder'
        $taskResponse = $null
        if ($Request.method -ceq 'GET' -and $Request.path -ceq ($taskPrefix+'/git/ref/heads/release')) {
            $taskResponse=@{status=200;body=@{ref='refs/heads/release';object=@{type='commit';sha=$taskState.tip}}}
        } elseif ($Request.method -ceq 'GET' -and $Request.path -ceq ($taskPrefix+'/actions/runs/404')) {
            $taskResponse=@{status=200;body=(Copy-PublishValue $taskState.ci)}
        } elseif ($Request.method -ceq 'GET' -and $Request.path -ceq ($taskPrefix+'/git/ref/tags/v0.1.0')) {
            $taskResponse=if($taskState.ref){@{status=200;body=$taskState.ref}}else{@{status=404;body=$null}}
        } elseif ($Request.method -ceq 'GET' -and $Request.path -cmatch ('^'+[regex]::Escape($taskPrefix)+'/git/tags/[a-f0-9]{40}$')) {
            $taskResponse=@{status=200;body=$taskState.tag}
        } elseif ($Request.method -ceq 'POST' -and $Request.path -ceq ($taskPrefix+'/git/tags')) {
            $taskState.tag=@{sha=('e'*40);tag=$Request.body.tag;message=$Request.body.message;object=@{type=$Request.body.type;sha=$Request.body.object}}
            $taskResponse=@{status=201;body=$taskState.tag}
        } elseif ($Request.method -ceq 'POST' -and $Request.path -ceq ($taskPrefix+'/git/refs')) {
            $taskState.ref=@{ref=$Request.body.ref;object=@{type='tag';sha=$Request.body.sha}}
            $taskResponse=@{status=201;body=$taskState.ref}
        } elseif ($Request.method -ceq 'GET' -and $Request.path -cmatch ('^'+[regex]::Escape($taskPrefix)+'/releases\?per_page=100&page=([1-9][0-9]*)$')) {
            $taskResponse=@{status=200;body=@(if($Matches[1] -ceq '1' -and $taskState.release){$taskState.release})}
        } elseif ($Request.method -ceq 'POST' -and $Request.path -ceq ($taskPrefix+'/releases')) {
            Assert-PublishTest ($null -ne $taskState.ref) 'A draft must never implicitly create its own tag.'
            $taskState.release=@{id=77;tag_name=$Request.body.tag_name;target_commitish=$Request.body.target_commitish;
                body=$Request.body.body;draft=$Request.body.draft;prerelease=$Request.body.prerelease;
                upload_url='https://uploads.github.com/repos/joaobispo2077/rustcorder/releases/77/assets{?name,label}'}
            $taskResponse=@{status=201;body=$taskState.release}
        } elseif ($Request.method -ceq 'GET' -and $Request.path -ceq ($taskPrefix+'/releases/77')) {
            $taskResponse=if($taskState.release){@{status=200;body=(Copy-PublishValue $taskState.release)}}else{@{status=404;body=$null}}
        } elseif ($Request.method -ceq 'GET' -and $Request.path -cmatch ('^'+[regex]::Escape($taskPrefix)+'/releases/77/assets\?per_page=100&page=([1-9][0-9]*)$')) {
            $taskResponse=@{status=200;body=@(if($Matches[1] -ceq '1'){$taskState.assets.ToArray()})}
        } elseif ($Request.method -ceq 'POST' -and $Request.path -cmatch ('^'+[regex]::Escape($taskPrefix)+'/releases/77/assets\?name=(.+)$')) {
            $taskName=[uri]::UnescapeDataString($Matches[1]);$taskBytes=[IO.File]::ReadAllBytes($Request.file)
            Assert-PublishTest (@($taskState.assets | Where-Object {$_.name -ceq $taskName}).Count -eq 0) 'Assets must never be overwritten.'
            $taskAsset=@{id=$taskState.next_id;name=$taskName;size=$taskBytes.Length;state='uploaded';bytes=$taskBytes}
            $taskState.next_id++;[void]$taskState.assets.Add($taskAsset)
            $taskResponse=@{status=201;body=$taskAsset}
        } elseif ($Request.method -ceq 'GET' -and $Request.download -and $Request.path -cmatch ('^'+[regex]::Escape($taskPrefix)+'/releases/assets/([1-9][0-9]*)$')) {
            $taskId=[long]$Matches[1];$taskAsset=@($taskState.assets | Where-Object {$_.id -eq $taskId})[0]
            $taskResponse=@{status=200;bytes=([byte[]]$taskAsset.bytes.Clone())}
        } elseif ($Request.method -ceq 'PATCH' -and $Request.path -ceq ($taskPrefix+'/releases/77')) {
            Assert-PublishTest ($Request.body.draft -is [bool] -and -not $Request.body.draft) 'Only verified draft publication is allowed.'
            $taskState.release.draft=$Request.body.draft;$taskResponse=@{status=200;body=$taskState.release}
        } else { throw ('Unexpected mock endpoint: '+$taskKey) }
        if ($taskFail -and $taskFail.key -ceq $taskKey -and $taskFail.remaining -gt 0 -and $taskFail.after) {
            $taskFail.remaining--;throw 'Controlled transport failure after operation.'
        }
        if($taskState.hook){& $taskState.hook $Request $taskState | Out-Null}
        return $taskResponse
    }.GetNewClosure()
    return @{root=$taskFixtureRoot;candidate=$taskCandidate;authorization=$taskAuthorization;state=$taskState;transport=$taskTransport}
}
function Invoke-PublishFixture($Fixture) {
    return Invoke-CiPublish -Candidate $Fixture.candidate -Root $Fixture.root -Authorization $Fixture.authorization -Transport $Fixture.transport
}
function Remove-PublishFixture($Fixture) {
    $taskFull = Assert-CiOwnedDirectory $Fixture.root
    if (-not $taskFull.StartsWith(([IO.Path]::GetFullPath((Join-Path $taskSetupRoot '.build'))+[IO.Path]::DirectorySeparatorChar),[StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe publisher fixture cleanup.' }
    Remove-Item -LiteralPath $taskFull -Recurse -Force
}

$taskFixture=New-PublishFixture
try {
    $taskFixture.authorization=$null
    Assert-PublishRejects {Invoke-PublishFixture $taskFixture} 'Absent approval was accepted.'
    Assert-PublishTest ($taskFixture.state.calls.Count -eq 0) 'Absent authorization must be rejected before any API operation.'
} finally {Remove-PublishFixture $taskFixture}

$taskFixture=New-PublishFixture
try {
    $taskResult=Invoke-PublishFixture $taskFixture
    Assert-PublishTest ($taskResult.status -ceq 'published' -and $taskResult.tag_object_sha -ceq ('e'*40) -and $taskResult.release_id -eq 77) 'Publication must retain exact annotated-tag/release identity.'
    $taskReceiptPath=Write-PublishReceipt $taskResult $taskFixture.root
    $taskSaved=Read-PublishJson $taskReceiptPath
    Assert-PublishTest ($taskSaved.candidate_sha256 -ceq $taskResult.candidate_sha256 -and $taskSaved.release_sha256 -ceq $taskResult.release_sha256) 'Successful publication receipt was not persisted under its attachment root.'
    $taskReceiptHash=Get-CiSha256 $taskReceiptPath
    Write-PublishReceipt $taskResult $taskFixture.root | Out-Null
    Assert-PublishTest ((Get-CiSha256 $taskReceiptPath) -ceq $taskReceiptHash) 'An identical receipt retry changed existing evidence.'
    $taskConflictingReceipt=Copy-PublishValue $taskResult;$taskConflictingReceipt.release_id=999
    Assert-PublishRejects {Write-PublishReceipt $taskConflictingReceipt $taskFixture.root} 'Conflicting local publication evidence was overwritten.'
    Assert-PublishTest ((Get-CiSha256 $taskReceiptPath) -ceq $taskReceiptHash) 'Conflicting receipt write damaged retained evidence.'
    $taskWrites=@($taskFixture.state.calls | Where-Object {$_.method -ne 'GET'})
    Assert-PublishTest ($taskWrites[0].path.EndsWith('/git/tags') -and $taskWrites[1].path.EndsWith('/git/refs') -and $taskWrites[1].body.ref -ceq 'refs/tags/v0.1.0') 'Annotated tag object/reference order was not preserved.'
    Assert-PublishTest ($taskWrites[2].body.draft -eq $true -and $taskWrites[-1].method -ceq 'PATCH') 'Draft/upload/verify/publication order was not preserved.'
    Assert-PublishTest (@($taskFixture.state.calls | Where-Object {$_.download}).Count -eq 2) 'Every staged asset must be downloaded and hashed.'
    foreach($taskRequest in $taskFixture.state.calls) {
        $taskUri=Get-PublishRequestUri $taskRequest
        Assert-PublishTest ($taskUri.Host -cin @('api.github.com','uploads.github.com')) 'A real publisher operation escaped its fixed API hosts.'
    }
    $taskBefore=$taskWrites.Count
    $taskAgain=Invoke-PublishFixture $taskFixture
    Assert-PublishTest ($taskAgain.status -ceq 'published' -and @($taskFixture.state.calls | Where-Object {$_.method -ne 'GET'}).Count -eq $taskBefore) 'An identical published retry must perform no writes.'
    $taskFixture.candidate.candidate_sha256=('a'*64);$taskFixture.candidate.control.run_id=404
    Assert-PublishRejects {Invoke-PublishFixture $taskFixture} 'A new dispatch reused old authorization.'
    $taskFixture.authorization.candidate_sha256=('a'*64);$taskFixture.authorization.control.run_id=404
    $taskFresh=Invoke-PublishFixture $taskFixture
    Assert-PublishTest ($taskFresh.release_sha256 -ceq ('f'*64) -and @($taskFixture.state.calls | Where-Object {$_.method -ne 'GET'}).Count -eq $taskBefore) 'Fresh authorization could not reconcile the same immutable release identity.'
} finally {Remove-PublishFixture $taskFixture}

foreach($taskMutation in @(
    {$args[0].authorization.candidate_sha256=('f'*64)},
    {$args[0].authorization.environment_id=0},
    {$args[0].authorization.actor=''},
    {$args[0].authorization.control.run_attempt=2},
    {$args[0].authorization.control.source_sha=('f'*40)},
    {$args[0].candidate.source_sha=@('a'*40)},
    {$args[0].candidate.files[0].name='../escape.zip'},
    {$args[0].candidate.files[0].path='../escape.zip'},
    {$args[0].candidate.files[0].path='publication.json'},
    {$args[0].candidate.files[0].bytes='3'},
    {$args[0].candidate.files[0].sha256=('f'*64)},
    {$args[0].candidate.version='0.1.0-rc.1'},
    {$args[0].candidate.files+=Copy-PublishValue $args[0].candidate.files[0]},
    {$args[0].candidate.repository='someone/else'}
)) {
    $taskFixture=New-PublishFixture
    try {
        & $taskMutation $taskFixture
        Assert-PublishRejects {Invoke-PublishFixture $taskFixture} 'Invalid authorization/candidate/attachment binding was accepted.'
        Assert-PublishTest ($taskFixture.state.calls.Count -eq 0) 'Invalid local binding reached the remote API.'
    } finally {Remove-PublishFixture $taskFixture}
}

foreach($taskFailure in @(
    @{method='POST';suffix='/git/tags';after=$false},
    @{method='POST';suffix='/git/tags';after=$true},
    @{method='POST';suffix='/git/refs';after=$true},
    @{method='POST';suffix='/releases';after=$true},
    @{method='POST';suffix='/releases/77/assets?name=rustcorder-0.1.0-windows-x64.zip';after=$true},
    @{method='GET';suffix='/releases/assets/80';after=$false},
    @{method='PATCH';suffix='/releases/77';after=$true}
)) {
    $taskFixture=New-PublishFixture
    try {
        $taskFixture.state.fail=@{key=($taskFailure.method+' /repos/joaobispo2077/rustcorder'+$taskFailure.suffix);after=$taskFailure.after;remaining=1}
        Assert-PublishRejects {Invoke-PublishFixture $taskFixture} 'Controlled transport failure did not stop publication.'
        $taskResult=Invoke-PublishFixture $taskFixture
        Assert-PublishTest ($taskResult.status -ceq 'published' -and $taskFixture.state.assets.Count -eq 2) 'Identical retry did not reconcile a partial publication.'
    } finally {Remove-PublishFixture $taskFixture}
}

foreach($taskConflict in @('lightweight','wrong-target','wrong-marker','wrong-release','wrong-assets','unsafe-upload-url','changed-tip','unexpected-asset','duplicate-asset','different-release-hash')) {
    $taskFixture=New-PublishFixture
    try {
        Invoke-PublishFixture $taskFixture | Out-Null
        switch($taskConflict) {
            'lightweight' {$taskFixture.state.ref.object.type='commit'}
            'wrong-target' {$taskFixture.state.tag.object.sha=('f'*40)}
            'wrong-marker' {$taskFixture.state.tag.message='different candidate'}
            'wrong-release' {$taskFixture.state.release.target_commitish=('f'*40)}
            'wrong-assets' {$taskFixture.state.assets[0].bytes=[byte[]](120,120,120)}
            'unsafe-upload-url' {$taskFixture.state.release.upload_url='https://example.com/steal'}
            'changed-tip' {$taskFixture.state.tip=('f'*40)}
            'unexpected-asset' {[void]$taskFixture.state.assets.Add(@{id=999;name='unexpected.txt';size=3;state='uploaded';bytes=[byte[]](97,98,99)})}
            'duplicate-asset' {$taskDuplicate=Copy-PublishValue $taskFixture.state.assets[0];$taskDuplicate.id=999;[void]$taskFixture.state.assets.Add($taskDuplicate)}
            'different-release-hash' {$taskFixture.candidate.release_sha256=('a'*64)}
        }
        $taskWriteCount=@($taskFixture.state.calls | Where-Object {$_.method -ne 'GET'}).Count
        Assert-PublishRejects {Invoke-PublishFixture $taskFixture} ('Conflicting release state was accepted: '+$taskConflict)
        Assert-PublishTest (@($taskFixture.state.calls | Where-Object {$_.method -ne 'GET'}).Count -eq $taskWriteCount) 'Conflict reconciliation must not overwrite/delete any release state.'
    } finally {Remove-PublishFixture $taskFixture}
}

$taskFixture=New-PublishFixture
try {
    $taskFixture.state.hook={
        param($Request,$State)
        if($Request.method -ceq 'POST' -and $Request.path.Contains('/assets?name=')){$State.tip=('f'*40)}
    }
    Assert-PublishRejects {Invoke-PublishFixture $taskFixture} 'A release tip changed during staging was accepted.'
    Assert-PublishTest ($taskFixture.state.release.draft -eq $true -and @($taskFixture.state.calls | Where-Object {$_.method -ceq 'PATCH'}).Count -eq 0) 'Changed final tip must retain the unpublished draft.'
} finally {Remove-PublishFixture $taskFixture}

$taskFixture=New-PublishFixture
try {
    $taskEnv=@{GITHUB_ACTIONS='true';GITHUB_REPOSITORY='joaobispo2077/rustcorder';GITHUB_REPOSITORY_ID='101';
        GITHUB_REF='refs/heads/main';GITHUB_WORKFLOW_REF='joaobispo2077/rustcorder/.github/workflows/release.yml@refs/heads/main';
        GITHUB_WORKFLOW_SHA=('c'*40);GITHUB_SHA=('c'*40);GITHUB_RUN_ID='303';GITHUB_RUN_ATTEMPT='1';GITHUB_EVENT_NAME='workflow_dispatch';GITHUB_ACTOR='dispatcher'}
    $taskRun=@{id=303;run_attempt=1;workflow_id=202;head_sha=('c'*40);head_branch='main';event='workflow_dispatch';status='in_progress';
        path='.github/workflows/release.yml';actor=@{login='dispatcher'};repository=@{id=101;full_name='joaobispo2077/rustcorder'};head_repository=@{id=101}}
    Assert-PublishTrustedControl $taskFixture.candidate $taskFixture.authorization $taskEnv $taskRun
    foreach($taskField in @('GITHUB_ACTIONS','GITHUB_REF','GITHUB_WORKFLOW_REF','GITHUB_WORKFLOW_SHA','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_EVENT_NAME','GITHUB_ACTOR','GITHUB_REPOSITORY','GITHUB_REPOSITORY_ID')) {
        $taskBad=$taskEnv.Clone();$taskBad[$taskField]='different'
        Assert-PublishRejects {Assert-PublishTrustedControl $taskFixture.candidate $taskFixture.authorization $taskBad $taskRun} ('Untrusted control environment accepted: '+$taskField)
    }
    foreach($taskField in @('id','run_attempt','workflow_id','head_sha','head_branch','event','status','path')) {
        $taskBad=Copy-PublishValue $taskRun;$taskBad[$taskField]=if($taskBad[$taskField] -is [string]){'different'}else{999}
        Assert-PublishRejects {Assert-PublishTrustedControl $taskFixture.candidate $taskFixture.authorization $taskEnv $taskBad} ('Substituted actual control API field accepted: '+$taskField)
    }
} finally {Remove-PublishFixture $taskFixture}

$taskPrefix='/repos/joaobispo2077/rustcorder'
Assert-PublishTest ((Get-PublishRequestUri @{method='GET';path=($taskPrefix+'/git/ref/heads/release')}).Host -ceq 'api.github.com') 'Fixed read API host is wrong.'
Assert-PublishTest ((Get-PublishRequestUri @{method='POST';path=($taskPrefix+'/releases/77/assets?name=notes.md');file='fixture'}).Host -ceq 'uploads.github.com') 'Fixed upload API host is wrong.'
foreach($taskRequest in @(
    @{method='POST';path=($taskPrefix+'/git/refs/heads/main');body=@{}},
    @{method='POST';path=($taskPrefix+'/git/refs');body=@{ref='refs/heads/main';sha=('a'*40)}},
    @{method='DELETE';path=($taskPrefix+'/releases/77')},
    @{method='GET';path='https://example.com/steal'},
    @{method='GET';path='/repos/someone/else/releases'},
    @{method='GET';path=($taskPrefix+'/../secret')},
    @{method='POST';path=($taskPrefix+'/releases/77/assets?name=../escape');file='fixture'},
    @{method='GET';path=($taskPrefix+'/releases/assets/80');download='true'},
    @{method='GET';path=($taskPrefix+'/releases/assets/80');download=$true;max_bytes=0},
    @{method=@('POST','DELETE');path=($taskPrefix+'/releases')},
    @{method='GET';path=($taskPrefix+'/git/ref/heads/release');headers=@{Authorization='other'}}
)) { Assert-PublishRejects {Get-PublishRequestUri $taskRequest} 'Unsafe publication transport endpoint/options were accepted.' }
Assert-PublishTest ((Get-PublishRedirectUri 'https://release-assets.githubusercontent.com/owned/object?sig=frozen' 'joaobispo2077/rustcorder').Host -ceq 'release-assets.githubusercontent.com') 'GitHub signed asset redirect was refused.'
foreach($taskLocation in @('http://release-assets.githubusercontent.com/object','https://example.com/steal','https://release-assets.githubusercontent.com@evil.example/object','https://uploads.github.com/object','https://github.com/someone/else/releases/download/v0.1.0/a.zip')) {
    Assert-PublishRejects {Get-PublishRedirectUri $taskLocation 'joaobispo2077/rustcorder'} 'Unsafe binary-download redirect accepted.'
}

$taskResponse=[Net.Http.HttpResponseMessage]::new([Net.HttpStatusCode]::OK)
$taskCancellation=[Threading.CancellationTokenSource]::new()
try {
    $taskResponse.Content=[Net.Http.ByteArrayContent]::new([byte[]](97,98,99))
    $taskBytes=Read-PublishHttpBytes $taskResponse 3 $taskCancellation.Token
    Assert-PublishTest ($taskBytes -is [byte[]] -and $taskBytes.Length -eq 3 -and $taskBytes[0] -eq 97) 'Bounded HTTP reader changed staged binary bytes.'
    Assert-PublishRejects {Read-PublishHttpBytes $taskResponse 2 $taskCancellation.Token} 'Oversized HTTP content was accepted.'
} finally {$taskCancellation.Dispose();$taskResponse.Dispose()}

$taskResponse=[Net.Http.HttpResponseMessage]::new([Net.HttpStatusCode]::OK)
$taskCancellation=[Threading.CancellationTokenSource]::new()
try {
    $taskResponse.Content=[Net.Http.ByteArrayContent]::new([byte[]](97,98,99))
    $taskResponse.Content.Headers.ContentLength=$null
    Assert-PublishRejects {Read-PublishHttpBytes $taskResponse 2 $taskCancellation.Token} 'Unannounced streamed response growth was accepted.'
} finally {$taskCancellation.Dispose();$taskResponse.Dispose()}

$taskFixture=New-PublishFixture
try {
    $taskJunction=Join-Path $taskFixture.root 'redirected'
    if([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
        New-Item -ItemType Junction -Path $taskJunction -Target $taskFixture.root | Out-Null
    } else {New-Item -ItemType SymbolicLink -Path $taskJunction -Target $taskFixture.root | Out-Null}
    try {
        $taskFixture.candidate.files[0].path='redirected/app.zip'
        Assert-PublishRejects {Invoke-PublishFixture $taskFixture} 'Redirected attachment parent was accepted.'
        Assert-PublishTest ($taskFixture.state.calls.Count -eq 0) 'Redirected attachment reached a remote API operation.'
    } finally {Remove-Item -LiteralPath $taskJunction -Force}
} finally {Remove-PublishFixture $taskFixture}

$taskFixture=New-PublishFixture
try {
    $taskFixture.state.ci.run_attempt=2
    Assert-PublishRejects {Invoke-PublishFixture $taskFixture} 'A newer same-SHA CI attempt was accepted before tag creation.'
    Assert-PublishTest (@($taskFixture.state.calls | Where-Object {$_.method -ne 'GET'}).Count -eq 0) 'Stale CI approval created remote state before refusal.'
} finally {Remove-PublishFixture $taskFixture}

$taskFixture=New-PublishFixture
try {
    $taskFixture.state.hook={
        param($Request,$State)
        if($Request.method -ceq 'GET' -and $Request.path.Contains('/releases?')){$State.ci.run_attempt=2}
    }
    Assert-PublishRejects {Invoke-PublishFixture $taskFixture} 'CI changed during initial reads but an annotated tag was still created.'
    Assert-PublishTest (@($taskFixture.state.calls | Where-Object {$_.method -ne 'GET'}).Count -eq 0) 'A tag write bypassed its immediately preceding CI recheck.'
} finally {Remove-PublishFixture $taskFixture}

$taskFixture=New-PublishFixture
try {
    $taskFixture.state.hook={
        param($Request,$State)
        if($Request.method -ceq 'POST' -and $Request.path.Contains('/assets?name=')){$State.ci.run_attempt=2}
    }
    Assert-PublishRejects {Invoke-PublishFixture $taskFixture} 'A same-SHA CI rerun during uploads was published under old approval.'
    Assert-PublishTest ($taskFixture.state.release.draft -eq $true -and @($taskFixture.state.calls | Where-Object {$_.method -ceq 'PATCH'}).Count -eq 0) 'Stale CI attempt must retain the unpublished draft.'
} finally {Remove-PublishFixture $taskFixture}

foreach($taskField in @('body','target_commitish')) {
    $taskFixture=New-PublishFixture
    try {
        $taskFixture.state.change_field=$taskField
        $taskFixture.state.hook={
            param($Request,$State)
            if($Request.method -ceq 'POST' -and $Request.path.Contains('/assets?name=')) {
                $State.release[$State.change_field]='changed-after-approval'
            }
        }
        Assert-PublishRejects {Invoke-PublishFixture $taskFixture} ('A draft '+$taskField+' changed during staging was accepted.')
        Assert-PublishTest ($taskFixture.state.release.draft -eq $true -and @($taskFixture.state.calls | Where-Object {$_.method -ceq 'PATCH'}).Count -eq 0) ('Conflicting draft '+$taskField+' became public before rejection.')
    } finally {Remove-PublishFixture $taskFixture}
}

foreach($taskMutation in @(
    {$args[0].candidate.ci.repository='someone/else'},
    {$args[0].candidate.ci.source_sha=('f'*40)},
    {$args[0].candidate.ci.source_sha=@('a'*40)},
    {$args[0].candidate.ci.run_id='404'},
    {$args[0].candidate.ci.run_attempt=0},
    {$args[0].candidate.ci.workflow_id=$false},
    {$args[0].candidate.ci.repository_id=0}
)) {
    $taskFixture=New-PublishFixture
    try {
        & $taskMutation $taskFixture
        Assert-PublishRejects {Invoke-PublishFixture $taskFixture} 'Invalid frozen CI binding was accepted.'
        Assert-PublishTest ($taskFixture.state.calls.Count -eq 0) 'Invalid CI binding reached a remote operation.'
    } finally {Remove-PublishFixture $taskFixture}
}

foreach($taskField in @('id','run_attempt','workflow_id','head_sha','event','head_branch','path','status','conclusion')) {
    $taskFixture=New-PublishFixture
    try {
        $taskFixture.state.ci[$taskField]=if($taskFixture.state.ci[$taskField] -is [string]){'different'}else{999}
        Assert-PublishRejects {Invoke-PublishFixture $taskFixture} ('Substituted actual source CI field was accepted: '+$taskField)
        Assert-PublishTest (@($taskFixture.state.calls | Where-Object {$_.method -ne 'GET'}).Count -eq 0) 'Invalid actual CI identity created a tag or release.'
    } finally {Remove-PublishFixture $taskFixture}
}

foreach($taskRepository in @('repository','head_repository')) {
    $taskFixture=New-PublishFixture
    try {
        $taskFixture.state.ci[$taskRepository].id=999
        Assert-PublishRejects {Invoke-PublishFixture $taskFixture} 'Actual source CI repository substitution was accepted.'
        Assert-PublishTest (@($taskFixture.state.calls | Where-Object {$_.method -ne 'GET'}).Count -eq 0) 'CI origin mismatch created remote state.'
    } finally {Remove-PublishFixture $taskFixture}
}

$taskFixture=New-PublishFixture
try {
    $taskFixture.state.hook={
        param($Request,$State)
        if($Request.method -ceq 'POST' -and $Request.path.EndsWith('/git/tags')){$State.ci.run_attempt=2}
    }
    Assert-PublishRejects {Invoke-PublishFixture $taskFixture} 'A CI rerun after tag-object creation still created its public reference.'
    Assert-PublishTest ($null -eq $taskFixture.state.ref -and $null -eq $taskFixture.state.release) 'Stale source CI approval created a tag reference or draft.'
} finally {Remove-PublishFixture $taskFixture}

Write-Output 'Publisher boundary checks passed: exact approval/CI identity, late-rerun and draft-mutation refusal, annotated tags, verified assets and immutable retries.'
