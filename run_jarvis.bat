@echo off
cd /d "%~dp0"
title J.A.R.V.I.S. Core Server
echo ========================================================
echo        J.A.R.V.I.S. VERSION 5.0 - STARTING SYSTEM
echo ========================================================
echo Laptop Localhost : http://localhost:8000
echo Mobile WiFi URL  : http://192.168.31.59:8000
echo ========================================================
echo.
echo Launching J.A.R.V.I.S. HUD Interface (opening shortly)...
start "" cmd /c "ping 127.0.0.1 -n 3 >nul & start http://localhost:8000"
echo Starting Core FastAPI backend...
python server.py
pause

