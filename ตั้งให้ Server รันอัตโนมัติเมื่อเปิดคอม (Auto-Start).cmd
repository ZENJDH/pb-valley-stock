@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo =======================================================
echo   กำลังตั้งค่าให้ Server รันอัตโนมัติเมื่อเปิด Windows...
echo =======================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-autostart.ps1"
echo.
echo [สำเร็จ] ตั้งค่าให้ Server เริ่มทำงานในเบื้องหลังอัตโนมัติเรียบร้อยแล้ว!
echo ทุกครั้งที่เปิดคอมพิวเตอร์ จะสามารถเข้าเว็บได้ทันทีโดยไม่ต้องเปิด Server เอง
echo.
pause
