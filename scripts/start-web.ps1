param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir
function Test-PbServer {
  try { $health = & curl.exe --noproxy '*' --max-time 2 --silent http://127.0.0.1/api/health; return ($LASTEXITCODE -eq 0 -and ($health | ConvertFrom-Json).app -eq 'pb-valley-stock') } catch { return $false }
}
try {
  if (-not (Test-PbServer)) {
    if (Get-NetTCPConnection -LocalPort 80 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 80 is used by another program.' }
    $nodeExe = (Get-Command node -ErrorAction Stop).Source
    if (-not (Test-Path -LiteralPath 'web-dist\server.cjs')) { throw 'Run npm run build:web first.' }
    if (Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue) { throw 'Close the old PB Valley server on port 3080 before starting port 80.' }
    $env:PORT = '80'
    New-Item -ItemType Directory -Force -Path 'web-logs' | Out-Null
    Start-Process -FilePath $nodeExe -ArgumentList 'web-dist/server.cjs' -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput 'web-logs\server.log' -RedirectStandardError 'web-logs\server-error.log' | Out-Null
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) { if (Test-PbServer) { $ready = $true; break }; Start-Sleep -Milliseconds 500 }
    if (-not $ready) { throw 'Server did not start. See web-logs/server-error.log.' }
  }
  if (-not $NoBrowser) {
    $address = 'http://localhost'
    try { if ([Net.Dns]::GetHostAddresses('www.pbvalleystock.com').IPAddressToString -contains '127.0.0.1') { $address = 'http://www.pbvalleystock.com' } } catch {}
    Start-Process $address
  }
  Write-Output 'PB Valley Web is ready: http://localhost (LAN: http://192.168.0.100)'
} catch { Write-Error $_; exit 1 }
