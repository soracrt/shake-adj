@echo off
setlocal

set DEST=%APPDATA%\Adobe\CEP\extensions\com.sora.shakeadj
set SRC=%~dp0

echo Installing Shake Adj extension...

if exist "%DEST%" (
  echo Removing old installation...
  rmdir /s /q "%DEST%"
)

xcopy /e /i /q "%SRC%." "%DEST%"

echo.
echo Done! Restart After Effects and find "Shake Adj" under Window > Extensions.
echo.
pause
