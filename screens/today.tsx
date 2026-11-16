// 今日页（#14）：打开就是今天的动作清单，逐项勾选，全部勾完就是打卡。
//
// 三件事在这屏上分工明确：Rust 侧的 `Today.load` 决定「今天有没有训练、有哪几个动作、
// 勾到哪了」，日状态机在 `domain::day`（全部勾完 = 已完成，取消勾选回到计划中）；
// 这一屏只负责把它摆出来、把点击送回去。
import { Canvas, resource, signal, Text, token, View } from "nsh";
import { Sheet } from "nsh/base";
import { Today as TodayApi } from "lianlian/native";
import type { DayView, TodayView } from "lianlian/native";

import { todayIso } from "../ui/dates";
import { UpdateBanner, showsUpdate } from "../ui/updates";
import type { UpdateCheck } from "../ui/updates";
import {
  Card,
  Note,
  PrimaryButton,
  ScreenHeader,
  SectionLabel,
  TextButton,
  TextField,
} from "../ui/parts";

/** 「11月15日 周日」 */
function todayLabel(): string {
  const now = new Date();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]}`;
}

/** `YYYY-MM-DD` → 「11月18日」。 */
function dayLabel(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

/** 完成度环（契约 §6.1）：96×96、r=40、线宽 8、12 点起步顺时针，数字叠在中间。 */
function ProgressRing(props: { resolved: number; total: number }) {
  const percent =
    props.total === 0 ? 0 : Math.round((props.resolved / props.total) * 100);
  return (
    <View
      testID="today-ring"
      accessibilityLabel={`今日已处理 ${percent}%，${props.resolved}/${props.total} 项`}
      style={{ width: 96, height: 96, alignItems: "center", justifyContent: "center" }}
    >
      <Canvas
        style={{ position: "absolute", width: 96, height: 96 }}
        draw={(cx, size) => {
          const center = size.width / 2;
          cx.lineWidth = 8;
          cx.lineCap = "round";
          cx.strokeStyle = token("muted");
          cx.beginPath();
          cx.arc(center, center, 40, 0, Math.PI * 2);
          cx.stroke();
          if (percent > 0) {
            cx.strokeStyle = token("primary");
            cx.beginPath();
            cx.arc(
              center,
              center,
              40,
              -Math.PI / 2,
              -Math.PI / 2 + (Math.PI * 2 * percent) / 100,
            );
            cx.stroke();
          }
        }}
      />
      <Text
        accessibilityElementsHidden
        style={{
          fontSize: 18,
          fontWeight: "bold",
          fontVariant: ["tabular-nums"],
          color: token("foreground"),
        }}
      >
        {`${percent}%`}
      </Text>
    </View>
  );
}

/** 勾选框：自绘圆形（实心 = 完成，横杠 = 跳过），命中区 44。 */
function CheckBox(props: {
  done: boolean;
  skipped: boolean;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <View
      testID={props.testID}
      role="checkbox"
      accessibilityLabel={props.label}
      accessibilityState={{ checked: props.done }}
      onPress={props.onPress}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderRadius: 9999,
          backgroundColor: props.done
            ? token("primary")
            : props.skipped
              ? token("muted")
              : "transparent",
          borderWidth: props.done || props.skipped ? 0 : 1,
          borderColor: token("muted-foreground"),
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {props.done ? (
          <Text style={{ fontSize: 12, color: token("primary-foreground") }}>✓</Text>
        ) : props.skipped ? (
          <Text style={{ fontSize: 12, color: token("muted-foreground") }}>–</Text>
        ) : null}
      </View>
    </View>
  );
}

/** 一个动作：名字、处方、它来自哪条判定，右侧一个勾选框。 */
function ExerciseRow(props: {
  day: DayView;
  index: number;
  onToggle: (index: number) => void;
}) {
  const exercise = props.day.exercises[props.index];
  // 契约 §7 的写法：`exercise-{site}-{n}`，同一天里同名部位的动作靠 n 区分。
  const exerciseId = `${exercise.site}-${props.index}`;
  const label = `${exercise.name} ${exercise.prescription}，${exercise.siteZh}${exercise.sideZh ?? ""}`;
  const resolved = exercise.done || exercise.skipped;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: token("card"),
        borderRadius: token("radius"),
        paddingLeft: 14,
        paddingRight: 4,
        paddingVertical: 6,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text
          style={{
            fontSize: 13,
            color: resolved ? token("muted-foreground") : token("foreground"),
            textDecorationLine: exercise.done ? "line-through" : "none",
          }}
        >
          {`${exercise.name} · ${exercise.prescription}`}
        </Text>
        <Text
          style={{
            fontSize: 10,
            color: exercise.skipped ? token("accent") : token("muted-foreground"),
          }}
        >
          {exercise.skipped
            ? "已跳过 · 不挡打卡，再点一次可以补勾"
            : `来自「${exercise.siteZh}${exercise.sideZh ?? ""}」的判定`}
        </Text>
      </View>
      <CheckBox
        testID={`exercise-${exerciseId}`}
        done={exercise.done}
        skipped={exercise.skipped}
        label={label}
        onPress={() => props.onToggle(props.index)}
      />
    </View>
  );
}

/** 今天有训练：环 + 进度 + 清单 + 打卡反馈。 */
function TodayDay(props: {
  day: DayView;
  onToggle: (index: number) => void;
  onPostpone: () => void;
  onSkip: () => void;
  busy: boolean;
}) {
  const total = props.day.total;
  const checkedIn = props.day.state === "completed";
  const resolved = props.day.done + props.day.skipped;
  const skipped = props.day.skipped;
  return (
    <View style={{ gap: 12 }}>
      <Card testID="today-progress">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <ProgressRing resolved={resolved} total={total} />
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ fontSize: 15, fontWeight: "bold", color: token("foreground") }}>
                {`${resolved}/${total} 项`}
              </Text>
              <Text
                testID="today-state-label"
                style={{
                  fontSize: 10,
                  color: checkedIn ? token("primary") : token("muted-foreground"),
                }}
              >
                {props.day.stateZh}
              </Text>
            </View>
            {skipped > 0 ? (
              <Text style={{ fontSize: 10, color: token("accent") }}>
                {`其中 ${skipped} 项已跳过`}
              </Text>
            ) : null}
            <Note
              testID="today-state"
              tone={checkedIn ? "accent" : "muted"}
              text={
                checkedIn
                  ? "今天已经打卡。"
                  : resolved === 0
                    ? "还没开始。做一项勾一项，练到一半接个电话回来还能接着勾。"
                    : `还差 ${total - resolved} 项，勾完或跳过就是今天的打卡。`
              }
            />
          </View>
        </View>
      </Card>

      <SectionLabel testID="today-exercises" text="今天的动作" />
      <Each
        of={Array.from({ length: total }, (_, index) => index)}
        key={(index) => index}
      >
        {(index) => (
          <ExerciseRow day={props.day} index={index()} onToggle={props.onToggle} />
        )}
      </Each>

      {checkedIn ? (
        <Card testID="checkin">
          <Text style={{ fontSize: 15, fontWeight: "bold", color: token("primary") }}>
            今天这笔账结清了
          </Text>
          <Note text={`${total} 个动作都处理完了，日状态落为「已完成」。`} />
        </Card>
      ) : null}

      {checkedIn ? null : (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            gap: 24,
            paddingVertical: 4,
          }}
        >
          <TextButton testID="postpone" label="整天推迟" onPress={props.onPostpone} />
          <TextButton testID="skip-exercise" label="跳过一项" onPress={props.onSkip} />
        </View>
      )}

      {props.busy ? <Note testID="today-busy" text="正在记下…" /> : null}
    </View>
  );
}

/** 没有计划 / 今天休息：说清楚下一步，而不是一片空白。 */
function Guidance(props: {
  view: TodayView;
  onGoProfile: () => void;
  onGoConversations: () => void;
}) {
  const readiness = props.view.readiness;
  const restDay = props.view.plan !== null;
  return (
    <View style={{ gap: 12 }}>
      {restDay ? (
        <Card testID="today-rest">
          <Text
            testID="today-rest-title"
            style={{ fontSize: 15, fontWeight: "bold", color: token("foreground") }}
          >
            今天休息
          </Text>
          <Note
            text={
              props.view.nextDate
                ? `下一次训练是 ${dayLabel(props.view.nextDate)}。休息日也算训练的一部分。`
                : "下一次训练还没排出来；计划改动之后会重新展开。"
            }
          />
        </Card>
      ) : readiness.ready ? (
        <Card testID="today-ready">
          <Text
            testID="today-ready-title"
            style={{ fontSize: 15, fontWeight: "bold", color: token("foreground") }}
          >
            {props.view.findings === 0 ? "可以开始首次评估" : "还没有计划"}
          </Text>
          <Note
            text={
              props.view.findings === 0
                ? "训练条件齐了，档案还是空的。跟 agent 聊一次：它给你 2–3 个在家能做的验证动作，你做完把感受告诉它，它才会在档案上落判定，然后按档案排计划。"
                : `档案里已经有 ${props.view.findings} 处判定。跟 agent 说一声，它按这些判定与训练条件排一份计划；排好之后这一屏就是今天的清单。`
            }
          />
          <PrimaryButton
            testID="today-start-assessment"
            label={props.view.findings === 0 ? "去对话做首次评估" : "去对话排计划"}
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
    </View>
  );
}

export function Today(props: {
  onGoProfile: () => void;
  onGoConversations: () => void;
  update?: UpdateCheck | null;
  onDismissUpdate: (version: string) => void;
  onOpenUpdate: (url: string) => void;
}) {
  const data = resource(() => TodayApi.load(todayIso()));
  const busy = signal(false);
  const postponing = signal(false);
  const skipping = signal(false);
  const target = signal("");
  const sheetError = signal<string | null>(null);

  const toggle = async (index: number) => {
    busy.set(true);
    await TodayApi.toggle(todayIso(), index);
    busy.set(false);
    data.refetch();
  };

  const openPostpone = () => {
    sheetError.set(null);
    target.set(data()?.postponeTo ?? "");
    postponing.set(true);
  };

  const confirmPostpone = async () => {
    busy.set(true);
    sheetError.set(null);
    const result = await TodayApi.postpone(todayIso(), target());
    busy.set(false);
    if (result.error) {
      sheetError.set(result.error);
      return;
    }
    postponing.set(false);
    data.refetch();
  };

  const skip = async (index: number) => {
    busy.set(true);
    sheetError.set(null);
    const result = await TodayApi.skip(todayIso(), index);
    busy.set(false);
    if (result.error) {
      sheetError.set(result.error);
      return;
    }
    skipping.set(false);
    data.refetch();
  };

  const pending = () =>
    data()?.day
      ? data()!.day!.exercises.filter((exercise) => !exercise.done && !exercise.skipped)
      : [];

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader eyebrow={todayLabel()} title="练练" />
      <View style={{ flex: 1, padding: 16, gap: 12 }}>
        {showsUpdate(props.update) ? (
          <UpdateBanner
            found={props.update!.found!}
            onOpen={props.onOpenUpdate}
            onDismiss={props.onDismissUpdate}
          />
        ) : null}
        {data() === undefined ? (
          <Card testID="today-loading">
            <Note text="正在读今天的安排…" />
          </Card>
        ) : (
          <View style={{ gap: 12 }}>
            {data()!.error ? (
              <Card testID="today-error">
                <Note tone="error" text={data()!.error ?? ""} />
              </Card>
            ) : null}

            {data()!.plan?.reviewDue ? (
              <Card testID="today-review-due">
                <Text style={{ fontSize: 13, fontWeight: "bold", color: token("accent") }}>
                  复查日到了
                </Text>
                <Note text="这份计划已经到期：跟 agent 说一声，让它按现在的档案重新排一版再练。" />
              </Card>
            ) : null}

            {data()!.day ? (
              <TodayDay
                day={data()!.day!}
                busy={busy()}
                onPostpone={openPostpone}
                onSkip={() => {
                  sheetError.set(null);
                  skipping.set(true);
                }}
                onToggle={(index) => {
                  if (!busy()) {
                    toggle(index);
                  }
                }}
              />
            ) : (
              <Guidance
                view={data()!}
                onGoProfile={props.onGoProfile}
                onGoConversations={props.onGoConversations}
              />
            )}
          </View>
        )}
      </View>

      <Sheet
        open={postponing()}
        onOpenChange={(event) => {
          if (!event.open) {
            postponing.set(false);
          }
        }}
        popupStyle={{
          backgroundColor: token("card"),
          borderTopLeftRadius: token("radius"),
          borderTopRightRadius: token("radius"),
          padding: 16,
          gap: 10,
        }}
        backdropStyle={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      >
        <Text style={{ fontSize: 15, fontWeight: "bold", color: token("foreground") }}>
          整天推迟
        </Text>
        <Note text="把今天这一整天顺延到另一个没有训练的日子；今天的动作快照会跟着过去，原来那天回到休息日。" />
        <SectionLabel text="目标日期（YYYY-MM-DD）" />
        <TextField
          testID="postpone-target"
          value={target()}
          placeholder="2026-11-17"
          onChange={(value) => target.set(value)}
        />
        {sheetError() ? (
          <Note testID="postpone-error" tone="error" text={sheetError() ?? ""} />
        ) : null}
        <View style={{ flexDirection: "row", gap: 12 }}>
          <PrimaryButton
            testID="postpone-cancel"
            label="取消"
            onPress={() => postponing.set(false)}
          />
          <PrimaryButton
            testID="postpone-confirm"
            label={busy() ? "正在推迟…" : "确认推迟"}
            disabled={busy()}
            onPress={confirmPostpone}
          />
        </View>
      </Sheet>

      <Sheet
        open={skipping()}
        onOpenChange={(event) => {
          if (!event.open) {
            skipping.set(false);
          }
        }}
        popupStyle={{
          backgroundColor: token("card"),
          borderTopLeftRadius: token("radius"),
          borderTopRightRadius: token("radius"),
          padding: 16,
          gap: 10,
        }}
        backdropStyle={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      >
        <Text style={{ fontSize: 15, fontWeight: "bold", color: token("foreground") }}>
          跳过一项
        </Text>
        <Note text="跳过的动作不挡整天打卡；之后想补，点那一项就能补回来。" />
        {pending().length === 0 ? (
          <Note text="今天没有还没处理的动作。" />
        ) : (
          <Each
            of={pending()}
            key={(exercise) => String(exercise.index)}
          >
            {(exercise) => (
              <PrimaryButton
                testID={`skip-option-${exercise().index}`}
                label={`跳过「${exercise().name}」`}
                onPress={() => skip(exercise().index)}
              />
            )}
          </Each>
        )}
        {sheetError() ? (
          <Note testID="skip-error" tone="error" text={sheetError() ?? ""} />
        ) : null}
        <TextButton testID="skip-cancel" label="取消" onPress={() => skipping.set(false)} />
      </Sheet>
    </View>
  );
}
