"""模型下载：断了能接着下、报进度、下完改名；服务器不支持续传时从头下。

用本机的小 HTTP 服务模拟：第一次只发一半就断开。不联网，只用标准库。
运行：python -m unittest discover -s worker/tests
"""

import http.server
import json
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

from xlabel_worker import download

DATA = bytes(range(256)) * 4096  # 1 MB


class Handler(http.server.BaseHTTPRequestHandler):
    cut_first = True  # 第一次请求只发一半就断开
    ranges = True  # 支持 Range
    calls = 0

    def log_message(self, *a):
        pass

    def do_GET(self):
        cls = type(self)
        cls.calls += 1
        start = 0
        rng = self.headers.get("Range")
        if rng and cls.ranges:
            start = int(rng.split("=")[1].split("-")[0])
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{len(DATA) - 1}/{len(DATA)}")
        else:
            self.send_response(200)
        body = DATA[start:]
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if cls.cut_first and cls.calls == 1:
            self.wfile.write(body[: len(body) // 2])
            self.wfile.flush()
            self.connection.close()
            return
        self.wfile.write(body)


def serve(handler):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}/w.pth"


def events(out: str):
    return [json.loads(line) for line in out.splitlines() if line.startswith("{")]


class DownloadTest(unittest.TestCase):
    def run_fetch(self, handler):
        srv, url = serve(handler)
        out = StringIO()
        try:
            with tempfile.TemporaryDirectory() as tmp, mock.patch.object(download.time, "sleep"), redirect_stdout(out):
                dest = download.fetch(url, Path(tmp) / "w.pth")
                data = dest.read_bytes()
                self.assertFalse((Path(tmp) / "w.pth.part").exists())
        finally:
            srv.shutdown()
            srv.server_close()
        return data, events(out.getvalue())

    def test_resume_after_cut(self):
        H = type("H", (Handler,), {"calls": 0, "cut_first": True, "ranges": True})
        data, evs = self.run_fetch(H)
        self.assertEqual(data, DATA)
        self.assertEqual(H.calls, 2)  # 断了一次，接着下了一次
        dl = [e for e in evs if e.get("type") == "download"]
        self.assertTrue(dl[-1].get("finished"))
        self.assertEqual(dl[-1]["total"], len(DATA))

    def test_no_range_support_restarts(self):
        H = type("H", (Handler,), {"calls": 0, "cut_first": True, "ranges": False})
        data, _ = self.run_fetch(H)
        self.assertEqual(data, DATA)

    def test_hub_hash_check(self):
        H = type("H", (Handler,), {"calls": 0, "cut_first": False, "ranges": True})
        srv, url = serve(H)
        try:
            with tempfile.TemporaryDirectory() as tmp, redirect_stdout(StringIO()):
                dst = Path(tmp) / "a.pth"
                with self.assertRaises(RuntimeError):
                    download._hub_download(url, str(dst), hash_prefix="deadbeef")
                self.assertFalse(dst.exists())
        finally:
            srv.shutdown()
            srv.server_close()

    def test_gives_up(self):
        out = StringIO()
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(download.time, "sleep"), redirect_stdout(out):
            with self.assertRaises(OSError):
                download.fetch("http://127.0.0.1:1/none", Path(tmp) / "x.bin")
        self.assertTrue(events(out.getvalue())[-1].get("failed"))


if __name__ == "__main__":
    unittest.main()
