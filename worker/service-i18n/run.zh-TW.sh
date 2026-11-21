#!/bin/sh
# 用法：sh run.sh（第一次執行會建立 Python 環境並安裝相依套件）
set -e
cd "$(dirname "$0")"
if [ ! -f venv/.ok ]; then
  echo "第一次執行：建立 Python 環境並安裝相依套件（需要 Python 3.9 以上版本）..."
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
  touch venv/.ok
fi
exec venv/bin/python service.py config.json
