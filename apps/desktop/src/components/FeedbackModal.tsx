import { useEffect, useState } from "react";
import { App, Button, Checkbox, Image, Input, Modal, Space } from "antd";
import { api, errText } from "../api";
import { prefs } from "../store";
import { isRemote } from "../transport";
import { t } from "../i18n";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function FeedbackModal({
  open,
  shot,
  onClose,
}: {
  open: boolean;
  shot: string | null;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [text, setText] = useState("");
  // 邮箱记在本机，下次反馈不用再填
  const [contact, setContact] = useState(prefs.get("feedbackEmail", ""));
  const [withShot, setWithShot] = useState(true);
  const [sending, setSending] = useState(false);
  // 运行日志：打开弹窗时取一次，默认勾选，可以展开看具体内容
  const [logs, setLogs] = useState<string | null>(null);
  const [withLogs, setWithLogs] = useState(true);
  const [showLogs, setShowLogs] = useState(false);

  useEffect(() => {
    if (!open || isRemote) return;
    setLogs(null);
    setShowLogs(false);
    api.feedbackLogs().then(setLogs).catch(() => setLogs(null));
  }, [open]);

  const close = () => {
    if (!sending) onClose();
  };

  const submit = async () => {
    if (!text.trim()) {
      message.warning(t("请先填写问题描述"));
      return;
    }
    const email = contact.trim();
    if (email && !EMAIL_RE.test(email)) {
      message.warning(t("邮箱格式不对，检查一下；不想留可以空着"));
      return;
    }
    setSending(true);
    try {
      await api.submitFeedback({
        message: text.trim(),
        contact: email || undefined,
        screenshot: withShot ? shot : null,
        logs: withLogs ? logs : null,
      });
      prefs.set("feedbackEmail", email);
      message.success(email ? t("反馈已提交，处理好了会发邮件告诉你，谢谢！") : t("反馈已提交，谢谢！"));
      setText("");
      onClose();
    } catch (e) {
      message.error(errText(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      title={t("反馈问题")}
      onCancel={close}
      maskClosable={!sending}
      footer={[
        <Button key="cancel" onClick={close} disabled={sending}>
          {t("取消")}
        </Button>,
        <Button key="send" type="primary" loading={sending} onClick={submit}>
          {t("发送")}
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: "100%" }} size={12}>
        <div className="dim" style={{ fontSize: 13 }}>
          {t("遇到问题或有建议都可以告诉我。描述、截图和运行日志（都可以不带）以及软件版本、操作系统会一起发给开发者用于排查，不会上传你的项目图片本身。")}
        </div>
        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          maxLength={2000}
          showCount
          placeholder={t("说说遇到了什么问题，或者你希望增加什么…")}
          autoFocus
        />
        <Input
          value={contact}
          onChange={(e) => setContact(e.target.value)}
          maxLength={120}
          type="email"
          placeholder={t("你的邮箱（选填）：问题处理好了会发邮件通知你")}
        />
        {shot ? (
          <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
            <Checkbox checked={withShot} onChange={(e) => setWithShot(e.target.checked)} style={{ marginBottom: withShot ? 8 : 0 }}>
              {t("附带当前界面截图")}
            </Checkbox>
            {withShot && (
              <div style={{ textAlign: "center" }}>
                <Image src={shot} alt={t("界面截图预览")} style={{ maxHeight: 180, objectFit: "contain" }} />
              </div>
            )}
          </div>
        ) : (
          <div className="dim" style={{ fontSize: 12 }}>{t("（这次没能自动截到界面，直接文字描述即可）")}</div>
        )}
        {logs && (
          <div style={{ border: "1px solid #eee", borderRadius: 6, padding: 8 }}>
            <Checkbox checked={withLogs} onChange={(e) => setWithLogs(e.target.checked)}>
              {t("附带运行日志（训练环境、最近两次训练的日志和出错信息，不含图片和标注）")}
            </Checkbox>
            {withLogs && (
              <Button type="link" size="small" onClick={() => setShowLogs(!showLogs)}>
                {showLogs ? t("收起") : t("看看内容")}
              </Button>
            )}
            {withLogs && showLogs && (
              <Input.TextArea value={logs} readOnly rows={8} style={{ marginTop: 8, fontFamily: "monospace", fontSize: 12 }} />
            )}
          </div>
        )}
      </Space>
    </Modal>
  );
}
