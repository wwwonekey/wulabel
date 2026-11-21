"""多语言检查：找出还没换成词条的中文、各语言还缺哪些译文。

    python apps/desktop/scripts/i18n_check.py                  汇总
    python apps/desktop/scripts/i18n_check.py --left [层]      列出还没换成词条的中文（层：fe / rs / py）
    python apps/desktop/scripts/i18n_check.py --missing en     把 en 缺的词条写成 {中文: ""}，输出到 i18n-missing/<层>-en.json
    python apps/desktop/scripts/i18n_check.py --prune          删掉代码里已经不用的词条

三层各有自己的语言包：前端 apps/desktop/src/locales，后端 apps/desktop/src-tauri/locales，
训练进程 worker/xlabel_worker/locales。词条的键都是中文原文。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
LANGS = ["en", "zh-TW", "ja", "ko", "es", "pt", "ru", "de", "fr", "vi", "id"]
HAN = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")
# \u53cc\u5f15\u53f7\u3001\u53cd\u5f15\u53f7\u5b57\u7b26\u4e32\uff08Rust \u7684 '/' \u5b57\u7b26\u548c JS \u5355\u5f15\u53f7\u5b57\u7b26\u4e32\u91cc\u5f88\u5c11\u6709 /*\uff0c\u4e0d\u7ba1\uff09
STR = re.compile(r"\"(?:\\.|[^\"\\])*\"|`(?:\\.|[^`\\])*`")

LAYERS = {
    "fe": {
        "dir": "apps/desktop/src",
        "exts": {".ts", ".tsx"},
        "skip": {"locales"},
        "locales": "apps/desktop/src/locales",
        "key": re.compile(r"(?<![\w.$])t\(\s*([\"'`])((?:\\.|(?!\1)[^\\])*)\1"),
    },
    "rs": {
        "dir": "apps/desktop/src-tauri/src",
        "exts": {".rs"},
        "skip": set(),
        "locales": "apps/desktop/src-tauri/locales",
        "key": re.compile(r"\bt!\(\s*()\"((?:\\.|[^\"\\])*)\""),
    },
    "py": {
        "dir": "worker/xlabel_worker",
        "exts": {".py"},
        "skip": {"locales", "yolox", "__pycache__"},
        "locales": "worker/xlabel_worker/locales",
        "key": re.compile(r"(?<![\w.])tr\(\s*([\"'])((?:\\.|(?!\1)[^\\])*)\1"),
    },
}


def files(layer: dict) -> list[Path]:
    out = []
    for p in sorted((ROOT / layer["dir"]).rglob("*")):
        if p.suffix in layer["exts"] and not (set(p.relative_to(ROOT / layer["dir"]).parts) & layer["skip"]):
            out.append(p)
    return out


def unescape(raw: str) -> str:
    try:
        return json.loads('"' + re.sub(r'(?<!\\)"', r'\\"', raw.replace("\\'", "'").replace("\\`", "`")) + '"')
    except ValueError:
        return raw


def code_lines(path: Path, text: str):
    """去掉注释、Python 文档字符串、Rust 测试模块后的代码行"""
    in_block = False
    in_doc = None
    in_test = False
    for i, line in enumerate(text.splitlines(), 1):
        l = line
        if path.suffix == ".py":
            s = l.strip()
            if in_doc:
                if in_doc in s:
                    in_doc = None
                continue
            m = re.match(r"^[rbuf]*(\"\"\"|''')", s)
            if m:
                if m.group(1) not in s[m.end():]:
                    in_doc = m.group(1)
                continue
            l = re.sub(r"(^|\s)#.*$", "", l)
        else:
            if path.suffix == ".rs" and re.match(r"^\s*#\[cfg\(test\)\]", l):
                in_test = True
            if in_test:
                continue
            if in_block:
                if "*/" in l:
                    in_block = False
                    l = l[l.index("*/") + 2:]
                else:
                    continue
            # 找注释位置时先把字符串内容换成空格（字符串里的 /* 和 // 不算注释）
            while True:
                m = STR.sub(lambda x: " " * len(x.group(0)), l)
                a, b = m.find("/*"), m.find("//")
                if b >= 0 and (a < 0 or b < a):
                    l = l[:b]
                    break
                if a < 0:
                    break
                c = m.find("*/", a + 2)
                if c < 0:
                    in_block = True
                    l = l[:a]
                    break
                l = l[:a] + l[c + 2:]
        yield i, l


def scan(name: str):
    layer = LAYERS[name]
    keys: dict[str, str] = {}
    left, dynamic = [], []
    for f in files(layer):
        rel = f.relative_to(ROOT).as_posix()
        for n, line in code_lines(f, f.read_text(encoding="utf-8")):
            rest = line
            for m in layer["key"].finditer(line):
                raw = m.group(2)
                if m.group(1) == "`" and "${" in raw:
                    dynamic.append(f"{rel}:{n}: {line.strip()}")
                keys.setdefault(unescape(raw), f"{rel}:{n}")
                rest = rest.replace(m.group(0), "")
            if HAN.search(rest):
                left.append(f"{rel}:{n}: {line.strip()}")
    return keys, left, dynamic


def read_pack(name: str, lang: str) -> dict:
    try:
        return json.loads((ROOT / LAYERS[name]["locales"] / f"{lang}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    results = {n: scan(n) for n in LAYERS}

    if args[:1] == ["--left"]:
        for n, (_, left, _) in results.items():
            if len(args) > 1 and n != args[1]:
                continue
            print("\n".join(left))
        return 0

    if args[:1] == ["--missing"]:
        lang = args[1] if len(args) > 1 else "en"
        out = ROOT / "i18n-missing"
        out.mkdir(exist_ok=True)
        for n, (keys, _, _) in results.items():
            pack = read_pack(n, lang)
            miss = {k: "" for k in keys if not pack.get(k)}
            f = out / f"{n}-{lang}.json"
            f.write_text(json.dumps(miss, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"{n}: {len(miss)} 条 → {f.relative_to(ROOT).as_posix()}")
        return 0

    if args[:1] == ["--prune"]:
        for n, (keys, _, _) in results.items():
            for lang in LANGS:
                pack = read_pack(n, lang)
                kept = {k: v for k, v in pack.items() if k in keys}
                p = ROOT / LAYERS[n]["locales"] / f"{lang}.json"
                # 统一写 LF（Windows 上 write_text 默认会写成 CRLF）
                p.write_text(json.dumps(kept, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        print("已删掉不用的词条")
        return 0

    bad = False
    for n, (keys, left, dynamic) in results.items():
        print(f"\n[{n}] 词条 {len(keys)} 条，还没换成词条的中文 {len(left)} 行")
        for d in dynamic:
            bad = True
            print(f"  词条里不能用 ${{}}：{d}")
        row = []
        for lang in LANGS:
            pack = read_pack(n, lang)
            miss = vars_bad = 0
            for k in keys:
                v = pack.get(k)
                if not v:
                    miss += 1
                    continue
                # 译文里的 {变量} 要和原文一致
                if sorted(re.findall(r"\{\w+\}", k)) != sorted(re.findall(r"\{\w+\}", v)):
                    vars_bad += 1
                    if vars_bad <= 3:
                        print(f"  {lang} 变量对不上：{k} → {v}")
            bad = bad or vars_bad > 0
            row.append(f"{lang} 缺 {miss}" + (f"（变量不对 {vars_bad}）" if vars_bad else ""))
        print("  " + "，".join(row))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
