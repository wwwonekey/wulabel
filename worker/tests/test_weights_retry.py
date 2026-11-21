"""YOLOX 预训练权重：本地缓存的文件损坏时删掉重下，不会两个地址都读同一个坏文件。

不联网：用假的下载函数代替 torch.hub。
运行：python -m unittest discover -s worker/tests
"""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import torch

from xlabel_worker import yolox_det


class WeightsRetryTest(unittest.TestCase):
    def test_corrupt_cache_is_redownloaded(self):
        net = yolox_det.build_net("yolox_nano", 2)
        good = {"model": net.state_dict()}
        old_dir = torch.hub.get_dir()
        with tempfile.TemporaryDirectory() as tmp:
            torch.hub.set_dir(tmp)
            try:
                cached = Path(tmp) / "checkpoints" / "yolox_nano.pth"
                cached.parent.mkdir(parents=True)
                cached.write_bytes(b"half a file")
                calls = []

                def fake(url, name):
                    calls.append(url)
                    # 缓存文件还在就读缓存（和 torch.hub 一样），坏文件读不出来
                    if cached.exists():
                        raise RuntimeError("PytorchStreamReader failed reading zip archive")
                    return good

                with mock.patch.object(yolox_det, "_load_weights", fake), mock.patch.object(yolox_det, "log"):
                    self.assertTrue(yolox_det.load_pretrained(net, "yolox_nano"))
                # 第一个地址删掉坏文件后重试一次就成功，不用换地址
                self.assertEqual(len(calls), 2)
                self.assertTrue(all(u == calls[0] for u in calls))
                self.assertFalse(cached.exists())
            finally:
                torch.hub.set_dir(old_dir)

    def test_network_failure_tries_next_url(self):
        net = yolox_det.build_net("yolox_nano", 2)
        calls = []

        def fake(url, name):
            calls.append(url)
            raise OSError("network unreachable")

        with tempfile.TemporaryDirectory() as tmp:
            old_dir = torch.hub.get_dir()
            torch.hub.set_dir(tmp)
            try:
                with mock.patch.object(yolox_det, "_load_weights", fake), mock.patch.object(yolox_det, "log"):
                    self.assertFalse(yolox_det.load_pretrained(net, "yolox_nano"))
            finally:
                torch.hub.set_dir(old_dir)
        self.assertEqual(len(calls), len(yolox_det.WEIGHT_URLS))


if __name__ == "__main__":
    unittest.main()
