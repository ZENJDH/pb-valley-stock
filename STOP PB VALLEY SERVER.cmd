@echo off
cd /d "%~dp0"
title PB Valley Stock - Stop Server
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-server.ps1"
