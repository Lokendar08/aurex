<#
.SYNOPSIS
    AUREX local launcher for Windows 10/11 (64-bit). Run it through launch.bat in the project root.

.DESCRIPTION
    Sets up everything AUREX needs on a computer that has nothing but Windows, then starts the app.
    Tools are portable copies inside the project folder (.tools\); nothing is installed system-wide except the
    Microsoft Visual C++ runtime, and only if Windows does not have it yet (PostgreSQL needs it).

    First run (roughly half a gigabyte of downloads; expect 10-20 minutes depending on the connection):
      1. uv (Python package and interpreter manager), which fetches Python 3.13 and the backend packages
      2. Node.js 22 (portable zip) and the frontend packages
      3. PostgreSQL 17 portable binaries (pinned npm package in .devtools\pg)
      4. A local PostgreSQL cluster on 127.0.0.1:5433, database migrations
      5. The synthetic NovaMart demo data and 22 forecast models (about 4-6 minutes, only once)
      6. A production build of the web app
    Every later run reuses all of that and starts in seconds.

    Commands:  start (default) | stop | status | reset-demo
    Switches:  -Dev           run the web app in development mode (hot reload) instead of the production build
               -NoBrowser     do not open the browser
               -Rebuild       rebuild the web app even if nothing changed
               -PortableTools always use the portable uv/Node.js in .tools\, even if they are installed on the PC
               -DryRun        only print what would be downloaded, installed or started
               -NoPause       do not wait for Enter before the window closes

.EXAMPLE
    launch.bat
    launch.bat stop
    launch.bat start -Dev
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "status", "reset-demo")]
    [string]$Command = "start",
    [switch]$Dev,
    [switch]$NoBrowser,
    [switch]$Rebuild,
    [switch]$PortableTools,
    [switch]$DryRun,
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # the progress bar makes Invoke-WebRequest very slow on PowerShell 5.1
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch { }

# ---- Pinned versions (the ones the project was built and tested with) ------------------------------------------
$UvVersion = "0.11.24"
$NodeVersion = "22.19.0"
$PythonVersion = "3.13"
$PgPort = 5433
$DefaultApiPort = 8000
$DefaultWebPort = 3000

# ---- Paths ------------------------------------------------------------------------------------------------------
$Root = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root ".tools"
$Downloads = Join-Path $Tools "downloads"
$Logs = Join-Path $Tools "logs"
$State = Join-Path $Tools "state"
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$PgPackage = Join-Path $Root ".devtools\pg"
$PgBin = Join-Path $PgPackage "node_modules\@embedded-postgres\windows-x64\native\bin"
$Python = Join-Path $Backend ".venv\Scripts\python.exe"
$DevDb = Join-Path $Root "scripts\devdb.py"

# ---- Output helpers ---------------------------------------------------------------------------------------------
function Write-Step([string]$Text) { Write-Host ""; Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Info([string]$Text) { Write-Host "    $Text" }
function Write-Ok([string]$Text) { Write-Host "    $Text" -ForegroundColor Green }
function Write-Warn([string]$Text) { Write-Host "    $Text" -ForegroundColor Yellow }

function New-Dir([string]$Path) {
    if (-not (Test-Path $Path)) { New-Item -ItemType Directory -Force -Path $Path | Out-Null }
}

function Get-RemoteFile([string]$Url, [string]$Destination) {
    if ($DryRun) { Write-Info "[dry run] would download $Url"; return $false }
    New-Dir (Split-Path -Parent $Destination)
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Write-Info "Downloading $Url"
            Invoke-WebRequest -Uri $Url -OutFile $Destination -UseBasicParsing
            Unblock-File -Path $Destination
            return $true
        } catch {
            if ($attempt -eq 3) { throw "Download failed: $Url ($($_.Exception.Message)). Check the internet connection and run launch.bat again." }
            Start-Sleep -Seconds (3 * $attempt)
        }
    }
}

function Expand-ZipFile([string]$Zip, [string]$Destination) {
    New-Dir $Destination
    $tar = Join-Path $env:SystemRoot "System32\tar.exe"
    if (Test-Path $tar) {
        & $tar -xf $Zip -C $Destination
        if ($LASTEXITCODE -ne 0) { throw "Could not extract $Zip" }
    } else {
        Expand-Archive -Path $Zip -DestinationPath $Destination -Force
    }
}

function Invoke-Tool([string]$Exe, [string[]]$Arguments, [string]$WorkDir, [string]$What) {
    if ($DryRun) { Write-Info "[dry run] $What"; return }
    Push-Location $WorkDir
    try {
        & $Exe @Arguments
        if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE). See the messages above." }
    } finally {
        Pop-Location
    }
}

function Get-VersionNumber([string]$Text) {
    $match = [regex]::Match($Text, '(\d+)\.(\d+)\.(\d+)')
    if (-not $match.Success) { return [version]"0.0.0" }
    return [version]$match.Value
}

# ---- Tools --------------------------------------------------------------------------------------------------------
function Get-Uv {
    if (-not $PortableTools) {
        $system = Get-Command uv -ErrorAction SilentlyContinue
        if ($system) {
            $version = Get-VersionNumber ((& $system.Source --version) | Out-String)
            if ($version -ge [version]$UvVersion) { Write-Info "Using uv $version ($($system.Source))"; return $system.Source }
            Write-Warn "uv $version is older than $UvVersion; using a portable uv instead."
        }
    }
    $local = Get-ChildItem -Path (Join-Path $Tools "uv") -Filter uv.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($local) { Write-Info "Using portable uv ($($local.FullName))"; return $local.FullName }
    $zip = Join-Path $Downloads "uv-$UvVersion-x86_64-pc-windows-msvc.zip"
    if (Get-RemoteFile "https://github.com/astral-sh/uv/releases/download/$UvVersion/uv-x86_64-pc-windows-msvc.zip" $zip) {
        Expand-ZipFile $zip (Join-Path $Tools "uv")
    }
    if ($DryRun) { return (Join-Path $Tools "uv\uv.exe") }
    $local = Get-ChildItem -Path (Join-Path $Tools "uv") -Filter uv.exe -Recurse | Select-Object -First 1
    if (-not $local) { throw "uv.exe not found after extracting $zip" }
    return $local.FullName
}

function Get-NodeDir {
    if (-not $PortableTools) {
        $system = Get-Command node -ErrorAction SilentlyContinue
        if ($system) {
            $version = Get-VersionNumber ((& $system.Source --version) | Out-String)
            if ($version -ge [version]"20.9.0") { Write-Info "Using Node.js $version ($($system.Source))"; return (Split-Path -Parent $system.Source) }
            Write-Warn "Node.js $version is too old for Next.js 16 (needs 20.9 or newer); using a portable Node.js $NodeVersion."
        }
    }
    $dir = Join-Path $Tools "node\node-v$NodeVersion-win-x64"
    if (Test-Path (Join-Path $dir "node.exe")) { Write-Info "Using portable Node.js $NodeVersion"; return $dir }
    $zip = Join-Path $Downloads "node-v$NodeVersion-win-x64.zip"
    if (Get-RemoteFile "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip" $zip) {
        Expand-ZipFile $zip (Join-Path $Tools "node")
    }
    if (-not $DryRun -and -not (Test-Path (Join-Path $dir "node.exe"))) { throw "node.exe not found after extracting $zip" }
    return $dir
}

function Confirm-VcRuntime {
    $system32 = Join-Path $env:SystemRoot "System32"
    $missing = @("vcruntime140.dll", "vcruntime140_1.dll", "msvcp140.dll") | Where-Object { -not (Test-Path (Join-Path $system32 $_)) }
    if (-not $missing) { return }
    Write-Step "Installing the Microsoft Visual C++ runtime (PostgreSQL needs it; missing: $($missing -join ', '))"
    $installer = Join-Path $Downloads "vc_redist.x64.exe"
    if (Get-RemoteFile "https://aka.ms/vs/17/release/vc_redist.x64.exe" $installer) {
        Write-Info "Windows will ask for permission to install it (one time only)."
        $process = Start-Process -FilePath $installer -ArgumentList "/install", "/quiet", "/norestart" -Verb RunAs -Wait -PassThru
        if ($process.ExitCode -notin 0, 1638, 3010) { throw "Visual C++ runtime installation failed (exit code $($process.ExitCode))." }
        Write-Ok "Visual C++ runtime installed"
    }
}

# ---- Setup steps ------------------------------------------------------------------------------------------------
function Install-Prerequisites {
    Write-Step "Checking tools"
    if (-not [Environment]::Is64BitOperatingSystem) { throw "AUREX needs 64-bit Windows 10 or 11." }
    New-Dir $Tools; New-Dir $Logs; New-Dir $State
    $script:Uv = Get-Uv
    $script:NodeDir = Get-NodeDir
    $env:PATH = "$($script:NodeDir);$env:PATH"
    $script:Node = Join-Path $script:NodeDir "node.exe"
    $script:Npm = Join-Path $script:NodeDir "npm.cmd"
    $env:NEXT_TELEMETRY_DISABLED = "1"
    $env:PYTHONIOENCODING = "utf-8"

    Write-Step "Backend: Python $PythonVersion and packages (backend\uv.lock)"
    $uvLockHash = (Get-FileHash (Join-Path $Backend "uv.lock") -Algorithm SHA256).Hash
    $uvMarker = Join-Path $State "backend-deps.sha256"
    if ((Test-Path $Python) -and (Test-Path $uvMarker) -and ((Get-Content $uvMarker -Raw).Trim() -eq $uvLockHash)) {
        Write-Info "Already installed"
    } else {
        Invoke-Tool $script:Uv @("sync", "--frozen", "--python", $PythonVersion) $Backend "Installing the backend packages"
        if (-not $DryRun) { Set-Content -Path $uvMarker -Value $uvLockHash }
    }

    Write-Step "Database: PostgreSQL 17 portable binaries"
    if (Test-Path (Join-Path $PgBin "pg_ctl.exe")) {
        Write-Info "Already installed"
    } else {
        Invoke-Tool $script:Npm @("ci", "--no-audit", "--no-fund", "--loglevel=error") $PgPackage "Installing the PostgreSQL binaries"
    }
    Confirm-VcRuntime

    Write-Step "Frontend: packages (frontend\package-lock.json)"
    $lockHash = (Get-FileHash (Join-Path $Frontend "package-lock.json") -Algorithm SHA256).Hash
    $marker = Join-Path $State "frontend-deps.sha256"
    $installed = Test-Path (Join-Path $Frontend "node_modules\next\package.json")
    if ($installed -and -not (Test-Path $marker) -and -not $DryRun) { Set-Content -Path $marker -Value $lockHash }
    if ($installed -and (Test-Path $marker) -and ((Get-Content $marker -Raw).Trim() -eq $lockHash)) {
        Write-Info "Already installed"
    } else {
        Invoke-Tool $script:Npm @("ci", "--no-audit", "--no-fund", "--loglevel=error") $Frontend "Installing the frontend packages"
        if (-not $DryRun) { Set-Content -Path $marker -Value $lockHash }
    }
}

function Start-Database {
    Write-Step "Database: local PostgreSQL on 127.0.0.1:$PgPort"
    Invoke-Tool $Python @($DevDb, "start") $Root "Starting PostgreSQL"
    Invoke-Tool $Python @($DevDb, "create-dbs") $Root "Creating the databases"
    Write-Step "Database: migrations"
    Invoke-Tool $Python @("-m", "alembic", "upgrade", "head") $Backend "Running the database migrations"
}

function Import-DemoData([switch]$Reset) {
    if ($Reset) {
        Write-Step "Demo data: reloading NovaMart from scratch (about 4-6 minutes)"
        Invoke-Tool $Python @("-m", "app.seed.demo", "--reset", "--train") $Backend "Loading the demo data"
    } else {
        Write-Step "Demo data: synthetic NovaMart (first run only, about 4-6 minutes)"
        Invoke-Tool $Python @("-m", "app.seed.demo", "--train", "--if-empty") $Backend "Loading the demo data"
    }
}

# ---- Ports and servers --------------------------------------------------------------------------------------------
function Test-PortFree([int]$Port) {
    # Busy if anything listens on the port on any address (IPv4 or IPv6): "localhost" resolves to ::1 first, so a
    # program on [::]:3000 would otherwise capture the browser even though 127.0.0.1:3000 looks free.
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        $busy = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
        if ($busy) { return $false }
    }
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), $Port
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) { $listener.Stop() }
    }
}

function Test-AurexApi([int]$Port) {
    try {
        $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/health" -TimeoutSec 3
        return ($response.status -eq "ok" -and $null -ne $response.version)
    } catch { return $false }
}

function Test-AurexWeb([int]$Port) {
    try {
        $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/sign-in" -UseBasicParsing -TimeoutSec 5
        return ($response.Content -match "AUREX")
    } catch { return $false }
}

function Select-Port([int]$Preferred, [string]$Kind) {
    for ($port = $Preferred; $port -lt $Preferred + 20; $port++) {
        $ours = if ($Kind -eq "api") { Test-AurexApi $port } else { Test-AurexWeb $port }
        if ($ours) { return @{ Port = $port; Running = $true } }
        if (Test-PortFree $port) { return @{ Port = $port; Running = $false } }
        Write-Warn "Port $port is used by another program; trying $($port + 1)."
    }
    throw "No free port found between $Preferred and $($Preferred + 19)."
}

function Wait-Http([string]$Url, [int]$Seconds, [string]$Name) {
    if ($DryRun) { return }
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            if ($response.StatusCode -lt 500) { return }
        } catch { }
        Start-Sleep -Seconds 1
    }
    throw "$Name did not respond at $Url within $Seconds seconds. Logs: $Logs"
}

function Save-Pid([string]$Name, [int]$ProcessId) { Set-Content -Path (Join-Path $State "$Name.pid") -Value $ProcessId }

function Stop-Saved([string]$Name) {
    $file = Join-Path $State "$Name.pid"
    if (-not (Test-Path $file)) { return $false }
    $processId = (Get-Content $file -Raw).Trim()
    if ($processId) { & taskkill.exe /PID $processId /T /F 2>$null | Out-Null }
    Remove-Item $file -Force
    return $true
}

function Get-WebStamp([string]$ApiUrl) {
    $files = @(Get-ChildItem -Path (Join-Path $Frontend "src"), (Join-Path $Frontend "public") -Recurse -File)
    $files += Get-Item (Join-Path $Frontend "next.config.ts"), (Join-Path $Frontend "package-lock.json")
    $newest = ($files | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc.Ticks
    return "$($files.Count)|$newest|$ApiUrl"
}

function Build-Web([string]$ApiUrl) {
    $server = Join-Path $Frontend ".next\standalone\server.js"
    $stampFile = Join-Path $State "web-build.stamp"
    $stamp = Get-WebStamp $ApiUrl
    if (-not $Rebuild -and (Test-Path $server) -and (Test-Path $stampFile) -and ((Get-Content $stampFile -Raw).Trim() -eq $stamp)) {
        Write-Step "Web app: production build is up to date"
        return
    }
    Write-Step "Web app: production build (1-3 minutes)"
    $env:AUREX_API_URL = $ApiUrl
    Invoke-Tool $script:Npm @("run", "build") $Frontend "Building the web app"
    if ($DryRun) { return }
    $standalone = Join-Path $Frontend ".next\standalone"
    Copy-Item -Path (Join-Path $Frontend ".next\static") -Destination (Join-Path $standalone ".next") -Recurse -Force
    Copy-Item -Path (Join-Path $Frontend "public") -Destination $standalone -Recurse -Force
    Set-Content -Path $stampFile -Value $stamp
}

function Start-Hidden([string]$Name, [string]$Exe, [string]$Arguments, [string]$WorkDir) {
    # Start-Process without redirection uses ShellExecute, which hands no inherited handles to the child; otherwise a
    # caller reading this launcher's output would wait until the servers exit. cmd.exe writes the log files.
    $out = Join-Path $Logs "$Name.log"
    $err = Join-Path $Logs "$Name.err.log"
    $commandLine = '/d /c ""' + $Exe + '" ' + $Arguments + ' > "' + $out + '" 2> "' + $err + '""'
    $process = Start-Process -FilePath "cmd.exe" -ArgumentList $commandLine -WorkingDirectory $WorkDir -WindowStyle Hidden -PassThru
    Save-Pid $Name $process.Id
}

function Start-Api([int]$Port) {
    Write-Step "API: starting on http://127.0.0.1:$Port"
    if ($DryRun) { Write-Info "[dry run] start uvicorn app.main:app on port $Port"; return }
    Start-Hidden "api" $Python "-m uvicorn app.main:app --host 127.0.0.1 --port $Port" $Backend
    Wait-Http "http://127.0.0.1:$Port/api/v1/health" 90 "The API"
    Write-Ok "API ready"
}

function Invoke-WarmUp([int]$Port) {
    # The first dashboard after a database start reads everything from disk; do it now, not on the user's first click.
    if ($DryRun) { return }
    Write-Step "Warming up the demo dashboard (can take a minute right after the database starts)"
    try {
        $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        $login = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/v1/auth/demo/login" -Method Post `
            -ContentType "application/json" -Body '{"role": "executive"}' -WebSession $session -TimeoutSec 120
        $org = $login.memberships[0].org_id
        $null = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/v1/orgs/$org/dashboard/executive" -WebSession $session `
            -UseBasicParsing -TimeoutSec 300
        Write-Ok "Dashboard ready"
    } catch {
        Write-Warn "Warm-up skipped ($($_.Exception.Message)); the first dashboard load may be slower."
    }
}

function Start-Web([int]$Port, [string]$ApiUrl) {
    Write-Step "Web app: starting on http://127.0.0.1:$Port"
    if ($DryRun) { Write-Info "[dry run] start the web server on port $Port"; return }
    $env:AUREX_API_URL = $ApiUrl
    $env:PORT = "$Port"
    $env:HOSTNAME = "127.0.0.1"
    if ($Dev) {
        $env:NODE_ENV = "development"
        Start-Hidden "web" (Join-Path $script:NodeDir "npx.cmd") "next dev -p $Port -H 127.0.0.1" $Frontend
        $timeout = 300
    } else {
        $env:NODE_ENV = "production"
        Start-Hidden "web" $script:Node "server.js" (Join-Path $Frontend ".next\standalone")
        $timeout = 90
    }
    Wait-Http "http://127.0.0.1:$Port/sign-in" $timeout "The web app"
    Write-Ok "Web app ready"
}

# ---- Commands ---------------------------------------------------------------------------------------------------
function Invoke-Start {
    Install-Prerequisites
    Start-Database
    Import-DemoData

    Write-Step "Ports"
    $api = Select-Port $DefaultApiPort "api"
    $web = Select-Port $DefaultWebPort "web"
    $apiUrl = "http://127.0.0.1:$($api.Port)"
    if (-not $DryRun) {
        Set-Content -Path (Join-Path $State "api.port") -Value $api.Port
        Set-Content -Path (Join-Path $State "web.port") -Value $web.Port
    }
    Write-Info "API port $($api.Port)$(if ($api.Running) { ' (already running)' }), web port $($web.Port)$(if ($web.Running) { ' (already running)' })"

    if (-not $Dev -and -not $web.Running) { Build-Web $apiUrl }
    if (-not $api.Running) { Start-Api $api.Port; Invoke-WarmUp $api.Port }
    if (-not $web.Running) { Start-Web $web.Port $apiUrl }

    $url = "http://127.0.0.1:$($web.Port)"   # explicit IPv4: "localhost" may resolve to another program on ::1
    Write-Host ""
    if ($DryRun) { Write-Host "Dry run complete: the steps above would run." -ForegroundColor Green; return }
    Write-Host "AUREX is running." -ForegroundColor Green
    Write-Host "  Web app : $url   (sign in with 'Explore the live demo')"
    Write-Host "  API     : $apiUrl/api/v1/docs"
    Write-Host "  Logs    : $Logs"
    Write-Host "  Stop    : launch.bat stop"
    if (-not $NoBrowser -and -not $DryRun) { Start-Process "$url/sign-in" }
}

function Invoke-Stop {
    Write-Step "Stopping AUREX"
    if (Stop-Saved "web") { Write-Info "Web app stopped" } else { Write-Info "Web app was not started by launch.bat" }
    if (Stop-Saved "api") { Write-Info "API stopped" } else { Write-Info "API was not started by launch.bat" }
    if (Test-Path $Python) {
        Push-Location $Root
        try { & $Python $DevDb stop } finally { Pop-Location }
        Write-Info "PostgreSQL stopped"
    }
}

function Get-SavedPort([string]$Name, [int]$Default) {
    $file = Join-Path $State "$Name.port"
    if (Test-Path $file) { return [int](Get-Content $file -Raw).Trim() }
    return $Default
}

function Invoke-Status {
    Write-Step "AUREX status"
    $apiPort = Get-SavedPort "api" $DefaultApiPort
    $webPort = Get-SavedPort "web" $DefaultWebPort
    $apiUp = Test-AurexApi $apiPort
    $webUp = Test-AurexWeb $webPort
    Write-Info ("API     (http://127.0.0.1:$apiPort): " + $(if ($apiUp) { "running" } else { "not running" }))
    Write-Info ("Web app (http://127.0.0.1:$webPort): " + $(if ($webUp) { "running" } else { "not running" }))
    if (Test-Path $Python) {
        Push-Location $Root
        try { & $Python $DevDb status } finally { Pop-Location }
    } else {
        Write-Info "Not set up yet: run launch.bat"
    }
}

# ---- Main -------------------------------------------------------------------------------------------------------
$exitCode = 0
try {
    Write-Host "AUREX launcher ($Command)$(if ($DryRun) { ' - dry run, nothing is downloaded or changed' })" -ForegroundColor White
    switch ($Command) {
        "start" { Invoke-Start }
        "stop" { Invoke-Stop }
        "status" { Invoke-Status }
        "reset-demo" { Install-Prerequisites; Start-Database; Import-DemoData -Reset }
    }
} catch {
    $exitCode = 1
    Write-Host ""
    Write-Host "AUREX launcher stopped: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Fix the problem above and run launch.bat again; finished steps are skipped." -ForegroundColor Red
}
if (-not $NoPause) {
    Write-Host ""
    Read-Host "Press Enter to close this window (AUREX keeps running in the background)" | Out-Null
}
exit $exitCode
