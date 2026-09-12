@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo กำลังยกเลิกการเริ่ม Server อัตโนมัติ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$startup = [Environment]::GetFolderPath('Startup'); $path = \"$startup\PB Valley Stock Server.lnk\"; if (Test-Path $path) { Remove-Item $path -Force; Write-Host '[สำเร็จ] ยกเลิกการรันอัตโนมัติแล้ว' } else { Write-Host 'ยังไม่ได้ตั้งค่าการรันอัตโนมัติไว้' }"
echo.
pause
