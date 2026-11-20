@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\Scripts\python.exe (
  echo Primeira execução: criando o ambiente Python e instalando dependências, requer Python 3.9 ou superior...
  python -m venv venv || (echo Python não encontrado. Instale o Python 3.9+ e marque "Add to PATH" & pause & exit /b 1)
  venv\Scripts\python.exe -m pip install -r requirements.txt || (pause & exit /b 1)
)
venv\Scripts\python.exe service.py config.json
pause
