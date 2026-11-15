// 首启引导：三步填完基本属性与训练条件，然后进入「可以开始首次评估」。
// 每一步都真的落库（Rust 侧校验），失败就停在这一步把原因显示出来。
import { signal, Text, token, View } from "nsh";
import { Profile } from "lianlian/native";
import type { ProfileView } from "lianlian/native";

import type { ProfileDrafts } from "../ui/drafts";
import {
  BasicsFields,
  BodyMetricFields,
  TrainingFields,
  basicsPayload,
  trainingPayload,
} from "../ui/forms";
import { Card, Note, PrimaryButton, ScreenHeader, SectionLabel, TextButton } from "../ui/parts";

const STEP_TITLES = ["先认识你一下", "你平时怎么练", "接下来是第一次评估"];

export function Onboarding(props: {
  state: ProfileView;
  drafts: ProfileDrafts;
  onFinished: () => void;
}) {
  const step = signal(1);
  const basics = props.drafts.basics;
  const training = props.drafts.training;
  const error = signal<string | null>(null);
  const busy = signal(false);

  const advance = async () => {
    if (busy()) {
      return;
    }
    busy.set(true);
    error.set(null);
    const current = step();
    let message: string | null = null;
    if (current === 1) {
      const payload = basicsPayload(basics);
      message = await Profile.saveBasics(
        payload.sex,
        payload.age,
        payload.heightCm,
        payload.weightKg,
        payload.conditions,
      );
    } else if (current === 2) {
      const payload = trainingPayload(training);
      message = await Profile.saveTraining(
        payload.daysPerWeek,
        payload.minutesPerSession,
        payload.places,
        payload.equipment,
      );
    } else {
      message = await Profile.finishOnboarding();
    }
    busy.set(false);
    if (message) {
      error.set(message);
      return;
    }
    if (current === 3) {
      props.onFinished();
      return;
    }
    step.set(current + 1);
  };

  const back = () => {
    if (step() > 1 && !busy()) {
      error.set(null);
      step.set(step() - 1);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: token("background") }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 20, flexDirection: "row", gap: 6 }}>
        {[1, 2, 3].map((index) => (
          <View
            style={{
              height: 4,
              flex: 1,
              borderRadius: 999,
              backgroundColor:
                index <= step() ? token("primary") : token("muted"),
            }}
          />
        ))}
      </View>

      <ScreenHeader
        eyebrow={`第 ${step()} 步 / 3`}
        title={STEP_TITLES[step() - 1]}
        note="这些数字只存在你的手机里。不用填得很准，随时可以改。"
      />

      <View style={{ flex: 1, paddingHorizontal: 16, paddingTop: 16 }}>
        {step() === 1 ? (
          <View style={{ gap: 16 }}>
            <BasicsFields draft={basics} />
            <View style={{ gap: 6 }}>
              <SectionLabel text="身高与体重" />
              <Note text="每次填新值都会追加一条带时间的测量，不覆盖旧值；单条记录可在档案页的「测量」里删除。" />
              <BodyMetricFields draft={basics} />
            </View>
          </View>
        ) : null}
        {step() === 2 ? <TrainingFields draft={training} /> : null}
        {step() === 3 ? (
          <Card testID="onboarding-step-3">
            <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
              第一次评估大概这样
            </Text>
            <Note text="agent 会给你 2–3 个在家能做的验证动作，你照着做并告诉它感受。它不会凭一句话就下结论。" />
            <View style={{ gap: 6 }}>
              <SectionLabel text="接下来" />
              <Note text="1 · 说说你最想改善的问题" />
              <Note text="2 · 做完验证动作，反馈感受" />
              <Note text="3 · 它在档案上写下判定，你逐条接受或拒绝" />
            </View>
            <Note
              tone="accent"
              text="去「对话」里开一个会话就能开始；设置页可以填 DeepSeek 的 key（只存在这台设备上）。"
            />
          </Card>
        ) : null}
        {error() ? (
          <View style={{ marginTop: 12 }}>
            <Note testID="onboarding-error" tone="error" text={error() ?? ""} />
          </View>
        ) : null}
      </View>

      <View style={{ padding: 16, gap: 8 }}>
        <PrimaryButton
          testID="onboarding-next"
          label={step() === 3 ? "开始第一次评估" : "下一步"}
          disabled={busy()}
          onPress={advance}
        />
        {step() > 1 ? (
          <View style={{ alignItems: "center" }}>
            <TextButton testID="onboarding-prev" label="返回上一步" onPress={back} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
