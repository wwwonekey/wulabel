/**
 * 浅色 / 深色主题。默认跟随系统（系统是深色模式才用深色），设置里可以手动选。
 * 颜色变量在 styles.css 里，:root 是深色，[data-theme="light"] 覆盖成浅色；界面组件库的配色在 main.tsx。
 * 不引用别的模块（main.tsx 一开始就要用）。
 */

export type ThemeSetting = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

const KEY = "xlabel.theme";

export function themeSetting(): ThemeSetting {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setThemeSetting(v: ThemeSetting) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* 忽略 */
  }
}

function systemDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

/** 实际用的主题 */
export function resolveTheme(): Theme {
  const s = themeSetting();
  return s === "auto" ? (systemDark() ? "dark" : "light") : s;
}

/** 启动时调用：给页面打上主题标记；跟随系统时，系统切换深浅色后重新加载界面 */
export function initTheme(): Theme {
  const th = resolveTheme();
  document.documentElement.dataset.theme = th;
  document.documentElement.style.colorScheme = th;
  try {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (themeSetting() === "auto" && resolveTheme() !== document.documentElement.dataset.theme) location.reload();
    });
  } catch {
    /* 老浏览器没有这个事件，忽略 */
  }
  return th;
}
