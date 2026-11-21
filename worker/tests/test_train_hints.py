"""训练时的醒目提示：指标一直是 0、没加载到预训练权重。

不联网、不下载权重。
运行：python -m unittest discover -s worker/tests
"""

import tempfile
import unittest
from unittest import mock

import torch

from xlabel_worker import models, train, yolox_det


class ZeroWatchTest(unittest.TestCase):
    def test_fires_once_after_n_zero_epochs(self):
        w = train.ZeroWatch(3)
        self.assertEqual([w.update(v) for v in (0, 0, 0, 0, 0)], [False, False, True, False, False])

    def test_streak_resets_on_nonzero(self):
        w = train.ZeroWatch(3)
        self.assertEqual([w.update(v) for v in (0, 0, 0.2, 0, 0)], [False, False, False, False, False])
        self.assertTrue(w.update(0))

    def test_short_training(self):
        # 只训 1 轮也能提示
        self.assertTrue(train.ZeroWatch(1).update(0.0))


class NoPretrainedWarnTest(unittest.TestCase):
    def fail_builder(self, **kw):
        if kw.get("weights") or kw.get("weights_backbone"):
            raise OSError("network unreachable")
        return "model"

    def test_torchvision_warns(self):
        with mock.patch.object(models, "log"), mock.patch.object(models, "warn") as w:
            self.assertEqual(models._with_weights(self.fail_builder, True, {}, "COCO "), "model")
        w.assert_called_once()
        self.assertEqual(w.call_args[0][0], "no_pretrained")

    def test_quiet_when_continuing(self):
        with mock.patch.object(models, "log"), mock.patch.object(models, "warn") as w:
            models._with_weights(self.fail_builder, True, {}, "COCO ", warn_missing=False)
        w.assert_not_called()

    def test_yolox_warns(self):
        net = yolox_det.build_net("yolox_nano", 2)

        def fake(url, name):
            raise OSError("network unreachable")

        # 失败时会删缓存文件，换到临时目录，别动真的缓存
        old_dir = torch.hub.get_dir()
        with tempfile.TemporaryDirectory() as tmp:
            torch.hub.set_dir(tmp)
            try:
                with mock.patch.object(yolox_det, "_load_weights", fake), mock.patch.object(
                    yolox_det, "log"
                ), mock.patch.object(yolox_det, "warn") as w:
                    self.assertFalse(yolox_det.load_pretrained(net, "yolox_nano"))
            finally:
                torch.hub.set_dir(old_dir)
        w.assert_called_once()
        self.assertEqual(w.call_args[0][0], "no_pretrained")


if __name__ == "__main__":
    unittest.main()
