#!/bin/sh
# Uso: sh run.sh (a primeira execução cria um ambiente Python e instala as dependências)
set -e
cd "$(dirname "$0")"
if [ ! -f venv/.ok ]; then
  echo "Primeira execução: criando o ambiente Python e instalando dependências (requer Python 3.9 ou superior)..."
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
  touch venv/.ok
fi
exec venv/bin/python service.py config.json
