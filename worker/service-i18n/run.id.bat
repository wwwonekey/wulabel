@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\Scripts\python.exe (
  echo Pertama kali dijalankan: membuat lingkungan Python dan menginstal dependensi, butuh Python 3.9 atau lebih baru...
  python -m venv venv || (echo Python tidak ditemukan. Instal Python 3.9+ dan centang "Add to PATH" & pause & exit /b 1)
  venv\Scripts\python.exe -m pip install -r requirements.txt || (pause & exit /b 1)
)
venv\Scripts\python.exe service.py config.json
pause
