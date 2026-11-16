// 应用外壳：冷启动读档案 → 没走完引导就先引导，走完了进四个 Tab。
import { mount, resource, signal, Text, token, View } from "nsh";
import { Profile } from "lianlian/native";

import { profileDrafts } from "./ui/drafts";
import { CalendarScreen } from "./screens/calendar";
import { Onboarding } from "./screens/onboarding";
import { ConversationsScreen } from "./screens/conversations";
import { ProfileScreen } from "./screens/profile";
import { Today } from "./screens/today";
import { TabBar } from "./ui/parts";

type Tab = "today" | "calendar" | "conversations" | "profile";

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
  // 从对话的错误态跳去设置：切 Tab 后由档案页把自己推到设置页。
  const profileIntent = signal<"none" | "settings">("none");

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
              <ProfileScreen
                state={profile()!}
                drafts={profileDrafts(profile()!)}
                onSaved={() => profile.refetch()}
                onGoConversations={() => tab.set("conversations")}
                settingsRequest={profileIntent}
                onRootBack={() => tab.set("today")}
              />
            ) : null}
            {tab() === "calendar" ? (
              <CalendarScreen onRootBack={() => tab.set("today")} />
            ) : null}
            {tab() === "conversations" ? (
              <ConversationsScreen
                onOpenSettings={() => {
                  tab.set("profile");
                  profileIntent.set("settings");
                }}
                onRootBack={() => tab.set("today")}
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
