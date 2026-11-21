#!/bin/sh
# 사용법: sh run.sh (첫 실행 시 Python 환경을 만들고 의존성 패키지를 설치합니다)
set -e
cd "$(dirname "$0")"
if [ ! -f venv/.ok ]; then
  echo "첫 실행: Python 환경을 만들고 의존성 패키지를 설치합니다(Python 3.9 이상 필요)..."
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt
  touch venv/.ok
fi
exec venv/bin/python service.py config.json
