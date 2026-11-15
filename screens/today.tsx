// 今日页。计划的清单要等 #12/#13；在那之前这一屏的职责是**说清楚下一步做什么**：
// 训练条件不齐就提示去补，齐了就送到首次评估，而不是一片空白。
import { Text, token, View } from "nsh";
import type { ProfileView } from "lianlian/native";

import { Card, Note, PrimaryButton, ScreenHeader } from "../ui/parts";

/** 「11月15日 周日」 */
function todayLabel(): string {
  const now = new Date();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]}`;
}

export function Today(props: {
  state: ProfileView;
  onGoProfile: () => void;
  onGoConversations: () => void;
}) {
  const readiness = props.state.readiness;

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader eyebrow={todayLabel()} title="练练" />
      <View style={{ flex: 1, padding: 16, gap: 12 }}>
        {props.state.error ? (
          <Card testID="today-error">
            <Note tone="error" text={props.state.error} />
          </Card>
        ) : null}

        {readiness.ready ? (
          <Card testID="today-ready">
            <Text
              testID="today-ready-title"
              style={{ fontSize: 15, fontWeight: "bold", color: token("foreground") }}
            >
              可以开始首次评估
            </Text>
            <Note text="训练条件齐了，档案还是空的。跟 agent 聊一次：它给你 2–3 个在家能做的验证动作，你做完把感受告诉它，它才在档案上落判定。" />
            <PrimaryButton
              testID="today-start-assessment"
              label="去对话"
              onPress={props.onGoConversations}
            />
          </Card>
        ) : (
          <Card testID="today-needs-training">
            <Text
              testID="today-needs-training-title"
              style={{ fontSize: 15, fontWeight: "bold", color: token("foreground") }}
            >
              计划前需要先补训练条件
            </Text>
            <Note text={`还差：${readiness.missingZh.join("、")}。补齐之后 agent 才会给你排计划。`} />
            <PrimaryButton
              testID="today-fill-training"
              label="去补训练条件"
              onPress={props.onGoProfile}
            />
          </Card>
        )}

        <Card>
          <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
            今天还没有安排
          </Text>
          <Note text="有生效计划之后，这里就是当天要做的动作清单；现在它还是空的（计划生成是 #12）。" />
        </Card>
      </View>
    </View>
  );
}
