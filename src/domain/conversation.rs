//! 会话（`GLOSSARY.md`「会话」）：用户与 agent 的一次对话。
//!
//! 会话没有主题或类型字段，只有标题（由第一条用户消息派生）、时间与归档标记。
//! 消息按序追加、不修改；删除会话只删消息正文与照片，依据日志保留（ADR-0005）。
//! 时间由调用方给，这一层不读时钟。

use serde::{Deserialize, Serialize};

use super::{DomainError, Timestamp};

/// 会话编号：存储层分配的单调递增整数。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct ConversationId(pub u64);

/// 消息编号。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct MessageId(pub u64);

/// 一条消息是谁说的。工单 #8 之后会有照片，但那是附件，不是第三种角色。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Role {
    User,
    Assistant,
}

impl Role {
    /// 机器可读的取值。
    pub fn key(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Assistant => "assistant",
        }
    }

    /// 从机器键解析。
    pub fn from_key(raw: &str) -> Option<Role> {
        match raw.trim() {
            "user" | "我" => Some(Role::User),
            "assistant" | "agent" => Some(Role::Assistant),
            _ => None,
        }
    }
}

/// 还没起名字的会话。
pub const UNTITLED: &str = "新会话";

/// 一次对话。`updated_at` 用来排序（最近的在前），归档不删除。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Conversation {
    pub id: ConversationId,
    pub title: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub archived: bool,
    /// 上一次自动裁剪历史时留下的说明；再开这个会话也要看得见（#7）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notice: Option<String>,
}

impl Conversation {
    /// 新会话：标题先占位，第一条用户消息写进来时再取。
    pub fn new(id: ConversationId, at: Timestamp) -> Conversation {
        Conversation {
            id,
            title: UNTITLED.to_owned(),
            created_at: at,
            updated_at: at,
            archived: false,
            notice: None,
        }
    }

    /// 从第一条用户消息取标题：压成一行，最多 24 个字。
    pub fn title_from(text: &str) -> String {
        let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            return UNTITLED.to_owned();
        }
        let mut title: String = line.chars().take(24).collect();
        if line.chars().count() > 24 {
            title.push('…');
        }
        title
    }
}

/// 一条已经落库的消息。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub id: MessageId,
    pub conversation: ConversationId,
    pub role: Role,
    pub text: String,
    /// 这条消息带的照片（`#8`：只有用户消息会有，最多一张）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub photos: Vec<super::PhotoId>,
    pub at: Timestamp,
}

impl Message {
    /// 校验文本并分配编号；空白消息不许入库。
    pub fn new(
        id: MessageId,
        conversation: ConversationId,
        role: Role,
        text: &str,
        at: Timestamp,
    ) -> Result<Message, DomainError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(DomainError::EmptyMessage);
        }
        Ok(Message {
            id,
            conversation,
            role,
            text: text.to_owned(),
            photos: Vec::new(),
            at,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_conversation_is_untitled_until_the_first_message() {
        let conversation = Conversation::new(ConversationId(1), 100);
        assert_eq!(conversation.title, UNTITLED);
        assert_eq!(conversation.updated_at, 100);
        assert!(!conversation.archived);
    }

    #[test]
    fn the_title_is_one_line_of_the_first_message() {
        assert_eq!(
            Conversation::title_from("  右膝为什么响\n还有上下楼梯时   "),
            "右膝为什么响 还有上下楼梯时"
        );
        assert_eq!(Conversation::title_from("   "), UNTITLED);
        let long = "一".repeat(40);
        let title = Conversation::title_from(&long);
        assert_eq!(title.chars().count(), 25);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn a_blank_message_is_not_a_message() {
        assert_eq!(
            Message::new(MessageId(1), ConversationId(1), Role::User, "  \n ", 1),
            Err(DomainError::EmptyMessage)
        );
        let message = Message::new(
            MessageId(2),
            ConversationId(3),
            Role::Assistant,
            " 先做一个测试 ",
            5,
        )
        .expect("合法");
        assert_eq!(message.text, "先做一个测试");
        assert_eq!(message.role, Role::Assistant);
        assert_eq!(message.conversation, ConversationId(3));
    }

    #[test]
    fn roles_round_trip() {
        assert_eq!(Role::User.key(), "user");
        assert_eq!(Role::from_key("assistant"), Some(Role::Assistant));
        assert_eq!(Role::from_key("我"), Some(Role::User));
        assert_eq!(Role::from_key("system"), None);
    }
}
