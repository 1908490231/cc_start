@echo off
chcp 65001 >nul

:: CC Star 自动安装脚本 (Windows)

echo ╔════════════════════════════════════╗
echo ║     CC Star 安装程序               ║
echo ╚════════════════════════════════════╝
echo.

:: 设置安装目录
set "INSTALL_DIR=%USERPROFILE%\.local\bin"

echo 安装目录: %INSTALL_DIR%
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

:: 检查是否已安装
if exist "%INSTALL_DIR%\cc.cmd" (
    echo.
    echo ⚠️  CC Star 已安装
    set /p confirm="是否覆盖? (y/N): "
    if /i not "%confirm%"=="y" (
        echo 取消安装
        exit /b 0
    )
)

:: 复制脚本
copy /Y "%~dp0cc" "%INSTALL_DIR%\cc" >nul
copy /Y "%~dp0cc.cmd" "%INSTALL_DIR%\cc.cmd" >nul

echo ✅ 脚本已安装
echo.

:: 创建配置目录
if not exist "%USERPROFILE%\.claude\models" mkdir "%USERPROFILE%\.claude\models"
echo ✅ 配置目录已创建: %%USERPROFILE%%\.claude\models

:: 复制示例配置
if exist "%~dp0models" (
    copy /Y "%~dp0models\example-*.json" "%USERPROFILE%\.claude\models\" >nul 2>&1
    echo ✅ 示例配置已复制
)

:: 检查 PATH
echo.
echo 检查 PATH...

echo %PATH% | find /i "%INSTALL_DIR%" >nul
if errorlevel 1 (
    echo.
    echo ⚠️  %INSTALL_DIR% 不在 PATH 中
    echo.
    echo 正在添加到用户 PATH...

    for /f "tokens=2*" %%a in ('reg query HKCU\Environment /v Path 2^>nul ^| findstr Path') do set "USER_PATH=%%b"

    if defined USER_PATH (
        setx PATH "%USER_PATH%;%INSTALL_DIR%" >nul 2>&1
    ) else (
        setx PATH "%INSTALL_DIR%" >nul 2>&1
    )

    echo ✅ PATH 已更新
    echo.
    echo ⚠️  请重新打开终端以使用 cc 命令
    echo.
    pause
) else (
    echo ✅ PATH 检查通过
)

echo.
echo 🎉 安装完成!
echo.
echo 使用方法:
echo   cc              - 交互式选择模型
echo   cc ^<模型名^>     - 直接启动指定模型
echo   cc add          - 添加新模型配置
echo.
echo 请编辑 %%USERPROFILE%%\.claude\models\ 下的配置文件，填入你的 API Key
echo.
echo 按任意键退出...
pause >nul
