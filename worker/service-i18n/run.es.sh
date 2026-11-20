#!/bin/sh
# Uso: sh run.sh (la primera ejecución crea un entorno de Python e instala las dependencias)
set -e
cd "$(dirname "$0")"
if [ ! -x venv/bin/python ]; then
  echo "Primera ejecución: creando el entorno de Python e instalando dependencias (requiere Python 3.9 o posterior)..."
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
fi
exec venv/bin/python service.py config.json
