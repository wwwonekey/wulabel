#!/bin/sh
# Cara pakai: sh run.sh (saat pertama kali dijalankan akan membuat lingkungan Python dan menginstal dependensi)
set -e
cd "$(dirname "$0")"
if [ ! -x venv/bin/python ]; then
  echo "Pertama kali dijalankan: membuat lingkungan Python dan menginstal dependensi (butuh Python 3.9 atau lebih baru)..."
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
fi
exec venv/bin/python service.py config.json
