// 应用外壳：冷启动读档案 → 没走完引导就先引导，走完了进四个 Tab。
import { mount, openUrl, resource, signal, Text, token, View } from "nsh";
import { Profile } from "lianlian/native";

import { profileDrafts } from "./ui/drafts";
import { CalendarScreen } from "./screens/calendar";
import { Onboarding } from "./screens/onboarding";
import { ConversationsScreen } from "./screens/conversations";
import { ProfileScreen } from "./screens/profile";
import { Today } from "./screens/today";
import { TabBar } from "./ui/parts";
import { checkForUpdates, rememberSkipped } from "./ui/updates";
import type { UpdateCheck } from "./ui/updates";

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
  // 更新检查跟着应用实例走：启动查一次，之后不再重复请求。
  const update = resource(() => checkForUpdates());
  // 从对话的错误态跳去设置：切 Tab 后由档案页把自己推到设置页。
  const profileIntent = signal<"none" | "settings">("none");
  // 聊天是详情页：它占满整屏，底部 Tab 只在四个顶层页出现。
  const chatOpen = signal(false);

  const selectTab = (next: Tab) => {
    tab.set(next);
    chatOpen.set(false);
  };

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
                onGoProfile={() => selectTab("profile")}
                onGoConversations={() => selectTab("conversations")}
                update={update()}
                onDismissUpdate={(version) => {
                  // 先落盘再重查：跳过的版本由 Rust 侧记住，重查后提示条自己消失。
                  void (async () => {
                    await rememberSkipped(version);
                    update.refetch();
                  })();
                }}
                onOpenUpdate={(url) => {
                  // 安卓上 canInstall 恒为 false：只把用户送到下载地址，
                  // 安装交给系统安装器确认，应用不自己拉起安装器。
                  void openUrl(url).catch(() => {});
                }}
              />
            ) : null}
            {tab() === "profile" ? (
              <ProfileScreen
                state={profile()!}
                drafts={profileDrafts(profile()!)}
                onSaved={() => profile.refetch()}
                onGoConversations={() => selectTab("conversations")}
                settingsRequest={profileIntent}
                onRootBack={() => selectTab("today")}
              />
            ) : null}
            {tab() === "calendar" ? (
              <CalendarScreen onRootBack={() => selectTab("today")} />
            ) : null}
            {tab() === "conversations" ? (
              <ConversationsScreen
                onOpenSettings={() => {
                  selectTab("profile");
                  profileIntent.set("settings");
                }}
                onRootBack={() => selectTab("today")}
                onChatOpenChange={(open) => chatOpen.set(open)}
              />
            ) : null}
          </View>
          {tab() === "conversations" && chatOpen() ? null : (
            <TabBar current={tab()} onSelect={(next) => selectTab(next as Tab)} />
          )}
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
