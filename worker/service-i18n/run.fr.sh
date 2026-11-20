#!/bin/sh
# Utilisation : sh run.sh (le premier lancement crée un environnement Python et installe les dépendances)
set -e
cd "$(dirname "$0")"
if [ ! -x venv/bin/python ]; then
  echo "Premier lancement : création de l'environnement Python et installation des dépendances (Python 3.9 ou plus récent requis)..."
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
fi
exec venv/bin/python service.py config.json
