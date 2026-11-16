// 档案页的「档案条目」区：当前状态按区域分组（肌肉看首要肌群、骨骼看区域），左右分开；
// 展开看四段依据、时间线，并在这里做「标记已解决 / 判定有误」两个更正。
//
// 两个动作都是**用户**的动作，不经过 agent 会话：落库时照样写四段依据，
// 但如实写明「未经复查」（ADR-0005 要求日志能说明它自己的来源）。
//
// 列表与条件用 NSH 的 `Each` / `If`：行按 key 保住，结构变化时节点按元素身份换。
// 撤回表单不塞进会重排的行里，摆在列表上方——它服务时间线上选中的那一条。
import { resource, signal, Text, token, View } from "nsh";
import { Findings, Plans } from "lianlian/native";
import type {
  AxisChipView,
  EvidenceSectionView,
  GroupWorstView,
  HistoryEntryView,
  PlanView,
  SiteCardView,
} from "lianlian/native";

import { fullDate, todayIso } from "../ui/dates";
import { Card, Note, PrimaryButton, SectionLabel, TextButton, TextField } from "../ui/parts";

/** 一个「部位 + 侧别」在 testID 里的写法。 */
function slugOf(card: SiteCardView): string {
  return card.side ? `${card.site}-${card.side}` : card.site;
}

/** 一个肌群聚合在 testID 里的写法。 */
function groupSlug(group: GroupWorstView): string {
  return group.side ? `${group.id}-${group.side}` : group.id;
}

/** 时间线上这条事件的动作名。 */
function actionZh(kind: string): string {
  return kind === "resolve" ? "解决" : kind === "retract" ? "撤回" : "写入";
}

/** 数字与日期一律等宽：滚动时列不会抖（契约 §2「数字」）。 */
const NUMBERS: ("tabular-nums")[] = ["tabular-nums"];

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
                fontVariant: NUMBERS,
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
function EvidenceLines(props: { testID: string; sections: EvidenceSectionView[] }) {
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
      <Note text="撤回不是删除：这条判定与理由仍留在依据日志里，只是不再生效；若它是该部位最后一条生效判定，这一行会从档案上消失。" />
    </View>
  );
}

/** 时间线：最近的在前，每条判定带自己的四段依据，撤回带理由。 */
function Timeline(props: {
  slug: string;
  card: () => SiteCardView;
  onRetractEntry: (finding: number) => void;
}) {
  return (
    <View
      testID={`timeline-${props.slug}`}
      style={{
        gap: 8,
        backgroundColor: token("muted"),
        borderRadius: token("radius"),
        padding: 10,
      }}
    >
      <SectionLabel text="时间线 · 最近的在前" />
      <Each<HistoryEntryView> of={props.card().timeline} key="index">
        {(entry, index) => (
          <View
            style={{ gap: 3 }}
            testID={`timeline-${props.slug}-entry`}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={{ fontSize: 11, fontVariant: NUMBERS, color: token("foreground") }}>
                {fullDate(entry().at)} · {actionZh(entry().kind)}
              </Text>
              <If when={entry().kind !== "retract"}>
                <Text style={{ fontSize: 11, color: token("foreground") }}>
                  {entry().values}
                </Text>
              </If>
              <If when={entry().current}>
                <Text style={{ fontSize: 10, color: token("primary") }}>当前生效</Text>
              </If>
            </View>
            <If when={entry().kind === "retract"}>
              <Text style={{ fontSize: 10, color: token("destructive") }}>
                理由：{entry().reason ?? ""}
              </Text>
            </If>
            <If when={entry().evidence.length > 0}>
              <EvidenceLines
                testID={`timeline-${props.slug}-evidence-${index()}`}
                sections={entry().evidence}
              />
            </If>
            <If when={entry().kind !== "retract" && !entry().current}>
              <TextButton
                testID={`retract-entry-${props.slug}-${index()}`}
                label="撤回这条"
                hint={`撤回 ${fullDate(entry().at)} 那条`}
                onPress={() => props.onRetractEntry(entry().finding)}
              />
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
  onResolve: () => void;
  onStartRetract: (finding: number) => void;
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
            <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
              {card().sideZh}
            </Text>
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
          <Text style={{ fontSize: 10, fontVariant: NUMBERS, color: token("muted-foreground") }}>
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
            <Note text="这条判定没有留下依据日志（旧数据），只能看时间线。" />
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
              onPress={() => props.onStartRetract(card().finding)}
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
            <Timeline slug={slug} card={card} onRetractEntry={props.onStartRetract} />
          </If>
        </View>
      </If>
    </View>
  );
}

/**
 * 计划卡片：频次、动作与复查日。每个动作都挂一条判定，点「看判定」就展开那个
 * 部位的卡片并打开它的时间线——这里和档案条目共用展开状态，所以放在这一区里。
 */
function PlanCard(props: {
  plan: PlanView;
  versions: PlanView[];
  versionsOpen: boolean;
  onToggleVersions: () => void;
  onFocus: (slug: string) => void;
}) {
  return (
    <Card testID="plan-card">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
          计划
        </Text>
        <SectionLabel
          testID="plan-version"
          text={`第 ${props.plan.version} 版 · ${props.plan.frequency}`}
        />
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 10, fontVariant: NUMBERS, color: token("muted-foreground") }}>
          复查 {fullDate(props.plan.reviewAt)}
        </Text>
      </View>
      <If
        when={props.plan.reviewDue}
        else={<Note text="每个动作后面都挂着它对应的判定；点「看判定」能翻到当时的依据。" />}
      >
        <Note
          testID="plan-review-due"
          tone="accent"
          text="复查日到了：跟 agent 说一声，让它按现在的档案重新排一版。"
        />
      </If>
      <Each of={props.plan.exercises} key={(exercise) => String(exercise.index)}>
        {(exercise) => (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, color: token("foreground") }}>
                {`${exercise().name} · ${exercise().prescription}`}
              </Text>
              <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
                {`来自「${exercise().siteZh}${exercise().sideZh ?? ""}」的判定`}
              </Text>
            </View>
            <TextButton
              testID={`plan-exercise-${exercise().index}`}
              label="看判定"
              hint={`看「${exercise().name}」对应的判定`}
              onPress={() => props.onFocus(exercise().slug)}
            />
          </View>
        )}
      </Each>
      <TextButton
        testID="plan-versions"
        label={
          props.versionsOpen ? "收起历史版本" : `历史版本（${props.versions.length}）`
        }
        onPress={props.onToggleVersions}
      />
      <If when={props.versionsOpen}>
        <View testID="plan-versions-list" style={{ gap: 4 }}>
          <Each of={props.versions} key={(version) => String(version.id)}>
            {(version) => (
              <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
                {`第 ${version().version} 版 · ${version().frequency} · ${version()
                  .exercises.map((exercise) => `${exercise.name} ${exercise.prescription}`)
                  .join("、")}${version().id === props.plan.id ? "（生效）" : "（只读）"}`}
              </Text>
            )}
          </Each>
        </View>
      </If>
    </Card>
  );
}

/** 肌群整体：成员逐轴取最差值，并指名最差的那一条来自哪里。 */
function GroupRow(props: { group: () => GroupWorstView }) {
  const slug = groupSlug(props.group());
  return (
    <View
      testID={`group-${slug}`}
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
        <Text style={{ fontSize: 10, fontVariant: NUMBERS, color: token("muted-foreground") }}>
          {props.group().memberCount} 块有判定
        </Text>
      </View>
      <AxisChips axes={props.group().axes} testID={`group-${slug}-axis`} />
      <Note
        text={`最差的一条来自「${props.group().sourceSiteZh}」（${props.group().sourceValues}）；每条轴各自取成员里最差的值。`}
      />
    </View>
  );
}

export function FindingsSection(props: { onGoConversations: () => void }) {
  const data = resource(() => Findings.load());
  const plans = resource(() => Plans.load(todayIso()));
  const versionsOpen = signal(false);
  const expanded = signal<string | null>(null);
  const timeline = signal<string | null>(null);
  const collapsed = signal<string[]>([]);
  const retracting = signal<{ slug: string; finding: number } | null>(null);
  const reason = signal("");
  const busy = signal<string | null>(null);
  const message = signal<string | null>(null);

  /** 正在填撤回理由的那一行。 */
  const retractingCard = () => {
    const target = retracting();
    if (!target) {
      return undefined;
    }
    return data()
      ?.sections.flatMap((section) => section.cards)
      .find((card) => slugOf(card) === target.slug);
  };

  /** 撤回目标那条判定在时间线上的时刻（表单上要说清撤的是哪一条）。 */
  const retractingAt = () => {
    const target = retracting();
    const card = retractingCard();
    if (!target || !card) {
      return null;
    }
    return card.timeline.find((entry) => entry.finding === target.finding)?.at ?? null;
  };

  /** 从计划的某个动作跳回它对应的判定：展开那张卡并打开时间线。 */
  const focusFinding = (slug: string) => {
    const card = data()
      ?.sections.flatMap((section) => section.cards)
      .find((card) => slugOf(card) === slug);
    if (!card) {
      message.set("这个动作对应的判定已经不在档案上了（被撤回的判定不显示）。");
      return;
    }
    message.set(null);
    expanded.set(slug);
    timeline.set(slug);
  };

  const toggleSection = (id: string) => {
    collapsed.set(
      collapsed().includes(id)
        ? collapsed().filter((each) => each !== id)
        : [...collapsed(), id],
    );
  };

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

  const retract = async () => {
    const target = retracting();
    if (!target) {
      return;
    }
    message.set(null);
    if (reason().trim() === "") {
      message.set("撤回要写理由：错在哪，下次才知道该信什么。");
      return;
    }
    busy.set(target.slug);
    const error = await Findings.retract(target.finding, reason());
    busy.set(null);
    if (error) {
      message.set(error);
      return;
    }
    message.set("已撤回这条判定（历史仍在依据日志里）。");
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

      <If when={plans() !== undefined}>
        <If when={plans()!.active !== null}>
          <PlanCard
            plan={plans()!.active!}
            versions={plans()!.versions}
            versionsOpen={versionsOpen()}
            onToggleVersions={() => versionsOpen.set(!versionsOpen())}
            onFocus={focusFinding}
          />
        </If>
        <If when={plans()!.error !== null}>
          <Card testID="plan-error">
            <Note tone="error" text={plans()!.error ?? ""} />
          </Card>
        </If>
      </If>

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

          <If when={retracting() !== null}>
            <Card testID="retract-form">
              <SectionLabel
                text={`撤回「${retractingCard()?.siteZh ?? ""}${retractingCard()?.sideZh ?? ""}」${
                  retractingAt() === null ? "" : ` ${fullDate(retractingAt() ?? 0)} 那条`
                }`}
              />
              <RetractForm
                slug={retracting()?.slug ?? ""}
                reason={reason()}
                onReason={(value) => reason.set(value)}
                onConfirm={retract}
                onCancel={() => {
                  retracting.set(null);
                  reason.set("");
                }}
              />
            </Card>
          </If>

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
              <View style={{ gap: 6 }}>
                <View
                  testID={`archive-section-${section().id}`}
                  role="button"
                  accessibilityLabel={`${section().label}，${section().cards.length} 处`}
                  onPress={() => toggleSection(section().id)}
                  style={{ flexDirection: "row", alignItems: "center" }}
                >
                  <SectionLabel text={section().label} />
                  <View style={{ flex: 1 }} />
                  <SectionLabel
                    text={`${section().cards.length} 处 · ${
                      collapsed().includes(section().id) ? "展开" : "收起"
                    }`}
                  />
                </View>
                <If when={!collapsed().includes(section().id)}>
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
                          onToggleTimeline={() =>
                            timeline.set(timeline() === slug ? null : slug)
                          }
                          onResolve={() => resolve(card(), slug)}
                          onStartRetract={(finding) => {
                            retracting.set({ slug, finding });
                            reason.set("");
                          }}
                        />
                      );
                    }}
                  </Each>
                </If>
              </View>
            )}
          </Each>

          <If when={data()!.groups.length > 0}>
            <SectionLabel text="肌群整体 · 成员最差值" />
          </If>
          <Each of={data()!.groups} key={(group) => groupSlug(group)}>
            {(group) => <GroupRow group={group} />}
          </Each>
        </View>
      </If>
    </View>
  );
}
