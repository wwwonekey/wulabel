import { t } from "./i18n";

/** 各版本更新内容，更新后第一次打开软件时显示（新版本在前）。发版时在最前面加一条。 */
export const CHANGELOG: { version: string; items: string[] }[] = [
  {
    version: "0.5.2",
    items: [
      t("「看使用教程」和更新提示里的官网链接，按界面语言打开对应语言的页面；反馈、检查更新时服务器返回的提示也跟随界面语言。"),
      t("巡瞳 AI 是国内平台，非中文界面默认隐藏相关功能，需要的话在「设置 → 巡瞳 AI」里打开。"),
      t("修正越南语、俄语、印尼语、西班牙语、德语里几处不通顺或前后不一致的译文。"),
      t("Linux 版视频抽帧也会自动下载 ffmpeg，不用再手动安装。"),
    ],
  },
  {
    version: "0.5.1",
    items: [
      t("新增浅色主题：默认跟随系统的浅色或深色，也可以在「设置 → 外观」里切换。标注画布等看图的区域仍是深色，看图更准。"),
      t("窗口较窄或使用英文等较长的语言时，首页新手引导和左侧导航不再挤在一起。"),
    ],
  },
  {
    version: "0.5.0",
    items: [
      t("国际版：界面支持 12 种语言（简体中文、繁體中文、English、日本語、한국어、Español、Português、Русский、Deutsch、Français、Tiếng Việt、Bahasa Indonesia），默认跟随系统语言，可以在「设置」里切换。"),
      t("训练日志、出错提示、交付报告和推理服务包的说明也按界面语言显示。"),
      t("官网和使用教程也有了各语言版本。译文由 AI 翻译，发现不准确的地方欢迎点右上角「反馈」告诉我们。"),
    ],
  },
  {
    version: "0.4.2",
    items: [
      t("训练时显存不够不再直接失败：自动把批大小减半、从头重新训练，训练记录里会注明实际用的批大小。"),
      t("意见反馈可以勾选附带运行日志（最近的训练日志和出错信息，不含图片和标注），方便作者排查问题。"),
      t("新增 ARM64 版 Linux（飞腾、鲲鹏等国产 ARM 电脑），.deb 和 AppImage 都有。"),
      t("用 .deb 安装的 Linux 版也能软件内全自动更新了。"),
      t("修复 RTSP 视频流抽帧：超时设置对 RTSP 不生效、断流时会一直卡住；TCP 连不上会自动改用 UDP 再试，账号密码错、地址路径错会直接说明原因。"),
      t("更新完第一次打开时，会显示这一版更新了什么（就是这个窗口）。"),
    ],
  },
  {
    version: "0.4.1",
    items: [t("全自动更新：点「立即更新」后软件自己下载、校验签名、安装并重启。")],
  },
];

function parse(v: string): number[] {
  return v
    .replace(/^v/, "")
    .split("-")[0]
    .split(".")
    .map((p) => parseInt(p, 10) || 0);
}

export function versionGt(a: string, b: string): boolean {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/** 从 from（不含）到 to（含）之间各版本的更新内容；from 为空时只给 to 这一版 */
export function notesBetween(from: string, to: string) {
  return CHANGELOG.filter((c) => !versionGt(c.version, to) && (from ? versionGt(c.version, from) : c.version === to));
}
