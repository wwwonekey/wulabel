/** 各版本更新内容，更新后第一次打开软件时显示（新版本在前）。发版时在最前面加一条。 */
export const CHANGELOG: { version: string; items: string[] }[] = [
  {
    version: "0.4.2",
    items: [
      "训练时显存不够不再直接失败：自动把批大小减半、从头重新训练，训练记录里会注明实际用的批大小。",
      "意见反馈可以勾选附带运行日志（最近的训练日志和出错信息，不含图片和标注），方便作者排查问题。",
      "新增 ARM64 版 Linux（飞腾、鲲鹏等国产 ARM 电脑），.deb 和 AppImage 都有。",
      "用 .deb 安装的 Linux 版也能软件内全自动更新了。",
      "更新完第一次打开时，会显示这一版更新了什么（就是这个窗口）。",
    ],
  },
  {
    version: "0.4.1",
    items: ["全自动更新：点「立即更新」后软件自己下载、校验签名、安装并重启。"],
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
