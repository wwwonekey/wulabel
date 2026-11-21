//! 模型下载进度：worker 下载预训练权重、SAM、文本检测模型时发 download 事件，
//! 这里转发给前端（download-progress），界面右下角显示进度条。

use std::sync::OnceLock;

use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

/// 转发一条 worker 的 download 事件（name、done、total、speed、finished / failed）
pub fn forward(ev: &serde_json::Value) {
    if let Some(app) = APP.get() {
        let _ = app.emit("download-progress", ev);
    }
}
