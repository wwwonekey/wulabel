"""YOLOX 训练数据：Mosaic、MixUp、随机仿射、HSV 颜色抖动、翻转，补边缩放到固定尺寸。

增强的做法改写自 YOLOX 0.3.0 的 yolox/data/data_augment.py 和 datasets/mosaicdetection.py
（Copyright (c) Megvii Inc.，Apache-2.0，https://github.com/Megvii-BaseDetection/YOLOX）。
Wulabel 的修改：直接读桌面端导出的 COCO 数据集（图片按 EXIF 摆正，支持中文路径）；
最后几轮可以关掉强增强；没有标注的图也能参加 MixUp 之外的增强。

输出给模型的格式和 YOLOX 官方一致：
    图片 float32 [3, S, S]，BGR，0~255，左上角对齐、其余补 114
    标签 float32 [MAX_LABELS, 5]：类别（从 0 开始）、中心 x、中心 y、宽、高（像素），空位全 0
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import cv2
import numpy as np
import torch

from .data import CocoDetection, load_image

MAX_LABELS = 120
PAD = 114


# ---------- 改写自 yolox/data/data_augment.py ----------


def augment_hsv(img, hgain=5, sgain=30, vgain=30):
    hsv_augs = np.random.uniform(-1, 1, 3) * [hgain, sgain, vgain]  # random gains
    hsv_augs *= np.random.randint(0, 2, 3)  # random selection of h, s, v
    hsv_augs = hsv_augs.astype(np.int16)
    img_hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV).astype(np.int16)

    img_hsv[..., 0] = (img_hsv[..., 0] + hsv_augs[0]) % 180
    img_hsv[..., 1] = np.clip(img_hsv[..., 1] + hsv_augs[1], 0, 255)
    img_hsv[..., 2] = np.clip(img_hsv[..., 2] + hsv_augs[2], 0, 255)

    cv2.cvtColor(img_hsv.astype(img.dtype), cv2.COLOR_HSV2BGR, dst=img)


def _aug_param(value, center=0.0):
    if isinstance(value, (int, float)):
        return random.uniform(center - value, center + value)
    return random.uniform(value[0], value[1])


def random_affine(img, targets, target_size, degrees=10.0, translate=0.1, scales=(0.1, 2.0), shear=2.0):
    """targets: [N, 5]，前 4 列 xyxy 像素"""
    twidth, theight = target_size
    angle = _aug_param(degrees)
    scale = _aug_param(scales, center=1.0)
    R = cv2.getRotationMatrix2D(angle=angle, center=(0, 0), scale=scale)
    M = np.ones([2, 3])
    shear_x = math.tan(_aug_param(shear) * math.pi / 180)
    shear_y = math.tan(_aug_param(shear) * math.pi / 180)
    M[0] = R[0] + shear_y * R[1]
    M[1] = R[1] + shear_x * R[0]
    M[0, 2] = _aug_param(translate) * twidth
    M[1, 2] = _aug_param(translate) * theight

    img = cv2.warpAffine(img, M, dsize=target_size, borderValue=(PAD, PAD, PAD))

    n = len(targets)
    if n:
        corners = np.ones((4 * n, 3))
        corners[:, :2] = targets[:, [0, 1, 2, 3, 0, 3, 2, 1]].reshape(4 * n, 2)
        corners = (corners @ M.T).reshape(n, 8)
        xs, ys = corners[:, 0::2], corners[:, 1::2]
        boxes = np.concatenate((xs.min(1), ys.min(1), xs.max(1), ys.max(1))).reshape(4, n).T
        boxes[:, 0::2] = boxes[:, 0::2].clip(0, twidth)
        boxes[:, 1::2] = boxes[:, 1::2].clip(0, theight)
        targets[:, :4] = boxes
    return img, targets


def _mirror(image, boxes, prob=0.5):
    _, width, _ = image.shape
    if random.random() < prob:
        image = image[:, ::-1]
        boxes[:, 0::2] = width - boxes[:, 2::-2]
    return image, boxes


def preproc(img, size: int):
    """补边缩放：按比例缩放到能放进 size×size，左上角对齐，其余补 114。返回 [3, S, S] float32 和缩放比例"""
    padded = np.full((size, size, 3), PAD, dtype=np.uint8)
    r = min(size / img.shape[0], size / img.shape[1])
    resized = cv2.resize(img, (int(img.shape[1] * r), int(img.shape[0] * r)), interpolation=cv2.INTER_LINEAR)
    padded[: resized.shape[0], : resized.shape[1]] = resized
    return np.ascontiguousarray(padded.transpose(2, 0, 1), dtype=np.float32), r


def _xyxy2cxcywh(b):
    b = b.copy()
    b[:, 2] = b[:, 2] - b[:, 0]
    b[:, 3] = b[:, 3] - b[:, 1]
    b[:, 0] = b[:, 0] + b[:, 2] * 0.5
    b[:, 1] = b[:, 1] + b[:, 3] * 0.5
    return b


def train_transform(image, targets, size: int, flip_prob: float, hsv_prob: float):
    """targets: [N, 5] xyxy + 类别 → 图片 [3,S,S] 和补齐的标签 [MAX_LABELS, 5]（类别, cx, cy, w, h）"""
    padded_labels = np.zeros((MAX_LABELS, 5), dtype=np.float32)
    if len(targets) == 0:
        img, _ = preproc(image, size)
        return img, padded_labels

    boxes = targets[:, :4].copy()
    labels = targets[:, 4].copy()
    image_o, boxes_o, labels_o = image.copy(), boxes.copy(), labels.copy()

    if random.random() < hsv_prob:
        augment_hsv(image)
    image_t, boxes = _mirror(image, boxes, flip_prob)
    image_t, r = preproc(image_t, size)
    boxes = _xyxy2cxcywh(boxes) * r

    keep = np.minimum(boxes[:, 2], boxes[:, 3]) > 1
    boxes_t, labels_t = boxes[keep], labels[keep]
    if len(boxes_t) == 0:
        # 增强后框都没了，退回原图
        image_t, r = preproc(image_o, size)
        boxes_t, labels_t = _xyxy2cxcywh(boxes_o) * r, labels_o

    t = np.hstack((labels_t[:, None], boxes_t))[:MAX_LABELS]
    padded_labels[: len(t)] = t
    return image_t, padded_labels


# ---------- 改写自 yolox/data/datasets/mosaicdetection.py ----------


def _mosaic_coord(index, xc, yc, w, h, input_h, input_w):
    if index == 0:  # 左上
        x1, y1, x2, y2 = max(xc - w, 0), max(yc - h, 0), xc, yc
        small = w - (x2 - x1), h - (y2 - y1), w, h
    elif index == 1:  # 右上
        x1, y1, x2, y2 = xc, max(yc - h, 0), min(xc + w, input_w * 2), yc
        small = 0, h - (y2 - y1), min(w, x2 - x1), h
    elif index == 2:  # 左下
        x1, y1, x2, y2 = max(xc - w, 0), yc, xc, min(input_h * 2, yc + h)
        small = w - (x2 - x1), 0, w, min(y2 - y1, h)
    else:  # 右下
        x1, y1, x2, y2 = xc, yc, min(xc + w, input_w * 2), min(input_h * 2, yc + h)
        small = 0, 0, min(w, x2 - x1), min(y2 - y1, h)
    return (x1, y1, x2, y2), small


class YoloxTrainSet(torch.utils.data.Dataset):
    """训练集：Mosaic + 随机仿射 + MixUp + HSV + 翻转。close() 之后只做 HSV 和翻转（最后几轮）"""

    def __init__(self, root: Path, size: int, aug: dict | None, spec: dict):
        self.base = CocoDetection(root, "train", train=False)
        self.size = size
        aug = aug or {}
        self.flip_prob = 0.5 if aug.get("hflip", True) else 0.0
        self.mosaic = True
        self.mosaic_prob = float(spec.get("mosaic_prob", 1.0))
        self.mixup = bool(spec.get("mixup", True))
        self.mosaic_scale = spec.get("mosaic_scale", (0.1, 2.0))
        self.mixup_scale = (0.5, 1.5)
        self.degrees, self.translate, self.shear = 10.0, 0.1, 2.0

    def close(self):
        self.mosaic = False

    def __len__(self):
        return len(self.base)

    def pull(self, i: int):
        """原图（BGR uint8）和标注 [N, 5]：xyxy 像素 + 类别（从 0 开始）"""
        im = self.base.images[i]
        img = np.ascontiguousarray(np.array(load_image(self.base.dir / im["file_name"]))[:, :, ::-1])
        t = self.base.target(i)
        boxes = t["boxes"].numpy().astype(np.float32)
        labels = (t["labels"].numpy() - 1).astype(np.float32)
        return img, np.hstack((boxes, labels[:, None])) if len(boxes) else np.zeros((0, 5), np.float32)

    def __getitem__(self, idx: int):
        s = self.size
        if self.mosaic and random.random() < self.mosaic_prob:
            yc = int(random.uniform(0.5 * s, 1.5 * s))
            xc = int(random.uniform(0.5 * s, 1.5 * s))
            indices = [idx] + [random.randint(0, len(self) - 1) for _ in range(3)]
            mosaic_img = np.full((s * 2, s * 2, 3), PAD, dtype=np.uint8)
            all_labels = []
            for k, index in enumerate(indices):
                img, labels = self.pull(index)
                h0, w0 = img.shape[:2]
                scale = min(s / h0, s / w0)
                img = cv2.resize(img, (max(1, int(w0 * scale)), max(1, int(h0 * scale))), interpolation=cv2.INTER_LINEAR)
                h, w = img.shape[:2]
                (l_x1, l_y1, l_x2, l_y2), (s_x1, s_y1, s_x2, s_y2) = _mosaic_coord(k, xc, yc, w, h, s, s)
                mosaic_img[l_y1:l_y2, l_x1:l_x2] = img[s_y1:s_y2, s_x1:s_x2]
                padw, padh = l_x1 - s_x1, l_y1 - s_y1
                if len(labels):
                    labels = labels.copy()
                    labels[:, [0, 2]] = scale * labels[:, [0, 2]] + padw
                    labels[:, [1, 3]] = scale * labels[:, [1, 3]] + padh
                all_labels.append(labels)
            labels = np.concatenate(all_labels, 0)
            labels[:, [0, 2]] = labels[:, [0, 2]].clip(0, 2 * s)
            labels[:, [1, 3]] = labels[:, [1, 3]].clip(0, 2 * s)
            img, labels = random_affine(
                mosaic_img, labels, (s, s), self.degrees, self.translate, self.mosaic_scale, self.shear
            )
            if self.mixup and len(labels) and random.random() < 1.0:
                img, labels = self._mixup(img, labels)
        else:
            img, labels = self.pull(idx)
        img, padded = train_transform(img, labels, s, self.flip_prob, hsv_prob=1.0)
        return torch.from_numpy(img), torch.from_numpy(padded)

    def _mixup(self, origin_img, origin_labels):
        s = self.size
        cp_img, cp_labels = None, None
        for _ in range(10):
            img, labels = self.pull(random.randint(0, len(self) - 1))
            if len(labels):
                cp_img, cp_labels = img, labels
                break
        if cp_img is None:
            return origin_img, origin_labels
        jit = random.uniform(*self.mixup_scale)
        flip = random.random() > 0.5
        canvas = np.full((s, s, 3), PAD, dtype=np.uint8)
        r = min(s / cp_img.shape[0], s / cp_img.shape[1])
        resized = cv2.resize(cp_img, (max(1, int(cp_img.shape[1] * r)), max(1, int(cp_img.shape[0] * r))), interpolation=cv2.INTER_LINEAR)
        canvas[: resized.shape[0], : resized.shape[1]] = resized
        canvas = cv2.resize(canvas, (max(1, int(s * jit)), max(1, int(s * jit))))
        r *= jit
        if flip:
            canvas = canvas[:, ::-1, :]
        oh, ow = canvas.shape[:2]
        th, tw = origin_img.shape[:2]
        padded = np.zeros((max(oh, th), max(ow, tw), 3), dtype=np.uint8)
        padded[:oh, :ow] = canvas
        y0 = random.randint(0, padded.shape[0] - th - 1) if padded.shape[0] > th else 0
        x0 = random.randint(0, padded.shape[1] - tw - 1) if padded.shape[1] > tw else 0
        crop = padded[y0 : y0 + th, x0 : x0 + tw]

        boxes = cp_labels[:, :4].copy()
        boxes[:, 0::2] = np.clip(boxes[:, 0::2] * r, 0, ow)
        boxes[:, 1::2] = np.clip(boxes[:, 1::2] * r, 0, oh)
        if flip:
            boxes[:, 0::2] = ow - boxes[:, 0::2][:, ::-1]
        boxes[:, 0::2] = np.clip(boxes[:, 0::2] - x0, 0, tw)
        boxes[:, 1::2] = np.clip(boxes[:, 1::2] - y0, 0, th)
        labels = np.vstack((origin_labels, np.hstack((boxes, cp_labels[:, 4:5]))))
        img = (0.5 * origin_img.astype(np.float32) + 0.5 * crop.astype(np.float32)).astype(np.uint8)
        return img, labels
