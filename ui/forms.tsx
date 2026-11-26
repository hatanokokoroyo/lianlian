// 基本属性与训练条件的表单：引导流程和档案页共用同一套字段与草稿，
// 免得两处的输入规则悄悄分家。
import { signal, Text, token, View } from "nsh";
import type { Signal } from "nsh";
import type { BasicsView, TrainingView } from "lianlian/native";

import {
  Chip,
  ChipRow,
  Note,
  NumberField,
  SectionLabel,
  TextButton,
  TextField,
} from "./parts";
import { typeScale } from "./type";

/** 性别选项：「不填」是 null。 */
const SEXES = [
  { key: null, zh: "不填" },
  { key: "female", zh: "女" },
  { key: "male", zh: "男" },
] as const;

/** 每周几天。 */
const DAYS = [2, 3, 4, 5];
/** 每次多久（分钟）。 */
const MINUTES = [15, 30, 45];
/** 在哪练。 */
const PLACES = [
  { key: "home", zh: "家" },
  { key: "gym", zh: "健身房" },
  { key: "office", zh: "办公室" },
  { key: "outdoor", zh: "户外" },
] as const;
/** 手边有什么；`nothing` 与其他互斥（规则在 Rust 的 `TrainingContext` 里）。 */
const EQUIPMENT = [
  { key: "band", zh: "弹力带" },
  { key: "dumbbell-8kg", zh: "哑铃 8kg" },
  { key: "mat", zh: "瑜伽垫" },
  { key: "foam-roller", zh: "泡沫轴" },
  { key: "nothing", zh: "什么都没有" },
] as const;
/** 「什么都没有」与其他器械互斥；与 Rust 的 `TrainingContext::validate` 同一条规则。 */
const NO_EQUIPMENT = "nothing";
/** 自定义器械最多 20 个字。 */
const EQUIPMENT_MAX_CHARS = 20;
/** 预设器械的 key；档案里不是这些 key 的 label，就是用户自己输入的。 */
const EQUIPMENT_KEYS = new Set<string>(EQUIPMENT.map((item) => item.key));

/** 数字输入框里的字符串 → 数字；空串就是「未填」。 */
function toNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function numberText(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

/** 基本属性的草稿。 */
export interface BasicsDraft {
  sex: Signal<string | null>;
  age: Signal<string>;
  height: Signal<string>;
  weight: Signal<string>;
  conditions: Signal<string[]>;
  pending: Signal<string>;
}

export function newBasicsDraft(view: BasicsView): BasicsDraft {
  return {
    sex: signal<string | null>(view.sex ?? null),
    age: signal(numberText(view.age)),
    height: signal(numberText(view.heightCm)),
    weight: signal(numberText(view.weightKg)),
    conditions: signal<string[]>([...view.conditions]),
    pending: signal(""),
  };
}

/** 草稿 → 传给 Rust 的字段；`withBody` 为假时不动身高体重（档案页的情形）。 */
export function basicsPayload(draft: BasicsDraft, withBody = true) {
  return {
    sex: draft.sex(),
    age: toNumber(draft.age()),
    heightCm: withBody ? toNumber(draft.height()) : null,
    weightKg: withBody ? toNumber(draft.weight()) : null,
    conditions: draft.conditions(),
  };
}

/** 训练条件的草稿。 */
export interface TrainingDraft {
  days: Signal<number | null>;
  minutes: Signal<number | null>;
  places: Signal<string[]>;
  equipment: Signal<string[]>;
  /** 自定义器械（含已取消选中的）；保存后从 equipment 里恢复。 */
  custom: Signal<string[]>;
  /** 自定义器械的输入框。 */
  pending: Signal<string>;
}

export function newTrainingDraft(view: TrainingView): TrainingDraft {
  return {
    days: signal<number | null>(view.daysPerWeek ?? null),
    minutes: signal<number | null>(view.minutesPerSession ?? null),
    places: signal<string[]>([...view.places]),
    equipment: signal<string[]>([...view.equipment]),
    custom: signal<string[]>(
      view.equipment.filter(
        (label) => label !== NO_EQUIPMENT && !EQUIPMENT_KEYS.has(label),
      ),
    ),
    pending: signal(""),
  };
}

export function trainingPayload(draft: TrainingDraft) {
  return {
    daysPerWeek: draft.days(),
    minutesPerSession: draft.minutes(),
    places: draft.places(),
    equipment: draft.equipment(),
  };
}

/** 列表里加一项 / 删一项（多选）。 */
function toggle(list: readonly string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

/** 多选：已选就取消；新选时清掉「什么都没有」。 */
function toggleEquipment(draft: TrainingDraft, label: string) {
  const current = draft.equipment();
  if (current.includes(label)) {
    draft.equipment.set(current.filter((item) => item !== label));
    return;
  }
  draft.equipment.set([
    ...current.filter((item) => item !== NO_EQUIPMENT),
    label,
  ]);
}

/** 自定义器械：去空、限 20 字、不与预设或已有自定义重名。 */
function addCustomEquipment(draft: TrainingDraft) {
  const label = [...draft.pending().trim()]
    .slice(0, EQUIPMENT_MAX_CHARS)
    .join("");
  if (label === "") {
    return;
  }
  const taken = [
    ...EQUIPMENT.map((item) => item.key),
    ...EQUIPMENT.map((item) => item.zh),
    ...draft.custom(),
  ];
  if (taken.includes(label)) {
    draft.pending.set("");
    return;
  }
  draft.custom.set([...draft.custom(), label]);
  draft.equipment.set([
    ...draft.equipment().filter((item) => item !== NO_EQUIPMENT),
    label,
  ]);
  draft.pending.set("");
}

/** 长按删掉一条自定义器械；预设项不能删。 */
function removeCustomEquipment(draft: TrainingDraft, label: string) {
  draft.custom.set(draft.custom().filter((item) => item !== label));
  draft.equipment.set(draft.equipment().filter((item) => item !== label));
}

/** 首次记录身高体重：只有引导第一步用它，档案页只显示「当前值」（测量决定）。 */
export function BodyMetricFields(props: { draft: BasicsDraft }) {
  const draft = props.draft;
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <NumberField
        testID="basics-height"
        label="身高 cm（记录）"
        value={draft.height()}
        onChange={(value) => draft.height.set(value)}
      />
      <NumberField
        testID="basics-weight"
        label="体重 kg（记录）"
        value={draft.weight()}
        onChange={(value) => draft.weight.set(value)}
      />
    </View>
  );
}

/** 基本属性：性别 + 年龄 + 基础疾病清单（身高体重不在这里，见 BodyMetricFields）。 */
export function BasicsFields(props: { draft: BasicsDraft }) {
  const draft = props.draft;
  const addCondition = () => {
    const text = draft.pending().trim();
    if (text === "" || draft.conditions().includes(text)) {
      draft.pending.set("");
      return;
    }
    draft.conditions.set([...draft.conditions(), text]);
    draft.pending.set("");
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 8 }}>
        <SectionLabel text="性别" />
        <ChipRow>
          {SEXES.map((sex) => (
            <Chip
              testID={`basics-sex-${sex.key ?? "none"}`}
              label={sex.zh}
              active={draft.sex() === sex.key}
              onPress={() => draft.sex.set(sex.key)}
            />
          ))}
        </ChipRow>
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <NumberField
          testID="basics-age"
          label="年龄"
          value={draft.age()}
          onChange={(value) => draft.age.set(value)}
        />
      </View>

      <View style={{ gap: 8 }}>
        <SectionLabel text="基础疾病或旧伤（可留空）" />
        {draft.conditions().length === 0 ? (
          <Note text="还没填。像「右侧踝关节扭伤过两次」这种写下来就有用。" />
        ) : (
          draft.conditions().map((condition, index) => (
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
              <Text style={{ flex: 1, fontSize: typeScale.body, color: token("foreground") }}>
                {condition}
              </Text>
              <Text
                testID={`condition-remove-${index}`}
                role="button"
                accessibilityLabel={`删除 ${condition}`}
                onPress={() =>
                  draft.conditions.set(
                    draft.conditions().filter((item) => item !== condition),
                  )
                }
                style={{ fontSize: typeScale.body, color: token("destructive") }}
              >
                删
              </Text>
            </View>
          ))
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <TextField
              testID="condition-input"
              value={draft.pending()}
              onChange={(value) => draft.pending.set(value)}
              placeholder="例如：腰椎间盘突出"
            />
          </View>
          <TextButton testID="condition-add" label="添加" onPress={addCondition} />
        </View>
      </View>
    </View>
  );
}

/** 训练条件：天数、时长、地点、器械。 */
export function TrainingFields(props: { draft: TrainingDraft }) {
  const draft = props.draft;
  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 8 }}>
        <SectionLabel text="每周能练几天" />
        <ChipRow>
          {DAYS.map((days) => (
            <Chip
              testID={`training-days-${days}`}
              label={`${days} 天`}
              active={draft.days() === days}
              onPress={() => draft.days.set(days)}
            />
          ))}
        </ChipRow>
      </View>

      <View style={{ gap: 8 }}>
        <SectionLabel text="每次多久" />
        <ChipRow>
          {MINUTES.map((minutes) => (
            <Chip
              testID={`training-minutes-${minutes}`}
              label={`${minutes} 分钟`}
              active={draft.minutes() === minutes}
              onPress={() => draft.minutes.set(minutes)}
            />
          ))}
        </ChipRow>
      </View>

      <View style={{ gap: 8 }}>
        <SectionLabel text="在哪练（可多选）" />
        <ChipRow>
          {PLACES.map((place) => (
            <Chip
              testID={`training-place-${place.key}`}
              label={place.zh}
              active={draft.places().includes(place.key)}
              onPress={() => draft.places.set(toggle(draft.places(), place.key))}
            />
          ))}
        </ChipRow>
      </View>

      <View style={{ gap: 8 }}>
        <SectionLabel text="手边有什么（可多选）" />
        <ChipRow>
          {EQUIPMENT.map((item) => (
            <Chip
              testID={`training-equipment-${item.key}`}
              label={item.zh}
              active={draft.equipment().includes(item.key)}
              onPress={() => {
                if (item.key === NO_EQUIPMENT) {
                  draft.equipment.set(
                    draft.equipment().includes(NO_EQUIPMENT) ? [] : [NO_EQUIPMENT],
                  );
                  return;
                }
                toggleEquipment(draft, item.key);
              }}
            />
          ))}
          {draft.custom().map((label, index) => (
            <Chip
              testID={`training-equipment-custom-${index}`}
              label={label}
              active={draft.equipment().includes(label)}
              onPress={() => toggleEquipment(draft, label)}
              onLongPress={() => removeCustomEquipment(draft, label)}
            />
          ))}
        </ChipRow>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <TextField
              testID="training-equipment-input"
              value={draft.pending()}
              onChange={(value) => draft.pending.set(value)}
              placeholder="其他器械，最多 20 字"
              maxLength={EQUIPMENT_MAX_CHARS}
            />
          </View>
          <TextButton
            testID="training-equipment-add"
            label="添加"
            onPress={() => addCustomEquipment(draft)}
          />
        </View>
      </View>
    </View>
  );
}
