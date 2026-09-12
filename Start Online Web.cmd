@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PB Valley Stock - Online Server
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-online.ps1"
if errorlevel 1 pause
