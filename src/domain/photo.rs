//! 照片（#8）：一张图，落在 app 私有目录里，当轮发给模型，之后只是对话里的图。
//!
//! Q14 之后照片**不构成依据**：依据日志里没有照片本体也没有引用，`search_evidence`
//! 也查不到它。它的作用只有两个——这一轮模型看得见，用户重开这个会话还看得见原图。
//! 因此删除会话时照片一起删（ADR-0005 修订）。
//!
//! 缩放在**系统选择器**里完成（长边 ≤ [`MAX_DIMENSION`]，HEIC 转 JPEG），这里不再
//! 解码图片，也不生成缩略图文件：显示时 `Image` 按显示尺寸解码同一份字节。

use serde::{Deserialize, Serialize};

use super::{ConversationId, DomainError, Timestamp};

/// 一次选择最多一张图（Q20：要发两张就发两条）。
pub const PER_MESSAGE: u32 = 1;

/// 长边上限：选择器把超出的图缩到这里，原图不上设备存储。
pub const MAX_DIMENSION: u32 = 2048;

/// 照片编号：存储层分配的单调递增整数。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct PhotoId(pub u64);

/// 一张已经落盘的照片。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Photo {
    pub id: PhotoId,
    /// 属于哪个会话（删会话时按它找文件）。
    pub conversation: ConversationId,
    /// app 私有目录里的文件名（不存绝对路径：目录由运行时给）。
    pub file: String,
    /// 媒体类型，选择器已经保证是浏览器与服务端都认的格式。
    pub mime: String,
    /// 像素宽。
    pub width: u32,
    /// 像素高。
    pub height: u32,
    /// 字节数，容量仪表（#17）用。
    pub bytes: u64,
    pub at: Timestamp,
}

impl Photo {
    /// 校验并分配编号。
    pub fn new(id: PhotoId, photo: Photo) -> Result<Photo, DomainError> {
        if photo.file.trim().is_empty() {
            return Err(DomainError::EmptyPhotoFile);
        }
        if !photo.mime.starts_with("image/") {
            return Err(DomainError::NotAnImage(photo.mime));
        }
        if photo.width == 0 || photo.height == 0 {
            return Err(DomainError::EmptyPhotoFile);
        }
        Ok(Photo { id, ..photo })
    }

    /// 长边。
    pub fn longer_side(&self) -> u32 {
        self.width.max(self.height)
    }

    /// 选择器是不是把这张图缩小过（长边正好压在上限上就是缩过）。
    ///
    /// 平台不回报原图尺寸，只能用返回尺寸做代理：`#8` 的「过大时被自动缩到上限
    /// 并提示」按这个判断，宁可少提示一次，也不谎报。
    pub fn was_scaled(&self) -> bool {
        self.longer_side() >= MAX_DIMENSION
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn photo(width: u32, height: u32) -> Photo {
        Photo {
            id: PhotoId(3),
            conversation: ConversationId(1),
            file: "3.jpg".to_owned(),
            mime: "image/jpeg".to_owned(),
            width,
            height,
            bytes: 240_000,
            at: 100,
        }
    }

    #[test]
    fn a_photo_must_have_a_file_an_image_type_and_a_size() {
        assert_eq!(
            Photo::new(PhotoId(3), Photo { file: " ".to_owned(), ..photo(10, 10) }),
            Err(DomainError::EmptyPhotoFile)
        );
        assert_eq!(
            Photo::new(PhotoId(3), Photo { mime: "application/pdf".to_owned(), ..photo(10, 10) }),
            Err(DomainError::NotAnImage("application/pdf".to_owned()))
        );
        assert_eq!(
            Photo::new(PhotoId(3), photo(0, 10)),
            Err(DomainError::EmptyPhotoFile)
        );
        assert!(Photo::new(PhotoId(3), photo(10, 10)).is_ok());
    }

    #[test]
    fn the_longer_side_at_the_cap_means_the_picker_scaled_it() {
        assert!(photo(2048, 900).was_scaled());
        assert!(photo(900, 2048).was_scaled());
        assert!(!photo(1600, 1200).was_scaled());
    }
}
