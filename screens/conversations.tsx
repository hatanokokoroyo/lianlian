// 对话：会话列表 + 单个会话的聊天。列表的默认面只显示未归档的会话，
// 归档的折叠在底部；删除只清消息正文（依据日志与照片保留，ADR-0005）。
//
// 消息列表用 `List`（长会话靠虚拟化滚动），输入条固定在下沿。
import { List, resource, signal, Text, token, View } from "nsh";
import { Input } from "nsh/base";
import { Conversations } from "lianlian/native";
import type { ConversationView, MessageView } from "lianlian/native";

import { Card, Note, PrimaryButton, ScreenHeader, SectionLabel, TextButton } from "../ui/parts";

/** 相对时间：今天 / 昨天 / N 天前 / 月-日。 */
function relativeDay(at: number): string {
  const then = new Date(at);
  const now = new Date();
  const day = 24 * 60 * 60 * 1000;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startThen = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  const days = Math.round((start - startThen) / day);
  if (days <= 0) return "今天";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  return `${then.getMonth() + 1}月${then.getDate()}日`;
}

function clock(at: number): string {
  const date = new Date(at);
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${hour}:${minute}`;
}

/** 一行消息：用户贴右（primary 底），agent 贴左（card 底）。 */
function MessageRow(props: { message: MessageView }) {
  const mine = props.message.role === "user";
  return (
    <View
      testID={`message-${props.message.id}`}
      style={{
        flexDirection: "row",
        justifyContent: mine ? "flex-end" : "flex-start",
        paddingHorizontal: 16,
        paddingVertical: 4,
      }}
    >
      <View
        style={{
          maxWidth: "86%",
          backgroundColor: mine ? token("primary") : token("card"),
          borderRadius: token("radius"),
          paddingHorizontal: 12,
          paddingVertical: 9,
          gap: 4,
        }}
      >
        <Text
          style={{
            fontSize: 13,
            lineHeight: 20,
            color: mine ? token("primary-foreground") : token("foreground"),
          }}
        >
          {props.message.text}
        </Text>
        <Text
          style={{
            fontSize: 9,
            color: mine ? token("primary-foreground") : token("muted-foreground"),
            fontVariant: ["tabular-nums"],
          }}
        >
          {clock(props.message.at)}
        </Text>
      </View>
    </View>
  );
}

/** 一个会话的正文与输入条。 */
function Chat(props: { id: number; onBack: () => void; onChanged: () => void }) {
  const detail = resource(() => Conversations.open(props.id));
  const draft = signal("");
  const busy = signal(false);
  const error = signal<string | null>(null);

  const send = async () => {
    const text = draft();
    if (text.trim() === "" || busy()) {
      return;
    }
    busy.set(true);
    error.set(null);
    const result = await Conversations.send(props.id, text);
    busy.set(false);
    if (result.error) {
      // 失败时把打了一半的字留在输入框里（工单 #7 的三类错误态都靠这条）。
      error.set(result.error.message);
    } else {
      draft.set("");
    }
    detail.refetch();
    props.onChanged();
  };

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 16,
          paddingTop: 12,
        }}
      >
        <TextButton testID="conv-back" label="← 对话" onPress={props.onBack} />
        <Text
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: "bold",
            color: token("foreground"),
          }}
        >
          {detail()?.title ?? "新会话"}
        </Text>
        <SectionLabel
          text={`${detail()?.messages.length ?? 0} 条`}
        />
      </View>

      {detail() === undefined ? (
        <View style={{ padding: 16 }}>
          <Note text="正在读会话…" />
        </View>
      ) : detail()!.error ? (
        <View style={{ padding: 16 }}>
          <Card testID="conv-error">
            <Note tone="error" text={detail()!.error ?? ""} />
          </Card>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <List
            testID="message-list"
            each={detail()!.messages}
            keyExtractor={(message: MessageView) => String(message.id)}
            initialScrollAtEnd
            style={{ flex: 1 }}
            contentStyle={{ paddingTop: 8, paddingBottom: 8 }}
            empty={<Note text="还没有消息。说点什么，它会先把它记下来。" />}
          >
            {(message: () => MessageView) => <MessageRow message={message()} />}
          </List>

          {error() ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
              <Card testID="conv-send-error">
                <Note tone="error" text={error()!} />
              </Card>
            </View>
          ) : null}

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderTopWidth: 1,
              borderColor: token("border"),
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            <View style={{ flex: 1 }}>
              <Input
                testID="message-input"
                value={draft()}
                multiline
                placeholder="说点什么…"
                onChange={(event) => draft.set(event.value)}
                style={{
                  backgroundColor: token("muted"),
                  borderRadius: token("radius"),
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  fontSize: 13,
                  color: token("foreground"),
                }}
              />
            </View>
            <PrimaryButton
              testID="send"
              label={busy() ? "…" : "发送"}
              disabled={busy() || draft().trim() === ""}
              onPress={send}
            />
          </View>
        </View>
      )}
    </View>
  );
}

/** 会话列表里的一行，附归档 / 删除。 */
function ConversationRow(props: {
  conversation: ConversationView;
  menuOpen: boolean;
  confirmDelete: boolean;
  onOpen: () => void;
  onToggleMenu: () => void;
  onArchive: () => void;
  onUnarchive: () => void;
  onDeletePressed: () => void;
  onDeleteConfirmed: () => void;
  onDeleteCancelled: () => void;
}) {
  const conversation = props.conversation;
  return (
    <Card>
      <View
        testID={`conv-${conversation.id}`}
        role="button"
        accessibilityLabel={conversation.title}
        onPress={props.onOpen}
        style={{ gap: 4 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{
              flex: 1,
              fontSize: 13,
              fontWeight: "bold",
              color: token("foreground"),
            }}
          >
            {conversation.title}
          </Text>
          <SectionLabel text={relativeDay(conversation.updatedAt)} />
        </View>
        <Note text={conversation.preview} />
        <SectionLabel text={`${conversation.messageCount} 条消息`} />
      </View>

      <View style={{ flexDirection: "row", gap: 12 }}>
        <TextButton
          testID={`conv-menu-${conversation.id}`}
          label={props.menuOpen ? "收起" : "⋯"}
          onPress={props.onToggleMenu}
        />
        {props.menuOpen ? (
          <View style={{ flexDirection: "row", gap: 12 }}>
            {conversation.archived ? (
              <TextButton
                testID={`unarchive-conv-${conversation.id}`}
                label="取消归档"
                onPress={props.onUnarchive}
              />
            ) : (
              <TextButton
                testID={`archive-conv-${conversation.id}`}
                label="归档"
                onPress={props.onArchive}
              />
            )}
            <TextButton
              testID={`delete-conv-${conversation.id}`}
              label="删除"
              onPress={props.onDeletePressed}
            />
          </View>
        ) : null}
      </View>

      {props.confirmDelete ? (
        <View
          testID={`delete-conv-confirm-row-${conversation.id}`}
          style={{
            gap: 6,
            backgroundColor: token("muted"),
            borderRadius: token("radius"),
            padding: 10,
          }}
        >
          <Note
            tone="error"
            text="删除这个会话？消息正文会被清掉；它产生的依据日志与照片保留，档案不会因此失忆。"
          />
          <View style={{ flexDirection: "row", gap: 12 }}>
            <TextButton
              testID={`delete-conv-confirm-${conversation.id}`}
              label="确认删除"
              onPress={props.onDeleteConfirmed}
            />
            <TextButton
              testID={`delete-conv-cancel-${conversation.id}`}
              label="取消"
              onPress={props.onDeleteCancelled}
            />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

export function ConversationsScreen() {
  const list = resource(() => Conversations.list());
  const selected = signal<number | null>(null);
  const showArchived = signal(false);
  const menu = signal<number | null>(null);
  const confirmDelete = signal<number | null>(null);
  const error = signal<string | null>(null);

  const start = async () => {
    error.set(null);
    const id = await Conversations.create();
    if (id === 0) {
      error.set("没能新开会话：本地库打不开。");
      return;
    }
    selected.set(id);
    list.refetch();
  };

  const mutate = async (action: Promise<string | null>, id: number) => {
    error.set(null);
    const message = await action;
    if (message) {
      error.set(message);
      return;
    }
    menu.set(null);
    confirmDelete.set(null);
    list.refetch();
    if (selected() === id) {
      selected.set(null);
    }
  };

  const back = () => {
    selected.set(null);
    list.refetch();
  };

  // 条件写在 JSX 里：NSH 只跟踪渲染期间读到的信号，在函数体里提前 return
  // 会让「选中哪个会话」没人订阅，点进去也换不了页。
  return (
    <View style={{ flex: 1 }}>
      {selected() === null ? (
        <View style={{ flex: 1 }}>
          <ScreenHeader
            eyebrow="对话"
            title="和练练聊"
            note="每个对话独立，但档案与依据是共享的。"
          />
          <View style={{ padding: 16, gap: 12 }}>
            {list()?.error ? (
              <Card testID="conversations-error">
                <Note tone="error" text={list()!.error ?? ""} />
              </Card>
            ) : null}
            {error() ? (
              <Card testID="conversations-action-error">
                <Note tone="error" text={error()!} />
              </Card>
            ) : null}
            <PrimaryButton testID="new-conversation" label="新开一个" onPress={start} />

            {list() === undefined ? (
              <Note text="正在读会话…" />
            ) : list()!.active.length === 0 ? (
              <Card testID="conversations-empty">
                <Note text="还没有对话。新开一个，说说你最想改善的问题。" />
              </Card>
            ) : (
              list()!.active.map((conversation) => (
                <ConversationRow
                  conversation={conversation}
                  menuOpen={menu() === conversation.id}
                  confirmDelete={confirmDelete() === conversation.id}
                  onOpen={() => selected.set(conversation.id)}
                  onToggleMenu={() =>
                    menu.set(menu() === conversation.id ? null : conversation.id)
                  }
                  onArchive={() =>
                    mutate(Conversations.setArchived(conversation.id, true), conversation.id)
                  }
                  onUnarchive={() =>
                    mutate(Conversations.setArchived(conversation.id, false), conversation.id)
                  }
                  onDeletePressed={() => confirmDelete.set(conversation.id)}
                  onDeleteConfirmed={() =>
                    mutate(Conversations.delete(conversation.id), conversation.id)
                  }
                  onDeleteCancelled={() => confirmDelete.set(null)}
                />
              ))
            )}

            {list() !== undefined && list()!.archived.length > 0 ? (
              <View style={{ gap: 8 }}>
                <TextButton
                  testID="archived-toggle"
                  label={
                    showArchived()
                      ? `收起已归档 ${list()!.archived.length} 个`
                      : `已归档 ${list()!.archived.length} 个 · 展开`
                  }
                  onPress={() => showArchived.set(!showArchived())}
                />
                {showArchived()
                  ? list()!.archived.map((conversation) => (
                      <ConversationRow
                        conversation={conversation}
                        menuOpen={menu() === conversation.id}
                        confirmDelete={confirmDelete() === conversation.id}
                        onOpen={() => selected.set(conversation.id)}
                        onToggleMenu={() =>
                          menu.set(menu() === conversation.id ? null : conversation.id)
                        }
                        onArchive={() => undefined}
                        onUnarchive={() =>
                          mutate(
                            Conversations.setArchived(conversation.id, false),
                            conversation.id,
                          )
                        }
                        onDeletePressed={() => confirmDelete.set(conversation.id)}
                        onDeleteConfirmed={() =>
                          mutate(Conversations.delete(conversation.id), conversation.id)
                        }
                        onDeleteCancelled={() => confirmDelete.set(null)}
                      />
                    ))
                  : null}
              </View>
            ) : null}
          </View>
        </View>
      ) : (
        <Chat
          id={selected()!}
          onBack={back}
          onChanged={() => list.refetch()}
        />
      )}
    </View>
  );
}
