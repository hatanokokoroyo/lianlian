// 对话：会话列表 + 单个会话的聊天。列表的默认面只显示未归档的会话，
// 归档的折叠在底部；删除只清消息正文（依据日志与照片保留，ADR-0005）。
//
// 消息列表用 `List`（长会话靠虚拟化滚动），输入条固定在下沿。
import { Image, List, resource, signal, Text, token, View } from "nsh";
import { Input } from "nsh/base";
import { Conversations, Photos } from "lianlian/native";
import type { ChatErrorView, ConversationView, MessageView } from "lianlian/native";

import { Card, ConfirmRow, Note, PrimaryButton, ScreenHeader, SectionLabel, TextButton } from "../ui/parts";

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

/** 消息里的照片：字节由 Rust 给（data URL），点开看大图。 */
function MessagePhoto(props: { id: number; onOpen: () => void }) {
  const data = resource(() => Photos.data(props.id));
  return (
    <View
      testID={`message-photo-${props.id}`}
      role="button"
      accessibilityLabel="查看这张照片"
      onPress={props.onOpen}
      style={{
        width: 200,
        height: 150,
        borderRadius: 14,
        overflow: "hidden",
        backgroundColor: token("muted"),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {data() ? (
        <Image src={data()!} style={{ width: 200, height: 150, objectFit: "cover" }} />
      ) : (
        <Text style={{ fontSize: 11, color: token("muted-foreground") }}>读照片…</Text>
      )}
    </View>
  );
}

/** 一行消息：用户贴右（primary 底），agent 贴左（card 底）。 */
function MessageRow(props: { message: MessageView; onOpenPhoto: (id: number) => void }) {
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
        {props.message.photos.map((photo) => (
          <MessagePhoto id={photo} onOpen={() => props.onOpenPhoto(photo)} />
        ))}
        {props.message.text.trim() === "" ? null : (
          <Text
            style={{
              fontSize: 13,
              lineHeight: 20,
              color: mine ? token("primary-foreground") : token("foreground"),
            }}
          >
            {props.message.text}
          </Text>
        )}
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

/**
 * 没发出去的草稿按会话缓存：出错跳去设置再回来，打了一半的字还在。
 * 键是会话编号，模块级——和 `ui/drafts.ts` 对表单草稿的处理同一个理由。
 */
const drafts = new Map<number, string>();

/** 一个会话的正文与输入条。 */
function Chat(props: {
  id: number;
  onBack: () => void;
  onChanged: () => void;
  onOpenSettings: () => void;
}) {
  const detail = resource(() => Conversations.open(props.id));
  const draft = signal(drafts.get(props.id) ?? "");
  const busy = signal(false);
  const failure = signal<ChatErrorView | null>(null);
  /** 这一轮待发的照片（选好但还没发出去）。 */
  const attached = signal<{ id: number; dataUrl: string; notice: string | null } | null>(null);
  /** 点开看大图的那一张。 */
  const preview = signal<string | null>(null);
  const photoError = signal<string | null>(null);

  const pick = async () => {
    photoError.set(null);
    const result = await Photos.pick(props.id);
    if (result.error) {
      photoError.set(result.error);
      return;
    }
    if (!result.photo) {
      return;
    }
    const dataUrl = await Photos.data(result.photo.id);
    if (!dataUrl) {
      photoError.set("照片存下来了，但读不回来看不到预览。");
      return;
    }
    attached.set({ id: result.photo.id, dataUrl, notice: result.notice ?? null });
  };

  const writeDraft = (text: string) => {
    drafts.set(props.id, text);
    draft.set(text);
  };

  const send = async () => {
    const text = draft();
    const photo = attached();
    if ((text.trim() === "" && !photo) || busy()) {
      return;
    }
    busy.set(true);
    failure.set(null);
    const result = await Conversations.send(props.id, text, photo ? photo.id : null);
    busy.set(false);
    if (result.error) {
      // 失败时什么都不落库，打了一半的字留在输入框里：断网重试、去设置换 key
      // 都从这里接上（contract §8 的三类错误态）。
      failure.set(result.error);
    } else {
      writeDraft("");
      attached.set(null);
    }
    detail.refetch();
    props.onChanged();
  };

  return (
    <View style={{ flex: 1 }}>
      {preview() ? (
        <View
          testID="photo-preview"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            zIndex: 10,
            backgroundColor: token("background"),
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          <Image
            src={preview()!}
            style={{ width: "92%", height: "80%", objectFit: "contain" }}
          />
          <PrimaryButton
            testID="close-photo-preview"
            label="关闭"
            onPress={() => preview.set(null)}
          />
        </View>
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 16,
          paddingTop: 12,
        }}
      >
        <TextButton testID="back" label="← 对话" onPress={props.onBack} />
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
            {(message: () => MessageView) => (
              <MessageRow
                message={message()}
                onOpenPhoto={(photoId) => {
                  Photos.data(photoId).then((url) => preview.set(url));
                }}
              />
            )}
          </List>

          {detail()?.notice ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
              <Card testID="conv-send-notice">
                <Note tone="accent" text={detail()!.notice ?? ""} />
              </Card>
            </View>
          ) : null}

          {failure() ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
              <Card testID="conv-send-error">
                <Note tone="error" text={failure()!.message} />
                <View style={{ flexDirection: "row", gap: 12 }}>
                  {failure()!.canRetry ? (
                    <TextButton testID="retry-send" label="重试" onPress={send} />
                  ) : null}
                  {failure()!.kind === "config" ? (
                    <TextButton
                      testID="open-settings"
                      label="去设置"
                      onPress={props.onOpenSettings}
                    />
                  ) : null}
                </View>
              </Card>
            </View>
          ) : null}

          {busy() ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
              <Note testID="conv-thinking" text="思考中…" />
            </View>
          ) : null}

          {photoError() ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
              <Card testID="photo-error">
                <Note tone="error" text={photoError()!} />
              </Card>
            </View>
          ) : null}

          {attached() ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 6, flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Image
                testID="photo-pending"
                src={attached()!.dataUrl}
                style={{ width: 56, height: 56, borderRadius: 10, objectFit: "cover" }}
              />
              <View style={{ flex: 1, gap: 4 }}>
                {attached()!.notice ? <Note tone="accent" text={attached()!.notice!} /> : null}
                <TextButton
                  testID="remove-photo"
                  label="拿掉这张"
                  onPress={() => attached.set(null)}
                />
              </View>
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
            <TextButton testID="pick-photo" label="照片" onPress={pick} />
            <View style={{ flex: 1 }}>
              <Input
                testID="message-input"
                value={draft()}
                multiline
                placeholder="说点什么…"
                onChange={(event) => writeDraft(event.value)}
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
              disabled={busy() || (draft().trim() === "" && !attached())}
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
          hint={`会话菜单：${conversation.title}`}
          onPress={props.onToggleMenu}
        />
        {props.menuOpen ? (
          <View style={{ flexDirection: "row", gap: 12 }}>
            {conversation.archived ? (
              <TextButton
                testID={`unarchive-conv-${conversation.id}`}
                label="取消归档"
                hint={`取消归档：${conversation.title}`}
                onPress={props.onUnarchive}
              />
            ) : (
              <TextButton
                testID={`archive-conv-${conversation.id}`}
                label="归档"
                hint={`归档：${conversation.title}`}
                onPress={props.onArchive}
              />
            )}
            <TextButton
              testID={`delete-conv-${conversation.id}`}
              label="删除"
              hint={`删除：${conversation.title}`}
              onPress={props.onDeletePressed}
            />
          </View>
        ) : null}
      </View>

      {props.confirmDelete ? (
        <ConfirmRow
          testID={`delete-conv-confirm-row-${conversation.id}`}
          text="删除这个会话？消息正文会被清掉；它产生的依据日志与照片保留，档案不会因此失忆。"
          confirmTestID={`delete-conv-confirm-${conversation.id}`}
          cancelTestID={`delete-conv-cancel-${conversation.id}`}
          confirmHint={`确认删除：${conversation.title}`}
          onConfirm={props.onDeleteConfirmed}
          onCancel={props.onDeleteCancelled}
        />
      ) : null}
    </Card>
  );
}

export function ConversationsScreen(props: { onOpenSettings: () => void }) {
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
          onOpenSettings={props.onOpenSettings}
        />
      )}
    </View>
  );
}
