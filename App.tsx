// 应用外壳：冷启动读档案 → 没走完引导就先引导，走完了进四个 Tab。
// 日历屏还没做（#16），这里给一个说清状态的占位，而不是空白。
import { mount, resource, signal, Text, token, View } from "nsh";
import { Profile } from "lianlian/native";

import { profileDrafts } from "./ui/drafts";
import { Onboarding } from "./screens/onboarding";
import { ConversationsScreen } from "./screens/conversations";
import { MeasurementsScreen } from "./screens/measurements";
import { SettingsScreen } from "./screens/settings";
import { ProfileScreen } from "./screens/profile";
import { Today } from "./screens/today";
import { Card, Note, ScreenHeader, TabBar } from "./ui/parts";

type Tab = "today" | "calendar" | "conversations" | "profile";

/** 还没做的那两屏：说清楚是什么、由哪个工单来接手。 */
function Pending(props: { title: string; ticket: string }) {
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader eyebrow="还没做" title={props.title} />
      <View style={{ padding: 16 }}>
        <Card>
          <Note text={`这一屏由 ${props.ticket} 来做。现在它不影响已经跑通的链路。`} />
        </Card>
      </View>
    </View>
  );
}

function Loading() {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: token("background"),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontSize: 12, color: token("muted-foreground") }}>正在读你的档案…</Text>
    </View>
  );
}

function App() {
  const profile = resource(() => Profile.load());
  const tab = signal<Tab>("today");
  // 档案 Tab 内的页面栈：档案 → 测量（详情页用 push，见 contract §4）。
  const profilePage = signal<"root" | "measurements" | "settings">("root");

  // 注意：accessor 的读取都写在 JSX 里——NSH 只跟踪渲染期间读到的信号，
  // 在函数体里读会让「读库完成」这件事没人订阅，页面就永远停在加载态。
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: token("background"),
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      {profile() === undefined ? (
        <Loading />
      ) : profile()!.onboarded ? (
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1 }}>
            {tab() === "today" ? (
              <Today
                onGoProfile={() => tab.set("profile")}
                onGoConversations={() => tab.set("conversations")}
              />
            ) : null}
            {tab() === "profile" ? (
              profilePage() === "measurements" ? (
                <MeasurementsScreen
                  onBack={() => {
                    profilePage.set("root");
                    profile.refetch();
                  }}
                />
              ) : profilePage() === "settings" ? (
                <SettingsScreen onBack={() => profilePage.set("root")} />
              ) : (
                <ProfileScreen
                  state={profile()!}
                  drafts={profileDrafts(profile()!)}
                  onSaved={() => profile.refetch()}
                  onGoMeasurements={() => profilePage.set("measurements")}
                  onGoSettings={() => profilePage.set("settings")}
                  onGoConversations={() => tab.set("conversations")}
                />
              )
            ) : null}
            {tab() === "calendar" ? <Pending title="月历" ticket="工单 #16" /> : null}
            {tab() === "conversations" ? (
              <ConversationsScreen
                onOpenSettings={() => {
                  tab.set("profile");
                  profilePage.set("settings");
                }}
              />
            ) : null}
          </View>
          <TabBar current={tab()} onSelect={(next) => tab.set(next as Tab)} />
        </View>
      ) : (
        <Onboarding
          state={profile()!}
          drafts={profileDrafts(profile()!)}
          onFinished={() => profile.refetch()}
        />
      )}
    </View>
  );
}

mount(App);
