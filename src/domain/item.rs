//! 会话里存下来的东西：可见消息与工具往返都算（#9 的决策）。
//!
//! 只存可见文本的话，关掉 app 再打开，装配出的前缀就变了——模型看到的输入与
//! 上一轮不是同一个前缀，缓存全部作废。所以工具调用与它的结果也逐条落库，重开
//! 之后按原顺序重放；界面只渲染其中的消息，工具项不显示。
//!
//! `arguments` 与 `output` 存**字符串原文**，不解析后重新序列化：字段顺序变了
//! 一样会打破前缀。

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{ConversationId, DomainError, MessageId, PhotoId, Role, Timestamp};

/// 一条落库的条目：可见消息或工具往返。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum StoredItem {
    /// 用户或 agent 说的话；用户那句话可以带着一张照片。
    Message {
        role: Role,
        text: String,
        /// 只有用户消息会有；`#8` 之后一条最多一张。
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        photos: Vec<PhotoId>,
    },
    /// 模型要求调用工具。
    FunctionCall {
        call_id: String,
        name: String,
        arguments: String,
    },
    /// 工具的结果（成功是结果 JSON，失败是错误 JSON）。
    FunctionCallOutput { call_id: String, output: String },
    /// 认不出来的输出 item（如思考模式下的 reasoning）：原样留着，重放时照发。
    Raw { item: Value },
}

impl StoredItem {
    /// 一条用户消息。
    pub fn user(text: &str) -> Result<StoredItem, DomainError> {
        StoredItem::message(Role::User, text, Vec::new())
    }

    /// 一条带照片的用户消息（照片可以没有文字：拍照本身就是一句话）。
    pub fn user_with_photo(text: &str, photo: PhotoId) -> Result<StoredItem, DomainError> {
        StoredItem::message(Role::User, text, vec![photo])
    }

    /// 一条 agent 回复。
    pub fn assistant(text: &str) -> Result<StoredItem, DomainError> {
        StoredItem::message(Role::Assistant, text, Vec::new())
    }

    fn message(role: Role, text: &str, photos: Vec<PhotoId>) -> Result<StoredItem, DomainError> {
        let text = text.trim();
        if role == Role::Assistant && !photos.is_empty() {
            return Err(DomainError::SideForbiddenPhotos);
        }
        if photos.len() > crate::domain::photo::PER_MESSAGE as usize {
            return Err(DomainError::TooManyPhotos(photos.len()));
        }
        // 只有照片没有文字也算一条消息。
        if text.is_empty() && photos.is_empty() {
            return Err(DomainError::EmptyMessage);
        }
        Ok(StoredItem::Message {
            role,
            text: text.to_owned(),
            photos,
        })
    }

    /// 校验一条已有条目（存储层反序列化后复查用）。
    pub fn validate(&self) -> Result<(), DomainError> {
        match self {
            StoredItem::Message { role, text, photos } => {
                StoredItem::message(*role, text, photos.clone()).map(|_| ())
            }
            StoredItem::FunctionCall {
                call_id,
                name,
                arguments: _,
            } => {
                if call_id.trim().is_empty() || name.trim().is_empty() {
                    return Err(DomainError::EmptyToolItem);
                }
                Ok(())
            }
            StoredItem::FunctionCallOutput { call_id, output } => {
                if call_id.trim().is_empty() || output.trim().is_empty() {
                    return Err(DomainError::EmptyToolItem);
                }
                Ok(())
            }
            StoredItem::Raw { .. } => Ok(()),
        }
    }

    /// 是不是 user（`Role::User`）说的话——整轮裁剪靠它找轮首。
    pub fn is_user_message(&self) -> bool {
        matches!(
            self,
            StoredItem::Message {
                role: Role::User,
                ..
            }
        )
    }

    /// 可见消息的投影：不是消息就是 `None`。
    pub fn as_message(&self) -> Option<(Role, &str)> {
        match self {
            StoredItem::Message { role, text, .. } => Some((*role, text.as_str())),
            _ => None,
        }
    }

    /// 这条消息带的照片（不是消息或没有照片就是空）。
    pub fn photos(&self) -> &[PhotoId] {
        match self {
            StoredItem::Message { photos, .. } => photos,
            _ => &[],
        }
    }
}

/// 库里的一个条目：编号、属于哪个会话、什么时候、内容。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    pub id: MessageId,
    pub conversation: ConversationId,
    pub at: Timestamp,
    pub item: StoredItem,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_blank_message_is_not_a_message() {
        assert_eq!(StoredItem::user("  \n "), Err(DomainError::EmptyMessage));
        assert!(StoredItem::assistant("先说一句").is_ok());
    }

    #[test]
    fn a_photo_is_a_message_even_without_words_but_only_from_the_user() {
        let with_photo = StoredItem::user_with_photo("", PhotoId(7)).expect("只有照片也算");
        assert_eq!(with_photo.photos(), &[PhotoId(7)]);
        assert_eq!(with_photo.as_message(), Some((Role::User, "")));

        // agent 不会发照片；一条只允许一张。
        assert!(matches!(
            StoredItem::assistant("看这张"),
            Ok(StoredItem::Message { .. })
        ));
        let two = StoredItem::message(Role::User, "x", vec![PhotoId(1), PhotoId(2)]);
        assert_eq!(two, Err(DomainError::TooManyPhotos(2)));
    }

    #[test]
    fn tool_items_keep_their_raw_strings() {
        let call = StoredItem::FunctionCall {
            call_id: "call_1".to_owned(),
            name: "search_evidence".to_owned(),
            arguments: r#"{"site":"soleus","limit":5}"#.to_owned(),
        };
        let json = serde_json::to_string(&call).expect("序列化");
        assert!(json.contains("\"kind\":\"function-call\""), "{json}");
        let back: StoredItem = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(back, call, "参数字符串原样保留");
        assert_eq!(back.as_message(), None);
    }

    #[test]
    fn a_broken_tool_item_is_refused() {
        let empty_call = StoredItem::FunctionCall {
            call_id: " ".to_owned(),
            name: "search_evidence".to_owned(),
            arguments: "{}".to_owned(),
        };
        assert_eq!(empty_call.validate(), Err(DomainError::EmptyToolItem));
        let empty_output = StoredItem::FunctionCallOutput {
            call_id: "call_1".to_owned(),
            output: "  ".to_owned(),
        };
        assert_eq!(empty_output.validate(), Err(DomainError::EmptyToolItem));
    }

    #[test]
    fn only_user_messages_start_a_turn() {
        assert!(StoredItem::user("嗯").expect("合法").is_user_message());
        assert!(!StoredItem::assistant("嗯").expect("合法").is_user_message());
    }

    #[test]
    fn unknown_output_items_survive_as_they_came() {
        let raw = StoredItem::Raw {
            item: serde_json::json!({ "type": "reasoning", "summary": [] }),
        };
        let json = serde_json::to_string(&raw).expect("序列化");
        let back: StoredItem = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(back, raw);
        assert_eq!(back.validate(), Ok(()));
    }
}
