<#
.SYNOPSIS
  Restore drill for Windows (docs/RUNBOOK.md section 6.4): open one nightly backup, restore it into a
  throwaway local PostgreSQL and compare every table's row count with the backup's manifest.

.DESCRIPTION
  The Windows twin of scripts/backup/restore-drill.sh. It:
    1. checks the tools (PostgreSQL 17 server and client programs, age, tar) and prints the
       exact winget command for anything missing;
    2. takes the artifact as downloaded from GitHub (the .zip) or the .tar.age inside it, and
       the path of your age key file;
    3. decrypts it with age into a new temporary folder and checks every file against the
       manifest's SHA-256;
    4. creates a throwaway PostgreSQL cluster in that folder, listening on 127.0.0.1 only, on a
       free port other than 5432, with trust authentication (nothing prompts for a password);
    5. restores the backup into it and compares every table's row count with the manifest;
    6. prints one line, "RESTORE DRILL: OK ..." or "RESTORE DRILL: FAIL ...";
    7. stops the cluster and deletes the folder: the database and every decrypted file.

  Every external program runs as one named step with a timeout: a line is printed before and
  after it ("start :" / "done  :"), and a step that runs too long is stopped and reported as
  "RESTORE DRILL: FAIL - <step> timed out" with the last 20 lines of the server log. pg_ctl is
  never run through a pipe: on Windows the server it starts inherits a pipe and holds it open,
  which made PowerShell wait forever (the 1 Oct hang after "decrypted").

  It never connects to production or any hosted database (it only ever talks to the cluster it
  started on 127.0.0.1), never prints the key or its contents, and writes nothing outside its
  temporary folder.

.PARAMETER Backup
  The downloaded artifact: nexra-backup-<run id>.zip, or the nexra-backup-<UTC>.tar.age in it.

.PARAMETER KeyFile
  Your age private key file (nexra-backup.key). Read by age only; never printed.

.PARAMETER PgBin
  Optional. The PostgreSQL bin folder, for example "C:\Program Files\PostgreSQL\17\bin".
  Default: the newest "C:\Program Files\PostgreSQL\<version>\bin", else the folder of
  pg_ctl on PATH.

.PARAMETER Age
  Optional. The path of age.exe. Default: age on PATH, else winget's Links folder.

.PARAMETER TestMinimumMajor
  For scripts/backup/test-local.sh only (its local cluster may be older). Leave it out: the
  drill requires PostgreSQL 17, the production major.

.PARAMETER TestStepTimeout
  For scripts/backup/test-local.sh only: "<step name>=<seconds>" overrides one step's timeout,
  to test the timeout path. Leave it out.

.PARAMETER Keep
  Keep the temporary folder (stopped cluster and decrypted files) for inspection. Delete it
  yourself afterwards: it holds the decrypted backup.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\backup\restore-drill.ps1 `
    -Backup "$HOME\Downloads\nexra-backup-36720332709.zip" -KeyFile "D:\keys\nexra-backup.key"
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Backup,
  [Parameter(Mandatory = $true)][string]$KeyFile,
  [string]$PgBin,
  [string]$Age,
  [switch]$Keep,
  [int]$TestMinimumMajor = 17,
  [string]$TestStepTimeout = ''
)

# Written for Windows PowerShell 5.1 (built into Windows 10 and 11) and PowerShell 7: no
# ternaries, no ?? and no && in this file.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
$RequiredMajor = $TestMinimumMajor
$OnWindows = ($env:OS -eq 'Windows_NT')

function Write-Fail([string]$message) {
  Write-Host "RESTORE DRILL: FAIL - $message" -ForegroundColor Red
}

# Anything unexpected before the drill's own try block (an unreadable path, say) still ends in
# one FAIL line. Nothing has been created at that point.
trap {
  Write-Fail "unexpected error: $($_.Exception.Message)"
  exit 1
}

# A drill failure with its own message (an ApplicationException); anything else is unexpected.
function Stop-Drill([string]$message) { throw (New-Object System.ApplicationException $message) }

# A program in a folder: name.exe on Windows, name elsewhere.
function Find-Program([string]$folder, [string]$name) {
  foreach ($candidate in @("$name.exe", $name)) {
    $path = Join-Path $folder $candidate
    if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
  }
  return $null
}

$script:LogDir = $null
$script:ServerLog = $null
$script:StepCount = 0
$script:StepTimeouts = @{}
if ($TestStepTimeout -match '^(.+)=(\d+)$') { $script:StepTimeouts[$Matches[1]] = [int]$Matches[2] }

# One argument as Windows' command-line parser reads it back (the same rules .NET applies on
# Linux), so paths with spaces and SQL with quotes arrive intact.
function Format-Argument([string]$value) {
  if ($value -eq '') { return '""' }
  if ($value -notmatch '[\s"]') { return $value }
  $escaped = [regex]::Replace($value, '(\\*)"', { param($m) ($m.Groups[1].Value * 2) + '\"' })
  $escaped = [regex]::Replace($escaped, '(\\+)$', { param($m) $m.Groups[1].Value * 2 })
  return '"' + $escaped + '"'
}

# The first line of a step's output, trimmed; a named failure when there is none.
function Get-FirstLine($lines, [string]$step) {
  $first = @($lines) | Select-Object -First 1
  if ($null -eq $first) { Stop-Drill "$step returned no output." }
  return "$first".Trim()
}

# Read a file another process may still hold open.
function Read-SharedLines([string]$path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return @() }
  $stream = [System.IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
  try {
    $reader = New-Object System.IO.StreamReader($stream)
    $text = $reader.ReadToEnd()
  } finally { $stream.Dispose() }
  if ($text -eq '') { return @() }
  return @($text -split "`r?`n" | Where-Object { $_ -ne '' })
}

function Get-ServerLogTail {
  $lines = Read-SharedLines $script:ServerLog
  if ($lines.Count -eq 0) { return '(the server log is empty or was not created)' }
  return (($lines | Select-Object -Last 20) -join [Environment]::NewLine)
}

function Stop-ProcessTree($process) {
  try {
    if ($OnWindows) { $null = & taskkill.exe /PID $process.Id /T /F 2>&1 }
    else { try { $process.Kill($true) } catch { $process.Kill() } }
  } catch { }
}

# Run one external program as a named step: a line before and after, a timeout, stdout and
# stderr to files (never a pipe), and a FAIL naming the step on a non-zero exit or a timeout.
# -Console leaves the program on the console with nothing redirected: used for pg_ctl, whose
# server must not inherit any handle of ours. Returns stdout's lines.
function Invoke-Step([string]$step, [string]$exe, [string[]]$arguments, [int]$timeoutSeconds, [switch]$Console) {
  if ($script:StepTimeouts.ContainsKey($step)) { $timeoutSeconds = $script:StepTimeouts[$step] }
  $script:StepCount++
  $folder = $script:LogDir
  if (-not $folder) { $folder = [System.IO.Path]::GetTempPath() }
  $stem = Join-Path $folder ('nexra-step-{0:D3}-{1}' -f $script:StepCount, [Guid]::NewGuid().ToString('N').Substring(0, 6))
  $outFile = "$stem.out"
  $errFile = "$stem.err"
  Write-Host "  start : $step"
  $watch = [System.Diagnostics.Stopwatch]::StartNew()
  $commandLine = (@($arguments) | ForEach-Object { Format-Argument $_ }) -join ' '
  if ($Console) {
    $process = Start-Process -FilePath $exe -ArgumentList $commandLine -NoNewWindow -PassThru
  } else {
    $process = Start-Process -FilePath $exe -ArgumentList $commandLine -NoNewWindow -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  }
  try { $null = $process.Handle } catch { }  # keeps ExitCode readable after exit
  try {
    if (-not $process.WaitForExit($timeoutSeconds * 1000)) {
      Stop-ProcessTree $process
      Stop-Drill ("$step timed out after $timeoutSeconds s and was stopped. Last lines of the server log:" + [Environment]::NewLine + (Get-ServerLogTail))
    }
    # The process has exited. PowerShell 7 copies redirected output to the files asynchronously:
    # this second wait returns once that copy is done (these programs leave no child behind;
    # pg_ctl runs with -Console, nothing redirected, so it never reaches here holding a pipe).
    if (-not $Console) { $process.WaitForExit() }
    $code = $process.ExitCode
    $stdout = Read-SharedLines $outFile
    if ($code -ne 0) {
      $detail = @(Read-SharedLines $errFile) + @($stdout) | Select-Object -Last 15
      Stop-Drill ("$step failed (exit $code)." + [Environment]::NewLine + ($detail -join [Environment]::NewLine))
    }
  } finally {
    if (-not $script:LogDir) { Remove-Item -LiteralPath $outFile, $errFile -Force -ErrorAction SilentlyContinue }
  }
  Write-Host ('  done  : {0} ({1:N1} s)' -f $step, $watch.Elapsed.TotalSeconds)
  return $stdout
}

function Get-Major([string]$versionLine) {
  if ($versionLine -match '\s(\d+)(\.\d+)*') { return [int]$Matches[1] }
  return 0
}

# A free loopback port, never 5432 (the installed PostgreSQL service's).
function Get-FreePort {
  for ($i = 0; $i -lt 20; $i++) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    if ($port -ne 5432) { return $port }
  }
  Stop-Drill 'no free port found.'
}

function Remove-Folder([string]$path) {
  # The server can hold a file for a moment after it stops; try a few times.
  for ($i = 0; $i -lt 10; $i++) {
    if (-not (Test-Path -LiteralPath $path)) { return $true }
    try { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop; return $true } catch { Start-Sleep -Milliseconds 500 }
  }
  return -not (Test-Path -LiteralPath $path)
}

$WinGetInstall = @{
  postgres = 'winget install --exact --id PostgreSQL.PostgreSQL.17 --interactive'
  age      = 'winget install --exact --id FiloSottile.age'
}

# --- 1. Prerequisites ------------------------------------------------------------------------
$missing = New-Object System.Collections.Generic.List[string]

if (-not $PgBin) {
  $roots = @()
  if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles 'PostgreSQL') }
  foreach ($root in $roots) {
    if (Test-Path -LiteralPath $root) {
      $best = Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '^\d+' -and (Find-Program (Join-Path $_.FullName 'bin') 'pg_ctl') } |
        Sort-Object { [int]($_.Name -replace '[^\d].*$', '') } -Descending | Select-Object -First 1
      if ($best) { $PgBin = Join-Path $best.FullName 'bin'; break }
    }
  }
  if (-not $PgBin) {
    $onPath = Get-Command pg_ctl -ErrorAction SilentlyContinue
    if ($onPath) { $PgBin = Split-Path -Parent $onPath.Source }
  }
}

$pg = @{}
if ($PgBin) {
  foreach ($tool in @('initdb', 'pg_ctl', 'postgres', 'psql', 'pg_restore')) {
    $found = Find-Program $PgBin $tool
    if ($found) { $pg[$tool] = $found }
  }
}
$pgMajor = 0
if ($pg.Count -eq 5) {
  $pgMajor = Get-Major (Get-FirstLine (Invoke-Step 'postgres --version' $pg.postgres @('--version') 30) 'postgres --version')
  if ($pgMajor -lt $RequiredMajor) {
    $missing.Add("PostgreSQL $RequiredMajor (found $pgMajor in $PgBin). Install it with:`n    $($WinGetInstall.postgres)`n  In the installer keep 'PostgreSQL Server' and 'Command Line Tools'; untick 'pgAdmin 4' and 'Stack Builder'.")
  }
} else {
  $where = 'not found'
  if ($PgBin) { $where = "incomplete in $PgBin" }
  $missing.Add("PostgreSQL $RequiredMajor server and client programs ($where). Install them with:`n    $($WinGetInstall.postgres)`n  In the installer keep 'PostgreSQL Server' and 'Command Line Tools'; untick 'pgAdmin 4' and 'Stack Builder'.")
}

if (-not $Age) {
  $cmd = Get-Command age -ErrorAction SilentlyContinue
  if ($cmd) { $Age = $cmd.Source }
  elseif ($env:LOCALAPPDATA) {
    $link = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\age.exe'
    if (Test-Path -LiteralPath $link) { $Age = $link }
  }
}
if (-not $Age -or -not (Test-Path -LiteralPath $Age)) {
  $missing.Add("age. Install it with:`n    $($WinGetInstall.age)`n  then open a new PowerShell window.")
}

$Tar = $null
$tarCmd = Get-Command tar -ErrorAction SilentlyContinue
if ($tarCmd) { $Tar = $tarCmd.Source } else { $missing.Add('tar (built into Windows 10 1803 and later as C:\Windows\System32\tar.exe). Update Windows.') }

if ($missing.Count -gt 0) {
  Write-Host 'Missing before the drill can run:' -ForegroundColor Yellow
  foreach ($item in $missing) { Write-Host "  - $item" }
  Write-Fail 'prerequisites missing (see above); nothing was read or created.'
  exit 2
}

if (-not (Test-Path -LiteralPath $Backup -PathType Leaf)) { Write-Fail "no such backup file: $Backup"; exit 2 }
if (-not (Test-Path -LiteralPath $KeyFile -PathType Leaf)) { Write-Fail 'the key file was not found at the path given.'; exit 2 }
$Backup = (Resolve-Path -LiteralPath $Backup).Path
$KeyFile = (Resolve-Path -LiteralPath $KeyFile).Path

Write-Host "PostgreSQL $pgMajor : $PgBin"
Write-Host "age         : $Age"
Write-Host "backup      : $Backup"

# --- 2. The temporary folder ---------------------------------------------------------------
$Work = Join-Path ([System.IO.Path]::GetTempPath()) ('nexra-drill-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$Files = Join-Path $Work 'files'
$Data = Join-Path $Work 'data'
New-Item -ItemType Directory -Path $Files -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Work 'steps') -Force | Out-Null

$started = $false
$savedConnectTimeout = $env:PGCONNECT_TIMEOUT
$result = 1
try {
  if ($OnWindows) {
    # Only the current user may read the folder (it will hold the decrypted backup).
    $null = Invoke-Step 'icacls (folder for this user only)' "$env:SystemRoot\System32\icacls.exe" @($Work, '/inheritance:r', '/grant:r', "$($env:USERNAME):(OI)(CI)F") 30
  }
  $script:LogDir = Join-Path $Work 'steps'
  $script:ServerLog = Join-Path $Work 'server.log'
  $env:PGCONNECT_TIMEOUT = '10'

  # --- 3. Decrypt and unpack ---------------------------------------------------------------
  $encrypted = $Backup
  if ($Backup -match '\.zip$') {
    $unzipped = Join-Path $Work 'artifact'
    Write-Host '  start : unzip the artifact'
    Expand-Archive -LiteralPath $Backup -DestinationPath $unzipped -Force
    Write-Host '  done  : unzip the artifact'
    $inside = @(Get-ChildItem -LiteralPath $unzipped -Recurse -File -Filter '*.tar.age')
    if ($inside.Count -ne 1) { Stop-Drill "the zip should hold exactly one .tar.age file; it holds $($inside.Count)." }
    $encrypted = $inside[0].FullName
  }
  $header = New-Object byte[] 21
  $stream = [System.IO.File]::OpenRead($encrypted)
  try { $null = $stream.Read($header, 0, 21) } finally { $stream.Dispose() }
  if ([System.Text.Encoding]::ASCII.GetString($header) -ne 'age-encryption.org/v1') { Stop-Drill 'the backup is not an age file.' }

  $tarFile = Join-Path $Work 'backup.tar'
  $null = Invoke-Step 'decryption (wrong key, or a damaged file)' $Age @('--decrypt', '--identity', $KeyFile, '--output', $tarFile, $encrypted) 300
  $null = Invoke-Step 'unpacking' $Tar @('-x', '-f', $tarFile, '-C', $Files) 300
  Remove-Item -LiteralPath $tarFile -Force

  foreach ($name in @('manifest.txt', 'db.dump', 'auth-users.csv')) {
    if (-not (Test-Path -LiteralPath (Join-Path $Files $name))) { Stop-Drill "the backup has no $name." }
  }
  $manifest = [System.IO.File]::ReadAllLines((Join-Path $Files 'manifest.txt'))
  if ($manifest[0] -ne 'nexra-backup/1') { Stop-Drill 'unknown manifest format.' }

  $section = ''
  $expected = New-Object System.Collections.Generic.List[object]
  $hashes = New-Object System.Collections.Generic.List[object]
  $serverNum = 0
  $createdUtc = ''
  foreach ($line in $manifest) {
    if ($line -eq '--- counts') { $section = 'counts'; continue }
    if ($line -eq '--- sha256') { $section = 'sha256'; continue }
    if ($line.Trim() -eq '') { continue }
    if ($section -eq '') {
      if ($line -match '^server_version_num (\d+)$') { $serverNum = [int]$Matches[1] }
      if ($line -match '^created_utc (\S+)$') { $createdUtc = $Matches[1] }
    } elseif ($section -eq 'counts') {
      if ($line -notmatch '^([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*) (\d+)$') { Stop-Drill "unreadable manifest count line: $line" }
      $expected.Add([pscustomobject]@{ Table = $Matches[1]; Count = [long]$Matches[2] })
    } else {
      if ($line -notmatch '^([0-9a-f]{64})  (\S+)$') { Stop-Drill "unreadable manifest hash line: $line" }
      $hashes.Add([pscustomobject]@{ Hash = $Matches[1]; File = $Matches[2] })
    }
  }
  if ($expected.Count -eq 0) { Stop-Drill 'the manifest lists no tables.' }
  if ($hashes.Count -lt 2) { Stop-Drill 'the manifest lists no file hashes.' }
  foreach ($entry in $hashes) {
    $actual = (Get-FileHash -LiteralPath (Join-Path $Files $entry.File) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $entry.Hash) { Stop-Drill "$($entry.File) does not match its manifest hash." }
  }
  if ($pgMajor -lt [int][Math]::Floor($serverNum / 10000)) {
    Stop-Drill "local PostgreSQL $pgMajor is older than the backup's server ($serverNum). Install PostgreSQL $RequiredMajor."
  }
  Write-Host "decrypted   : manifest and $($hashes.Count) files match their SHA-256; $($expected.Count) tables listed"

  # --- 4. A throwaway cluster: 127.0.0.1 only, a free port, trust authentication -----------
  # trust: nothing prompts for a password; the server listens on loopback only, for this run.
  $null = Invoke-Step 'initdb' $pg.initdb @('-D', $Data, '--username=postgres', '--auth=trust', '--encoding=UTF8', '--locale=C') 180
  $port = Get-FreePort
  $settings = @(
    '',
    '# restore drill: loopback only, this port, no Unix socket, no durability needed',
    "listen_addresses = '127.0.0.1'",
    "port = $port",
    "unix_socket_directories = ''",
    'fsync = off'
  )
  [System.IO.File]::AppendAllText((Join-Path $Data 'postgresql.conf'), ($settings -join "`n") + "`n")
  # pg_ctl on the console, never through a pipe; -l sends the server's output to its log.
  $started = $true
  $null = Invoke-Step 'pg_ctl start' $pg.pg_ctl @('start', '-D', $Data, '-l', $script:ServerLog, '-w', '-t', '60', '-s') 90 -Console

  $conn = @('-h', '127.0.0.1', '-p', "$port", '-U', 'postgres', '-w')
  function Invoke-Sql([string]$step, [string]$database, [string]$sql) {
    return Invoke-Step $step $pg.psql ($conn + @('-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', $database, '-c', $sql)) 60
  }
  $listen = Get-FirstLine (Invoke-Sql 'psql: read listen_addresses' 'postgres' 'show listen_addresses') 'psql: read listen_addresses'
  if ($listen -ne '127.0.0.1') { Stop-Drill "the throwaway server listens on '$listen', not 127.0.0.1 only; stopping." }
  $null = Invoke-Sql 'psql: create the drill database' 'postgres' 'create database drill'
  Write-Host "cluster     : PostgreSQL $pgMajor on 127.0.0.1:$port (throwaway, trust, loopback only)"

  # --- 5. Every role the dump names, created without login ---------------------------------
  $schemaSql = Join-Path $Work 'schema.sql'
  $null = Invoke-Step 'pg_restore: read the schema (roles)' $pg.pg_restore @('--schema-only', '-f', $schemaSql, (Join-Path $Files 'db.dump')) 120
  $roles = [regex]::Matches([System.IO.File]::ReadAllText($schemaSql), '(?:OWNER TO|TO|FROM) ([a-z_][a-z0-9_]*);') |
    ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
  Remove-Item -LiteralPath $schemaSql -Force
  foreach ($role in $roles) {
    if ($role -eq 'postgres' -or $role -eq 'public') { continue }
    $null = Invoke-Sql "psql: create role $role" 'postgres' "do `$`$ begin if not exists (select 1 from pg_roles where rolname = '$role') then create role $role nologin; end if; end `$`$;"
  }

  # --- 6. Restore: one transaction; pg_restore's order creates triggers after the data -------
  # The public schema exists in every new database, so its own CREATE and COMMENT entries are
  # left out of the list; everything in it is restored.
  $list = Invoke-Step 'pg_restore: list the dump' $pg.pg_restore @('--list', (Join-Path $Files 'db.dump')) 120
  $kept = $list | Where-Object { $_ -notmatch ' (SCHEMA|COMMENT) - (SCHEMA )?public ' }
  $listFile = Join-Path $Work 'restore.list'
  [System.IO.File]::WriteAllLines($listFile, [string[]]$kept)
  $null = Invoke-Step 'pg_restore: restore' $pg.pg_restore ($conn + @('--dbname=drill', '--exit-on-error', '--single-transaction', "--use-list=$listFile", (Join-Path $Files 'db.dump'))) 900
  Write-Host 'restored    : one transaction, no error'

  # --- 7. Compare every table's row count with the manifest ---------------------------------
  Write-Host "  start : row-count compare ($($expected.Count) tables)"
  $problems = New-Object System.Collections.Generic.List[string]
  foreach ($row in $expected) {
    try {
      $got = [long](Get-FirstLine (Invoke-Sql "psql: count $($row.Table)" 'drill' "select count(*) from $($row.Table)") "psql: count $($row.Table)")
      if ($got -ne $row.Count) { $problems.Add("$($row.Table): manifest $($row.Count), restored $got") }
    } catch [System.ApplicationException] {
      if ($_.Exception.Message -match 'timed out|returned no output') { throw }
      $problems.Add("$($row.Table): missing from the restore")
    }
  }
  Write-Host "  done  : row-count compare ($($problems.Count) differ)"
  $users = @([System.IO.File]::ReadAllLines((Join-Path $Files 'auth-users.csv')) | Where-Object { $_ -ne '' }).Count - 1
  $rows = ($expected | Measure-Object -Property Count -Sum).Sum
  if ($problems.Count -gt 0) {
    foreach ($p in $problems) { Write-Host "  differs: $p" }
    Write-Fail "$($problems.Count) of $($expected.Count) tables differ from the manifest (listed above)."
    $result = 1
  } else {
    Write-Host "RESTORE DRILL: OK - $($expected.Count) tables, $rows rows, every row count equals the manifest; $users auth users listed; backup $createdUtc, server $serverNum, restored on PostgreSQL $pgMajor" -ForegroundColor Green
    $result = 0
  }
} catch [System.ApplicationException] {
  Write-Fail $_.Exception.Message
  $result = 1
} catch {
  Write-Fail "unexpected error: $($_.Exception.Message)"
  $result = 1
} finally {
  if ($started) {
    try { $null = Invoke-Step 'pg_ctl stop' $pg.pg_ctl @('stop', '-D', $Data, '-m', 'immediate', '-w', '-t', '60', '-s') 90 -Console }
    catch { Write-Host "  warning: $($_.Exception.Message)" -ForegroundColor Yellow }
  }
  if ($null -eq $savedConnectTimeout) { Remove-Item Env:PGCONNECT_TIMEOUT -ErrorAction SilentlyContinue } else { $env:PGCONNECT_TIMEOUT = $savedConnectTimeout }
  if ($Keep) {
    Write-Host "kept (stopped; holds the DECRYPTED backup - delete it when done): $Work" -ForegroundColor Yellow
  } elseif (Remove-Folder $Work) {
    Write-Host 'cleaned up  : throwaway database and decrypted files deleted'
  } else {
    Write-Host "could not delete $Work - delete it by hand (it holds the decrypted backup)." -ForegroundColor Yellow
    if ($result -eq 0) { $result = 3 }
  }
}
exit $result
