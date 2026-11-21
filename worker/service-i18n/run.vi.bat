@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\.ok (
  echo Lần chạy đầu: đang tạo môi trường Python và cài các gói phụ thuộc, cần Python 3.9 trở lên...
  python -m venv venv || (echo Không tìm thấy Python. Hãy cài Python 3.9+ và đánh dấu "Add to PATH" & pause & exit /b 1)
  venv\Scripts\python.exe -m pip install -r requirements.txt || (pause & exit /b 1)
  type nul > venv\.ok
)
venv\Scripts\python.exe service.py config.json
pause
