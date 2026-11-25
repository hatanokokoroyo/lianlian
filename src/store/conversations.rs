//! 会话与条目的存储。
//!
//! 两张表：`conversations`（编号 → Conversation 的 JSON）、`messages`（编号 →
//! `Entry` 的 JSON，里面既可能是可见消息，也可能是工具往返——见 `domain::item`）。
//! 条目只追加，不修改；同一批条目在同一个事务里落库，中途失败一条都不写。
//! 发送拆成两批：用户消息先落库，模型跑完后再落工具往返与回复——所以模型失败
//! 时用户那句话仍在时间线上。
//! 删除会话时删它和它的全部条目——依据日志不在这两张表里，所以不会被带走（ADR-0005）。

use redb::{ReadableDatabase, ReadableTable, TableDefinition};

use super::{Store, StoreError, db_error};
use crate::domain::conversation::UNTITLED;
use crate::domain::{
    Conversation, ConversationId, DomainError, Entry, Message, MessageId, Role, StoredItem,
};

/// 会话：编号 → Conversation 的 JSON。
pub(crate) const CONVERSATIONS: TableDefinition<u64, &str> = TableDefinition::new("conversations");
/// 条目：编号 → Entry 的 JSON（消息与工具往返共用一张表）。
pub(crate) const MESSAGES: TableDefinition<u64, &str> = TableDefinition::new("messages");

impl Store {
    /// 新开一个会话（还没起名字）。
    pub fn create_conversation(&self, at: i64) -> Result<Conversation, StoreError> {
        let id = ConversationId(self.next_conversation_id()?);
        let conversation = Conversation::new(id, at);
        self.write_conversation(&conversation)?;
        Ok(conversation)
    }

    /// 全部会话：未归档的在前，按「最近更新、编号」倒序。
    pub fn conversations(&self) -> Result<Vec<Conversation>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(CONVERSATIONS).map_err(db_error)?;
        let mut all = Vec::new();
        for entry in table.iter().map_err(db_error)? {
            let (_, value) = entry.map_err(db_error)?;
            all.push(from_json::<Conversation>(value.value())?);
        }
        all.sort_by(|a, b| (b.updated_at, b.id).cmp(&(a.updated_at, a.id)));
        Ok(all)
    }

    /// 一个会话；没有就是 `None`。
    pub fn conversation(&self, id: ConversationId) -> Result<Option<Conversation>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(CONVERSATIONS).map_err(db_error)?;
        let json = table
            .get(id.0)
            .map_err(db_error)?
            .map(|value| value.value().to_owned());
        json.map(|json| from_json(&json)).transpose()
    }

    /// 归档 / 取消归档。归档的会话从默认列表消失，但仍在库里可被找回。
    pub fn set_conversation_archived(
        &self,
        id: ConversationId,
        archived: bool,
    ) -> Result<(), StoreError> {
        let mut conversation = self.require_conversation(id)?;
        conversation.archived = archived;
        self.write_conversation(&conversation)
    }

    /// 记下（或清掉）这个会话的说明，重新打开时还能看到。
    pub fn set_conversation_notice(
        &self,
        id: ConversationId,
        notice: Option<&str>,
    ) -> Result<(), StoreError> {
        let mut conversation = self.require_conversation(id)?;
        conversation.notice = notice.map(str::to_owned);
        self.write_conversation(&conversation)
    }

    /// 删除一个会话与它 `messages` 表里的全部条目、提议。
    ///
    /// 条目不只可见消息：工具往返、卡片行与审核决定（`ReviewDecision`）都在这张表里，
    /// 会话没了它们也没有意义；留着只会在下次开库时变成孤儿。
    ///
    /// 依据日志不在这张表里，所以不会被带走（ADR-0005）；照片行由 `api` 侧先删
    /// （连文件一起），这里不再管它。
    pub fn delete_conversation(&self, id: ConversationId) -> Result<(), StoreError> {
        self.require_conversation(id)?;
        let doomed: Vec<u64> = self
            .items(id)?
            .into_iter()
            .map(|entry| entry.id.0)
            .collect();

        let proposals: Vec<u64> = self
            .proposals(id)?
            .into_iter()
            .map(|proposal| proposal.id.0)
            .collect();

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut messages = write.open_table(MESSAGES).map_err(db_error)?;
            for message in doomed {
                messages.remove(message).map_err(db_error)?;
            }
            drop(messages);
            let mut cards = write
                .open_table(super::proposals::PROPOSALS)
                .map_err(db_error)?;
            for proposal in proposals {
                cards.remove(proposal).map_err(db_error)?;
            }
            drop(cards);
            let mut conversations = write.open_table(CONVERSATIONS).map_err(db_error)?;
            conversations.remove(id.0).map_err(db_error)?;
        }
        write.commit().map_err(db_error)
    }

    /// 追加一条可见消息；会话的标题（若是占位）与更新时间一并推进。
    pub fn append_message(
        &self,
        conversation: ConversationId,
        role: Role,
        text: &str,
        at: i64,
    ) -> Result<Message, StoreError> {
        let items = vec![match role {
            Role::User => StoredItem::user(text)?,
            Role::Assistant => StoredItem::assistant(text)?,
        }];
        let mut entries = self.append_turn(conversation, items, at)?;
        let entry = entries.remove(0);
        Ok(Message {
            id: entry.id,
            conversation: entry.conversation,
            role,
            text: match entry.item {
                StoredItem::Message { text, .. } => text,
                _ => unreachable!("append_message 只写消息"),
            },
            photos: Vec::new(),
            at: entry.at,
        })
    }

    /// 追加一轮的全部条目（用户消息、工具往返、回复），同一个事务。
    ///
    /// 编号按顺序分配，时间戳在 `at` 上逐条 +1 毫秒：同一轮里的先后顺序不靠
    /// 时钟分辨率。任何一条校验不过就整轮不写。
    pub fn append_turn(
        &self,
        conversation: ConversationId,
        items: Vec<StoredItem>,
        at: i64,
    ) -> Result<Vec<Entry>, StoreError> {
        let mut record = self.require_conversation(conversation)?;
        let mut entries = Vec::with_capacity(items.len());
        let mut next = self.next_message_id()?;
        for item in items {
            item.validate()?;
            entries.push(Entry {
                id: MessageId(next),
                conversation,
                at: at.saturating_add(entries.len() as i64),
                item,
            });
            next += 1;
        }
        if entries.is_empty() {
            return Ok(entries);
        }

        // 标题与更新时间跟着这一轮走：标题取这一轮里第一条用户消息。
        if record.title == UNTITLED {
            if let Some(text) = entries.iter().find_map(|entry| match &entry.item {
                StoredItem::Message {
                    role: Role::User,
                    text,
                    ..
                } => Some(text.clone()),
                _ => None,
            }) {
                record.title = Conversation::title_from(&text);
            }
        }
        record.updated_at = record.updated_at.max(at);

        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut messages = write.open_table(MESSAGES).map_err(db_error)?;
            for entry in &entries {
                messages
                    .insert(entry.id.0, to_json(entry)?.as_str())
                    .map_err(db_error)?;
            }
            drop(messages);
            let mut conversations = write.open_table(CONVERSATIONS).map_err(db_error)?;
            conversations
                .insert(conversation.0, to_json(&record)?.as_str())
                .map_err(db_error)?;
            drop(conversations);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            meta.insert("next_message_id", next.to_string().as_str())
                .map_err(db_error)?;
        }
        write.commit().map_err(db_error)?;
        Ok(entries)
    }

    /// 一个会话的全部条目（含工具往返），按「时间、编号」升序。
    pub fn items(&self, conversation: ConversationId) -> Result<Vec<Entry>, StoreError> {
        let read = self.db().begin_read().map_err(db_error)?;
        let table = read.open_table(MESSAGES).map_err(db_error)?;
        let mut all = Vec::new();
        for entry in table.iter().map_err(db_error)? {
            let (_, value) = entry.map_err(db_error)?;
            let entry: Entry = from_json(value.value())?;
            if entry.conversation == conversation {
                all.push(entry);
            }
        }
        // 按编号排：同一轮里时间戳是 +1ms 递推的，下一轮可能落进上一轮那几毫秒
        // 之内；只有编号是全局单调的，`function_call` 与它的 `output` 不会被排反。
        all.sort_by_key(|entry| entry.id);
        Ok(all)
    }

    /// 一个会话里的可见消息，按「时间、编号」升序（界面与摘要只看这个）。
    pub fn messages(&self, conversation: ConversationId) -> Result<Vec<Message>, StoreError> {
        Ok(self
            .items(conversation)?
            .into_iter()
            .filter_map(|entry| match entry.item {
                StoredItem::Message { role, text, photos } => Some(Message {
                    id: entry.id,
                    conversation: entry.conversation,
                    role,
                    text,
                    photos,
                    at: entry.at,
                }),
                _ => None,
            })
            .collect())
    }

    fn require_conversation(&self, id: ConversationId) -> Result<Conversation, StoreError> {
        self.conversation(id)?
            .ok_or(StoreError::Domain(DomainError::UnknownConversation(id.0)))
    }

    fn write_conversation(&self, conversation: &Conversation) -> Result<(), StoreError> {
        let json = to_json(conversation)?;
        let next = (conversation.id.0 + 1).to_string();
        let write = self.db().begin_write().map_err(db_error)?;
        {
            let mut table = write.open_table(CONVERSATIONS).map_err(db_error)?;
            table
                .insert(conversation.id.0, json.as_str())
                .map_err(db_error)?;
            drop(table);
            let mut meta = write.open_table(super::META).map_err(db_error)?;
            let current: u64 = meta
                .get("next_conversation_id")
                .map_err(db_error)?
                .map(|value| value.value().parse().unwrap_or(1))
                .unwrap_or(1);
            if current <= conversation.id.0 {
                meta.insert("next_conversation_id", next.as_str())
                    .map_err(db_error)?;
            }
        }
        write.commit().map_err(db_error)
    }

    fn next_conversation_id(&self) -> Result<u64, StoreError> {
        Ok(self
            .meta("next_conversation_id")?
            .and_then(|value| value.parse().ok())
            .unwrap_or(1))
    }

    fn next_message_id(&self) -> Result<u64, StoreError> {
        Ok(self
            .meta("next_message_id")?
            .and_then(|value| value.parse().ok())
            .unwrap_or(1))
    }
}

fn to_json<T: serde::Serialize>(value: &T) -> Result<String, StoreError> {
    serde_json::to_string(value).map_err(|error| StoreError::Db(format!("写库序列化失败：{error}")))
}

fn from_json<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, StoreError> {
    serde_json::from_str(json).map_err(|error| StoreError::Db(format!("读库反序列化失败：{error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::tests::TempStore;

    #[test]
    fn a_new_conversation_is_untitled_and_lists_first() {
        let temp = TempStore::new("conversations-create");
        let store = temp.store();
        let first = store.create_conversation(100).expect("新会话");
        let second = store.create_conversation(200).expect("另一个");
        assert_eq!(first.title, UNTITLED);
        let all = store.conversations().expect("列表");
        assert_eq!(
            all.iter()
                .map(|conversation| conversation.id)
                .collect::<Vec<_>>(),
            vec![second.id, first.id]
        );
    }

    #[test]
    fn messages_are_ordered_and_survive_reopening() {
        let mut temp = TempStore::new("conversations-messages");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("新会话");
        store
            .append_message(conversation.id, Role::User, "  右膝为什么响  ", 110)
            .expect("用户消息");
        store
            .append_message(conversation.id, Role::Assistant, "先做一个测试", 120)
            .expect("回复");

        let reopened = temp.reopen();
        let messages = reopened.messages(conversation.id).expect("读消息");
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, Role::User);
        assert_eq!(messages[0].text, "右膝为什么响");
        assert_eq!(messages[1].text, "先做一个测试");
        // 标题取自第一条用户消息。
        assert_eq!(
            reopened
                .conversation(conversation.id)
                .expect("读会话")
                .expect("存在")
                .title,
            "右膝为什么响"
        );
    }

    #[test]
    fn blank_messages_are_refused_and_nothing_is_written() {
        let temp = TempStore::new("conversations-blank");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("新会话");
        assert_eq!(
            store.append_message(conversation.id, Role::User, "  ", 110),
            Err(StoreError::Domain(DomainError::EmptyMessage))
        );
        assert!(store.messages(conversation.id).expect("读").is_empty());
        assert_eq!(store.conversation(ConversationId(99)).expect("读"), None);
    }

    #[test]
    fn a_whole_turn_lands_with_its_tool_round_trip_and_comes_back_in_order() {
        let mut temp = TempStore::new("conversations-turn");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("新会话");
        let items = vec![
            StoredItem::user("蹲不下去").expect("用户消息"),
            StoredItem::FunctionCall {
                call_id: "call_1".to_owned(),
                name: "search_evidence".to_owned(),
                arguments: r#"{"site":"soleus"}"#.to_owned(),
            },
            StoredItem::FunctionCallOutput {
                call_id: "call_1".to_owned(),
                output: r#"{"found":0,"items":[]}"#.to_owned(),
            },
            StoredItem::assistant("先做踝背屈测试").expect("回复"),
        ];
        store
            .append_turn(conversation.id, items.clone(), 200)
            .expect("落一轮");

        let reopened = temp.reopen();
        let entries = reopened.items(conversation.id).expect("读条目");
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.item.clone())
                .collect::<Vec<_>>(),
            items,
            "工具往返原样重放"
        );
        assert!(
            entries.windows(2).all(|pair| pair[0].at < pair[1].at),
            "同一轮里时间戳逐条递增"
        );
        // 界面只看到两条可见消息。
        assert_eq!(reopened.messages(conversation.id).expect("消息").len(), 2);
        // 标题仍然取自这一轮里的用户消息。
        assert_eq!(
            reopened
                .conversation(conversation.id)
                .expect("读")
                .expect("存在")
                .title,
            "蹲不下去"
        );
    }

    #[test]
    fn a_broken_item_writes_none_of_the_turn() {
        let temp = TempStore::new("conversations-turn-broken");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("新会话");
        let items = vec![
            StoredItem::user("这一句合法").expect("用户消息"),
            StoredItem::FunctionCall {
                call_id: String::new(),
                name: "search_evidence".to_owned(),
                arguments: "{}".to_owned(),
            },
        ];
        assert_eq!(
            store.append_turn(conversation.id, items, 200),
            Err(StoreError::Domain(DomainError::EmptyToolItem))
        );
        assert!(store.items(conversation.id).expect("读").is_empty());
        assert_eq!(
            store
                .conversation(conversation.id)
                .expect("读")
                .expect("存在")
                .title,
            UNTITLED,
            "失败的一轮连标题都不该动"
        );
    }

    #[test]
    fn archiving_hides_a_conversation_without_deleting_it() {
        let temp = TempStore::new("conversations-archive");
        let store = temp.store();
        let conversation = store.create_conversation(100).expect("新会话");
        store
            .append_message(conversation.id, Role::User, "训练条件改一下", 110)
            .expect("消息");
        store
            .set_conversation_archived(conversation.id, true)
            .expect("归档");

        let all = store.conversations().expect("列表");
        assert!(all[0].archived);
        assert_eq!(all.len(), 1);
        assert_eq!(store.messages(conversation.id).expect("消息").len(), 1);

        store
            .set_conversation_archived(conversation.id, false)
            .expect("取消归档");
        assert!(!store.conversations().expect("列表")[0].archived);
    }

    #[test]
    fn deleting_a_conversation_takes_its_messages_and_leaves_the_others() {
        let temp = TempStore::new("conversations-delete");
        let store = temp.store();
        let keep = store.create_conversation(100).expect("留下的");
        let doomed = store.create_conversation(200).expect("要删的");
        store
            .append_message(doomed.id, Role::User, "删掉我", 210)
            .expect("消息");
        store
            .append_message(keep.id, Role::User, "留着我", 220)
            .expect("消息");
        // 时间线里还有工具往返、卡片行与审核决定：删除会话要把它们一起带走。
        store
            .append_turn(
                doomed.id,
                vec![
                    StoredItem::FunctionCall {
                        call_id: "call_1".to_owned(),
                        name: "search_evidence".to_owned(),
                        arguments: r#"{"site":"soleus"}"#.to_owned(),
                    },
                    StoredItem::FunctionCallOutput {
                        call_id: "call_1".to_owned(),
                        output: r#"{"found":0,"items":[]}"#.to_owned(),
                    },
                    StoredItem::ProposalCard {
                        proposal: crate::domain::ProposalId(1),
                    },
                    StoredItem::ReviewDecision {
                        text: "我审完了第 1 号卡：不要第 1 项（左比目鱼肌，理由：不是小腿）"
                            .to_owned(),
                    },
                ],
                230,
            )
            .expect("条目");
        assert_eq!(store.items(doomed.id).expect("条目").len(), 5);

        store.delete_conversation(doomed.id).expect("删除");
        assert_eq!(store.conversation(doomed.id).expect("读"), None);
        assert!(store.messages(doomed.id).expect("读").is_empty());
        assert!(
            store.items(doomed.id).expect("读").is_empty(),
            "工具往返、卡片行与审核决定都跟着会话走"
        );
        assert_eq!(store.messages(keep.id).expect("读").len(), 1);

        assert_eq!(
            store.delete_conversation(doomed.id),
            Err(StoreError::Domain(DomainError::UnknownConversation(
                doomed.id.0
            )))
        );
    }

    #[test]
    fn a_later_message_moves_the_conversation_up_the_list() {
        let temp = TempStore::new("conversations-order");
        let store = temp.store();
        let old = store.create_conversation(100).expect("旧的");
        let new = store.create_conversation(200).expect("新的");
        store
            .append_message(old.id, Role::User, "又聊了一句", 300)
            .expect("消息");
        let all = store.conversations().expect("列表");
        assert_eq!(all[0].id, old.id);
        assert_eq!(all[1].id, new.id);
    }
}
