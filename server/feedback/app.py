"""Wulabel 反馈上报服务。

职责：
- /feedback：验签 → 限流防刷 → 通过 SMTP（QQ 邮箱）把反馈发到作者邮箱。
  收件邮箱只在这里（服务端）出现，不进客户端。
- /update：检查更新。返回最新版本号和下载地址，顺带按匿名设备编号记录使用情况
  （每台设备每天一条，只记版本和系统，不记 IP），用 stats.py 查看统计。
"""

import json
import os
import re
import sqlite3
import time
import hmac
import base64
import smtplib
from email.message import EmailMessage
from pathlib import Path

import blake3
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response


# —— 配置：优先环境变量，其次同目录下的 .env ——
def load_env() -> None:
    f = Path(__file__).with_name(".env")
    if not f.exists():
        return
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


load_env()

APP_SECRET = os.environ.get("APP_SECRET", "CHANGE_ME_shared_secret")
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.qq.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "465"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
MAIL_FROM = os.environ.get("MAIL_FROM", SMTP_USER)
FEEDBACK_TO = os.environ.get("FEEDBACK_TO", "")
DB_PATH = os.environ.get("DB_PATH", str(Path(__file__).with_name("feedback.db")))
# 最新版本信息：{"latest": "0.2.0", "url": "下载页地址", "notes": "新版本说明"}，发新版时改这个文件即可
LATEST_FILE = os.environ.get("LATEST_FILE", str(Path(__file__).with_name("latest.json")))

PER_DEVICE_HOUR = int(os.environ.get("PER_DEVICE_HOUR", "5"))
PER_DEVICE_DAY = int(os.environ.get("PER_DEVICE_DAY", "20"))
PER_IP_HOUR = int(os.environ.get("PER_IP_HOUR", "10"))
GLOBAL_DAY = int(os.environ.get("GLOBAL_DAY", "500"))

MAX_MESSAGE_CHARS = 2000
MAX_SHOT_BASE64 = 3_000_000
ALLOW_SKEW = 300

# 由共享密钥派生 32 字节 keyed-hash 密钥，和桌面端 feedback.rs 完全一致。
SIGN_KEY = blake3.blake3(APP_SECRET.encode("utf-8")).digest()


def _hex(data: bytes) -> str:
    return blake3.blake3(data).hexdigest()


def expected_sign(ts: int, device_id: str, message: str, screenshot: str) -> str:
    sign_input = (
        f"{ts}\n{device_id}\n"
        f"{_hex(message.encode('utf-8'))}\n{_hex(screenshot.encode('utf-8'))}"
    )
    return blake3.blake3(sign_input.encode("utf-8"), key=SIGN_KEY).hexdigest()


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("CREATE TABLE IF NOT EXISTS events (ts INTEGER, device TEXT, ip TEXT)")
    return conn


def err(msg: str, code: int = 400) -> JSONResponse:
    return JSONResponse({"error": msg}, status_code=code)


app = FastAPI(title="Wulabel feedback")


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/feedback")
async def feedback(req: Request):
    try:
        data = await req.json()
    except Exception:
        return err("请求格式不对")

    message = (data.get("message") or "").strip()
    contact = (data.get("contact") or "").strip()
    app_version = str(data.get("app_version") or "")
    osname = str(data.get("os") or "")
    device_id = str(data.get("device_id") or "")
    screenshot = data.get("screenshot") or ""
    ts = data.get("ts")
    sign = str(data.get("sign") or "")

    if not message:
        return err("问题描述不能为空")
    if len(message) > MAX_MESSAGE_CHARS:
        return err("问题描述太长")
    if not isinstance(screenshot, str) or len(screenshot) > MAX_SHOT_BASE64:
        return err("截图太大")
    if not device_id or not sign or not isinstance(ts, int):
        return err("请求参数不完整")

    now = int(time.time())
    if abs(now - ts) > ALLOW_SKEW:
        return err("设备时间和服务器相差太大，请校准时间后重试")

    if not hmac.compare_digest(sign, expected_sign(ts, device_id, message, screenshot)):
        return err("签名校验失败", 403)

    xff = req.headers.get("x-forwarded-for") or ""
    ip = xff.split(",")[0].strip() or (req.client.host if req.client else "")

    conn = db()
    try:
        conn.execute("DELETE FROM events WHERE ts < ?", (now - 86400,))

        def count(where: str, *args) -> int:
            return conn.execute(f"SELECT COUNT(*) FROM events WHERE {where}", args).fetchone()[0]

        if count("device=? AND ts>?", device_id, now - 3600) >= PER_DEVICE_HOUR:
            return err("提交太频繁，请过一会儿再试", 429)
        if count("device=? AND ts>?", device_id, now - 86400) >= PER_DEVICE_DAY:
            return err("今天提交的反馈已经比较多了，明天再试吧", 429)
        if ip and count("ip=? AND ts>?", ip, now - 3600) >= PER_IP_HOUR:
            return err("提交太频繁，请过一会儿再试", 429)
        if count("ts>?", now - 86400) >= GLOBAL_DAY:
            return err("服务器繁忙，请稍后再试", 503)

        # 先占额度再发信，避免发信失败后被反复重试刷量。
        conn.execute("INSERT INTO events (ts, device, ip) VALUES (?,?,?)", (now, device_id, ip))
        conn.commit()
    finally:
        conn.close()

    # 存一份，统计页上能看（发信失败也留着，不会丢）
    fid = save_feedback(now, device_id, ip, app_version, osname, contact, message, screenshot)

    try:
        send_mail(message, contact, app_version, osname, device_id, ip, screenshot)
    except Exception as e:  # noqa: BLE001
        mark_feedback(fid, f"发信失败：{e}")
        return err(f"服务端发送失败：{e}", 500)

    mark_feedback(fid, "已发到邮箱")
    return {"ok": True}


SHOT_DIR = Path(os.environ.get("SHOT_DIR", str(Path(__file__).with_name("feedback_shots"))))


def feedback_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS feedbacks ("
        "id INTEGER PRIMARY KEY, ts INTEGER, device TEXT, ip TEXT, version TEXT, os TEXT, "
        "contact TEXT, message TEXT, shot TEXT, mail TEXT)"
    )
    # 回复用户（统计页上写回复，发邮件给用户留的邮箱）
    cols = {r[1] for r in conn.execute("PRAGMA table_info(feedbacks)")}
    if "reply" not in cols:
        conn.execute("ALTER TABLE feedbacks ADD COLUMN reply TEXT NOT NULL DEFAULT ''")
        conn.execute("ALTER TABLE feedbacks ADD COLUMN replied_at INTEGER")
    return conn


def save_feedback(ts, device_id, ip, app_version, osname, contact, message, screenshot) -> int | None:
    try:
        conn = feedback_db()
        try:
            cur = conn.execute(
                "INSERT INTO feedbacks (ts, device, ip, version, os, contact, message, shot, mail) VALUES (?,?,?,?,?,?,?,?,?)",
                (ts, device_id, ip, app_version, osname, contact, message, "", "发送中"),
            )
            fid = cur.lastrowid
            if screenshot:
                try:
                    SHOT_DIR.mkdir(parents=True, exist_ok=True)
                    name = f"{fid}.jpg"
                    (SHOT_DIR / name).write_bytes(base64.b64decode(screenshot))
                    conn.execute("UPDATE feedbacks SET shot=? WHERE id=?", (name, fid))
                except Exception:  # noqa: BLE001
                    pass
            conn.commit()
            return fid
        finally:
            conn.close()
    except Exception:  # noqa: BLE001  存不下也不影响发信
        return None


def mark_feedback(fid: int | None, status: str) -> None:
    if fid is None:
        return
    try:
        conn = feedback_db()
        try:
            conn.execute("UPDATE feedbacks SET mail=? WHERE id=?", (status[:200], fid))
            conn.commit()
        finally:
            conn.close()
    except Exception:  # noqa: BLE001
        pass


ID_RE = re.compile(r"^[0-9a-f]{8,64}$")
VER_RE = re.compile(r"^\d{1,4}(\.\d{1,4}){0,3}([-+.][0-9A-Za-z.]{1,20})?$")
OS_RE = re.compile(r"^[a-z0-9_]{1,16}$")


def usage_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS installs ("
        "device TEXT PRIMARY KEY, first_day TEXT, last_day TEXT, version TEXT, os TEXT)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS active ("
        "day TEXT, device TEXT, version TEXT, os TEXT, PRIMARY KEY (day, device))"
    )
    return conn


def today() -> str:
    # 按北京时间算「一天」
    return time.strftime("%Y-%m-%d", time.gmtime(time.time() + 8 * 3600))


def read_latest() -> dict:
    try:
        data = json.loads(Path(LATEST_FILE).read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


@app.get("/update")
def update(req: Request):
    q = req.query_params
    version = (q.get("v") or "").strip().lstrip("v")[:32]
    osname = (q.get("os") or "").strip().lower()[:16]
    arch = (q.get("arch") or "").strip().lower()[:16]
    device = (q.get("id") or "").strip().lower()[:64]

    # 参数对得上才记，乱填的请求照样返回版本信息但不计数
    if ID_RE.match(device) and VER_RE.match(version) and OS_RE.match(osname) and (not arch or OS_RE.match(arch)):
        day = today()
        os_full = f"{osname} {arch}".strip()
        conn = usage_db()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO active (day, device, version, os) VALUES (?,?,?,?)",
                (day, device, version, os_full),
            )
            conn.execute(
                "INSERT INTO installs (device, first_day, last_day, version, os) VALUES (?,?,?,?,?) "
                "ON CONFLICT(device) DO UPDATE SET last_day=excluded.last_day, "
                "version=excluded.version, os=excluded.os",
                (device, day, day, version, os_full),
            )
            conn.commit()
        finally:
            conn.close()

    info = read_latest()
    out = {
        "latest": str(info.get("latest") or version or ""),
        "url": str(info.get("url") or ""),
        "notes": str(info.get("notes") or ""),
    }
    # 本系统的安装包直链和 SHA-256（有的话客户端可以「立即更新」）
    dl = (info.get("downloads") or {}).get(osname)
    if isinstance(dl, dict) and dl.get("url") and dl.get("sha256"):
        out["download"] = {"url": str(dl["url"]), "sha256": str(dl["sha256"]).lower()}
    return out




# —— 全自动更新（Tauri 更新组件，v0.4.1 起的客户端用）——
# 清单写在 updater.json（发版时用 make_updater.py 生成）：
#   {"version": "0.4.1", "notes": "...", "pub_date": "...", "platforms": {"windows-x86_64": {"url": "...", "signature": "..."}, ...}}
UPDATER_FILE = os.environ.get("UPDATER_FILE", str(Path(__file__).with_name("updater.json")))


def _ver(v: str) -> tuple:
    core = (v or "").strip().lstrip("v").split("-")[0]
    parts = [int(p) if p.isdigit() else 0 for p in core.split(".")[:3]]
    return tuple(parts + [0] * (3 - len(parts)))


@app.get("/updater/{target}/{arch}/{current}")
def updater(target: str, arch: str, current: str, bundle: str = ""):
    """没有新版本或这个平台没有更新包时返回 204（Tauri 约定），有的话返回下载地址和签名。

    bundle 是客户端的安装方式（deb、appimage、nsis…，v0.4.2 起的客户端会带上）：
    先找「系统-架构-安装方式」的更新包（比如 linux-x86_64-deb），没有再用「系统-架构」的。
    """
    try:
        info = json.loads(Path(UPDATER_FILE).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return Response(status_code=204)
    version = str(info.get("version") or "")
    platforms = info.get("platforms") or {}
    bundle = bundle.strip().lower()[:16]
    plat = (platforms.get(f"{target}-{arch}-{bundle}") if bundle else None) or platforms.get(f"{target}-{arch}")
    if not version or _ver(version) <= _ver(current) or not isinstance(plat, dict):
        return Response(status_code=204)
    return {
        "version": version,
        "notes": str(info.get("notes") or ""),
        "pub_date": str(info.get("pub_date") or ""),
        "url": str(plat.get("url") or ""),
        "signature": str(plat.get("signature") or ""),
    }


def send_mail(message, contact, app_version, osname, device_id, ip, screenshot) -> None:
    msg = EmailMessage()
    subject = message.replace("\n", " ")[:30]
    msg["Subject"] = f"[Wulabel 反馈] {subject}"
    msg["From"] = MAIL_FROM
    msg["To"] = FEEDBACK_TO
    msg.set_content(
        f"问题描述：\n{message}\n\n"
        f"联系方式：{contact or '（未填）'}\n"
        f"软件版本：{app_version}\n"
        f"操作系统：{osname}\n"
        f"设备标识：{device_id}\n"
        f"来源 IP：{ip}\n"
        f"时间：{time.strftime('%Y-%m-%d %H:%M:%S')}\n"
    )
    if screenshot:
        try:
            raw = base64.b64decode(screenshot)
            msg.add_attachment(raw, maintype="image", subtype="jpeg", filename="screenshot.jpg")
        except Exception:
            pass
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as s:
        s.login(SMTP_USER, SMTP_PASS)
        s.send_message(msg)


EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def reply_feedback(fid: int, text: str) -> str:
    """把回复发到用户留的邮箱，并记下来。成功返回空字符串，失败返回原因"""
    text = (text or "").strip()
    if not text:
        return "回复内容是空的"
    conn = feedback_db()
    try:
        row = conn.execute("SELECT ts, contact, message FROM feedbacks WHERE id=?", (fid,)).fetchone()
        if not row:
            return "找不到这条反馈"
        ts, contact, message = row
        to = (contact or "").strip()
        if not EMAIL_RE.match(to):
            return "这条反馈没有留邮箱，没法回复"
        when = time.strftime("%Y-%m-%d %H:%M", time.gmtime(int(ts) + 8 * 3600))
        msg = EmailMessage()
        msg["Subject"] = "关于你的 Wulabel 反馈"
        msg["From"] = MAIL_FROM
        msg["To"] = to
        msg["Reply-To"] = MAIL_FROM
        msg.set_content(
            f"你好：\n\n{text}\n\n"
            f"——\n你在 {when} 的反馈：\n{message}\n\n"
            "有问题可以直接回复这封邮件。\n"
            "Wulabel（小物标注）https://wulabel.xiaowuiot.com\n"
        )
        try:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as s:
                s.login(SMTP_USER, SMTP_PASS)
                s.send_message(msg)
        except Exception as e:  # noqa: BLE001
            return f"发信失败：{e}"
        conn.execute("UPDATE feedbacks SET reply=?, replied_at=? WHERE id=?", (text, int(time.time()), fid))
        conn.commit()
        return ""
    finally:
        conn.close()


# 使用统计页（/stats），配置见 stats_page.py
import stats_page  # noqa: E402

# 启动时建好反馈表（含回复字段），统计页直接读
try:
    feedback_db().close()
except Exception:  # noqa: BLE001
    pass
stats_page.install(app, DB_PATH, SHOT_DIR, reply_feedback)
