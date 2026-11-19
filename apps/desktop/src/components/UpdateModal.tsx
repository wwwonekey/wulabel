import { useEffect, useState } from "react";
import { Alert, Button, Modal, Progress, Space } from "antd";
import { listen } from "@tauri-apps/api/event";
import { api, errText, UpdateInfo } from "../api";

const isMac = navigator.userAgent.includes("Mac");

/** 软件内更新：下载安装包、核对校验值，然后打开安装程序并退出软件 */
export default function UpdateModal({ info, open, onClose }: { info: UpdateInfo | null; open: boolean; onClose: () => void }) {
  const [progress, setProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open || !info) return;
    setProgress({ downloaded: 0, total: 0 });
    setError("");
    setDone(false);
    const un = listen<{ downloaded: number; total: number }>("update-progress", (e) => setProgress(e.payload));
    // 先走全自动更新（下载、安装、重启都不用管）；不可用或失败时，退回「下载安装包、打开安装程序」
    const fallback = () =>
      info.downloadUrl && info.sha256
        ? api.installUpdate(info.downloadUrl, info.sha256).then(() => setDone(true))
        : Promise.reject(new Error("自动更新没成功，请到官网下载新版安装包，直接覆盖安装即可"));
    api
      .autoUpdate()
      .then((ok) => (ok ? setDone(true) : fallback()))
      .catch(() => {
        setProgress({ downloaded: 0, total: 0 });
        return fallback();
      })
      .catch((e) => setError(errText(e)));
    return () => {
      un.then((f) => f());
    };
  }, [open, info]);

  const mb = (b: number) => (b / 1048576).toFixed(1);
  const pct = progress && progress.total ? Math.round((progress.downloaded / progress.total) * 100) : 0;

  return (
    <Modal
      title={info ? `更新到 v${info.latest}` : "更新"}
      open={open}
      onCancel={onClose}
      maskClosable={false}
      closable={!!error}
      footer={
        error ? (
          <Space>
            {info?.url && <Button onClick={() => api.openUrl(info.url).catch(() => {})}>去官网下载</Button>}
            <Button type="primary" onClick={onClose}>关闭</Button>
          </Space>
        ) : null
      }
    >
      {error ? (
        <Alert type="error" showIcon message="更新失败" description={error} />
      ) : done ? (
        <Alert
          type="success"
          showIcon
          message="新版本已下载，正在安装"
          description={isMac ? "在打开的窗口里把 Wulabel 拖进「应用程序」，选择替换即可。" : "按安装程序的提示完成安装，项目和数据都会保留。"}
        />
      ) : (
        <>
          <div style={{ marginBottom: 8 }}>
            正在下载安装包{progress && progress.total ? `（${mb(progress.downloaded)} / ${mb(progress.total)} MB）` : "…"}
          </div>
          <Progress percent={pct} status="active" />
          <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>
            下载完成后会核对安装包并自动安装，装好后软件会自己重新打开，项目和数据都会保留。正在训练的任务请先等它结束。
          </div>
        </>
      )}
    </Modal>
  );
}
