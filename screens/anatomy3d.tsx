// 3D 身体图：Rust loopback 服务提供 viewer 与 GLB，WebView 负责显示。
// 这里只读档案里的肌肉异常，把主题色、异常集合与卡片推给 viewer，并承接跨页恢复与慢设备提示。
import { effect, resource, signal, Text, token, View, WebView } from "nsh";
import type { WebViewRef } from "nsh";
import { Anatomy3d, Findings } from "lianlian/native";

import { PrimaryButton, TextButton } from "../ui/parts";
import { leading, typeScale } from "../ui/type";
import {
  deriveAbnormalSites,
  deriveCards,
  exportStateScript,
  highlightScript,
  rememberViewerState,
  restoreStateScript,
  savedViewerSnapshot,
  sectionForSite,
  type HighlightPalette,
} from "./anatomy3d-model";

function loadError(event: { message?: string; code?: string }): string {
  const code = event.code ? `（${event.code}）` : "";
  return event.message ? `页面加载失败：${event.message}${code}` : "页面加载失败。";
}

function withSentenceEnd(message: string): string {
  const text = message.trim() || "未知原因";
  return /[。！？.!?]$/.test(text) ? text : `${text}。`;
}

/** 往已有地址追加查询串，保留原有的 `?` 与参数。 */
function appendQuery(base: string, query: string): string {
  return `${base}${base.includes("?") ? "&" : "?"}${query}`;
}

/** 重试时换一个查询串，保证 WebView 重新加载而不是复用同一个地址。 */
function retryUrl(base: string, nonce: number): string {
  if (nonce === 0) {
    return base;
  }
  return appendQuery(base, `retry=${nonce}`);
}

/** 关注模式只影响 3D 页面自己的初始行为，不改查询里的档位与默认视角。 */
function withFocus(base: string, focus?: "attention"): string {
  return focus === "attention" ? appendQuery(base, "focus=attention") : base;
}

/** 整页错误态：说明原因、重试，并保留回档案这条路。 */
function ViewerError(props: {
  reason: string;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <View
      testID="anatomy3d-error"
      style={{
        flex: 1,
        justifyContent: "center",
        paddingHorizontal: 20,
        paddingBottom: 32,
        gap: 10,
      }}
    >
      <Text
        testID="anatomy3d-error-title"
        style={{
          fontSize: typeScale.title,
          lineHeight: leading.title,
          fontWeight: "bold",
          color: token("foreground"),
        }}
      >
        3D 身体图没能载入
      </Text>
      <Text
        testID="anatomy3d-error-reason"
        style={{
          fontSize: typeScale.body,
          lineHeight: leading.body,
          color: token("muted-foreground"),
        }}
      >
        {withSentenceEnd(props.reason)}
      </Text>
      <View style={{ gap: 6, marginTop: 10 }}>
        <PrimaryButton testID="anatomy3d-retry" label="重试" onPress={props.onRetry} />
        <TextButton
          testID="anatomy3d-error-back"
          label="回档案"
          hint="回档案"
          onPress={props.onBack}
        />
      </View>
    </View>
  );
}

export function Anatomy3dScreen(props: {
  onBack: () => void;
  onOpenSection: (sectionId: string, focusSlug?: string) => void;
  focus?: "attention";
}) {
  const viewer = resource(() => Anatomy3d.url());
  const findings = resource(() => Findings.load());
  const failure = signal<string | null>(null);
  const slowDevice = signal(false);
  const retryNonce = signal(0);
  let webview: WebViewRef | undefined;
  let highlightReady = false;
  let restoreDone = false;
  let saveInFlight: Promise<void> | null = null;

  const palette = (): HighlightPalette => ({
    left: token("chart-1"),
    right: token("chart-2"),
    abnormal: token("destructive"),
    selected: token("primary"),
  });

  const saveViewerState = () => {
    if (saveInFlight) {
      return saveInFlight;
    }
    const node = webview;
    if (!node) {
      return Promise.resolve();
    }
    const pending = (async () => {
      try {
        const result = await node.evaluate(exportStateScript(), { timeout: 2500 });
        if (result.value && typeof result.value === "object") {
          rememberViewerState(result.value);
        }
      } catch {
        // Leaving must not depend on the WebView still answering.
      }
    })();
    saveInFlight = pending.finally(() => {
      saveInFlight = null;
    });
    return saveInFlight;
  };

  const pushHighlight = () => {
    if (!highlightReady) {
      return;
    }
    const data = findings();
    const resourceError = findings.error();
    if (!webview || !data) {
      return;
    }
    const unavailable = Boolean(resourceError || data.error);
    const sites = unavailable ? [] : deriveAbnormalSites(data);
    const cards = unavailable ? [] : deriveCards(data);
    try {
      void webview
        .evaluate(highlightScript(palette(), sites, cards))
        .catch(() => {});
    } catch {
      // The page can navigate as the WebView is replaced; the next onLoad pushes again.
    }
  };

  const restoreThenHighlight = async () => {
    if (restoreDone) {
      highlightReady = true;
      pushHighlight();
      return;
    }
    restoreDone = true;
    const node = webview;
    const snapshot = savedViewerSnapshot();
    if (node && snapshot) {
      try {
        await node.evaluate(restoreStateScript(snapshot), { timeout: 8000 });
      } catch {
        // Restoring is best-effort; the viewer stays usable without it.
      }
    }
    highlightReady = true;
    pushHighlight();
  };

  const leaveViewer = async () => {
    await saveViewerState();
    props.onBack();
  };

  const openArchiveSection = async (message: {
    siteId?: unknown;
    side?: unknown;
  }) => {
    if (typeof message.siteId !== "string" || !message.siteId) {
      return;
    }
    try {
      await saveViewerState();
      const data = findings() ?? (await Findings.load());
      const target = sectionForSite(
        data,
        message.siteId,
        typeof message.side === "string" ? message.side : null,
      );
      if (!target) {
        return;
      }
      props.onOpenSection(target.sectionId, target.focusSlug);
    } catch {
      // A failed archive lookup leaves the user on the model, not on a broken page.
    }
  };

  // Findings can land after the page (or change after a retry); onLoad alone is not enough.
  effect(pushHighlight);

  const resetViewer = () => {
    if (!webview) {
      return;
    }
    try {
      void webview.evaluate("window.__viewer.reset()").catch(() => {});
    } catch {
      // 重置失败保持静默；页面仍可继续操作。
    }
  };

  const retry = () => {
    failure.set(null);
    slowDevice.set(false);
    retryNonce.set(retryNonce() + 1);
    viewer.refetch();
  };

  const retryFindings = () => {
    findings.refetch();
  };

  const serviceFailure = () => (viewer() === "" ? "本地 3D 服务没能启动。" : null);
  const failureReason = () => failure() ?? serviceFailure();
  const findingsFailure = () => {
    const error = findings.error();
    if (error) {
      return String(error);
    }
    return findings()?.error ?? null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: token("background") }}>
      <View
        style={{
          height: 44,
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 8,
          borderBottomWidth: 1,
          borderColor: token("border"),
        }}
      >
        <View style={{ minWidth: 68 }}>
          <TextButton
            testID="anatomy3d-back"
            label="← 档案"
            onPress={() => {
              void leaveViewer();
            }}
          />
        </View>
        <Text
          testID="anatomy3d-title"
          style={{
            flex: 1,
            textAlign: "center",
            fontSize: typeScale.item,
            fontWeight: "bold",
            color: token("foreground"),
          }}
        >
          3D 身体图
        </Text>
        <View style={{ minWidth: 68, alignItems: "flex-end" }}>
          <TextButton testID="anatomy3d-reset" label="重置" onPress={resetViewer} />
        </View>
      </View>

      {slowDevice() && !failureReason() ? (
        <View
          testID="anatomy3d-slow-device"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderColor: token("border"),
            backgroundColor: token("card"),
          }}
        >
          <Text
            style={{
              flex: 1,
              fontSize: typeScale.label,
              lineHeight: leading.label,
              color: token("muted-foreground"),
            }}
          >
            这台设备可能较慢
          </Text>
          <TextButton
            testID="anatomy3d-slow-device-back"
            label="回档案"
            onPress={() => {
              void leaveViewer();
            }}
          />
        </View>
      ) : null}

      {findingsFailure() && !failureReason() ? (
        <View
          testID="anatomy3d-findings-warning"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderBottomWidth: 1,
            borderColor: token("border"),
            backgroundColor: token("card"),
          }}
        >
          <Text
            style={{
              flex: 1,
              fontSize: typeScale.label,
              lineHeight: leading.label,
              color: token("muted-foreground"),
            }}
          >
            档案没读出来，现在只显示解剖图
          </Text>
          <TextButton
            testID="anatomy3d-findings-retry"
            label="重试"
            onPress={retryFindings}
          />
        </View>
      ) : null}

      {failureReason() ? (
        <ViewerError
          reason={failureReason()!}
          onRetry={retry}
          onBack={() => {
            void leaveViewer();
          }}
        />
      ) : viewer() === undefined ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: typeScale.body, color: token("muted-foreground") }}>
            正在准备本地 3D 资源…
          </Text>
        </View>
      ) : (
        <WebView
          ref={(node) => {
            webview = node;
          }}
          testID="anatomy3d-webview"
          src={retryUrl(withFocus(viewer()!, props.focus), retryNonce())}
          javaScriptEnabled
          style={{ flex: 1 }}
          onLoadStart={() => {
            highlightReady = false;
            restoreDone = false;
            failure.set(null);
            slowDevice.set(false);
          }}
          onLoad={() => {
            void restoreThenHighlight();
          }}
          onError={(event) => failure.set(loadError(event))}
          onMessage={(event) => {
            try {
              const message = JSON.parse(event.data);
              if (message?.type === "anatomy3d:error") {
                failure.set(
                  message.message ? `模型没能载入：${message.message}` : "模型没能载入。",
                );
              } else if (message?.type === "anatomy3d:open-section") {
                void openArchiveSection(message);
              } else if (message?.type === "anatomy3d:state") {
                rememberViewerState(message.state);
              } else if (message?.type === "anatomy3d:slow-device") {
                slowDevice.set(true);
              }
            } catch {
              // 页面消息不是我们的契约时忽略。
            }
          }}
        />
      )}
    </View>
  );
}
