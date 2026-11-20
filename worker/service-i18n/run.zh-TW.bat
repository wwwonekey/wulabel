@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\Scripts\python.exe (
  echo 第一次執行：建立 Python 環境並安裝相依套件，需要已安裝 Python 3.9 以上版本...
  python -m venv venv || (echo 找不到 Python，請先安裝 Python 3.9+ 並勾選 Add to PATH & pause & exit /b 1)
  venv\Scripts\python.exe -m pip install -r requirements.txt || (pause & exit /b 1)
)
venv\Scripts\python.exe service.py config.json
pause
