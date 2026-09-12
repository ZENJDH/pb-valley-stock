$ErrorActionPreference = 'SilentlyContinue'
$projectDir = Split-Path -Parent $PSScriptRoot
$stopped = New-Object System.Collections.Generic.List[string]

function Stop-PbProcess([int]$ProcessId, [string]$Label) {
  if ($ProcessId -le 0) { return }
  $proc = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $proc) { return }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 250
  if (-not (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
    $stopped.Add("$Label (PID $ProcessId)") | Out-Null
  }
}

Write-Host ''
Write-Host 'PB Valley Stock - Stop Server' -ForegroundColor Cyan
Write-Host '----------------------------------------' -ForegroundColor DarkGray

# Stop only this project's tunnel executables.
$ngrokPath = [IO.Path]::GetFullPath((Join-Path $projectDir 'scripts\ngrok.exe'))
$cloudflaredPath = [IO.Path]::GetFullPath((Join-Path $projectDir 'scripts\cloudflared.exe'))
$stableConfig = [IO.Path]::GetFullPath((Join-Path $projectDir 'web-data\cloudflared-stable.yml'))

Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | ForEach-Object {
  $exe = $_.ExecutablePath
  $cmd = $_.CommandLine
  if ($exe) {
    $fullExe = [IO.Path]::GetFullPath($exe)
    if ($fullExe -ieq $ngrokPath) {
      Stop-PbProcess $_.ProcessId 'ngrok tunnel'
    } elseif ($fullExe -ieq $cloudflaredPath -and ($cmd -like "*$stableConfig*" -or $cmd -match 'cloudflared-stable\.yml')) {
      Stop-PbProcess $_.ProcessId 'Cloudflare tunnel'
    }
  }
}

# Stop the PB Valley Node server only when it owns one of the ports used by this project.
$serverPids = @()
foreach ($port in @(80, 3080, 443)) {
  Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.OwningProcess -and $serverPids -notcontains $_.OwningProcess) {
      $serverPids += $_.OwningProcess
    }
  }
}

foreach ($pidValue in $serverPids) {
  $info = Get-CimInstance Win32_Process -Filter "ProcessId = $pidValue" -ErrorAction SilentlyContinue
  if ($info -and $info.Name -ieq 'node.exe' -and $info.CommandLine -match 'web-dist[\\/]server\.cjs') {
    Stop-PbProcess $pidValue 'PB Valley web server'
  }
}

# Remove only the temporary ngrok URL because it becomes invalid after stopping.
$onlineUrl = Join-Path $projectDir 'web-logs\online-url.txt'
if (Test-Path -LiteralPath $onlineUrl) { Remove-Item -LiteralPath $onlineUrl -Force -ErrorAction SilentlyContinue }

Write-Host ''
if ($stopped.Count -gt 0) {
  Write-Host 'ปิด Server เรียบร้อยแล้ว' -ForegroundColor Green
  foreach ($item in $stopped) { Write-Host "  - $item" -ForegroundColor Gray }
} else {
  Write-Host 'ไม่พบ PB Valley Server ที่กำลังทำงานอยู่' -ForegroundColor Yellow
}
Write-Host ''
Write-Host 'กดปุ่มใดก็ได้เพื่อปิดหน้าต่างนี้...' -ForegroundColor DarkGray
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
