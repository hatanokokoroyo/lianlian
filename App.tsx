import { Canvas, mount, resource, signal, Text, token, View } from "nsh";
import { Today } from "lianlian/native";

// 这一版只有一个训练日的读链路：清单来自 Rust 的 redb 库，勾选还只在内存里
// （落库与日状态机是 #14）。视觉照 design/contract.md §2/§7。

/** 「11月15日 周日」 */
function todayLabel(): string {
  const now = new Date();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]}`;
}

const TABS = [
  { label: "今日", testID: "tab-today", active: true },
  { label: "日历", testID: "tab-calendar", active: false },
  { label: "对话", testID: "tab-conversations", active: false },
  { label: "档案", testID: "tab-profile", active: false },
];

function App() {
  // 库在 Rust 侧是异步读的（要拿 app 私有目录），所以走 resource。
  const plan = resource(() => Today.plan());
  // 勾过的动作 slug；跨进程留存要等 #14。
  const done = signal<string[]>([]);

  const total = () => plan()?.exercises.length ?? 0;
  const count = () => done().length;
  const percent = () => (total() === 0 ? 0 : Math.round((count() / total()) * 100));
  const allDone = () => total() > 0 && count() === total();
  const toggle = (slug: string) => {
    const current = done();
    done.set(
      current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug],
    );
  };

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: token("background"),
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingTop: 16,
        }}
      >
        <View>
          <Text style={{ fontSize: 11, color: token("muted-foreground") }}>
            {todayLabel()}
          </Text>
          <Text
            style={{
              marginTop: 2,
              fontSize: 20,
              fontWeight: "bold",
              letterSpacing: -0.3,
              color: token("foreground"),
            }}
          >
            {plan() ? plan()!.title : "练练"}
          </Text>
        </View>
        <View
          testID="open-calendar"
          role="button"
          style={{
            borderWidth: 1,
            borderColor: token("border"),
            borderRadius: 999,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <Text style={{ fontSize: 10, color: token("muted-foreground") }}>
            {plan() ? `本周 ${plan()!.weekDone}/${plan()!.weekTotal}` : "本周 0/0"}
          </Text>
        </View>
      </View>

      {plan.loading() ? (
        <View
          style={{
            marginHorizontal: 16,
            marginTop: 16,
            backgroundColor: token("card"),
            borderRadius: token("radius"),
            padding: 16,
          }}
        >
          <Text style={{ fontSize: 12, color: token("muted-foreground") }}>
            正在算今天的清单…
          </Text>
        </View>
      ) : plan() ? (
        <View
          style={{
            marginHorizontal: 16,
            marginTop: 16,
            backgroundColor: token("card"),
            borderRadius: token("radius"),
            padding: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
          }}
        >
          <View
            accessibilityLabel={`今日完成 ${percent()}%，${count()}/${total()} 项`}
            style={{ width: 96, height: 96 }}
          >
            <Canvas
              style={{ width: 96, height: 96 }}
              draw={(cx, size) => {
                const radius = size.width / 2 - 4;
                const middle = size.width / 2;
                cx.lineWidth = 8;
                cx.lineCap = "round";
                cx.beginPath();
                cx.arc(middle, middle, radius, 0, Math.PI * 2);
                cx.strokeStyle = token("muted");
                cx.stroke();
                const progress = percent();
                if (progress > 0) {
                  cx.beginPath();
                  cx.arc(
                    middle,
                    middle,
                    radius,
                    -Math.PI / 2,
                    -Math.PI / 2 + (Math.PI * 2 * progress) / 100,
                  );
                  cx.strokeStyle = token("primary");
                  cx.stroke();
                }
              }}
            />
            <View
              accessibilityElementsHidden
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  fontSize: 22,
                  fontWeight: "bold",
                  fontVariant: ["tabular-nums"],
                  color: token("foreground"),
                }}
              >
                {`${percent()}%`}
              </Text>
              <Text
                style={{
                  marginTop: 2,
                  fontSize: 10,
                  color: token("muted-foreground"),
                }}
              >
                {`${count()}/${total()} 项`}
              </Text>
            </View>
          </View>

          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 12,
                lineHeight: 20,
                color: token("muted-foreground"),
              }}
            >
              今天的动作来自档案里最该动的几条——
              <Text style={{ color: token("foreground") }}>
                蚌式开合做完再上单腿臀桥，顺序别反。
              </Text>
            </Text>
            <Text
              testID="view-evidence"
              role="button"
              style={{ marginTop: 8, fontSize: 10, color: token("accent") }}
            >
              看依据 · 11月12日
            </Text>
          </View>
        </View>
      ) : (
        <View
          style={{
            marginHorizontal: 16,
            marginTop: 16,
            backgroundColor: token("card"),
            borderRadius: token("radius"),
            padding: 16,
          }}
        >
          <Text
            style={{
              fontSize: 15,
              fontWeight: "bold",
              color: token("foreground"),
            }}
          >
            今天没有安排
          </Text>
          <Text
            style={{
              marginTop: 4,
              fontSize: 12,
              lineHeight: 20,
              color: token("muted-foreground"),
            }}
          >
            先跟 agent 聊一次，让它给你一份能做的计划。
          </Text>
        </View>
      )}

      <View style={{ flex: 1, marginTop: 12, paddingHorizontal: 16, gap: 8 }}>
        {(plan()?.exercises ?? []).map((exercise) => {
          const isDone = done().includes(exercise.slug);
          return (
            <View
              testID={`exercise-${exercise.slug}`}
              role="button"
              accessibilityLabel={`${exercise.name}，${exercise.sets} 组 ${exercise.reps} 次`}
              onPress={() => toggle(exercise.slug)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                backgroundColor: token("card"),
                borderRadius: token("radius"),
                paddingHorizontal: 16,
                paddingVertical: 14,
              }}
            >
              <View
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isDone ? token("primary") : "transparent",
                  borderWidth: isDone ? 0 : 2,
                  borderColor: token("border"),
                }}
              >
                {isDone ? (
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: "bold",
                      color: token("primary-foreground"),
                    }}
                  >
                    ✓
                  </Text>
                ) : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: "bold",
                    color: isDone ? token("muted-foreground") : token("foreground"),
                    textDecorationLine: isDone ? "line-through" : "none",
                  }}
                >
                  {exercise.name}
                </Text>
                <Text
                  style={{
                    marginTop: 2,
                    fontSize: 10,
                    color: token("muted-foreground"),
                  }}
                >
                  {exercise.basis}
                </Text>
              </View>
              <Text
                style={{
                  fontSize: 12,
                  fontVariant: ["tabular-nums"],
                  color: token("muted-foreground"),
                }}
              >
                {`${exercise.sets}×${exercise.reps}`}
              </Text>
            </View>
          );
        })}
      </View>

      <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
        <View
          testID="checkin"
          role="button"
          accessibilityLabel={allDone() ? "打卡" : `还差 ${total() - count()} 项`}
          disabled={!allDone()}
          style={{
            borderRadius: 999,
            paddingVertical: 14,
            alignItems: "center",
            backgroundColor: allDone() ? token("primary") : token("muted"),
          }}
        >
          <Text
            style={{
              fontSize: 14,
              fontWeight: "bold",
              color: allDone() ? token("primary-foreground") : token("muted-foreground"),
            }}
          >
            {allDone() ? "打卡" : `还差 ${total() - count()} 项`}
          </Text>
        </View>
        <View
          style={{
            marginTop: 10,
            flexDirection: "row",
            justifyContent: "center",
            gap: 24,
          }}
        >
          <Text
            testID="postpone"
            role="button"
            style={{ fontSize: 10, color: token("muted-foreground") }}
          >
            整天推迟
          </Text>
          <Text style={{ fontSize: 10, color: token("border") }}>·</Text>
          <Text
            testID="skip-exercise"
            role="button"
            style={{ fontSize: 10, color: token("muted-foreground") }}
          >
            跳过一项
          </Text>
        </View>
      </View>

      {/* 四个 Tab 的页面切换在 #14 / #16 / #11 落地，这里先只立住当前项。 */}
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
            testID={tab.testID}
            role="tab"
            style={{ flex: 1, alignItems: "center", paddingVertical: 4 }}
          >
            <Text
              style={{
                fontSize: 10,
                color: tab.active ? token("primary") : token("muted-foreground"),
              }}
            >
              {tab.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

mount(App);