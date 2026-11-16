// 今日页。清单本身由 #13 的展开与 #14 的打卡接上；现在这一屏的职责是说清楚
// 「下一步做什么」：训练条件不齐就提示去补、齐了就送到首次评估、复查日到了就提示
// 重新排计划，而不是一片空白。
import { resource, Text, token, View } from "nsh";
import { Plans } from "lianlian/native";
import type { ProfileView } from "lianlian/native";

import { todayIso } from "../ui/dates";
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
  const plans = resource(() => Plans.load(todayIso()));

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader eyebrow={todayLabel()} title="练练" />
      <View style={{ flex: 1, padding: 16, gap: 12 }}>
        {props.state.error ? (
          <Card testID="today-error">
            <Note tone="error" text={props.state.error} />
          </Card>
        ) : null}

        {plans()?.active?.reviewDue ? (
          <Card testID="today-review-due">
            <Text style={{ fontSize: 13, fontWeight: "bold", color: token("accent") }}>
              复查日到了
            </Text>
            <Note text="这份计划已经到期：跟 agent 说一声，让它按现在的档案重新排一版再练。" />
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
