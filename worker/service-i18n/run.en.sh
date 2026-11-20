#!/bin/sh
# Usage: sh run.sh (the first run creates a Python environment and installs dependencies)
set -e
cd "$(dirname "$0")"
if [ ! -x venv/bin/python ]; then
  echo "First run: creating a Python environment and installing dependencies (needs Python 3.9 or later)..."
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
fi
exec venv/bin/python service.py config.json
