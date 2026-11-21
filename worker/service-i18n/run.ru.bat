@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\.ok (
  echo Первый запуск: создаётся окружение Python и устанавливаются зависимости, нужен Python 3.9 или новее...
  python -m venv venv || (echo Python не найден. Установите Python 3.9+ и отметьте "Add to PATH" & pause & exit /b 1)
  venv\Scripts\python.exe -m pip install -r requirements.txt || (pause & exit /b 1)
  type nul > venv\.ok
)
venv\Scripts\python.exe service.py config.json
pause
