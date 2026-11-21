@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\.ok (
  echo 첫 실행: Python 환경을 만들고 의존성 패키지를 설치합니다. Python 3.9 이상이 필요합니다...
  python -m venv venv || (echo Python을 찾을 수 없습니다. Python 3.9 이상을 설치하고 "Add to PATH"를 체크하세요 & pause & exit /b 1)
  venv\Scripts\python.exe -m pip install -r requirements.txt || (pause & exit /b 1)
  type nul > venv\.ok
)
venv\Scripts\python.exe service.py config.json
pause
