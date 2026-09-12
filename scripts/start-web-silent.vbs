Set WshShell = CreateObject("WScript.Shell")
strPath = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
projectDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(strPath)
WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & projectDir & "\scripts\start-web.ps1"" -NoBrowser", 0, False
