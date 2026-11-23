import { useCallback, useEffect, useState } from "react";
import { Alert, App, Button, Checkbox, Empty, Input, Modal, Progress, Radio, Space, Table, Tabs, Tag } from "antd";
import { FolderOpenOutlined } from "@ant-design/icons";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { AnonymizeConfig, api, errText, ImportProgress, MergeResult, PackageInfo, ProjectInfo } from "../api";
import { prefs, useApp, useReview } from "../store";
import AnonymizeOptions from "./AnonymizeOptions";
import { t } from "../i18n";

const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleString();

/** 合并结果一句话 */
function mergeSummary(r: MergeResult) {
  const parts = [t("合并了 {updated} 张，{unchanged} 张没变化", { updated: r.updated, unchanged: r.unchanged })];
  if (r.added) parts.push(t("新加 {n} 张", { n: r.added }));
  if (r.missing) parts.push(t("{n} 张在原项目里已删除", { n: r.missing }));
  const body = parts.join(t("，"));
  return r.assignee ? t("{name} 的包：{body}", { name: r.assignee, body }) : body;
}

/** 多人协作：分包给几个人离线标注，标完合并回来 */
export default function CollabModal({ project, open, onClose }: { project: ProjectInfo; open: boolean; onClose: () => void }) {
  const { message } = App.useApp();
  const refreshStats = useApp((s) => s.refreshStats);
  const annotateQueue = useApp((s) => s.annotateQueue);
  const [tab, setTab] = useState("split");
  const [list, setList] = useState<PackageInfo[]>([]);
  // 分包
  const [outDir, setOutDir] = useState(prefs.get("packageDir", ""));
  const [people, setPeople] = useState("");
  const [scope, setScope] = useState<"todo" | "unreviewed" | "all">("todo");
  const review = useReview();
  const [withAnns, setWithAnns] = useState(true);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [anonymize, setAnonymize] = useState<AnonymizeConfig | null>(null);
  const [stage, setStage] = useState("");
  // 合并
  const [mergeDir, setMergeDir] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [importNew, setImportNew] = useState(true);
  const [merging, setMerging] = useState(false);
  const [mergeProg, setMergeProg] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<MergeResult | null>(null);

  const load = useCallback(() => api.listPackages().then(setList).catch(() => {}), []);
  useEffect(() => {
    if (open) {
      load();
      setResult(null);
    }
  }, [open, load]);

  const names = people.split(/[\n,，、]/).map((s) => s.trim()).filter(Boolean);

  const split = async () => {
    if (!outDir || names.length === 0) return;
    if (anonymize && !anonymize.labels.length && !anonymize.faces && !anonymize.plates) {
      message.warning(t("打码：请选择要打码的类别，或勾选自动找人脸 / 车牌"));
      return;
    }
    prefs.set("packageDir", outDir);
    setProgress({ done: 0, total: 0 });
    setStage("");
    const un = await listen<ImportProgress>("export-progress", (e) => setProgress(e.payload));
    const unLog = await listen<string>("export-log", (e) => setStage(e.payload));
    try {
      const ps = await api.splitPackages({
        outDir,
        assignees: names,
        scope: !review && scope === "unreviewed" ? "todo" : scope,
        withAnnotations: withAnns,
        anonymize,
      });
      message.success(
        t("已分成 {n} 个包：{list}", {
          n: ps.length,
          list: ps.map((p) => t("{name} {count} 张", { name: p.assignee, count: p.images })).join(t("、")),
        }),
      );
      await load();
      api.revealPath(outDir).catch(() => {});
    } catch (e) {
      message.error(errText(e));
    } finally {
      un();
      unLog();
      setProgress(null);
      setStage("");
    }
  };

  const merge = async (dir = mergeDir) => {
    if (!dir) return;
    setMerging(true);
    setResult(null);
    setMergeProg({ done: 0, total: 0 });
    const un = await listen<ImportProgress>("merge-progress", (e) => setMergeProg(e.payload));
    try {
      const r = await api.mergePackage({ dir, overwrite, importNew });
      setResult(r);
      await load();
      await refreshStats();
    } catch (e) {
      message.error(errText(e));
    } finally {
      un();
      setMerging(false);
      setMergeProg(null);
    }
  };

  const pickDir = async (title: string) => {
    const d = await openDialog({ directory: true, title });
    return typeof d === "string" ? d : null;
  };

  return (
    <Modal title={t("多人协作")} open={open} onCancel={onClose} footer={null} width={820} destroyOnHidden>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: "split",
            label: t("分包"),
            children: (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  {t("把「{name}」的图片分成几个标注包，每个包是一个独立的 Wulabel 项目（类别、关键点模板都带上），拷给标注的人，用 Wulabel 打开就能标。标完把包文件夹拿回来「合并回来」。", { name: project.name })}
                </p>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Space.Compact style={{ width: "100%" }}>
                    <Input addonBefore={t("放在")} value={outDir} placeholder={t("选择存放标注包的文件夹")} onChange={(e) => setOutDir(e.target.value)} />
                    <Button icon={<FolderOpenOutlined />} onClick={async () => setOutDir((await pickDir(t("选择存放标注包的文件夹"))) ?? outDir)} />
                  </Space.Compact>
                  <Input.TextArea
                    rows={3}
                    value={people}
                    placeholder={t("标注人，每行一个（或用逗号隔开），每人一个包，比如：\n张三\n李四")}
                    onChange={(e) => setPeople(e.target.value)}
                  />
                  <Radio.Group value={scope} onChange={(e) => setScope(e.target.value)}>
                    <Radio value="todo">{t("只分未标注的图")}</Radio>
                    {/* 一个人标注时没有审核，这一项（未标注 + 已标注但没审核）没意义，不显示 */}
                    {review && <Radio value="unreviewed">{t("未审核的（未标注 + 已标注待复核）")}</Radio>}
                    <Radio value="all">{t("全部（跳过的除外）")}</Radio>
                  </Radio.Group>
                  <Checkbox checked={withAnns} onChange={(e) => setWithAnns(e.target.checked)}>
                    {t("带上已有的标注（模型预标注的也带上，让标注人在上面改，更快）")}
                  </Checkbox>
                  <AnonymizeOptions task={project.task} value={anonymize} onChange={setAnonymize} />
                  <Button type="primary" disabled={!outDir || names.length === 0} loading={!!progress} onClick={split}>
                    {names.length ? t("分成 {n} 个包", { n: names.length }) : t("分包")}
                  </Button>
                  {progress && <Progress size="small" percent={progress.total ? Math.floor((progress.done / progress.total) * 100) : 0} />}
                  {progress && stage && <div className="dim" style={{ fontSize: 12 }}>{stage}</div>}
                  <div className="dim" style={{ fontSize: 12 }}>
                    {t("按图片顺序平均分，视频的连续帧会尽量分给同一个人。分包后原项目里这些图如果又改了，合并时会提示冲突。")}
                  </div>
                </Space>
              </>
            ),
          },
          {
            key: "merge",
            label: t("合并回来"),
            children: (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  {t("选择标完的包文件夹，把里面的标注合并到当前项目。也能合并别的 Wulabel 项目（按图片内容对应）。")}
                </p>
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Space.Compact style={{ width: "100%" }}>
                    <Input value={mergeDir} placeholder={t("标注包文件夹")} onChange={(e) => setMergeDir(e.target.value)} />
                    <Button icon={<FolderOpenOutlined />} onClick={async () => setMergeDir((await pickDir(t("选择标完的标注包文件夹"))) ?? mergeDir)} />
                  </Space.Compact>
                  <Checkbox checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)}>
                    {t("冲突时用包里的覆盖（原项目在分包后也改过的图）")}
                  </Checkbox>
                  <Checkbox checked={importNew} onChange={(e) => setImportNew(e.target.checked)}>
                    {t("标注人在包里新加的图也导入")}
                  </Checkbox>
                  <Button type="primary" disabled={!mergeDir} loading={merging} onClick={() => merge()}>
                    {t("合并")}
                  </Button>
                  {mergeProg && (
                    <>
                      <Progress size="small" percent={mergeProg.total ? Math.floor((mergeProg.done / mergeProg.total) * 100) : 0} />
                      <div className="dim" style={{ fontSize: 12 }}>
                        {mergeProg.total
                          ? t("正在合并标注、导入新图 {done} / {total} 张", { done: mergeProg.done, total: mergeProg.total })
                          : t("正在读取标注包…")}
                      </div>
                    </>
                  )}
                </Space>
              </>
            ),
          },
        ]}
      />
      {result && (
        <Alert
          style={{ marginTop: 12 }}
          type={result.conflicts.length ? "warning" : "success"}
          showIcon
          message={mergeSummary(result)}
          description={
            <>
              {result.labelsAdded.length > 0 && <div>{t("新增类别：{list}", { list: result.labelsAdded.join(t("、")) })}</div>}
              {result.conflicts.length > 0 && (
                <div>
                  {t("{n} 张图原项目在分包后也改过，没有覆盖。", { n: result.conflicts.length })}{" "}
                  <a onClick={() => annotateQueue(result.conflicts, t("合并冲突"))}>{t("逐张去看")}</a>
                  {t("，或者勾选「冲突时用包里的覆盖」再合并一次。")}
                </div>
              )}
            </>
          }
        />
      )}
      <div className="muted" style={{ margin: "16px 0 6px" }}>{t("分出去的包")}</div>
      <Table<PackageInfo>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={list}
        locale={{ emptyText: <Empty description={t("还没有分过包")} /> }}
        columns={[
          { title: t("标注人"), dataIndex: "assignee" },
          { title: t("图片"), dataIndex: "images", width: 70 },
          { title: t("分包时间"), dataIndex: "createdAt", render: fmtTime, width: 170 },
          {
            title: t("状态"),
            width: 190,
            render: (_, p) => (p.mergedAt ? <Tag color="success">{t("已合并 {time}", { time: fmtTime(p.mergedAt) })}</Tag> : <Tag>{t("标注中")}</Tag>),
          },
          {
            title: "",
            width: 150,
            render: (_, p) => (
              <Space size={4}>
                <Button size="small" type="link" onClick={() => api.revealPath(p.dir).catch((e) => message.error(errText(e)))}>
                  {t("打开")}
                </Button>
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    setTab("merge");
                    setMergeDir(p.dir);
                    merge(p.dir);
                  }}
                >
                  {t("合并")}
                </Button>
              </Space>
            ),
          },
        ]}
      />
    </Modal>
  );
}
