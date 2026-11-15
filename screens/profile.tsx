// 档案页的「基本属性 + 训练条件」部分（查找结果的部分是 #11）。
// 四个字段都可以留空；留空时页面明说「未填」，不拿 0 冒充。
import { Scroll, signal, Text, token, View } from "nsh";
import { Profile } from "lianlian/native";
import type { ProfileView } from "lianlian/native";

import type { ProfileDrafts } from "../ui/drafts";
import { BasicsFields, TrainingFields, basicsPayload, trainingPayload } from "../ui/forms";
import { Card, Note, PrimaryButton, ScreenHeader, SectionLabel } from "../ui/parts";

export function ProfileScreen(props: {
  state: ProfileView;
  drafts: ProfileDrafts;
  onSaved: () => void;
}) {
  const basics = props.drafts.basics;
  const training = props.drafts.training;
  const error = signal<string | null>(null);
  const saved = signal<string | null>(null);

  const saveBasics = async () => {
    error.set(null);
    saved.set(null);
    const payload = basicsPayload(basics);
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
    <Scroll style={{ flex: 1 }} contentStyle={{ paddingBottom: 24 }}>
      <ScreenHeader
        eyebrow="档案"
        title="关于你"
        note="这里只是你填的数字，不是判定。身体上的判定在档案条目里（#11）。"
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
          <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
            基本属性
          </Text>
          <BasicsFields draft={basics} />
          <PrimaryButton testID="save-basics" label="保存基本属性" onPress={saveBasics} />
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
      </View>
    </Scroll>
  );
}
