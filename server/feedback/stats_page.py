"""使用统计页：/stats，只给作者自己看。

数据来源：
- 在用人数：客户端检查更新时记下的匿名设备（app.py 的 installs / active 表）。
- 官网下载：读 nginx 访问日志里的 /download/Wulabel_* 请求，增量扫描，IP 只存哈希。
- GitHub：Release 安装包的下载次数和星标数，10 分钟缓存一次。

配置（.env）：
- STATS_KEY            访问密码，不配就没有这个页面
- NGINX_ACCESS_LOG     nginx 访问日志路径，不配就不显示官网下载
- STATS_EXCLUDE_IPS    不计入官网下载的 IP，逗号分隔（比如服务器自己）
- GITHUB_REPO          如 xiaowu-iot/wulabel，不配就不显示 GitHub
"""

import html
import json
import os
import re
import sqlite3
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

import blake3
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, RedirectResponse

STATS_KEY = os.environ.get("STATS_KEY", "")
NGINX_ACCESS_LOG = os.environ.get("NGINX_ACCESS_LOG", "")
STATS_EXCLUDE_IPS = {s.strip() for s in os.environ.get("STATS_EXCLUDE_IPS", "").split(",") if s.strip()}
GITHUB_REPO = os.environ.get("GITHUB_REPO", "")

COOKIE = "wl_stats"
DAYS = 30
MONTHS = {m: f"{i:02d}" for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), 1)}
DL_RE = re.compile(rb'^(\S+) \S+ \S+ \[(\d{2})/(\w{3})/(\d{4}):[^\]]*\] "GET /download/(Wulabel_[^ ?"]+)[^"]*" (\d{3}) ')

_scan_lock = threading.Lock()
_gh = {"t": 0.0, "data": None}


def _token() -> str:
    # cookie 里放由密码派生的值，不直接放密码
    return blake3.blake3(b"wulabel-stats", key=blake3.blake3(STATS_KEY.encode()).digest()).hexdigest()


def _day(n: int) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(time.time() + 8 * 3600 - n * 86400))


def scan_downloads(conn: sqlite3.Connection) -> bool:
    """把访问日志里新增的下载记录读进库。日志被轮转（变小）时从头读。"""
    if not NGINX_ACCESS_LOG or not Path(NGINX_ACCESS_LOG).exists():
        return False
    conn.execute("CREATE TABLE IF NOT EXISTS downloads (day TEXT, file TEXT, who TEXT, PRIMARY KEY (day, file, who))")
    conn.execute("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)")
    with _scan_lock:
        row = conn.execute("SELECT v FROM meta WHERE k='log_offset'").fetchone()
        offset = int(row[0]) if row else 0
        if os.path.getsize(NGINX_ACCESS_LOG) < offset:
            offset = 0
        rows = []
        with open(NGINX_ACCESS_LOG, "rb") as f:
            f.seek(offset)
            for line in f:
                if not line.endswith(b"\n"):
                    break  # 最后一行还没写完，下次再读
                offset += len(line)
                if b"/download/Wulabel_" not in line:
                    continue
                m = DL_RE.match(line)
                if not m:
                    continue
                ip, d, mon, y, file, status = (g.decode("utf-8", "replace") for g in m.groups())
                if status not in ("200", "206") or ip in STATS_EXCLUDE_IPS:
                    continue
                who = blake3.blake3(f"dl:{ip}".encode()).hexdigest()[:16]
                rows.append((f"{y}-{MONTHS.get(mon, '00')}-{d}", file, who))
        conn.executemany("INSERT OR IGNORE INTO downloads VALUES (?,?,?)", rows)
        conn.execute("INSERT OR REPLACE INTO meta VALUES ('log_offset', ?)", (str(offset),))
        conn.commit()
    return True


def github_stats():
    if not GITHUB_REPO:
        return None
    if time.time() - _gh["t"] < 600:
        return _gh["data"]

    def get(path: str):
        req = urllib.request.Request(
            f"https://api.github.com/repos/{GITHUB_REPO}{path}",
            headers={"User-Agent": "wulabel-stats", "Accept": "application/vnd.github+json"},
        )
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.load(r)

    try:
        repo = get("")
        releases = get("/releases?per_page=20")
        data = {
            "stars": repo.get("stargazers_count", 0),
            "forks": repo.get("forks_count", 0),
            "assets": [
                (r.get("tag_name", ""), a.get("name", ""), a.get("download_count", 0))
                for r in releases
                if not r.get("draft")
                for a in r.get("assets", [])
                if a.get("name", "").startswith("Wulabel_") and not a.get("name", "").endswith(".tar.gz")
            ],
        }
    except Exception:  # noqa: BLE001
        data = _gh["data"]
    _gh.update(t=time.time(), data=data)
    return data


def collect(db_path: str) -> dict:
    conn = sqlite3.connect(db_path)
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS installs (device TEXT PRIMARY KEY, first_day TEXT, last_day TEXT, version TEXT, os TEXT)")
        conn.execute("CREATE TABLE IF NOT EXISTS active (day TEXT, device TEXT, version TEXT, os TEXT, PRIMARY KEY (day, device))")
        has_dl = scan_downloads(conn)

        def one(sql, *a):
            return conn.execute(sql, a).fetchone()[0]

        days = [_day(i) for i in range(DAYS - 1, -1, -1)]
        d = {
            "installs": one("SELECT COUNT(*) FROM installs"),
            "today": one("SELECT COUNT(*) FROM active WHERE day=?", days[-1]),
            "d7": one("SELECT COUNT(DISTINCT device) FROM active WHERE day>=?", _day(6)),
            "d30": one("SELECT COUNT(DISTINCT device) FROM active WHERE day>=?", _day(29)),
            "days": days,
            "active": dict(conn.execute("SELECT day, COUNT(*) FROM active WHERE day>=? GROUP BY day", (days[0],))),
            "new": dict(conn.execute("SELECT first_day, COUNT(*) FROM installs WHERE first_day>=? GROUP BY first_day", (days[0],))),
            "versions": conn.execute(
                "SELECT version, COUNT(*) FROM installs WHERE last_day>=? GROUP BY version ORDER BY 2 DESC", (_day(29),)
            ).fetchall(),
            "oses": conn.execute(
                "SELECT os, COUNT(*) FROM installs WHERE last_day>=? GROUP BY os ORDER BY 2 DESC", (_day(29),)
            ).fetchall(),
            "has_dl": has_dl,
        }
        if has_dl:
            d["dl_total"] = one("SELECT COUNT(DISTINCT who) FROM downloads")
            d["dl_30"] = one("SELECT COUNT(DISTINCT who) FROM downloads WHERE day>=?", days[0])
            d["dl_days"] = dict(conn.execute("SELECT day, COUNT(DISTINCT who) FROM downloads WHERE day>=? GROUP BY day", (days[0],)))
            d["dl_files"] = conn.execute(
                "SELECT file, COUNT(DISTINCT who) FROM downloads GROUP BY file ORDER BY file DESC"
            ).fetchall()
        return d
    finally:
        conn.close()


# ———————————————— 页面 ————————————————

CSS = """
:root{--bg:#f6f6f4;--card:#fcfcfb;--line:#e4e3de;--text:#0b0b0b;--sub:#52514e;--muted:#8a8984;--bar:#2a78d6;--bar-hi:#1c5cab}
@media (prefers-color-scheme:dark){:root{--bg:#121211;--card:#1a1a19;--line:#2c2c2a;--text:#f0efec;--sub:#c3c2b7;--muted:#8d8c86;--bar:#3987e5;--bar-hi:#6da7ec}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 "Microsoft YaHei UI","PingFang SC",system-ui,sans-serif}
main{max-width:1040px;margin:0 auto;padding:28px 16px 48px}h1{font-size:22px;margin:0}h2{font-size:15px;margin:0 0 12px}
.sub{color:var(--sub)}.muted{color:var(--muted);font-size:12px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(128px,1fr));gap:12px;margin:20px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}
.tile .k{color:var(--sub);font-size:13px}.tile .v{font-size:30px;font-weight:700;line-height:1.2;margin-top:4px;font-variant-numeric:tabular-nums}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;margin-top:12px}
svg.chart{width:100%;height:auto;display:block}svg.chart rect.b{fill:var(--bar)}svg.chart rect.b:hover{fill:var(--bar-hi)}
svg.chart rect.hit{fill:transparent}svg.chart g:hover rect.b{fill:var(--bar-hi)}
svg.chart text{fill:var(--muted);font-size:11px}svg.chart line{stroke:var(--line)}
table{width:100%;border-collapse:collapse}td{padding:6px 0;border-bottom:1px solid var(--line)}td.n{text-align:right;font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}
form{max-width:320px;margin:80px auto}input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text);font-size:15px}
button{margin-top:10px;width:100%;padding:10px;border:0;border-radius:8px;background:var(--bar);color:#fff;font-size:15px;cursor:pointer}
"""


def _page(title: str, body: str) -> str:
    return (
        f'<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<meta name="robots" content="noindex"><title>{html.escape(title)}</title><style>{CSS}</style></head><body><main>{body}</main></body></html>'
    )


def _bars(days: list, values: dict, unit: str) -> str:
    """单系列柱状图，悬停显示当天数字。"""
    w, h, top, bottom, left = 600, 170, 14, 22, 26
    peak = max([values.get(x, 0) for x in days] + [1])
    step = (w - left) / len(days)
    bw = max(4.0, step - 6)
    out = [f'<svg class="chart" viewBox="0 0 {w} {h}" role="img">']
    base = h - bottom
    out.append(f'<line x1="{left}" y1="{base}" x2="{w}" y2="{base}"/>')
    out.append(f'<text x="{left - 6}" y="{top + 4}" text-anchor="end">{peak}</text>')
    out.append(f'<text x="{left - 6}" y="{base}" text-anchor="end">0</text>')
    for i, day in enumerate(days):
        v = values.get(day, 0)
        x = left + i * step + (step - bw) / 2
        bh = (base - top) * v / peak
        label = f"{day[5:]}：{v} {unit}"
        out.append(f'<g><title>{html.escape(label)}</title><rect class="hit" x="{left + i * step:.1f}" y="{top}" width="{step:.1f}" height="{base - top}"/>')
        if v:
            out.append(f'<rect class="b" x="{x:.1f}" y="{base - bh:.1f}" width="{bw:.1f}" height="{bh:.1f}" rx="2"/>')
        out.append("</g>")
        if i % 5 == 0 or i == len(days) - 1:
            anchor = "end" if i == len(days) - 1 else "middle"
            out.append(f'<text x="{x + bw:.1f}" y="{h - 6}" text-anchor="end">{day[5:]}</text>' if anchor == "end" else f'<text x="{x + bw / 2:.1f}" y="{h - 6}" text-anchor="middle">{day[5:]}</text>')
    out.append("</svg>")
    return "".join(out)


def _table(rows, empty="还没有数据") -> str:
    if not rows:
        return f'<div class="muted">{empty}</div>'
    return "<table>" + "".join(f'<tr><td>{html.escape(str(a))}</td><td class="n">{b}</td></tr>' for a, b in rows) + "</table>"


def _tile(k: str, v) -> str:
    return f'<div class="card tile"><div class="k">{k}</div><div class="v">{v}</div></div>'


def render(d: dict, gh) -> str:
    tiles = [
        _tile("今天在用", d["today"]),
        _tile("近 7 天在用", d["d7"]),
        _tile("近 30 天在用", d["d30"]),
        _tile("累计装过新版", d["installs"]),
    ]
    if d["has_dl"]:
        tiles.append(_tile("官网下载人数", d["dl_total"]))
    if gh:
        tiles.append(_tile("GitHub 下载", sum(c for _, _, c in gh["assets"])))
        tiles.append(_tile("GitHub 星标", gh["stars"]))

    body = [
        '<h1>Wulabel 使用统计</h1>',
        f'<div class="sub">更新于 {time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() + 8 * 3600))}（北京时间）</div>',
        f'<div class="tiles">{"".join(tiles)}</div>',
        '<div class="grid2">',
        f'<div class="card"><h2>每天在用的电脑（最近 {DAYS} 天）</h2>{_bars(d["days"], d["active"], "台")}</div>',
    ]
    if d["has_dl"]:
        body.append(f'<div class="card"><h2>官网每天下载人数（最近 {DAYS} 天）</h2>{_bars(d["days"], d["dl_days"], "人")}</div>')
    else:
        body.append(f'<div class="card"><h2>每天新装（最近 {DAYS} 天）</h2>{_bars(d["days"], d["new"], "台")}</div>')
    body.append("</div><div class=\"grid2\">")
    body.append(f'<div class="card"><h2>版本（近 30 天在用）</h2>{_table([("v" + v, n) for v, n in d["versions"]])}</div>')
    body.append(f'<div class="card"><h2>系统（近 30 天在用）</h2>{_table(d["oses"])}</div>')
    if d["has_dl"]:
        body.append(f'<div class="card"><h2>官网下载（按安装包，人数）</h2>{_table(d["dl_files"])}</div>')
    if gh:
        body.append(f'<div class="card"><h2>GitHub 下载（按安装包，次数）</h2>{_table([(n, c) for _, n, c in gh["assets"]])}</div>')
    body.append("</div>")
    body.append(
        '<p class="muted" style="margin-top:18px">在用人数来自软件的检查更新：每台电脑每天记一次，只有 v0.2.1 及以后的版本、并且没关掉自动检查的才会被统计。'
        "官网下载按不同 IP 计，同一个人换网络会算多次。GitHub 次数里也包含作者自己下载的。</p>"
    )
    return _page("Wulabel 使用统计", "".join(body))


LOGIN = _page(
    "Wulabel 使用统计",
    '<form method="post" action="/stats"><h1 style="margin-bottom:14px">Wulabel 使用统计</h1>'
    '<input type="password" name="key" placeholder="访问密码" autofocus><button type="submit">进入</button>{msg}</form>',
)


def install(app: FastAPI, db_path: str) -> None:
    if not STATS_KEY:
        return

    def authed(req: Request) -> bool:
        c = req.cookies.get(COOKIE, "")
        return bool(c) and blake3.blake3(c.encode()).digest() == blake3.blake3(_token().encode()).digest()

    def nocache(resp):
        resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.get("/stats", response_class=HTMLResponse)
    def stats_get(req: Request):
        if not authed(req):
            return nocache(HTMLResponse(LOGIN.replace("{msg}", "")))
        return nocache(HTMLResponse(render(collect(db_path), github_stats())))

    @app.post("/stats")
    async def stats_post(req: Request):
        form = urllib.parse.parse_qs((await req.body()).decode("utf-8", "replace"))
        key = (form.get("key") or [""])[0]
        if blake3.blake3(key.encode()).digest() != blake3.blake3(STATS_KEY.encode()).digest():
            time.sleep(1)
            return nocache(HTMLResponse(LOGIN.replace("{msg}", '<p class="muted">密码不对</p>'), status_code=403))
        resp = RedirectResponse("/stats", status_code=303)
        resp.set_cookie(COOKIE, _token(), max_age=180 * 86400, httponly=True, secure=True, samesite="lax", path="/stats")
        return resp
