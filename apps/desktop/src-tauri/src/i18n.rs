//! 后端提示语的多语言（和前端 src/i18n.ts 一样的规则）。
//!
//! 写法：`t!("中文原文")`，带变量 `t!("无法启动 ffmpeg：{e}", e = e)`。中文原文就是词条的键，
//! 译文在 src-tauri/locales/<语言>.json（打包进程序）。没翻译的先用英文，英文也没有就用中文。
//! 语言由前端启动时调用 set_language 告诉后端；训练、推理进程通过环境变量 WULABEL_LANG 拿到。

use std::collections::HashMap;
use std::sync::RwLock;

/// 中文原文 → 译文，变量写成 {名字}
#[macro_export]
macro_rules! t {
    ($s:literal) => {
        $crate::i18n::lookup($s)
    };
    ($s:literal, $($k:ident = $v:expr),+ $(,)?) => {{
        let mut out = $crate::i18n::lookup($s);
        $( out = out.replace(concat!("{", stringify!($k), "}"), &($v).to_string()); )+
        out
    }};
}

fn pack(lang: &str) -> &'static str {
    match lang {
        "en" => include_str!("../locales/en.json"),
        "zh-TW" => include_str!("../locales/zh-TW.json"),
        "ja" => include_str!("../locales/ja.json"),
        "ko" => include_str!("../locales/ko.json"),
        "es" => include_str!("../locales/es.json"),
        "pt" => include_str!("../locales/pt.json"),
        "ru" => include_str!("../locales/ru.json"),
        "de" => include_str!("../locales/de.json"),
        "fr" => include_str!("../locales/fr.json"),
        "vi" => include_str!("../locales/vi.json"),
        "id" => include_str!("../locales/id.json"),
        _ => "{}",
    }
}

struct State {
    lang: String,
    dict: HashMap<String, String>,
    en: HashMap<String, String>,
}

static STATE: RwLock<Option<State>> = RwLock::new(None);

fn parse(lang: &str) -> HashMap<String, String> {
    serde_json::from_str(pack(lang)).unwrap_or_default()
}

/// 切换语言（zh / zh-TW / en / ja / ...），不认识的当英文
pub fn set(lang: &str) {
    let lang = match lang {
        "zh" | "zh-TW" | "en" | "ja" | "ko" | "es" | "pt" | "ru" | "de" | "fr" | "vi" | "id" => lang,
        _ => "en",
    };
    let dict = if lang == "zh" { HashMap::new() } else { parse(lang) };
    let en = if lang == "zh" || lang == "en" { HashMap::new() } else { parse("en") };
    *STATE.write().unwrap() = Some(State { lang: lang.to_string(), dict, en });
}

/// 当前语言，前端还没设置时是中文
pub fn lang() -> String {
    STATE.read().unwrap().as_ref().map(|s| s.lang.clone()).unwrap_or_else(|| "zh".into())
}

pub fn lookup(zh: &str) -> String {
    let st = STATE.read().unwrap();
    match st.as_ref() {
        Some(s) if s.lang != "zh" => s.dict.get(zh).or_else(|| s.en.get(zh)).cloned().unwrap_or_else(|| zh.to_string()),
        _ => zh.to_string(),
    }
}

#[tauri::command]
pub fn set_language(lang: String) {
    set(&lang);
}

#[cfg(test)]
mod tests {
    #[test]
    fn fallback_and_vars() {
        super::set("zh");
        assert_eq!(crate::t!("文件 {n} 个", n = 3), "文件 3 个");
        super::set("xx");
        assert_eq!(super::lang(), "en");
        // 没有译文时用中文原文
        assert_eq!(crate::t!("这一条肯定没有译文"), "这一条肯定没有译文");
        super::set("zh");
    }
}
