import { useEffect, useState } from "react";
import { App, Button, Form, Input, Modal, Radio, Space } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { documentDir, join } from "@tauri-apps/api/path";
import { api, errText, Task, TASKS } from "../api";
import { prefs, useApp } from "../store";
import { t } from "../i18n";

const PALETTE = ["#3d8bfd", "#e5534b", "#2fb67c", "#e7a33e", "#9b7bf2", "#14b8a6", "#f472b6", "#a3e635", "#f97316", "#60a5fa"];

interface Values {
  name: string;
  parent: string;
  task: Task;
  labels?: string;
}

export default function NewProjectModal({ openState, onClose }: { openState: boolean; onClose: () => void }) {
  const [form] = Form.useForm<Values>();
  const [busy, setBusy] = useState(false);
  const { message } = App.useApp();
  const setProject = useApp((s) => s.setProject);

  // 没选过存放位置时默认放在「文档/Wulabel」下（建项目时会自动建出这个文件夹）
  useEffect(() => {
    if (!openState || form.getFieldValue("parent")) return;
    documentDir()
      .then((d) => join(d, "Wulabel"))
      .then((p) => {
        if (!form.getFieldValue("parent")) form.setFieldValue("parent", p);
      })
      .catch(() => {});
  }, [openState, form]);

  const pickParent = async () => {
    const dir = await open({ directory: true, title: t("选择项目存放位置") });
    if (typeof dir === "string") form.setFieldValue("parent", dir);
  };

  const submit = async () => {
    const v = await form.validateFields();
    setBusy(true);
    try {
      const p = await api.createProject(v.parent, v.name, v.task);
      prefs.set("lastParent", v.parent);
      // 填了类别就顺手建好（重名的跳过）
      const names = [...new Set((v.labels ?? "").split(/[\n,，、]/).map((s) => s.trim()).filter(Boolean))];
      let failed = 0;
      for (let i = 0; i < names.length; i++) {
        try {
          await api.addLabel(names[i], PALETTE[i % PALETTE.length]);
        } catch {
          failed++;
        }
      }
      if (failed) message.warning(t("有 {n} 个类别没建成功，可以在标注页再加", { n: failed }));
      message.success(t("项目「{name}」已创建", { name: p.name }));
      onClose();
      form.resetFields();
      setProject(p);
    } catch (e) {
      message.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t("新建项目")}
      open={openState}
      onCancel={onClose}
      onOk={submit}
      okText={t("创建")}
      confirmLoading={busy}
      destroyOnHidden
      width={560}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ task: "detect", parent: prefs.get("lastParent", "") }}
        style={{ marginTop: 16 }}
      >
        <Form.Item name="name" label={t("项目名")} rules={[{ required: true, message: t("请输入项目名") }]}>
          <Input placeholder={t("例如：工地安全帽检测")} autoFocus maxLength={60} />
        </Form.Item>
        <Form.Item label={t("存放位置")} required>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item name="parent" noStyle rules={[{ required: true, message: t("请选择存放位置") }]}>
              <Input placeholder={t("项目会建在这个文件夹下")} />
            </Form.Item>
            <Button icon={<FolderOpenOutlined />} onClick={pickParent}>
              {t("浏览")}
            </Button>
          </Space.Compact>
        </Form.Item>
        <Form.Item name="task" label={t("任务类型")} extra={t("创建后不能修改。")}>
          <Radio.Group style={{ width: "100%" }}>
            <Space direction="vertical" style={{ width: "100%" }}>
              {TASKS.map((tk) => (
                <Radio key={tk.value} value={tk.value}>
                  <b>{tk.name}</b> <span className="muted">· {tk.desc}</span>
                </Radio>
              ))}
            </Space>
          </Radio.Group>
        </Form.Item>
        <Form.Item name="labels" label={t("类别（用逗号或换行分隔）")} extra={t("可以不填，之后在标注页随时加。")}>
          <Input.TextArea rows={2} placeholder={t("例如：安全帽, 人, 反光衣")} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
