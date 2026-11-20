import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Dropdown, Empty, Input, InputNumber, Modal, Pagination, Progress, Segmented, Tag, Tooltip } from "antd";
import {
  AimOutlined,
  CheckSquareOutlined,
  EyeInvisibleOutlined,
  ClearOutlined,
  CloudDownloadOutlined,
  HistoryOutlined,
  DatabaseOutlined,
  DownOutlined,
  ExportOutlined,
  FileImageOutlined,
  FolderAddOutlined,
  LinkOutlined,
  RollbackOutlined,
  TeamOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  api,
  errText,
  ImageItem,
  ImageStatus,
  ImportProgress,
  ImportResult,
  LastImport,
  ProjectInfo,
  StreamFrames,
  StreamInfo,
  thumbUrl,
  VideoProgress,
} from "../api";
import { prefs, useApp } from "../store";
import { t } from "../i18n";
import ImageViewer from "../components/ImageViewer";
import ExportModal from "../components/ExportModal";
import VersionsModal from "../components/VersionsModal";
import { PickModal, QualityModal } from "../components/DataTools";
import CollabModal from "../components/CollabModal";
import { XuntongPullModal } from "../components/Xuntong";

const PAGE_SIZE = 120;
const IMAGE_EXTS = ["jpg", "jpeg", "png", "bmp", "webp", "tif", "tiff"];
const VIDEO_EXTS = ["mp4", "mov", "mkv", "avi", "webm", "flv", "wmv", "m4v", "ts"];

const STATUS: Record<ImageStatus, { text: string; color?: string }> = {
  todo: { text: t("未标注") },
  labeled: { text: t("已标注"), color: "processing" },
  reviewed: { text: t("已审核"), color: "success" },
  skipped: { text: t("已跳过"), color: "default" },
};

const FILTERS = [
  { label: t("全部"), value: "all" },
  { label: t("未标注"), value: "todo" },
  { label: t("已标注"), value: "labeled" },
  { label: t("已审核"), value: "reviewed" },
];

export default function Data({ project }: { project: ProjectInfo }) {
  const { message, modal } = App.useApp();
  const refreshStats = useApp((s) => s.refreshStats);
  const annotateImage = useApp((s) => s.annotateImage);
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ImageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [copyMode, setCopyMode] = useState(prefs.get("copyMode", "copy"));
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [dragging, setDragging] = useState(false);
  const importing = useRef(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [last, setLast] = useState<LastImport | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [showQuality, setShowQuality] = useState(false);
  const [showPick, setShowPick] = useState(false);
  const [showCollab, setShowCollab] = useState(false);
  const [videoPaths, setVideoPaths] = useState<string[]>([]);
  const [videoEvery, setVideoEvery] = useState(Number(prefs.get("videoEvery", "1")));
  const [videoMax, setVideoMax] = useState(Number(prefs.get("videoMax", "0")));
  const [videoProgress, setVideoProgress] = useState<VideoProgress | null>(null);
  const [streamOpen, setStreamOpen] = useState(false);
  const [xtOpen, setXtOpen] = useState(false);
  const [streamUrl, setStreamUrl] = useState(prefs.get("streamUrl", ""));
  const [streamInfo, setStreamInfo] = useState<StreamInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [streamEvery, setStreamEvery] = useState(Number(prefs.get("streamEvery", "1")));
  const [streamMax, setStreamMax] = useState(Number(prefs.get("streamMax", "200")));
  const [streamMinutes, setStreamMinutes] = useState(Number(prefs.get("streamMinutes", "5")));
  const [streamDedup, setStreamDedup] = useState(prefs.get("streamDedup", "0") === "1");
  const [streamRunning, setStreamRunning] = useState(false);
  const [streamMin, setStreamMin] = useState(false);
  const [streamIds, setStreamIds] = useState<number[]>([]); // 最近入库的帧（最新的在后）
  const [streamSaved, setStreamSaved] = useState(0);
  const [streamDir, setStreamDir] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.listImages(filter, (page - 1) * PAGE_SIZE, PAGE_SIZE);
      // 删除后当前页可能空了，退回上一页
      if (r.items.length === 0 && page > 1) {
        setPage(page - 1);
        return;
      }
      setItems(r.items);
      setTotal(r.total);
      setLast(await api.lastImport());
    } catch (e) {
      message.error(errText(e));
    }
  }, [filter, page, message]);
  // 采集过程中的事件回调里总是调用最新的 load（翻页、筛选变了也对）
  const loadRef = useRef(load);
  loadRef.current = load;

  const afterDelete = async (n: number) => {
    message.success(t("已删除 {n} 张图片", { n }));
    setSelected(new Set());
    setSelecting(false);
    await load();
    await refreshStats();
  };

  const confirmDelete = (title: string, scope: "ids" | "last" | "all", ids?: number[]) => {
    modal.confirm({
      title,
      content: t("图片的标注会一起删除，无法恢复。复制进项目的图片副本会删掉，你电脑上的原图不受影响。"),
      okText: t("删除"),
      okButtonProps: { danger: true },
      cancelText: t("取消"),
      onOk: async () => {
        try {
          await afterDelete(await api.deleteImages(scope, ids));
        } catch (e) {
          message.error(errText(e));
        }
      },
    });
  };

  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  useEffect(() => {
    load();
  }, [load]);

  const showResult = useCallback(
    (r: ImportResult) => {
      const text = r.duplicated
        ? t("新增 {added} 张，跳过重复 {dup} 张", { added: r.added, dup: r.duplicated })
        : t("新增 {added} 张", { added: r.added });
      if (r.failed.length === 0) {
        message.success(text);
        return;
      }
      modal.warning({
        title: t("{text}，{n} 张读取失败", { text, n: r.failed.length }),
        width: 640,
        content: (
          <div style={{ maxHeight: 300, overflow: "auto", fontSize: 12 }}>
            {r.failed.map((f) => (
              <div key={f}>{f}</div>
            ))}
          </div>
        ),
      });
    },
    [message, modal],
  );

  const runImport = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0 || importing.current) return;
      importing.current = true;
      setProgress({ done: 0, total: 0 });
      const unlisten = await listen<ImportProgress>("import-progress", (e) => setProgress(e.payload));
      try {
        const r = await api.importImages(paths, prefs.get("copyMode", "copy") === "copy");
        showResult(r);
        await load();
        await refreshStats();
      } catch (e) {
        message.error(errText(e));
      } finally {
        unlisten();
        setProgress(null);
        importing.current = false;
      }
    },
    [load, refreshStats, showResult, message],
  );

  // 从资源管理器拖文件或文件夹进来导入
  useEffect(() => {
    const p = getCurrentWebview().onDragDropEvent((e) => {
      const ty = e.payload.type;
      if (ty === "enter" || ty === "over") setDragging(true);
      else if (ty === "leave") setDragging(false);
      else if (ty === "drop") {
        setDragging(false);
        runImport(e.payload.paths);
      }
    });
    return () => {
      p.then((un) => un());
    };
  }, [runImport]);

  const pickDataset = async () => {
    const dir = await open({
      directory: true,
      title: project.task === "classify" ? t("选择分类数据集文件夹（每个类别一个子文件夹）") : t("选择数据集文件夹（YOLO / COCO / VOC）"),
    });
    if (typeof dir !== "string" || importing.current) return;
    importing.current = true;
    setProgress({ done: 0, total: 0 });
    const unlisten = await listen<ImportProgress>("import-progress", (e) => setProgress(e.payload));
    try {
      const r = await api.importDataset(dir);
      await load();
      await refreshStats();
      modal.success({
        title: t("已导入 {format} 数据集", { format: r.format }),
        width: 520,
        content: (
          <div>
            <div>
              {t("{images} 张图片：新增 {added}，重复 {dup}；导入 {boxes} 个标注（{format}）", {
                images: r.images,
                added: r.added,
                dup: r.duplicated,
                boxes: r.boxes,
                format: r.format,
              })}
            </div>
            {r.labelsAdded.length > 0 && <div className="muted">{t("新增类别：{list}", { list: r.labelsAdded.join(t("、")) })}</div>}
            {r.keptExisting > 0 && <div className="muted">{t("{n} 张重复图片已有标注，保留原标注", { n: r.keptExisting })}</div>}
            {r.failed.length > 0 && <div style={{ color: "var(--warn)" }}>{t("{n} 张读取失败", { n: r.failed.length })}</div>}
          </div>
        ),
      });
    } catch (e) {
      message.error(errText(e));
    } finally {
      unlisten();
      setProgress(null);
      importing.current = false;
    }
  };

  const pickFiles = async () => {
    const r = await open({
      multiple: true,
      title: t("选择图片"),
      filters: [{ name: t("图片"), extensions: IMAGE_EXTS }],
    });
    if (r) runImport(Array.isArray(r) ? r : [r]);
  };

  const pickFolder = async () => {
    const r = await open({ directory: true, multiple: true, title: t("选择图片文件夹（含子文件夹）") });
    if (r) runImport(Array.isArray(r) ? r : [r]);
  };

  const pickVideos = async () => {
    const r = await open({
      multiple: true,
      title: t("选择视频（会抽成图片导入）"),
      filters: [{ name: t("视频"), extensions: VIDEO_EXTS }],
    });
    if (!r) return;
    setVideoPaths(Array.isArray(r) ? r : [r]);
  };

  const startExtract = async () => {
    if (videoPaths.length === 0 || importing.current) return;
    const paths = videoPaths;
    const every = videoEvery;
    const max = videoMax;
    setVideoPaths([]);
    prefs.set("videoEvery", String(every));
    prefs.set("videoMax", String(max));
    importing.current = true;
    setVideoProgress({ stage: "extract", done: 0, total: 0, speed: 0, detail: t("准备中…") });
    const unlisten = await listen<VideoProgress>("video-progress", (e) => setVideoProgress(e.payload));
    try {
      const r = await api.extractVideo(paths, every, max);
      await load();
      await refreshStats();
      const text = r.duplicated
        ? t("从 {videos} 个视频抽出 {frames} 帧：新增 {added} 张，跳过重复 {dup} 张", {
            videos: r.videos,
            frames: r.frames,
            added: r.added,
            dup: r.duplicated,
          })
        : t("从 {videos} 个视频抽出 {frames} 帧：新增 {added} 张", { videos: r.videos, frames: r.frames, added: r.added });
      if (r.failed.length === 0) {
        message.success(text);
      } else {
        modal.warning({
          title: t("{text}，{n} 个处理失败", { text, n: r.failed.length }),
          width: 640,
          content: (
            <div style={{ maxHeight: 300, overflow: "auto", fontSize: 12 }}>
              {r.failed.map((f) => (
                <div key={f}>{f}</div>
              ))}
            </div>
          ),
        });
      }
    } catch (e) {
      message.error(errText(e));
    } finally {
      unlisten();
      setVideoProgress(null);
      importing.current = false;
    }
  };

  const fmtSecs = (d: number | null) =>
    d == null ? "—" : d < 60 ? t("{n} 秒", { n: Math.round(d) }) : t("{m} 分 {s} 秒", { m: Math.floor(d / 60), s: Math.round(d % 60) });

  const testStream = async () => {
    const url = streamUrl.trim();
    if (!url) return;
    setProbing(true);
    setStreamInfo(null);
    try {
      const info = await api.probeStream(url);
      setStreamInfo(info);
      if (info.isLive && streamMax === 0) setStreamMax(200);
    } catch (e) {
      message.error(errText(e));
    } finally {
      setProbing(false);
    }
  };

  const startStream = async () => {
    const url = streamUrl.trim();
    if (!url || importing.current) return;
    const every = streamEvery;
    const max = streamMax;
    const minutes = streamInfo && !streamInfo.isLive ? 0 : streamMinutes; // 回放不需要时长上限
    if (streamInfo?.isLive && max === 0 && minutes === 0) {
      message.warning(t("直播是无限流，请至少设一个上限：最多帧数，或最长采集时长"));
      return;
    }
    const dedup = streamDedup;
    prefs.set("streamUrl", url);
    prefs.set("streamEvery", String(every));
    prefs.set("streamMax", String(max));
    prefs.set("streamMinutes", String(minutes));
    prefs.set("streamDedup", dedup ? "1" : "0");
    setStreamOpen(false);
    setStreamMin(false);
    setStreamIds([]);
    setStreamSaved(0);
    setStreamDir(null);
    importing.current = true;
    setStreamRunning(true);
    setVideoProgress({ stage: "extract", done: 0, total: max, speed: 0, detail: t("连接中…") });
    const unlisten = await listen<VideoProgress>("video-progress", (e) => setVideoProgress(e.payload));
    // 边采边入库：弹框里显示最新的帧，后面的图片列表最多每 2 秒刷新一次
    let lastRefresh = 0;
    const unlistenFrames = await listen<StreamFrames>("stream-frames", (e) => {
      const { ids, dir } = e.payload;
      setStreamIds((prev) => [...prev, ...ids].slice(-12));
      setStreamSaved((n) => n + ids.length);
      setStreamDir(dir);
      const now = Date.now();
      if (now - lastRefresh > 2000) {
        lastRefresh = now;
        loadRef.current();
        refreshStats();
      }
    });
    try {
      const r = await api.extractStream(url, every, max, minutes, dedup);
      const text = r.duplicated
        ? t("采集完成：新增 {added} 张，跳过重复 {dup} 张", { added: r.added, dup: r.duplicated })
        : t("采集完成：新增 {added} 张", { added: r.added });
      const dir = r.dir;
      if (dir) {
        message.success({
          duration: 8,
          content: (
            <span>
              {t("{text}，保存在 {dir}", { text, dir: shortDir(dir) })} <a onClick={() => openDir(dir)}>{t("打开文件夹")}</a>
            </span>
          ),
        });
      } else {
        message.success(text);
      }
    } catch (e) {
      message.error(errText(e));
    } finally {
      unlisten();
      unlistenFrames();
      setVideoProgress(null);
      setStreamRunning(false);
      setStreamMin(false);
      importing.current = false;
      // 出错前可能已经入库了一部分，照样刷新
      await loadRef.current();
      await refreshStats();
    }
  };

  /** 绝对路径只显示项目里的那段：images/stream_xxx */
  const shortDir = (dir: string) => dir.split(/[\\/]/).slice(-2).join("/");

  const openDir = (dir: string) => {
    api.revealPath(dir).catch((e) => message.error(errText(e)));
  };

  const stopStream = async () => {
    try {
      await api.stopExtract();
    } catch (e) {
      message.error(errText(e));
    }
  };

  const s = project.stats;
  const pct = s.total ? Math.round(((s.labeled + s.reviewed) / s.total) * 100) : 0;

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <h1>{t("数据")}</h1>
          <p className="desc" style={{ margin: 0 }}>
            {t("{total} 张图片 · 已标注 {labeled} · 已审核 {reviewed}", { total: s.total, labeled: s.labeled + s.reviewed, reviewed: s.reviewed })}
          </p>
        </div>
        <div className="row">
          <Tooltip title={t("复制：图片拷进项目文件夹，项目可整体拷走；引用：只记录原路径，不占额外空间")}>
            <Segmented
              value={copyMode}
              onChange={(v) => {
                setCopyMode(v as string);
                prefs.set("copyMode", v as string);
              }}
              options={[
                { label: t("复制到项目"), value: "copy" },
                { label: t("只引用原路径"), value: "ref" },
              ]}
            />
          </Tooltip>
          <Button type="primary" icon={<FolderAddOutlined />} onClick={pickFolder}>
            {t("导入文件夹")}
          </Button>
          <Dropdown
            trigger={["click"]}
            menu={{
              items: [
                { key: "files", icon: <FileImageOutlined />, label: t("导入图片文件") },
                { key: "video", icon: <VideoCameraOutlined />, label: t("导入视频（抽帧）") },
                { key: "stream", icon: <LinkOutlined />, label: t("从视频流抽帧（RTSP / 直播 / 回放）") },
                {
                  key: "dataset",
                  icon: <DatabaseOutlined />,
                  label:
                    project.task === "classify"
                      ? t("导入分类数据集（每个类别一个文件夹）")
                      : project.task === "pose"
                        ? t("导入带标注的数据集（YOLO-pose / COCO 关键点）")
                        : t("导入带标注的数据集（YOLO / COCO / VOC）"),
                },
                ...(project.task === "classify" ? [] : [{ key: "xuntong", icon: <CloudDownloadOutlined />, label: t("从巡瞳 AI 拉取告警图片") }]),
              ],
              onClick: ({ key }) => {
                if (key === "files") pickFiles();
                else if (key === "video") pickVideos();
                else if (key === "stream") setStreamOpen(true);
                else if (key === "xuntong") setXtOpen(true);
                else pickDataset();
              },
            }}
          >
            <Button>
              {t("更多导入")} <DownOutlined />
            </Button>
          </Dropdown>
          <Button icon={<ExportOutlined />} disabled={s.labeled + s.reviewed === 0} onClick={() => setShowExport(true)}>
            {t("导出数据集")}
          </Button>
          <Dropdown
            trigger={["click"]}
            disabled={s.total === 0}
            menu={{
              items: [
                {
                  key: "last",
                  icon: <RollbackOutlined />,
                  label: last ? t("撤销上次导入（{n} 张）", { n: last.count }) : t("撤销上次导入"),
                  disabled: !last,
                },
                { key: "versions", icon: <HistoryOutlined />, label: t("数据集版本（保存快照、对比、恢复）") },
                { key: "quality", icon: <EyeInvisibleOutlined />, label: t("图片质量筛查（模糊、过暗、过曝）") },
                { key: "pick", icon: <AimOutlined />, label: t("挑选最值得标的图（用模型）") },
                { key: "collab", icon: <TeamOutlined />, label: t("多人协作（分包、合并回来）") },
                { key: "select", icon: <CheckSquareOutlined />, label: t("选择图片删除") },
                { type: "divider" },
                { key: "all", icon: <ClearOutlined />, label: t("清空全部图片（{n} 张）", { n: s.total }), danger: true },
              ],
              onClick: ({ key }) => {
                if (key === "last" && last) confirmDelete(t("撤销上次导入，删除这 {n} 张图片？", { n: last.count }), "last");
                if (key === "versions") setShowVersions(true);
                if (key === "quality") setShowQuality(true);
                if (key === "pick") setShowPick(true);
                if (key === "collab") setShowCollab(true);
                if (key === "select") {
                  setSelecting(true);
                  setSelected(new Set());
                }
                if (key === "all") confirmDelete(t("清空项目里全部 {n} 张图片？", { n: s.total }), "all");
              },
            }}
          >
            <Button>
              {t("管理")} <DownOutlined />
            </Button>
          </Dropdown>
        </div>
      </div>

      <div className="cards" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 14 }}>
        <div className="card">
          <div className="muted">{t("标注进度")}</div>
          <div className="kpi">{pct}%</div>
          <Progress percent={pct} showInfo={false} size="small" />
        </div>
        <div className="card">
          <div className="muted">{t("未标注")}</div>
          <div className="kpi">{s.todo}</div>
        </div>
        <div className="card">
          <div className="muted">{t("已标注")}</div>
          <div className="kpi">{s.labeled}</div>
        </div>
        <div className="card">
          <div className="muted">{t("已审核")}</div>
          <div className="kpi">{s.reviewed}</div>
        </div>
      </div>

      <div className="row" style={{ marginBottom: 12, justifyContent: "space-between" }}>
        <Segmented
          value={filter}
          options={FILTERS}
          onChange={(v) => {
            setFilter(v as string);
            setPage(1);
          }}
        />
        {selecting ? (
          <div className="row" style={{ gap: 8 }}>
            <span>{t("已选 {n} 张", { n: selected.size })}</span>
            <Button size="small" onClick={() => setSelected(new Set([...selected, ...items.map((i) => i.id)]))}>
              {t("全选本页")}
            </Button>
            <Button size="small" onClick={() => setSelected(new Set())}>
              {t("清除选择")}
            </Button>
            <Button
              size="small"
              danger
              type="primary"
              disabled={selected.size === 0}
              onClick={() => confirmDelete(t("删除选中的 {n} 张图片？", { n: selected.size }), "ids", [...selected])}
            >
              {t("删除")}
            </Button>
            <Button size="small" onClick={() => setSelecting(false)}>
              {t("完成")}
            </Button>
          </div>
        ) : (
          <span className="dim">{t("也可以直接把图片或文件夹拖进窗口")}</span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="card" style={{ padding: 48 }}>
          <Empty description={s.total === 0 ? t("还没有图片，导入一些开始吧") : t("没有符合条件的图片")}>
            {s.total === 0 && (
              <Button type="primary" onClick={pickFolder}>
                {t("导入文件夹")}
              </Button>
            )}
          </Empty>
        </div>
      ) : (
        <>
          <div className="thumbs">
            {items.map((it, i) => (
              <div
                key={it.id}
                className={selecting && selected.has(it.id) ? "thumb picked" : "thumb"}
                onClick={() => (selecting ? toggle(it.id) : setViewIndex(i))}
                title={`${it.name}  ${it.width}×${it.height}`}
              >
                <img src={thumbUrl(project.path, it.id)} loading="lazy" alt={it.name} draggable={false} />
                {selecting && <Checkbox className="pick" checked={selected.has(it.id)} />}
                <Tag className="st" color={STATUS[it.status]?.color}>
                  {STATUS[it.status]?.text ?? it.status}
                </Tag>
                <span className="nm">{it.name}</span>
              </div>
            ))}
          </div>
          {total > PAGE_SIZE && (
            <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
              <Pagination current={page} pageSize={PAGE_SIZE} total={total} showSizeChanger={false} onChange={setPage} />
            </div>
          )}
        </>
      )}

      <ImageViewer
        projectPath={project.path}
        items={items}
        index={viewIndex}
        onIndex={setViewIndex}
        onAnnotate={(id) => {
          setViewIndex(null);
          annotateImage(id);
        }}
      />

      <ExportModal project={project} open={showExport} onClose={() => setShowExport(false)} />
      <XuntongPullModal
        open={xtOpen}
        onClose={() => setXtOpen(false)}
        onDone={() => {
          load();
          refreshStats();
        }}
      />
      <QualityModal project={project} open={showQuality} onClose={() => setShowQuality(false)} onChanged={load} />
      <PickModal project={project} open={showPick} onClose={() => setShowPick(false)} />
      <CollabModal
        project={project}
        open={showCollab}
        onClose={() => {
          setShowCollab(false);
          load();
        }}
      />
      <VersionsModal
        project={project}
        open={showVersions}
        onClose={() => {
          setShowVersions(false);
          load();
        }}
      />

      <Modal open={!!progress} closable={false} footer={null} maskClosable={false} title={t("正在导入")}>
        <Progress percent={progress && progress.total ? Math.floor((progress.done / progress.total) * 100) : 0} />
        <div className="muted">
          {progress && progress.total
            ? t("已处理 {done} / {total} 张（计算指纹、生成缩略图）", { done: progress.done, total: progress.total })
            : t("正在查找图片…")}
        </div>
      </Modal>

      <Modal
        open={videoPaths.length > 0}
        title={t("视频抽帧")}
        okText={t("开始抽帧")}
        cancelText={t("取消")}
        onOk={startExtract}
        onCancel={() => setVideoPaths([])}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          {t("选了 {n} 个视频，按下面的设置抽成图片导入项目。", { n: videoPaths.length })}
        </p>
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <span>{t("每隔")}</span>
          <InputNumber min={0.1} max={600} step={0.5} value={videoEvery} onChange={(v) => setVideoEvery(v ?? 1)} />
          <span>{t("秒抽 1 帧")}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span>{t("每个视频最多")}</span>
          <InputNumber min={0} max={100000} step={50} value={videoMax} onChange={(v) => setVideoMax(v ?? 0)} />
          <span>{t("帧（0 = 不限）")}</span>
        </div>
        <p className="dim" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          {t("首次使用会自动下载 ffmpeg（约 90MB），之后不再下载。抽出的帧会复制进项目，按内容自动去重。")}
        </p>
      </Modal>

      <Modal
        open={streamOpen}
        title={t("从视频流抽帧")}
        okText={t("开始采集")}
        cancelText={t("取消")}
        okButtonProps={{ disabled: !streamUrl.trim() }}
        onOk={startStream}
        onCancel={() => setStreamOpen(false)}
      >
        <p className="muted" style={{ marginTop: 0 }}>
          {t("支持 RTSP 摄像头 / 直播流,以及 http(s) 的回放、点播地址(mp4、m3u8、flv)。")}
        </p>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <Input
            placeholder={t("rtsp://…  或  https://…")}
            value={streamUrl}
            onChange={(e) => {
              setStreamUrl(e.target.value);
              setStreamInfo(null);
            }}
            onPressEnter={testStream}
          />
          <Button loading={probing} onClick={testStream}>
            {t("测试连接")}
          </Button>
        </div>
        {streamInfo && (
          <div style={{ fontSize: 12, marginBottom: 10, color: "var(--good, #2fb67c)" }}>
            ✓ {streamInfo.width}×{streamInfo.height} · {streamInfo.codec || t("视频")}
            {streamInfo.fps ? ` · ${streamInfo.fps.toFixed(0)} fps` : ""} ·{" "}
            {streamInfo.isLive ? t("直播流（无限，需设上限）") : t("回放流 · 时长 {d}", { d: fmtSecs(streamInfo.durationSecs) })}
          </div>
        )}
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <span>{t("每隔")}</span>
          <InputNumber min={0.1} max={600} step={0.5} value={streamEvery} onChange={(v) => setStreamEvery(v ?? 1)} />
          <span>{t("秒抽 1 帧")}</span>
        </div>
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <span>{t("最多抽")}</span>
          <InputNumber min={0} max={100000} step={50} value={streamMax} onChange={(v) => setStreamMax(v ?? 0)} />
          <span>{t("帧（0 = 不限）")}</span>
        </div>
        {(!streamInfo || streamInfo.isLive) && (
          <div className="row" style={{ gap: 8, marginBottom: 10 }}>
            <span>{t("最长采集")}</span>
            <InputNumber min={0} max={1440} step={1} value={streamMinutes} onChange={(v) => setStreamMinutes(v ?? 0)} />
            <span>{t("分钟（0 = 不限，仅直播）")}</span>
          </div>
        )}
        <Checkbox checked={streamDedup} onChange={(e) => setStreamDedup(e.target.checked)}>
          {t("跳过几乎相同的帧（画面静止时少存重复图）")}
        </Checkbox>
        <p className="dim" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          {t("图片边采边入库，保存在项目的 images/stream_地址_时间/ 文件夹里，采集时就能看到。直播是无限流，务必设「最多帧」或「最长时长」；中途停止也会保留已采的图。首次使用会自动下载 ffmpeg。")}
        </p>
      </Modal>

      <Modal
        open={!!videoProgress && !streamMin}
        closable={false}
        maskClosable={false}
        title={streamRunning ? t("正在采集视频流") : t("正在处理视频")}
        footer={
          streamRunning ? (
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <Button onClick={() => setStreamMin(true)}>{t("最小化")}</Button>
              <Button danger onClick={stopStream}>
                {t("停止采集")}
              </Button>
            </div>
          ) : null
        }
      >
        {videoProgress &&
          (() => {
            const vp = videoProgress;
            const pct = vp.total ? Math.floor((vp.done / vp.total) * 100) : 0;
            const text =
              vp.stage === "download"
                ? `${vp.detail} · ${(vp.done / 2 ** 20).toFixed(0)} / ${(vp.total / 2 ** 20).toFixed(0)} MB · ${(vp.speed / 2 ** 20).toFixed(1)} MB/s`
                : vp.stage === "extract"
                  ? streamRunning
                    ? vp.total
                      ? t("已采集 {done} 帧 / 上限 {total} · 已入库 {saved} 张", { done: vp.done, total: vp.total, saved: streamSaved })
                      : t("已采集 {done} 帧 · 已入库 {saved} 张", { done: vp.done, saved: streamSaved })
                    : vp.total
                      ? t("正在抽帧：{detail} · 已抽 {done} 帧 / 约 {total}", { detail: vp.detail, done: vp.done, total: vp.total })
                      : t("正在抽帧：{detail} · 已抽 {done} 帧", { detail: vp.detail, done: vp.done })
                  : t("正在导入 {done} / {total} 帧（生成缩略图）", { done: vp.done, total: vp.total });
            return (
              <>
                <Progress percent={pct} status="active" showInfo={vp.total > 0} />
                {streamRunning && vp.stage === "extract" && (
                  <div className="dim" style={{ fontSize: 12, wordBreak: "break-all" }}>
                    {vp.detail}
                  </div>
                )}
                <div className="muted">{text}</div>
                {streamRunning && vp.stage !== "download" && (
                  <>
                    <div className="stream-strip">
                      {streamIds.length === 0 ? (
                        <div className="dim" style={{ fontSize: 12 }}>
                          {t("等待第一帧…")}
                        </div>
                      ) : (
                        [...streamIds].reverse().map((id, i) => (
                          <img
                            key={id}
                            src={thumbUrl(project.path, id)}
                            alt=""
                            draggable={false}
                            className={i === 0 ? "newest" : undefined}
                          />
                        ))
                      )}
                    </div>
                    {streamDir && (
                      <div className="dim" style={{ fontSize: 12 }}>
                        {t("保存到项目 {dir}", { dir: shortDir(streamDir) })} <a onClick={() => openDir(streamDir)}>{t("打开文件夹")}</a>
                      </div>
                    )}
                  </>
                )}
              </>
            );
          })()}
      </Modal>

      {streamRunning && streamMin && videoProgress && (
        <div
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            zIndex: 1000,
            background: "var(--panel, #20242b)",
            border: "1px solid var(--border, #3a3f47)",
            borderRadius: 8,
            padding: "10px 14px",
            boxShadow: "0 4px 16px rgba(0,0,0,.35)",
            minWidth: 220,
          }}
        >
          <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
            {streamIds.length > 0 && (
              <img
                key={streamIds[streamIds.length - 1]}
                src={thumbUrl(project.path, streamIds[streamIds.length - 1])}
                alt=""
                draggable={false}
                style={{ width: 64, height: 48, objectFit: "cover", borderRadius: 4, flex: "none" }}
              />
            )}
            <div style={{ fontSize: 13 }}>
              {videoProgress.stage === "download"
                ? t("正在下载 ffmpeg…")
                : t("采集中 · 已抽 {n} 帧", { n: videoProgress.done })}
              <div className="dim" style={{ fontSize: 12 }}>
                {t("已入库 {n} 张", { n: streamSaved })}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
            <Button size="small" onClick={() => setStreamMin(false)}>
              {t("展开")}
            </Button>
            <Button size="small" danger onClick={stopStream}>
              {t("停止")}
            </Button>
          </div>
        </div>
      )}

      {dragging && (
        <div className="drop-mask">
          <div>
            {t("松开鼠标导入图片")}
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              {t("支持文件夹，会自动查找子文件夹里的图片")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
