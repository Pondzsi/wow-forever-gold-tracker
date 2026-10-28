@echo off
rem Removes the Forever Gold Tracker addon and background copier.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
echo.
pause
