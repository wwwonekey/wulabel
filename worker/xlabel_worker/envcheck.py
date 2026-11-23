import platform
import sys

from .i18n import tr
from .protocol import emit


def _explain(err: str, info: dict) -> str:
    """把常见的显卡报错换成看得懂的说明，原文附在后面"""
    if "no kernel image" in err.lower():
        # 新显卡（RTX 50 系列等，算力 10.x / 12.x）要 CUDA 12.8 以上的 PyTorch
        try:
            major = int(str(info.get("cap", "0")).split(".")[0])
        except ValueError:
            major = 0
        name = str(info.get("device", ""))
        if major >= 10 or "RTX 50" in name:
            hint = tr("这张显卡需要 CUDA 12.8 版的 PyTorch，请改选后重新安装")
        else:
            hint = tr("显卡和装的 PyTorch 版本不匹配，请换一个 CUDA 版本重新安装")
        first = err.strip().splitlines()[0] if err.strip() else err
        return f"{hint}（{first}）"
    return err


def run() -> None:
    info = {"python": sys.version.split()[0], "platform": platform.platform()}
    try:
        import torch
        import torchvision

        info["torch"] = torch.__version__
        info["torchvision"] = torchvision.__version__
        info["cuda"] = torch.cuda.is_available()
        info["cudaVersion"] = torch.version.cuda
        if info["cuda"]:
            info["device"] = torch.cuda.get_device_name(0)
            info["vram"] = round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)
            cap = torch.cuda.get_device_capability(0)
            info["cap"] = f"{cap[0]}.{cap[1]}"
            # 真跑一次运算，确认显卡可用（新显卡配旧 CUDA 版本会在这里报错）
            x = torch.ones(64, 64, device="cuda")
            info["cudaOk"] = float((x @ x).sum()) == 64 * 64 * 64
        else:
            mps = getattr(torch.backends, "mps", None)
            info["mps"] = bool(mps is not None and mps.is_available())
            info["device"] = tr("Apple 芯片（MPS）") if info["mps"] else "CPU"
    except Exception as e:
        info["error"] = _explain(str(e), info)
    for m in ("numpy", "PIL", "onnx", "onnxruntime", "cv2"):
        try:
            __import__(m)
            info[m] = True
        except Exception:
            info[m] = False
    emit("env", **info)
