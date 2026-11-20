/**
 * 界面多语言。
 *
 * 写法：界面上的文字都用 t("中文原文") 包起来，中文原文就是词条的键；带变量的写成
 * t("训练集 {n} 张", { n: 12 })。各语言的译文在 locales/<语言>.json 里（键是中文原文，值是译文），
 * 中文不用语言包。某条没翻译时先用英文，英文也没有就显示中文原文。
 *
 * 语言默认跟随系统（中文系统显示中文，没有对应语言包的显示英文），设置里可以手动改。
 * 启动时先加载语言包再加载界面（见 main.tsx），所以模块顶层的常量里也能用 t()；
 * 切换语言后重新加载页面生效。
 * 同一个中文在不同地方意思不同（如「关闭」按钮和「关闭」状态），键写成 "关闭@@状态"，中文界面只显示 @@ 前面的部分。
 */

// 不引用别的模块（store、api 等会反过来引用这里，循环引用时这里还没初始化）
function readPref(): string {
  try {
    return localStorage.getItem("xlabel.lang") ?? "auto";
  } catch {
    return "auto";
  }
}

export type Lang = "zh" | "zh-TW" | "en" | "ja" | "ko" | "es" | "pt" | "ru" | "de" | "fr" | "vi" | "id";

/** 设置里的语言列表（用各自语言写名字） */
export const LANGS: { value: Lang; label: string }[] = [
  { value: "zh", label: "简体中文" },
  { value: "zh-TW", label: "繁體中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
  { value: "es", label: "Español" },
  { value: "pt", label: "Português" },
  { value: "ru", label: "Русский" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "id", label: "Bahasa Indonesia" },
];

type Dict = Record<string, string>;
const packs = import.meta.glob<Dict>("./locales/*.json", { import: "default" });

let lang: Lang = "zh";
let dict: Dict = {};
let fallback: Dict = {};

/** 按系统语言选：简体中文地区 → zh，港澳台 → zh-TW，其他按语言前缀，没有的用英文 */
export function systemLang(): Lang {
  const list = (navigator.languages?.length ? navigator.languages : [navigator.language]).map((l) => l.toLowerCase());
  for (const l of list) {
    if (l.startsWith("zh")) {
      return /hant|tw|hk|mo/.test(l) ? "zh-TW" : "zh";
    }
    const p = l.split("-")[0];
    const hit = LANGS.find((x) => x.value === p);
    if (hit) return hit.value;
  }
  return "en";
}

/** 用户在设置里选的语言，"auto" 表示跟随系统 */
export function langSetting(): Lang | "auto" {
  const v = readPref();
  return v === "auto" || LANGS.some((l) => l.value === v) ? (v as Lang | "auto") : "auto";
}

export function setLangSetting(v: Lang | "auto") {
  try {
    localStorage.setItem("xlabel.lang", v);
  } catch {
    /* 忽略 */
  }
}

export function currentLang(): Lang {
  return lang;
}

async function load(l: Lang): Promise<Dict> {
  const f = packs[`./locales/${l}.json`];
  return f ? f().catch(() => ({})) : {};
}

/** 启动时调用一次，加载完语言包再渲染界面 */
export async function initI18n(): Promise<Lang> {
  const s = langSetting();
  lang = s === "auto" ? systemLang() : s;
  if (lang !== "zh") {
    [dict, fallback] = await Promise.all([load(lang), lang === "en" ? Promise.resolve({}) : load("en")]);
  }
  document.documentElement.lang = lang === "zh" ? "zh-CN" : lang;
  return lang;
}

/** 翻译。zh 是中文原文（也是词条的键），vars 替换里面的 {名字} */
export function t(zh: string, vars?: Record<string, string | number | null | undefined>): string {
  // 同一个中文在不同地方意思不同时，键后面加「@@说明」区分（如 "关闭@@状态" 译成 Off），中文只显示 @@ 前面的部分
  const shown = zh.includes("@@") ? zh.slice(0, zh.indexOf("@@")) : zh;
  let s = lang === "zh" ? shown : dict[zh] || fallback[zh] || shown;
  if (vars) {
    for (const k in vars) s = s.split(`{${k}}`).join(String(vars[k] ?? ""));
  }
  return s;
}
