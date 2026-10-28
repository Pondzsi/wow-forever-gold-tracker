@echo off
rem Forever Gold Tracker setup: installs the addon and the background copier.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
echo.
pause
