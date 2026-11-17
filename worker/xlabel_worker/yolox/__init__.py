# YOLOX 模型代码，摘自 https://github.com/Megvii-BaseDetection/YOLOX（0.3.0），Apache-2.0，许可证见同目录 LICENSE。
# 各文件开头写明了是否修改、改了什么。训练、推理的接入代码在上一级的 yolox_det.py、yolox_data.py。

from .utils import ModelEMA, bboxes_iou
from .yolo_head import YOLOXHead
from .yolo_pafpn import YOLOPAFPN
from .yolox import YOLOX

__all__ = ["YOLOX", "YOLOPAFPN", "YOLOXHead", "ModelEMA", "bboxes_iou"]
