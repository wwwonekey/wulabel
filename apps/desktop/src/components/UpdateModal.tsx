import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Alert, Button, Modal, Progress, Space } from "antd";
import { listen } from "@tauri-apps/api/event";
import { api, appApi, busyList, errText, UpdateInfo } from "../api";
import { t } from "../i18n";

const isMac = navigator.userAgent.includes("Mac");

/** 已经开始更新了：关掉弹窗后下载还在后台进行，再打开不重复开始 */
let updating = false;

/** 软件内更新：下载安装包、核对校验值，然后打开安装程序并退出软件。
 *  开始前看看有没有训练等任务在跑（更新会重启软件，把它们中断），有就先问一下 */
export default function UpdateModal({ info, open, onClose }: { info: UpdateInfo | null; open: boolean; onClose: () => void }) {
  const [progress, setProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  /** 正在进行的任务：非空时先问「先不更新 / 仍然更新」 */
  const [busy, setBusy] = useState<string[] | null>(null);

  useEffect(() => {
    if (!open) return;
    const un = listen<{ downloaded: number; total: number }>("update-progress", (e) => setProgress(e.payload));
    return () => {
      un.then((f) => f());
    };
  }, [open]);

  const start = useCallback(() => {
    setBusy(null);
    if (!info || updating) return;
    updating = true;
    setProgress({ downloaded: 0, total: 0 });
    setError("");
    setDone(false);
    // 先走全自动更新（下载、安装、重启都不用管）；不可用或失败时，退回「下载安装包、打开安装程序」
    const fallback = () =>
      info.downloadUrl && info.sha256
        ? api.installUpdate(info.downloadUrl, info.sha256).then(() => setDone(true))
        : Promise.reject(new Error(t("自动更新没成功，请到官网下载新版安装包，直接覆盖安装即可")));
    api
      .autoUpdate()
      .then((ok) => (ok ? setDone(true) : fallback()))
      .catch(() => {
        setProgress({ downloaded: 0, total: 0 });
        return fallback();
      })
      .catch((e) => {
        updating = false;
        setError(errText(e));
      });
  }, [info]);

  useEffect(() => {
    if (!open || !info || updating) return;
    setError("");
    setDone(false);
    setBusy(null);
    setProgress(null);
    let alive = true;
    appApi
      .busyTasks()
      .then(busyList)
      .catch(() => [] as string[])
      .then((list) => {
        if (!alive) return;
        if (list.length) setBusy(list);
        else start();
      });
    return () => {
      alive = false;
    };
  }, [open, info, start]);

  const mb = (b: number) => (b / 1048576).toFixed(1);
  const pct = progress && progress.total ? Math.round((progress.downloaded / progress.total) * 100) : 0;

  let footer: ReactNode = null;
  if (error) {
    footer = (
      <Space>
        {info?.url && <Button onClick={() => api.openUrl(info.url).catch(() => {})}>{t("去官网下载")}</Button>}
        <Button type="primary" onClick={onClose}>{t("关闭")}</Button>
      </Space>
    );
  } else if (busy) {
    footer = (
      <Space>
        <Button type="primary" onClick={onClose}>{t("先不更新")}</Button>
        <Button danger onClick={start}>{t("仍然更新")}</Button>
      </Space>
    );
  } else if (!done) {
    footer = <Button onClick={onClose}>{t("在后台下载")}</Button>;
  }

  return (
    <Modal
      title={info ? t("更新到 v{version}", { version: info.latest }) : t("更新")}
      open={open}
      onCancel={onClose}
      maskClosable={false}
      footer={footer}
    >
      {error ? (
        <Alert type="error" showIcon message={t("更新失败")} description={error} />
      ) : busy ? (
        <Alert
          type="warning"
          showIcon
          message={t("更新会重启软件，下面这些任务会被中断：")}
          description={
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {busy.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          }
        />
      ) : done ? (
        <Alert
          type="success"
          showIcon
          message={t("新版本已下载，正在安装")}
          description={isMac ? t("在打开的窗口里把 Wulabel 拖进「应用程序」，选择替换即可。") : t("按安装程序的提示完成安装，项目和数据都会保留。")}
        />
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            {progress && progress.total
              ? t("正在下载安装包（{done} / {total} MB）", { done: mb(progress.downloaded), total: mb(progress.total) })
              : t("正在下载安装包…")}
          </div>
          <Progress percent={pct} status="active" />
          <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>
            {t("下载完成后会核对安装包并自动安装，装好后软件会自己重新打开，项目和数据都会保留。正在训练的任务请先等它结束。")}
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            {t("关掉这个窗口不影响下载，下完会自动安装并重启。")}
          </div>
        </>
      )}
    </Modal>
  );
}
