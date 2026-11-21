@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist venv\.ok (
  echo 初回実行：Python 環境を作成し、依存パッケージをインストールします。Python 3.9 以降が必要です...
  python -m venv venv || (echo Python が見つかりません。Python 3.9 以降をインストールし、"Add to PATH" にチェックを入れてください & pause & exit /b 1)
  venv\Scripts\python.exe -m pip install -r requirements.txt || (pause & exit /b 1)
  type nul > venv\.ok
)
venv\Scripts\python.exe service.py config.json
pause
