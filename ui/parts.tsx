// 屏上的共用零件。样式只取 design/contract.md §2 的 token，不写死颜色。
import { Text, token, View } from "nsh";
import type { JSX } from "nsh";
import { Input } from "nsh/base";

/** 小标题：10px、字距拉开的灰字。 */
export function SectionLabel(props: { text: string }) {
  return (
    <Text
      style={{
        fontSize: 10,
        letterSpacing: 1.4,
        color: token("muted-foreground"),
      }}
    >
      {props.text}
    </Text>
  );
}

/** 卡片：`bg-card` + 20px 圆角。 */
export function Card(props: {
  children?: JSX.Element | (JSX.Element | null)[];
  testID?: string;
}) {
  return (
    <View
      testID={props.testID}
      style={{
        backgroundColor: token("card"),
        borderRadius: token("radius"),
        padding: 16,
        gap: 10,
      }}
    >
      {props.children}
    </View>
  );
}

/** 胶囊选项：单选与多选都用它。 */
export function Chip(props: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <View
      testID={props.testID}
      role="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={{
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 7,
        backgroundColor: props.active ? token("primary") : token("card"),
        borderWidth: props.active ? 0 : 1,
        borderColor: token("border"),
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: props.active ? "bold" : "normal",
          color: props.active
            ? token("primary-foreground")
            : token("muted-foreground"),
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

/** 一排可选胶囊。 */
export function ChipRow(props: {
  children?: JSX.Element | (JSX.Element | null)[];
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {props.children}
    </View>
  );
}

/** 主行动：整宽胶囊按钮。 */
export function PrimaryButton(props: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <View
      testID={props.testID}
      role="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        borderRadius: 999,
        paddingVertical: 14,
        alignItems: "center",
        backgroundColor: props.disabled ? token("muted") : token("primary"),
      }}
    >
      <Text
        style={{
          fontSize: 14,
          fontWeight: "bold",
          color: props.disabled
            ? token("muted-foreground")
            : token("primary-foreground"),
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

/** 次要行动：一行文字。 */
export function TextButton(props: {
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <View
      testID={props.testID}
      role="button"
      accessibilityLabel={props.label}
      onPress={props.onPress}
    >
      <Text style={{ fontSize: 11, color: token("accent") }}>{props.label}</Text>
    </View>
  );
}

/** 数字输入：空串就是「未填」。 */
export function NumberField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testID?: string;
}) {
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <SectionLabel text={props.label} />
      <Input
        testID={props.testID}
        value={props.value}
        placeholder={props.placeholder ?? "未填"}
        keyboardType="decimal-pad"
        onChange={(event) => props.onChange(event.value)}
        style={{
          backgroundColor: token("muted"),
          borderRadius: token("radius"),
          paddingHorizontal: 12,
          paddingVertical: 10,
          fontSize: 14,
          color: token("foreground"),
        }}
      />
    </View>
  );
}

/** 一行文本输入。 */
export function TextField(props: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testID?: string;
  multiline?: boolean;
}) {
  return (
    <Input
      testID={props.testID}
      value={props.value}
      placeholder={props.placeholder}
      multiline={props.multiline}
      onChange={(event) => props.onChange(event.value)}
      style={{
        backgroundColor: token("muted"),
        borderRadius: token("radius"),
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 13,
        color: token("foreground"),
      }}
    />
  );
}

/** 一行提示：错误用 destructive，普通说明用 muted。 */
export function Note(props: {
  text: string;
  tone?: "muted" | "error" | "accent";
  testID?: string;
}) {
  const tone = props.tone ?? "muted";
  const color =
    tone === "error"
      ? token("destructive")
      : tone === "accent"
        ? token("accent")
        : token("muted-foreground");
  return (
    <Text testID={props.testID} style={{ fontSize: 11, lineHeight: 18, color }}>
      {props.text}
    </Text>
  );
}

/** 页面标题 + 说明。 */
export function ScreenHeader(props: { eyebrow?: string; title: string; note?: string }) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 4 }}>
      {props.eyebrow ? <SectionLabel text={props.eyebrow} /> : null}
      <Text
        style={{
          fontSize: 20,
          fontWeight: "bold",
          letterSpacing: -0.3,
          color: token("foreground"),
        }}
      >
        {props.title}
      </Text>
      {props.note ? <Note text={props.note} /> : null}
    </View>
  );
}

/** 底部四个 Tab，顺序固定（contract §6.5）。 */
const TABS = [
  { key: "today", zh: "今日" },
  { key: "calendar", zh: "日历" },
  { key: "conversations", zh: "对话" },
  { key: "profile", zh: "档案" },
] as const;

export function TabBar(props: { current: string; onSelect: (key: string) => void }) {
  return (
    <View
      style={{
        flexDirection: "row",
        borderTopWidth: 1,
        borderColor: token("border"),
        paddingTop: 8,
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {TABS.map((tab) => (
        <View
          testID={`tab-${tab.key}`}
          role="tab"
          accessibilityLabel={tab.zh}
          onPress={() => props.onSelect(tab.key)}
          style={{ flex: 1, alignItems: "center", paddingVertical: 4 }}
        >
          <Text
            style={{
              fontSize: 10,
              color:
                props.current === tab.key
                  ? token("primary")
                  : token("muted-foreground"),
            }}
          >
            {tab.zh}
          </Text>
        </View>
      ))}
    </View>
  );
}
