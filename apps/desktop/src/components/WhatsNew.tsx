import { useEffect, useState } from "react";
import { Button, Modal } from "antd";
import { getVersion } from "@tauri-apps/api/app";
import { notesBetween, versionGt } from "../changelog";
import { prefs } from "../store";
import { isRemote } from "../transport";
import { t } from "../i18n";

/** 以前用过软件（本机有任何 Wulabel 的偏好设置），用来区分「更新」和「第一次安装」 */
function usedBefore(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? "";
      if (k.startsWith("xlabel.") && k !== "xlabel.lastVersion") return true;
    }
  } catch {
    /* 读不了就当第一次用 */
  }
  return false;
}

/** 更新后第一次打开时，显示这次更新了什么。第一次安装不弹，看过一次不再弹。 */
export default function WhatsNew() {
  const [notes, setNotes] = useState<ReturnType<typeof notesBetween>>([]);
  const [current, setCurrent] = useState("");

  useEffect(() => {
    if (isRemote) return;
    getVersion()
      .then((v) => {
        const last = prefs.get("lastVersion", "");
        const old = usedBefore();
        prefs.set("lastVersion", v);
        if (last ? !versionGt(v, last) : !old) return;
        const n = notesBetween(last, v);
        if (n.length) {
          setCurrent(v);
          setNotes(n);
        }
      })
      .catch(() => {});
  }, []);

  const close = () => setNotes([]);
  return (
    <Modal
      title={t("Wulabel 已更新到 v{version}", { version: current })}
      open={notes.length > 0}
      onCancel={close}
      footer={<Button type="primary" onClick={close}>{t("知道了")}</Button>}
    >
      {notes.map((n) => (
        <div key={n.version} style={{ marginBottom: 12 }}>
          {notes.length > 1 && <div style={{ fontWeight: 600, marginBottom: 4 }}>v{n.version}</div>}
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {n.items.map((it) => (
              <li key={it} style={{ marginBottom: 4 }}>
                {it}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </Modal>
  );
}
