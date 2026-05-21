@echo off
setlocal enableDelayedExpansion

REM Git Bash detection: 4-layer fallback (prefer MSYS usr\bin\bash over MINGW64 bin\bash)
REM
REM Why prefer usr\bin\bash.exe:
REM   When MINGW64 bin\bash.exe launches Claude Code, hook commands like
REM   "path\run-hook.cmd session-start" get parsed by PowerShell instead of
REM   cmd.exe, producing "SessionStart:startup hook error / UnexpectedToken
REM   session-start". MSYS usr\bin\bash.exe does not trigger this. Root cause
REM   sits inside Claude Code's hook spawning, but switching the shell at the
REM   source side reliably avoids it.
REM
REM   Layer 1: hardcoded common paths
REM   Layer 2: registry HKCU/HKLM\SOFTWARE\GitForWindows\InstallPath
REM   Layer 3: derive from `where git` -> <root>\{usr\bin,bin}\bash.exe
REM   Layer 4: error message with install hint

set "BASH="

REM Layer 1: hardcoded common paths (usr\bin first, bin second)
if exist "D:\IDE\Git\Git\usr\bin\bash.exe" set "BASH=D:\IDE\Git\Git\usr\bin\bash.exe"
if not defined BASH if exist "C:\Program Files\Git\usr\bin\bash.exe" set "BASH=C:\Program Files\Git\usr\bin\bash.exe"
if not defined BASH if exist "C:\Program Files\Git\bin\bash.exe" set "BASH=C:\Program Files\Git\bin\bash.exe"
if not defined BASH if exist "C:\Program Files (x86)\Git\usr\bin\bash.exe" set "BASH=C:\Program Files (x86)\Git\usr\bin\bash.exe"
if not defined BASH if exist "C:\Program Files (x86)\Git\bin\bash.exe" set "BASH=C:\Program Files (x86)\Git\bin\bash.exe"

REM Layer 2 (HKCU)
if not defined BASH (
    for /f "tokens=2,*" %%a in ('reg query "HKCU\SOFTWARE\GitForWindows" /v InstallPath 2^>nul ^| findstr InstallPath') do set "GIT_ROOT=%%b"
    if exist "!GIT_ROOT!\usr\bin\bash.exe" set "BASH=!GIT_ROOT!\usr\bin\bash.exe"
    if not defined BASH if exist "!GIT_ROOT!\bin\bash.exe" set "BASH=!GIT_ROOT!\bin\bash.exe"
)

REM Layer 2 (HKLM)
if not defined BASH (
    for /f "tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\GitForWindows" /v InstallPath 2^>nul ^| findstr InstallPath') do set "GIT_ROOT=%%b"
    if exist "!GIT_ROOT!\usr\bin\bash.exe" set "BASH=!GIT_ROOT!\usr\bin\bash.exe"
    if not defined BASH if exist "!GIT_ROOT!\bin\bash.exe" set "BASH=!GIT_ROOT!\bin\bash.exe"
)

REM Layer 3: where git -> <root>\{usr\bin,bin}\bash.exe
if not defined BASH (
    set "GIT_CMD="
    for /f "delims=" %%i in ('where git 2^>nul') do if not defined GIT_CMD set "GIT_CMD=%%i"
    if defined GIT_CMD (
        for %%i in ("!GIT_CMD!\..\..") do set "GIT_ROOT=%%~fi"
        if exist "!GIT_ROOT!\usr\bin\bash.exe" set "BASH=!GIT_ROOT!\usr\bin\bash.exe"
        if not defined BASH if exist "!GIT_ROOT!\bin\bash.exe" set "BASH=!GIT_ROOT!\bin\bash.exe"
    )
)

REM Layer 4: not found
if not defined BASH (
    echo Error: Git Bash not found.
    echo.
    echo CC Start requires Git for Windows. Please install it from:
    echo   https://git-scm.com/download/win
    exit /b 1
)

set "SCRIPT_DIR=%~dp0"

if not exist "%SCRIPT_DIR%cc" (
    echo Error: cc script not found in %SCRIPT_DIR%
    exit /b 1
)

"%BASH%" -l "%SCRIPT_DIR%cc" %*
