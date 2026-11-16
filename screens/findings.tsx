// 档案条目：当前状态按区域分组（肌肉看首要肌群、骨骼看区域），左右分开；
// 展开看四段依据、时间线，并在这里做「标记已解决 / 判定有误」两个更正。
//
// 两个动作都是**用户**的动作，不经过 agent 会话：落库时照样写四段依据，
// 但如实写明「未经复查」（ADR-0005 要求日志能说明它自己的来源）。
//
// 列表与条件用 NSH 的 `Each` / `If`：行按 key 保住，结构变化时节点按元素身份换。
// 撤回表单不塞进会重排的行里，摆在列表上方——它只服务当前选中的那一行。
import { resource, signal, Text, token, View } from "nsh";
import { Findings } from "lianlian/native";
import type {
  AxisChipView,
  GroupWorstView,
  HistoryEntryView,
  SiteCardView,
} from "lianlian/native";

import { fullDate } from "../ui/dates";
import { Card, Note, PrimaryButton, SectionLabel, TextButton, TextField } from "../ui/parts";

/** 一个「部位 + 侧别」在 testID 里的写法。 */
function slugOf(card: SiteCardView): string {
  return card.side ? `${card.site}-${card.side}` : card.site;
}

/** 一条轴一个标签：未测虚线、异常用 destructive，其余 muted。 */
function AxisChips(props: { axes: AxisChipView[]; testID: string }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      <Each of={props.axes} key={(axis) => axis.axis}>
        {(axis) => (
          <View
            testID={`${props.testID}-${axis().axis}`}
            style={{
              borderRadius: 999,
              paddingHorizontal: 8,
              paddingVertical: 3,
              backgroundColor: axis().abnormal
                ? token("destructive")
                : axis().measured
                  ? token("muted")
                  : "transparent",
              borderWidth: axis().measured ? 0 : 1,
              borderColor: token("border"),
              borderStyle: "dashed",
            }}
          >
            <Text
              style={{
                fontSize: 10,
                color: axis().abnormal
                  ? token("destructive-foreground")
                  : token("muted-foreground"),
              }}
            >
              {axis().measured
                ? `${axis().label} ${axis().value}`
                : `${axis().label} 未测`}
            </Text>
          </View>
        )}
      </Each>
    </View>
  );
}

/** 四段依据，按写入时的顺序原样显示。 */
function EvidenceLines(props: { testID: string; sections: { name: string; text: string }[] }) {
  return (
    <View testID={props.testID} style={{ gap: 4 }}>
      <Each of={props.sections} key={(section) => section.name}>
        {(section) => (
          <Text style={{ fontSize: 11, lineHeight: 17, color: token("muted-foreground") }}>
            {section().name}：{section().text}
          </Text>
        )}
      </Each>
    </View>
  );
}

/** 撤回表单：理由必填，填了才让写库。 */
function RetractForm(props: {
  slug: string;
  reason: string;
  onReason: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <SectionLabel text="撤回理由（必填）" />
      <TextField
        testID={`retract-reason-${props.slug}`}
        value={props.reason}
        placeholder="错在哪？比如：把臀中肌看成臀小肌了"
        onChange={props.onReason}
      />
      <View style={{ flexDirection: "row", gap: 12 }}>
        <TextButton
          testID={`retract-confirm-${props.slug}`}
          label="确认撤回"
          onPress={props.onConfirm}
        />
        <TextButton
          testID={`retract-cancel-${props.slug}`}
          label="取消"
          onPress={props.onCancel}
        />
      </View>
      <Note text="撤回不是删除：这条判定仍留在时间线里，只是不再生效。" />
    </View>
  );
}

/** 时间线：最近的在前，撤回事件带理由。 */
function Timeline(props: { slug: string; card: () => SiteCardView }) {
  return (
    <View
      testID={`timeline-${props.slug}`}
      style={{
        gap: 6,
        backgroundColor: token("muted"),
        borderRadius: token("radius"),
        padding: 10,
      }}
    >
      <SectionLabel text="时间线 · 最近的在前" />
      <Each<HistoryEntryView> of={props.card().timeline} key="index">
        {(entry) => (
          <View style={{ gap: 2 }} testID={`timeline-${props.slug}-entry`}>
            <Text style={{ fontSize: 11, color: token("foreground") }}>
              {fullDate(entry().at)} · {entry().kind === "retract" ? "撤回" : entry().values}
              {entry().current ? " · 当前生效" : ""}
            </Text>
            <If when={entry().kind === "retract"}>
              <Text style={{ fontSize: 10, color: token("destructive") }}>
                理由：{entry().reason ?? ""}
              </Text>
            </If>
            <If when={entry().evidence.length > 0}>
              <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
                {entry().evidence[0].name}：{entry().evidence[0].text}
              </Text>
            </If>
          </View>
        )}
      </Each>
    </View>
  );
}

/** 一行：头（部位 + 侧别 + 时间）+ 五轴；展开后是依据、两个动作与时间线。 */
function SiteRow(props: {
  card: () => SiteCardView;
  expanded: boolean;
  timelineOpen: boolean;
  busy: boolean;
  onToggle: () => void;
  onToggleTimeline: () => void;
  onStartRetract: () => void;
  onResolve: () => void;
}) {
  const card = props.card;
  const slug = slugOf(card());
  return (
    <View
      style={{
        backgroundColor: token("card"),
        borderRadius: token("radius"),
        borderWidth: card().resolved ? 1 : 0,
        borderColor: token("border"),
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 8,
      }}
    >
      <View
        testID={`site-${slug}`}
        role="button"
        accessibilityLabel={`${card().siteZh}${card().sideZh ?? ""}`}
        onPress={props.onToggle}
        style={{ gap: 8 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: "bold",
              color: card().resolved ? token("muted-foreground") : token("foreground"),
            }}
          >
            {card().siteZh}
          </Text>
          <If when={card().sideZh}>
            <Text style={{ fontSize: 10, color: token("muted-foreground") }}>{card().sideZh}</Text>
          </If>
          <If when={card().resolved}>
            <Text
              testID={`site-${slug}-resolved`}
              style={{ fontSize: 10, color: token("primary") }}
            >
              已解决
            </Text>
          </If>
          <View style={{ flex: 1 }} />
          <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
            {fullDate(card().at)}
          </Text>
        </View>
        <AxisChips axes={card().axes} testID={`site-${slug}-axis`} />
      </View>

      <If when={props.expanded}>
        <View style={{ gap: 8, borderTopWidth: 1, borderColor: token("border"), paddingTop: 8 }}>
          <SectionLabel
            text={
              card().evidenceAt == null ? "依据" : `依据 · ${fullDate(card().evidenceAt ?? 0)}`
            }
          />
          <If
            when={card().evidence.length === 0}
            else={<EvidenceLines testID={`site-${slug}-evidence`} sections={card().evidence} />}
          >
            <Note
              testID={`site-${slug}-no-evidence`}
              text="这条判定没有留下依据日志（旧数据），只能看时间线。"
            />
          </If>
          <Note text={`置信度 ${card().confidence} 分。`} />

          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
            <If when={!card().resolved}>
              <TextButton
                testID={`mark-resolved-${slug}`}
                label={props.busy ? "正在写…" : "标记已解决"}
                onPress={props.onResolve}
              />
            </If>
            <TextButton
              testID={`retract-${slug}`}
              label="判定有误"
              onPress={props.onStartRetract}
            />
            <TextButton
              testID={`open-timeline-${slug}`}
              label={
                props.timelineOpen ? "收起时间线" : `看时间线（${card().timeline.length} 条）`
              }
              onPress={props.onToggleTimeline}
            />
          </View>

          <If when={props.timelineOpen}>
            <Timeline slug={slug} card={card} />
          </If>
        </View>
      </If>
    </View>
  );
}

/** 肌群整体：成员逐轴取最差值，并指名最差来自哪块肌肉。 */
function GroupRow(props: { group: () => GroupWorstView; slug: string }) {
  return (
    <View
      testID={`group-${props.slug}`}
      style={{
        backgroundColor: token("card"),
        borderRadius: token("radius"),
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
          {props.group().zh}
        </Text>
        <If when={props.group().sideZh}>
          <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
            {props.group().sideZh}
          </Text>
        </If>
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
          {props.group().memberCount} 块有判定
        </Text>
      </View>
      <AxisChips axes={props.group().axes} testID={`group-${props.slug}-axis`} />
      <Note text={`最差来自「${props.group().sourceSiteZh}」：${props.group().sourceValues}。`} />
    </View>
  );
}

export function FindingsSection(props: { onGoConversations: () => void }) {
  const data = resource(() => Findings.load());
  const expanded = signal<string | null>(null);
  const timeline = signal<string | null>(null);
  const retracting = signal<string | null>(null);
  const reason = signal("");
  const busy = signal<string | null>(null);
  const message = signal<string | null>(null);

  /** 正在填撤回理由的那一行；表单放在列表上方，不塞进会重排的行里。 */
  const retractingCard = () =>
    data()
      ?.sections.flatMap((section) => section.cards)
      .find((card) => slugOf(card) === retracting());

  const resolve = async (card: SiteCardView, slug: string) => {
    message.set(null);
    busy.set(slug);
    const error = await Findings.resolve(card.finding);
    busy.set(null);
    if (error) {
      message.set(error);
      return;
    }
    message.set("已追加一条正常判定；原判定还在时间线里。");
    data.refetch();
  };

  const retract = async (card: SiteCardView, slug: string) => {
    message.set(null);
    if (reason().trim() === "") {
      message.set("撤回要写理由：错在哪，下次才知道该信什么。");
      return;
    }
    busy.set(slug);
    const error = await Findings.retract(card.finding, reason());
    busy.set(null);
    if (error) {
      message.set(error);
      return;
    }
    message.set("已撤回这条判定（历史仍在时间线里）。");
    retracting.set(null);
    reason.set("");
    data.refetch();
  };

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <SectionLabel
          text={`档案条目 · ${data() === undefined ? "…" : `${data()!.total} 处`}`}
        />
      </View>

      <If
        when={data() !== undefined}
        else={
          <Card>
            <Note text="正在读档案…" />
          </Card>
        }
      >
        <View style={{ gap: 8 }}>
          <If when={data()!.error}>
            <Card testID="findings-error">
              <Note tone="error" text={data()!.error ?? ""} />
            </Card>
          </If>
          <If when={message()}>
            <Card testID="findings-message">
              <Note tone="accent" text={message() ?? ""} />
            </Card>
          </If>

          {retracting() !== null ? (
            <Card testID="retract-form">
              <SectionLabel
                text={`撤回「${retractingCard()?.siteZh ?? ""}${retractingCard()?.sideZh ?? ""}」`}
              />
              <RetractForm
                slug={retracting() ?? ""}
                reason={reason()}
                onReason={(value) => reason.set(value)}
                onConfirm={() => {
                  const card = retractingCard();
                  if (card) {
                    retract(card, retracting() ?? "");
                  }
                }}
                onCancel={() => {
                  retracting.set(null);
                  reason.set("");
                }}
              />
            </Card>
          ) : null}

          <If when={data()!.total === 0}>
            <Card testID="findings-empty">
              <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
                档案还是空的
              </Text>
              <Note text="跟 agent 聊一次：它给你几个验证动作，你做完把感受告诉它，它才会在档案上落判定。没有判定就没有可以变的计划。" />
              <PrimaryButton
                testID="findings-start-assessment"
                label="去对话做首次评估"
                onPress={props.onGoConversations}
              />
            </Card>
          </If>

          <Each of={data()!.sections} key={(section) => section.id}>
            {(section) => (
              <View testID={`archive-section-${section().id}`} style={{ gap: 6 }}>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <SectionLabel text={section().label} />
                  <View style={{ flex: 1 }} />
                  <SectionLabel text={`${section().cards.length} 处`} />
                </View>
                <Each
                  of={section().cards}
                  key={(card) => (card.side ? `${card.site}-${card.side}` : card.site)}
                >
                  {(card) => {
                    const slug = slugOf(card());
                    return (
                      <SiteRow
                        card={card}
                        expanded={expanded() === slug}
                        timelineOpen={timeline() === slug}
                        busy={busy() === slug}
                        onToggle={() => {
                          expanded.set(expanded() === slug ? null : slug);
                          timeline.set(null);
                        }}
                        onToggleTimeline={() => timeline.set(timeline() === slug ? null : slug)}
                        onStartRetract={() => {
                          retracting.set(slug);
                          reason.set("");
                        }}
                        onResolve={() => resolve(card(), slug)}
                      />
                    );
                  }}
                </Each>
              </View>
            )}
          </Each>

          <If when={data()!.groups.length > 0}>
            <SectionLabel text="肌群整体 · 成员最差值" />
          </If>
          <Each of={data()!.groups} key={(group) => `${group.id}-${group.side ?? "midline"}`}>
            {(group) => (
              <GroupRow
                group={group}
                slug={group().side ? `${group().id}-${group().side}` : group().id}
              />
            )}
          </Each>
        </View>
      </If>
    </View>
  );
}
