// 巡瞳 AI 平台对接：把训练好的模型上传到平台；把平台上的告警图片拉回来标注
import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Checkbox, Input, InputNumber, Modal, Progress, Select, Space, Tag } from "antd";
import { CloudUploadOutlined } from "@ant-design/icons";
import { AiModel, api, errText, ImportProgress, ProjectInfo, RunInfo, XtModel, XtPullResult, XtUploadResult } from "../api";
import { listen } from "../transport";
import { useApp } from "../store";
import { t } from "../i18n";

const STATUS: Record<string, { text: string; color: string }> = {
  pending: { text: t("校验中"), color: "processing" },
  ready: { text: t("校验通过"), color: "success" },
  failed: { text: t("校验失败"), color: "error" },
};

/** 部署页「导出模型」里：上传到巡瞳 AI 平台 */
export function XuntongUpload({ run, project }: { run: RunInfo; project: ProjectInfo }) {
  const { message, modal } = App.useApp();
  const setPage = useApp((s) => s.setPage);
  const [name, setName] = useState(`${project.name} ${run.name}`);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [result, setResult] = useState<XtUploadResult | null>(null);
  const [list, setList] = useState<XtModel[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const supported = project.task === "detect";

  const loadList = useCallback(() => {
    api
      .xtModels()
      .then((l) => {
        setList(l);
        setListErr(null);
      })
      .catch((e) => setListErr(errText(e)));
  }, []);

  useEffect(() => {
    if (supported) loadList();
  }, [supported, loadList]);

  // 刚上传的模型平台要校验几秒到一分钟，期间每 5 秒刷新一次
  const waiting = result?.status === "pending" || !!list?.some((m) => m.status === "pending");
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(loadList, 5000);
    return () => window.clearInterval(timer);
  }, [waiting, loadList]);

  const upload = async () => {
    setBusy(true);
    setResult(null);
    setLog("");
    const un = await listen<string>("xuntong-log", (e) => setLog(e.payload));
    try {
      setResult(await api.xtUploadModel(run.id, name));
      loadList();
    } catch (e) {
      message.error(errText(e));
    } finally {
      un();
      setBusy(false);
    }
  };

  const remove = (m: XtModel) =>
    modal.confirm({
      title: t("删除平台上的模型「{name}」？", { name: m.name }),
      content: t("平台上用这个模型的摄像头会停止识别。托管名额满了时，可以先删旧版本再上传新的。"),
      okText: t("删除"),
      okButtonProps: { danger: true },
      cancelText: t("取消"),
      onOk: async () => {
        try {
          await api.xtDeleteModel(String(m.id));
          loadList();
        } catch (e) {
          message.error(errText(e));
        }
      },
    });

  const latest = result ? list?.find((m) => String(m.id) === String(result.id)) : undefined;
  const st = latest?.status ?? result?.status ?? "";

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ marginBottom: 8 }}>
        <b>{t("上传到巡瞳 AI 平台")}</b>{" "}
        <span className="muted">· {t("用你在「设置 → 巡瞳 AI」填的账号，上传后在平台上接摄像头、配告警，不用自己部署服务")}</span>
      </div>
      {!supported ? (
        <div className="dim">{t("巡瞳平台目前只支持目标检测模型。")}</div>
      ) : (
        <>
          <Space.Compact style={{ width: "100%", maxWidth: 560 }}>
            <Input addonBefore={t("模型名")} value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="primary" icon={<CloudUploadOutlined />} loading={busy} onClick={upload}>
              {t("上传")}
            </Button>
          </Space.Compact>
          {busy && log && (
            <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
              {log}
            </div>
          )}
          {result && (
            <Alert
              style={{ marginTop: 10 }}
              type={st === "failed" ? "error" : st === "ready" ? "success" : "info"}
              showIcon
              message={
                <span>
                  {st === "failed" ? t("平台校验没通过") : st === "ready" ? t("已上传，校验通过") : t("已上传，平台正在校验（几秒到一分钟）…")}
                  {result.code && <span className="muted"> · {t("编码 {code}", { code: result.code })}</span>}
                </span>
              }
              description={
                <span>
                  {st === "failed"
                    ? latest?.message || result.message || t("请检查模型后重新上传")
                    : t("校验通过后，到巡瞳 AI 控制台的「自定义模型」里点启用，就能在平台上接摄像头、配告警了。推荐阈值已经一起传上去。")}{" "}
                  <a href={result.consoleUrl} target="_blank" rel="noreferrer">
                    {t("打开控制台")}
                  </a>
                </span>
              }
            />
          )}
          <div style={{ marginTop: 12 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted">{t("平台上的自定义模型")}</span>
              <Button size="small" type="link" onClick={loadList}>
                {t("刷新")}
              </Button>
            </div>
            {listErr ? (
              <div className="dim" style={{ fontSize: 12 }}>
                {listErr} · <a onClick={() => setPage("settings")}>{t("去设置")}</a>
              </div>
            ) : !list ? (
              <div className="dim" style={{ fontSize: 12 }}>{t("读取中…")}</div>
            ) : list.length === 0 ? (
              <div className="dim" style={{ fontSize: 12 }}>{t("还没有上传过模型")}</div>
            ) : (
              list.map((m) => (
                <div key={String(m.id)} className="row" style={{ justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                  <span>
                    {m.name} <span className="dim" style={{ fontSize: 12 }}>{m.code}</span>{" "}
                    <Tag color={STATUS[m.status]?.color}>{STATUS[m.status]?.text ?? m.status}</Tag>
                    {m.enabled ? <Tag color="green">{t("已启用")}</Tag> : m.status === "ready" && <Tag>{t("未启用")}</Tag>}
                    {m.status === "failed" && m.message && <span className="dim" style={{ fontSize: 12 }}>{m.message}</span>}
                  </span>
                  <Button size="small" type="link" danger onClick={() => remove(m)}>
                    {t("删除")}
                  </Button>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
/** 数据页「更多导入」里：从巡瞳 AI 拉取告警图片 */
export function XuntongPullModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const { message, modal } = App.useApp();
  const [days, setDays] = useState(7);
  const [model, setModel] = useState<string>("");
  const [models, setModels] = useState<AiModel[] | null>(null);
  const [max, setMax] = useState(200);
  const [withBoxes, setWithBoxes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [log, setLog] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || models) return;
    api
      .aiModels()
      .then((ms) => {
        setModels(ms.filter((m) => m.code !== "llm" && m.code !== "classes"));
        setErr(null);
      })
      .catch((e) => setErr(errText(e)));
  }, [open, models]);

  const run = async () => {
    setBusy(true);
    setLog("");
    setProgress({ done: 0, total: 0 });
    const subs = [
      listen<ImportProgress>("xuntong-progress", (e) => setProgress(e.payload)),
      listen<string>("xuntong-log", (e) => setLog(e.payload)),
    ];
    try {
      const r: XtPullResult = await api.xtPullAlarms({ days, model: model || null, max, withBoxes });
      onClose();
      onDone();
      modal.success({
        title: t("告警图片已拉回"),
        content: (
          <div>
            <div>
              {[
                t("{fetched} 条告警，新增 {added} 张图", { fetched: r.fetched, added: r.added }),
                r.duplicated ? t("{n} 张已经有了", { n: r.duplicated }) : "",
                r.failed ? t("{n} 张下载失败", { n: r.failed }) : "",
                r.noImage ? t("{n} 条没有原图（平台加原图功能之前的告警）", { n: r.noImage }) : "",
              ]
                .filter(Boolean)
                .join(t("，"))}
            </div>
            {withBoxes && <div>{t("平台的识别框加成了 {n} 个预标注（虚线，来源「巡瞳」），到标注页检查：误报的删掉、漏的补上。", { n: r.boxes })}</div>}
            <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
              {t("图片在项目的 {folder} 文件夹", { folder: r.folder })}
            </div>
          </div>
        ),
      });
    } catch (e) {
      message.error(errText(e));
    } finally {
      (await Promise.all(subs)).forEach((un) => un());
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Modal
      title={t("从巡瞳 AI 拉取告警图片")}
      open={open}
      onCancel={busy ? undefined : onClose}
      onOk={run}
      okText={t("开始拉取")}
      cancelText={t("取消")}
      confirmLoading={busy}
      okButtonProps={{ disabled: !!err }}
      width={520}
      destroyOnHidden
    >
      <p className="muted" style={{ marginTop: 8 }}>
        {t("把巡瞳平台上的告警截图拉回来标注、再训练。现场的误报、漏报正是最值得补的数据。平台的告警图片保留 7 天，记得定期拉；只有配置了推送通道的账号才会产生告警记录。")}
      </p>
      {err ? (
        <Alert type="warning" showIcon message={err} />
      ) : (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space wrap>
            <Select
              value={days}
              onChange={setDays}
              style={{ width: 140 }}
              options={[
                { value: 1, label: t("最近 {n} 天", { n: 1 }) },
                { value: 3, label: t("最近 {n} 天", { n: 3 }) },
                { value: 7, label: t("最近 {n} 天", { n: 7 }) },

              ]}
            />
            <Select
              value={model}
              onChange={setModel}
              style={{ width: 220 }}
              loading={!models}
              options={[{ value: "", label: t("全部模型") }, ...(models ?? []).map((m) => ({ value: m.code, label: m.name }))]}
            />
            <InputNumber min={1} max={5000} value={max} onChange={(v) => setMax(Number(v ?? 200))} addonBefore={t("最多")} addonAfter={t("张")} style={{ width: 170 }} />
          </Space>
          <Checkbox checked={withBoxes} onChange={(e) => setWithBoxes(e.target.checked)}>
            {t("平台识别出的框作为预标注（按类别名对应项目里的类别，没有的会新建）")}
          </Checkbox>
        </Space>
      )}
      {progress && (
        <div style={{ marginTop: 12 }}>
          <Progress size="small" percent={progress.total ? Math.floor((progress.done / progress.total) * 100) : 0} />
          {log && <div className="dim" style={{ fontSize: 12 }}>{log}</div>}
        </div>
      )}
    </Modal>
  );
}
