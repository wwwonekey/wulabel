#!/bin/sh
# 用法：sh run.sh（首次运行会创建 Python 环境并安装依赖）
set -e
cd "$(dirname "$0")"
if [ ! -f venv/.ok ]; then
  echo "首次运行：创建 Python 环境并安装依赖（需要 Python 3.9 及以上）..."
  python3 -m venv venv
  venv/bin/python -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
  touch venv/.ok
fi
exec venv/bin/python service.py config.json
