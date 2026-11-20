/** 可以按需打开的功能 */

import { currentLang } from "./i18n";
import { prefs } from "./store";

/**
 * 巡瞳 AI（自动标注、识别规则、上传平台、拉告警图、官方中转）是国内平台的服务，
 * 简体中文界面默认显示，其他语言默认隐藏，设置里可以手动打开。
 */
export function xuntongEnabled(): boolean {
  return prefs.get("xuntong", currentLang() === "zh" ? "1" : "0") === "1";
}

export function setXuntongEnabled(v: boolean) {
  prefs.set("xuntong", v ? "1" : "0");
}
