// 对话：会话列表 + 单个会话的聊天。列表的默认面只显示未归档的会话，
// 归档的折叠在底部；删除清消息正文与照片，依据日志保留（ADR-0005 修订）。
//
// 消息列表用 `List`（长会话靠虚拟化滚动），输入条固定在下沿。
import { Image, List, resource, signal, Text, token, View } from "nsh";
import { Input } from "nsh/base";
import { Conversations, Photos, Proposals } from "lianlian/native";
import type {
  ChatErrorView,
  ConversationView,
  MessageView,
  ProposalItemView,
  ProposalView,
} from "lianlian/native";

import {
  Card,
  ConfirmRow,
  Note,
  PrimaryButton,
  ScreenHeader,
  SectionLabel,
  TextButton,
  TextField,
} from "../ui/parts";

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
  const proposalError = signal<string | null>(null);

  const acceptProposal = async (selected: number[]) => {
    const proposal = detail()?.pendingProposal;
    if (!proposal) {
      return;
    }
    busy.set(true);
    proposalError.set(null);
    const error = await Proposals.accept(props.id, proposal.id, selected);
    busy.set(false);
    if (error) {
      proposalError.set(error);
    }
    detail.refetch();
    props.onChanged();
  };

  const rejectItem = async (index: number, reason: string) => {
    const proposal = detail()?.pendingProposal;
    if (!proposal) {
      return;
    }
    busy.set(true);
    proposalError.set(null);
    failure.set(null);
    // 拒绝会自动发起一轮（#10）：模型必须在下一轮给出下一步。
    const result = await Proposals.reject(props.id, proposal.id, index, reason);
    busy.set(false);
    if (result.error) {
      failure.set(result.error);
    }
    detail.refetch();
    props.onChanged();
  };

  const undoProposal = async (proposalId: number, reason: string) => {
    busy.set(true);
    proposalError.set(null);
    const error = await Proposals.undo(proposalId, reason);
    busy.set(false);
    if (error) {
      proposalError.set(error);
    }
    detail.refetch();
    props.onChanged();
  };

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

          {proposalError() ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
              <Card testID="proposal-error">
                <Note tone="error" text={proposalError()!} />
              </Card>
            </View>
          ) : null}

          {detail()?.pendingProposal ? (
            <ProposalCard
              proposal={detail()!.pendingProposal!}
              busy={busy()}
              onAccept={acceptProposal}
              onReject={rejectItem}
              onUndo={(reason) => undoProposal(detail()!.pendingProposal!.id, reason)}
            />
          ) : null}

          {(detail()?.acceptedProposals ?? []).map((proposal) => (
            <AcceptedProposal
              proposal={proposal}
              busy={busy()}
              onUndo={(reason) => undoProposal(proposal.id, reason)}
            />
          ))}

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

/** 一项的勾选圆圈：实心=已勾。 */
function CheckBubble(props: { checked: boolean }) {
  return (
    <View
      style={{
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: props.checked ? 0 : 1,
        borderColor: token("muted-foreground"),
        backgroundColor: props.checked ? token("primary") : token("card"),
      }}
    />
  );
}

/** 提议卡：默认勾选按置信度，逐项可展开看依据，接受 / 拒绝 / 撤销。 */
function ProposalCard(props: {
  proposal: ProposalView;
  busy: boolean;
  onAccept: (selected: number[]) => void;
  onReject: (index: number, reason: string) => void;
  onUndo: (reason: string) => void;
}) {
  const selected = signal<number[] | null>(null);
  const expanded = signal<number[]>([]);
  const rejecting = signal<number | null>(null);
  const rejectReason = signal("");
  const undoOpen = signal(false);
  const undoReason = signal("");

  const defaults = () =>
    props.proposal.items
      .filter((item) => item.selectedByDefault && item.state === "pending")
      .map((item) => item.index);
  // 只有还待定的项才能勾：接受过之后，之前记住的勾选自然失效。
  const current = () =>
    (selected() ?? defaults()).filter(
      (index) => props.proposal.items.find((item) => item.index === index)?.state === "pending",
    );
  const checked = (item: ProposalItemView) => current().includes(item.index);
  const toggle = (item: ProposalItemView) => {
    const next = current().filter((index) => index !== item.index);
    if (!checked(item)) {
      next.push(item.index);
    }
    selected.set(next.sort((a, b) => a - b));
  };

  const pending = props.proposal.items.filter((item) => item.state === "pending");

  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <Card testID="proposal-card">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
            {props.proposal.items.some((item) => item.state === "accepted")
              ? `已写进 ${props.proposal.items.filter((item) => item.state === "accepted").length} 项，还剩 ${pending.length} 项可审`
              : `它想改这 ${props.proposal.items.length} 处`}
          </Text>
          <SectionLabel text="逐项审" />
        </View>

        {props.proposal.items.map((item) => {
          const open = expanded().includes(item.index);
          const isRejecting = rejecting() === item.index;
          const decided = item.state !== "pending";
          return (
            <View style={{ gap: 6 }}>
              <View
                testID={`proposal-item-${item.index}`}
                role="button"
                accessibilityLabel={`${item.siteZh}${item.sideZh ?? ""}`}
                onPress={() => {
                  if (!decided) {
                    toggle(item);
                  }
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}
              >
                <CheckBubble checked={decided ? item.state === "accepted" : checked(item)} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 13, color: token("foreground") }}>
                    {item.siteZh}
                    {item.sideZh ?? ""}：{item.values}
                  </Text>
                  <SectionLabel
                    text={`置信度 ${Math.round(item.confidence)}${item.lowConfidence ? " · 低置信度" : ""}${
                      item.state === "rejected" ? " · 已拒绝" : item.state === "accepted" ? " · 已接受" : ""
                    }`}
                  />
                </View>
                <TextButton
                  testID={`proposal-evidence-${item.index}`}
                  label={open ? "收起依据" : "看依据"}
                  onPress={() =>
                    expanded.set(
                      open
                        ? expanded().filter((index) => index !== item.index)
                        : [...expanded(), item.index],
                    )
                  }
                />
              </View>

              {open ? (
                <View style={{ paddingLeft: 30, gap: 4 }}>
                  {item.evidence.map((section) => (
                    <Text style={{ fontSize: 11, lineHeight: 16, color: token("muted-foreground") }}>
                      {section.name}：{section.text}
                    </Text>
                  ))}
                </View>
              ) : null}

              {!decided && !isRejecting ? (
                <View style={{ flexDirection: "row", paddingLeft: 30 }}>
                  <TextButton
                    testID={`reject-item-${item.index}`}
                    label="拒绝这一项"
                    onPress={() => {
                      rejecting.set(item.index);
                      rejectReason.set("");
                    }}
                  />
                </View>
              ) : null}

              {isRejecting ? (
                <View style={{ paddingLeft: 30, gap: 6 }}>
                  <Input
                    testID="reject-reason"
                    value={rejectReason()}
                    multiline
                    placeholder="为什么不对？（可选，会作为证据留下）"
                    onChange={(event) => rejectReason.set(event.value)}
                    style={{
                      backgroundColor: token("muted"),
                      borderRadius: token("radius"),
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      fontSize: 12,
                      color: token("foreground"),
                    }}
                  />
                  <View style={{ flexDirection: "row", gap: 12 }}>
                    <PrimaryButton
                      testID="reject-proposal"
                      label="拒绝这一项"
                      disabled={props.busy}
                      onPress={() => {
                        const index = rejecting();
                        if (index !== null) {
                          rejecting.set(null);
                          props.onReject(index, rejectReason());
                        }
                      }}
                    />
                    <TextButton
                      testID="cancel-reject"
                      label="取消"
                      onPress={() => rejecting.set(null)}
                    />
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}

        {pending.length > 0 ? (
          <PrimaryButton
            testID="accept-proposal"
            label={
              current().length === 0
                ? "接受选中"
                : current().length === pending.length
                  ? "全部接受"
                  : `接受选中 ${current().length} 项`
            }
            disabled={props.busy || current().length === 0}
            onPress={() => props.onAccept(current())}
          />
        ) : null}

        {/* 有接受过的项就还能撤销；撤销回到待确认，可以重新勾。 */}
        {props.proposal.items.some((item) => item.state === "accepted") ? (
          undoOpen() ? (
            <View style={{ gap: 6 }}>
              <TextField
                testID="undo-reason"
                value={undoReason()}
                onChange={(value: string) => undoReason.set(value)}
                placeholder="错在哪？（必须写，历史不会删）"
              />
              <View style={{ flexDirection: "row", gap: 12 }}>
                <PrimaryButton
                  testID="undo-confirm"
                  label="撤销这一批"
                  disabled={props.busy || undoReason().trim() === ""}
                  onPress={() => {
                    undoOpen.set(false);
                    props.onUndo(undoReason());
                  }}
                />
                <TextButton testID="cancel-undo" label="算了" onPress={() => undoOpen.set(false)} />
              </View>
            </View>
          ) : (
            <View style={{ flexDirection: "row" }}>
              <TextButton testID="undo" label="撤销已接受的" onPress={() => undoOpen.set(true)} />
            </View>
          )
        ) : null}
      </Card>
    </View>
  );
}

/** 已应用的卡：一句摘要 + 撤销。 */
function AcceptedProposal(props: {
  proposal: ProposalView;
  busy: boolean;
  onUndo: (reason: string) => void;
}) {
  const open = signal(false);
  const reason = signal("");
  const accepted = props.proposal.items.filter((item) => item.state === "accepted");
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <Card testID={`accepted-proposal-${props.proposal.id}`}>
        <Text style={{ fontSize: 12, color: token("foreground") }}>
          已写进档案 {accepted.length} 项：
          {accepted.map((item) => `${item.siteZh}${item.sideZh ?? ""}`).join("、")}
        </Text>
        {open() ? (
          <View style={{ gap: 6 }}>
            <TextField
              testID="undo-reason"
              value={reason()}
              onChange={(value: string) => reason.set(value)}
              placeholder="错在哪？（必须写，历史不会删）"
            />
            <View style={{ flexDirection: "row", gap: 12 }}>
              <PrimaryButton
                testID="undo-confirm"
                label="撤销"
                disabled={props.busy || reason().trim() === ""}
                onPress={() => {
                  open.set(false);
                  props.onUndo(reason());
                }}
              />
              <TextButton testID="cancel-undo" label="算了" onPress={() => open.set(false)} />
            </View>
          </View>
        ) : (
          <View style={{ flexDirection: "row" }}>
            <TextButton testID="undo" label="撤销这一批" onPress={() => open.set(true)} />
          </View>
        )}
      </Card>
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
          text="删除这个会话？消息正文与照片会被清掉；它产生的依据日志保留（标注来源已删除），档案不会因此失忆。"
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
