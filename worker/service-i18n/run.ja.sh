#!/bin/sh
# 使い方：sh run.sh（初回実行時に Python 環境を作成し、依存パッケージをインストールします）
set -e
cd "$(dirname "$0")"
if [ ! -x venv/bin/python ]; then
  echo "初回実行：Python 環境を作成し、依存パッケージをインストールします（Python 3.9 以降が必要）..."
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
fi
exec venv/bin/python service.py config.json
