import { useEffect, useState } from "react";
import { Progress } from "antd";
import { listen } from "../transport";
import { t } from "../i18n";

/** worker 下载模型时的进度（预训练权重、SAM、文本检测模型） */
export interface DownloadEv {
  name: string;
  done: number;
  total: number;
  speed: number;
  finished?: boolean;
  failed?: boolean;
}

export const fmtMB = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** 「12.3 MB / 203.1 MB · 1.2 MB/s」 */
export const downloadText = (d: DownloadEv) =>
  `${fmtMB(d.done)}${d.total ? ` / ${fmtMB(d.total)}` : ""}${d.speed ? ` · ${fmtMB(d.speed)}/s` : ""}`;

export const downloadPercent = (d: DownloadEv) => (d.total ? Math.min(100, Math.floor((d.done / d.total) * 100)) : 0);

/** 右下角的下载进度：第一次训练、第一次用 SAM / 文本提示时下载模型，下完几秒后自己消失 */
export default function DownloadProgress() {
  const [items, setItems] = useState<Record<string, DownloadEv>>({});

  useEffect(() => {
    const timers: number[] = [];
    const un = listen<DownloadEv>("download-progress", (e) => {
      const d = e.payload;
      setItems((m) => ({ ...m, [d.name]: d }));
      if (d.finished || d.failed) {
        timers.push(
          window.setTimeout(
            () =>
              setItems((m) => {
                // 期间又开始下同名文件（失败后重试）就不删
                if (!m[d.name]?.finished && !m[d.name]?.failed) return m;
                const rest = { ...m };
                delete rest[d.name];
                return rest;
              }),
            3000,
          ),
        );
      }
    });
    return () => {
      timers.forEach((x) => clearTimeout(x));
      un.then((f) => f());
    };
  }, []);

  const list = Object.values(items);
  if (!list.length) return null;
  return (
    <div className="dl-float">
      <div className="muted" style={{ marginBottom: 4 }}>{t("正在下载模型（只需下载一次）")}</div>
      {list.map((d) => (
        <div key={d.name} style={{ marginTop: 6 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 8, fontSize: 12 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name}</span>
            <span className="dim" style={{ whiteSpace: "nowrap" }}>
              {d.failed ? t("下载失败") : d.finished ? t("已下载") : downloadText(d)}
            </span>
          </div>
          <Progress
            size="small"
            showInfo={false}
            percent={d.finished ? 100 : downloadPercent(d)}
            status={d.failed ? "exception" : d.finished ? "success" : "active"}
            style={{ margin: 0 }}
          />
        </div>
      ))}
    </div>
  );
}
