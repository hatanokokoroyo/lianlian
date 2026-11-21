// 档案页的「档案条目」区：当前状态按区域分组（肌肉看首要肌群、骨骼看区域），左右分开；
// 展开看四段依据、时间线，并在这里做「标记已解决 / 判定有误」两个更正。
//
// 两个动作都是**用户**的动作，不经过 agent 会话：落库时照样写四段依据，
// 但如实写明「未经复查」（ADR-0005 要求日志能说明它自己的来源）。
//
// 列表与条件用 NSH 的 `Each` / `If`：行按 key 保住，结构变化时节点按元素身份换。
// 撤回表单不塞进会重排的行里，摆在列表上方——它服务时间线上选中的那一条。
import { resource, Scroll, signal, Text, token, View } from "nsh";
import { Findings, Plans } from "lianlian/native";
import type {
  AxisChipView,
  EvidenceSectionView,
  GroupWorstView,
  HistoryEntryView,
  PlanView,
  SiteCardView,
  SiteSectionView,
} from "lianlian/native";

import { fullDate, todayIso } from "../ui/dates";
import {
  Card,
  Note,
  PrimaryButton,
  ScreenHeader,
  SectionLabel,
  TextButton,
  TextField,
} from "../ui/parts";
import { leading, typeScale } from "../ui/type";

/** 一个「部位 + 侧别」在 testID 里的写法。 */
function slugOf(card: SiteCardView): string {
  return card.side ? `${card.site}-${card.side}` : card.site;
}

/** 一个肌群聚合在 testID 里的写法。 */
function groupSlug(group: GroupWorstView): string {
  return group.side ? `${group.id}-${group.side}` : group.id;
}

/** 这张卡有没有需要处理的轴。 */
function isAbnormal(card: SiteCardView): boolean {
  return card.axes.some((axis) => axis.abnormal);
}

/** 这个区域里有几张需要处理的卡。 */
function abnormalCount(section: SiteSectionView): number {
  return section.cards.filter(isAbnormal).length;
}

/** 异常轴越多越靠前；一样多时取最近的一条。 */
function worstCard(section: SiteSectionView): SiteCardView | undefined {
  return section.cards
    .filter(isAbnormal)
    .slice()
    .sort(
      (left, right) =>
        right.axes.filter((axis) => axis.abnormal).length -
          left.axes.filter((axis) => axis.abnormal).length || right.at - left.at,
    )[0];
}

/** 最差那条的可读说法：部位 + 侧别 + 轴名 + 取值。 */
function worstText(card: SiteCardView | undefined): string {
  if (!card) {
    return "状态平稳";
  }
  const axis = card.axes.find((each) => each.abnormal);
  if (!axis) {
    return "状态平稳";
  }
  return `${card.siteZh}${card.sideZh ?? ""} · ${axis.label} ${axis.value}`;
}

/** 区域里最近一次判定的时间。 */
function latestAt(section: SiteSectionView): number {
  return Math.max(...section.cards.map((card) => card.at));
}

/** 双列网格用：每两个区域一行。 */
function pairRows(sections: SiteSectionView[]): SiteSectionView[][] {
  const rows: SiteSectionView[][] = [];
  for (let index = 0; index < sections.length; index += 2) {
    rows.push(sections.slice(index, index + 2));
  }
  return rows;
}

/** 需要先处理：只挑有异常判定的肌群，异常处数多的排前面。 */
function attentionSections(sections: SiteSectionView[]): SiteSectionView[] {
  return sections
    .filter((section) => section.kind === "muscle" && abnormalCount(section) > 0)
    .slice()
    .sort(
      (left, right) =>
        abnormalCount(right) - abnormalCount(left) || latestAt(right) - latestAt(left),
    );
}

/** 「需要先处理」里所有肌群的异常卡总数：与每行「N 处」同一口径。 */
function attentionCount(sections: SiteSectionView[]): number {
  return attentionSections(sections).reduce(
    (total, section) => total + abnormalCount(section),
    0,
  );
}

/** 根页的一张区域索引卡。 */
function RegionTile(props: { section: SiteSectionView; onOpen: () => void }) {
  const section = props.section;
  const abnormal = abnormalCount(section);
  const worst = worstCard(section);
  const kind = section.kind === "bone" ? "骨骼" : "肌肉";
  return (
    <View
      testID={`archive-section-${section.id}`}
      role="button"
      accessibilityLabel={`${section.label}，${section.cards.length} 处${
        abnormal > 0 ? `，${abnormal} 处需要注意` : ""
      }`}
      onPress={props.onOpen}
      style={{
        flex: 1,
        backgroundColor: token("card"),
        borderRadius: token("radius"),
        borderWidth: abnormal > 0 ? 1 : 0,
        borderColor: token("destructive"),
        padding: 12,
        gap: 4,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Text
          style={{
            flex: 1,
            fontSize: typeScale.body,
            fontWeight: "bold",
            color: token("foreground"),
          }}
        >
          {section.label}
        </Text>
        <Text
          style={{
            fontSize: typeScale.label,
            fontVariant: NUMBERS,
            color: token("muted-foreground"),
          }}
        >
          {section.cards.length}
        </Text>
      </View>
      <Text
        style={{
          fontSize: typeScale.label,
          color: abnormal > 0 ? token("destructive") : token("muted-foreground"),
        }}
      >
        {worstText(worst)}
      </Text>
      <Text style={{ fontSize: typeScale.label, color: token("muted-foreground") }}>
        {`${kind} · ${fullDate(latestAt(section))}`}
      </Text>
    </View>
  );
}

/** 骨骼区域没有肌群聚合，只取当前最差的一张卡。 */
function BoneWorst(props: { section: SiteSectionView }) {
  const card = worstCard(props.section);
  return (
    <View
      style={{
        backgroundColor: token("card"),
        borderRadius: token("radius"),
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 6,
      }}
    >
      <SectionLabel text="区域整体 · 最差的一条" />
      <Text
        style={{
          fontSize: typeScale.label,
          color: card ? token("destructive") : token("muted-foreground"),
        }}
      >
        {worstText(card)}
      </Text>
      <Note text="骨骼区域没有肌群聚合；这里取当前最差的一张卡。" />
    </View>
  );
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
                fontSize: typeScale.label,
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
          <Text
            style={{
              fontSize: typeScale.label,
              lineHeight: leading.label,
              color: token("muted-foreground"),
            }}
          >
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
              <Text
                style={{ fontSize: typeScale.label, fontVariant: NUMBERS, color: token("foreground") }}
              >
                {fullDate(entry().at)} · {actionZh(entry().kind)}
              </Text>
              <If when={entry().kind !== "retract"}>
                <Text style={{ fontSize: typeScale.label, color: token("foreground") }}>
                  {entry().values}
                </Text>
              </If>
              <If when={entry().current}>
                <Text style={{ fontSize: typeScale.label, color: token("primary") }}>
                  当前生效
                </Text>
              </If>
            </View>
            <If when={entry().kind === "retract"}>
              <Text style={{ fontSize: typeScale.label, color: token("destructive") }}>
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
              fontSize: typeScale.item,
              fontWeight: "bold",
              color: card().resolved ? token("muted-foreground") : token("foreground"),
            }}
          >
            {card().siteZh}
          </Text>
          <If when={card().sideZh}>
            <Text style={{ fontSize: typeScale.label, color: token("muted-foreground") }}>
              {card().sideZh}
            </Text>
          </If>
          <If when={card().resolved}>
            <Text
              testID={`site-${slug}-resolved`}
              style={{ fontSize: typeScale.label, color: token("primary") }}
            >
              已解决
            </Text>
          </If>
          <View style={{ flex: 1 }} />
          <Text
            style={{
              fontSize: typeScale.label,
              fontVariant: NUMBERS,
              color: token("muted-foreground"),
            }}
          >
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

/** 根页计划摘要：只留版本、频次、复查日与动作数，完整清单进计划页。 */
function PlanSummary(props: { plan: PlanView; onOpen: () => void }) {
  return (
    <Card testID="plan-card">
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ fontSize: typeScale.item, fontWeight: "bold", color: token("foreground") }}>
          计划
        </Text>
        <SectionLabel
          testID="plan-version"
          text={`第 ${props.plan.version} 版 · ${props.plan.frequency}`}
        />
        <View style={{ flex: 1 }} />
        <Text
          style={{
            fontSize: typeScale.label,
            fontVariant: NUMBERS,
            color: token("muted-foreground"),
          }}
        >
          复查 {fullDate(props.plan.reviewAt)}
        </Text>
      </View>
      <If
        when={props.plan.reviewDue}
        else={<Note text="每个动作后面都挂着它对应的判定；进计划页能翻到当时的依据。" />}
      >
        <Note
          testID="plan-review-due"
          tone="accent"
          text="复查日到了：跟 agent 说一声，让它按现在的档案重新排一版。"
        />
      </If>
      <Note text={`${props.plan.exercises.length} 个动作；完整处方与历史版本在计划页。`} />
      <TextButton testID="open-plan" label="看完整计划" onPress={props.onOpen} />
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
        <Text style={{ fontSize: typeScale.item, fontWeight: "bold", color: token("foreground") }}>
          {props.group().zh}
        </Text>
        <If when={props.group().sideZh}>
          <Text style={{ fontSize: typeScale.label, color: token("muted-foreground") }}>
            {props.group().sideZh}
          </Text>
        </If>
        <View style={{ flex: 1 }} />
        <Text
          style={{
            fontSize: typeScale.label,
            fontVariant: NUMBERS,
            color: token("muted-foreground"),
          }}
        >
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

export function FindingsOverview(props: {
  onGoConversations: () => void;
  onOpenSection: (sectionId: string, focusSlug?: string) => void;
  onOpenPlan: () => void;
  onGoAnatomy3dAttention: () => void;
}) {
  const data = resource(() => Findings.load());
  const plans = resource(() => Plans.load(todayIso()));

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <SectionLabel
          text={`档案条目 · ${data() === undefined ? "…" : `${data()!.total} 处`}`}
        />
        <View style={{ flex: 1 }} />
        <If when={data() !== undefined && data()!.total > 0}>
          <SectionLabel text={`${data()!.sections.length} 个区域`} />
        </If>
      </View>

      <If when={plans() !== undefined}>
        <If when={plans()!.active !== null}>
          <PlanSummary plan={plans()!.active!} onOpen={props.onOpenPlan} />
        </If>
        <If when={plans()!.active === null && plans()!.error === null}>
          <Card testID="plan-empty">
            <Text
              style={{ fontSize: typeScale.item, fontWeight: "bold", color: token("foreground") }}
            >
              还没有计划
            </Text>
            <Note text="跟 agent 聊一次，让它按你的档案与训练条件排第一版。" />
            <PrimaryButton
              testID="plan-start"
              label="去对话排计划"
              onPress={props.onGoConversations}
            />
          </Card>
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

        <If when={data()!.total === 0}>
          <Card testID="findings-empty">
            <Text
              style={{ fontSize: typeScale.item, fontWeight: "bold", color: token("foreground") }}
            >
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

        <If when={data()!.total > 0}>
          <View testID="profile-attention" style={{ gap: 6 }}>
            <SectionLabel text="需要先处理的肌群" />
            <If when={attentionSections(data()!.sections).length === 0}>
              <Note text="目前没有需要优先处理的肌群。" />
            </If>
            <Each
              of={attentionSections(data()!.sections)}
              key={(section) => section.id}
            >
              {(section) => (
                <View
                  testID={`attention-${section().id}`}
                  role="button"
                  accessibilityLabel={`${section().label}，${abnormalCount(
                    section(),
                  )} 处需要注意`}
                  onPress={() => props.onOpenSection(section().id)}
                  style={{
                    backgroundColor: token("card"),
                    borderRadius: token("radius"),
                    borderWidth: 1,
                    borderColor: token("destructive"),
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    gap: 3,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text
                      style={{
                        flex: 1,
                        fontSize: typeScale.body,
                        fontWeight: "bold",
                        color: token("foreground"),
                      }}
                    >
                      {section().label}
                    </Text>
                    <Text
                      style={{
                        fontSize: typeScale.label,
                        fontVariant: NUMBERS,
                        color: token("destructive"),
                      }}
                    >
                      {`${abnormalCount(section())} 处`}
                    </Text>
                  </View>
                  <Text style={{ fontSize: typeScale.label, color: token("destructive") }}>
                    {worstText(worstCard(section()))}
                  </Text>
                </View>
              )}
            </Each>
            <If when={attentionSections(data()!.sections).length > 0}>
              <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
                <TextButton
                  testID="open-anatomy3d-attention"
                  label={`在 3D 里看这 ${attentionCount(data()!.sections)} 处 ›`}
                  hint="在 3D 身体图里查看这些需要先处理的肌群"
                  onPress={props.onGoAnatomy3dAttention}
                />
              </View>
            </If>
          </View>

          <SectionLabel text="全部区域" />
          <Each
            of={pairRows(data()!.sections)}
            key={(row) => row.map((entry) => entry.id).join("|")}
          >
            {(row) => (
              <View style={{ flexDirection: "row", gap: 8 }}>
                {row().map((entry) => (
                  <RegionTile
                    section={entry}
                    onOpen={() => props.onOpenSection(entry.id)}
                  />
                ))}
                <If when={row().length === 1}>
                  <View style={{ flex: 1 }} />
                </If>
              </View>
            )}
          </Each>
        </If>
      </View>
    </If>
    </View>
  );
}

/** 计划页：完整动作、每个动作的判定入口与历史版本。 */
export function PlanPage(props: {
  onBack: () => void;
  onOpenSection: (sectionId: string, focusSlug?: string) => void;
  onGoConversations: () => void;
}) {
  const plans = resource(() => Plans.load(todayIso()));
  const findings = resource(() => Findings.load());
  const versionsOpen = signal(false);
  const message = signal<string | null>(null);

  /** 找到包含这个动作判定的区域，带上 focusSlug 进入区域页。 */
  const focusFinding = async (slug: string) => {
    const snapshot = findings() ?? (await Findings.load());
    const section = snapshot
      ?.sections.find((each) => each.cards.some((card) => slugOf(card) === slug));
    if (!section) {
      message.set("这个动作对应的判定已经不在档案上了（被撤回的判定不显示）。");
      return;
    }
    message.set(null);
    props.onOpenSection(section.id, slug);
  };

  const plan = () => plans()?.active ?? null;

  return (
    <Scroll testID="plan-scroll" style={{ flex: 1 }} contentStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <TextButton testID="back" label="← 回档案" onPress={props.onBack} />
      </View>

      <If
        when={plans() !== undefined}
        else={
          <View style={{ padding: 16 }}>
            <Note text="正在读计划…" />
          </View>
        }
      >
        <ScreenHeader
          eyebrow="计划"
          title={plan() ? `第 ${plan()!.version} 版` : "还没有计划"}
          note={
            plan()
              ? `${plan()!.frequency} · ${plan()!.exercises.length} 个动作 · 复查 ${fullDate(
                  plan()!.reviewAt,
                )}`
              : "有判定之后，agent 才能按档案排计划。"
          }
        />

        <View style={{ padding: 16, gap: 12 }}>
          <If when={plans()!.error !== null}>
            <Card testID="plan-error">
              <Note tone="error" text={plans()!.error ?? ""} />
            </Card>
          </If>
          <If when={message()}>
            <Card testID="findings-message">
              <Note tone="accent" text={message() ?? ""} />
            </Card>
          </If>

          <If when={plan() === null && plans()!.error === null}>
            <Card testID="plan-page-empty">
              <Text
                style={{ fontSize: typeScale.item, fontWeight: "bold", color: token("foreground") }}
              >
                还没有计划
              </Text>
              <Note text="先去对话做评估；有了判定，agent 才会排第一版。" />
              <PrimaryButton
                testID="plan-page-start"
                label="去对话排计划"
                onPress={props.onGoConversations}
              />
            </Card>
          </If>

          <If when={plan() !== null}>
            <Card testID="plan-page">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text
                  style={{ fontSize: typeScale.item, fontWeight: "bold", color: token("foreground") }}
                >
                  生效计划
                </Text>
                <SectionLabel
                  testID="plan-page-version"
                  text={`第 ${plan()!.version} 版 · ${plan()!.frequency}`}
                />
                <View style={{ flex: 1 }} />
                <Text
                  style={{
                    fontSize: typeScale.label,
                    fontVariant: NUMBERS,
                    color: token("muted-foreground"),
                  }}
                >
                  复查 {fullDate(plan()!.reviewAt)}
                </Text>
              </View>
              <If
                when={plan()!.reviewDue}
                else={<Note text="每个动作后面都挂着它对应的判定；点「看判定」能翻到当时的依据。" />}
              >
                <Note
                  testID="plan-review-due"
                  tone="accent"
                  text="复查日到了：跟 agent 说一声，让它按现在的档案重新排一版。"
                />
              </If>
              <Each of={plan()!.exercises} key={(exercise) => String(exercise.index)}>
                {(exercise) => (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: typeScale.body, color: token("foreground") }}>
                        {`${exercise().name} · ${exercise().prescription}`}
                      </Text>
                      <Text style={{ fontSize: typeScale.label, color: token("muted-foreground") }}>
                        {`来自「${exercise().siteZh}${exercise().sideZh ?? ""}」的判定`}
                      </Text>
                    </View>
                    <TextButton
                      testID={`plan-exercise-${exercise().index}`}
                      label="看判定"
                      hint={`看「${exercise().name}」对应的判定`}
                      onPress={() => focusFinding(exercise().slug)}
                    />
                  </View>
                )}
              </Each>
            </Card>

            <Card>
              <TextButton
                testID="plan-versions"
                label={
                  versionsOpen()
                    ? "收起历史版本"
                    : `历史版本（${plans()!.versions.length}）`
                }
                onPress={() => versionsOpen.set(!versionsOpen())}
              />
              <If when={versionsOpen()}>
                <View testID="plan-versions-list" style={{ gap: 4 }}>
                  <Each of={plans()!.versions} key={(version) => String(version.id)}>
                    {(version) => (
                      <Text style={{ fontSize: typeScale.label, color: token("muted-foreground") }}>
                        {`第 ${version().version} 版 · ${version().frequency} · ${version()
                          .exercises.map(
                            (exercise) => `${exercise.name} ${exercise.prescription}`,
                          )
                          .join("、")}${
                          version().id === plan()!.id ? "（生效）" : "（只读）"
                        }`}
                      </Text>
                    )}
                  </Each>
                </View>
              </If>
            </Card>
          </If>
        </View>
      </If>
    </Scroll>
  );
}

/** 区域页：只放这一个区域的卡片、聚合与更正入口。 */
export function FindingsSectionPage(props: {
  sectionId: string;
  focusSlug?: string;
  onBack: () => void;
}) {
  const data = resource(() => Findings.load());
  const expanded = signal<string | null>(props.focusSlug ?? null);
  const timeline = signal<string | null>(props.focusSlug ?? null);
  const retracting = signal<{ slug: string; finding: number } | null>(null);
  const reason = signal("");
  const busy = signal<string | null>(null);
  const message = signal<string | null>(null);

  const emptySection: SiteSectionView = {
    id: props.sectionId,
    label: "",
    kind: "bone",
    cards: [],
  };
  const section = () => data()?.sections.find((each) => each.id === props.sectionId);
  const sectionCards = () => section()?.cards ?? [];
  const groups = () => (data()?.groups ?? []).filter((group) => group.id === props.sectionId);

  const retractingCard = () => {
    const target = retracting();
    if (!target) {
      return undefined;
    }
    return sectionCards().find((card) => slugOf(card) === target.slug);
  };

  const retractingAt = () => {
    const target = retracting();
    const card = retractingCard();
    if (!target || !card) {
      return null;
    }
    return card.timeline.find((entry) => entry.finding === target.finding)?.at ?? null;
  };

  const focusMissing = () =>
    props.focusSlug !== undefined &&
    data() !== undefined &&
    !sectionCards().some((card) => slugOf(card) === props.focusSlug);

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
    <View style={{ flex: 1 }}>
      <Scroll
        testID={`section-scroll-${props.sectionId}`}
        style={{ flex: 1 }}
        contentStyle={{ paddingBottom: 24 }}
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <TextButton testID="back" label="← 回档案" onPress={props.onBack} />
        </View>

        <If
          when={data() !== undefined}
          else={
            <View style={{ padding: 16 }}>
              <Note text="正在读档案…" />
            </View>
          }
        >
          <ScreenHeader
            eyebrow={`档案条目 · ${
              section()?.kind === "bone" ? "骨骼" : section() ? "肌肉" : "区域"
            }`}
            title={section()?.label ?? "区域"}
            note={
              section()
                ? `${sectionCards().length} 处判定 · ${abnormalCount(section()!)} 处需要注意`
                : "这个区域已经没有生效判定。"
            }
          />

          <View style={{ padding: 16, gap: 12 }}>
            <If when={data()?.error}>
              <Card testID="findings-error">
                <Note tone="error" text={data()?.error ?? ""} />
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

            <If when={section() === undefined || sectionCards().length === 0}>
              <Card testID="section-empty">
                <Text
                  style={{ fontSize: typeScale.item, fontWeight: "bold", color: token("foreground") }}
                >
                  这个区域已经没有生效判定
                </Text>
                <Note text="撤回不会删除历史；依据日志里仍然留着它。" />
                <PrimaryButton testID="section-back" label="回档案" onPress={props.onBack} />
              </Card>
            </If>

            <If when={section() !== undefined && sectionCards().length > 0}>
              <View style={{ gap: 8 }}>
                <If when={section()?.kind === "muscle"}>
                  <If when={groups().length > 0}>
                    <SectionLabel text="肌群整体 · 成员最差值" />
                  </If>
                  <Each of={groups()} key={(group) => groupSlug(group)}>
                    {(group) => <GroupRow group={group} />}
                  </Each>
                </If>

                <If when={section()?.kind === "bone"}>
                  <BoneWorst section={section() ?? emptySection} />
                </If>

                <If when={focusMissing()}>
                  <Card testID="section-focus-missing">
                    <Note
                      tone="accent"
                      text="这个动作对应的判定已经不在这个区域上了（可能被撤回）。"
                    />
                  </Card>
                </If>

                <Each
                  of={sectionCards()}
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
              </View>
            </If>
          </View>
        </If>
      </Scroll>
    </View>
  );
}
