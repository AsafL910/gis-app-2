@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Run-RgbGpkg.ps1" %*
echo.
pause
endlocal
