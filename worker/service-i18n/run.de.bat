@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\Scripts\python.exe (
  echo Erster Start: Python-Umgebung wird angelegt und Abhängigkeiten werden installiert, benötigt Python 3.9 oder neuer...
  python -m venv venv || (echo Python nicht gefunden. Bitte Python 3.9+ installieren und "Add to PATH" anhaken & pause & exit /b 1)
  venv\Scripts\python.exe -m pip install -r requirements.txt || (pause & exit /b 1)
)
venv\Scripts\python.exe service.py config.json
pause
