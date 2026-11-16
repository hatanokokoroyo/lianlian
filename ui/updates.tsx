// 应用内更新：启动后问一次更新源，有新版本就在今日页顶部提示。
//
// 检查挂在 `App` 的资源里（跟着应用实例走，不在模块作用域存状态），今日页只负责渲染。
// 开发运行（`nsh run`）与 headless 测试里 `checkForUpdate` 恒为空，所以这里不写环境判断：
// 测试用 `open(..., { modules: { "nsh/updater": … } })` 换掉检查结果。
import { Text, token, View } from "nsh";
import type { JSX } from "nsh";
import { checkForUpdate } from "nsh/updater";
import type { AppUpdate } from "nsh/updater";
import { Updates } from "lianlian/native";

import { PrimaryButton, TextButton } from "./parts";

/** 一次检查的结果：用户跳过过的版本，加上查到的更新。 */
export interface UpdateCheck {
  skipped: string | null;
  found: AppUpdate | null;
}

/** 启动时查一次：先读跳过的版本，再问更新源。失败一律静默。 */
export async function checkForUpdates(): Promise<UpdateCheck> {
  const skipped = (await Updates.skipped()) || null;
  try {
    return { skipped, found: await checkForUpdate() };
  } catch {
    // 离线、限流、清单异常：不打扰用户，照常用应用。
    return { skipped, found: null };
  }
}

/** 记住「以后再说」的版本；写失败也不该挡住界面。 */
export async function rememberSkipped(version: string): Promise<void> {
  await Updates.skip(version);
}

/** 更新说明只取第一行，够看「这次改了什么」。 */
function summary(notes: string | null | undefined): string {
  return (notes ?? "").trim().split("\n")[0]?.trim() ?? "";
}

/** 该不该提示：查到了新版本，且这个版本没被跳过。 */
export function showsUpdate(check?: UpdateCheck | null): boolean {
  const found = check?.found;
  return !!found && found.version !== check?.skipped;
}

/** 今日页顶部的更新提示。要不要显示由调用方按 `showsUpdate` 决定。 */
export function UpdateBanner(props: {
  found: AppUpdate;
  onOpen: (url: string) => void;
  onDismiss: (version: string) => void;
}): JSX.Element {
  const note = summary(props.found.notes);
  return (
    <View
      testID="update-banner"
      style={{
        backgroundColor: token("card"),
        borderRadius: token("radius"),
        borderWidth: 1,
        borderColor: token("primary"),
        padding: 14,
        gap: 10,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: "bold", color: token("primary") }}>
        {`新版本 ${props.found.version}`}
      </Text>
      {note ? (
        <Text style={{ fontSize: 11, color: token("muted-foreground") }}>{note}</Text>
      ) : null}
      <View style={{ gap: 8 }}>
        <PrimaryButton
          testID="update-download"
          label="去下载"
          onPress={() => props.onOpen(props.found.url)}
        />
        <View style={{ alignItems: "center" }}>
          <TextButton
            testID="update-later"
            label="以后再说"
            onPress={() => props.onDismiss(props.found.version)}
          />
        </View>
      </View>
    </View>
  );
}
