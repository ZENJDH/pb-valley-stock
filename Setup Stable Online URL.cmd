@echo off
chcp 65001 >nul
cd /d "%~dp0"
title PB Valley Stock - Setup Stable Online URL
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-stable-online.ps1"
if errorlevel 1 pause
