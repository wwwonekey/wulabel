//! 使用反馈上报：软件内把问题描述和截图发到作者邮箱。
//!
//! 客户端只负责收集 + 签名 + 发送到反馈服务，真正的发信和防刷都在服务端
//! （server/feedback/）。收件邮箱不在客户端出现，避免被逆向后直接拿去刷。

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::t;

// ———————————————— 部署相关 ————————————————
// 反馈服务入口：官网子域 feedback.xiaowuiot.com，由服务器 nginx 反代到反馈后端
// （本机 127.0.0.1:8094）。自建部署改成你自己的地址即可。
const FEEDBACK_ENDPOINT: &str = "https://feedback.xiaowuiot.com/feedback";
// 客户端与服务端共享的签名密钥。源码开源，所以这里只放占位符；正式打包时用环境
// 变量 WULABEL_FEEDBACK_SECRET 注入真实密钥（要和服务端 .env 的 APP_SECRET 一致）：
//   PowerShell:  $env:WULABEL_FEEDBACK_SECRET="<密钥>"; npm run tauri build
// 签名只能挡“随手用脚本刷接口”这类低端滥用，真正兜底的是服务端限流和发信上限。
const FEEDBACK_APP_SECRET: &str = match option_env!("WULABEL_FEEDBACK_SECRET") {
    Some(s) => s,
    None => "wulabel-public-placeholder",
};

const MAX_MESSAGE_CHARS: usize = 2000;
const MAX_SHOT_BASE64: usize = 3_000_000; // 约 2.2MB 的 PNG/JPEG
const ALLOW_SKEW_SECS: u64 = 300;

#[derive(Deserialize)]
pub struct FeedbackInput {
    pub message: String,
    pub contact: Option<String>,
    /// 截图，dataURL（data:image/...;base64,xxx）或纯 base64，可空。
    pub screenshot: Option<String>,
    /// 运行日志（v0.4.2 起，用户勾选了才有），见 feedback_logs
    pub logs: Option<String>,
}

#[derive(Serialize)]
struct FeedbackPayload {
    message: String,
    contact: String,
    app_version: String,
    os: String,
    device_id: String,
    screenshot: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    logs: String,
    ts: u64,
    sign: String,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// 把共享密钥派生成 32 字节的 keyed-hash 密钥（和服务端一致）。
fn sign_key() -> [u8; 32] {
    *blake3::hash(FEEDBACK_APP_SECRET.as_bytes()).as_bytes()
}

fn hex_hash(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

/// 对关键字段签名，防篡改 + 防重放（带时间戳）。服务端用同样算法重算比对。
/// 带日志时多签一行日志的哈希（老版本没有这一行，服务端两种都认）。
fn sign(ts: u64, device_id: &str, message: &str, shot_b64: &str, logs: &str) -> String {
    let mut input = format!(
        "{ts}\n{device_id}\n{}\n{}",
        hex_hash(message.as_bytes()),
        hex_hash(shot_b64.as_bytes()),
    );
    if !logs.is_empty() {
        input.push('\n');
        input.push_str(&hex_hash(logs.as_bytes()));
    }
    blake3::keyed_hash(&sign_key(), input.as_bytes()).to_hex().to_string()
}

/// 读取或生成一个匿名设备标识，持久化到配置目录。只用于服务端按设备限流，
/// 不含任何真实身份信息。
pub(crate) fn device_id(app: &tauri::AppHandle) -> String {
    let Ok(dir) = app.path().app_config_dir() else {
        return "unknown".into();
    };
    let f = dir.join("device.id");
    if let Ok(s) = std::fs::read_to_string(&f) {
        let s = s.trim();
        if !s.is_empty() {
            return s.to_string();
        }
    }
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let seed = format!("{}-{}-{}", nanos, std::process::id(), dir.display());
    let id = blake3::hash(seed.as_bytes()).to_hex()[..24].to_string();
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&f, &id);
    id
}

/// 反馈服务返回的是中文提示，按界面语言翻译（服务端的原话就是词条的键）
fn server_error(s: &str) -> String {
    match s {
        "今天提交的反馈已经比较多了，明天再试吧" => t!("今天提交的反馈已经比较多了，明天再试吧"),
        "截图太大" => t!("截图太大"),
        "提交太频繁，请过一会儿再试" => t!("提交太频繁，请过一会儿再试"),
        "服务器繁忙，请稍后再试" => t!("服务器繁忙，请稍后再试"),
        "签名校验失败" => t!("签名校验失败"),
        "设备时间和服务器相差太大，请校准时间后重试" => t!("设备时间和服务器相差太大，请校准时间后重试"),
        "请求参数不完整" => t!("请求参数不完整"),
        "请求格式不对" => t!("请求格式不对"),
        "运行日志太长" => t!("运行日志太长"),
        "问题描述不能为空" => t!("问题描述不能为空"),
        "问题描述太长" => t!("问题描述太长"),
        _ if s.starts_with("服务端发送失败") => t!("服务端发送邮件失败，请稍后再试"),
        _ => s.to_string(),
    }
}

#[tauri::command]
pub async fn submit_feedback(app: tauri::AppHandle, input: FeedbackInput) -> Result<(), String> {
    let message = input.message.trim().to_string();
    if message.is_empty() {
        return Err(t!("请先填写问题描述"));
    }
    if message.chars().count() > MAX_MESSAGE_CHARS {
        return Err(t!("问题描述太长（最多 {max} 字）", max = MAX_MESSAGE_CHARS));
    }

    // 去掉 dataURL 前缀，只留纯 base64，前后端对同一字符串签名/校验。
    let raw_shot = input.screenshot.unwrap_or_default();
    let shot = raw_shot.split_once(',').map(|(_, b)| b.to_string()).unwrap_or(raw_shot);
    if shot.len() > MAX_SHOT_BASE64 {
        return Err(t!("截图太大，请去掉截图后再提交"));
    }

    let contact = input.contact.unwrap_or_default().trim().to_string();
    let device = device_id(&app);
    let ts = now_secs();
    let app_version = env!("CARGO_PKG_VERSION").to_string();
    let os = format!("{} {}", std::env::consts::OS, std::env::consts::ARCH);
    let logs: String = input.logs.unwrap_or_default().chars().take(MAX_LOGS_CHARS + 100).collect();
    let sign = sign(ts, &device, &message, &shot, &logs);

    let payload = FeedbackPayload {
        message,
        contact,
        app_version,
        os,
        device_id: device,
        screenshot: shot,
        logs,
        ts,
        sign,
    };
    let body = serde_json::to_string(&payload).map_err(|e| e.to_string())?;

    // ureq 是阻塞调用，放到阻塞线程池，别卡住异步运行时。
    let result = tauri::async_runtime::spawn_blocking(move || {
        ureq::post(FEEDBACK_ENDPOINT)
            .timeout(Duration::from_secs(20))
            .set("Content-Type", "application/json; charset=utf-8")
            .send_string(&body)
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(_) => Ok(()),
        Err(ureq::Error::Status(code, resp)) => {
            let text = resp.into_string().unwrap_or_default();
            let msg = serde_json::from_str::<serde_json::Value>(&text)
                .ok()
                .and_then(|v| v.get("error").and_then(|e| e.as_str()).map(server_error))
                .unwrap_or_else(|| match code {
                    429 => t!("提交太频繁，请稍后再试"),
                    _ => t!("提交失败（{code}）", code = code),
                });
            Err(msg)
        }
        Err(e) => Err(t!("网络连接失败，请检查网络后重试：{e}", e = e)),
    }
}

// 让 ALLOW_SKEW_SECS 在客户端也有意义：时间偏差过大时服务端会拒，这里仅做个本地提示的占位。
#[allow(dead_code)]
const _SKEW: u64 = ALLOW_SKEW_SECS;

const MAX_LOGS_CHARS: usize = 200_000;

/// 把路径里的用户目录换成 ~，免得日志里带出电脑用户名
fn hide_home(s: &str) -> String {
    let mut out = s.to_string();
    for var in ["USERPROFILE", "HOME"] {
        if let Ok(h) = std::env::var(var) {
            let h = h.trim_end_matches(['/', '\\']);
            if h.len() > 3 {
                out = out.replace(h, "~").replace(&h.replace('\\', "/"), "~");
            }
        }
    }
    out
}

fn tail(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

/// 反馈附带的运行日志：训练环境（不含设置里的 AI 密钥等）、当前项目最近两次训练的日志和出错信息。
/// 不含图片、标注和项目数据。
#[tauri::command]
pub async fn feedback_logs(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::fmt::Write;
        let mut s = String::new();
        let _ = writeln!(s, "Wulabel {} · {} {}", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH);

        let rt = app.state::<crate::runtime::Runtime>();
        let env = rt.status(false);
        let _ = writeln!(s, "\n## 训练环境");
        let _ = writeln!(s, "托管环境：{}，可用：{}，推荐 PyTorch：{}", env.managed, env.ready, env.variant);
        if !env.missing.is_empty() {
            let _ = writeln!(s, "缺的组件：{}", env.missing.join(", "));
        }
        if let Some(g) = &env.gpu {
            let _ = writeln!(s, "显卡：{}", serde_json::to_string(g).unwrap_or_default());
        }
        if let Some(i) = &env.info {
            let _ = writeln!(s, "检查结果：{i}");
        }
        if let Some(e) = &env.error {
            let _ = writeln!(s, "环境错误：{e}");
        }
        if let Ok(l) = std::fs::read_to_string(rt.install_log_path()) {
            let _ = writeln!(s, "\n### 安装日志（最后 150 行）\n{}", tail(&l, 150));
        }

        if let Some(p) = app.state::<crate::state::AppState>().try_current() {
            let _ = writeln!(s, "\n## 当前项目\n任务：{}", p.meta.task);
            if let Ok(runs) = crate::training::list_runs(&p) {
                for r in runs.iter().take(2) {
                    let dir = std::path::Path::new(&r.dir);
                    let mut cfg = r.config.clone();
                    if let Some(o) = cfg.as_object_mut() {
                        o.remove("classes");
                    }
                    let _ = writeln!(s, "\n### 训练 {}（{}）\n配置：{cfg}", r.name, r.status);
                    if let Ok(e) = std::fs::read_to_string(dir.join("error.txt")) {
                        let _ = writeln!(s, "出错信息：\n{}", tail(&e, 80));
                    }
                    if let Ok(l) = std::fs::read_to_string(dir.join("log.txt")) {
                        let _ = writeln!(s, "日志（最后 150 行）：\n{}", tail(&l, 150));
                    }
                }
            }
        }
        let s = hide_home(&s);
        if s.chars().count() > MAX_LOGS_CHARS {
            let cut: String = s.chars().rev().take(MAX_LOGS_CHARS).collect::<Vec<_>>().into_iter().rev().collect();
            return format!("（前面的内容太长已省略）\n{cut}");
        }
        s
    })
    .await
    .map_err(|e| e.to_string())
}
