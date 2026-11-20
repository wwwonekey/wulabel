"""显存不够时自动减小批大小重训"""

import tempfile
import unittest
from pathlib import Path
from unittest import mock

from xlabel_worker import train


class OomRetryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def run_with(self, fails: int, batch: int, err=None):
        err = err or RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")
        seen = []

        def fake(cfg):
            seen.append(cfg["batch"])
            (self.out / "metrics.jsonl").write_text("{}\n", encoding="utf-8")
            if len(seen) <= fails:
                raise err

        events = []
        with mock.patch.object(train, "run_once", fake), mock.patch.object(
            train, "emit", lambda kind, **f: events.append((kind, f))
        ), mock.patch.object(train, "log", lambda m: None):
            train.run({"out": str(self.out), "batch": batch})
        return seen, events

    def test_halves_until_fits(self):
        seen, events = self.run_with(fails=2, batch=8)
        self.assertEqual(seen, [8, 4, 2])
        self.assertEqual([f for k, f in events if k == "batch"], [{"batch": 4, "was": 8}, {"batch": 2, "was": 4}])

    def test_gives_up_at_one(self):
        with self.assertRaises(RuntimeError):
            self.run_with(fails=5, batch=2)

    def test_other_errors_not_retried(self):
        with self.assertRaises(RuntimeError):
            self.run_with(fails=1, batch=8, err=RuntimeError("训练集是空的"))

    def test_mps_message(self):
        seen, _ = self.run_with(fails=1, batch=4, err=RuntimeError("MPS backend out of memory (MPS allocated: 8 GB)"))
        self.assertEqual(seen, [4, 2])


if __name__ == "__main__":
    unittest.main()
