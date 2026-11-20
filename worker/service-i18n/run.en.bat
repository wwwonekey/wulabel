@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\Scripts\python.exe (
  echo First run: creating a Python environment and installing dependencies (needs Python 3.9 or later^)...
  python -m venv venv || (echo Python not found. Install Python 3.9+ and tick "Add to PATH" & pause & exit /b 1)
  venv\Scripts\python.exe -m pip install -r requirements.txt || (pause & exit /b 1)
)
venv\Scripts\python.exe service.py config.json
pause
