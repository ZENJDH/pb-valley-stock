$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this setup as Administrator.' }
if (-not (Get-NetIPAddress -IPAddress '192.168.0.100' -AddressFamily IPv4 -ErrorAction SilentlyContinue)) { throw 'Server IP changed. Review the LAN IP before setup.' }
$hostsFile = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$content = [IO.File]::ReadAllText($hostsFile)
if ($content -notmatch '(?m)^127\.0\.0\.1\s+www\.pbvalleystock\.com\s+pbvalleystock\.com\s*$') {
  if ($content -match '(?m)^[^#\r\n]*\bpbvalleystock\.com\b') { throw 'An existing hosts entry needs review; it was not overwritten.' }
  $backup = Join-Path $projectDir ('web-logs\hosts-before-' + (Get-Date -Format 'yyyyMMddHHmmss') + '.txt')
  New-Item -ItemType Directory -Force -Path (Split-Path $backup) | Out-Null
  Copy-Item -LiteralPath $hostsFile -Destination $backup
  [IO.File]::AppendAllText($hostsFile, "`r`n# PB Valley local server`r`n127.0.0.1 www.pbvalleystock.com pbvalleystock.com`r`n", [Text.Encoding]::ASCII)
}
$nodeExe = (Get-Command node -ErrorAction Stop).Source
if (-not (Get-NetFirewallRule -Name 'PBValleyStock-LAN-HTTP' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name 'PBValleyStock-LAN-HTTP' -DisplayName 'PB Valley Stock - company LAN HTTP' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80 -LocalAddress '192.168.0.100' -RemoteAddress '192.168.0.0/24' -Program $nodeExe -Profile Any | Out-Null
}
Clear-DnsClientCache
Set-Content -LiteralPath (Join-Path $projectDir 'web-logs\company-setup-ok.txt') -Value 'Hosts and LAN firewall configured.'
