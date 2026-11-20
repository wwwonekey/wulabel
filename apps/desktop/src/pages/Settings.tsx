import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Alert, App, Button, Descriptions, Input, Modal, Progress, Radio, Select, Space, Spin, Switch, Tag, Typography } from "antd";
import { CheckCircleOutlined, FolderOpenOutlined, ReloadOutlined, ThunderboltOutlined, ToolOutlined, UserOutlined } from "@ant-design/icons";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { AiModel, api, EnvStatus, errText, SpeedResult, UpdateInfo, XtAccount } from "../api";
import { prefs } from "../store";
import UpdateModal from "../components/UpdateModal";
import { LANGS, langSetting, setLangSetting, systemLang, t, type Lang } from "../i18n";
import { setThemeSetting, themeSetting, type ThemeSetting } from "../theme";
import { setXuntongEnabled, xuntongEnabled } from "../features";

/** 把译文里的 {key} 换成一个元素（比如加粗的部分） */
const fill = (s: string, key: string, node: ReactNode) => {
  const i = s.indexOf(`{${key}}`);
  return i < 0 ? s : <>{s.slice(0, i)}{node}{s.slice(i + key.length + 2)}</>;
};

/** 界面语言：默认跟随系统，改了之后重新加载界面 */
function LanguageCard() {
  const [value, setValue] = useState<Lang | "auto">(langSetting());
  const sys = LANGS.find((l) => l.value === systemLang())?.label ?? "English";
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>{t("语言")} / Language</h2>
      <Select
        style={{ width: 260 }}
        value={value}
        onChange={(v) => {
          setValue(v);
          setLangSetting(v);
          location.reload();
        }}
        options={[{ value: "auto", label: t("跟随系统（{sys}）", { sys }) }, ...LANGS]}
      />
      <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>
        {t("译文由 AI 翻译，可能有不准确的地方，欢迎通过右上角「反馈」告诉我们。")}
      </div>
    </div>
  );
}

/** 外观：浅色 / 深色，默认跟随系统，改了之后重新加载界面 */
function ThemeCard() {
  const [value, setValue] = useState<ThemeSetting>(themeSetting());
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>{t("外观")}</h2>
      <Radio.Group
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setThemeSetting(e.target.value);
          location.reload();
        }}
        optionType="button"
        options={[
          { value: "auto", label: t("跟随系统") },
          { value: "light", label: t("浅色") },
          { value: "dark", label: t("深色") },
        ]}
      />
    </div>
  );
}

/** 关于与更新：当前版本、手动检查更新、自动检查开关 */
function UpdateCard() {
  const [auto, setAuto] = useState(prefs.get("updateCheck", "1") === "1");
  const [checking, setChecking] = useState(false);
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState("");
  const [installing, setInstalling] = useState(false);

  const check = async () => {
    setChecking(true);
    setError("");
    try {
      setInfo(await api.checkUpdate());
    } catch (e) {
      setError(errText(e));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ fontSize: 15, marginTop: 0 }}>{t("关于与更新")}</h2>
      <Space wrap>
        <Button icon={<ReloadOutlined />} loading={checking} onClick={check}>
          {t("检查更新")}
        </Button>
        {info && !info.newer && <span className="muted">{t("当前 v{v}，已经是最新版", { v: info.current })}</span>}
        {info?.newer && (
          <>
            <span>
              {fill(t("有新版本 {latest}（当前 v{current}）", { current: info.current }), "latest", <b>v{info.latest}</b>)}
            </span>
            <Button type="primary" onClick={() => setInstalling(true)}>
              {t("立即更新")}
            </Button>
            {info.url && (
              <Button onClick={() => api.openUrl(info.url).catch(() => {})}>
                {t("去下载")}
              </Button>
            )}
          </>
        )}
        {error && <span style={{ color: "var(--bad)" }}>{error}</span>}
      </Space>
      {info?.newer && info.notes && <div className="muted" style={{ marginTop: 8 }}>{info.notes}</div>}
      <UpdateModal info={info} open={installing} onClose={() => setInstalling(false)} />
      <div className="row" style={{ marginTop: 14, gap: 10, alignItems: "flex-start", flexWrap: "nowrap" }}>
        <Switch
          checked={auto}
          onChange={(v) => {
            setAuto(v);
            prefs.set("updateCheck", v ? "1" : "0");
          }}
        />
        <div>
          <div>{t("启动时自动检查更新")}</div>
          <div className="dim" style={{ fontSize: 12 }}>
            {t("检查时只发送软件版本、系统类型和一个随机的匿名编号，用来统计大概有多少人在用，不含图片、项目和任何个人信息。关掉后就不会再发这个请求。")}
          </div>
        </div>
      </div>
    </div>
  );
}

interface DlProgress {
  file: string;
  downloaded: number;
  total: number;
  speed: number;
}

const fmtSize = (b: number) => (b >= 1 << 30 ? `${(b / 2 ** 30).toFixed(2)} GB` : `${(b / 2 ** 20).toFixed(1)} MB`);
const fmtSpeed = (b: number) => (b >= 1 << 20 ? `${(b / 2 ** 20).toFixed(1)} MB/s` : `${(b / 1024).toFixed(0)} KB/s`);
const fmtEta = (p: DlProgress) => {
  if (!p.speed || p.total <= p.downloaded) return "";
  const s = Math.round((p.total - p.downloaded) / p.speed);
  return s >= 60 ? ` · ${t("剩余约 {m} 分 {s} 秒", { m: Math.floor(s / 60), s: s % 60 })}` : ` · ${t("剩余约 {s} 秒", { s })}`;
};

const VARIANTS = [
  { value: "cu130", label: t("CUDA 13.0（需要较新的驱动）") },
  { value: "cu128", label: t("CUDA 12.8（RTX 50 系列等新显卡）") },
  { value: "cu126", label: "CUDA 12.6" },
  { value: "cu118", label: t("CUDA 11.8（较老的显卡和驱动）") },
  { value: "cpu", label: t("CPU 版（没有 NVIDIA 显卡）") },
  { value: "mps", label: t("macOS 版（Apple 芯片用 MPS 加速）") },
];

export default function Settings() {
  const [xtOn, setXtOn] = useState(xuntongEnabled());
  const { message, modal } = App.useApp();
  const [st, setSt] = useState<EnvStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [variant, setVariant] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [progress, setProgress] = useState<DlProgress | null>(null);
  const [python, setPython] = useState("");
  const [root, setRoot] = useState("");
  const [speed, setSpeed] = useState<SpeedResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [aiUrl, setAiUrl] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [aiTesting, setAiTesting] = useState(false);
  /** 巡瞳 AI 连接状态：一直显示在设置里，不只是一闪而过的提示 */
  const [aiStatus, setAiStatus] = useState<
    { state: "unset" } | { state: "testing" } | { state: "ok"; models: AiModel[]; at: Date } | { state: "error"; text: string; at: Date } | null
  >(null);
  const logBox = useRef<HTMLDivElement>(null);

  const load = useCallback(
    async (refresh: boolean) => {
      setLoading(true);
      try {
        const s = await api.envStatus(refresh);
        setSt(s);
        setPython(s.settings.python ?? "");
        setRoot(s.settings.envRoot ?? "");
        setAiUrl(s.settings.aiUrl ?? "");
        setAiKey(s.settings.aiKey ?? "");
        setInstalling(s.installing);
      } catch (e) {
        message.error(errText(e));
      } finally {
        setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    const un = listen<string>("env-log", (e) => {
      setLines((ls) => [...ls.slice(-400), e.payload]);
      requestAnimationFrame(() => logBox.current?.scrollTo(0, logBox.current.scrollHeight));
    });
    const up = listen<DlProgress>("env-progress", (e) => setProgress(e.payload));
    return () => {
      un.then((f) => f());
      up.then((f) => f());
    };
  }, []);

  const install = async () => {
    const v = variant ?? st?.variant ?? "cpu";
    setInstalling(true);
    setLines([]);
    setProgress(null);
    try {
      await api.envInstall(v);
      message.success(t("训练环境安装完成"));
    } catch (e) {
      modal.error({ title: t("安装没有完成"), content: <pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{errText(e)}</pre>, width: 640 });
    } finally {
      setInstalling(false);
      setProgress(null);
      load(true);
    }
  };

  const runSpeedTest = async () => {
    const v = variant ?? st?.variant ?? "cpu";
    setTesting(true);
    setSpeed(null);
    try {
      const r = await api.speedTest(v);
      setSpeed(r);
      if (r.recommend !== (st?.settings.mirror ?? "china")) {
        await saveSettings({ mirror: r.recommend });
      }
      message.success(t("推荐使用{src}，已自动选择", { src: r.recommend === "china" ? t("国内镜像") : t("官方源") }));
    } catch (e) {
      message.error(errText(e));
    } finally {
      setTesting(false);
    }
  };

  const saveSettings = async (patch: Partial<EnvStatus["settings"]>) => {
    if (!st) return;
    try {
      await api.saveSettings({ ...st.settings, ...patch });
      await load(true);
    } catch (e) {
      message.error(errText(e));
    }
  };

  /** 调一次 /v1/models 验证 Key，结果常驻显示 */
  const testAi = useCallback(async () => {
    setAiStatus({ state: "testing" });
    try {
      const ms = await api.aiModels();
      setAiStatus({ state: "ok", models: ms, at: new Date() });
      // 账号名、套餐、额度（平台不支持时是 null）
      api
        .xtAccount()
        .then(setAccount)
        .catch(() => setAccount(null));
      return true;
    } catch (e) {
      setAiStatus({ state: "error", text: errText(e), at: new Date() });
      return false;
    }
  }, []);

  // 打开设置页时，填过 Key 就自动测一次
  const autoTested = useRef(false);
  useEffect(() => {
    if (!st || autoTested.current) return;
    autoTested.current = true;
    if (st.settings.aiKey) testAi();
    else setAiStatus({ state: "unset" });
  }, [st, testAi]);

  // ---------- 登录巡瞳账号 ----------

  const [account, setAccount] = useState<XtAccount | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [login, setLogin] = useState<{ deviceCode: string; userCode: string; verifyUrl: string } | null>(null);
  const loginRun = useRef(0);

  const cancelLogin = () => {
    loginRun.current++;
    setLogin(null);
  };

  const startLogin = async () => {
    if (!st) return;
    const run = ++loginRun.current;
    try {
      // 高级里改了平台地址的，先存下来（登录走这个地址）
      if ((aiUrl.trim() || null) !== (st.settings.aiUrl ?? null)) {
        await api.saveSettings({ ...st.settings, aiUrl: aiUrl.trim() || null });
      }
      const c = await api.xtLoginStart();
      if (run !== loginRun.current) return;
      setLogin({ deviceCode: c.deviceCode, userCode: c.userCode, verifyUrl: c.verifyUrl });
      let interval = c.interval;
      const deadline = Date.now() + c.expiresIn * 1000;
      while (run === loginRun.current) {
        await new Promise((r) => setTimeout(r, interval * 1000));
        if (run !== loginRun.current) return;
        if (Date.now() > deadline) throw t("登录码过期了，请重新点「登录巡瞳 AI 账号」");
        const r = await api.xtLoginPoll(c.deviceCode);
        if (r.status === "slow_down") interval += 5;
        else if (r.status === "expired") throw t("登录码过期了，请重新点「登录巡瞳 AI 账号」");
        else if (r.status === "denied") throw t("你在网页上选了拒绝");
        else if (r.status === "ok") {
          setLogin(null);
          await load(false);
          await testAi();
          message.success(r.account?.name ? t("已登录巡瞳 AI：{name}", { name: r.account.name }) : t("已登录巡瞳 AI"));
          return;
        }
      }
    } catch (e) {
      if (run === loginRun.current) {
        setLogin(null);
        message.error(errText(e));
      }
    }
  };

  const logoutAi = () =>
    modal.confirm({
      title: t("退出巡瞳 AI 账号？"),
      content: t("这台电脑上的 Key 会被删除（登录时自动创建的 Key 也会在平台上吊销）。巡瞳 AI 相关功能要重新登录才能用。"),
      okText: t("退出"),
      cancelText: t("取消"),
      onOk: async () => {
        try {
          await api.xtLogout();
          await load(false);
          setAccount(null);
          setAiStatus({ state: "unset" });
        } catch (e) {
          message.error(errText(e));
        }
      },
    });

  /** 保存巡瞳 AI 设置并测试连接 */
  const saveAi = async () => {
    if (!st) return;
    setAiTesting(true);
    try {
      await api.saveSettings({ ...st.settings, aiUrl: aiUrl.trim() || null, aiKey: aiKey.trim() || null });
      await load(false);
      if (aiKey.trim()) {
        if (await testAi()) message.success(t("巡瞳 AI 连接成功"));
        else message.error(t("巡瞳 AI 连接失败，原因见下方"));
      } else {
        setAiStatus({ state: "unset" });
        message.success(t("已保存（没有填 API Key）"));
      }
    } catch (e) {
      message.error(errText(e));
    } finally {
      setAiTesting(false);
    }
  };

  const info = st?.info as Record<string, string | number | boolean> | null | undefined;

  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <h1>{t("设置")}</h1>
      <p className="desc">{t("训练环境和下载源。标注、导入导出不需要训练环境。")}</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>
            {t("训练环境")}{" "}
            {st && (st.ready ? <Tag color="success" icon={<CheckCircleOutlined />}>{t("就绪")}</Tag> : <Tag color="warning">{t("未就绪")}</Tag>)}
          </h2>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={() => load(true)}>
            {t("重新检查")}
          </Button>
        </div>
        {!st ? (
          <Spin />
        ) : (
          <>
            <Descriptions column={1} size="small" bordered labelStyle={{ width: 140 }}>
              <Descriptions.Item label={t("显卡")}>
                {st.gpu
                  ? t("{name} · {mem} GB · 驱动 {driver} · 支持 CUDA {cuda}", { name: st.gpu.name, mem: (st.gpu.vramMb / 1024).toFixed(0), driver: st.gpu.driver, cuda: st.gpu.cuda })
                  : st.variant === "mps"
                    ? t("Mac：Apple 芯片用 MPS 加速训练（Intel 芯片的 Mac 只能用 CPU）")
                    : t("没有检测到 NVIDIA 显卡，只能用 CPU 训练（会慢很多）")}
              </Descriptions.Item>
              <Descriptions.Item label="Python">{st.python ?? <span className="dim">{t("未安装")}</span>}</Descriptions.Item>
              {info && (
                <Descriptions.Item label="PyTorch">
                  {info.torch ? (
                    `${info.torch} · ${info.cuda ? t("显卡可用（{device}）", { device: String(info.device) }) : info.mps ? t("Apple 芯片 MPS 加速可用") : "CPU"}`
                  ) : (
                    <span style={{ color: "var(--bad)" }}>{String(info.error ?? t("未安装"))}</span>
                  )}
                </Descriptions.Item>
              )}
              {st.error && (
                <Descriptions.Item label={t("问题")}>
                  <span style={{ color: "var(--bad)", whiteSpace: "pre-wrap" }}>{st.error}</span>
                </Descriptions.Item>
              )}
            </Descriptions>

            {st.managed && (
              <div style={{ marginTop: 16 }}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span>{t("PyTorch 版本")}</span>
                  <Select
                    style={{ width: 300 }}
                    value={variant ?? st.variant}
                    onChange={setVariant}
                    options={VARIANTS.filter((v) => (st.variant === "mps" ? v.value === "mps" : v.value !== "mps")).map((v) => ({
                      ...v,
                      label: v.value === st.variant ? t("{label}（推荐）", { label: v.label }) : v.label,
                    }))}
                  />
                  <Button type="primary" icon={<ToolOutlined />} loading={installing} onClick={install}>
                    {st.ready ? t("重新安装") : t("一键安装")}
                  </Button>
                </div>
                <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>
                  {t("GPU 版约 3GB，只需要一次。会自动下载 uv、Python 3.11、PyTorch。")}
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                  <span style={{ whiteSpace: "nowrap" }}>{t("安装位置")}</span>
                  <Input size="small" value={root} placeholder={t("默认：系统的本机数据目录（C 盘）")} onChange={(e) => setRoot(e.target.value)} />
                  <Button
                    size="small"
                    icon={<FolderOpenOutlined />}
                    onClick={async () => {
                      const d = await open({ directory: true, title: t("选择训练环境安装位置（建议空间大的盘）") });
                      if (typeof d === "string") setRoot(d);
                    }}
                  />
                  <Button size="small" disabled={(root.trim() || null) === (st.settings.envRoot || null)} onClick={() => saveSettings({ envRoot: root.trim() || null })}>
                    {t("保存")}
                  </Button>
                </div>
                <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>{t("当前：{dir}。改位置后需要重新安装。", { dir: st.envDir })}</div>
              </div>
            )}

            {installing && progress && progress.total > 0 && (
              <div style={{ marginTop: 12 }}>
                <Progress percent={Math.floor((progress.downloaded / progress.total) * 100)} status="active" />
                <div className="dim" style={{ fontSize: 12 }}>
                  {progress.file} · {fmtSize(progress.downloaded)} / {fmtSize(progress.total)} · {fmtSpeed(progress.speed)}
                  {fmtEta(progress)}
                </div>
              </div>
            )}

            {(installing || lines.length > 0) && (
              <div
                ref={logBox}
                style={{ marginTop: 12, height: 220, overflow: "auto", background: "var(--log-bg)", borderRadius: 6, padding: 10, font: "12px/1.6 Consolas, monospace", color: "var(--log-text)", whiteSpace: "pre-wrap", userSelect: "text" }}
              >
                {lines.join("\n")}
              </div>
            )}
          </>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>{t("下载源")}</h2>
          <Button size="small" icon={<ThunderboltOutlined />} loading={testing} onClick={runSpeedTest}>
            {t("测速并推荐")}
          </Button>
        </div>
        <Radio.Group value={st?.settings.mirror ?? "china"} onChange={(e) => saveSettings({ mirror: e.target.value })}>
          <Space direction="vertical">
            <Radio value="china">
              {t("国内镜像（阿里云、清华、npmmirror，推荐国内使用）")}
              {speed?.china != null && <Tag style={{ marginLeft: 8 }} color={speed.recommend === "china" ? "success" : "default"}>{speed.china.toFixed(1)} MB/s{speed.recommend === "china" ? ` · ${t("更快")}` : ""}</Tag>}
              {speed != null && speed.china == null && <Tag style={{ marginLeft: 8 }}>{t("连不上")}</Tag>}
            </Radio>
            <Radio value="official">
              {t("官方源（PyPI、download.pytorch.org）")}
              {speed?.official != null && <Tag style={{ marginLeft: 8 }} color={speed.recommend === "official" ? "success" : "default"}>{speed.official.toFixed(1)} MB/s{speed.recommend === "official" ? ` · ${t("更快")}` : ""}</Tag>}
              {speed != null && speed.official == null && <Tag style={{ marginLeft: 8 }}>{t("连不上")}</Tag>}
            </Radio>
          </Space>
        </Radio.Group>
        <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>
          {t("点「测速并推荐」会分别从两个源各拉几 MB 实测，自动勾选更快的。国内镜像也会让 SAM、文本提示模型从 hf-mirror.com 下载。")}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: xtOn ? 8 : 0 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>{t("巡瞳 AI")}</h2>
          <Switch
            checked={xtOn}
            onChange={(v) => {
              setXtOn(v);
              setXuntongEnabled(v);
            }}
          />
        </div>
        {!xtOn && (
          <div className="dim" style={{ fontSize: 12 }}>
            {t("巡瞳 AI 是国内的 AI 识别平台（自动标注、上传模型、拉取告警图片、官方中转）。打开后，标注、数据、部署、协作页会出现相关功能。")}
          </div>
        )}
        {xtOn && (
          <>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("登录巡瞳 AI 账号后可以：标注页用巡瞳 AI 自动标注（专用模型批量标注很快，也可以用大模型或按项目类别识别）、和 AI 聊识别规则；部署页把模型上传到巡瞳平台；数据页拉取平台的告警图片；协作用「巡瞳官方中转」让外网成员连进来。识别、聊天会消耗账号的额度。")}
        </p>
        <Space direction="vertical" style={{ width: "100%" }}>
          {aiStatus?.state === "ok" ? (
            <Alert
              type="success"
              showIcon
              message={
                <span>
                  {account?.name ? <>{t("已登录")}<b> {account.name}</b></> : t("已登录，可以使用")}
                  {account?.plan && <Tag style={{ marginLeft: 8 }}>{account.plan}</Tag>}
                  <span className="dim" style={{ fontSize: 12, marginLeft: 8 }}>
                    {t("{time} 检查", { time: aiStatus.at.toLocaleTimeString() })}
                  </span>
                </span>
              }
              description={
                <div>
                  {account?.quota && account.quota.length > 0 && (
                    <div style={{ marginBottom: 6 }}>
                      {account.quota.map((q) => (
                        <span key={q.name} style={{ marginRight: 16 }}>
                          {t("{name}：剩", { name: q.name })} <b>{q.total == null ? t("不限") : Math.max(0, q.total - (q.used ?? 0))}</b>
                          {q.total != null && ` / ${q.total}`} {q.unit ?? ""}
                          {q.expiresAt ? <span className="dim" style={{ fontSize: 12 }}>{t("（{date} 到期）", { date: new Date(q.expiresAt).toLocaleDateString() })}</span> : null}
                        </span>
                      ))}
                    </div>
                  )}
                  {account?.plan === "未开通套餐" && (
                    <div style={{ marginBottom: 6, color: "var(--warn)" }}>{t("账号还没有开通套餐，识别会失败，请先到巡瞳 AI 开通。")}</div>
                  )}
                  <div style={{ marginBottom: 4 }}>
                    {t("可用的识别方式（在标注页「AI 辅助 → 巡瞳 AI」里选）：")}
                  </div>
                  <Space size={[4, 4]} wrap>
                    {aiStatus.models.map((m) => (
                      <Tag key={m.code} color={m.code === "classes" || m.code === "llm" ? "blue" : undefined}>
                        {m.name}
                      </Tag>
                    ))}
                  </Space>
                  <div style={{ marginTop: 8 }}>
                    <Space>
                      <Button size="small" onClick={testAi}>
                        {t("刷新")}
                      </Button>
                      <Button size="small" onClick={logoutAi}>
                        {t("退出登录")}
                      </Button>
                    </Space>
                  </div>
                </div>
              }
            />
          ) : (
            <>
              {aiStatus?.state === "testing" && <Alert type="info" showIcon message={t("正在连接巡瞳 AI…")} />}
              {aiStatus?.state === "error" && (
                <Alert
                  type="error"
                  showIcon
                  message={t("连接失败（{time} 检查）", { time: aiStatus.at.toLocaleTimeString() })}
                  description={
                    <div>
                      <div>{aiStatus.text}</div>
                      <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                        {t("可以重新登录；手动填的 Key 请检查是否完整复制（以 sk-live- 开头）、在巡瞳控制台里是否启用、有没有设 IP 白名单。")}
                      </div>
                    </div>
                  }
                />
              )}
              <Space>
                <Button type="primary" icon={<UserOutlined />} loading={!!login} onClick={startLogin}>
                  {t("登录巡瞳 AI 账号")}
                </Button>
                <span className="dim" style={{ fontSize: 12 }}>
                  {t("在浏览器里登录巡瞳、点「允许」，Key 自动带回来，不用复制粘贴")}
                </span>
              </Space>
            </>
          )}
          <a style={{ fontSize: 12 }} onClick={() => setShowManual((v) => !v)}>
            {showManual ? t("收起") : t("高级：手动填 API Key、私有化部署的平台地址")}
          </a>
          {showManual && (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Input addonBefore={t("平台地址")} value={aiUrl} placeholder={t("留空就是 https://xuntongai.com（私有化部署时填自己的地址）")} onChange={(e) => setAiUrl(e.target.value)} />
              <Input.Password addonBefore="API Key" value={aiKey} placeholder={t("sk-live-…（在巡瞳 AI 控制台的「API Key」页创建）")} onChange={(e) => setAiKey(e.target.value)} />
              <Button loading={aiTesting} onClick={saveAi}>
                {t("保存并测试连接")}
              </Button>
            </Space>
          )}
        </Space>
      
          </>
        )}
      </div>

      <Modal
        title={t("登录巡瞳 AI 账号")}
        open={!!login}
        onCancel={cancelLogin}
        footer={<Button onClick={cancelLogin}>{t("取消")}</Button>}
        width={460}
        destroyOnHidden
      >
        {login && (
          <div style={{ textAlign: "center", padding: "8px 0" }}>
            <div style={{ marginBottom: 12 }}>{t("已在浏览器里打开巡瞳 AI，登录后点「允许」，这里会自动完成。")}</div>
            <div className="dim" style={{ fontSize: 12 }}>{t("确认码（网页上显示的要和这个一样）")}</div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4, margin: "4px 0 12px" }}>{login.userCode}</div>
            <Spin size="small" /> <span className="muted">{t("等待你在浏览器里确认…")}</span>
            <div style={{ marginTop: 14, fontSize: 12 }}>
              {t("浏览器没打开？")}
              <a onClick={() => api.openUrl(login.verifyUrl).catch(() => {})}>{t("重新打开")}</a>
              {t("，或者复制地址：")}
              <Typography.Text copyable style={{ fontSize: 12 }}>
                {login.verifyUrl}
              </Typography.Text>
            </div>
            <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
              {t("网页上「允许」点不了？可能是 Key 数量满了，去巡瞳控制台「API Key」页停用一个不用的 Key 再试。")}
            </div>
          </div>
        )}
      </Modal>
      <div className="card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>{t("使用已有的 Python 环境（高级）")}</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          {t("已经有装好 PyTorch 的环境可以直接指定，就不用再下载。需要 torch、torchvision、numpy、pillow，导出 ONNX 还需要 onnx。")}
        </p>
        <Space.Compact style={{ width: "100%" }}>
          <Input value={python} placeholder={t("例如 D:\\envs\\torch\\Scripts\\python.exe（留空则用软件自己安装的环境）")} onChange={(e) => setPython(e.target.value)} />
          <Button
            icon={<FolderOpenOutlined />}
            onClick={async () => {
              const f = await open({ title: t("选择 python.exe"), filters: [{ name: "Python", extensions: ["exe", ""] }] });
              if (typeof f === "string") setPython(f);
            }}
          />
          <Button type="primary" onClick={() => saveSettings({ python: python.trim() || null })}>
            {t("保存")}
          </Button>
        </Space.Compact>
        {st && !st.managed && (
          <Alert style={{ marginTop: 10 }} type="info" showIcon message={t("正在使用你指定的 Python 环境。清空后保存可改回软件自己管理的环境。")} />
        )}
      </div>
      <LanguageCard />
      <ThemeCard />
      <UpdateCard />
    </div>
  );
}
