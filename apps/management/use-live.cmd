@echo off
setlocal
cd /d "%~dp0"
if not exist ".env.live" (
  echo Missing .env.live
  exit /b 1
)
copy /Y ".env.live" ".env.local" >nul
echo Switched apicenter-management to LIVE. Restart npm run dev.
