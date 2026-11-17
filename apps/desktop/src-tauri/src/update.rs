//! 检查更新：问一下服务端有没有新版本。
//!
//! 请求里只带软件版本、系统类型和一个随机的匿名编号（和反馈用的是同一个），
//! 服务端据此统计大概有多少台电脑在用、各在用哪个版本。不带图片、项目和任何个人信息。
//! 用户可以在设置里关掉自动检查。

use std::time::Duration;

use serde::{Deserialize, Serialize};

// 和反馈服务是同一个后端（server/feedback/）。自建部署改成你自己的地址即可。
const UPDATE_ENDPOINT: &str = "https://feedback.xiaowuiot.com/update";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub newer: bool,
    /// 下载页地址
    pub url: String,
    /// 新版本说明，可空
    pub notes: String,
    /// 本系统的安装包直链和 SHA-256，有的话界面上可以「立即更新」；没有就只能去下载页
    pub download_url: String,
    pub sha256: String,
}

#[derive(Deserialize, Default)]
struct DownloadResp {
    url: Option<String>,
    sha256: Option<String>,
}

#[derive(Deserialize)]
struct UpdateResp {
    latest: Option<String>,
    url: Option<String>,
    notes: Option<String>,
    download: Option<DownloadResp>,
}

fn parse_version(v: &str) -> [u64; 3] {
    let mut out = [0u64; 3];
    let core = v.trim().trim_start_matches('v').split('-').next().unwrap_or("");
    for (i, p) in core.split('.').take(3).enumerate() {
        out[i] = p.trim().parse().unwrap_or(0);
    }
    out
}

fn version_gt(a: &str, b: &str) -> bool {
    parse_version(a) > parse_version(b)
}

#[tauri::command]
pub async fn check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let device = crate::feedback::device_id(&app);
    let cur = current.clone();

    // ureq 是阻塞调用，放到阻塞线程池
    let result = tauri::async_runtime::spawn_blocking(move || {
        ureq::get(UPDATE_ENDPOINT)
            .timeout(Duration::from_secs(8))
            .query("v", &cur)
            .query("os", std::env::consts::OS)
            .query("arch", std::env::consts::ARCH)
            .query("id", &device)
            .call()
    })
    .await
    .map_err(|e| e.to_string())?;

    let text = match result {
        Ok(resp) => resp.into_string().map_err(|e| e.to_string())?,
        Err(ureq::Error::Status(code, _)) => return Err(format!("检查更新失败（{code}）")),
        Err(e) => return Err(format!("网络连接失败：{e}")),
    };
    let r: UpdateResp = serde_json::from_str(&text).map_err(|_| "检查更新失败：服务端返回的内容不对".to_string())?;
    let latest = r.latest.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| current.clone());
    let dl = r.download.unwrap_or_default();
    let download_url = dl.url.unwrap_or_default();
    Ok(UpdateInfo {
        newer: version_gt(&latest, &current),
        current,
        latest,
        url: r.url.unwrap_or_default(),
        notes: r.notes.unwrap_or_default(),
        download_url: if trusted_url(&download_url) { download_url } else { String::new() },
        sha256: dl.sha256.unwrap_or_default().to_lowercase(),
    })
}

/// 只从官网和 GitHub 发行版下载安装包
fn trusted_url(url: &str) -> bool {
    url.starts_with("https://wulabel.xiaowuiot.com/download/")
        || url.starts_with("https://github.com/xiaowu-iot/wulabel/releases/download/")
}

#[derive(Serialize, Clone)]
struct Progress {
    downloaded: u64,
    total: u64,
}

/// 下载新版安装包、核对 SHA-256，然后打开安装程序并退出软件。
/// Windows：运行安装程序，按提示点「下一步」即可覆盖安装；macOS：打开 .dmg，把 Wulabel 拖进「应用程序」替换。
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle, url: String, sha256: String) -> Result<(), String> {
    use std::io::{Read, Write};
    use tauri::Emitter;

    if !trusted_url(&url) {
        return Err("安装包地址不对".into());
    }
    let sha256 = sha256.trim().to_lowercase();
    if sha256.len() != 64 {
        return Err("缺少安装包校验值，请到官网下载".into());
    }
    let name = url.rsplit('/').next().unwrap_or("wulabel-setup").to_string();
    let dir = std::env::temp_dir().join("wulabel-update");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    let app2 = app.clone();
    let path2 = path.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        use sha2::{Digest, Sha256};

        let resp = ureq::get(&url)
            .timeout(Duration::from_secs(1800))
            .call()
            .map_err(|e| format!("下载失败：{e}"))?;
        let total: u64 = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(0);
        let mut reader = resp.into_reader();
        let tmp = path2.with_extension("part");
        let mut file = std::fs::File::create(&tmp).map_err(|e| format!("保存安装包失败：{e}"))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 256 * 1024];
        let mut downloaded = 0u64;
        loop {
            let n = reader.read(&mut buf).map_err(|e| format!("下载中断：{e}"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).map_err(|e| format!("保存安装包失败：{e}"))?;
            hasher.update(&buf[..n]);
            downloaded += n as u64;
            let _ = app2.emit("update-progress", Progress { downloaded, total });
        }
        drop(file);
        let got: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if got != sha256 {
            let _ = std::fs::remove_file(&tmp);
            return Err("安装包校验不通过（可能没下载完整），请重试或到官网下载".into());
        }
        std::fs::rename(&tmp, &path2).map_err(|e| format!("保存安装包失败：{e}"))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())??;

    #[cfg(target_os = "windows")]
    let r = std::process::Command::new(&path).spawn();
    #[cfg(target_os = "macos")]
    let r = std::process::Command::new("open").arg(&path).spawn();
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let r = std::process::Command::new("xdg-open").arg(&path).spawn();
    r.map_err(|e| format!("打开安装程序失败：{e}。安装包在 {}", path.display()))?;

    // 留一点时间让安装程序起来，再退出软件，免得安装时文件被占用
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(800)).await;
        app.exit(0);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::version_gt;

    #[test]
    fn compare_versions() {
        assert!(version_gt("0.2.1", "0.2.0"));
        assert!(version_gt("0.10.0", "0.9.9"));
        assert!(version_gt("v1.0.0", "0.2.0"));
        assert!(!version_gt("0.2.0", "0.2.0"));
        assert!(!version_gt("0.1.9", "0.2.0"));
    }
}
