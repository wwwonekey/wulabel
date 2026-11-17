<div align="center">

# Wulabel（小物标注）

**离线 AI 标注训练桌面软件**

导入数据 → 标注 → 训练 → 评估 → 用模型预标注 → 导出部署，一个软件走完

[官网](https://wulabel.xiaowuiot.com) · [下载](#下载) · [使用教程](https://wulabel.xiaowuiot.com/guide.html) · [版本历史](#版本历史) · [交流群](https://wulabel.xiaowuiot.com/#contact)

[![最新版本](https://img.shields.io/github/v/release/xiaowu-iot/wulabel?label=%E6%9C%80%E6%96%B0%E7%89%88%E6%9C%AC)](https://github.com/xiaowu-iot/wulabel/releases)
[![许可证](https://img.shields.io/badge/%E8%AE%B8%E5%8F%AF%E8%AF%81-Apache--2.0-blue)](LICENSE)
[![平台](https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-Windows%20%7C%20macOS-lightgrey)](#下载)

</div>

## 亮点

- **完全离线**：图片、标注、模型都在你自己的电脑上，数据不出本机
- **装好就能训**：一键安装训练环境，自动识别显卡、选 PyTorch 版本，支持国内镜像
- **四种任务**：目标检测、实例分割、图像分类、关键点
- **YOLO 系列训练**：YOLOX Nano / Tiny / S / M / L，另有 Faster R-CNN、RetinaNet、Mask R-CNN 等
- **越标越快**：SAM 点一下出轮廓、文本提示自动找目标；标一小批就训练，再用训出的模型预标注剩下的图
- **团队协作**：成员用浏览器就能一起标，分配任务、审核打回、计件统计
- **部署到现场**：ONNX、OpenVINO、TensorRT、RKNN，一键生成推理服务包
- **放心商用**：Apache-2.0 开源，内置模型只用 BSD / Apache 许可的代码和权重（torchvision、YOLOX）

## 下载

最新版 **v0.3.0**（Windows 10 / 11 64 位、macOS 11 及以上，Mac 版 Apple 芯片和 Intel 通用）：

| 系统 | 官网下载（国内推荐） | GitHub 下载 |
|---|---|---|
| Windows | [Wulabel_0.3.0_x64-setup.exe](https://wulabel.xiaowuiot.com/download/Wulabel_0.3.0_x64-setup.exe) | [Wulabel_0.3.0_x64-setup.exe](https://github.com/xiaowu-iot/wulabel/releases/download/v0.3.0/Wulabel_0.3.0_x64-setup.exe) |
| macOS | [Wulabel_0.3.0_universal.dmg](https://wulabel.xiaowuiot.com/download/Wulabel_0.3.0_universal.dmg) | [Wulabel_0.3.0_universal.dmg](https://github.com/xiaowu-iot/wulabel/releases/download/v0.3.0/Wulabel_0.3.0_universal.dmg) |

历史版本：[GitHub Releases](https://github.com/xiaowu-iot/wulabel/releases) · [Gitee 发行版](https://gitee.com/xiaowu-iot/wulabel/releases) · [官网](https://wulabel.xiaowuiot.com/#download)

**第一次安装**

- **Windows**：双击安装。弹出「Windows 已保护你的电脑」时，点「更多信息」→「仍要运行」（安装包还没有代码签名）。
- **macOS**：打开 .dmg，把 Wulabel 拖进「应用程序」。提示「无法验证开发者」时，在「应用程序」里右键 Wulabel →「打开」；macOS 15 以后到「系统设置 → 隐私与安全性」点「仍要打开」。提示「已损坏」的话，在终端执行 `xattr -cr /Applications/Wulabel.app`。
- 装好后到「设置」页点「一键安装训练环境」。只标注、不训练可以跳过。

## 功能一览

- **数据**：导入图片、文件夹，自动去重和摆正方向；视频抽帧、RTSP / 直播流边采边入库；导入 YOLO / COCO / VOC / 分类文件夹数据集（自动识别格式）；划分训练、验证、测试集；图片质量筛查；挑出最值得先标的图；导出时可给人脸、车牌打码
- **标注**：矩形框、多边形、分类、关键点；1–9 快捷切换类别；撤销重做、复制上一张；视频帧关键帧插值、自动跟踪
- **AI 辅助**：SAM 点选出轮廓；文本提示自动找目标；巡瞳 AI 平台识别（专用模型、按项目类别识别、和 AI 聊识别规则）；自己训练的模型预标注（单张或批量）
- **数据体检**：规则检查：极小框、重复框、重复图片、类别不均衡；模型检查：疑似漏标、标错类别、框不准、多余框，一键去改
- **数据集版本**：把标注存成快照，对比、导出、用某个版本训练、恢复
- **训练**：检测：YOLOX（Nano / Tiny / S / M / L）、Faster R-CNN、RetinaNet、FCOS、SSDLite；分割：Mask R-CNN；关键点：Keypoint R-CNN；分类：MobileNetV3、EfficientNet、ResNet50。数据增强、接着训练、训练对比；导入别处训好的 ONNX 模型（YOLOv5 / v8 / v11、YOLOX、RT-DETR 等）做预标注和评估
- **评估**：mAP、精确率、召回率（分类看准确率、F1）；各类别指标、混淆矩阵、错例浏览；阈值推荐；误报测试；导出交付报告
- **部署**：接摄像头实时验证；导出 ONNX、OpenVINO、TensorRT / RKNN 转换包；生成推理服务包（多路拉流、告警规则、Webhook / MQTT 推送）；上传巡瞳 AI 平台
- **团队协作**：实时协作：你的电脑当主机，成员用浏览器登录就能标，局域网或在线都行；角色、分配任务、按张加锁、审核打回、工作量统计、水印。离线分包：分成几个标注包，标完合并回来
- **设置**：训练环境一键安装、下载源、使用已有 Python 环境、巡瞳 AI 账号、检查更新

已知限制：分割、关键点模型暂不支持导出部署（可以在软件里预标注）；分割、关键点的评估按目标框计算指标。

## 版本历史

| 版本 | 日期 | 主要内容 |
|---|---|---|
| [v0.3.0](https://github.com/xiaowu-iot/wulabel/releases/tag/v0.3.0) | 2026-11-17 | 新增 YOLO 系列训练：YOLOX Nano / Tiny / S / M / L，官方数据增强和 COCO 预训练权重，可导出 ONNX / OpenVINO / TensorRT / RKNN、上传巡瞳 |
| [v0.2.1](https://github.com/xiaowu-iot/wulabel/releases/tag/v0.2.1) | 2026-11-12 | 检查更新；标注页缩略图条可拖动调整大小；Windows 安装界面改为中文 |
| [v0.2.0](https://github.com/xiaowu-iot/wulabel/releases/tag/v0.2.0) | 2026-11-10 | 首个 Mac 版；实例分割、分类、关键点；SAM、文本提示、巡瞳 AI 辅助标注；视频抽帧和跟踪；数据集版本、训练对比；单阶段检测模型；实时多人协作；巡瞳平台对接 |
| [v0.1.0](https://github.com/xiaowu-iot/wulabel/releases/tag/v0.1.0) | 2026-11-09 | 首个版本：目标检测的标注、训练、评估、模型预标注、导出 |

## 文档

| 文档 | 说明 |
|---|---|
| [使用教程](docs/使用教程.md) | 从安装到部署的快速上手（[在线版](https://wulabel.xiaowuiot.com/guide.html)） |
| [使用教程（详细版）](docs/使用教程-详细版.md) | 每个页面、每个按钮的详细说明 |
| [巡瞳平台对接接口](docs/巡瞳平台对接接口.md) | 和巡瞳 AI 平台对接用到的接口 |
| [打包发布](docs/打包发布.md) | 打安装包、自动打包、发布新版本的步骤 |
| [反馈服务](server/feedback/) | 软件内「反馈」、检查更新、使用统计的服务端，可以自己部署 |
| [协作中转](relay/README.md) | 在线协作用的中转服务，可以自己部署 |

## 开发

需要 Node.js 20+、Rust（stable）；Windows 上还需要 Visual Studio C++ 生成工具和 WebView2。

```bash
cd apps/desktop
npm install
npm run tauri dev      # 开发运行
npm run tauri build    # 打安装包
```

测试：

```bash
# Rust 单元测试
cd apps/desktop/src-tauri
cargo test

# 训练全流程集成测试（需要装有 torch 的 Python）
XLABEL_TEST_PYTHON=/path/to/python cargo test end_to_end -- --nocapture

# Python 测试：指标单元测试 + YOLOX 冒烟测试（CPU 上训练、导出、onnxruntime 验证）
cd worker
python -m unittest discover -s tests
```

GitHub Actions：`release` 推送 `v*` 标签时打 Windows 和 Mac 安装包；`build` 手动运行，只打测试包；`worker-test` 改了 worker 代码时自动跑 Python 测试。

## 目录结构

```
apps/desktop/                桌面端（Tauri 2）
├─ src/                      React 前端
│  ├─ pages/                 项目、数据、标注、体检、训练、评估、部署、协作、设置
│  └─ components/            标注画布、导出、数据集版本、训练对比、巡瞳、反馈等
└─ src-tauri/src/            Rust 核心
   ├─ project.rs / db.rs     项目、SQLite 表结构与迁移
   ├─ images.rs / video.rs   图片导入、缩略图；视频和视频流抽帧（ffmpeg）
   ├─ annotations.rs         标注、类别、图片状态
   ├─ keypoints.rs           关键点模板
   ├─ track.rs               视频帧关键帧插值、跟踪
   ├─ dataset.rs             数据集划分与导出
   ├─ dataset_import.rs      YOLO / COCO / VOC / 分类文件夹导入
   ├─ versions.rs            数据集版本
   ├─ health.rs / quality.rs 数据体检、图片质量筛查
   ├─ runtime.rs             训练环境：显卡检测、PyTorch 安装
   ├─ training.rs            训练任务、推理服务（预标注）、ONNX 导出
   ├─ evaltools.rs           导入外部模型、重新评估、误报测试
   ├─ report.rs              交付报告
   ├─ deploy.rs              实时验证、多格式导出、推理服务包
   ├─ assist.rs / ai.rs      SAM、文本提示；巡瞳 AI 辅助标注
   ├─ xuntong.rs             巡瞳平台对接（上传模型、拉告警图）
   ├─ share.rs / tunnel.rs   实时协作主机、在线中转连接
   ├─ team.rs / collab.rs    成员、分配、审核；离线分包与合并
   ├─ feedback.rs / update.rs  软件内反馈、检查更新
   └─ commands.rs            前端调用的命令
worker/                      Python 训练与推理进程（随安装包分发）
├─ xlabel_worker/
│  ├─ train.py               训练与评估
│  ├─ models.py              内置模型列表
│  ├─ yolox_det.py           YOLOX 接入：规格、预训练权重、推理、训练
│  ├─ yolox_data.py          YOLOX 数据增强（Mosaic、MixUp 等）
│  ├─ yolox/                 YOLOX 模型代码（摘自官方仓库，Apache-2.0，见 NOTICE）
│  ├─ data.py / augment.py   数据集读取、数据增强
│  ├─ serve.py               常驻推理服务（预标注、SAM、文本提示）
│  ├─ assist.py              SAM、开放词汇检测
│  ├─ evaluate.py / metrics.py  评估、mAP 和混淆矩阵
│  ├─ fptest.py              误报测试
│  ├─ onnx_model.py          外部 ONNX 模型推理
│  ├─ export.py              导出 ONNX / OpenVINO、TensorRT / RKNN 转换包
│  ├─ live.py                实时验证
│  └─ anonymize.py           导出时打码
├─ service/                  推理服务包模板（只依赖 onnxruntime + OpenCV）
└─ tests/                    Python 测试
relay/                       在线协作中转服务
server/                      反馈服务、部署示例
docs/                        使用教程、对接接口、打包发布
```

桌面端和 worker 之间通过标准输入输出逐行传 JSON，不开端口。

## 项目文件格式

```
我的项目/
├─ project.json      项目名、任务类型
├─ annotations.db    SQLite：图片、类别、标注、关键点模板、数据集版本、训练记录
├─ images/           复制模式导入的图片；stream_*/ 是视频流采集的帧
├─ runs/<时间>/      每次训练：dataset/、best.pt、last.pt、metrics.jsonl、eval.json、log.txt、model.onnx
└─ .cache/thumbs/    缩略图（可删除，会自动重建）
```

## 许可证

[Apache-2.0](LICENSE)。第三方代码（YOLOX，Apache-2.0）见 [NOTICE](NOTICE)。

作者：小物学长。使用问题、功能建议欢迎提 [Issue](https://github.com/xiaowu-iot/wulabel/issues)，或到[官网](https://wulabel.xiaowuiot.com/#contact)找作者、进交流群。
