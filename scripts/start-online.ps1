param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir

function Ensure-WebBuild {
  $serverBuild = Join-Path $projectDir 'web-dist\server.cjs'
  $publicBuild = Join-Path $projectDir 'web-dist\public\index.html'
  $needsBuild = -not (Test-Path -LiteralPath $serverBuild) -or -not (Test-Path -LiteralPath $publicBuild)
  if (-not $needsBuild) {
    $latestSource = Get-ChildItem -LiteralPath (Join-Path $projectDir 'web'), (Join-Path $projectDir 'src') -Recurse -File | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    $oldestBuild = @((Get-Item -LiteralPath $serverBuild).LastWriteTimeUtc, (Get-Item -LiteralPath $publicBuild).LastWriteTimeUtc) | Sort-Object | Select-Object -First 1
    $needsBuild = $latestSource -and $latestSource.LastWriteTimeUtc -gt $oldestBuild
  }
  if ($needsBuild) {
    Write-Host 'Updating web build...' -ForegroundColor Cyan
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    & $npm run build:web
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
  }
}
Ensure-WebBuild

function Test-PbServer {
  try {
    $health = & curl.exe --noproxy '*' --max-time 2 --silent http://127.0.0.1/api/health
    return ($LASTEXITCODE -eq 0 -and ($health | ConvertFrom-Json).app -eq 'pb-valley-stock')
  } catch { return $false }
}

function Get-NgrokUrl {
  try {
    $res = & curl.exe --noproxy '*' --max-time 2 --silent http://127.0.0.1:4040/api/tunnels
    if ($LASTEXITCODE -eq 0 -and $res) {
      $json = $res | ConvertFrom-Json
      $tunnel = $json.tunnels | Where-Object { $_.public_url -match '^https://' } | Select-Object -First 1
      if ($tunnel) { return $tunnel.public_url }
    }
  } catch {}
  return $null
}

# 1. Start local server if not running
if (-not (Test-PbServer)) {
  Write-Host "[1/2] Starting local stock server..." -ForegroundColor Cyan
  $nodeExe = (Get-Command node -ErrorAction Stop).Source
  if (-not (Test-Path -LiteralPath 'web-dist\server.cjs')) { throw 'Please run npm run build:web first.' }
  
  $env:PORT = '80'
  New-Item -ItemType Directory -Force -Path 'web-logs' | Out-Null
  Start-Process -FilePath $nodeExe -ArgumentList 'web-dist/server.cjs' -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput 'web-logs\server.log' -RedirectStandardError 'web-logs\server-error.log' | Out-Null

  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-PbServer) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Server could not start. See web-logs\server-error.log.' }
} else {
  Write-Host "[1/2] Local server is running (Port 80)" -ForegroundColor Green
}

# 2. Check ngrok.exe
$ngrokPath = Join-Path $projectDir 'scripts\ngrok.exe'
if (-not (Test-Path $ngrokPath)) {
  throw 'Cannot find ngrok.exe in scripts folder.'
}

$staticDomain = 'unsarcastical-elwanda-corky.ngrok-free.dev'
$onlineUrl = Get-NgrokUrl

if (-not $onlineUrl) {
  Write-Host "[2/2] Connecting to static ngrok tunnel ($staticDomain)..." -ForegroundColor Cyan
  $ngrokLog = Join-Path $projectDir 'web-logs\ngrok.log'
  
  $tunnelProc = Start-Process -FilePath $ngrokPath -ArgumentList 'http', '127.0.0.1:80', "--domain=$staticDomain", '--log=stdout' -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput $ngrokLog -PassThru
  
  for ($i = 0; $i -lt 30; $i++) {
    $onlineUrl = Get-NgrokUrl
    if ($onlineUrl) { break }
    Start-Sleep -Milliseconds 500
  }
}

if (-not $onlineUrl) {
  throw 'Could not create online URL. Check web-logs\ngrok.log.'
}

# Save URL to file for easy reference
New-Item -ItemType Directory -Force -Path 'web-logs' | Out-Null
Set-Content -Path 'web-logs\online-url.txt' -Value $onlineUrl -Encoding utf8

# Save link to Desktop
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $urlFile = Join-Path $desktop 'PB Valley Stock (Online 4G-5G).url'
  $urlContent = "[InternetShortcut]`r`nURL=$onlineUrl`r`nIconIndex=0`r`n"
  Set-Content -Path $urlFile -Value $urlContent -Encoding utf8
} catch {}

# Copy to clipboard
try { Set-Clipboard -Value $onlineUrl } catch {}

Clear-Host
Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "   PB Valley Stock - Online System Ready! (Free 100%)" -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""
Write-Host " Public URL (Access from anywhere on Mobile / 4G / 5G):" -ForegroundColor Yellow
Write-Host " 👉 $onlineUrl" -ForegroundColor Cyan
Write-Host ""
Write-Host " [Copied URL to Clipboard - paste it in LINE or mobile browser]" -ForegroundColor Gray
Write-Host " Note: When opening for the first time, tap 'Visit Site' button." -ForegroundColor Gray
Write-Host " Local LAN URL (same Wi-Fi): http://192.168.0.100" -ForegroundColor Gray
Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
Write-Host " Keep this window open or minimized while using online." -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Green
Write-Host ""

if (-not $NoBrowser) {
  Start-Process $onlineUrl
}

if ($tunnelProc) {
  try {
    while (-not $tunnelProc.HasExited) {
      Start-Sleep -Seconds 1
    }
  } finally {
    if (-not $tunnelProc.HasExited) {
      $tunnelProc.Kill()
    }
  }
}