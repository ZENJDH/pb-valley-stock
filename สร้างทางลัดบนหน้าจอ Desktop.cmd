@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo =======================================================
echo   กำลังสร้างทางลัดไปยังหน้าจอคอมพิวเตอร์ (Desktop)...
echo =======================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcuts.ps1"
echo.
echo [เรียบร้อย] ท่านสามารถดับเบิลคลิกไอคอนบนหน้าจอคอมเพื่อใช้งานได้ทันที:
echo   1. "PB Valley Stock (App)"  - เปิดแบบโปรแกรมเดี่ยว ไม่ต้องเปิด Server เลย
echo   2. "PB Valley Stock (Web)"  - เปิดแบบหน้าเว็บ รัน Server เงียบๆ ในเบื้องหลังอัตโนมัติ
echo.
pause
