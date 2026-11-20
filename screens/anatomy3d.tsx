// 3D 解剖 spike：Rust loopback 服务提供 viewer 与 GLB，WebView 只负责显示。
// 这里不碰档案业务，只验证 Android WebView 能否离线加载 Three.js 页面。
// 注意：`nsh.json` 的 `android.usesCleartextTraffic` 在 0.4.0 spike 里暂时保留，
// 只为访问 127.0.0.1 的 loopback；生产前应改成仅放行 127.0.0.1 的
// network security config，或换 HTTPS/自定义 scheme。
import { resource, signal, Text, token, View, WebView } from "nsh";
import type { WebViewRef } from "nsh";
import { Anatomy3d } from "lianlian/native";

import { TextButton } from "../ui/parts";
import { typeScale } from "../ui/type";

/** 等 viewer 的异步加载结束再读统计；失败就保持空白，不影响页面。 */
const READ_STATS = `(async () => {
  for (let i = 0; i < 60; i += 1) {
    if (window.__viewer && window.__viewer.ready) {
      return window.__viewer.stats;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return window.__viewer ? window.__viewer.stats : null;
})()`;

function numberField(value: unknown, key: string): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

/** 「744k 面 · 3 dc」；没拿到统计时返回 null。 */
function statsLabel(value: unknown): string | null {
  const triangles = numberField(value, "triangles");
  const drawCalls = numberField(value, "drawCalls");
  const parts: string[] = [];
  if (triangles !== null && triangles > 0) {
    parts.push(`${Math.round(triangles / 1000)}k 面`);
  }
  if (drawCalls !== null && drawCalls > 0) {
    parts.push(`${Math.round(drawCalls)} dc`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function Anatomy3dScreen(props: { onBack: () => void }) {
  const viewer = resource(() => Anatomy3d.url());
  const error = signal<string | null>(null);
  const stats = signal<string | null>(null);
  let webview: WebViewRef | undefined;

  const readStats = async () => {
    if (!webview) {
      return;
    }
    try {
      const result = await webview.evaluate(READ_STATS);
      const label = statsLabel(result.value);
      if (label) {
        stats.set(label);
      }
    } catch {
      // 统计只是 spike 的附加信息；evaluate 不可用或页面还没准备好就算了。
    }
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
        <TextButton testID="anatomy3d-back" label="← 档案" onPress={props.onBack} />
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
          3D 解剖 · spike
        </Text>
        <View style={{ minWidth: 64, alignItems: "flex-end" }}>
          {stats() ? (
            <Text
              testID="anatomy3d-stats"
              style={{ fontSize: 10, color: token("muted-foreground") }}
            >
              {stats()}
            </Text>
          ) : null}
        </View>
      </View>

      {error() ? (
        <View
          testID="anatomy3d-error"
          style={{
            paddingHorizontal: 16,
            paddingVertical: 10,
            backgroundColor: token("card"),
          }}
        >
          <Text style={{ fontSize: typeScale.label, color: token("destructive") }}>
            {error()}
          </Text>
        </View>
      ) : null}

      {viewer() === undefined ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: typeScale.body, color: token("muted-foreground") }}>
            正在准备本地 3D 资源…
          </Text>
        </View>
      ) : viewer() ? (
        <WebView
          ref={(node) => {
            webview = node;
          }}
          testID="anatomy3d-webview"
          src={viewer()!}
          javaScriptEnabled
          style={{ flex: 1 }}
          onError={(event) => {
            const code = event.code ? `（${event.code}）` : "";
            error.set(`3D 页面加载失败：${event.message}${code}`);
          }}
          onLoad={() => {
            error.set(null);
            void readStats();
          }}
        />
      ) : (
        <View
          testID="anatomy3d-service-error"
          style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}
        >
          <Text style={{ fontSize: typeScale.body, color: token("destructive") }}>
            本地 3D 服务没能启动，viewer 无法加载。
          </Text>
        </View>
      )}
    </View>
  );
}
