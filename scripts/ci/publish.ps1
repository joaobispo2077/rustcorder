[CmdletBinding()]
param([string]$CandidateFile, [string]$AuthorizationFile, [string]$Root)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'setup-windows.ps1')

function Test-PublishInteger($Value, [long]$Minimum = 1, [long]$Maximum = 9007199254740991) {
    return ($Value -is [int] -or $Value -is [long] -or $Value -is [uint32] -or $Value -is [uint64] -or $Value -is [int16] -or $Value -is [byte]) -and $Value -ge $Minimum -and $Value -le $Maximum
}

function Assert-PublishHash($Value, [int]$Length) {
    if ($Value -isnot [string] -or $Value.Length -ne $Length -or $Value -cnotmatch '^[a-f0-9]+$') { throw 'Invalid publication hash binding.' }
}

function Assert-PublishControl($Control) {
    foreach ($taskField in @('run_id','run_attempt','workflow_id')) {
        if (-not (Test-PublishInteger $Control.$taskField)) { throw 'Invalid publication control identity.' }
    }
    Assert-PublishHash $Control.source_sha 40
}

function Assert-PublishFileName($Name) {
    if ($Name -isnot [string] -or $Name -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$' -or $Name.EndsWith('.') -or $Name -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Unsafe release attachment basename.' }
}

function Assert-PublishLocalFile($File, [string]$Root) {
    Assert-PublishFileName $File.name
    if ($File.path -isnot [string]) { throw 'Attachment path must be a string.' }
    $taskRelative = Assert-CiRelativePath $File.path
    if($taskRelative -ieq 'publication.json') { throw 'Publication receipt path is reserved and cannot be an input attachment.' }
    Assert-PublishHash $File.sha256 64
    if (-not (Test-PublishInteger $File.bytes 1 536870912)) { throw 'Invalid attachment byte count.' }
    $taskPath = Assert-CiOwnedDirectory ([IO.Path]::GetFullPath((Join-Path $Root $taskRelative)))
    if (-not $taskPath.StartsWith($Root+[IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Attachment escaped its owned root.' }
    $taskItem = Get-Item -LiteralPath $taskPath -Force
    if ($taskItem.PSIsContainer -or $taskItem.Length -ne $File.bytes -or (Get-CiSha256 $taskPath) -cne $File.sha256) { throw 'Attachment bytes/hash mismatch.' }
    return $taskPath
}

function Assert-PublishBinding($Candidate, $Authorization, [string]$Root) {
    if (-not (Test-PublishInteger $Candidate.schema_version 1 1) -or $Candidate.kind -isnot [string] -or $Candidate.kind -cne 'release-candidate') { throw 'Unsupported publication candidate.' }
    $taskRepository = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'policy.json') -Raw | ConvertFrom-Json).repository
    if ($Candidate.repository -isnot [string] -or $Candidate.repository -cne $taskRepository -or $Candidate.repository -cnotmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Unexpected publication repository.' }
    if ($Candidate.version -isnot [string] -or $Candidate.version -cnotmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw 'Publication requires stable SemVer.' }
    foreach ($taskField in @('source_sha','tree_sha')) { Assert-PublishHash $Candidate.$taskField 40 }
    foreach ($taskField in @('candidate_sha256','release_sha256')) { Assert-PublishHash $Candidate.$taskField 64 }
    foreach ($taskField in @('run_id','run_attempt','workflow_id','repository_id')) {
        if (-not (Test-PublishInteger $Candidate.ci.$taskField)) { throw 'Invalid frozen source CI identity.' }
    }
    Assert-PublishHash $Candidate.ci.source_sha 40
    if ($Candidate.ci.repository -isnot [string] -or $Candidate.ci.repository -cne $Candidate.repository -or
        $Candidate.ci.source_sha -cne $Candidate.source_sha) { throw 'Source CI belongs to another repository or commit.' }
    Assert-PublishControl $Candidate.control
    Assert-PublishControl $Authorization.control
    if ($Authorization.candidate_sha256 -isnot [string] -or $Authorization.candidate_sha256 -cne $Candidate.candidate_sha256 -or
        $Authorization.actor -isnot [string] -or $Authorization.actor -cnotmatch '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$' -or
        -not (Test-PublishInteger $Authorization.environment_id)) { throw 'Missing exact candidate/environment reviewer authorization.' }
    foreach ($taskField in @('run_id','run_attempt','workflow_id','source_sha')) {
        if ($Authorization.control.$taskField -cne $Candidate.control.$taskField) { throw 'Authorization belongs to another control run/attempt.' }
    }
    if ($null -ne $Candidate.notes -and ($Candidate.notes -isnot [string] -or $Candidate.notes.Length -gt 262144 -or $Candidate.notes.Contains([char]0))) { throw 'Invalid frozen release notes.' }
    $taskRoot = Assert-CiOwnedDirectory $Root
    if (-not (Test-Path -LiteralPath $taskRoot -PathType Container)) { throw 'Publication attachments root is missing.' }
    if ($Candidate.files -isnot [array] -or $Candidate.files.Count -lt 1 -or $Candidate.files.Count -gt 16) { throw 'Invalid publication attachment inventory.' }
    $taskNames = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $taskPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $taskTotal = 0L
    foreach ($taskFile in $Candidate.files) {
        $taskPath = Assert-PublishLocalFile $taskFile $taskRoot
        if (-not $taskNames.Add($taskFile.name) -or -not $taskPaths.Add($taskPath)) { throw 'Duplicate/case-colliding release attachment.' }
        $taskTotal += $taskFile.bytes
    }
    if ($taskTotal -gt 536870912) { throw 'Publication attachment inventory exceeds its total bound.' }
    return $taskRoot
}

function Invoke-PublishApi([scriptblock]$Transport, [string]$Method, [string]$Path, $Body = $null, [string]$File = '', [switch]$Download, [long]$MaxBytes = 8388608, [switch]$AllowNotFound) {
    $taskRequest = @{method=$Method;path=$Path}
    if ($null -ne $Body) { $taskRequest.body=$Body }
    if ($File) { $taskRequest.file=$File }
    if ($Download) { $taskRequest.download=$true;$taskRequest.max_bytes=$MaxBytes }
    try { $taskResponse = & $Transport $taskRequest }
    catch { throw ('Publication transport failed at '+$Method+' '+$Path+'; retain state for an identical authorized retry.') }
    if (-not (Test-PublishInteger $taskResponse.status 100 599)) { throw 'Malformed publication transport response.' }
    if ($AllowNotFound -and $taskResponse.status -eq 404) { return $null }
    if ($taskResponse.status -lt 200 -or $taskResponse.status -gt 299) { throw ('Publication API failed with HTTP '+$taskResponse.status) }
    if ($Download) {
        if ($taskResponse.bytes -isnot [byte[]] -or $taskResponse.bytes.Length -gt $MaxBytes) { throw 'Malformed/oversized staged asset bytes.' }
        return ,$taskResponse.bytes
    }
    return ,$taskResponse.body
}

function Assert-PublishResponseUrls($Value, [string]$Repository) {
    foreach ($taskField in @('url','upload_url','browser_download_url')) {
        $taskText=$Value.$taskField
        if ($null -eq $taskText) { continue }
        if ($taskText -isnot [string] -or $taskText.Length -gt 2048) { throw 'Malformed release response URL.' }
        $taskText=$taskText.Replace('{?name,label}','')
        $taskUri=$null
        if (-not [uri]::TryCreate($taskText,[UriKind]::Absolute,[ref]$taskUri) -or $taskUri.Scheme -cne 'https' -or $taskUri.UserInfo -or $taskUri.Port -ne 443 -or $taskUri.Fragment) { throw 'Unsafe release response URL.' }
        $taskHost=if($taskField -ceq 'upload_url'){'uploads.github.com'}elseif($taskField -ceq 'browser_download_url'){'github.com'}else{'api.github.com'}
        $taskPrefix=if($taskField -ceq 'browser_download_url'){'/'+$Repository+'/releases/'}else{'/repos/'+$Repository+'/'}
        if ($taskUri.Host -cne $taskHost -or -not $taskUri.AbsolutePath.StartsWith($taskPrefix,[StringComparison]::Ordinal)) { throw 'Release response URL escaped its fixed GitHub repository/host.' }
    }
}

function Get-PublishPages([scriptblock]$Transport, [string]$Path) {
    $taskItems=New-Object 'System.Collections.Generic.List[object]'
    $taskIds=New-Object 'System.Collections.Generic.HashSet[long]'
    for($taskPage=1;$taskPage -le 100;$taskPage++) {
        $taskValues=Invoke-PublishApi $Transport 'GET' ($Path+'?per_page=100&page='+$taskPage)
        if ($taskValues -isnot [array] -or $taskValues.Count -gt 100) { throw 'Malformed paginated release inventory.' }
        foreach($taskValue in $taskValues) {
            if (-not (Test-PublishInteger $taskValue.id) -or -not $taskIds.Add([long]$taskValue.id)) { throw 'Duplicate/malformed paginated release identity.' }
            [void]$taskItems.Add($taskValue)
        }
        if ($taskValues.Count -lt 100) { return ,$taskItems.ToArray() }
    }
    throw 'Release inventory exceeded bounded pagination.'
}

function Assert-PublishTip([scriptblock]$Transport, [string]$Prefix, [string]$SourceSha) {
    $taskTip=Invoke-PublishApi $Transport 'GET' ($Prefix+'/git/ref/heads/release')
    if ($taskTip.ref -isnot [string] -or $taskTip.ref -cne 'refs/heads/release' -or $taskTip.object.type -isnot [string] -or $taskTip.object.type -cne 'commit' -or $taskTip.object.sha -isnot [string] -or $taskTip.object.sha -cne $SourceSha) { throw 'Release tip changed since authorization.' }
}

function Assert-PublishSourceState([scriptblock]$Transport, $Candidate) {
    $taskPrefix='/repos/'+$Candidate.repository
    Assert-PublishTip $Transport $taskPrefix $Candidate.source_sha
    $taskRun=Invoke-PublishApi $Transport 'GET' ($taskPrefix+'/actions/runs/'+$Candidate.ci.run_id)
    foreach($taskPair in @(@('id','run_id'),@('run_attempt','run_attempt'),@('workflow_id','workflow_id'))) {
        if(-not (Test-PublishInteger $taskRun.($taskPair[0])) -or $taskRun.($taskPair[0]) -cne $Candidate.ci.($taskPair[1])) {
            throw 'Source CI run, latest attempt or workflow changed since approval.'
        }
    }
    foreach($taskRepository in @($taskRun.repository,$taskRun.head_repository)) {
        if(-not (Test-PublishInteger $taskRepository.id) -or $taskRepository.id -ne $Candidate.ci.repository_id -or
            $taskRepository.full_name -isnot [string] -or $taskRepository.full_name -cne $Candidate.repository) {
            throw 'Source CI repository/origin changed since approval.'
        }
    }
    if($taskRun.head_sha -isnot [string] -or $taskRun.head_sha -cne $Candidate.source_sha -or
        $taskRun.path -isnot [string] -or $taskRun.path.Split('@')[0] -cne '.github/workflows/ci.yml' -or
        $taskRun.event -isnot [string] -or $taskRun.event -cne 'push' -or
        $taskRun.head_branch -isnot [string] -or $taskRun.head_branch -cne 'release' -or
        $taskRun.status -isnot [string] -or $taskRun.status -cne 'completed' -or
        $taskRun.conclusion -isnot [string] -or $taskRun.conclusion -cne 'success') {
        throw 'Source CI is not the frozen successful actual release push.'
    }
}

function Get-PublishTag([scriptblock]$Transport, [string]$Prefix, [string]$TagName, [string]$SourceSha, [string]$Message) {
    $taskRef=Invoke-PublishApi $Transport 'GET' ($Prefix+'/git/ref/tags/'+$TagName) -AllowNotFound
    if ($null -eq $taskRef) { return $null }
    if ($taskRef.ref -isnot [string] -or $taskRef.ref -cne ('refs/tags/'+$TagName) -or $taskRef.object.type -isnot [string] -or $taskRef.object.type -cne 'tag') { throw 'Existing product tag must be the exact annotated tag.' }
    Assert-PublishHash $taskRef.object.sha 40
    $taskTag=Invoke-PublishApi $Transport 'GET' ($Prefix+'/git/tags/'+$taskRef.object.sha)
    if ($taskTag.sha -isnot [string] -or $taskTag.sha -cne $taskRef.object.sha -or $taskTag.tag -isnot [string] -or $taskTag.tag -cne $TagName -or $taskTag.object.type -isnot [string] -or $taskTag.object.type -cne 'commit' -or $taskTag.object.sha -isnot [string] -or $taskTag.object.sha -cne $SourceSha -or $taskTag.message -isnot [string] -or $taskTag.message.TrimEnd("`r","`n") -cne $Message) { throw 'Existing annotated tag conflicts with the frozen release identity.' }
    return $taskTag
}

function Assert-PublishRelease($Release, $Candidate, [string]$Body) {
    if (-not (Test-PublishInteger $Release.id) -or $Release.tag_name -isnot [string] -or $Release.tag_name -cne ('v'+$Candidate.version) -or $Release.target_commitish -isnot [string] -or $Release.target_commitish -cne $Candidate.source_sha -or $Release.body -isnot [string] -or $Release.body -cne $Body -or $Release.draft -isnot [bool] -or $Release.prerelease -isnot [bool] -or $Release.prerelease) { throw 'Existing/created release conflicts with the frozen release identity.' }
    Assert-PublishResponseUrls $Release $Candidate.repository
}

function Assert-PublishAsset($Asset, $File, [string]$Repository) {
    if (-not (Test-PublishInteger $Asset.id) -or $Asset.name -isnot [string] -or $Asset.name -cne $File.name -or -not (Test-PublishInteger $Asset.size 1 536870912) -or $Asset.size -ne $File.bytes -or $Asset.state -isnot [string] -or $Asset.state -cne 'uploaded') { throw 'Conflicting/incomplete staged release attachment.' }
    if ($null -ne $Asset.digest -and ($Asset.digest -isnot [string] -or $Asset.digest -cne ('sha256:'+$File.sha256))) { throw 'Staged release attachment API digest mismatch.' }
    Assert-PublishResponseUrls $Asset $Repository
}

function Assert-PublishAssetBytes([scriptblock]$Transport, [string]$Prefix, $Asset, $File) {
    $taskBytes=Invoke-PublishApi $Transport 'GET' ($Prefix+'/releases/assets/'+$Asset.id) -Download -MaxBytes $File.bytes
    $taskAlgorithm=[Security.Cryptography.SHA256]::Create()
    try { $taskHash=[BitConverter]::ToString($taskAlgorithm.ComputeHash($taskBytes)).Replace('-','').ToLowerInvariant() }
    finally { $taskAlgorithm.Dispose() }
    if ($taskBytes.Length -ne $File.bytes -or $taskHash -cne $File.sha256) { throw 'Downloaded staged release bytes differ from the tested attachment.' }
}

function Get-PublishRequestUri($Request) {
    if ($Request -isnot [Collections.IDictionary]) { throw 'Publication transport requires a fixed request object.' }
    if ($Request.method -isnot [string]) { throw 'Publication method must be a fixed string.' }
    foreach($taskKey in $Request.Keys) {
        if($taskKey -cnotin @('method','path','body','file','download','max_bytes')) { throw 'Unsupported publication transport option.' }
    }
    $taskRepository=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'policy.json') -Raw | ConvertFrom-Json).repository
    $taskPrefix='/repos/'+$taskRepository;$taskTail=''
    if($Request.path -isnot [string] -or $Request.path.Length -gt 512 -or -not $Request.path.StartsWith($taskPrefix+'/',[StringComparison]::Ordinal)) { throw 'Publication transport escaped its fixed repository.' }
    $taskTail=$Request.path.Substring($taskPrefix.Length)
    $taskVersion='v(?:0|[1-9][0-9]{0,})\.(?:0|[1-9][0-9]{0,})\.(?:0|[1-9][0-9]{0,})'
    $taskUpload=$Request.method -ceq 'POST' -and $taskTail -cmatch '^/releases/[1-9][0-9]{0,}/assets\?name=[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
    $taskRead=$Request.method -ceq 'GET' -and $taskTail -cmatch ('^(?:/git/ref/heads/release|/git/ref/tags/'+$taskVersion+'|/git/tags/[a-f0-9]{40}|/releases(?:/[1-9][0-9]{0,}/assets)?\?per_page=100&page=(?:[1-9][0-9]?|100)|/releases/[1-9][0-9]{0,}|/releases/assets/[1-9][0-9]{0,}|/actions/runs/[1-9][0-9]{0,})$')
    $taskWrite=($Request.method -ceq 'POST' -and $taskTail -cin @('/git/tags','/git/refs','/releases')) -or
        ($Request.method -ceq 'PATCH' -and $taskTail -cmatch '^/releases/[1-9][0-9]{0,}$')
    if(-not ($taskUpload -or $taskRead -or $taskWrite)) { throw 'Unsupported publication method/endpoint; branch writes are forbidden.' }
    if($Request.Contains('download') -and ($Request.download -isnot [bool] -or -not $Request.download -or $Request.method -cne 'GET' -or $taskTail -cnotmatch '^/releases/assets/[1-9][0-9]{0,}$')) { throw 'Binary download is restricted to fixed asset endpoints.' }
    if($Request.Contains('max_bytes') -and (-not $Request.download -or -not (Test-PublishInteger $Request.max_bytes 1 536870912))) { throw 'Invalid binary download bound.' }
    if($taskUpload) {
        if($Request.file -isnot [string] -or -not $Request.file -or $Request.Contains('body')) { throw 'Asset upload requires only its checked local file.' }
        Assert-PublishFileName $taskTail.Substring($taskTail.IndexOf('?name=')+6)
    } elseif($Request.Contains('file')) { throw 'Local files are restricted to fixed asset-upload endpoints.' }
    if($taskRead -and $Request.Contains('body')) { throw 'Read requests cannot carry publication bodies.' }
    if($taskWrite -and $null -eq $Request.body) { throw 'Missing fixed publication request body.' }
    if($taskTail -ceq '/git/refs') {
        if($Request.body.ref -isnot [string] -or $Request.body.ref -cnotmatch ('^refs/tags/'+$taskVersion+'$')) { throw 'Only an explicit product tag reference can be created.' }
        Assert-PublishHash $Request.body.sha 40
    }
    if($taskTail -ceq '/git/tags') {
        if($Request.body.type -isnot [string] -or $Request.body.type -cne 'commit' -or $Request.body.tag -isnot [string] -or $Request.body.tag -cnotmatch ('^'+$taskVersion+'$')) { throw 'Only annotated product tags at an exact commit are supported.' }
        Assert-PublishHash $Request.body.object 40
    }
    if($Request.method -ceq 'PATCH' -and ($Request.body.draft -isnot [bool] -or $Request.body.draft)) { throw 'Only verified draft publication is supported.' }
    $taskHost=if($taskUpload){'https://uploads.github.com'}else{'https://api.github.com'}
    return [uri]($taskHost+$Request.path)
}

function Get-PublishRedirectUri([string]$Location, [string]$Repository) {
    $taskUri=$null
    if($Location.Length -gt 8192 -or -not [uri]::TryCreate($Location,[UriKind]::Absolute,[ref]$taskUri) -or $taskUri.Scheme -cne 'https' -or $taskUri.Port -ne 443 -or $taskUri.UserInfo -or $taskUri.Fragment) { throw 'Unsafe GitHub binary-download redirect.' }
    $taskSignedAsset=$taskUri.Host -ceq 'release-assets.githubusercontent.com'
    $taskGitHubDownload=$taskUri.Host -ceq 'github.com' -and $taskUri.AbsolutePath.StartsWith('/'+$Repository+'/releases/download/',[StringComparison]::Ordinal)
    if(-not ($taskSignedAsset -or $taskGitHubDownload)) { throw 'Binary-download redirect escaped GitHub release delivery.' }
    return $taskUri
}

function Assert-PublishTrustedEnvironment($Candidate, $Environment) {
    Assert-PublishControl $Candidate.control
    foreach($taskField in @('GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_REPOSITORY_ID','GITHUB_REF','GITHUB_WORKFLOW_REF','GITHUB_WORKFLOW_SHA','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','GITHUB_EVENT_NAME','GITHUB_ACTOR')) {
        if($Environment.$taskField -isnot [string]) { throw 'Missing actual GitHub control environment.' }
    }
    if($Environment.GITHUB_ACTIONS -cne 'true' -or $Environment.GITHUB_REPOSITORY -cne $Candidate.repository -or
        $Environment.GITHUB_REF -cne 'refs/heads/main' -or $Environment.GITHUB_EVENT_NAME -cne 'workflow_dispatch' -or
        $Environment.GITHUB_WORKFLOW_REF -cne ($Candidate.repository+'/.github/workflows/release.yml@refs/heads/main') -or
        $Environment.GITHUB_WORKFLOW_SHA -cne $Candidate.control.source_sha -or $Environment.GITHUB_SHA -cne $Candidate.control.source_sha) { throw 'Publisher must execute the frozen trusted-main release control.' }
    foreach($taskPair in @(@('GITHUB_RUN_ID','run_id'),@('GITHUB_RUN_ATTEMPT','run_attempt'))) {
        $taskValue=$Environment.($taskPair[0])
        if($taskValue -cnotmatch '^[1-9][0-9]{0,15}$' -or [long]$taskValue -ne $Candidate.control.($taskPair[1])) { throw 'Publisher control run/attempt mismatch.' }
    }
}

function Assert-PublishTrustedControl($Candidate, $Authorization, $Environment, $Run) {
    Assert-PublishTrustedEnvironment $Candidate $Environment
    Assert-PublishControl $Authorization.control
    if($Environment.GITHUB_REPOSITORY_ID -cnotmatch '^[1-9][0-9]{0,15}$' -or -not (Test-PublishInteger $Run.repository.id) -or
        [long]$Environment.GITHUB_REPOSITORY_ID -ne $Run.repository.id -or $Run.repository.full_name -isnot [string] -or
        $Run.repository.full_name -cne $Candidate.repository -or -not (Test-PublishInteger $Run.head_repository.id) -or $Run.head_repository.id -ne $Run.repository.id) { throw 'Actual control repository/origin mismatch.' }
    Assert-PublishControl @{run_id=$Run.id;run_attempt=$Run.run_attempt;workflow_id=$Run.workflow_id;source_sha=$Run.head_sha}
    foreach($taskPair in @(@('id','run_id'),@('run_attempt','run_attempt'),@('workflow_id','workflow_id'),@('head_sha','source_sha'))) {
        if($Run.($taskPair[0]) -cne $Candidate.control.($taskPair[1])) { throw 'Actual GitHub control identity changed.' }
    }
    if($Run.path -isnot [string] -or $Run.path.Split('@')[0] -cne '.github/workflows/release.yml' -or $Run.event -isnot [string] -or $Run.event -cne 'workflow_dispatch' -or $Run.head_branch -isnot [string] -or $Run.head_branch -cne 'main' -or $Run.status -isnot [string] -or $Run.status -cne 'in_progress' -or $Run.actor.login -isnot [string] -or $Run.actor.login -cne $Environment.GITHUB_ACTOR) { throw 'Actual release control workflow/event/actor is not trusted main.' }
}

function Invoke-CiPublish {
    param([Parameter(Mandatory=$true)]$Candidate, [Parameter(Mandatory=$true)][string]$Root,
        [Parameter(Mandatory=$true)]$Authorization, [Parameter(Mandatory=$true)][scriptblock]$Transport)
    $taskRoot=Assert-PublishBinding $Candidate $Authorization $Root
    $taskPrefix='/repos/'+$Candidate.repository;$taskTagName='v'+$Candidate.version
    $taskMarker='Release-SHA256: '+$Candidate.release_sha256
    $taskMessage='rustcorder '+$taskTagName+"`n`n"+$taskMarker+"`nSource-SHA: "+$Candidate.source_sha
    $taskBody=([string]$Candidate.notes)+"`n`n<!-- "+$taskMarker+" -->`nSource-SHA: "+$Candidate.source_sha
    Assert-PublishSourceState $Transport $Candidate
    $taskTag=Get-PublishTag $Transport $taskPrefix $taskTagName $Candidate.source_sha $taskMessage
    $taskReleases=Get-PublishPages $Transport ($taskPrefix+'/releases')
    $taskMatches=@($taskReleases | Where-Object {$_.tag_name -ceq $taskTagName})
    if ($taskMatches.Count -gt 1) { throw 'Ambiguous existing release for the product tag.' }
    $taskRelease=if($taskMatches.Count -eq 1){$taskMatches[0]}else{$null}
    if ($taskRelease) {
        Assert-PublishRelease $taskRelease $Candidate $taskBody
        if (-not $taskTag) { throw 'Release exists without its original annotated tag.' }
    }
    if (-not $taskTag) {
        Assert-PublishSourceState $Transport $Candidate
        $taskCreated=Invoke-PublishApi $Transport 'POST' ($taskPrefix+'/git/tags') @{
            tag=$taskTagName;message=$taskMessage;object=$Candidate.source_sha;type='commit'
            tagger=@{name=$Authorization.actor;email=($Authorization.actor+'@users.noreply.github.com')}
        }
        Assert-PublishHash $taskCreated.sha 40
        if ($taskCreated.tag -cne $taskTagName -or $taskCreated.object.type -cne 'commit' -or $taskCreated.object.sha -cne $Candidate.source_sha -or $taskCreated.message.TrimEnd("`r","`n") -cne $taskMessage) { throw 'Annotated tag creation returned conflicting identity.' }
        Assert-PublishSourceState $Transport $Candidate
        Invoke-PublishApi $Transport 'POST' ($taskPrefix+'/git/refs') @{ref=('refs/tags/'+$taskTagName);sha=$taskCreated.sha} | Out-Null
        $taskTag=Get-PublishTag $Transport $taskPrefix $taskTagName $Candidate.source_sha $taskMessage
        if (-not $taskTag -or $taskTag.sha -cne $taskCreated.sha) { throw 'Created tag reference did not retain its annotated object.' }
    }
    if (-not $taskRelease) {
        Assert-PublishSourceState $Transport $Candidate
        $taskRelease=Invoke-PublishApi $Transport 'POST' ($taskPrefix+'/releases') @{
            tag_name=$taskTagName;target_commitish=$Candidate.source_sha;name=('rustcorder '+$taskTagName)
            body=$taskBody;draft=$true;prerelease=$false;generate_release_notes=$false
        }
        Assert-PublishRelease $taskRelease $Candidate $taskBody
        if (-not $taskRelease.draft) { throw 'Release creation bypassed draft staging.' }
    }
    $taskAssets=Get-PublishPages $Transport ($taskPrefix+'/releases/'+$taskRelease.id+'/assets')
    foreach($taskAsset in $taskAssets) {
        if (@($Candidate.files | Where-Object {$_.name -ceq $taskAsset.name}).Count -ne 1) { throw 'Unexpected/ambiguous existing release attachment.' }
    }
    $taskVerified=New-Object 'System.Collections.Generic.List[object]'
    foreach($taskFile in $Candidate.files) {
        $taskMatches=@($taskAssets | Where-Object {$_.name -ceq $taskFile.name})
        if ($taskMatches.Count -gt 1) { throw 'Duplicate staged release attachment.' }
        if ($taskMatches.Count -eq 0) {
            if (-not $taskRelease.draft) { throw 'Published release is missing its original tested attachment.' }
            $taskPath=Assert-PublishLocalFile $taskFile $taskRoot
            $taskAsset=Invoke-PublishApi $Transport 'POST' ($taskPrefix+'/releases/'+$taskRelease.id+'/assets?name='+[uri]::EscapeDataString($taskFile.name)) -File $taskPath
        } else { $taskAsset=$taskMatches[0] }
        Assert-PublishAsset $taskAsset $taskFile $Candidate.repository
        Assert-PublishAssetBytes $Transport $taskPrefix $taskAsset $taskFile
        [void]$taskVerified.Add(@{id=$taskAsset.id;name=$taskFile.name;bytes=$taskFile.bytes;sha256=$taskFile.sha256})
    }
    $taskLatest=Get-PublishPages $Transport ($taskPrefix+'/releases/'+$taskRelease.id+'/assets')
    if ($taskLatest.Count -ne $taskVerified.Count) { throw 'Release attachment inventory changed before publication.' }
    foreach($taskAsset in $taskLatest) {
        $taskMatches=@($taskVerified | Where-Object {$_.id -eq $taskAsset.id -and $_.name -ceq $taskAsset.name})
        if ($taskMatches.Count -ne 1) { throw 'Release attachment identity changed before publication.' }
        Assert-PublishAsset $taskAsset @($Candidate.files | Where-Object {$_.name -ceq $taskAsset.name})[0] $Candidate.repository
    }
    Assert-PublishSourceState $Transport $Candidate
    $taskCurrentTag=Get-PublishTag $Transport $taskPrefix $taskTagName $Candidate.source_sha $taskMessage
    if (-not $taskCurrentTag -or $taskCurrentTag.sha -cne $taskTag.sha) { throw 'Annotated tag changed before publication.' }
    $taskCurrentRelease=Invoke-PublishApi $Transport 'GET' ($taskPrefix+'/releases/'+$taskRelease.id)
    if(-not (Test-PublishInteger $taskCurrentRelease.id) -or $taskCurrentRelease.id -ne $taskRelease.id) { throw 'Draft release identity changed before publication.' }
    Assert-PublishRelease $taskCurrentRelease $Candidate $taskBody
    $taskRelease=$taskCurrentRelease
    Assert-PublishSourceState $Transport $Candidate
    if ($taskRelease.draft) {
        $taskRelease=Invoke-PublishApi $Transport 'PATCH' ($taskPrefix+'/releases/'+$taskRelease.id) @{draft=$false;make_latest='true'}
        Assert-PublishRelease $taskRelease $Candidate $taskBody
        if ($taskRelease.draft) { throw 'Verified release draft did not become public.' }
    }
    return [pscustomobject]@{schema_version=1;kind='published-release';status='published';repository=$Candidate.repository;
        version=$Candidate.version;source_sha=$Candidate.source_sha;candidate_sha256=$Candidate.candidate_sha256;
        release_sha256=$Candidate.release_sha256;tag_name=$taskTagName;tag_object_sha=$taskTag.sha;
        release_id=$taskRelease.id;assets=$taskVerified.ToArray()}
}

function Read-PublishHttpBytes($Response, [long]$Maximum, [Threading.CancellationToken]$Cancellation) {
    if($null -ne $Response.Content.Headers.ContentLength -and $Response.Content.Headers.ContentLength -gt $Maximum) { throw 'GitHub publication response exceeded its byte bound.' }
    $taskStream=$Response.Content.ReadAsStreamAsync($Cancellation).GetAwaiter().GetResult()
    $taskMemory=New-Object IO.MemoryStream
    $taskBuffer=New-Object byte[] 65536
    try {
        while(($taskRead=$taskStream.ReadAsync($taskBuffer,0,$taskBuffer.Length,$Cancellation).GetAwaiter().GetResult()) -gt 0) {
            if($taskMemory.Length+$taskRead -gt $Maximum) { throw 'GitHub publication response exceeded its byte bound.' }
            $taskMemory.Write($taskBuffer,0,$taskRead)
        }
        return ,$taskMemory.ToArray()
    } finally {$taskStream.Dispose();$taskMemory.Dispose()}
}

function Invoke-CiGitHubTransport($Request, [string]$Token = $env:GITHUB_TOKEN) {
    $taskUri=Get-PublishRequestUri $Request
    if(-not $Token){$Token=$env:GH_TOKEN}
    if(-not $Token -or $Token.Length -gt 16384 -or $Token -match '\s') { throw 'GitHub publication token is unavailable/invalid.' }
    $taskRepository=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'policy.json') -Raw | ConvertFrom-Json).repository
    $taskHandler=[Net.Http.HttpClientHandler]::new();$taskHandler.AllowAutoRedirect=$false;$taskHandler.UseCookies=$false
    $taskClient=[Net.Http.HttpClient]::new($taskHandler)
    $taskClient.Timeout=[TimeSpan]::FromSeconds(90)
    $taskCancellation=[Threading.CancellationTokenSource]::new(90000)
    try {
        for($taskRedirect=0;$taskRedirect -le 3;$taskRedirect++) {
            $taskMessage=[Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::new($Request.method),$taskUri)
            $taskResponse=$null
            try {
                [void]$taskMessage.Headers.TryAddWithoutValidation('User-Agent','rustcorder-controlled-release')
                [void]$taskMessage.Headers.TryAddWithoutValidation('Accept',$(if($Request.download){'application/octet-stream'}else{'application/vnd.github+json'}))
                if($taskRedirect -eq 0) {
                    $taskMessage.Headers.Authorization=[Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer',$Token)
                    [void]$taskMessage.Headers.TryAddWithoutValidation('X-GitHub-Api-Version','2022-11-28')
                }
                if($Request.file) {
                    $taskFile=Assert-CiOwnedDirectory $Request.file
                    $taskMessage.Content=[Net.Http.StreamContent]::new([IO.File]::OpenRead($taskFile))
                    $taskMessage.Content.Headers.ContentType=[Net.Http.Headers.MediaTypeHeaderValue]::new('application/octet-stream')
                } elseif($null -ne $Request.body) {
                    $taskMessage.Content=[Net.Http.StringContent]::new(($Request.body | ConvertTo-Json -Depth 20 -Compress),[Text.Encoding]::UTF8,'application/json')
                }
                $taskResponse=$taskClient.SendAsync($taskMessage,[Net.Http.HttpCompletionOption]::ResponseHeadersRead,$taskCancellation.Token).GetAwaiter().GetResult()
                $taskStatus=[int]$taskResponse.StatusCode
                if($Request.download -and $taskStatus -in @(302,307)) {
                    # GitHub documents streamed 200 and redirected 302 delivery; credentials stay on the API request.
                    if($taskRedirect -eq 3 -or $null -eq $taskResponse.Headers.Location) { throw 'GitHub asset redirect bound exceeded.' }
                    $taskUri=Get-PublishRedirectUri $taskResponse.Headers.Location.OriginalString $taskRepository
                    continue
                }
                if($taskStatus -lt 200 -or $taskStatus -gt 299) { return @{status=$taskStatus;body=$null} }
                $taskLimit=if($Request.download){[long]$Request.max_bytes}else{8388608L}
                $taskBytes=Read-PublishHttpBytes $taskResponse $taskLimit $taskCancellation.Token
                if($Request.download) { return @{status=$taskStatus;bytes=$taskBytes} }
                $taskJson=if($taskBytes.Length){([Text.UTF8Encoding]::new($false,$true).GetString($taskBytes)) | ConvertFrom-Json -AsHashtable -NoEnumerate -Depth 64}else{$null}
                return @{status=$taskStatus;body=$taskJson}
            } finally {if($taskResponse){$taskResponse.Dispose()};$taskMessage.Dispose()}
        }
        throw 'GitHub publication transport did not complete.'
    } catch { throw 'GitHub publication transport failed; retain state for an identical authorized retry.' }
    finally {$taskCancellation.Dispose();$taskClient.Dispose();$taskHandler.Dispose()}
}

function Read-PublishJson([string]$Path) {
    $taskPath=Assert-CiOwnedDirectory $Path
    $taskItem=Get-Item -LiteralPath $taskPath -Force
    if($taskItem.PSIsContainer -or $taskItem.Length -gt 16777216) { throw 'Publication JSON file is missing/oversized.' }
    return [IO.File]::ReadAllText($taskPath) | ConvertFrom-Json -AsHashtable -NoEnumerate -Depth 64
}

function Write-PublishReceipt($Result, [string]$Root) {
    $taskRoot=Assert-CiOwnedDirectory $Root
    $taskPath=Assert-CiOwnedDirectory (Join-Path $taskRoot 'publication.json')
    $taskBytes=[Text.UTF8Encoding]::new($false).GetBytes(($Result | ConvertTo-Json -Depth 20))
    $taskAlgorithm=[Security.Cryptography.SHA256]::Create()
    try {$taskExpected=[BitConverter]::ToString($taskAlgorithm.ComputeHash($taskBytes)).Replace('-','').ToLowerInvariant()}
    finally {$taskAlgorithm.Dispose()}
    if(Test-Path -LiteralPath $taskPath) {
        if(-not (Test-Path -LiteralPath $taskPath -PathType Leaf) -or (Get-CiSha256 $taskPath) -cne $taskExpected) { throw 'Existing publication receipt differs; preserve it and use a fresh evidence directory.' }
        return $taskPath
    }
    $taskTemporary=Join-Path $taskRoot ('publication-'+[Guid]::NewGuid().ToString('N')+'.tmp')
    try {
        $taskStream=[IO.File]::Open($taskTemporary,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try {$taskStream.Write($taskBytes,0,$taskBytes.Length);$taskStream.Flush($true)} finally {$taskStream.Dispose()}
        [IO.File]::Move($taskTemporary,$taskPath)
    } finally {
        if(Test-Path -LiteralPath $taskTemporary) {Assert-CiOwnedDirectory $taskTemporary | Out-Null;Remove-Item -LiteralPath $taskTemporary}
    }
    return $taskPath
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        if($PSVersionTable.PSVersion.Major -lt 7) { throw 'Publication requires PowerShell 7.' }
        $taskCandidate=Read-PublishJson $CandidateFile;$taskAuthorization=Read-PublishJson $AuthorizationFile
        Assert-PublishBinding $taskCandidate $taskAuthorization $Root | Out-Null
        $taskEnvironment=[Environment]::GetEnvironmentVariables()
        Assert-PublishTrustedEnvironment $taskCandidate $taskEnvironment
        $taskControlEndpoint='/repos/'+$taskCandidate.repository+'/actions/runs/'+$taskCandidate.control.run_id
        $taskTransport={param($Request) Invoke-CiGitHubTransport $Request}
        # The trusted Node preflight verifies canonical candidate and live reviewer/latest-CI bindings.
        $taskRun=Invoke-PublishApi $taskTransport 'GET' $taskControlEndpoint
        Assert-PublishTrustedControl $taskCandidate $taskAuthorization $taskEnvironment $taskRun
        $taskCheckout=(& git -C $taskSetupRoot rev-parse --verify HEAD | Out-String).Trim()
        if($LASTEXITCODE -ne 0 -or $taskCheckout -cne $taskCandidate.control.source_sha) { throw 'Publisher checkout is not the frozen trusted workflow commit.' }
        $taskDirty=@(& git -C $taskSetupRoot status --porcelain --untracked-files=normal)
        if($LASTEXITCODE -ne 0 -or $taskDirty.Count -ne 0) { throw 'Publisher requires the clean trusted control checkout.' }
        $taskResult=Invoke-CiPublish -Candidate $taskCandidate -Root $Root -Authorization $taskAuthorization -Transport $taskTransport
        Write-PublishReceipt $taskResult $Root | Out-Null
        [Console]::WriteLine(($taskResult | ConvertTo-Json -Depth 20))
    } catch {[Console]::Error.WriteLine($_.Exception.Message);exit 2}
}
