#!/bin/sh
# Cách dùng: sh run.sh (lần chạy đầu sẽ tạo môi trường Python và cài các gói phụ thuộc)
set -e
cd "$(dirname "$0")"
if [ ! -x venv/bin/python ]; then
  echo "Lần chạy đầu: đang tạo môi trường Python và cài các gói phụ thuộc (cần Python 3.9 trở lên)..."
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
fi
exec venv/bin/python service.py config.json
