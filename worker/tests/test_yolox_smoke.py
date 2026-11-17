"""YOLOX 冒烟测试：小数据集上 CPU 训 2 轮 → 推理 → 导出两种 ONNX 并用 onnxruntime 跑通。

运行：python -m unittest discover -s worker/tests
需要 torch、torchvision、opencv-python-headless、onnx、onnxruntime，第一次会下载 YOLOX-Nano 预训练权重。
"""

import json
import random
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

CLASSES = ["红块", "蓝块"]


def make_dataset(root: Path, n_train: int = 12, n_val: int = 4) -> None:
    """画几张带红、蓝方块的图，生成和桌面端导出一样的 COCO 数据集"""
    rnd = random.Random(0)
    for split, n in (("train", n_train), ("val", n_val)):
        (root / "images" / split).mkdir(parents=True, exist_ok=True)
        images, anns = [], []
        for i in range(n):
            w, h = 200 + rnd.randint(0, 80), 150 + rnd.randint(0, 60)
            img = Image.new("RGB", (w, h), (rnd.randint(150, 230),) * 3)
            d = ImageDraw.Draw(img)
            for _ in range(rnd.randint(1, 3)):
                c = rnd.randint(0, 1)
                bw, bh = rnd.randint(25, 60), rnd.randint(25, 60)
                x, y = rnd.randint(0, w - bw - 1), rnd.randint(0, h - bh - 1)
                d.rectangle([x, y, x + bw, y + bh], fill=(220, 30, 30) if c == 0 else (30, 30, 220))
                anns.append({"id": len(anns) + 1, "image_id": i + 1, "category_id": c + 1, "bbox": [x, y, bw, bh], "area": bw * bh, "iscrowd": 0})
            name = f"{split}_{i}.jpg"
            img.save(root / "images" / split / name)
            images.append({"id": i + 1, "file_name": name, "width": w, "height": h})
        (root / "annotations").mkdir(exist_ok=True)
        doc = {"images": images, "annotations": anns, "categories": [{"id": k + 1, "name": c} for k, c in enumerate(CLASSES)]}
        (root / "annotations" / f"instances_{split}.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")


class YoloxSmokeTest(unittest.TestCase):
    def test_train_predict_export(self):
        import onnxruntime as ort
        import torch

        from xlabel_worker import export, models, train
        from xlabel_worker.data import load_image
        from torchvision.transforms import functional as F

        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            make_dataset(tmp / "ds")
            out = tmp / "run"
            train.run({
                "dataset": str(tmp / "ds"), "out": str(out), "model": "yolox_nano", "classes": CLASSES,
                "epochs": 2, "img_size": 160, "batch": 4, "lr": 0.01, "device": "cpu", "workers": 0,
            })
            self.assertTrue((out / "best.pt").exists())
            self.assertTrue((out / "eval.json").exists())

            # 和其他内置模型一样的推理用法
            model, ck = models.load(out / "best.pt", torch.device("cpu"))
            self.assertEqual(ck["model"], "yolox_nano")
            img = F.to_tensor(load_image(tmp / "ds" / "images" / "val" / "val_0.jpg"))
            o = model([img])[0]
            self.assertEqual(set(o), {"boxes", "labels", "scores"})
            if len(o["labels"]):
                self.assertGreaterEqual(int(o["labels"].min()), 1)

            # 接着训练（类别不变）
            out2 = tmp / "run2"
            train.run({
                "dataset": str(tmp / "ds"), "out": str(out2), "model": "yolox_nano", "classes": CLASSES,
                "epochs": 1, "img_size": 160, "batch": 4, "device": "cpu", "workers": 0, "init_weights": str(out / "best.pt"),
            })
            self.assertTrue((out2 / "best.pt").exists() or (out2 / "last.pt").exists())

            # Wulabel 格式 ONNX（任意尺寸输入，模型里做补边、解码、NMS）
            onnx_path = out / "model.onnx"
            export.run(str(out / "best.pt"), str(onnx_path))
            sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
            boxes, labels, scores = sess.run(None, {"image": img.numpy()})
            self.assertEqual(boxes.shape[-1], 4)
            self.assertEqual(len(labels), len(scores))
            # 和 PyTorch 结果大致一致
            if len(o["scores"]) and len(scores):
                self.assertAlmostEqual(float(scores.max()), float(o["scores"].max()), places=2)

            # 部署格式：固定尺寸的 YOLOX 官方格式 + 转换包
            fmt_out = tmp / "deploy"
            export.run_formats({"weights": str(out / "best.pt"), "out": str(fmt_out), "formats": ["onnx", "onnx_static", "tensorrt", "rknn"]})
            static = fmt_out / "onnx_static" / "model_static.onnx"
            meta = json.loads((static.parent / "model.json").read_text(encoding="utf-8"))
            self.assertEqual(meta["format"], "yolox")
            sess = ort.InferenceSession(str(static), providers=["CPUExecutionProvider"])
            (raw,) = sess.run(None, {"image": (np.random.rand(1, 3, 160, 160) * 255).astype(np.float32)})
            self.assertEqual(raw.shape[-1], 5 + len(CLASSES))
            self.assertTrue((fmt_out / "rknn" / "convert_rknn.py").exists())
            self.assertIn("std_values=[[1, 1, 1]]", (fmt_out / "rknn" / "convert_rknn.py").read_text(encoding="utf-8"))


class TorchvisionStillTrains(unittest.TestCase):
    """改了训练主流程，确认原来的模型还能训"""

    def test_ssdlite_one_epoch(self):
        from xlabel_worker import train

        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            make_dataset(tmp / "ds", 6, 2)
            out = tmp / "run"
            train.run({
                "dataset": str(tmp / "ds"), "out": str(out), "model": "ssdlite", "classes": CLASSES,
                "epochs": 1, "batch": 2, "device": "cpu", "workers": 0,
            })
            self.assertTrue((out / "best.pt").exists() or (out / "last.pt").exists())


if __name__ == "__main__":
    unittest.main()
