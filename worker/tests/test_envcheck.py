"""训练环境检查：显卡报错换成看得懂的说明。

不联网、不需要显卡。
运行：python -m unittest discover -s worker/tests
"""

import unittest

from xlabel_worker import envcheck

NO_KERNEL = "CUDA error: no kernel image is available for execution on the device\nCUDA kernel errors might be ..."


class ExplainTest(unittest.TestCase):
    def test_new_gpu_needs_cu128(self):
        s = envcheck._explain(NO_KERNEL, {"cap": "12.0", "device": "NVIDIA GeForce RTX 5070"})
        self.assertIn("CUDA 12.8", s)
        self.assertIn("no kernel image", s)
        self.assertNotIn("might be", s)

    def test_rtx50_by_name(self):
        s = envcheck._explain(NO_KERNEL, {"device": "NVIDIA GeForce RTX 5090"})
        self.assertIn("CUDA 12.8", s)

    def test_old_gpu_other_hint(self):
        s = envcheck._explain(NO_KERNEL, {"cap": "3.5", "device": "Tesla K40"})
        self.assertNotIn("CUDA 12.8", s)
        self.assertIn("no kernel image", s)

    def test_other_errors_unchanged(self):
        self.assertEqual(envcheck._explain("No module named 'torch'", {}), "No module named 'torch'")


if __name__ == "__main__":
    unittest.main()
