// 设置：DeepSeek 的 API key 与工具往返上限。
//
// key 只存在本机（ADR-0001），界面只显示打码后的样子；「填入/更换」才展开输入框。
// 配置类错误（key 无效、无额度）会把人送到这一屏。
// 工具往返上限（#9）：默认 6，可填 1–128；没有「无限制」——那是让模型空转烧钱的开关。
import { resource, signal, Text, token, View } from "nsh";
import { Settings } from "lianlian/native";

import { Card, Note, PrimaryButton, ScreenHeader, SectionLabel, TextButton, TextField } from "../ui/parts";

export function SettingsScreen(props: { onBack: () => void }) {
  const settings = resource(() => Settings.load());
  const editing = signal(false);
  const key = signal("");
  const message = signal<string | null>(null);
  const rounds = signal("");

  const save = async () => {
    message.set(null);
    const error = await Settings.saveKey(key());
    if (error) {
      message.set(error);
      return;
    }
    key.set("");
    editing.set(false);
    message.set("已保存。key 只存在这台设备上。");
    settings.refetch();
  };

  const saveRounds = async () => {
    message.set(null);
    const value = Number(rounds().trim() === "" ? "0" : rounds().trim());
    if (!Number.isFinite(value)) {
      message.set("轮数要填一个整数。");
      return;
    }
    const error = await Settings.saveRounds(value);
    if (error) {
      message.set(error);
      return;
    }
    rounds.set("");
    message.set("工具往返上限已保存。");
    settings.refetch();
  };

  const clear = async () => {
    message.set(null);
    const error = await Settings.clearKey();
    if (error) {
      message.set(error);
      return;
    }
    editing.set(false);
    key.set("");
    message.set("已清除。发消息之前需要重新填一把。");
    settings.refetch();
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <TextButton testID="back" label="← 回档案" onPress={props.onBack} />
      </View>
      <ScreenHeader
        eyebrow="设置"
        title="模型与 key"
        note="练练没有后端：你的话与档案只在这台设备上，请求直连 api.deepseek.com。"
      />

      <View style={{ padding: 16, gap: 12 }}>
        {settings()?.error ? (
          <Card testID="settings-error">
            <Note tone="error" text={settings()!.error ?? ""} />
          </Card>
        ) : null}
        {message() ? (
          <Card testID="settings-message">
            <Note tone="accent" text={message()!} />
          </Card>
        ) : null}

        <Card testID="settings-key">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
              DeepSeek API key
            </Text>
            <SectionLabel text={settings()?.hasKey ? "已保存" : "未填"} />
          </View>

          {settings()?.hasKey && !editing() ? (
            <Note text={`已保存：${settings()!.masked ?? "…"}。要换一把就「填入/更换」。`} />
          ) : (
            <Note text="在 platform.deepseek.com 拿到 key 后粘到这里。它不会离开这台设备。" />
          )}

          {editing() ? (
            <View style={{ gap: 8 }}>
              <TextField
                testID="api-key"
                value={key()}
                onChange={(value) => key.set(value)}
                placeholder="sk-…"
              />
              <PrimaryButton testID="save-api-key" label="保存 key" onPress={save} />
              <TextButton
                testID="cancel-edit-key"
                label="取消"
                onPress={() => {
                  editing.set(false);
                  key.set("");
                }}
              />
            </View>
          ) : (
            <View style={{ flexDirection: "row", gap: 12 }}>
              <PrimaryButton
                testID="reveal-key"
                label={settings()?.hasKey ? "填入/更换" : "填入 key"}
                onPress={() => {
                  message.set(null);
                  editing.set(true);
                }}
              />
              {settings()?.hasKey ? (
                <TextButton testID="clear-api-key" label="清除" onPress={clear} />
              ) : null}
            </View>
          )}
        </Card>

        <Card testID="settings-tools">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ fontSize: 13, fontWeight: "bold", color: token("foreground") }}>
              工具往返上限
            </Text>
            <SectionLabel text={`${settings()?.toolRounds ?? 6} 轮`} />
          </View>
          <Note text="一轮对话里 agent 最多调几次工具（先查依据、再写档案都算一次）。默认 6，可填 1–128；调太高只会让它空转。" />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <TextField
                testID="tool-rounds"
                value={rounds()}
                onChange={(value) => rounds.set(value)}
                placeholder={String(settings()?.toolRounds ?? 6)}
              />
            </View>
            <PrimaryButton
              testID="save-tool-rounds"
              label="保存轮数"
              disabled={rounds().trim() === ""}
              onPress={saveRounds}
            />
          </View>
        </Card>

        <Card>
          <SectionLabel text="关于这些数据" />
          <Note text="key 明文存在 app 私有目录的本地库里，拿到手机的人能看到它；没有账号、没有同步、没有用量统计。" />
        </Card>
      </View>
    </View>
  );
}
