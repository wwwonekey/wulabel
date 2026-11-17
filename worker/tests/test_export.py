"""分割、关键点模型导出 ONNX：用随机初始化的模型导出，再用 onnxruntime 跑一张任意尺寸的图。

运行：python -m unittest discover -s worker/tests（需要 torch、torchvision、onnx、onnxruntime，不下载权重）
"""

import json
import tempfile
import unittest
from pathlib import Path

import numpy as np


class SegPoseExportTest(unittest.TestCase):
    def _export(self, key: str, expect: list[str], extra: dict):
        import onnxruntime as ort

        from xlabel_worker import export, models

        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            m = models.build(key, 2, 160, pretrained=False, num_keypoints=int(extra.get("num_keypoints", 17)))
            models.save(tmp / "best.pt", m, key, ["甲", "乙"], 160, extra)

            out = tmp / "model.onnx"
            export.run(str(tmp / "best.pt"), str(out))
            sess = ort.InferenceSession(str(out), providers=["CPUExecutionProvider"])
            self.assertEqual([o.name for o in sess.get_outputs()], expect)
            sess.run(None, {"image": np.random.rand(3, 200, 176).astype(np.float32)})
            meta = json.loads(out.with_suffix(".json").read_text(encoding="utf-8"))
            self.assertIn(expect[-1], meta["outputs"])

            # 部署页的多格式导出（动态、固定尺寸）
            fmt = tmp / "deploy"
            export.run_formats({"weights": str(tmp / "best.pt"), "out": str(fmt), "formats": ["onnx", "onnx_static"]})
            static = ort.InferenceSession(str(fmt / "onnx_static" / "model_static.onnx"), providers=["CPUExecutionProvider"])
            self.assertEqual([o.name for o in static.get_outputs()], expect)
            static.run(None, {"image": np.random.rand(1, 3, 160, 160).astype(np.float32)})

    def test_maskrcnn(self):
        self._export("maskrcnn_r50", ["boxes", "labels", "scores", "masks"], {})

    def test_keypointrcnn(self):
        self._export("keypointrcnn_r50", ["boxes", "labels", "scores", "keypoints", "keypoints_scores"], {"num_keypoints": 5})


if __name__ == "__main__":
    unittest.main()
