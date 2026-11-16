// 测量页：身高/体重的折线图 + 单条记录的删除。
//
// 测量是全库唯一允许单条删除的数据（ADR-0003 的例外），所以「删」只在这一屏。
// 图表只认 design/contract.md §4：`Plot` 的 `Line` + `Dot`，不在实现里手画路径。
import { resource, signal, Text, token, View } from "nsh";
import { Plot, Dot, Grid, Line, PlotAxis } from "nsh/base/plot";
import { BackHandler, isAvailable } from "nsh/mobile";
import { Measurements } from "lianlian/native";
import type { SeriesView } from "lianlian/native";

import { fullDate, shortDate } from "../ui/dates";
import { Card, Chip, ChipRow, Note, NumberField, PrimaryButton, ScreenHeader, SectionLabel, TextButton } from "../ui/parts";

/** 一位或两位小数：体重 74.2，身高 168。 */
function numberText(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/** 差值带符号：`-1.4` / `+0.6`。 */
function changeText(change: number, unit: string): string {
  const sign = change > 0 ? "+" : "";
  return `${sign}${numberText(change)} ${unit}`;
}

/** 折线图：按时间升序画点；只有一个点时靠 `Dot` 让那一个点看得见。 */
function Chart(props: { series: SeriesView }) {
  // 同一条纪律：序列在 JSX 里读（`props.series.points`），不在函数体里定格。
  return (
    <View
      testID={props.series.kind === "weight" ? "weight-chart" : "height-chart"}
      style={{ gap: 6 }}
    >
      <View style={{ height: 150 }}>
        <Plot data={props.series.points} y="value" style={{ flex: 1 }}>
          <Grid ticks={3} style={{ stroke: token("border"), strokeWidth: 1 }} />
          <Line
            y="value"
            curve="linear"
            style={{ stroke: token("primary"), strokeWidth: 2 }}
            dot
            dotStyle={{
              width: 5,
              height: 5,
              borderRadius: 999,
              backgroundColor: token("primary"),
            }}
          />
          <Dot style={{ fill: token("primary") }} r={4} />
          <PlotAxis
            placement="bottom"
            ticks={Math.min(props.series.points.length, 5)}
            format={(index: number) =>
              shortDate(props.series.points[Math.round(index)]?.at ?? 0)
            }
            labelStyle={{ fontSize: 10, color: token("muted-foreground") }}
          />
        </Plot>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
          {shortDate(props.series.points[0].at)}
        </Text>
        <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
          {shortDate(props.series.points[props.series.points.length - 1].at)}
        </Text>
      </View>
    </View>
  );
}

/** 一种测量的整块：当前值、趋势、图、记录清单。 */
function SeriesSection(props: {
  series: SeriesView;
  onDelete: (id: number) => void;
  pending: number | null;
  setPending: (id: number | null) => void;
}) {
  // 注意：props 的读取都写在 JSX 里。NSH 只跟踪渲染期间读到的信号，先
  // `const points = props.series.points` 会把序列定格在挂载那一刻。
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6 }}>
        <Text
          testID={`measurement-current-${props.series.kind}`}
          style={{
            fontSize: 26,
            fontWeight: "bold",
            fontVariant: ["tabular-nums"],
            color: token("foreground"),
          }}
        >
          {props.series.current === null || props.series.current === undefined
            ? "—"
            : numberText(props.series.current)}
        </Text>
        <Text style={{ fontSize: 11, color: token("muted-foreground"), paddingBottom: 4 }}>
          {props.series.unit}
        </Text>
        {props.series.change === null || props.series.change === undefined ? null : (
          <Text
            style={{
              fontSize: 11,
              color: props.series.change > 0 ? token("destructive") : token("primary"),
              paddingBottom: 4,
            }}
          >
            {changeText(props.series.change, props.series.unit)}
          </Text>
        )}
      </View>

      {props.series.points.length === 0 ? (
        <Note
          testID={`measurement-empty-${props.series.kind}`}
          text={`还没有${props.series.label}记录。记一次就能开始看趋势；只记一次也能读，但看不出变化。`}
        />
      ) : (
        <Chart series={props.series} />
      )}

      <View style={{ gap: 6 }}>
        <SectionLabel text={`记录 · ${props.series.points.length} 条`} />
        {[...props.series.points].reverse().map((point) => (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: token("muted"),
              borderRadius: token("radius"),
              paddingHorizontal: 12,
              paddingVertical: 9,
            }}
          >
            <Text
              style={{
                flex: 1,
                fontSize: 12,
                fontVariant: ["tabular-nums"],
                color: token("foreground"),
              }}
            >
              {numberText(point.value)} {props.series.unit}
            </Text>
            <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
              {fullDate(point.at)}
            </Text>
            {props.pending === point.id ? (
              <View style={{ flexDirection: "row", gap: 10 }}>
                <TextButton
                  testID={`delete-measurement-cancel-${point.id}`}
                  label="取消"
                  onPress={() => props.setPending(null)}
                />
                <TextButton
                  testID={`delete-measurement-confirm-${point.id}`}
                  label="确认删除"
                  onPress={() => {
                    props.setPending(null);
                    props.onDelete(point.id);
                  }}
                />
              </View>
            ) : (
              <TextButton
                testID={`delete-measurement-${point.id}`}
                label="删除"
                onPress={() => props.setPending(point.id)}
              />
            )}
          </View>
        ))}
      </View>
      <Note text="测量是唯一允许单条删除的数据；删除后折线图立即重画，档案里 agent 的判定只能追加更正。" />
    </Card>
  );
}

export function MeasurementsScreen(props: { onBack: () => void }) {
  const data = resource(() => Measurements.load());
  const kind = signal<"weight" | "height">("weight");
  const value = signal("");
  const message = signal<string | null>(null);
  const pending = signal<number | null>(null);

  // 删除确认是瞬态层：返回键先取消它，再轮到页面栈。
  if (isAvailable) {
    BackHandler.on("press", () => {
      if (pending() !== null) {
        pending.set(null);
        return true;
      }
      return false;
    });
  }

  const record = async () => {
    message.set(null);
    const parsed = Number(value().trim());
    if (value().trim() === "" || !Number.isFinite(parsed)) {
      message.set("先填一个数字再记。");
      return;
    }
    const error = await Measurements.record(kind(), parsed);
    if (error) {
      message.set(error);
      return;
    }
    value.set("");
    data.refetch();
  };

  const remove = async (id: number) => {
    message.set(null);
    const error = await Measurements.delete(id);
    if (error) {
      message.set(error);
      return;
    }
    data.refetch();
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <TextButton testID="back" label="← 回档案" onPress={props.onBack} />
      </View>
      <ScreenHeader
        eyebrow="测量"
        title="身高与体重"
        note="每次记录都留一条带时间的值，不覆盖旧的。"
      />

      {data() === undefined ? (
        <View style={{ padding: 16 }}>
          <Note text="正在读测量…" />
        </View>
      ) : (
        <View style={{ padding: 16, gap: 12 }}>
          {data()!.error ? (
            <Card testID="measurements-error">
              <Note tone="error" text={data()!.error ?? ""} />
            </Card>
          ) : null}
          {message() ? (
            <Card testID="measurements-message">
              <Note tone="error" text={message()!} />
            </Card>
          ) : null}

          <Card>
            <SectionLabel text="记一次" />
            <ChipRow>
              <Chip
                testID="measurement-kind-weight"
                label="体重"
                active={kind() === "weight"}
                onPress={() => kind.set("weight")}
              />
              <Chip
                testID="measurement-kind-height"
                label="身高"
                active={kind() === "height"}
                onPress={() => kind.set("height")}
              />
            </ChipRow>
            <NumberField
              testID="measurement-value"
              label={kind() === "weight" ? "体重 kg" : "身高 cm"}
              value={value()}
              onChange={(next) => value.set(next)}
              placeholder="例如 62.4"
            />
            <PrimaryButton testID="add-measurement" label="记一次" onPress={record} />
          </Card>

          {kind() === "weight" ? (
            <SeriesSection
              series={data()!.weight}
              onDelete={remove}
              pending={pending()}
              setPending={(id) => pending.set(id)}
            />
          ) : (
            <SeriesSection
              series={data()!.height}
              onDelete={remove}
              pending={pending()}
              setPending={(id) => pending.set(id)}
            />
          )}
        </View>
      )}
    </View>
  );
}
