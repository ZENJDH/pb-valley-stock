param(
  [string]$Hostname = 'www.pbvalleystock.com',
  [string]$TunnelName = 'pb-valley-stock'
)

$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir

$cloudflared = Join-Path $projectDir 'scripts\cloudflared.exe'
if (-not (Test-Path -LiteralPath $cloudflared)) {
  throw 'Cannot find scripts\cloudflared.exe.'
}

Write-Host ''
Write-Host 'PB Valley Stock - Stable Online URL Setup' -ForegroundColor Cyan
Write-Host '------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host "Fixed hostname: https://$Hostname" -ForegroundColor Yellow
Write-Host "Tunnel name:    $TunnelName" -ForegroundColor Yellow
Write-Host ''
Write-Host 'This is a ONE-TIME setup. The domain must already be added to your Cloudflare account.' -ForegroundColor Gray
Write-Host 'A browser will open for Cloudflare login/authorization.' -ForegroundColor Gray
Write-Host ''

& $cloudflared tunnel login
if ($LASTEXITCODE -ne 0) { throw 'Cloudflare login was not completed.' }

function Get-TunnelByName {
  $raw = & $cloudflared tunnel list --output json
  if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
  try {
    $items = $raw | ConvertFrom-Json
    return $items | Where-Object { $_.name -eq $TunnelName } | Select-Object -First 1
  } catch {
    return $null
  }
}

$tunnel = Get-TunnelByName
if (-not $tunnel) {
  Write-Host "Creating named tunnel '$TunnelName'..." -ForegroundColor Cyan
  & $cloudflared tunnel create $TunnelName
  if ($LASTEXITCODE -ne 0) { throw 'Could not create Cloudflare Named Tunnel.' }
  $tunnel = Get-TunnelByName
}

if (-not $tunnel -or -not $tunnel.id) {
  throw "Could not locate tunnel '$TunnelName' after creation."
}

$tunnelId = [string]$tunnel.id
$credentialsFile = Join-Path $env:USERPROFILE ".cloudflared\$tunnelId.json"
if (-not (Test-Path -LiteralPath $credentialsFile)) {
  throw "Tunnel credentials file was not found: $credentialsFile"
}

Write-Host "Routing $Hostname to the named tunnel..." -ForegroundColor Cyan
& $cloudflared tunnel route dns $TunnelName $Hostname
if ($LASTEXITCODE -ne 0) {
  Write-Warning 'Cloudflare could not create the DNS route automatically. If that hostname already has a DNS record, remove/replace the conflicting record in Cloudflare and run this setup again.'
  throw 'DNS route setup failed.'
}

New-Item -ItemType Directory -Force -Path 'web-data' | Out-Null
New-Item -ItemType Directory -Force -Path 'web-logs' | Out-Null

$credentialsYamlPath = $credentialsFile -replace '\\', '/'
$config = @"
tunnel: $tunnelId
credentials-file: "$credentialsYamlPath"
ingress:
  - hostname: $Hostname
    service: http://127.0.0.1:80
  - service: http_status:404
"@

$configPath = Join-Path $projectDir 'web-data\cloudflared-stable.yml'
Set-Content -LiteralPath $configPath -Value $config -Encoding utf8
Set-Content -LiteralPath (Join-Path $projectDir 'web-logs\stable-public-url.txt') -Value "https://$Hostname" -Encoding utf8
Set-Content -LiteralPath (Join-Path $projectDir 'web-logs\stable-tunnel-name.txt') -Value $TunnelName -Encoding utf8

Write-Host ''
Write-Host 'Stable URL setup complete.' -ForegroundColor Green
Write-Host "URL: https://$Hostname" -ForegroundColor Green
Write-Host ''
Write-Host 'From now on, use: Start Online Web Stable.cmd' -ForegroundColor Yellow
Write-Host 'The public URL will stay the same after closing/reopening the tunnel.' -ForegroundColor Yellow
Write-Host ''
pause
