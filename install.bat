@echo off
setlocal EnableDelayedExpansion

chcp 65001 >nul

echo.
echo ===================================
echo    CC Start ��װ����
echo ===================================
echo.

:: ����Ƿ��� cc �ļ��ڵ�ǰĿ¼
if not exist "%~dp0cc" (
    echo [����] δ�ҵ� cc �ű��ļ�
    echo ��ȷ�� install.bat �� cc �ļ���ͬһĿ¼
    pause
    exit /b 1
)

:: ���ð�װĿ¼
set "INSTALL_DIR=%USERPROFILE%\.local\bin"

echo ��װĿ¼: %INSTALL_DIR%
if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%" 2>nul
    if errorlevel 1 (
        echo [����] �޷�������װĿ¼
        pause
        exit /b 1
    )
)

:: ����Ƿ��Ѱ�װ
if exist "%INSTALL_DIR%\cc.cmd" (
    echo.
    echo [��ʾ] CC Start �Ѱ�װ
    set /p confirm="�Ƿ񸲸�? (y/N): "
    if /i not "!confirm!=="y" (
        echo ȡ����װ
        pause
        exit /b 0
    )
)

:: ���ƽű�
echo.
echo ���ڸ����ļ�...
copy /Y "%~dp0cc" "%INSTALL_DIR%\cc" >nul
if errorlevel 1 (
    echo [����] ���� cc ʧ��
    pause
    exit /b 1
)
copy /Y "%~dp0cc.cmd" "%INSTALL_DIR%\cc.cmd" >nul
if errorlevel 1 (
    echo [����] ���� cc.cmd ʧ��
    pause
    exit /b 1
)
echo [OK] �ű��Ѱ�װ

:: ��������Ŀ¼
if not exist "%USERPROFILE%\.claude\models" (
    mkdir "%USERPROFILE%\.claude\models" 2>nul
)
echo [OK] ����Ŀ¼�Ѵ���

:: ����ģ������
echo.
echo ���ڸ���ģ������...
if exist "%~dp0models" (
    set "CONFIG_DIR=%USERPROFILE%\.claude\models"
    for %%f in ("%~dp0models\*.json") do (
        set "filename=%%~nxf"
        if exist "!CONFIG_DIR!\!filename!" (
            echo.
            echo [��ʾ] �����ļ��Ѵ���: !filename!
            set /p overwrite="�Ƿ񸲸�? (y/N): "
            if /i "!overwrite!=="y" (
                copy /Y "%%f" "!CONFIG_DIR!\" >nul
                echo [OK] �Ѹ���: !filename!
            ) else (
                echo [����] ����ԭ�ļ�: !filename!
            )
        ) else (
            copy "%%f" "!CONFIG_DIR!\" >nul
            echo [OK] �Ѹ���: !filename!
        )
    )
)

:: ��� PATH
echo.
echo ��� PATH...
echo %PATH% | find /i "%INSTALL_DIR%" >nul
if errorlevel 1 (
    echo.
    echo [��ʾ] �������ӵ��û� PATH...

    for /f "tokens=2*" %%a in ('reg query HKCU\Environment /v Path 2^>nul ^| findstr Path') do set "USER_PATH=%%b"

    if defined USER_PATH (
        setx PATH "!USER_PATH!;!INSTALL_DIR!" >nul 2>&1
    ) else (
        setx PATH "!INSTALL_DIR!" >nul 2>&1
    )

    if errorlevel 1 (
        echo [����] ���� PATH ʧ�ܣ����ֶ�����: %INSTALL_DIR%
    ) else (
        echo [OK] PATH �Ѹ���
    )
    echo.
    echo [��Ҫ] �����´��ն���ʹ�� cc ����
) else (
    echo [OK] PATH ���ͨ��
)

:: ���
echo.
echo ===================================
echo    ��װ���!
echo ===================================
echo.
echo ʹ�÷���:
echo   cc              - ����ʽѡ��ģ��
echo   cc ^<ģ����^>     - ֱ������ָ��ģ��
echo   cc add          - ������ģ������
echo.
echo �����ļ�λ��:
echo   %%USERPROFILE%%\.claude\models\
echo.
echo [��Ҫ] �����´��նˣ�Ȼ������ cc add ��������ģ������
echo.
pause
