import { useEffect, useState } from "react";
import { Button, Steps } from "antd";
import { CloseOutlined, ReadOutlined } from "@ant-design/icons";
import { api } from "../api";
import { prefs, useApp } from "../store";
import { t } from "../i18n";

const GUIDE_URL = "https://wulabel.xiaowuiot.com/guide.html";

/** 首页的新手引导：从装训练环境到部署的六步，能判断的步骤自动打勾 */
export default function GuideCard({ hasProject, onNewProject }: { hasProject: boolean; onNewProject: () => void }) {
  const [hidden, setHidden] = useState(prefs.get("guideHidden", "0") === "1");
  const [envReady, setEnvReady] = useState<boolean | null>(null);
  const setPage = useApp((s) => s.setPage);

  useEffect(() => {
    if (hidden) return;
    api
      .envStatus(false)
      .then((s) => setEnvReady(s.ready))
      .catch(() => setEnvReady(false));
  }, [hidden]);

  if (hidden) {
    return (
      <div style={{ textAlign: "right", marginBottom: 8 }}>
        <Button
          size="small"
          type="link"
          onClick={() => {
            prefs.set("guideHidden", "0");
            setHidden(false);
          }}
        >
          {t("显示新手引导")}
        </Button>
      </div>
    );
  }

  const steps = [
    {
      title: t("装训练环境"),
      description: envReady ? t("已装好") : t("设置页一键安装；只标注可以跳过"),
      done: !!envReady,
      action: envReady ? null : (
        <Button size="small" onClick={() => setPage("settings")}>
          {t("去设置")}
        </Button>
      ),
    },
    {
      title: t("新建项目"),
      description: t("选任务类型：检测、分割、分类、关键点"),
      done: hasProject,
      action: hasProject ? null : (
        <Button size="small" type="primary" onClick={onNewProject}>
          {t("新建项目")}
        </Button>
      ),
    },
    { title: t("导入图片"), description: t("图片、文件夹、视频抽帧、摄像头采集，或导入已有数据集"), done: false, action: null },
    { title: t("标一小批"), description: t("先标几十到一两百张；SAM 点一下出轮廓，文本提示自动找目标"), done: false, action: null },
    { title: t("训练"), description: t("检测推荐 YOLOX-S，训 50 轮以上"), done: false, action: null },
    { title: t("预标注和部署"), description: t("用训好的模型预标注剩下的图，评估后导出部署"), done: false, action: null },
  ];
  const current = steps.findIndex((s) => !s.done);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12, flexWrap: "nowrap" }}>
        <div>
          <h2 style={{ fontSize: 15, margin: 0 }}>{t("第一次用？跟着这六步走一遍")}</h2>
          <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
            {t("标一小批 → 训练 → 用模型预标注剩下的 → 再训，越标越快")}
          </div>
        </div>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <Button size="small" icon={<ReadOutlined />} onClick={() => api.openUrl(GUIDE_URL).catch(() => {})}>
            {t("看使用教程")}
          </Button>
          <Button
            size="small"
            type="text"
            icon={<CloseOutlined />}
            title={t("不再显示")}
            onClick={() => {
              prefs.set("guideHidden", "1");
              setHidden(true);
            }}
          />
        </div>
      </div>
      <Steps
        size="small"
        current={current < 0 ? steps.length : current}
        items={steps.map((s) => ({
          title: s.title,
          status: s.done ? "finish" : undefined,
          description: (
            <div style={{ fontSize: 12 }}>
              {s.description}
              {s.action && <div style={{ marginTop: 6 }}>{s.action}</div>}
            </div>
          ),
        }))}
      />
    </div>
  );
}
