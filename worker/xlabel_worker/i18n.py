"""训练、推理日志的多语言（规则和桌面端一样）。

写法：tr("中文原文")，带变量 tr("训练集 {n} 张", n=12)。中文原文就是词条的键，
译文在 locales/<语言>.json。没翻译的先用英文，英文也没有就用中文。
语言由桌面端通过环境变量 WULABEL_LANG 传进来，没有就是中文。
"""

from __future__ import annotations

import json
import os
from pathlib import Path

_DIR = Path(__file__).with_name("locales")


def _load(lang: str) -> dict:
    try:
        return json.loads((_DIR / f"{lang}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


LANG = os.environ.get("WULABEL_LANG", "zh") or "zh"
_DICT = {} if LANG == "zh" else _load(LANG)
_EN = {} if LANG in ("zh", "en") else _load("en")


def tr(zh: str, **kw) -> str:
    s = zh if LANG == "zh" else (_DICT.get(zh) or _EN.get(zh) or zh)
    for k, v in kw.items():
        s = s.replace("{" + k + "}", str(v))
    return s
