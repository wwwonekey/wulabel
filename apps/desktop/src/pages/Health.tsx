import { useEffect, useMemo, useState } from "react";
import { Alert, App, Button, Empty, Progress, Select, Space, Tooltip } from "antd";
import { CheckOutlined, EyeInvisibleOutlined, FormOutlined, HeartOutlined, PlusOutlined } from "@ant-design/icons";
import { listen } from "@tauri-apps/api/event";
import { api, errText, HealthReport, Issue, IssueKind, ProjectInfo, RunInfo, thumbUrl } from "../api";
import { useApp } from "../store";
import { fmtTime } from "./Train";
import { t } from "../i18n";

type Filter = IssueKind | "dup_image";

const KINDS: { key: Filter; name: string; color: string; tip: string; model?: boolean }[] = [
  { key: "missing", name: t("疑似漏标"), color: "#e5534b", tip: t("模型很确定这里有目标，但没有标注"), model: true },
  { key: "wrong_class", name: t("疑似类别错"), color: "#e5534b", tip: t("框的位置对上了，但标注的类别和模型判断的不一样"), model: true },
  { key: "loose_box", name: t("框不准"), color: "#e7a33e", tip: t("类别一致，但框和模型预测的重合度低，可能画偏或大小不对"), model: true },
  { key: "extra_box", name: t("疑似多余框"), color: "#e7a33e", tip: t("标了框，但模型在这个位置什么都没看到"), model: true },
  { key: "tiny_box", name: t("极小框"), color: "#9b7bf2", tip: t("短边小于 8 像素，模型几乎学不到") },
  { key: "dup_box", name: t("重复框"), color: "#9b7bf2", tip: t("同一张图里同类别的两个框几乎完全重叠") },
  { key: "dup_image", name: t("重复图片"), color: "#3d8bfd", tip: t("画面几乎一样的图片，会让评估结果虚高") },
  { key: "no_label", name: t("无类别"), color: "#9aa1ab", tip: t("框没有类别，不会参与训练") },
];

const PAGE = 48;

/** 缩略图上叠加问题框 */
function IssueThumb({ path, issue, dims, color }: { path: string; issue: Issue; dims?: [number, number]; color: string }) {
  return (
    <div className="thumb" style={{ cursor: "default" }}>
      <img src={thumbUrl(path, issue.imageId)} loading="lazy" alt="" draggable={false} />
      {dims && issue.bbox && (
        <svg viewBox={`0 0 ${dims[0]} ${dims[1]}`} preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
          <rect
            x={issue.bbox[0]}
            y={issue.bbox[1]}
            width={issue.bbox[2]}
            height={issue.bbox[3]}
            fill="none"
            stroke={color}
            strokeWidth={3}
            vectorEffect="non-scaling-stroke"
            strokeDasharray="6 3"
          />
        </svg>
      )}
    </div>
  );
}

export default function Health({ project }: { project: ProjectInfo }) {
  const { message, modal } = App.useApp();
  const annotateImage = useApp((s) => s.annotateImage);
  const refreshStats = useApp((s) => s.refreshStats);
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [runId, setRunId] = useState<number | null>(null);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    api.healthLoad().then((r) => {
      setReport(r);
      setLoaded(true);
    }).catch((e) => message.error(errText(e)));
    api.listRuns().then((rs) => {
      const ok = rs.filter((r) => r.hasWeights);
      setRuns(ok);
      setRunId(ok[0]?.id ?? null);
    }).catch(() => {});
  }, [message]);

  const labelName = useMemo(() => {
    const m = new Map((report?.classes ?? []).map((c) => [c.labelId, c.name]));
    return (id: number | null) => (id != null && m.get(id)) || t("未分类");
  }, [report]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const i of report?.issues ?? []) c[i.kind] = (c[i.kind] ?? 0) + 1;
    c.dup_image = report?.dupGroups.length ?? 0;
    return c;
  }, [report]);

  // 默认选中第一个有问题的类型
  useEffect(() => {
    if (report && (filter == null || !counts[filter])) {
      setFilter((KINDS.find((k) => counts[k.key]) ?? KINDS[0]).key);
    }
  }, [report, counts, filter]);

  const start = async () => {
    setRunning({ done: 0, total: 0 });
    const un = await listen<{ done: number; total: number }>("health-progress", (e) => setRunning(e.payload));
    try {
      const r = await api.healthRun(runId);
      setReport(r);
      setFilter(null);
      setLimit(PAGE);
      message.success(t("体检完成，发现 {n} 处问题", { n: r.issues.length + r.dupGroups.length }));
    } catch (e) {
      modal.error({ title: t("体检没有完成"), content: errText(e) });
    } finally {
      un();
      setRunning(null);
    }
  };

  const drop = (keys: string[]) =>
    setReport((r) => (r ? { ...r, issues: r.issues.filter((i) => !keys.includes(i.key)) } : r));

  const ignore = async (i: Issue) => {
    try {
      await api.healthIgnore([i.key]);
      drop([i.key]);
    } catch (e) {
      message.error(errText(e));
    }
  };

  const accept = async (i: Issue) => {
    if (!i.bbox || i.predLabelId == null) return;
    try {
      await api.appendAnnotation(i.imageId, { labelId: i.predLabelId, type: "bbox", data: i.bbox, score: null, source: "manual" });
      await api.healthIgnore([i.key]);
      drop([i.key]);
      refreshStats();
      message.success(t("已加为「{name}」", { name: labelName(i.predLabelId) }));
    } catch (e) {
      message.error(errText(e));
    }
  };

  const go = (i: Issue) => {
    const k = KINDS.find((x) => x.key === i.kind);
    annotateImage(i.imageId, i.bbox ? { imageId: i.imageId, bbox: i.bbox, text: k?.name ?? "" } : undefined);
  };

  const dedupe = (group: number[]) => {
    const extra = group.slice(1);
    modal.confirm({
      title: t("删除这组里的 {n} 张重复图片？", { n: extra.length }),
      content: t("保留第一张。图片的标注会一起删除，你电脑上的原图不受影响。"),
      okText: t("删除"),
      okButtonProps: { danger: true },
      cancelText: t("取消"),
      onOk: async () => {
        try {
          await api.deleteImages("ids", extra);
          setReport((r) => (r ? { ...r, dupGroups: r.dupGroups.filter((g) => g !== group) } : r));
          refreshStats();
        } catch (e) {
          message.error(errText(e));
        }
      },
    });
  };

  const dedupeAll = () => {
    if (!report) return;
    const extra = report.dupGroups.flatMap((g) => g.slice(1));
    modal.confirm({
      title: t("每组只保留一张，共删除 {n} 张重复图片？", { n: extra.length }),
      content: t("图片的标注会一起删除，你电脑上的原图不受影响。"),
      okText: t("删除"),
      okButtonProps: { danger: true },
      cancelText: t("取消"),
      onOk: async () => {
        try {
          await api.deleteImages("ids", extra);
          setReport((r) => (r ? { ...r, dupGroups: [] } : r));
          refreshStats();
        } catch (e) {
          message.error(errText(e));
        }
      },
    });
  };

  const kind = KINDS.find((k) => k.key === filter);
  const list = (report?.issues ?? []).filter((i) => i.kind === filter);
  const maxBoxes = Math.max(1, ...(report?.classes ?? []).map((c) => c.boxes));
  const maxSize = Math.max(1, ...(report?.sizes ?? []).map((s) => s[1]));

  return (
    <div className="page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <h1>{t("数据体检")}</h1>
          <p className="desc" style={{ margin: 0 }}>
            {report
              ? report.runName
                ? t("上次体检：{time} · {images} 张图、{boxes} 个框 · 用模型 {run} 检查", {
                    time: fmtTime(report.createdAt),
                    images: report.imagesChecked,
                    boxes: report.boxesChecked,
                    run: report.runName,
                  })
                : t("上次体检：{time} · {images} 张图、{boxes} 个框 · 只做了规则检查", {
                    time: fmtTime(report.createdAt),
                    images: report.imagesChecked,
                    boxes: report.boxesChecked,
                  })
              : t("检查标注里的常见问题，找出漏标、错标、重复图片等，点一下就能去改。")}
          </p>
        </div>
        <Space>
          <Select
            style={{ width: 300 }}
            value={runId ?? 0}
            onChange={(v) => setRunId(v === 0 ? null : v)}
            options={[
              ...runs.map((r) => ({ value: r.id, label: t("用模型检查：{name} · mAP50 {map}", { name: r.name, map: r.bestMap50?.toFixed(3) ?? "—" }) })),
              { value: 0, label: t("只做规则检查（不用模型）") },
            ]}
          />
          <Button type="primary" icon={<HeartOutlined />} loading={!!running} onClick={start}>
            {report ? t("重新体检") : t("开始体检")}
          </Button>
        </Space>
      </div>

      {running && (
        <div className="card" style={{ marginBottom: 12 }}>
          <Progress percent={running.total ? Math.floor((running.done / running.total) * 100) : 0} status="active" />
          <div className="dim" style={{ fontSize: 12 }}>
            {runId ? t("比对图片、用模型检查每张已标注的图…") : t("比对图片…")}
          </div>
        </div>
      )}

      {runs.length === 0 && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={t("还没有训练好的模型，现在只能做规则检查。训练一个模型后再体检，可以找出漏标、错标和框画偏的地方。")}
        />
      )}

      {!report ? (
        loaded && (
          <div className="card" style={{ padding: 48 }}>
            <Empty description={t("还没有体检过")}>
              <Button type="primary" onClick={start} loading={!!running}>
                {t("开始体检")}
              </Button>
            </Empty>
          </div>
        )
      ) : (
        <>
          <div className="cards" style={{ gridTemplateColumns: "repeat(8, 1fr)", marginBottom: 12 }}>
            {KINDS.map((k) => {
              const n = counts[k.key] ?? 0;
              const off = k.model && !report.runId;
              return (
                <Tooltip key={k.key} title={off ? t("需要用模型检查") : k.tip}>
                  <div
                    className="card click"
                    style={{ padding: 12, borderColor: filter === k.key ? k.color : undefined, opacity: off ? 0.45 : 1 }}
                    onClick={() => {
                      setFilter(k.key);
                      setLimit(PAGE);
                    }}
                  >
                    <div className="muted" style={{ fontSize: 12 }}>{k.name}</div>
                    <div className="kpi" style={{ color: n ? k.color : "var(--dim)" }}>{off ? "—" : n}</div>
                  </div>
                </Tooltip>
              );
            })}
          </div>

          <div className="cards" style={{ gridTemplateColumns: "minmax(0, 1.7fr) minmax(280px, 1fr)", alignItems: "start" }}>
            <div className="card">
              <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <h2 style={{ fontSize: 14, margin: 0 }}>
                  {kind?.name} <span className="dim">· {filter === "dup_image" ? t("{n} 组", { n: report.dupGroups.length }) : t("{n} 处", { n: list.length })}</span>
                </h2>
                <span className="dim" style={{ fontSize: 12 }}>{kind?.tip}</span>
              </div>

              {filter === "dup_image" ? (
                report.dupGroups.length === 0 ? (
                  <Empty description={t("没有重复图片")} image={<CheckOutlined style={{ fontSize: 40, color: "var(--ok)" }} />} />
                ) : (
                  <>
                    <Button size="small" danger style={{ marginBottom: 10 }} onClick={dedupeAll}>
                      {t("每组只保留一张（删除 {n} 张）", { n: report.dupGroups.reduce((s, g) => s + g.length - 1, 0) })}
                    </Button>
                    {report.dupGroups.slice(0, limit).map((g) => (
                      <div key={g.join(",")} className="row" style={{ marginBottom: 10, flexWrap: "nowrap", alignItems: "stretch" }}>
                        <div className="thumbs" style={{ flex: 1, gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))" }}>
                          {g.map((id, i) => (
                            <div key={id} className="thumb" onClick={() => annotateImage(id)} style={{ outline: i === 0 ? "2px solid var(--ok)" : undefined }}>
                              <img src={thumbUrl(project.path, id)} loading="lazy" alt="" draggable={false} />
                              <span className="nm">{i === 0 ? t("保留") : `#${id}`}</span>
                            </div>
                          ))}
                        </div>
                        <Button size="small" style={{ alignSelf: "center" }} onClick={() => dedupe(g)}>
                          {t("删除其余 {n} 张", { n: g.length - 1 })}
                        </Button>
                      </div>
                    ))}
                  </>
                )
              ) : list.length === 0 ? (
                <Empty
                  description={kind?.model && !report.runId ? t("选一个训练好的模型再体检，才能检查这一项") : t("没有发现这类问题")}
                  image={<CheckOutlined style={{ fontSize: 40, color: "var(--ok)" }} />}
                />
              ) : (
                <div className="issue-grid">
                  {list.slice(0, limit).map((i) => (
                    <div key={i.key} className="issue">
                      <IssueThumb path={project.path} issue={i} dims={report.dims[String(i.imageId)]} color={kind?.color ?? "#fff"} />
                      <div className="issue-text">{i.detail}</div>
                      <div className="row" style={{ gap: 4 }}>
                        <Button size="small" icon={<FormOutlined />} onClick={() => go(i)}>
                          {t("去修改")}
                        </Button>
                        {i.kind === "missing" && (
                          <Tooltip title={t("直接加一个「{name}」框", { name: labelName(i.predLabelId) })}>
                            <Button size="small" icon={<PlusOutlined />} onClick={() => accept(i)}>
                              {t("加为标注")}
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip title={t("不是问题，以后体检不再提示")}>
                          <Button size="small" type="text" icon={<EyeInvisibleOutlined />} onClick={() => ignore(i)} />
                        </Tooltip>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {((filter === "dup_image" ? report.dupGroups.length : list.length) > limit) && (
                <div style={{ textAlign: "center", marginTop: 10 }}>
                  <Button onClick={() => setLimit(limit + PAGE)}>{t("显示更多")}</Button>
                </div>
              )}
            </div>

            <div>
              <div className="card" style={{ marginBottom: 12 }}>
                <h2 style={{ fontSize: 14, marginTop: 0 }}>{t("建议")}</h2>
                {report.suggestions.length === 0 ? (
                  <div className="dim">{t("数据看起来不错。")}</div>
                ) : (
                  report.suggestions.map((s, i) => (
                    <div key={i} className="suggest">{s}</div>
                  ))
                )}
              </div>
              <div className="card" style={{ marginBottom: 12 }}>
                <h2 style={{ fontSize: 14, marginTop: 0 }}>{t("类别分布")} <span className="dim" style={{ fontWeight: 400 }}>{t("（框数 · 图片数）")}</span></h2>
                {report.classes.length === 0 && <div className="dim">{t("还没有类别")}</div>}
                {report.classes.map((c) => (
                  <div key={c.labelId} style={{ marginBottom: 8 }}>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span>{c.name}</span>
                      <span className="muted" style={{ color: c.boxes * 5 < maxBoxes ? "var(--warn)" : undefined }}>
                        {c.boxes} · {c.images}
                      </span>
                    </div>
                    <div style={{ height: 6, background: "var(--panel2)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${(c.boxes / maxBoxes) * 100}%`, height: "100%", background: c.color }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="card">
                <h2 style={{ fontSize: 14, marginTop: 0 }}>{t("框大小分布")} <span className="dim" style={{ fontWeight: 400 }}>{t("（短边像素）")}</span></h2>
                <div className="sizes">
                  {report.sizes.map(([name, n], i) => (
                    <Tooltip key={name} title={t("{range} 像素：{n} 个框", { range: name, n })}>
                      <div className="size-col">
                        <div className="size-bar" style={{ height: `${(n / maxSize) * 100}%`, background: i === 0 ? "var(--warn)" : "var(--accent)" }} />
                        <span>{name}</span>
                      </div>
                    </Tooltip>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
