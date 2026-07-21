@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo === DISK://REAPER — сборка EXE ===
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python не найден. Установите Python 3.9+ и добавьте в PATH.
    exit /b 1
)

echo [1/3] Установка зависимостей...
python -m pip install -r requirements-build.txt
if errorlevel 1 (
    echo [ERROR] Не удалось установить зависимости.
    exit /b 1
)

echo.
echo [2/3] Сборка PyInstaller (может занять несколько минут)...
python -m PyInstaller disk_reaper.spec --noconfirm --clean
if errorlevel 1 (
    echo [ERROR] Сборка не удалась.
    exit /b 1
)

echo.
echo [3/3] Готово.
echo.
echo   Файл: dist\DISK-REAPER.exe
echo   Запуск от имени администратора встроен в манифест (UAC).
echo   На целевом ПК нужен Windows 10/11 с WebView2 Runtime.
echo.
pause
