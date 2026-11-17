import { useCallback, useEffect, useState } from "react";
import { App, Button, Empty, Progress, Tag, Tooltip } from "antd";
import { DeleteOutlined, FolderOpenOutlined, PlusOutlined } from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errText, ProjectSummary, RecentProject, taskName } from "../api";
import { useApp } from "../store";
import NewProjectModal from "../components/NewProjectModal";
import GuideCard from "../components/GuideCard";

function ago(ts: number) {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
  return new Date(ts * 1000).toLocaleDateString();
}

export default function Home() {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [sums, setSums] = useState<Record<string, ProjectSummary | null>>({});
  const { message } = App.useApp();
  const setProject = useApp((s) => s.setProject);

  const load = useCallback(() => {
    api.recentProjects().then(setRecent).catch((e) => message.error(errText(e)));
  }, [message]);

  useEffect(load, [load]);

  // 每个项目的概况（图片数、标注进度、训练次数、封面），读不到的不显示
  useEffect(() => {
    recent
      .filter((r) => r.exists)
      .forEach((r) =>
        api
          .projectSummary(r.path)
          .then((s) => setSums((m) => ({ ...m, [r.path]: s })))
          .catch(() => {}),
      );
  }, [recent]);

  const openPath = async (path: string) => {
    try {
      setProject(await api.openProject(path));
    } catch (e) {
      message.error(errText(e));
      load();
    }
  };

  const pickAndOpen = async () => {
    const dir = await open({ directory: true, title: "选择项目文件夹" });
    if (typeof dir === "string") openPath(dir);
  };

  const remove = async (path: string) => {
    await api.removeRecent(path);
    load();
  };

  return (
    <div className="page">
      <h1>项目</h1>
      <p className="desc">一个项目就是一个文件夹，整个拷走就能在另一台电脑上打开。</p>

      <GuideCard hasProject={recent.length > 0} onNewProject={() => setShowNew(true)} />

      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, margin: 0 }}>最近项目</h2>
        <div className="row">
          <Button icon={<FolderOpenOutlined />} onClick={pickAndOpen}>
            打开项目…
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowNew(true)}>
            新建项目
          </Button>
        </div>
      </div>

      {recent.length === 0 ? (
        <div className="card" style={{ padding: 48 }}>
          <Empty description="还没有项目">
            <Button type="primary" onClick={() => setShowNew(true)}>
              新建第一个项目
            </Button>
          </Empty>
        </div>
      ) : (
        <div className="cards" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {recent.map((r) => (
            <div
              key={r.path}
              className={r.exists ? "card click" : "card"}
              style={r.exists ? undefined : { opacity: 0.6 }}
              onClick={() => r.exists && openPath(r.path)}
            >
              {sums[r.path]?.cover && (
                <img
                  src={sums[r.path]!.cover!}
                  alt=""
                  draggable={false}
                  style={{ width: "100%", height: 120, objectFit: "cover", borderRadius: 6, marginBottom: 10, display: "block", background: "#0e1013" }}
                />
              )}
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</strong>
                <Tooltip title="从列表移除（不会删除文件）">
                  <Button
                    size="small"
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(r.path);
                    }}
                  />
                </Tooltip>
              </div>
              <div style={{ margin: "4px 0 8px" }}>
                <Tag>{taskName(r.task)}</Tag>
                {!r.exists && <Tag color="error">找不到文件夹</Tag>}
              </div>
              {sums[r.path] && (
                <div style={{ marginBottom: 6 }}>
                  <div className="row" style={{ justifyContent: "space-between", fontSize: 12 }}>
                    <span className="muted">
                      {sums[r.path]!.images} 张图，已标 {sums[r.path]!.labeled} 张
                    </span>
                    <span className="dim">{sums[r.path]!.runs ? `训练过 ${sums[r.path]!.runs} 次` : "还没训练"}</span>
                  </div>
                  <Progress
                    percent={sums[r.path]!.images ? Math.round((sums[r.path]!.labeled / sums[r.path]!.images) * 100) : 0}
                    size="small"
                    showInfo={false}
                  />
                </div>
              )}
              <div className="dim" style={{ fontSize: 12, wordBreak: "break-all" }}>
                {r.path}
              </div>
              <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                {ago(r.openedAt)}打开
              </div>
            </div>
          ))}
        </div>
      )}

      <NewProjectModal openState={showNew} onClose={() => setShowNew(false)} />
    </div>
  );
}
