// 对话：会话列表 + 单个会话的聊天。列表的默认面只显示未归档的会话，
// 归档的折叠在底部；删除清消息正文与照片，依据日志保留（ADR-0005 修订）。
//
// 消息列表用 `List`（长会话靠虚拟化滚动），输入条固定在下沿。
import {
  effect,
  Image,
  keyboardFrame,
  List,
  resource,
  safeAreaInsets,
  Scroll,
  signal,
  Text,
  token,
  View,
} from "nsh";
import { createNavStack, Dialog, Input, NavPage, NavStack } from "nsh/base";
import { BackHandler, isAvailable } from "nsh/mobile";
import { Conversations, Photos, Proposals } from "lianlian/native";
import type { ListRef } from "nsh";
import type {
  ChatErrorView,
  ConversationView,
  MessageView,
  ProposalDecisionInput,
  ProposalItemView,
  ProposalView,
} from "lianlian/native";

import {
  Card,
  ConfirmRow,
  Note,
  pageStyle,
  PrimaryButton,
  ScreenHeader,
  SectionLabel,
  TextButton,
} from "../ui/parts";
import { leading, typeScale } from "../ui/type";

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
        <Text style={{ fontSize: typeScale.label, color: token("muted-foreground") }}>
          读照片…
        </Text>
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
              fontSize: typeScale.body,
              lineHeight: leading.body,
              color: mine ? token("primary-foreground") : token("foreground"),
            }}
          >
            {props.message.text}
          </Text>
        )}
        <Text
          style={{
            fontSize: typeScale.label,
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

/** 回复到达前的时间线占位：只在界面上存在，不落库。 */
function ThinkingBubble() {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "flex-start",
        paddingHorizontal: 16,
        paddingVertical: 4,
      }}
    >
      <View
        style={{
          backgroundColor: token("card"),
          borderRadius: token("radius"),
          paddingHorizontal: 12,
          paddingVertical: 9,
        }}
      >
        <Text
          style={{
            fontSize: typeScale.body,
            lineHeight: leading.body,
            color: token("muted-foreground"),
          }}
        >
          思考中…
        </Text>
      </View>
    </View>
  );
}

/**
 * 预检失败（没 key、消息本身超长）的草稿按会话缓存：跳去设置再回来，
 * 打了一半的字还在。模型失败时用户消息已经落库，草稿已清空。
 * 键是会话编号，模块级——和 `ui/drafts.ts` 对表单草稿的处理同一个理由。
 */
const drafts = new Map<number, string>();

/** 时间线的一行：消息或提议卡（两者的编号来自同一个 MessageId 序列）。 */
type TimelineRow = {
  id: number;
  message?: MessageView;
  proposal?: ProposalView;
};

/** 一个会话的正文与输入条。 */
function Chat(props: {
  id: number;
  onBack: () => void;
  onChanged: () => void;
  onOpenSettings: () => void;
}) {
  const detail = resource(() => Conversations.open(props.id));
  const cachedDraft = drafts.get(props.id) ?? "";
  const draft = signal(cachedDraft);
  /** 输入框当前应显示的高度：一行 20，最多五行 100；超过后框内滚动。 */
  const composerHeight = signal(
    Math.min(100, Math.max(20, cachedDraft.split("\n").length * 20)),
  );
  const busy = signal(false);
  /** 正在等模型回复：列表尾部显示思考占位。 */
  const sending = signal(false);
  /** beginSend 已落库、但 detail 还没刷新到的用户消息。 */
  const pendingMessage = signal<MessageView | null>(null);
  const failure = signal<ChatErrorView | null>(null);
  /** 这一轮待发的照片（选好但还没发出去）。 */
  const attached = signal<{ id: number; dataUrl: string; notice: string | null } | null>(null);
  /** 点开看大图的那一张。 */
  const preview = signal<string | null>(null);
  const photoError = signal<string | null>(null);
  const proposalError = signal<string | null>(null);
  const insets = safeAreaInsets();

  /** 有一张待审的卡：这一条会话的发送入口全部锁住。 */
  const reviewLocked = () => Boolean(detail()?.pendingProposal);

  const messages = () => {
    const current = detail()?.messages ?? [];
    const optimistic = pendingMessage();
    if (optimistic && !current.some((message) => message.id === optimistic.id)) {
      return [...current, optimistic];
    }
    return current;
  };

  /** 消息与卡片行按 MessageId 排成一条时间线；已处理的卡只读地留在原位。 */
  const timeline = (): TimelineRow[] => {
    const rows: TimelineRow[] = messages().map((message) => ({
      id: message.id,
      message,
    }));
    for (const card of detail()?.proposalCards ?? []) {
      rows.push({ id: card.id, proposal: card.proposal });
    }
    return rows.sort((a, b) => a.id - b.id);
  };

  let list: ListRef | undefined;
  /** 刚生成的卡片行编号；它出现在时间线里后把卡头滚到列表顶部。 */
  const cardToReveal = signal<number | null>(null);
  let revealedCard = 0;
  let revealedLayout = 0;

  /** 把卡片行滚到列表顶部；它不在时间线里就什么都不做。 */
  const revealCard = (id: number) => {
    const index = timeline().findIndex((row) => row.id === id);
    if (index < 0) {
      return;
    }
    list?.scrollToIndex({ index, viewPosition: 0, animated: false });
  };

  // beginSend 返回的是真消息；detail 里出现同一条后就可以撤掉占位。
  effect(() => {
    const optimistic = pendingMessage();
    if (optimistic && detail()?.messages?.some((message) => message.id === optimistic.id)) {
      pendingMessage.set(null);
    }
  });

  // 新卡落库后停在卡头：8 项时按钮在下一屏，先让用户从标题读起。
  effect(() => {
    const wanted = cardToReveal();
    if (wanted === null || wanted === revealedCard) {
      return;
    }
    if (!timeline().some((row) => row.id === wanted)) {
      return;
    }
    revealedCard = wanted;
    // 等这一批布局（含列表的贴底/保持位置）落定，再把卡头放到顶部。
    setTimeout(() => revealCard(wanted), 0);
  });

  const reviewProposal = async (decisions: ProposalDecisionInput[]) => {
    // 双击 / 连点：第一下已经锁上，后来的提交直接丢掉。
    if (busy()) {
      return;
    }
    const proposal = detail()?.pendingProposal;
    if (!proposal) {
      return;
    }
    busy.set(true);
    proposalError.set(null);
    failure.set(null);
    const result = await Proposals.review(props.id, proposal.id, decisions);

    // 提交成功或失败但已经落库时，卡不再是待审，输入条立刻恢复；
    // 事务失败时卡还是待审，错误留在卡上，按钮可以再点。
    const next = await Conversations.open(props.id);
    busy.set(false);
    detail.mutate(next);
    if (result.error) {
      if (next.pendingProposal?.id === proposal.id) {
        proposalError.set(result.error.message);
      } else {
        failure.set(result.error);
      }
      props.onChanged();
      return;
    }
    props.onChanged();
    // 卡已定案：这一轮回复单独跑，不挡解锁。失败走现有的重试出口，
    // 重试只重发这条决策消息这一轮。
    void runReply(next.lastEntryId ?? null);
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

  const runReply = async (expected: number | null) => {
    // 再跑模型；失败时用户消息留在时间线，重试只复用最后一条。
    sending.set(true);
    const result = await Conversations.reply(props.id, expected);
    busy.set(false);
    sending.set(false);
    if (result.error) {
      failure.set(result.error);
    } else if (result.proposalCard) {
      cardToReveal.set(result.proposalCard);
    }
    detail.refetch();
    props.onChanged();
  };

  const send = async () => {
    const text = draft();
    const photo = attached();
    // 审核后的那一轮回复还在跑时不再发下一条：这一轮有它自己的顺序。
    if ((text.trim() === "" && !photo) || busy() || sending()) {
      return;
    }
    busy.set(true);
    failure.set(null);

    // 先落用户消息：模型还在跑，时间线上已经能看到这句话。
    const started = await Conversations.beginSend(props.id, text, photo ? photo.id : null);
    if (started.error) {
      busy.set(false);
      failure.set(started.error);
      return;
    }
    writeDraft("");
    attached.set(null);
    composerHeight.set(20);
    if (started.message) {
      pendingMessage.set(started.message);
    }

    detail.refetch();
    await runReply(started.message ? started.message.id : null);
  };

  const retry = async () => {
    if (busy()) {
      return;
    }
    busy.set(true);
    failure.set(null);
    // 用最后一条条目（可能是不可见的审核决策消息）对齐这一轮。
    await runReply(detail()?.lastEntryId ?? null);
  };

  return (
    <View style={{ flex: 1 }}>
      <Dialog
        open={preview() !== null}
        onOpenChange={(event) => {
          if (!event.open) {
            preview.set(null);
          }
        }}
        style={{
          flex: 1,
          backgroundColor: token("background"),
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
        backdropStyle={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      >
        <View
          testID="photo-preview"
          style={{
            flex: 1,
            width: "100%",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
          }}
        >
          {preview() ? (
            <Image
              src={preview()!}
              style={{ width: "92%", height: "80%", objectFit: "contain" }}
            />
          ) : null}
          <PrimaryButton
            testID="close-photo-preview"
            label="关闭"
            onPress={() => preview.set(null)}
          />
        </View>
      </Dialog>
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
            fontSize: typeScale.item,
            fontWeight: "bold",
            color: token("foreground"),
          }}
        >
          {detail()?.title ?? "新会话"}
        </Text>
        <SectionLabel
          text={`${messages().length} 条`}
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
        <View style={{ flex: 1, paddingBottom: "env(keyboard-inset-height)" }}>
          <List
            ref={(node) => {
              list = node;
            }}
            testID="message-list"
            each={timeline()}
            keyExtractor={(row: TimelineRow) => String(row.id)}
            initialScrollAtEnd
            maintainVisibleContentPosition={{ autoscrollToBottomThreshold: 80 }}
            keyboardDismissMode="interactive"
            style={{ flex: 1 }}
            contentStyle={{ paddingTop: 8, paddingBottom: 8 }}
            footer={sending() ? <ThinkingBubble /> : null}
            empty={
              <View style={{ paddingHorizontal: 16 }}>
                <Note text="还没有消息。说点什么，它会先把它记下来。" />
              </View>
            }
          >
            {(row: () => TimelineRow) => (
              <View
                onLayout={
                  row().proposal
                    ? () => {
                        const id = row().id;
                        // 布局落定后再对齐一次：贴底 / 保持位置可能把卡头拽回去。
                        // 每张卡只补这一次，不无限重试。
                        if (id !== cardToReveal() || id === revealedLayout) {
                          return;
                        }
                        revealedLayout = id;
                        revealedCard = id;
                        setTimeout(() => revealCard(id), 0);
                      }
                    : undefined
                }
              >
                {row().message ? (
                  <MessageRow
                    message={row().message!}
                    onOpenPhoto={(photoId) => {
                      Photos.data(photoId).then((url) => preview.set(url));
                    }}
                  />
                ) : row().proposal ? (
                  row().proposal!.status === "pending" ? (
                    <ProposalCard
                      proposal={row().proposal!}
                      busy={busy()}
                      onSubmit={reviewProposal}
                    />
                  ) : (
                    <ReviewedProposal proposal={row().proposal!} />
                  )
                ) : null}
              </View>
            )}
          </List>

          {proposalError() ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
              <Card testID="proposal-error">
                <Note tone="error" text={proposalError()!} />
              </Card>
            </View>
          ) : null}

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
                    <TextButton
                      testID="retry-send"
                      label="重试"
                      disabled={reviewLocked()}
                      onPress={retry}
                    />
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

          {reviewLocked() ? (
            <View testID="review-lock" style={{ paddingHorizontal: 16, paddingBottom: 2 }}>
              <SectionLabel text="先把这张卡审完" />
            </View>
          ) : null}

          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: 8,
              paddingHorizontal: 16,
              paddingTop: 10,
              paddingBottom: 10 + (keyboardFrame().height > 0 ? 0 : insets().bottom),
              borderTopWidth: 1,
              borderColor: token("border"),
            }}
          >
            <TextButton
              testID="pick-photo"
              label="照片"
              disabled={reviewLocked()}
              onPress={pick}
            />
            <View style={{ flex: 1 }}>
              <Input
                testID="message-input"
                value={draft()}
                multiline
                readonly={reviewLocked()}
                placeholder={reviewLocked() ? "先把这张卡审完" : "说点什么…"}
                onChange={(event) => writeDraft(event.value)}
                onContentSizeChange={({ size }) => composerHeight.set(Math.min(size.height, 100))}
                style={{
                  backgroundColor: token("muted"),
                  borderRadius: token("radius"),
                  paddingHorizontal: 12,
                  paddingVertical: 9,
                  fontSize: typeScale.item,
                  lineHeight: leading.item,
                  height: Math.max(composerHeight(), leading.item) + 18,
                  color: token("foreground"),
                }}
              />
            </View>
            <PrimaryButton
              testID="send"
              label={busy() ? "…" : "发送"}
              disabled={
                reviewLocked() || busy() || sending() || (draft().trim() === "" && !attached())
              }
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

/** 待审的提议卡：勾选=采纳，不勾=不要，一个按钮提交整张卡。 */
function ProposalCard(props: {
  proposal: ProposalView;
  busy: boolean;
  onSubmit: (decisions: ProposalDecisionInput[]) => void;
}) {
  const selected = signal<number[] | null>(null);
  const expanded = signal<number[]>([]);
  const reasonOpen = signal<number | null>(null);
  const reasons = signal<Record<number, string>>({});

  const defaults = () =>
    props.proposal.items
      .filter((item) => item.selectedByDefault && item.state === "pending")
      .map((item) => item.index);
  const current = () => selected() ?? defaults();
  const checked = (item: ProposalItemView) => current().includes(item.index);
  const toggle = (item: ProposalItemView) => {
    if (checked(item)) {
      selected.set(current().filter((index) => index !== item.index));
      if (reasonOpen() === item.index) {
        reasonOpen.set(null);
      }
    } else {
      const next = current().filter((index) => index !== item.index);
      next.push(item.index);
      selected.set(next.sort((a, b) => a - b));
    }
  };

  const reasonFor = (index: number) => reasons()[index] ?? "";
  const setReason = (index: number, text: string) =>
    reasons.set({ ...reasons(), [index]: text });

  const total = props.proposal.items.length;
  const checkedCount = () => current().length;
  const defaultCount = defaults().length;
  const decisions = (): ProposalDecisionInput[] =>
    props.proposal.items.map((item) => ({
      index: item.index,
      accept: checked(item),
      reason: checked(item) ? undefined : reasonFor(item.index).trim() || undefined,
    }));

  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <Card testID="proposal-card">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{
              flex: 1,
              fontSize: typeScale.item,
              fontWeight: "bold",
              color: token("foreground"),
            }}
          >
            {`它想改这 ${total} 处`}
          </Text>
          <SectionLabel text="逐项审" />
        </View>
        <SectionLabel text={`建议采纳这 ${defaultCount} 项`} />

        {props.proposal.items.map((item) => {
          const open = expanded().includes(item.index);
          const isChecked = checked(item);
          const whyOpen = reasonOpen() === item.index;
          return (
            <View style={{ gap: 6 }}>
              <View
                testID={`proposal-item-${item.index}`}
                role="button"
                accessibilityLabel={`第 ${item.index + 1} 项、${item.siteZh}${item.sideZh ?? ""}、${isChecked ? "采纳" : "不要"}`}
                accessibilityState={{ checked: isChecked }}
                onPress={() => toggle(item)}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}
              >
                <Text
                  style={{
                    width: 14,
                    fontSize: typeScale.label,
                    color: token("muted-foreground"),
                    textAlign: "right",
                  }}
                >
                  {item.index + 1}
                </Text>
                <CheckBubble checked={isChecked} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: typeScale.body, color: token("foreground") }}>
                    {item.siteZh}
                    {item.sideZh ?? ""}：{item.values}
                  </Text>
                  <SectionLabel
                    text={`置信度 ${Math.round(item.confidence)}${item.lowConfidence ? " · 低置信度" : ""}`}
                  />
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 12, paddingLeft: 46 }}>
                <TextButton
                  testID={`proposal-evidence-${item.index}`}
                  label={open ? "收起依据" : "看依据"}
                  hint={`${open ? "收起" : "看"}第 ${item.index + 1} 项${item.siteZh}${item.sideZh ?? ""}的依据`}
                  onPress={() =>
                    expanded.set(
                      open
                        ? expanded().filter((index) => index !== item.index)
                        : [...expanded(), item.index],
                    )
                  }
                />
                {!isChecked && !whyOpen ? (
                  <TextButton
                    testID={`reject-reason-${item.index}`}
                    label="为什么"
                    hint={`第 ${item.index + 1} 项${item.siteZh}${item.sideZh ?? ""}为什么不要`}
                    onPress={() => reasonOpen.set(item.index)}
                  />
                ) : null}
              </View>

              {open ? (
                <View style={{ paddingLeft: 30, gap: 4 }}>
                  {item.evidence.map((section) => (
                    <Text
                      style={{
                        fontSize: typeScale.label,
                        lineHeight: leading.label,
                        color: token("muted-foreground"),
                      }}
                    >
                      {section.name}：{section.text}
                    </Text>
                  ))}
                </View>
              ) : null}

              {!isChecked && whyOpen ? (
                <View style={{ paddingLeft: 46, gap: 6 }}>
                  <Input
                    testID={`reject-reason-${item.index}`}
                    value={reasonFor(item.index)}
                    multiline
                    accessibilityLabel={`第 ${item.index + 1} 项${item.siteZh}${item.sideZh ?? ""}：为什么不要（可选）`}
                    placeholder="为什么不对？（可选，会作为证据留下）"
                    onChange={(event) => setReason(item.index, event.value)}
                    style={{
                      backgroundColor: token("muted"),
                      borderRadius: token("radius"),
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      fontSize: typeScale.item,
                      color: token("foreground"),
                    }}
                  />
                </View>
              ) : null}
            </View>
          );
        })}

        <PrimaryButton
          testID="accept-proposal"
          label={
            checkedCount() === 0
              ? `这 ${total} 项都不要`
              : checkedCount() === total
                ? "全部采纳"
                : `采纳勾选的 ${checkedCount()} 项`
          }
          outline={checkedCount() === 0}
          disabled={props.busy}
          onPress={() => props.onSubmit(decisions())}
        />
        {checkedCount() === 0 ? (
          <SectionLabel text="都不是？全部不要，然后跟我说哪里不对" />
        ) : null}
      </Card>
    </View>
  );
}

/**
 * 已处理的卡：默认收成一行，点开只读回看当时的选择。
 *
 * 没有勾选圈、没有「拒绝这一项」、没有撤销；要改就接着说，由对话追加「更正」。
 */
function ReviewedProposal(props: { proposal: ProposalView }) {
  const open = signal(false);
  const expanded = signal<number[]>([]);
  const accepted = props.proposal.items.filter((item) => item.state === "accepted").length;
  const rejected = props.proposal.items.filter((item) => item.state === "rejected").length;
  return (
    <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
      <Card testID={`reviewed-proposal-${props.proposal.id}`}>
        <View
          testID={`proposal-summary-${props.proposal.id}`}
          role="button"
          accessibilityLabel={open() ? "收起这张卡" : "展开看当时的选择"}
          onPress={() => open.set(!open())}
          style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
        >
          <Text style={{ flex: 1, fontSize: typeScale.body, color: token("foreground") }}>
            {open()
              ? `已写进 ${accepted} 项，不要 ${rejected} 项`
              : `已写进 ${accepted} 项，不要 ${rejected} 项 · 展开看当时的选择`}
          </Text>
          {open() ? <SectionLabel text="收起" /> : null}
        </View>
        {open()
          ? props.proposal.items.map((item) => {
              const evidenceOpen = expanded().includes(item.index);
              return (
                <View style={{ gap: 6 }}>
                  <View
                    testID={`reviewed-item-${props.proposal.id}-${item.index}`}
                    style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 }}
                  >
                    <Text
                      style={{
                        width: 14,
                        fontSize: typeScale.label,
                        color: token("muted-foreground"),
                        textAlign: "right",
                      }}
                    >
                      {item.index + 1}
                    </Text>
                    <Text
                      style={{
                        width: 18,
                        fontSize: typeScale.body,
                        color:
                          item.state === "accepted" ? token("primary") : token("muted-foreground"),
                      }}
                    >
                      {item.state === "accepted" ? "✓" : "✗"}
                    </Text>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ fontSize: typeScale.body, color: token("foreground") }}>
                        {item.siteZh}
                        {item.sideZh ?? ""}：{item.values}
                      </Text>
                      <SectionLabel text={item.state === "accepted" ? "已采纳" : "不要"} />
                      {item.state !== "accepted" && item.rejectionReason ? (
                        <Text
                          style={{
                            fontSize: typeScale.label,
                            lineHeight: leading.label,
                            color: token("muted-foreground"),
                          }}
                        >
                          {item.rejectionReason}
                        </Text>
                      ) : null}
                    </View>
                    <TextButton
                      testID={`reviewed-evidence-${props.proposal.id}-${item.index}`}
                      label={evidenceOpen ? "收起依据" : "看依据"}
                      onPress={() =>
                        expanded.set(
                          evidenceOpen
                            ? expanded().filter((index) => index !== item.index)
                            : [...expanded(), item.index],
                        )
                      }
                    />
                  </View>
                  {evidenceOpen ? (
                    <View style={{ paddingLeft: 42, gap: 4 }}>
                      {item.evidence.map((section) => (
                        <Text
                          style={{
                            fontSize: typeScale.label,
                            lineHeight: leading.label,
                            color: token("muted-foreground"),
                          }}
                        >
                          {section.name}：{section.text}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })
          : null}
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
              fontSize: typeScale.item,
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

type ChatRoute = { name: "list" } | { name: "chat"; id: number };

export function ConversationsScreen(props: {
  onOpenSettings: () => void;
  onRootBack: () => void;
  onChatOpenChange: (open: boolean) => void;
}) {
  const list = resource(() => Conversations.list());
  const nav = createNavStack<ChatRoute>([{ name: "list" }]);
  const showArchived = signal(false);
  const menu = signal<number | null>(null);
  const confirmDelete = signal<number | null>(null);
  const error = signal<string | null>(null);

  // 列表里的菜单与删除确认是瞬态层：返回键先收掉它们，再轮到页面栈。
  if (isAvailable) {
    BackHandler.on("press", () => {
      if (nav.routes().length > 1) {
        return false;
      }
      if (confirmDelete() !== null) {
        confirmDelete.set(null);
        return true;
      }
      if (menu() !== null) {
        menu.set(null);
        return true;
      }
      return false;
    });
  }

  const openChat = (id: number) => {
    const top = nav.routes()[nav.routes().length - 1];
    if (top?.name === "chat" && top.id === id) {
      return;
    }
    menu.set(null);
    confirmDelete.set(null);
    nav.push({ name: "chat", id });
  };

  const start = async () => {
    error.set(null);
    const id = await Conversations.create();
    if (id === 0) {
      error.set("没能新开会话：本地库打不开。");
      return;
    }
    openChat(id);
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
  };

  return (
    <NavStack
      state={nav}
      style={pageStyle()}
      onChange={(event) => {
        props.onChatOpenChange(event.routes.length > 1);
        if (event.routes.length === 1) {
          list.refetch();
        }
      }}
    >
      {(route) =>
        route.name === "list" ? (
          <NavPage
            title="对话"
            headerVisible={false}
            popOnBack={false}
            onBackPress={props.onRootBack}
            style={pageStyle()}
          >
            <Scroll
              testID="conversation-list-scroll"
              style={{ flex: 1 }}
              contentStyle={{ paddingBottom: 24 }}
            >
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
                  onOpen={() => openChat(conversation.id)}
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
                        onOpen={() => openChat(conversation.id)}
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
            </Scroll>
          </NavPage>
        ) : (
          <NavPage title="对话" headerVisible={false} style={pageStyle()}>
            <Chat
              id={route.id}
              onBack={() => nav.pop()}
              onChanged={() => list.refetch()}
              onOpenSettings={props.onOpenSettings}
            />
          </NavPage>
        )
      }
    </NavStack>
  );
}
