// 档案页：档案条目（判定与依据，见 findings.tsx）在前，基本属性与训练条件在后。
// 四个字段都可以留空；留空时页面明说「未填」，不拿 0 冒充。
import { resource, Scroll, signal, Text, token, View } from "nsh";
import { Profile, Storage } from "lianlian/native";
import type { ProfileView } from "lianlian/native";

import type { ProfileDrafts } from "../ui/drafts";
import { BasicsFields, TrainingFields, basicsPayload, trainingPayload } from "../ui/forms";
import { FindingsSection } from "./findings";
import { Card, Note, PrimaryButton, ScreenHeader, SectionLabel, TextButton } from "../ui/parts";

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

export function ProfileScreen(props: {
  state: ProfileView;
  drafts: ProfileDrafts;
  onSaved: () => void;
  onGoMeasurements: () => void;
  onGoSettings: () => void;
  onGoConversations: () => void;
}) {
  const basics = props.drafts.basics;
  const training = props.drafts.training;
  const error = signal<string | null>(null);
  const saved = signal<string | null>(null);
  const capacity = resource(() => Storage.load());

  const saveBasics = async () => {
    error.set(null);
    saved.set(null);
    const payload = basicsPayload(basics, false);
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
    props.onSaved();
  };

  const saveTraining = async () => {
    error.set(null);
    saved.set(null);
    const payload = trainingPayload(training);
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
    props.onSaved();
  };

  const readiness = props.state.readiness;

  return (
    <Scroll testID="profile-scroll" style={{ flex: 1 }} contentStyle={{ paddingBottom: 24 }}>
      <ScreenHeader
        eyebrow="档案"
        title="身体档案"
        note="上面是身体上的判定与依据（可展开、可更正），下面是你自己填的数字。"
      />

      <View style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          <TextButton testID="open-settings" label="设置与 key" onPress={props.onGoSettings} />
        </View>
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

        <FindingsSection onGoConversations={props.onGoConversations} />

        <Card>
          <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
            基本属性
          </Text>
          <BasicsFields draft={basics} />
          <PrimaryButton testID="save-basics" label="保存基本属性" onPress={saveBasics} />
        </Card>

        <Card testID="profile-measurements">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
              测量
            </Text>
            <SectionLabel
              testID="profile-body-metrics"
              text={`当前 ${props.state.basics.heightCm ?? "—"} cm · ${props.state.basics.weightKg ?? "—"} kg`}
            />
          </View>
          <Note text="每次记录都留一条带时间的值，折线图看变动；单条填错的可以删掉。" />
          <PrimaryButton
            testID="open-measurements"
            label="查看身高体重趋势"
            onPress={props.onGoMeasurements}
          />
        </Card>

        <Card testID="profile-training">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
              训练条件
            </Text>
            <SectionLabel text={readiness.ready ? "齐全" : "不齐全"} />
          </View>
          {readiness.ready ? (
            <Note text="四项都填了，agent 可以据此排计划。" />
          ) : (
            <Note
              testID="profile-training-missing"
              text={`还差：${readiness.missingZh.join("、")}。缺项时不排计划。`}
            />
          )}
          <TrainingFields draft={training} />
          <PrimaryButton testID="save-training" label="保存训练条件" onPress={saveTraining} />
        </Card>

        <Card testID="storage-capacity">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
              本地数据
            </Text>
            <View style={{ flex: 1 }} />
            <SectionLabel text="只在本机" />
          </View>
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
