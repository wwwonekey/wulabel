import json
import sys
import threading

_lock = threading.Lock()


def emit(kind: str, **fields) -> None:
    """输出一行 JSON 事件给桌面端"""
    line = json.dumps({"type": kind, **fields}, ensure_ascii=False)
    with _lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


def log(msg: str) -> None:
    emit("log", msg=msg)


def warn(code: str, msg: str) -> None:
    """要醒目提示的问题：同时写进日志，界面显示成黄色提示条（桌面端记进训练记录，刷新后还在）。
    code 区分是哪种：no_pretrained 没加载到预训练权重，zero_metric 主指标一直是 0"""
    log(msg)
    emit("warn", code=code, msg=msg)
