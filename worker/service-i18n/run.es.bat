@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\Scripts\python.exe (
  echo Primera ejecución: creando el entorno de Python e instalando dependencias, requiere Python 3.9 o posterior...
  python -m venv venv || (echo No se encontró Python. Instala Python 3.9+ y marca "Add to PATH" & pause & exit /b 1)
  venv\Scripts\python.exe -m pip install -r requirements.txt || (pause & exit /b 1)
)
venv\Scripts\python.exe service.py config.json
pause
