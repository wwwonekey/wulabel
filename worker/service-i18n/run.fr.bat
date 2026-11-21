@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\.ok (
  echo Premier lancement : création de l'environnement Python et installation des dépendances, Python 3.9 ou plus récent requis...
  python -m venv venv || (echo Python introuvable. Installez Python 3.9+ et cochez "Add to PATH" & pause & exit /b 1)
  venv\Scripts\python.exe -m pip install -r requirements.txt || (pause & exit /b 1)
  type nul > venv\.ok
)
venv\Scripts\python.exe service.py config.json
pause
