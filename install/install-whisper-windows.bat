@echo off
rem Scarica whisper.cpp e un modello. Facoltativo: install-whisper-windows.bat medium
set "MODEL=%~1"
if "%MODEL%"=="" set "MODEL=small"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-whisper-windows.ps1" -Model %MODEL%
pause
