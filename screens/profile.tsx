// 档案页：档案条目（判定与依据，见 findings.tsx）在前，基本属性与训练条件在后。
// 四个字段都可以留空；留空时页面明说「未填」，不拿 0 冒充。
import { effect, resource, Scroll, signal, Text, token, View } from "nsh";
import type { Signal } from "nsh";
import { createNavStack, NavPage, NavStack } from "nsh/base";
import { Profile, Storage } from "lianlian/native";
import type { ProfileView } from "lianlian/native";

import type { ProfileDrafts } from "../ui/drafts";
import { BasicsFields, TrainingFields, basicsPayload, trainingPayload } from "../ui/forms";
import { FindingsOverview, FindingsSectionPage, PlanPage } from "./findings";
import { MeasurementsScreen } from "./measurements";
import { SettingsScreen } from "./settings";
import {
  Card,
  Note,
  pageStyle,
  PrimaryButton,
  ScreenHeader,
  SectionLabel,
  TextButton,
} from "../ui/parts";

/** 字节 → 「812 B」/「12.4 KB」/「3.1 MB」。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ProfileRoute =
  | { name: "root" }
  | { name: "section"; id: string; focus?: string }
  | { name: "plan" }
  | { name: "basics" }
  | { name: "measurements" }
  | { name: "training" }
  | { name: "storage" }
  | { name: "settings" };

export function ProfileScreen(props: {
  state: ProfileView;
  drafts: ProfileDrafts;
  onSaved: () => void;
  onGoConversations: () => void;
  settingsRequest: Signal<"none" | "settings">;
  onRootBack: () => void;
}) {
  const nav = createNavStack<ProfileRoute>([{ name: "root" }]);

  const openPage = (
    name: "plan" | "basics" | "measurements" | "training" | "storage" | "settings",
  ) => {
    const top = nav.routes()[nav.routes().length - 1];
    if (top?.name === name) {
      return;
    }
    nav.push({ name });
  };

  const openSection = (id: string, focus?: string) => {
    const top = nav.routes()[nav.routes().length - 1];
    if (top?.name === "section" && top.id === id && top.focus === focus) {
      return;
    }
    nav.push({ name: "section", id, focus });
  };

  // 从对话的错误态跳过来时，切到档案后直接推进设置页。
  effect(() => {
    if (props.settingsRequest() !== "settings") {
      return;
    }
    props.settingsRequest.set("none");
    openPage("settings");
  });

  return (
    <NavStack
      state={nav}
      style={pageStyle()}
      onChange={(event) => {
        if (event.routes.length === 1) {
          props.onSaved();
        }
      }}
    >
      {(route) =>
        route.name === "root" ? (
          <NavPage
            title="档案"
            headerVisible={false}
            popOnBack={false}
            onBackPress={props.onRootBack}
            style={pageStyle()}
          >
            <ProfileRoot
              state={props.state}
              drafts={props.drafts}
              onOpenSection={openSection}
              onOpenPlan={() => openPage("plan")}
              onGoBasics={() => openPage("basics")}
              onGoMeasurements={() => openPage("measurements")}
              onGoTraining={() => openPage("training")}
              onGoStorage={() => openPage("storage")}
              onGoSettings={() => openPage("settings")}
              onGoConversations={props.onGoConversations}
            />
          </NavPage>
        ) : route.name === "section" ? (
          <NavPage title="档案条目" headerVisible={false} style={pageStyle()}>
            <FindingsSectionPage
              sectionId={route.id}
              focusSlug={route.focus}
              onBack={() => nav.pop()}
            />
          </NavPage>
        ) : route.name === "plan" ? (
          <NavPage title="计划" headerVisible={false} style={pageStyle()}>
            <PlanPage
              onBack={() => nav.pop()}
              onOpenSection={openSection}
              onGoConversations={props.onGoConversations}
            />
          </NavPage>
        ) : route.name === "basics" ? (
          <NavPage title="基本属性" headerVisible={false} style={pageStyle()}>
            <BasicsPage
              drafts={props.drafts}
              state={props.state}
              onBack={() => nav.pop()}
            />
          </NavPage>
        ) : route.name === "measurements" ? (
          <NavPage title="测量" headerVisible={false} style={pageStyle()}>
            <MeasurementsScreen onBack={() => nav.pop()} />
          </NavPage>
        ) : route.name === "training" ? (
          <NavPage title="训练条件" headerVisible={false} style={pageStyle()}>
            <TrainingPage
              drafts={props.drafts}
              onBack={() => nav.pop()}
            />
          </NavPage>
        ) : route.name === "storage" ? (
          <NavPage title="本地数据" headerVisible={false} style={pageStyle()}>
            <StoragePage onBack={() => nav.pop()} />
          </NavPage>
        ) : (
          <NavPage title="设置" headerVisible={false} style={pageStyle()}>
            <SettingsScreen onBack={() => nav.pop()} />
          </NavPage>
        )
      }
    </NavStack>
  );
}

/** 性别在摘要里的写法。 */
function sexZh(sex: string | null | undefined): string | null {
  if (sex === "female") {
    return "女";
  }
  if (sex === "male") {
    return "男";
  }
  return null;
}

/** 根页基本属性摘要：性别、年龄、基础疾病条数。 */
function basicsSummary(state: ProfileView): string {
  const parts: string[] = [];
  const sex = sexZh(state.basics.sex);
  if (sex) {
    parts.push(sex);
  }
  if (state.basics.age !== null) {
    parts.push(`${state.basics.age} 岁`);
  }
  if (state.basics.conditions.length > 0) {
    parts.push(`${state.basics.conditions.length} 条基础疾病或旧伤`);
  }
  return parts.length > 0 ? parts.join(" · ") : "还没填";
}

/** 根页测量摘要：最新一条身高体重。 */
function measurementsSummary(state: ProfileView): string {
  return `当前 ${state.basics.heightCm ?? "—"} cm · ${state.basics.weightKg ?? "—"} kg`;
}

/** 根页训练条件摘要：齐不齐，以及每周几天、每次多久。 */
function trainingSummary(state: ProfileView): string {
  if (!state.readiness.ready) {
    return `不齐全 · 还差：${state.readiness.missingZh.join("、")}`;
  }
  return `齐全 · 每周 ${state.training.daysPerWeek ?? "—"} 天 · 每次 ${
    state.training.minutesPerSession ?? "—"
  } 分钟`;
}

/** 根页「我的数据」的一行：摘要 + 动作词。 */
function DataRow(props: {
  testID: string;
  title: string;
  summary: string;
  summaryTestID?: string;
  action: string;
  last?: boolean;
  onPress: () => void;
}) {
  return (
    <View
      testID={props.testID}
      role="button"
      accessibilityLabel={`${props.title}：${props.summary}，${props.action}`}
      onPress={props.onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 9,
        borderBottomWidth: props.last ? 0 : 1,
        borderColor: token("border"),
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
          {props.title}
        </Text>
        <Text
          testID={props.summaryTestID}
          style={{ fontSize: 10, color: token("muted-foreground") }}
        >
          {props.summary}
        </Text>
      </View>
      <Text style={{ fontSize: 10, color: token("accent") }}>{`${props.action} ›`}</Text>
    </View>
  );
}

function ProfileRoot(props: {
  state: ProfileView;
  drafts: ProfileDrafts;
  onOpenSection: (sectionId: string, focusSlug?: string) => void;
  onOpenPlan: () => void;
  onGoBasics: () => void;
  onGoMeasurements: () => void;
  onGoTraining: () => void;
  onGoStorage: () => void;
  onGoSettings: () => void;
  onGoConversations: () => void;
}) {
  const capacity = resource(() => Storage.load());

  return (
    <Scroll testID="profile-scroll" style={{ flex: 1 }} contentStyle={{ paddingBottom: 24 }}>
      <ScreenHeader
        eyebrow="档案"
        title="身体档案"
        note="先看生效计划和需要处理的肌群；点区域进子页看依据与时间线。"
      />

      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <TextButton testID="open-settings" label="设置与 key" onPress={props.onGoSettings} />
        </View>

        <FindingsOverview
          onGoConversations={props.onGoConversations}
          onOpenSection={props.onOpenSection}
          onOpenPlan={props.onOpenPlan}
        />

        <View style={{ gap: 6 }}>
          <SectionLabel text="我的数据" />
          <Card testID="profile-data">
            <DataRow
              testID="open-basics"
              title="基本属性"
              summary={basicsSummary(props.state)}
              action="编辑"
              onPress={props.onGoBasics}
            />
            <DataRow
              testID="open-measurements"
              title="测量"
              summary={measurementsSummary(props.state)}
              summaryTestID="profile-body-metrics"
              action="趋势"
              onPress={props.onGoMeasurements}
            />
            <DataRow
              testID="open-training"
              title="训练条件"
              summary={trainingSummary(props.state)}
              action="修改"
              onPress={props.onGoTraining}
            />
            <DataRow
              testID="open-storage"
              title="本地数据"
              summary={
                capacity() === undefined
                  ? "正在算占用…"
                  : capacity()!.error
                    ? "读不到本地占用"
                    : `已用 ${formatBytes(capacity()!.totalBytes)}`
              }
              action="查看"
              last
              onPress={props.onGoStorage}
            />
            <If when={!props.state.readiness.ready}>
              <Note
                testID="profile-training-missing"
                text={`还差：${props.state.readiness.missingZh.join("、")}。缺项时不排计划。`}
              />
            </If>
          </Card>
        </View>
      </View>
    </Scroll>
  );
}

/** 基本属性子页：沿用草稿与保存接口，身高体重只读（来自测量）。 */
function BasicsPage(props: {
  state: ProfileView;
  drafts: ProfileDrafts;
  onBack: () => void;
}) {
  const error = signal<string | null>(null);
  const saved = signal<string | null>(null);

  const save = async () => {
    error.set(null);
    saved.set(null);
    const payload = basicsPayload(props.drafts.basics, false);
    const message = await Profile.saveBasics(
      payload.sex,
      payload.age,
      payload.heightCm,
      payload.weightKg,
      payload.conditions,
    );
    if (message) {
      error.set(message);
      return;
    }
    saved.set("基本属性已保存");
  };

  return (
    <Scroll testID="basics-scroll" style={{ flex: 1 }} contentStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <TextButton testID="back" label="← 回档案" onPress={props.onBack} />
      </View>
      <ScreenHeader
        eyebrow="我的数据"
        title="基本属性"
        note="身高体重来自测量记录；这里改性别、年龄与基础疾病或旧伤。"
      />
      <View style={{ padding: 16, gap: 12 }}>
        {error() ? (
          <Card testID="profile-error">
            <Note tone="error" text={error() ?? ""} />
          </Card>
        ) : null}
        {saved() ? (
          <Card testID="profile-saved">
            <Note tone="accent" text={saved() ?? ""} />
          </Card>
        ) : null}
        <Card testID="profile-body-metrics">
          <SectionLabel text="当前测量" />
          <Note text={measurementsSummary(props.state)} />
        </Card>
        <Card>
          <BasicsFields draft={props.drafts.basics} />
          <PrimaryButton testID="save-basics" label="保存基本属性" onPress={save} />
        </Card>
      </View>
    </Scroll>
  );
}

/** 训练条件子页：保存后父层重取档案，根页摘要随之更新。 */
function TrainingPage(props: {
  drafts: ProfileDrafts;
  onBack: () => void;
}) {
  const error = signal<string | null>(null);
  const saved = signal<string | null>(null);

  const save = async () => {
    error.set(null);
    saved.set(null);
    const payload = trainingPayload(props.drafts.training);
    const message = await Profile.saveTraining(
      payload.daysPerWeek,
      payload.minutesPerSession,
      payload.places,
      payload.equipment,
    );
    if (message) {
      error.set(message);
      return;
    }
    saved.set("训练条件已保存");
  };

  return (
    <Scroll testID="training-scroll" style={{ flex: 1 }} contentStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <TextButton testID="back" label="← 回档案" onPress={props.onBack} />
      </View>
      <ScreenHeader
        eyebrow="我的数据"
        title="训练条件"
        note="四项都填了，agent 才能据此排计划；缺项时不排。"
      />
      <View style={{ padding: 16, gap: 12 }}>
        {error() ? (
          <Card testID="profile-error">
            <Note tone="error" text={error() ?? ""} />
          </Card>
        ) : null}
        {saved() ? (
          <Card testID="profile-saved">
            <Note tone="accent" text={saved() ?? ""} />
          </Card>
        ) : null}
        <Card>
          <TrainingFields draft={props.drafts.training} />
          <PrimaryButton testID="save-training" label="保存训练条件" onPress={save} />
        </Card>
      </View>
    </Scroll>
  );
}

/** 本地数据子页：容量明细表从根页搬到这里，根页只留已用总量。 */
function StoragePage(props: { onBack: () => void }) {
  const capacity = resource(() => Storage.load());

  return (
    <Scroll testID="storage-scroll" style={{ flex: 1 }} contentStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <TextButton testID="back" label="← 回档案" onPress={props.onBack} />
      </View>
      <ScreenHeader
        eyebrow="我的数据"
        title="本地数据"
        note="只在本机：数据库与照片各占多少，按表分开算。"
      />
      <View style={{ padding: 16 }}>
        <Card testID="storage-capacity">
          {capacity() === undefined ? (
            <Note text="正在算本地数据占用…" />
          ) : (
            <View style={{ gap: 6 }}>
              <Note
                text={`已用 ${formatBytes(capacity()!.totalBytes)} · 数据库 ${formatBytes(
                  capacity()!.databaseBytes,
                )} · 照片 ${formatBytes(capacity()!.photoBytes)}`}
              />
              {capacity()!.error ? (
                <Note tone="error" text={capacity()!.error ?? ""} />
              ) : null}
              {capacity()!.tables.length === 0 ? (
                <Note text="库里还没有可统计的数据。" />
              ) : (
                <Each of={capacity()!.tables} key={(table) => table.id}>
                  {(table) => (
                    <View
                      testID={`storage-table-${table().id}`}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        paddingVertical: 3,
                      }}
                    >
                      <Text style={{ flex: 1, fontSize: 11, color: token("foreground") }}>
                        {table().label}
                      </Text>
                      <Text
                        style={{
                          fontSize: 11,
                          fontVariant: ["tabular-nums"],
                          color: token("muted-foreground"),
                        }}
                      >
                        {`${formatBytes(table().bytes)} · ${table().share.toFixed(1)}%`}
                      </Text>
                    </View>
                  )}
                </Each>
              )}
              <Note text="删除会话会释放消息与照片；依据日志保留（ADR-0005），所以它会一直算在这里。" />
            </View>
          )}
        </Card>
      </View>
    </Scroll>
  );
}
