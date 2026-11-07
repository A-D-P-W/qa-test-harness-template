<#
deploy.ps1 - upload the released commit of this project to its live Apps Script project with clasp, then prove it.

  First time / if Windows refuses to run scripts (execution policy), from the repo folder on the PC:
    powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -DryRun
  Release:   git pull; powershell -NoProfile -ExecutionPolicy Bypass -File .\deploy.ps1 -Release <sha>
  -Release   <sha> = the commit the agent tested (FULL=1 ./runall.sh passed): creates and pushes the annotated tag
             release/v<VERSION> on it (or reuses that tag if it already points there), then deploys
  (no flag)  deploys a commit that already carries its release tag on GitHub
  -DryRun    every check + compare the live project with the release commit; uploads nothing
  -Project   app (default) - which Apps Script project (one row per project in $Projects below: pinned scriptId, bundle,
             manifest, .clasp.json and tag prefix; release tags: release/v<VERSION>, other projects release/<name>-v<VERSION>)
Before running: clasp login (this script logs clasp out at the end of every run).

Uploads only when ALL hold (else STOP, exit 1, nothing uploaded):
  - git and clasp exist, clasp is exactly version 3.4.1; no clasp_config_* environment variable redirects clasp
  - the repo is on main, clean, and equal to origin/main after a fetch
  - HEAD carries the annotated tag release/v<VERSION> on GitHub (set only after FULL=1 ./runall.sh passed)
  - .clasp.json names the pinned live project ($PinnedScriptId below)
The two files are extracted from the commit itself (git archive) into a temporary stage folder, so the upload is the
tagged commit's bytes, not whatever is in the working folder. clasp status --json must list exactly those two files.
After clasp push --force it downloads the live project into a second temporary folder and compares every file:
  DEPLOYED v<version> = commit <sha>   or   MISMATCH ... (exit 1).
A change to the manifest's oauthScopes is announced: run health() in the editor once and approve the new access.
Works in Windows PowerShell 5.1 and PowerShell 7. Never reads or prints clasp credentials (~/.clasprc.json).
#>
[CmdletBinding()]
param([switch]$DryRun, [string]$Release = '', [string]$Project = 'app')
Set-StrictMode -Version 3
$ErrorActionPreference = 'Stop'

$PinnedScriptId = ''   # TEMPLATE: the live project's scriptId, set in a reviewed commit (deploy STOPs while empty)
# One row per Apps Script project: files in the commit, the pin, and the release-tag prefix. Paths are repo-relative.
# A second project adds a row with its own pin, <dir>/<File>.gs bundle, <dir>/appsscript.json, <dir>/.clasp.json and
# TagPrefix 'release/<name>-v' (one path segment: a ruleset glob `release/*` does not match a second '/', tests/LESSONS.md L52).
$Projects = @{
  'app' = @{ Pin = $PinnedScriptId; Bundle = 'App.gs'; Manifest = 'appsscript.json'; Clasp = '.clasp.json'; TagPrefix = 'release/v' }
}
$script:Temps = @()

$ClaspVersion = '3.4.1'                             # the only clasp version this script is tested against (fake-clasp.js)
$script:LoggedOut = $false
function Close-Clasp {
  # Design rule: the saved clasp login never stays on the PC after a run (deploy, dry run or STOP) -
  # 'clasp logout' deletes the local credential only; revoke at Google: Account > Security > Third-party connections.
  # Owner toggle: the user environment variable KEEP_CLASP_LOGIN=1 keeps the login (home PC, in active use)
  # until the owner removes it. Only the exact value 1 counts; anything else logs out as before, with a warning.
  if ($script:LoggedOut) { return }
  $script:LoggedOut = $true
  $keep = [string]$env:KEEP_CLASP_LOGIN
  if ($keep -eq '1') { Write-Host 'clasp: login KEPT (KEEP_CLASP_LOGIN=1 is set; remove it to log out after every run again)' -ForegroundColor Yellow; return }
  if ($keep) { Write-Host "WARNING: KEEP_CLASP_LOGIN='$keep' is not 1 - ignored, logging out" -ForegroundColor Yellow }
  if (-not (Get-Command clasp -ErrorAction SilentlyContinue)) { return }
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $global:LASTEXITCODE = -1
  try { & clasp logout 2>&1 | Out-Null } catch { } finally { $ErrorActionPreference = $old }
  if ($LASTEXITCODE -eq 0) { Write-Host 'clasp: logged out (run clasp login before the next deploy)' }
  else { Write-Host "WARNING: clasp logout failed (exit $LASTEXITCODE) - run: clasp logout" -ForegroundColor Yellow }
}
function Stop-Deploy([string]$msg) {
  Write-Host "STOP: $msg" -ForegroundColor Red
  Set-Location -LiteralPath $PSScriptRoot          # PowerShell cannot delete the current location (security re-review)
  foreach ($t in $script:Temps) { Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue }
  Close-Clasp
  exit 1
}
function New-Temp([string]$tag) {
  $p = Join-Path ([System.IO.Path]::GetTempPath()) ("mtd-$tag-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $p | Out-Null; $script:Temps += $p; return $p
}
function Read-Lf([string]$path) {
  $t = [System.IO.File]::ReadAllText($path, [System.Text.UTF8Encoding]::new($false))
  if ($t.Length -gt 0 -and $t[0] -eq [char]0xFEFF) { $t = $t.Substring(1) }
  return ($t -replace "`r`n", "`n" -replace "`r", "`n")
}
function Get-Sha([string]$text) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return (($sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($text)) | ForEach-Object { $_.ToString('x2') }) -join '') }
  finally { $sha.Dispose() }
}
function Invoke-Native([string]$exe, [string[]]$argv, [string]$onFail = '', [switch]$StdoutOnly) {
  # Windows PowerShell 5.1 turns a native tool's stderr into a terminating error under 'Stop', and a .ps1 shim that
  # fails before running leaves the previous $LASTEXITCODE; so: relax the preference, preset the code to -1.
  $global:LASTEXITCODE = -1
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $err = $null; $errText = ''
  try {
    if ($StdoutOnly) { $err = [System.IO.Path]::GetTempFileName(); $out = & $exe @argv 2> $err | ForEach-Object { "$_" } | Out-String }
    else { $out = & $exe @argv 2>&1 | ForEach-Object { "$_" } | Out-String }
  }
  catch { $out = "$_" }
  finally {
    $ErrorActionPreference = $old
    if ($err) { $errText = (Get-Content -Raw -LiteralPath $err -ErrorAction SilentlyContinue); Remove-Item -LiteralPath $err -Force -ErrorAction SilentlyContinue }
  }
  if ($StdoutOnly -and $LASTEXITCODE -ne 0) { $out = "$out$errText" }
  if ($LASTEXITCODE -ne 0) { Stop-Deploy ("$exe $($argv -join ' ') failed (exit $LASTEXITCODE)" + $(if ($onFail) { " - $onFail" } else { '' }) + ":`n$out" + $(if ($exe -eq 'clasp') { "`n(if clasp is logged out: run clasp login, then rerun)" } else { '' })) }
  return $out
}
function Get-LiveFiles([string]$dir) {
  # Pull the live project into $dir (pinned project only) and return its files, subfolders included.
  $cfg = [ordered]@{ scriptId = $PinnedScriptId; rootDir = ''; skipSubdirectories = $false }
  [System.IO.File]::WriteAllText((Join-Path $dir '.clasp.json'), ($cfg | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))
  Push-Location -LiteralPath $dir
  try { Invoke-Native clasp @('pull') $(if ($script:Uploaded) { 'UPLOADED, live state UNVERIFIED: rerun with -DryRun' } else { '' }) | Out-Null } finally { Pop-Location }
  return @(Get-ChildItem -LiteralPath $dir -File -Recurse | Where-Object { $_.Name -ne '.clasp.json' })
}
function Get-Scopes([string]$path) { return ((@((Read-Lf $path | ConvertFrom-Json).oauthScopes) | Sort-Object) -join ' ') }

try {                                              # finally: clasp logout even when a step throws (review M1)
$script:Uploaded = $false
$repo = $PSScriptRoot
Set-Location -LiteralPath $repo
foreach ($t in 'git', 'clasp') { if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Stop-Deploy "$t is not installed or not on PATH" } }
$cv = (Invoke-Native clasp @('--version') -StdoutOnly).Trim()           # stdout only: a stderr notice is not the version
if ($cv -notmatch '^v?([0-9]+\.[0-9]+\.[0-9]+)\s*$' -or $Matches[1] -ne $ClaspVersion) {
  Stop-Deploy "clasp reports version '$cv'; this script is tested with $ClaspVersion only - run: npm install -g @google/clasp@$ClaspVersion"
}
if ($Release -and $DryRun) { Stop-Deploy '-Release and -DryRun together: preview with -DryRun alone, then run -Release <sha>' }
$Project = "$Project".ToLowerInvariant()
if (-not $Projects.ContainsKey($Project)) { Stop-Deploy "-Project '$Project' is not one of: $(($Projects.Keys | Sort-Object) -join ', ')" }
$P = $Projects[$Project]
if (-not $P.Pin) { Stop-Deploy "project '$Project' has no pinned scriptId in deploy.ps1 yet - nothing is uploaded until it is pinned in a reviewed commit" }
# 3.9.3 PowerShell review M1: a check from outside the row - one scriptId pasted into two rows would upload over the other project
$otherPins = @($Projects.Keys | Where-Object { $_ -ne $Project } | ForEach-Object { $Projects[$_].Pin } | Where-Object { $_ })
if ($otherPins -contains $P.Pin) { Stop-Deploy "project '$Project' has the same pinned scriptId as another project - each project needs its own pin" }
# 3.10.0 (template review L3): each project's release tags are its own, one path segment under release/ (L52) - a shared
# prefix would let one project's release tag satisfy another project's check at the same VERSION on the same commit
if ($P.TagPrefix -cnotmatch '^release/([a-z0-9]+(-[a-z0-9]+)*-)?v\z') { Stop-Deploy "project '$Project' TagPrefix '$($P.TagPrefix)' is not release/v or release/<name>-v" }
$otherPrefixes = @($Projects.Keys | Where-Object { $_ -ne $Project } | ForEach-Object { $Projects[$_].TagPrefix })
if ($otherPrefixes -contains $P.TagPrefix) { Stop-Deploy "project '$Project' has the same TagPrefix as another project - each project needs its own release tags" }
$PinnedScriptId = $P.Pin                              # from here on, the pin of the selected project
$BundleName = Split-Path -Leaf $P.Bundle
$Expected = @($BundleName, 'appsscript.json')       # names in the flat stage folder (what clasp uploads)
$redirect = @(Get-ChildItem Env: | Where-Object { $_.Name -like 'clasp_config_*' } | ForEach-Object Name)
if ($redirect.Count) { Stop-Deploy "environment variable(s) $($redirect -join ', ') would redirect clasp - remove them first" }

# 1. The repo is exactly the tagged release on GitHub.
Invoke-Native git @('fetch', '-q', '--tags', 'origin') | Out-Null
$branch = (Invoke-Native git @('rev-parse', '--abbrev-ref', 'HEAD')).Trim()
if ($branch -ne 'main') { Stop-Deploy "on branch '$branch', not main" }
$dirty = (Invoke-Native git @('status', '--porcelain')).Trim()
if ($dirty) { Stop-Deploy "uncommitted or untracked changes:`n$dirty`nIf they are only line endings, run: git rm --cached -r -q .; git reset --hard" }
$head = (Invoke-Native git @('rev-parse', 'HEAD')).Trim()
$origin = (Invoke-Native git @('rev-parse', 'origin/main')).Trim()
if ($head -ne $origin) { Stop-Deploy "local main $($head.Substring(0,7)) is not origin/main $($origin.Substring(0,7)) - run: git pull" }
$src = (Invoke-Native git @('show', "${head}:$($P.Bundle)") "commit has no $($P.Bundle)")
if ($src -notmatch "const VERSION = '([0-9]+\.[0-9]+\.[0-9]+)';") { Stop-Deploy "no VERSION line in $($P.Bundle)" }
$version = $Matches[1]
$tag = "$($P.TagPrefix)$version"
# before any tag is created: a commit naming another project must never get a release tag (review M2: tags cannot be moved)
try { $scriptId = (Invoke-Native git @('show', "${head}:$($P.Clasp)") "commit has no $($P.Clasp)" | ConvertFrom-Json).scriptId } catch { Stop-Deploy "$($P.Clasp) is not valid JSON: $_" }
if ($scriptId -ne $PinnedScriptId) { Stop-Deploy "$($P.Clasp) names project '$scriptId', not the pinned live project ...$($PinnedScriptId.Substring($PinnedScriptId.Length - 6))" }
if ($Release) {
  # One-command release: tag exactly the tested commit, only if it is HEAD == origin/main.
  if ($Release -notmatch '^[0-9a-fA-F]{7,40}$') { Stop-Deploy "-Release needs the tested commit ID (7-40 hex characters), got '$Release'" }
  $want = (Invoke-Native git @('rev-parse', '--verify', '-q', "$Release^{commit}") "commit $Release is not in this repo - run: git pull").Trim()
  if ($want -ne $head) { Stop-Deploy "commit $Release is not HEAD/origin/main $($head.Substring(0,7)) - the tested commit must be the one on GitHub main" }
  $lt = (Invoke-Native git @('for-each-ref', '--format=%(objecttype) %(*objectname)', "refs/tags/$tag")).Trim()
  if ($lt -and $lt -ne "tag $head") { Stop-Deploy "tag $tag already exists here on another commit or as a lightweight tag ($lt)" }
  $rt = (Invoke-Native git @('ls-remote', '--tags', 'origin', "refs/tags/$tag", "refs/tags/$tag^{}")).Trim()
  if ($rt -and -not ($rt -match "(?m)^$head\s+refs/tags/$([regex]::Escape($tag))\^\{\}\r?$")) { Stop-Deploy "tag $tag already exists on GitHub on another commit - release tags are never moved" }
  if (-not $lt) { Invoke-Native git @('tag', '-a', $tag, '-m', "$(if ($Project -ne 'app') { "$Project " } else { '' })v$version (deploy.ps1 -Release)", $head) | Out-Null }
  if (-not $rt) { Invoke-Native git @('push', 'origin', "refs/tags/$tag") 'the tag was not pushed; nothing was uploaded' | Out-Null }
  Write-Host "tag $tag on commit $($head.Substring(0,7)): $(if ($rt) { 'already on GitHub' } else { 'created and pushed' })"
}
$tagLocal = (Invoke-Native git @('for-each-ref', '--format=%(*objectname)', "refs/tags/$tag")).Trim()   # peeled commit of an annotated tag
$tagType = (Invoke-Native git @('for-each-ref', '--format=%(objecttype)', "refs/tags/$tag")).Trim()   # empty + exit 0 when missing (5.1-safe)
$tagRemote = (Invoke-Native git @('ls-remote', '--tags', 'origin', "refs/tags/$tag^{}")).Trim()
$tagOk = ($tagLocal -eq $head -and $tagType -eq 'tag' -and $tagRemote.StartsWith($head))
if (-not $tagOk) {
  $why = "HEAD $($head.Substring(0,7)) has no annotated tag $tag on GitHub (the agent tags a commit only after FULL=1 ./runall.sh passes)"
  if ($DryRun) { Write-Host "WARNING: $why" -ForegroundColor Yellow } else { Stop-Deploy $why }
}

# 2. Stage the two files from the commit (not the working folder).
$stage = New-Temp 'stage'
$archiveArgs = @('archive', '--format=zip', '-o', (Join-Path $stage 'src.zip'), $head, '--', $P.Bundle, $P.Manifest)
Invoke-Native git $archiveArgs | Out-Null
$unz = New-Temp 'unzip'                             # 3.9.3: a project in a subfolder is flattened into the stage folder
Expand-Archive -LiteralPath (Join-Path $stage 'src.zip') -DestinationPath $unz -Force
Remove-Item -LiteralPath (Join-Path $stage 'src.zip')
foreach ($pair in @(@($P.Bundle, $BundleName), @($P.Manifest, 'appsscript.json'))) {
  $from = Join-Path $unz ($pair[0] -replace '/', [System.IO.Path]::DirectorySeparatorChar)
  if (-not (Test-Path -LiteralPath $from)) { Stop-Deploy "commit has no $($pair[0])" }
  Move-Item -LiteralPath $from -Destination (Join-Path $stage $pair[1])
}
if (@(Get-ChildItem -LiteralPath $stage -Force).Count -ne 2) { Stop-Deploy "stage folder does not hold exactly $($Expected -join ' + ')" }
if ([System.IO.File]::ReadAllText((Join-Path $stage $BundleName)).Contains("`r")) { Stop-Deploy "$BundleName in the commit has Windows line endings" }
$cfg = [ordered]@{ scriptId = $PinnedScriptId; rootDir = ''; skipSubdirectories = $true }
[System.IO.File]::WriteAllText((Join-Path $stage '.clasp.json'), ($cfg | ConvertTo-Json), [System.Text.UTF8Encoding]::new($false))

# 3. clasp would upload exactly the two files (full paths, no merging of duplicates).
Push-Location -LiteralPath $stage
try { $status = Invoke-Native clasp @('status', '--json') -StdoutOnly } finally { Pop-Location }   # stdout only: JSON
try { $files = @((($status.Trim() | ConvertFrom-Json).filesToPush) | ForEach-Object { "$_" -replace '\\', '/' }) } catch { Stop-Deploy "clasp status --json did not return JSON:`n$status" }
if ((@($files | Sort-Object) -join '|') -ne (@($Expected | Sort-Object) -join '|')) { Stop-Deploy "clasp would upload [$($files -join ', ')], expected exactly [$($Expected -join ', ')]" }
Write-Host "checks OK: $(if ($Project -ne 'app') { "$Project " } else { '' })v$version, commit $($head.Substring(0,7)), project ...$($PinnedScriptId.Substring($PinnedScriptId.Length - 6)), uploads $($files -join ' + ')$(if ($tagOk) { ", tag $tag" } else { '' })"

# 4. Scope change notice (from the live manifest before the upload), then upload unless -DryRun.
$pre = New-Temp 'before'
$before = Get-LiveFiles $pre
$preManifest = @($before | Where-Object { $_.Name -eq 'appsscript.json' })
try { $scopesChanged = $preManifest.Count -ne 1 -or (Get-Scopes $preManifest[0].FullName) -ne (Get-Scopes (Join-Path $stage 'appsscript.json')) }
catch { $scopesChanged = $true }                  # unreadable live manifest: announce, never guess
if ($DryRun) { Write-Host 'DRY RUN: nothing uploaded; comparing the live project with the commit' -ForegroundColor Yellow }
else {
  Push-Location -LiteralPath $stage
  try { Invoke-Native clasp @('push', '--force') 'nothing may have been uploaded; rerun with -DryRun to see the live state' | Out-Null } finally { Pop-Location }
  $script:Uploaded = $true
}

# 5. Download the live project and compare every file with the commit.
$after = New-Temp 'after'
$live = Get-LiveFiles $after
$problems = @()
$names = @($live | ForEach-Object { $_.FullName.Substring($after.Length).TrimStart('\', '/') -replace '\\', '/' })
$codeFiles = @($live | Where-Object { $_.Extension -in '.js', '.gs' })
$manFiles = @($live | Where-Object { $_.Name -eq 'appsscript.json' })
if ($live.Count -ne 2 -or $codeFiles.Count -ne 1 -or $manFiles.Count -ne 1 -or $codeFiles[0].Directory.FullName -ne $manFiles[0].Directory.FullName) {
  $problems += "live project has [$($names -join ', ')], expected one script + appsscript.json"
}
if ($codeFiles.Count -eq 1) {
  $a = Get-Sha (Read-Lf (Join-Path $stage $BundleName)); $b = Get-Sha (Read-Lf $codeFiles[0].FullName)
  if ($a -ne $b) { $problems += "live script differs from the commit (commit sha256 $($a.Substring(0,12)), live $($b.Substring(0,12)))" }
}
if ($manFiles.Count -eq 1) {
  $m1 = (Read-Lf (Join-Path $stage 'appsscript.json') | ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress)
  try { $m2 = (Read-Lf $manFiles[0].FullName | ConvertFrom-Json | ConvertTo-Json -Depth 20 -Compress) } catch { $m2 = '<not valid JSON>' }
  if ($m1 -ne $m2) { $problems += 'live appsscript.json differs from the commit' + $(if ($m2 -eq '<not valid JSON>') { ' (live copy is not valid JSON)' } else { '' }) }
}
foreach ($t in $script:Temps) { Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction SilentlyContinue }
Close-Clasp

if ($problems.Count) {
  Write-Host ("MISMATCH" + $(if ($DryRun) { ' (live is not this commit; a deploy would change it)' } else { '' }) + ":") -ForegroundColor Red
  $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  exit 1
}
$label = if ($DryRun) { 'LIVE MATCHES' } else { 'DEPLOYED' }
Write-Host "$label $(if ($Project -ne 'app') { "$Project " } else { '' })v$version = commit $($head.Substring(0,7))" -ForegroundColor Green
if ($scopesChanged) { Write-Host $(if ($Project -eq 'app') { 'SCOPES CHANGED: open the Apps Script editor, run health() once and approve the new access, or the schedule stops.' } else { "SCOPES CHANGED: open the $Project project's editor, run any function once and approve the new access." }) -ForegroundColor Yellow }   # per project (a project without health() or a schedule gets the generic line)
exit 0
} finally { Close-Clasp }
