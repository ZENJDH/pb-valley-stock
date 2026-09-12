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

$configPath = Join-Path $projectDir 'web-data\cloudflared-stable.yml'
$urlPath = Join-Path $projectDir 'web-logs\stable-public-url.txt'
$cloudflared = Join-Path $projectDir 'scripts\cloudflared.exe'

if (-not (Test-Path -LiteralPath $cloudflared)) { throw 'Cannot find scripts\cloudflared.exe.' }
if (-not (Test-Path -LiteralPath $configPath)) {
  throw 'Stable URL is not configured yet. Run Setup Stable Online URL.cmd once first.'
}

if (-not (Test-PbServer)) {
  Write-Host '[1/2] Starting local stock server...' -ForegroundColor Cyan
  $nodeExe = (Get-Command node -ErrorAction Stop).Source
  if (-not (Test-Path -LiteralPath 'web-dist\server.cjs')) { throw 'Please run npm run build:web first.' }
  $env:PORT = '80'
  Remove-Item Env:PB_HTTPS -ErrorAction SilentlyContinue
  Start-Process -FilePath $nodeExe -ArgumentList 'web-dist/server.cjs' -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput 'web-logs\server.log' -RedirectStandardError 'web-logs\server-error.log' | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-PbServer) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Server could not start. See web-logs\server-error.log.' }
}

$onlineUrl = if (Test-Path -LiteralPath $urlPath) { (Get-Content -LiteralPath $urlPath -Raw).Trim() } else { 'https://www.pbvalleystock.com' }
if (-not $onlineUrl) { $onlineUrl = 'https://www.pbvalleystock.com' }

Write-Host '[2/2] Starting Cloudflare Named Tunnel...' -ForegroundColor Cyan
$tunnelProc = Start-Process -FilePath $cloudflared -ArgumentList 'tunnel','--config',"$configPath",'run' -WorkingDirectory $projectDir -PassThru
Start-Sleep -Seconds 2
if ($tunnelProc.HasExited) { throw 'Cloudflare Named Tunnel stopped immediately. Check its console output/configuration.' }

try { Set-Clipboard -Value $onlineUrl } catch {}

Clear-Host
Write-Host ''
Write-Host '=================================================================' -ForegroundColor Green
Write-Host '   PB Valley Stock - Stable Online URL' -ForegroundColor Green
Write-Host '=================================================================' -ForegroundColor Green
Write-Host ''
Write-Host ' Public URL:' -ForegroundColor Yellow
Write-Host " $onlineUrl" -ForegroundColor Cyan
Write-Host ''
Write-Host ' This URL remains the same after closing and reopening.' -ForegroundColor Green
Write-Host ' Keep this window open or minimized while using online.' -ForegroundColor Yellow
Write-Host '=================================================================' -ForegroundColor Green

if (-not $NoBrowser) { Start-Process $onlineUrl }

try {
  while (-not $tunnelProc.HasExited) { Start-Sleep -Seconds 1 }
} finally {
  if (-not $tunnelProc.HasExited) { $tunnelProc.Kill() }
}
