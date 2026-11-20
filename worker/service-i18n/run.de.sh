#!/bin/sh
# Verwendung: sh run.sh (beim ersten Start wird eine Python-Umgebung angelegt und die Abhängigkeiten werden installiert)
set -e
cd "$(dirname "$0")"
if [ ! -x venv/bin/python ]; then
  echo "Erster Start: Python-Umgebung wird angelegt und Abhängigkeiten werden installiert (benötigt Python 3.9 oder neuer)..."
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
fi
exec venv/bin/python service.py config.json
