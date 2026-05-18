@echo off
setlocal enableDelayedExpansion

REM Git Bash detection: 4-layer fallback (kept in sync with cc.cmd)
REM   Layer 1: hardcoded common paths
REM   Layer 2: registry HKCU/HKLM\SOFTWARE\GitForWindows\InstallPath
REM   Layer 3: derive from `where git` -> <root>\bin\bash.exe
REM   Layer 4: error message with install hint

set "BASH=D:\IDE\Git\Git\usr\bin\bash.exe"
if not exist "!BASH!" set "BASH=C:\Program Files\Git\bin\bash.exe"
if not exist "!BASH!" set "BASH=C:\Program Files (x86)\Git\bin\bash.exe"

if not exist "!BASH!" (
    for /f "tokens=2,*" %%a in ('reg query "HKCU\SOFTWARE\GitForWindows" /v InstallPath 2^>nul ^| findstr InstallPath') do set "GIT_ROOT=%%b"
    if exist "!GIT_ROOT!\bin\bash.exe" set "BASH=!GIT_ROOT!\bin\bash.exe"
)
if not exist "!BASH!" (
    for /f "tokens=2,*" %%a in ('reg query "HKLM\SOFTWARE\GitForWindows" /v InstallPath 2^>nul ^| findstr InstallPath') do set "GIT_ROOT=%%b"
    if exist "!GIT_ROOT!\bin\bash.exe" set "BASH=!GIT_ROOT!\bin\bash.exe"
)

if not exist "!BASH!" (
    set "GIT_CMD="
    for /f "delims=" %%i in ('where git 2^>nul') do if not defined GIT_CMD set "GIT_CMD=%%i"
    if defined GIT_CMD (
        for %%i in ("!GIT_CMD!\..\..") do set "GIT_ROOT=%%~fi"
        if exist "!GIT_ROOT!\bin\bash.exe" set "BASH=!GIT_ROOT!\bin\bash.exe"
    )
)

if not exist "!BASH!" (
    echo Error: Git Bash not found.
    echo.
    echo CC Start requires Git for Windows. Please install it from:
    echo   https://git-scm.com/download/win
    exit /b 1
)

"%BASH%" -lic "\"$(cygpath -u '%~dp0cc')\" $*" -- %*
