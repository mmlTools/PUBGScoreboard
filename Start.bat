@echo off
setlocal
title PUBG Scoreboard
cd /d "%~dp0"

rem  Starts the scoreboard server and opens the control panel.
rem  Uses the PHP bundled with the portable package (runtime\php), or the PHP on your PATH.
rem  Extra options are passed on:   Start.bat --port=9000   Start.bat --lan

set "PHP=%~dp0runtime\php\php.exe"
if exist "%PHP%" goto run

where php >nul 2>nul
if errorlevel 1 goto nophp
set "PHP=php"

:run
"%PHP%" server.php --open %*
set "CODE=%ERRORLEVEL%"
if "%CODE%"=="0" exit /b 0
rem  Ctrl+C / closing the window is a normal way to stop the server.
if "%CODE%"=="-1073741510" exit /b 0
if "%CODE%"=="-1073741515" goto novc

echo.
echo   The server stopped (code %CODE%). See the message above.
echo.
pause
exit /b 1

:novc
echo.
echo   PHP could not start because the Microsoft Visual C++ runtime is missing.
echo   Install it (free, from Microsoft) and run Start.bat again:
echo       https://aka.ms/vs/17/release/vc_redist.x64.exe
echo.
pause
exit /b 1

:nophp
echo.
echo   PHP was not found on this computer.
echo.
echo   Easiest fix: download the "windows-portable" package, which includes PHP:
echo       https://github.com/mmlTools/PUBGScoreboard/releases/latest
echo.
echo   Or install PHP 7.4+ yourself (https://windows.php.net/download) and add it to PATH.
echo.
pause
exit /b 1
