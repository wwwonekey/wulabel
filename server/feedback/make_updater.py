"""发版时生成全自动更新的清单 updater.json，并把更新包下载到官网的下载目录。

用法（在服务器上，发布 GitHub Release 之后）：
    python make_updater.py 0.4.1 --download-dir D:/server/apps/wulabel-web/download \
        --base-url https://wulabel.xiaowuiot.com/download --notes "这一版的更新说明"

做的事：
1. 从 GitHub Release（xiaowu-iot/wulabel 的 v版本号）读出各平台的更新包和签名（.sig）；
2. 把更新包下载到 --download-dir（Mac 的 .app.tar.gz 改名带上版本号，免得被下个版本覆盖）；
3. 在本文件旁边写 updater.json，下载地址指向官网，签名用打包时生成的 .sig 内容。

更新包对应关系（Tauri 更新组件的平台名 → 文件）：
    windows-x86_64            Wulabel_<版本>_x64-setup.exe
    darwin-aarch64 / x86_64   Wulabel_universal.app.tar.gz（官网上叫 Wulabel_<版本>_universal.app.tar.gz）
    linux-x86_64              Wulabel_<版本>_amd64.AppImage
    linux-x86_64-deb          Wulabel_<版本>_amd64.deb（用 .deb 装的客户端，v0.4.2 起会带上安装方式）
    linux-aarch64             Wulabel_<版本>_aarch64.AppImage（ARM64，v0.4.2 起）
    linux-aarch64-deb         Wulabel_<版本>_arm64.deb
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.request
from pathlib import Path

REPO = "xiaowu-iot/wulabel"


def get(url: str, accept: str = "application/octet-stream") -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "wulabel-release", "Accept": accept})
    with urllib.request.urlopen(req, timeout=600) as r:
        return r.read()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("version")
    ap.add_argument("--download-dir", required=True)
    ap.add_argument("--base-url", default="https://wulabel.xiaowuiot.com/download")
    ap.add_argument("--notes", default="")
    args = ap.parse_args()
    v = args.version.lstrip("v")

    rel = json.loads(get(f"https://api.github.com/repos/{REPO}/releases/tags/v{v}", "application/vnd.github+json"))
    assets = {a["name"]: a["browser_download_url"] for a in rel.get("assets", [])}

    # (平台, GitHub 上的文件名, 官网上的文件名)
    plan = [
        (["windows-x86_64"], f"Wulabel_{v}_x64-setup.exe", f"Wulabel_{v}_x64-setup.exe"),
        (["darwin-aarch64", "darwin-x86_64"], "Wulabel_universal.app.tar.gz", f"Wulabel_{v}_universal.app.tar.gz"),
        (["linux-x86_64"], f"Wulabel_{v}_amd64.AppImage", f"Wulabel_{v}_amd64.AppImage"),
        (["linux-x86_64-deb"], f"Wulabel_{v}_amd64.deb", f"Wulabel_{v}_amd64.deb"),
        (["linux-aarch64"], f"Wulabel_{v}_aarch64.AppImage", f"Wulabel_{v}_aarch64.AppImage"),
        (["linux-aarch64-deb"], f"Wulabel_{v}_arm64.deb", f"Wulabel_{v}_arm64.deb"),
    ]
    out_dir = Path(args.download_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    platforms = {}
    for names, gh_name, site_name in plan:
        if gh_name not in assets or gh_name + ".sig" not in assets:
            print(f"跳过：Release 里没有 {gh_name} 或它的签名")
            continue
        sig = get(assets[gh_name + ".sig"]).decode("utf-8").strip()
        target = out_dir / site_name
        if not target.exists():
            print(f"下载 {gh_name} → {target}")
            tmp = target.with_suffix(target.suffix + ".part")
            tmp.write_bytes(get(assets[gh_name]))
            tmp.replace(target)
        for n in names:
            platforms[n] = {"url": f"{args.base_url.rstrip('/')}/{site_name}", "signature": sig}

    manifest = {
        "version": v,
        "notes": args.notes,
        "pub_date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "platforms": platforms,
    }
    out = Path(__file__).with_name("updater.json")
    out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已写 {out}，平台：{', '.join(platforms) or '无'}")


if __name__ == "__main__":
    main()
