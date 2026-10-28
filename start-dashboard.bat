@echo off
rem Starts the Forever Gold Tracker and opens it in the browser.
rem Keep this window open while you use the dashboard.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
start "" http://localhost:5173
call npm run dev
