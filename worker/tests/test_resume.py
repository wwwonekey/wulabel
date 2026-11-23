"""从断点继续训练：训完第 1 轮就停下，再从断点接着跑完剩下的轮次，曲线不重复、断点用完删掉。

用 YOLOX-Nano（带 EMA、自己的学习率曲线），CPU 上跑。第一次会下载 YOLOX-Nano 预训练权重。
运行：python -m unittest discover -s worker/tests
"""

import json
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

from test_yolox_smoke import CLASSES, make_dataset


class ResumeTest(unittest.TestCase):
    def test_stop_then_resume(self):
        from xlabel_worker import models, train

        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            make_dataset(tmp / "ds", n_train=8, n_val=2)
            out = tmp / "run"
            cfg = {
                "dataset": str(tmp / "ds"), "out": str(out), "model": "yolox_nano", "classes": CLASSES,
                "epochs": 3, "img_size": 160, "batch": 4, "lr": 0.01, "device": "cpu", "workers": 0,
            }
            real_save = models.save

            # 第 1 轮存完模型就放 STOP，相当于用户点了停止
            def save_then_stop(path, *a, **kw):
                real_save(path, *a, **kw)
                if Path(path).name == "last.pt":
                    (out / "STOP").write_text("")

            with mock.patch.object(train.models, "save", save_then_stop), redirect_stdout(StringIO()):
                train.run(dict(cfg))
            self.assertTrue((out / "resume.pt").exists())
            self.assertEqual(self.epochs(out), [1])
            (out / "STOP").unlink()

            with redirect_stdout(StringIO()):
                train.run({**cfg, "resume": True})
            # 接着跑了第 2、3 轮，没有重复的第 1 轮
            self.assertEqual(self.epochs(out), [1, 2, 3])
            self.assertTrue((out / "eval.json").exists())
            # 训完了，断点删掉
            self.assertFalse((out / "resume.pt").exists())

    @staticmethod
    def epochs(out: Path) -> list:
        return [json.loads(ln)["epoch"] for ln in (out / "metrics.jsonl").read_text(encoding="utf-8").splitlines() if ln.strip()]


if __name__ == "__main__":
    unittest.main()
