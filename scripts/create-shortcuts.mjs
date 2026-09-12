import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

const projectDir = resolve('.')
const vbsPath = resolve('start-web-silent.vbs')
const icoPath = resolve('build/icon.ico')
const exePath = resolve('release/Stock Expiration Tracker 1.8.3.exe')

const psScript = `
$ErrorActionPreference = 'Stop'
$fso = New-Object -ComObject Scripting.FileSystemObject

$regDesktop = (Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders').Desktop
if ($regDesktop -match '%USERPROFILE%') {
  $regDesktop = $regDesktop.Replace('%USERPROFILE%', $env:USERPROFILE)
}

$desktopFolder = $fso.GetFolder($regDesktop)
$shortDesktop = $desktopFolder.ShortPath
$wsh = New-Object -ComObject WScript.Shell

# 1. Shortcut: Web (Silent Background Server)
$scWeb = $wsh.CreateShortcut("$shortDesktop\\PB Valley Stock (Web).lnk")
$scWeb.TargetPath = "wscript.exe"
$scWeb.Arguments = "\`"${vbsPath.replace(/\\/g, '\\\\')}\`""
$scWeb.WorkingDirectory = "${projectDir.replace(/\\/g, '\\\\')}"
if (Test-Path -LiteralPath "${icoPath.replace(/\\/g, '\\\\')}") {
  $scWeb.IconLocation = "${icoPath.replace(/\\/g, '\\\\')},0"
}
$scWeb.Description = "PB Valley Stock - Web"
$scWeb.Save()
Write-Output "Created: PB Valley Stock (Web).lnk"

# 2. Shortcut: Standalone Desktop App (.exe)
if (Test-Path -LiteralPath "${exePath.replace(/\\/g, '\\\\')}") {
  $scApp = $wsh.CreateShortcut("$shortDesktop\\PB Valley Stock (App).lnk")
  $scApp.TargetPath = "${exePath.replace(/\\/g, '\\\\')}"
  $scApp.WorkingDirectory = "${projectDir.replace(/\\/g, '\\\\')}"
  if (Test-Path -LiteralPath "${icoPath.replace(/\\/g, '\\\\')}") {
    $scApp.IconLocation = "${icoPath.replace(/\\/g, '\\\\')},0"
  }
  $scApp.Description = "PB Valley Stock - Desktop Application"
  $scApp.Save()
  Write-Output "Created: PB Valley Stock (App).lnk"
}
`

try {
  const result = execSync('powershell.exe -NoProfile -ExecutionPolicy Bypass -Command -', {
    input: psScript,
    encoding: 'utf8'
  })
  console.log(result)
} catch (err) {
  console.error(err.stderr || err.message)
}
