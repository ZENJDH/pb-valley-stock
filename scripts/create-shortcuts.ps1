$ErrorActionPreference = 'Stop'
$fso = New-Object -ComObject Scripting.FileSystemObject

$userFolders = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
$regDesktop = $userFolders.Desktop
if ($regDesktop -match '%USERPROFILE%') {
    $regDesktop = $regDesktop.Replace('%USERPROFILE%', $env:USERPROFILE)
}

$desktopFolder = $fso.GetFolder($regDesktop)
$shortDesktop = $desktopFolder.ShortPath
$projectDir = Split-Path -Parent $PSScriptRoot

$wsh = New-Object -ComObject WScript.Shell
$icoPath = Join-Path $projectDir 'build\icon.ico'

# 1. Shortcut: Web (Silent 1-Click Browser Launcher)
$webLink = Join-Path $shortDesktop 'PB Valley Stock (Web).lnk'
$vbsPath = Join-Path $projectDir 'start-web-silent.vbs'
$scWeb = $wsh.CreateShortcut($webLink)
$scWeb.TargetPath = 'wscript.exe'
$scWeb.Arguments = "`"$vbsPath`""
$scWeb.WorkingDirectory = $projectDir
if (Test-Path -LiteralPath $icoPath) {
    $scWeb.IconLocation = "$icoPath,0"
}
$scWeb.Description = 'PB Valley Stock - Web (Local)'
$scWeb.Save()
Write-Output "Created: PB Valley Stock (Web).lnk"

# 1.1 Shortcut: Online Web (Silent 1-Click Online Launcher)
$onlineLink = Join-Path $shortDesktop 'PB Valley Stock (Online).lnk'
$vbsOnlinePath = Join-Path $projectDir 'เปิดเว็บออนไลน์ PB Valley.vbs'
$scOnline = $wsh.CreateShortcut($onlineLink)
$scOnline.TargetPath = 'wscript.exe'
$scOnline.Arguments = "`"$vbsOnlinePath`""
$scOnline.WorkingDirectory = $projectDir
if (Test-Path -LiteralPath $icoPath) {
    $scOnline.IconLocation = "$icoPath,0"
}
$scOnline.Description = 'PB Valley Stock - Online Web (Static 4G-5G URL)'
$scOnline.Save()
Write-Output "Created: PB Valley Stock (Online).lnk"

# 2. Shortcut: Standalone Desktop Program (.exe)
$exePath = Join-Path $projectDir 'release\Stock Expiration Tracker 1.8.3.exe'
if (Test-Path -LiteralPath $exePath) {
    $appLink = Join-Path $shortDesktop 'PB Valley Stock (App).lnk'
    $scApp = $wsh.CreateShortcut($appLink)
    $scApp.TargetPath = $exePath
    $scApp.WorkingDirectory = $projectDir
    if (Test-Path -LiteralPath $icoPath) {
        $scApp.IconLocation = "$icoPath,0"
    }
    $scApp.Description = 'PB Valley Stock - Desktop App'
    $scApp.Save()
    Write-Output "Created: PB Valley Stock (App).lnk"
}
