use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),
    #[error("数据库错误：{0}")]
    Db(#[from] rusqlite::Error),
    #[error("文件读写错误：{0}")]
    Io(#[from] std::io::Error),
    #[error("JSON 解析错误：{0}")]
    Json(#[from] serde_json::Error),
    #[error("图片解码失败：{0}")]
    Image(#[from] image::ImageError),
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
}

// 前端拿到的错误就是一段可直接展示的话（按界面语言；Msg 在创建时已经翻译过）
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let text = match self {
            AppError::Db(e) => crate::t!("数据库错误：{e}", e = e),
            AppError::Io(e) => crate::t!("文件读写错误：{e}", e = e),
            AppError::Json(e) => crate::t!("JSON 解析错误：{e}", e = e),
            AppError::Image(e) => crate::t!("图片解码失败：{e}", e = e),
            _ => self.to_string(),
        };
        s.serialize_str(&text)
    }
}

pub type AppResult<T> = Result<T, AppError>;

pub fn msg(s: impl Into<String>) -> AppError {
    AppError::Msg(s.into())
}
