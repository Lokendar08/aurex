@echo off
rem AUREX - one-click setup and launch for Windows 10/11 (64-bit).
rem
rem   launch.bat                 set up everything that is missing, start AUREX and open the browser
rem   launch.bat stop            stop the web app, the API and the database
rem   launch.bat status          show what is running
rem   launch.bat reset-demo      reload the synthetic NovaMart demo data
rem   launch.bat start -Dev      web app in development mode (hot reload)
rem
rem The first run downloads portable tools into .tools\ (uv, Python, Node.js, PostgreSQL) and the project's
rem packages; later runs start in seconds. The work is done by scripts\launch.ps1 (Windows PowerShell 5.1).
setlocal
cd /d "%~dp0"
where powershell.exe >nul 2>nul
if errorlevel 1 (
    echo Windows PowerShell was not found. AUREX needs Windows 10 or 11.
    pause
    exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launch.ps1" %*
set "AUREX_EXIT=%ERRORLEVEL%"
endlocal & exit /b %AUREX_EXIT%
