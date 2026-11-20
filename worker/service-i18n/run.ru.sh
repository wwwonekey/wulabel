#!/bin/sh
# Использование: sh run.sh (при первом запуске создаётся окружение Python и устанавливаются зависимости)
set -e
cd "$(dirname "$0")"
if [ ! -x venv/bin/python ]; then
  echo "Первый запуск: создаётся окружение Python и устанавливаются зависимости (нужен Python 3.9 или новее)..."
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
fi
exec venv/bin/python service.py config.json
