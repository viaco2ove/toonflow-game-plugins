@echo off
chcp 65001 >nul
title Toonflow Map Editor v0.3

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"

echo ============================================
echo   Toonflow Map Editor v0.3
echo ============================================
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo [ERROR] python not found. Install Python 3.10+
    pause
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm not found. Install Node.js 18+
    pause
    exit /b 1
)

echo [1/3] Checking backend deps...
cd /d "%BACKEND%"
pip install -q -r requirements.txt

echo [2/3] Checking frontend deps...
cd /d "%FRONTEND%"
if not exist "node_modules" (
    echo First run, installing frontend deps...
    call npm install
)

echo [3/3] Starting services...
start "TFS-MapEditor-Backend" cmd /k "cd /d %BACKEND% && python server.py"
start "TFS-MapEditor-Frontend" cmd /k "cd /d %FRONTEND% && npm run dev"

timeout /t 4 /nobreak >nul
start http://127.0.0.1:5176/

echo.
echo ============================================
echo   Editor started.
echo   Frontend: http://127.0.0.1:5176/
echo   Backend:  http://127.0.0.1:8000/api/health
echo ============================================
echo Close the two terminal windows to stop services.
echo.
pause