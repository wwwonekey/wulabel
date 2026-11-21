import { useEffect, useState } from "react";
import { App, Button, Empty, Input, InputNumber, Progress, Slider, Space, Table, Tag } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { api, errText, FpSummary, RunInfo, Thresholds } from "../api";
import { prefs, useApp } from "../store";
import LineChart from "./LineChart";
import { t } from "../i18n";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

/** 置信度阈值：精确率 / 召回率 / F1 随阈值变化，推荐 F1 最高的阈值，可拖动看任意阈值的效果 */
export function ThresholdPanel({ th, isCls }: { th: Thresholds; isCls: boolean }) {
  const curve = th.curve;
  const bestIdx = Math.max(0, curve.findIndex((c) => c.conf === th.best.conf));
  const [idx, setIdx] = useState(bestIdx);
  useEffect(() => setIdx(bestIdx), [bestIdx, th]);
  const cur = curve[idx] ?? th.best;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span className="muted">
          {t("置信度阈值")} <span className="dim">· {t("部署时报警用多少阈值")}</span>
        </span>
        <span>
          {t("推荐")} <Tag color="blue">{th.best.conf.toFixed(2)}</Tag>
          <span className="dim" style={{ fontSize: 12 }}>
            {t("精确率 {p}、召回率 {r}（F1 最高）", { p: pct(th.best.precision), r: pct(th.best.recall) })}
          </span>
        </span>
      </div>
      <div className="cards" style={{ gridTemplateColumns: "3fr 2fr" }}>
        <div>
          <LineChart
            xMax={curve.length}
            yMin={0}
            yMax={1}
            xLabel={(i) => curve[i]?.conf.toFixed(2) ?? ""}
            marker={idx}
            series={[
              { name: t("精确率"), color: "#3d8bfd", values: curve.map((c) => c.precision) },
              { name: t("召回率"), color: "#e7a33e", values: curve.map((c) => c.recall) },
              { name: "F1", color: "#2fb67c", values: curve.map((c) => c.f1) },
            ]}
          />
          <div className="dim" style={{ fontSize: 12 }}>
            <span style={{ color: "#3d8bfd" }}>{t("精确率")}</span>{t("（报出来的有多少是对的）")} ·{" "}
            <span style={{ color: "#e7a33e" }}>{t("召回率")}</span>{t("（真的目标找到了多少）")} · <span style={{ color: "#2fb67c" }}>F1</span>{t("（两者兼顾）")}
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: 12 }}>{t("拖动看不同阈值的效果")}</div>
          <Slider
            min={0}
            max={curve.length - 1}
            value={idx}
            onChange={setIdx}
            tooltip={{ formatter: (v) => curve[v ?? 0]?.conf.toFixed(2) }}
          />
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            {t("阈值")} <b>{cur.conf.toFixed(2)}</b>
            <br />
            {t("精确率")} <b>{pct(cur.precision)}</b>　{t("召回率")} <b>{pct(cur.recall)}</b>
            {cur.tp != null && (
              <>
                <br />
                <span className="dim">
                  {isCls
                    ? t("下结论 {decided} 张，其中分对 {tp}、分错 {fp}；拿不准不下结论 {unsure}", {
                        decided: (cur.tp ?? 0) + (cur.fp ?? 0),
                        tp: cur.tp,
                        fp: cur.fp,
                        unsure: (cur.fn ?? 0) - (cur.fp ?? 0),
                      })
                    : t("找对 {tp}、误报 {fp}、漏掉 {fn}", { tp: cur.tp, fp: cur.fp, fn: cur.fn })}
                </span>
              </>
            )}
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
            {isCls ? t("最高分低于阈值的图当成「拿不准」，交给人看。") : t("误报多就调高阈值；漏报多就调低。")}
          </div>
        </div>
      </div>
      {th.perClass.some((c) => c.conf != null) && (
        <Table
          size="small"
          style={{ marginTop: 10 }}
          rowKey="index"
          pagination={false}
          dataSource={th.perClass.filter((c) => c.conf != null)}
          columns={[
            { title: t("类别"), dataIndex: "name" },
            { title: t("推荐阈值"), dataIndex: "conf", render: (v: number) => v.toFixed(2) },
            { title: t("精确率"), dataIndex: "precision", render: pct },
            { title: t("召回率"), dataIndex: "recall", render: pct },
            { title: "F1", dataIndex: "f1", render: (v: number) => v.toFixed(3) },
          ]}
        />
      )}
    </div>
  );
}

/** 误报测试界面上最多留几张报警截图 */
const MAX_ALARMS = 60;

interface AlarmEv {
  t: number;
  labels: string[];
  path: string;
  preview: string;
}

/** 误报测试：拿一段「不该报警」的视频跑模型，看会误报多少次，误报帧可以直接加回数据集当负样本 */
export function FpTestPanel({ run, defaultConf }: { run: RunInfo; defaultConf: number }) {
  const { message, modal } = App.useApp();
  const refreshStats = useApp((s) => s.refreshStats);
  const [source, setSource] = useState(prefs.get("fpSource", ""));
  const [conf, setConf] = useState(defaultConf);
  const [fps, setFps] = useState(2);
  const [maxMin, setMaxMin] = useState(10);
  const [consecutive, setConsecutive] = useState(1);
  const [running, setRunning] = useState(false);
  const [prog, setProg] = useState<{ seconds: number; total: number; alarms: number } | null>(null);
  const [alarms, setAlarms] = useState<AlarmEv[]>([]);
  const [summary, setSummary] = useState<FpSummary | null>(null);

  useEffect(() => setConf(defaultConf), [defaultConf]);

  const pick = async () => {
    const f = await open({ title: t("选择没有目标的视频"), filters: [{ name: t("视频"), extensions: ["mp4", "mov", "mkv", "avi", "webm", "flv", "ts", "m4v", "wmv"] }] });
    if (typeof f === "string") setSource(f);
  };

  const start = async () => {
    if (!source.trim()) return;
    prefs.set("fpSource", source.trim());
    setRunning(true);
    setAlarms([]);
    setSummary(null);
    setProg(null);
    const un = await listen<{ type: string } & Record<string, unknown>>("fptest", (e) => {
      const v = e.payload;
      if (v.type === "progress") setProg({ seconds: Number(v.seconds), total: Number(v.total), alarms: Number(v.alarms) });
      else if (v.type === "alarm") setAlarms((a) => [...a, v as unknown as AlarmEv].slice(-MAX_ALARMS));
    });
    try {
      const isStream = source.includes("://");
      setSummary(
        await api.fpTest({
          runId: run.id,
          source: source.trim(),
          conf,
          fps,
          maxSeconds: isStream ? maxMin * 60 : 0,
          consecutive,
          cooldown: 10,
        }),
      );
    } catch (e) {
      message.error(errText(e));
    } finally {
      un();
      setRunning(false);
    }
  };

  const addNegatives = () => {
    const paths = alarms.map((a) => a.path).filter(Boolean);
    modal.confirm({
      title: t("把 {n} 张误报帧加进数据集？", { n: paths.length }),
      content: t("会作为「没有目标」的负样本加入，下次训练时模型会学着不在这类画面上报警。如果其中有真的目标，加入后到标注页补上标注。"),
      okText: t("加入"),
      cancelText: t("取消"),
      onOk: async () => {
        try {
          const n = await api.importNegatives(paths);
          message.success(t("已加入 {n} 张负样本", { n }));
          await refreshStats();
        } catch (e) {
          message.error(errText(e));
        }
      },
    });
  };

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="muted" style={{ marginBottom: 4 }}>
        {t("误报测试")} <span className="dim">· {t("用一段不该报警的视频（没有目标，或只有容易认错的东西）测模型会误报几次")}</span>
      </div>
      <Space.Compact style={{ width: "100%", margin: "6px 0" }}>
        <Input value={source} placeholder={t("选择视频文件，或填 rtsp:// / http(s):// 地址")} onChange={(e) => setSource(e.target.value)} disabled={running} />
        <Button icon={<FolderOpenOutlined />} onClick={pick} disabled={running} />
      </Space.Compact>
      <div className="row" style={{ gap: 14, flexWrap: "wrap", marginBottom: 8, fontSize: 13 }}>
        <span>
          {t("阈值")} <InputNumber size="small" min={0.05} max={0.95} step={0.05} value={conf} onChange={(v) => setConf(Number(v ?? 0.5))} disabled={running} />
        </span>
        <span>
          {t("每秒检测")} <InputNumber size="small" min={0.2} max={15} step={1} value={fps} onChange={(v) => setFps(Number(v ?? 2))} disabled={running} /> {t("帧")}
        </span>
        <span>
          {t("连续")} <InputNumber size="small" min={1} max={20} value={consecutive} onChange={(v) => setConsecutive(Number(v ?? 1))} disabled={running} /> {t("次检出算一次报警")}
        </span>
        {source.includes("://") && (
          <span>
            {t("测")} <InputNumber size="small" min={1} max={1440} value={maxMin} onChange={(v) => setMaxMin(Number(v ?? 10))} disabled={running} /> {t("分钟")}
          </span>
        )}
        {running ? (
          <Button size="small" danger onClick={() => api.stopFpTest()}>
            {t("提前结束")}
          </Button>
        ) : (
          <Button size="small" type="primary" disabled={!source.trim()} onClick={start}>
            {t("开始测试")}
          </Button>
        )}
      </div>
      {running && prog && (
        <>
          <Progress size="small" percent={prog.total ? Math.min(100, Math.floor((prog.seconds / prog.total) * 100)) : 0} status="active" />
          <div className="dim" style={{ fontSize: 12 }}>
            {t("已测 {s} 秒 · 报警 {n} 次", { s: Math.round(prog.seconds), n: prog.alarms })}
          </div>
        </>
      )}
      {summary && (
        <div className="cards" style={{ gridTemplateColumns: "repeat(4, 1fr)", margin: "8px 0" }}>
          <div className="card"><div className="muted">{t("测了")}</div><div className="kpi">{summary.seconds < 60 ? t("{n} 秒", { n: Math.round(summary.seconds) }) : t("{n} 分钟", { n: Math.round(summary.seconds / 60) })}</div></div>
          <div className="card"><div className="muted">{t("报警")}</div><div className="kpi">{t("{n} 次", { n: summary.alarms })}</div></div>
          <div className="card"><div className="muted">{t("折合每小时")}</div><div className="kpi" style={{ color: summary.perHour > 1 ? "var(--bad)" : undefined }}>{summary.perHour}</div></div>
          <div className="card">
            <div className="muted">{t("按类别")}</div>
            <div style={{ fontSize: 13 }}>
              {Object.entries(summary.perClass).map(([k, v]) => `${k} ${v}`).join(t("、")) || t("没有误报")}
            </div>
          </div>
        </div>
      )}
      {alarms.length > 0 && (
        <>
          <div className="row" style={{ justifyContent: "space-between", margin: "8px 0 6px" }}>
            <span className="dim" style={{ fontSize: 12 }}>
              {t("误报的画面（红框是模型报的）")}
              {(summary?.alarms ?? prog?.alarms ?? 0) > MAX_ALARMS && ` · ${t("只保留最近 {n} 张报警截图", { n: MAX_ALARMS })}`}
            </span>
            {!running && (
              <Button size="small" onClick={addNegatives} disabled={!alarms.some((a) => a.path)}>
                {t("把这些帧加进数据集当负样本")}
              </Button>
            )}
          </div>
          <div className="thumbs">
            {alarms.map((a, i) => (
              <div key={i} className="thumb" title={t("{s} 秒：{labels}", { s: a.t, labels: a.labels.join(t("、")) })}>
                <img src={`data:image/jpeg;base64,${a.preview}`} alt="" draggable={false} />
                <span className="nm">
                  {Math.floor(a.t / 60)}:{String(Math.floor(a.t % 60)).padStart(2, "0")} {a.labels.join(t("、"))}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {!running && summary && alarms.length === 0 && <Empty description={t("没有误报")} />}
    </div>
  );
}
