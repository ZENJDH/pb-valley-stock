$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir

$staticDomain = 'unsarcastical-elwanda-corky.ngrok-free.dev'
$onlineUrl = "https://$staticDomain"

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
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    & $npm run build:web
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' }
  }
}

function Test-PbServer {
  try {
    $health = & curl.exe --noproxy '*' --max-time 2 --silent http://127.0.0.1/api/health
    return ($LASTEXITCODE -eq 0 -and ($health | ConvertFrom-Json).app -eq 'pb-valley-stock')
  } catch { return $false }
}

function Test-NgrokRunning {
  try {
    $res = & curl.exe --noproxy '*' --max-time 2 --silent http://127.0.0.1:4040/api/tunnels
    if ($LASTEXITCODE -eq 0 -and $res) {
      $json = $res | ConvertFrom-Json
      return ($json.tunnels.Count -gt 0)
    }
  } catch {}
  return $false
}

# 1. Ensure build
Ensure-WebBuild

# 2. Start local server if not running
if (-not (Test-PbServer)) {
  $nodeExe = (Get-Command node -ErrorAction Stop).Source
  if (-not (Test-Path -LiteralPath 'web-dist\server.cjs')) { throw 'Cannot find web-dist\server.cjs.' }
  
  $env:PORT = '80'
  New-Item -ItemType Directory -Force -Path 'web-logs' | Out-Null
  Start-Process -FilePath $nodeExe -ArgumentList 'web-dist/server.cjs' -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput 'web-logs\server.log' -RedirectStandardError 'web-logs\server-error.log' | Out-Null

  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-PbServer) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Server could not start. See web-logs\server-error.log.' }
}

# 3. Start ngrok tunnel if not running
if (-not (Test-NgrokRunning)) {
  $ngrokPath = Join-Path $projectDir 'scripts\ngrok.exe'
  if (-not (Test-Path $ngrokPath)) { throw 'Cannot find ngrok.exe in scripts folder.' }

  $ngrokLog = Join-Path $projectDir 'web-logs\ngrok.log'
  Start-Process -FilePath $ngrokPath -ArgumentList 'http', '127.0.0.1:80', "--domain=$staticDomain", '--log=stdout' -WorkingDirectory $projectDir -WindowStyle Hidden -RedirectStandardOutput $ngrokLog | Out-Null

  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-NgrokRunning) { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'Could not start ngrok tunnel. See web-logs\ngrok.log.' }
}

# 4. Save and copy URL
New-Item -ItemType Directory -Force -Path 'web-logs' | Out-Null
Set-Content -Path 'web-logs\online-url.txt' -Value $onlineUrl -Encoding utf8
try { Set-Clipboard -Value $onlineUrl } catch {}

# 5. Open browser
Start-Process $onlineUrl
