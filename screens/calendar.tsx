// 月历（#16）：五种格子用形状 + 颜色双编码；点任意一天进入只读日详情。
//
// 格子状态由 Rust 侧的 `Days.range` 算好（`domain::day::calendar_cell`），这一屏
// 只负责铺 35/42 格、加今天标记、把点击送进日详情。日详情本身不编辑历史动作：
// 漏掉的那一天另开「补勾」入口，改期则在今日页。
import { resource, signal, Text, token, View } from "nsh";
import { Sheet } from "nsh/base";
import { Days, Today } from "lianlian/native";
import type { CalendarCellView, DayView } from "lianlian/native";

import { todayIso } from "../ui/dates";
import { Card, Note, PrimaryButton, ScreenHeader, SectionLabel, TextButton } from "../ui/parts";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

/** `2026-11-16` → 「11月16日」。 */
function dayLabel(iso: string): string {
  const [, month, day] = iso.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

/** 本地年月日 → `YYYY-MM-DD`。 */
function isoOf(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** 月历格子的形状 + 颜色（contract §6.3）。 */
function CellMark(props: { status: string }) {
  if (props.status === "completed") {
    return (
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 9999,
          backgroundColor: token("primary"),
        }}
      />
    );
  }
  if (props.status === "planned") {
    return (
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 9999,
          borderWidth: 1,
          borderColor: token("muted-foreground"),
        }}
      />
    );
  }
  if (props.status === "postponed") {
    return (
      <Text style={{ fontSize: 8, lineHeight: 9, color: token("accent") }}>推迟</Text>
    );
  }
  if (props.status === "missed") {
    return (
      <Text style={{ fontSize: 10, lineHeight: 10, color: token("border") }}>×</Text>
    );
  }
  return null;
}

/** 图例：与格子里的形状一一对应。 */
function Legend() {
  const rows = [
    { status: "completed", label: "已完成" },
    { status: "planned", label: "计划中" },
    { status: "postponed", label: "已推迟" },
    { status: "missed", label: "未完成" },
    { status: "rest", label: "休息日（无标记）" },
  ];
  return (
    <Card testID="calendar-legend">
      <SectionLabel text="图例" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
        <Each of={rows} key={(row) => row.status}>
          {(row) => (
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 5, minWidth: 72 }}
            >
              <View style={{ width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
                <CellMark status={row().status} />
              </View>
              <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
                {row().label}
              </Text>
            </View>
          )}
        </Each>
      </View>
    </Card>
  );
}

/** 日详情：只读回看动作快照与勾选；漏掉的那天另有「补勾」入口。 */
function DayDetail(props: {
  cell: CalendarCellView;
  onBack: () => void;
}) {
  const today = todayIso();
  const data = resource(() => Days.day(today, props.cell.date));
  const makingUp = signal(false);
  const busy = signal(false);
  const message = signal<string | null>(null);
  const detail = () => data() as DayView | null | undefined;

  const pending = () =>
    detail()?.exercises.filter((exercise) => !exercise.done && !exercise.skipped) ?? [];

  const makeUp = async (index: number) => {
    busy.set(true);
    message.set(null);
    const result = await Today.toggle(props.cell.date, index);
    busy.set(false);
    if (result.error) {
      message.set(result.error);
      return;
    }
    data.refetch();
    if (result.day?.state === "completed") {
      makingUp.set(false);
    }
  };

  return (
    <View style={{ flex: 1 }} testID="day-detail">
      <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 6 }}>
        <TextButton testID="back" label="← 返回月历" onPress={props.onBack} />
        <Text style={{ fontSize: 11, color: token("muted-foreground") }}>
          {props.cell.date}
        </Text>
        <Text style={{ fontSize: 20, fontWeight: "bold", color: token("foreground") }}>
          {dayLabel(props.cell.date)}
        </Text>
      </View>

      <View style={{ flex: 1, padding: 16, gap: 12 }}>
        {props.cell.status === "postponed" && !detail() ? (
          <Card testID="day-detail-postponed">
            <Text style={{ fontSize: 13, fontWeight: "bold", color: token("accent") }}>
              这一天推迟了
            </Text>
            <Note
              text={
                props.cell.movedTo
                  ? `整天的动作快照已经挪到 ${dayLabel(props.cell.movedTo)}；这一天回到休息日。`
                  : "整天的动作快照已经挪到另一天；这一天回到休息日。"
              }
            />
          </Card>
        ) : null}

        {detail() === undefined ? (
          <Card>
            <Note text="正在读这一天的安排…" />
          </Card>
        ) : detail() === null ? (
          props.cell.status === "postponed" ? null : (
            <Card testID="day-detail-rest">
              <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
                这天没有安排
              </Text>
              <Note text="休息日也算训练的一部分；要改计划或补训练，去今日页或跟 agent 说。" />
            </Card>
          )
        ) : (
          <View style={{ gap: 10 }}>
            <Card testID="day-detail-state">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
                  {detail()!.stateZh}
                </Text>
                <View style={{ flex: 1 }} />
                <Text
                  style={{
                    fontSize: 11,
                    fontVariant: ["tabular-nums"],
                    color: token("muted-foreground"),
                  }}
                >
                  {`${detail()!.done + detail()!.skipped}/${detail()!.total} 项`}
                </Text>
              </View>
              {detail()!.postponedFrom ? (
                <Note
                  tone="accent"
                  text={`从 ${dayLabel(detail()!.postponedFrom ?? "")} 推迟过来。`}
                />
              ) : null}
              {detail()!.skipped > 0 ? (
                <Note tone="accent" text={`其中 ${detail()!.skipped} 项已跳过。`} />
              ) : null}
            </Card>

            <SectionLabel text="当天动作快照 · 只读" />
            <Each
              of={detail()!.exercises}
              key={(exercise) => String(exercise.index)}
            >
              {(exercise) => (
                <View
                  testID={`day-detail-exercise-${exercise().index}`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    backgroundColor: token("card"),
                    borderRadius: token("radius"),
                    padding: 12,
                  }}
                >
                  <Text
                    style={{
                      width: 20,
                      fontSize: 12,
                      color: exercise().done
                        ? token("primary")
                        : exercise().skipped
                          ? token("muted-foreground")
                          : token("border"),
                    }}
                  >
                    {exercise().done ? "✓" : exercise().skipped ? "–" : "○"}
                  </Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      style={{
                        fontSize: 13,
                        color:
                          exercise().done || exercise().skipped
                            ? token("muted-foreground")
                            : token("foreground"),
                        textDecorationLine: exercise().done ? "line-through" : "none",
                      }}
                    >
                      {`${exercise().name} · ${exercise().prescription}`}
                    </Text>
                    <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
                      {exercise().skipped
                        ? "已跳过"
                        : `来自「${exercise().siteZh}${exercise().sideZh ?? ""}」的判定`}
                    </Text>
                  </View>
                </View>
              )}
            </Each>

            {detail()!.state === "missed" && pending().length > 0 ? (
              <View style={{ gap: 8 }}>
                <Note text="这一天已经过了，但还没结账；可以补勾，补完转为已完成。" />
                <PrimaryButton
                  testID="make-up"
                  label="补勾这一天"
                  onPress={() => {
                    message.set(null);
                    makingUp.set(true);
                  }}
                />
              </View>
            ) : null}

            {message() ? <Note tone="error" testID="day-detail-error" text={message() ?? ""} /> : null}
          </View>
        )}
      </View>

      <Sheet
        open={makingUp()}
        onOpenChange={(event) => {
          if (!event.open) {
            makingUp.set(false);
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
          补勾 {dayLabel(props.cell.date)}
        </Text>
        <Note text="只补勾，不改当时的动作快照；全部补完就转回已完成。" />
        <Each of={pending()} key={(exercise) => String(exercise.index)}>
          {(exercise) => (
            <PrimaryButton
              testID={`makeup-exercise-${exercise().index}`}
              label={`补勾「${exercise().name}」`}
              disabled={busy()}
              onPress={() => makeUp(exercise().index)}
            />
          )}
        </Each>
        {message() ? <Note tone="error" text={message() ?? ""} /> : null}
        <TextButton testID="makeup-cancel" label="取消" onPress={() => makingUp.set(false)} />
      </Sheet>
    </View>
  );
}

/** 月历：默认显示本月，前后翻月；格子来自 `Days.range`。 */
export function CalendarScreen() {
  const now = new Date();
  const cursor = signal({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const selected = signal<CalendarCellView | null>(null);
  const today = todayIso();

  const daysInMonth = () => {
    const { year, month } = cursor();
    return new Date(year, month, 0).getDate();
  };
  const leading = () => {
    const { year, month } = cursor();
    return (new Date(year, month - 1, 1).getDay() + 6) % 7;
  };
  const totalCells = () => Math.ceil((leading() + daysInMonth()) / 7) * 7;
  const from = () => isoOf(cursor().year, cursor().month, 1);
  const to = () => isoOf(cursor().year, cursor().month, daysInMonth());
  const data = resource(() => Days.range(today, from(), to()));

  const cellsByDate = () => {
    const map = new Map<string, CalendarCellView>();
    for (const cell of data()?.cells ?? []) {
      map.set(cell.date, cell);
    }
    return map;
  };

  const grid = () =>
    Array.from({ length: totalCells() }, (_, index) => {
      const day = index - leading() + 1;
      if (day < 1 || day > daysInMonth()) {
        return { key: `blank-${index}`, day: 0, cell: null as CalendarCellView | null };
      }
      const iso = isoOf(cursor().year, cursor().month, day);
      return {
        key: iso,
        day,
        cell: cellsByDate().get(iso) ?? null,
      };
    });

  const counts = () => {
    const result = { completed: 0, planned: 0, postponed: 0, missed: 0 };
    for (const cell of data()?.cells ?? []) {
      if (cell.status in result) {
        result[cell.status as keyof typeof result] += 1;
      }
    }
    return result;
  };

  const shift = (delta: number) => {
    const current = cursor();
    const month = current.month + delta;
    if (month < 1) {
      cursor.set({ year: current.year - 1, month: 12 });
    } else if (month > 12) {
      cursor.set({ year: current.year + 1, month: 1 });
    } else {
      cursor.set({ year: current.year, month });
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader eyebrow="月历" title={`${cursor().year}年${cursor().month}月`} />
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingTop: 6,
        }}
      >
        <TextButton testID="prev-month" label="‹ 上个月" onPress={() => shift(-1)} />
        <TextButton testID="next-month" label="下个月 ›" onPress={() => shift(1)} />
      </View>

      {data() === undefined ? (
        <Card testID="calendar-loading">
          <Note text="正在读这个月的安排…" />
        </Card>
      ) : data()!.error ? (
        <Card testID="calendar-error">
          <Note tone="error" text={data()!.error ?? ""} />
        </Card>
      ) : (
        <View style={{ flex: 1, padding: 16, gap: 12 }}>
          <Note
            text={`本月已打卡 ${counts().completed} 天 · 计划 ${counts().planned} 天 · 推迟 ${counts().postponed} 天 · 未完成 ${counts().missed} 天`}
          />
          <View style={{ flexDirection: "row" }}>
            <Each of={WEEKDAYS} key={(weekday) => weekday}>
              {(weekday) => (
                <View style={{ flex: 1, alignItems: "center" }}>
                  <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
                    {weekday()}
                  </Text>
                </View>
              )}
            </Each>
          </View>
          <Each of={Array.from({ length: totalCells() / 7 }, (_, row) => row)} key={(row) => String(row)}>
            {(row) => (
              <View style={{ flexDirection: "row" }}>
                <Each
                  of={grid().slice(row() * 7, row() * 7 + 7)}
                  key={(item) => item.key}
                >
                  {(item) => (
                    <View
                      testID={item().day > 0 ? `day-${item().day}` : undefined}
                      role={item().cell ? "button" : undefined}
                      accessibilityLabel={
                        item().day > 0
                          ? `${cursor().month}月${item().day}日 ${item().cell?.statusZh ?? "读取中"}${
                              item().cell?.isToday ? "，今天" : ""
                            }`
                          : undefined
                      }
                      onPress={item().cell ? () => selected.set(item().cell) : undefined}
                      style={{
                        flex: 1,
                        height: 44,
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 2,
                        borderRadius: 10,
                        borderWidth: item().cell?.isToday ? 1 : 0,
                        borderColor: token("primary"),
                      }}
                    >
                      {item().day > 0 ? (
                        <Text
                          style={{
                            fontSize: 13,
                            fontVariant: ["tabular-nums"],
                            color: item().cell?.isToday
                              ? token("primary")
                              : item().cell?.status === "rest"
                                ? token("muted-foreground")
                                : token("foreground"),
                          }}
                        >
                          {String(item().day)}
                        </Text>
                      ) : null}
                      {item().cell ? <CellMark status={item().cell!.status} /> : null}
                    </View>
                  )}
                </Each>
              </View>
            )}
          </Each>
          <Legend />
        </View>
      )}

      {selected() ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            backgroundColor: token("background"),
          }}
        >
          <DayDetail
            cell={selected()!}
            onBack={() => {
              selected.set(null);
              data.refetch();
            }}
          />
        </View>
      ) : null}
    </View>
  );
}
