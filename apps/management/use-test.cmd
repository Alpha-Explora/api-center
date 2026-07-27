@echo off
setlocal
cd /d "%~dp0"
if not exist ".env.test" (
  echo Missing .env.test
  exit /b 1
)
copy /Y ".env.test" ".env.local" >nul
echo Switched apicenter-management to TEST. Restart npm run dev.
