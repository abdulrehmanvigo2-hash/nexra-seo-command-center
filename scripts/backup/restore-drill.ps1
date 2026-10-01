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
       free port, with a random password made for this run;
    5. restores the backup into it and compares every table's row count with the manifest;
    6. prints one line, "RESTORE DRILL: OK ..." or "RESTORE DRILL: FAIL ...";
    7. stops the cluster and deletes the folder: the database and every decrypted file.

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
  [int]$TestMinimumMajor = 17
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

# Run a native program; return its output lines (stdout and stderr together) and stop on a
# non-zero exit. Windows PowerShell 5.1 turns stderr lines into errors under 'Stop', so the
# preference is relaxed for the call itself.
function Invoke-Program([string]$exe, [string[]]$arguments, [string]$what) {
  $saved = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $exe @arguments 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $saved
  }
  if ($code -ne 0) {
    $tail = ($output | Select-Object -Last 15) -join [Environment]::NewLine
    Stop-Drill "$what failed (exit $code).$([Environment]::NewLine)$tail"
  }
  return $output
}

function Get-Major([string]$versionLine) {
  if ($versionLine -match '\s(\d+)(\.\d+)*') { return [int]$Matches[1] }
  return 0
}

function Get-FreePort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  $listener.Start()
  $port = $listener.LocalEndpoint.Port
  $listener.Stop()
  return $port
}

function New-RandomPassword {
  $bytes = New-Object byte[] 24
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return ([Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', 'x')
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
  $pgMajor = Get-Major ((Invoke-Program $pg.postgres @('--version') 'postgres --version') | Select-Object -First 1)
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
if ($OnWindows) {
  # Only the current user may read the folder (it will hold the decrypted backup).
  $null = & icacls.exe $Work /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" 2>&1
}

$started = $false
$savedPassword = $env:PGPASSWORD
$result = 1
try {
  # --- 3. Decrypt and unpack ---------------------------------------------------------------
  $encrypted = $Backup
  if ($Backup -match '\.zip$') {
    $unzipped = Join-Path $Work 'artifact'
    Expand-Archive -LiteralPath $Backup -DestinationPath $unzipped -Force
    $inside = @(Get-ChildItem -LiteralPath $unzipped -Recurse -File -Filter '*.tar.age')
    if ($inside.Count -ne 1) { Stop-Drill "the zip should hold exactly one .tar.age file; it holds $($inside.Count)." }
    $encrypted = $inside[0].FullName
  }
  $header = New-Object byte[] 21
  $stream = [System.IO.File]::OpenRead($encrypted)
  try { $null = $stream.Read($header, 0, 21) } finally { $stream.Dispose() }
  if ([System.Text.Encoding]::ASCII.GetString($header) -ne 'age-encryption.org/v1') { Stop-Drill 'the backup is not an age file.' }

  $tarFile = Join-Path $Work 'backup.tar'
  $null = Invoke-Program $Age @('--decrypt', '--identity', $KeyFile, '--output', $tarFile, $encrypted) 'decryption (wrong key, or a damaged file)'
  $null = Invoke-Program $Tar @('-x', '-f', $tarFile, '-C', $Files) 'unpacking'
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

  # --- 4. A throwaway cluster: 127.0.0.1 only, a free port, a password made for this run ---
  $password = New-RandomPassword
  $pwFile = Join-Path $Work 'pw.txt'
  [System.IO.File]::WriteAllText($pwFile, $password)
  $null = Invoke-Program $pg.initdb @('-D', $Data, '--username=postgres', "--pwfile=$pwFile", '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C') 'initdb'
  Remove-Item -LiteralPath $pwFile -Force
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
  $null = Invoke-Program $pg.pg_ctl @('-D', $Data, '-l', (Join-Path $Work 'server.log'), '-w', '-t', '60', 'start') 'starting the throwaway PostgreSQL'
  $started = $true

  $env:PGPASSWORD = $password
  $conn = @('-h', '127.0.0.1', '-p', "$port", '-U', 'postgres')
  function Invoke-Sql([string]$database, [string]$sql, [string]$what) {
    return Invoke-Program $pg.psql ($conn + @('-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-d', $database, '-c', $sql)) $what
  }
  $listen = (Invoke-Sql 'postgres' 'show listen_addresses' 'reading listen_addresses' | Select-Object -First 1).Trim()
  if ($listen -ne '127.0.0.1') { Stop-Drill "the throwaway server listens on '$listen', not 127.0.0.1 only; stopping." }
  $null = Invoke-Sql 'postgres' 'create database drill' 'creating the drill database'
  Write-Host "cluster     : PostgreSQL $pgMajor on 127.0.0.1:$port (throwaway)"

  # --- 5. Every role the dump names, created without login ---------------------------------
  $schemaSql = Join-Path $Work 'schema.sql'
  $null = Invoke-Program $pg.pg_restore @('--schema-only', '-f', $schemaSql, (Join-Path $Files 'db.dump')) 'reading the dump schema'
  $roles = [regex]::Matches([System.IO.File]::ReadAllText($schemaSql), '(?:OWNER TO|TO|FROM) ([a-z_][a-z0-9_]*);') |
    ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
  Remove-Item -LiteralPath $schemaSql -Force
  foreach ($role in $roles) {
    if ($role -eq 'postgres' -or $role -eq 'public') { continue }
    $null = Invoke-Sql 'postgres' "do `$`$ begin if not exists (select 1 from pg_roles where rolname = '$role') then create role $role nologin; end if; end `$`$;" "creating role $role"
  }

  # --- 6. Restore: one transaction; pg_restore's order creates triggers after the data -------
  # The public schema exists in every new database, so its own CREATE and COMMENT entries are
  # left out of the list; everything in it is restored.
  $list = Invoke-Program $pg.pg_restore @('--list', (Join-Path $Files 'db.dump')) 'listing the dump'
  $kept = $list | Where-Object { $_ -notmatch ' (SCHEMA|COMMENT) - (SCHEMA )?public ' }
  $listFile = Join-Path $Work 'restore.list'
  [System.IO.File]::WriteAllLines($listFile, [string[]]$kept)
  $null = Invoke-Program $pg.pg_restore ($conn + @('--dbname=drill', '--exit-on-error', '--single-transaction', "--use-list=$listFile", (Join-Path $Files 'db.dump'))) 'pg_restore'
  Write-Host 'restored    : one transaction, no error'

  # --- 7. Compare every table's row count with the manifest ---------------------------------
  $problems = New-Object System.Collections.Generic.List[string]
  foreach ($row in $expected) {
    try {
      $got = [long]((Invoke-Sql 'drill' "select count(*) from $($row.Table)" "counting $($row.Table)" | Select-Object -First 1).Trim())
      if ($got -ne $row.Count) { $problems.Add("$($row.Table): manifest $($row.Count), restored $got") }
    } catch {
      $problems.Add("$($row.Table): missing from the restore")
    }
  }
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
    $saved = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $null = & $pg.pg_ctl -D $Data -m immediate -w stop 2>&1
    $ErrorActionPreference = $saved
  }
  if ($null -eq $savedPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue } else { $env:PGPASSWORD = $savedPassword }
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
