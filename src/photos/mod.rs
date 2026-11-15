//! 照片的字节与文件（#8）：缩放由系统选择器做，这里只管落盘与喂给模型。
//!
//! 一张照片只有**一份**文件（长边 ≤2048 的 JPEG），没有缩略图：会话里显示时
//! 由 `Image` 按显示尺寸解码同一份字节。因此这里不依赖任何图片解码库。

use std::path::{Path, PathBuf};

use crate::domain::PhotoId;

/// app 私有目录里的照片子目录。
///
/// 根目录与库同一个（`store::app_dir`）：宿主不给私有目录时一起落到临时目录，
/// 否则光是「库能开、照片没处放」这种半边可用最难受。
pub fn photos_dir() -> PathBuf {
    crate::store::app_dir().join("photos")
}

/// 文件名：编号 + 扩展名。目录不存进库里，换机器/换宿主都能用。
pub fn file_name(id: PhotoId, mime: &str) -> String {
    format!("{}.{}", id.0, extension(mime))
}

/// 媒体类型 → 扩展名。选择器只给这几种（其他格式会被它转成 JPEG）。
pub fn extension(mime: &str) -> &'static str {
    match mime.to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "jpg",
    }
}

/// 落盘；目录不在就建。返回文件名。
pub fn save(dir: &Path, id: PhotoId, mime: &str, bytes: &[u8]) -> std::io::Result<String> {
    std::fs::create_dir_all(dir)?;
    let name = file_name(id, mime);
    std::fs::write(dir.join(&name), bytes)?;
    Ok(name)
}

/// 读回来。
pub fn load(dir: &Path, file: &str) -> std::io::Result<Vec<u8>> {
    std::fs::read(dir.join(file))
}

/// 删掉；不存在也算成功（重试与删除会话都靠它幂等）。
pub fn remove(dir: &Path, file: &str) -> std::io::Result<()> {
    match std::fs::remove_file(dir.join(file)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

/// 给模型的 `input_image` 用的 data URL。
pub fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!("data:{mime};base64,{}", base64(bytes))
}

/// 标准 base64（字母表 + `=` 填充）。没有第三方依赖，二十行就够。
pub fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[(triple >> 18) as usize & 63] as char);
        out.push(ALPHABET[(triple >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(triple >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[triple as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_the_known_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
        // JPEG 的魔数：/9j/ 是 base64 里最常见的开头。
        assert!(base64(&[0xFF, 0xD8, 0xFF]).starts_with("/9j/"));
    }

    #[test]
    fn a_photo_is_a_data_url_and_a_file_name_without_a_directory() {
        assert_eq!(
            data_url("image/jpeg", b"f"),
            "data:image/jpeg;base64,Zg==".to_owned()
        );
        assert_eq!(file_name(PhotoId(12), "image/jpeg"), "12.jpg");
        assert_eq!(file_name(PhotoId(12), "image/PNG"), "12.png");
        assert_eq!(file_name(PhotoId(12), "image/heic"), "12.jpg");
    }

    #[test]
    fn saving_loading_and_removing_round_trips_and_is_idempotent() {
        let dir = std::env::temp_dir().join(format!("lianlian-photos-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);

        let name = save(&dir, PhotoId(1), "image/jpeg", b"jpeg-bytes").expect("落盘");
        assert_eq!(load(&dir, &name).expect("读回"), b"jpeg-bytes");

        remove(&dir, &name).expect("删掉");
        assert!(load(&dir, &name).is_err());
        remove(&dir, &name).expect("再删也算成功");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
