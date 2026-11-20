import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntApp, ConfigProvider, theme } from "antd";
import type { Locale } from "antd/es/locale";
import { initI18n, type Lang } from "./i18n";
import { isRemote } from "./transport";
import "./styles.css";

/** 界面组件库（按钮、分页、日期等）自带文字的语言 */
const ANTD_LOCALES: Record<Lang, () => Promise<{ default: Locale }>> = {
  zh: () => import("antd/locale/zh_CN"),
  "zh-TW": () => import("antd/locale/zh_TW"),
  en: () => import("antd/locale/en_US"),
  ja: () => import("antd/locale/ja_JP"),
  ko: () => import("antd/locale/ko_KR"),
  es: () => import("antd/locale/es_ES"),
  pt: () => import("antd/locale/pt_BR"),
  ru: () => import("antd/locale/ru_RU"),
  de: () => import("antd/locale/de_DE"),
  fr: () => import("antd/locale/fr_FR"),
  vi: () => import("antd/locale/vi_VN"),
  id: () => import("antd/locale/id_ID"),
};

const FONTS: Partial<Record<Lang, string>> = {
  zh: '"Microsoft YaHei UI","PingFang SC",system-ui,sans-serif',
  "zh-TW": '"Microsoft JhengHei UI","PingFang TC",system-ui,sans-serif',
  ja: '"Yu Gothic UI","Hiragino Sans",system-ui,sans-serif',
  ko: '"Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif',
};

// 先加载语言包，再加载界面（界面模块顶层的常量里也用了 t()）
async function start() {
  const lang = await initI18n();
  if (!isRemote) {
    // 后端的提示和训练日志也用同一种语言
    import("@tauri-apps/api/core").then(({ invoke }) => invoke("set_language", { lang })).catch(() => {});
  }
  const [{ default: antdLocale }, { default: App }, { default: RemoteApp }] = await Promise.all([
    ANTD_LOCALES[lang]().catch(() => import("antd/locale/en_US")),
    import("./App"),
    import("./RemoteApp"),
  ]);
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ConfigProvider
        locale={antdLocale}
        theme={{
          algorithm: theme.darkAlgorithm,
          token: {
            colorPrimary: "#3d8bfd",
            colorBgBase: "#14161a",
            colorBgContainer: "#1b1e23",
            colorBgElevated: "#22262c",
            colorBorder: "#2e333a",
            colorBorderSecondary: "#2e333a",
            borderRadius: 6,
            fontFamily: FONTS[lang] ?? 'system-ui,"Segoe UI",Roboto,"Microsoft YaHei UI",sans-serif',
          },
        }}
      >
        <AntApp>{isRemote ? <RemoteApp /> : <App />}</AntApp>
      </ConfigProvider>
    </React.StrictMode>,
  );
}

start();
