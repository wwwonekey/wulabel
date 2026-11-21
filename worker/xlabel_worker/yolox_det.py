"""YOLOX 目标检测：模型规格、预训练权重、和 torchvision 检测模型同样用法的包装、训练任务。

YOLOX 本身的代码在 yolox/ 目录（摘自官方仓库，Apache-2.0）。这里把它包成和其他内置模型一样的接口：
    推理：model([图片 RGB 0~1 [3,H,W], ...]) → [{"boxes": xyxy 像素, "labels": 从 1 开始, "scores"}]
这样评估、预标注、误报测试、实时验证、导出 ONNX（Wulabel 格式）都不用另写一套。

训练按 YOLOX 官方做法：Mosaic / MixUp 等强增强、最后几轮关掉强增强并加 L1 损失、EMA、
SGD（BN 和偏置不做权重衰减）、预热后余弦下降、多尺度训练。
"""

from __future__ import annotations

import math
import random
from pathlib import Path

import torch
import torch.nn.functional as F
import torchvision

from .i18n import tr
from .protocol import log
from .yolox import YOLOPAFPN, YOLOX, YOLOXHead, ModelEMA

# 预训练权重：官方 GitHub release 0.1.1rc0（Apache-2.0，COCO 训练）。先试官网镜像，再试 GitHub
WEIGHT_URLS = (
    "https://wulabel.xiaowuiot.com/models/yolox/{}",
    "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/{}",
)

# 和官方 exps/default 下的配置一致
SPECS = {
    "yolox_nano": {"depth": 0.33, "width": 0.25, "depthwise": True, "size": 416, "file": "yolox_nano.pth",
                   "mixup": False, "mosaic_scale": (0.5, 1.5), "mosaic_prob": 0.5},
    "yolox_tiny": {"depth": 0.33, "width": 0.375, "depthwise": False, "size": 416, "file": "yolox_tiny.pth",
                   "mixup": False, "mosaic_scale": (0.5, 1.5), "mosaic_prob": 1.0},
    "yolox_s": {"depth": 0.33, "width": 0.50, "depthwise": False, "size": 640, "file": "yolox_s.pth",
                "mixup": True, "mosaic_scale": (0.1, 2.0), "mosaic_prob": 1.0},
    "yolox_m": {"depth": 0.67, "width": 0.75, "depthwise": False, "size": 640, "file": "yolox_m.pth",
                "mixup": True, "mosaic_scale": (0.1, 2.0), "mosaic_prob": 1.0},
    "yolox_l": {"depth": 1.0, "width": 1.0, "depthwise": False, "size": 640, "file": "yolox_l.pth",
                "mixup": True, "mosaic_scale": (0.1, 2.0), "mosaic_prob": 1.0},
}

PAD = 114.0


def is_yolox(key: str) -> bool:
    return key in SPECS


def default_size(key: str) -> int:
    return SPECS[key]["size"]


def build_net(key: str, num_classes: int) -> YOLOX:
    s = SPECS[key]
    in_channels = [256, 512, 1024]
    backbone = YOLOPAFPN(s["depth"], s["width"], in_channels=in_channels, act="silu", depthwise=s["depthwise"])
    head = YOLOXHead(num_classes, s["width"], in_channels=in_channels, act="silu", depthwise=s["depthwise"])
    net = YOLOX(backbone, head)
    for m in net.modules():
        if isinstance(m, torch.nn.BatchNorm2d):
            m.eps = 1e-3
            m.momentum = 0.03
    net.head.initialize_biases(1e-2)
    return net


def _load_weights(url: str, name: str):
    return torch.hub.load_state_dict_from_url(url, map_location="cpu", progress=False, check_hash=False, file_name=name, weights_only=False)


def load_pretrained(net: YOLOX, key: str) -> bool:
    """加载 COCO 预训练权重；类别数不同的分类输出层跳过（重新学）"""
    name = SPECS[key]["file"]
    # 下载过的文件放在这里，已存在就不再下载。上次没下完整（断网、被代理截断）的文件会一直读不出来，得删掉重下
    cached = Path(torch.hub.get_dir()) / "checkpoints" / name
    for url in WEIGHT_URLS:
        try:
            try:
                ck = _load_weights(url.format(name), name)
            except Exception:
                if not cached.exists():
                    raise
                log(tr("本地的预训练权重文件损坏（{path}），删掉重新下载", path=cached))
                cached.unlink(missing_ok=True)
                ck = _load_weights(url.format(name), name)
            state = ck.get("model", ck)
            own = net.state_dict()
            keep = {k: v for k, v in state.items() if k in own and own[k].shape == v.shape}
            net.load_state_dict(keep, strict=False)
            log(tr("已加载 COCO 预训练权重（{name}，沿用 {keep}/{own} 组参数）", name=name, keep=len(keep), own=len(own)))
            return True
        except Exception as e:  # 多半是网络问题，换下一个地址
            cached.unlink(missing_ok=True)
            log(tr("下载预训练权重失败（{url}）：{e}", url=url.format(name), e=e))
    log(tr("没有可用的预训练权重，从头训练，效果会差很多"))
    return False


def _tracing() -> bool:
    return torch.jit.is_tracing() or torch.onnx.is_in_onnx_export()


class YoloxDetector(torch.nn.Module):
    """和 torchvision 检测模型同样用法的 YOLOX。

    推理时把每张图补边到正方形、缩放到 img_size，转成 YOLOX 要的 BGR 0~255，
    解码后按分数过滤、按类别 NMS，框换回原图像素。导出 ONNX 时这些都在模型里。
    """

    def __init__(self, net: YOLOX, num_classes: int, img_size: int):
        super().__init__()
        self.net = net
        self.num_classes = num_classes
        self.img_size = int(img_size)
        self.score_thresh = 0.01
        self.nms_thresh = 0.65
        self.max_det = 100

    def _prep(self, img: torch.Tensor):
        s = self.img_size
        if _tracing():
            hw = torch._shape_as_tensor(img)[-2:]
            side = hw.max()
            x = F.pad(img, [0, side - hw[1], 0, side - hw[0]], value=PAD / 255.0)
            r = s / side.to(torch.float32)
        else:
            h, w = int(img.shape[-2]), int(img.shape[-1])
            side = max(h, w)
            hw = (h, w)
            x = F.pad(img, [0, side - w, 0, side - h], value=PAD / 255.0)
            r = s / side
        x = F.interpolate(x[None], size=(s, s), mode="bilinear", align_corners=False)
        x = x[:, [2, 1, 0]] * 255.0  # RGB 0~1 → BGR 0~255
        return x, r, hw

    def _post(self, p: torch.Tensor, r, hw) -> dict:
        cx, cy, w, h = p[:, 0], p[:, 1], p[:, 2], p[:, 3]
        boxes = torch.stack([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], dim=1) / r
        cls_conf, cls_id = p[:, 5:].max(dim=1)
        scores = p[:, 4] * cls_conf
        keep = torch.where(scores > self.score_thresh)[0]
        boxes, scores, cls_id = boxes[keep], scores[keep], cls_id[keep]
        # 框限制在原图内（导出 ONNX 时宽高是张量，不能写成常数）
        if isinstance(hw[0], torch.Tensor):
            h_lim, w_lim = hw[0].to(boxes.dtype), hw[1].to(boxes.dtype)
        else:
            h_lim = torch.tensor(float(hw[0]), dtype=boxes.dtype, device=boxes.device)
            w_lim = torch.tensor(float(hw[1]), dtype=boxes.dtype, device=boxes.device)
        xs = torch.minimum(boxes[:, 0::2].clamp(min=0), w_lim)
        ys = torch.minimum(boxes[:, 1::2].clamp(min=0), h_lim)
        boxes = torch.stack([xs[:, 0], ys[:, 0], xs[:, 1], ys[:, 1]], dim=1)
        keep = torchvision.ops.batched_nms(boxes, scores, cls_id, self.nms_thresh)[: self.max_det]
        return {"boxes": boxes[keep], "labels": cls_id[keep] + 1, "scores": scores[keep]}

    def forward(self, images, targets=None):
        if self.training:
            raise RuntimeError(tr("YOLOX 训练走 YoloxTask，不经过这个包装"))
        prepped = [self._prep(img) for img in images]
        out = self.net(torch.cat([x for x, _, _ in prepped], dim=0))
        return [self._post(out[i], r, hw) for i, (_, r, hw) in enumerate(prepped)]


class NativeExport(torch.nn.Module):
    """YOLOX 官方格式：输入 [1,3,S,S] BGR 0~255（左上角对齐补 114），输出 [1, N, 5+类别数]（已解码：cx,cy,w,h,obj,各类别分数）"""

    def __init__(self, det: YoloxDetector):
        super().__init__()
        self.net = det.net

    def forward(self, x):
        return self.net(x)


def build(key: str, num_classes: int, img_size: int, pretrained: bool = True) -> YoloxDetector:
    net = build_net(key, num_classes)
    if pretrained:
        load_pretrained(net, key)
    return YoloxDetector(net, num_classes, img_size)


def class_heads() -> list[str]:
    return ["net.head.cls_preds."]


# ---------- 训练 ----------


class YoloxTask:
    """train.run 用的任务对象：训练集带 YOLOX 增强，评估集和其他检测模型一样（经过包装推理）"""

    def __init__(self, cfg: dict, root, key: str, epochs: int):
        from .data import CocoDetection, has_split
        from .yolox_data import YoloxTrainSet

        self.root = root
        self.key = key
        self.spec = SPECS[key]
        self.aug = cfg.get("aug")
        self.size = int(cfg.get("img_size") or self.spec["size"])
        self._coco = CocoDetection
        self._has_split = has_split
        self._train_cls = YoloxTrainSet
        self.train_set = None
        self.epochs = epochs
        # 最后几轮关掉强增强、加 L1 损失（官方 300 轮里最后 15 轮）
        self.no_aug_epochs = min(15, max(1, round(epochs * 0.1))) if epochs > 1 else 0
        self.warmup_epochs = min(5, max(1, epochs // 10))
        self.clip = None  # 官方不裁剪梯度
        self.ema = None
        self._it = 0
        self._cur = self.size
        # 多尺度：每 10 步在训练尺寸 ±5 档（每档 32）里随机换一个，和官方 s/m/l 的做法一样
        lo, hi = max(160, self.size - 5 * 32), self.size + 5 * 32
        self._sizes = list(range(lo // 32 * 32, hi + 1, 32)) or [self.size]

    def dataset(self, split: str, train: bool):
        if train:
            self.train_set = self._train_cls(self.root, self.size, self.aug, self.spec)
            return self.train_set
        return self._coco(self.root, split, train=False)

    def has_split(self, split: str) -> bool:
        return self._has_split(self.root, split)

    def collate(self, batch):
        imgs, labels = zip(*batch)
        return torch.stack(imgs), torch.stack(labels)

    def optimizer(self, model: YoloxDetector, lr: float, batch: int):
        """BN 权重、偏置不做权重衰减；学习率按批大小缩放（界面上的学习率当作批大小 64 时的值）"""
        pg0, pg1, pg2 = [], [], []
        for name, m in model.net.named_modules():
            if hasattr(m, "bias") and isinstance(m.bias, torch.nn.Parameter):
                pg2.append(m.bias)
            if isinstance(m, torch.nn.BatchNorm2d) or "bn" in name:
                pg0.append(m.weight)
            elif hasattr(m, "weight") and isinstance(m.weight, torch.nn.Parameter):
                pg1.append(m.weight)
        base = lr * batch / 64.0
        opt = torch.optim.SGD(pg0, lr=base, momentum=0.9, nesterov=True)
        opt.add_param_group({"params": pg1, "weight_decay": 5e-4})
        opt.add_param_group({"params": pg2})
        return opt, pg0 + pg1 + pg2

    def lr_factor(self, iters_per_epoch: int, total: int):
        warmup = self.warmup_epochs * iters_per_epoch
        no_aug = self.no_aug_epochs * iters_per_epoch
        min_ratio = 0.05

        def f(it: int) -> float:
            if it < warmup:
                return max((it / max(warmup, 1)) ** 2, 1e-4)
            if it >= total - no_aug:
                return min_ratio
            p = (it - warmup) / max(total - warmup - no_aug, 1)
            return min_ratio + (1 - min_ratio) * 0.5 * (1 + math.cos(math.pi * p))

        return f

    def on_model(self, model: YoloxDetector):
        self.ema = ModelEMA(model, 0.9998)

    def on_epoch(self, epoch: int, model: YoloxDetector):
        if self.no_aug_epochs and epoch == self.epochs - self.no_aug_epochs + 1:
            log(tr("最后 {n} 轮：关掉 Mosaic / MixUp，加上 L1 损失", n=self.no_aug_epochs))
            if self.train_set is not None:
                self.train_set.close()
            model.net.head.use_l1 = True

    def after_step(self, model: YoloxDetector):
        if self.ema is not None:
            self.ema.update(model)

    def eval_model(self, model: YoloxDetector) -> YoloxDetector:
        return self.ema.ema if self.ema is not None else model

    def loss(self, model: YoloxDetector, batch, device):
        imgs, targets = batch
        imgs = imgs.to(device, non_blocking=True)
        targets = targets.to(device)
        if self._it % 10 == 0:
            self._cur = random.choice(self._sizes)
        self._it += 1
        if self._cur != imgs.shape[-1]:
            scale = self._cur / imgs.shape[-1]
            imgs = F.interpolate(imgs, size=(self._cur, self._cur), mode="bilinear", align_corners=False)
            targets = targets.clone()
            targets[..., 1:] *= scale
        # 模型在 train() 状态，包装的 forward 不处理训练，直接调 YOLOX
        return model.net(imgs, targets)["total_loss"]

    def evaluate(self, model, ds, device, batch, n_classes, thresholds: bool = False):
        from .metrics import evaluate, threshold_curve
        from .train import predict_dataset

        preds, gts = predict_dataset(model, ds, device, batch)
        r = evaluate(preds, gts, n_classes)
        if thresholds:
            r.thresholds = threshold_curve(preds, gts, n_classes)
        return r

    def save_extra(self) -> dict:
        return {"engine": "yolox"}
