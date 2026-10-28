@echo off
rem Development only: runs the dashboard from this repo at http://localhost:5173.
rem Players use https://pondzsi.github.io/wow-forever-gold-tracker/ instead.
rem Needs Node.js. Keep this window open while you use the dashboard.
rem localhost has its own browser data, separate from the GitHub Pages site.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies...
  call npm install
)
start "" http://localhost:5173
call npm run dev
