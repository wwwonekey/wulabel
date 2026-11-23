"""下载模型文件：边下边报进度（download 事件，界面显示进度条），断了接着下，收不到数据会超时重连。

用到的地方：
- 训练时的预训练权重（YOLOX、torchvision 的检测 / 分类模型）：torch.hub 的下载函数换成这里的 fetch；
- SAM、文本检测模型（Hugging Face）：hf_model 逐个文件下载到本地目录。

download 事件：{"type": "download", "name": 文件名, "done": 已下字节, "total": 总字节（不知道时 0）, "speed": 字节/秒,
              "finished": 下完了 / "failed": 失败了}
"""

from __future__ import annotations

import hashlib
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from .i18n import tr
from .protocol import emit, log

TIMEOUT = 30  # 秒：这么久收不到数据算卡住，断开重连
RETRIES = 5  # 连续失败几次就放弃（每次有进展都重新计数）
CHUNK = 256 * 1024
UA = "Wulabel"


def _mb(n: int) -> str:
    return f"{n / 1048576:.1f} MB"


def fetch(url: str, dest: Path, name: str | None = None) -> Path:
    """下载到 dest。先写 dest.part，断了用 Range 接着下（下次运行也能接着下），下完再改名。"""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    name = name or dest.name
    part = dest.with_name(dest.name + ".part")
    log(tr("下载 {name}：{url}", name=name, url=url))
    fails = 0
    total = 0
    last_emit = 0.0
    try:
        while True:
            have = part.stat().st_size if part.exists() else 0
            headers = {"User-Agent": UA}
            if have:
                headers["Range"] = f"bytes={have}-"
            done = have
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=TIMEOUT) as r:
                    length = int(r.headers.get("Content-Length") or 0)
                    if have and r.status == 206:
                        # Content-Range: bytes 起-止/总
                        tail = (r.headers.get("Content-Range") or "").rsplit("/", 1)[-1]
                        total = int(tail) if tail.isdigit() else have + length
                    else:
                        # 服务器不支持接着下，从头来
                        have = done = 0
                        total = length
                    t0, b0 = time.time(), done
                    with open(part, "ab" if have else "wb") as f:
                        while True:
                            buf = r.read(CHUNK)
                            if not buf:
                                break
                            f.write(buf)
                            done += len(buf)
                            now = time.time()
                            if now - last_emit >= 0.5:
                                emit("download", name=name, done=done, total=total, speed=int((done - b0) / max(now - t0, 1e-3)))
                                last_emit = now
                if total and done < total:
                    raise ConnectionError(tr("连接断开，只收到 {got} / {total}", got=_mb(done), total=_mb(total)))
                break
            except urllib.error.HTTPError as e:
                if e.code == 416 and have:
                    # 请求的起点已经到文件末尾：上次其实下完了
                    break
                raise
            except (OSError, ConnectionError) as e:  # 超时、连接被重置、断网
                fails = 1 if done > have else fails + 1
                if fails > RETRIES:
                    raise
                wait = min(2 * fails, 10)
                log(tr("下载中断（{e}），{n} 秒后接着下…", e=e, n=wait))
                time.sleep(wait)
    except BaseException:
        emit("download", name=name, done=0, total=total, speed=0, failed=True)
        raise
    part.replace(dest)
    size = dest.stat().st_size
    emit("download", name=name, done=size, total=size, speed=0, finished=True)
    log(tr("下载完成：{name}（{size}）", name=name, size=_mb(size)))
    return dest


# ---------- torch.hub ----------


def _hub_download(url: str, dst: str, hash_prefix: str | None = None, progress: bool = True) -> None:
    """和 torch.hub.download_url_to_file 同样的参数，换成带进度、能接着下的下载"""
    p = fetch(url, Path(dst))
    if hash_prefix:
        h = hashlib.sha256()
        with open(p, "rb") as f:
            for blk in iter(lambda: f.read(1 << 20), b""):
                h.update(blk)
        digest = h.hexdigest()
        if not digest.startswith(hash_prefix):
            p.unlink(missing_ok=True)
            raise RuntimeError(f'invalid hash value (expected "{hash_prefix}", got "{digest}")')


def patch_torch_hub() -> None:
    """让 torch.hub（YOLOX、torchvision 的预训练权重）用这里的下载：显示进度、断了接着下、卡住超时"""
    import torch.hub

    torch.hub.download_url_to_file = _hub_download


# ---------- Hugging Face ----------

# 不需要的文件：别的框架的权重、说明、图片
_SKIP = (".msgpack", ".h5", ".onnx", ".ot", ".md", ".png", ".jpg", ".jpeg", ".gif", ".gitattributes")


def hf_model(name: str) -> str:
    """Hugging Face 上的模型（如 facebook/sam-vit-base）：已经下过就直接用，否则逐个文件下载（带进度、能接着下）。
    返回 from_pretrained 能用的本地目录。下载地址跟着 HF_ENDPOINT（国内用镜像）。"""
    # 老版本用 transformers 自己下过的，在 HF 缓存里
    try:
        from huggingface_hub import snapshot_download

        cached = snapshot_download(name, local_files_only=True)
        if any(Path(cached).glob("*.safetensors")) or any(Path(cached).glob("*.bin")):
            return cached
    except Exception:  # 没下过
        pass
    root = Path(os.environ.get("HF_HOME") or Path.home() / ".cache" / "huggingface") / "wulabel" / name.replace("/", "--")
    if (root / ".complete").exists():
        return str(root)
    from huggingface_hub import HfApi, hf_hub_url

    files = [f for f in HfApi().list_repo_files(name) if "/" not in f and not f.lower().endswith(_SKIP)]
    # 有 safetensors 时不要重复的 .bin 权重
    if any(f.endswith(".safetensors") for f in files):
        files = [f for f in files if not (f.endswith(".bin") and f.startswith(("pytorch_model", "model")))]
    for f in files:
        if not (root / f).exists():
            fetch(hf_hub_url(name, f), root / f, f"{name.split('/')[-1]}/{f}")
    (root / ".complete").write_text("ok", encoding="utf-8")
    return str(root)
