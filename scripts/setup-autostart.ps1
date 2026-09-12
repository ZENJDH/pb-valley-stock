$ErrorActionPreference = 'Stop'
$startup = [Environment]::GetFolderPath('Startup')
$projectDir = Split-Path -Parent $PSScriptRoot

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut((Join-Path $startup 'PB Valley Stock Server.lnk'))
$sc.TargetPath = 'wscript.exe'
$sc.Arguments = "`"$projectDir\start-web-silent.vbs`""
$sc.WorkingDirectory = $projectDir
$sc.Description = 'PB Valley Stock Background Server'
$sc.Save()

Write-Output "Auto-start configured in Startup folder successfully!"
