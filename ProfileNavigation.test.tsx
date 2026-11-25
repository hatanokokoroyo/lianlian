import { beforeAll, expect, open, test } from "nsh/test";
import { Testing } from "lianlian/native";
import type { FindingsView } from "lianlian/native";

import { ensureOnboarded, freshDatabase, replyWith, setApiKey } from "./test-helpers";
import {
  deriveAbnormalSites,
  deriveCards,
  highlightScript,
  sectionForSite,
} from "./screens/anatomy3d-model";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
beforeAll(freshDatabase);

const evidence = {
  user_said: "单腿站的时候骨盆会掉，腰也紧",
  test_and_feedback: "单腿站立 30 秒：左侧骨盆掉下去；弯腰时腰发紧",
  reasoning: "左侧臀中肌支撑不住；腰椎张力偏高",
  uncertainty: "没排除脚踝",
};

function finding(
  callId: string,
  site: string,
  side: string | null,
  values: Record<string, unknown>,
) {
  return {
    type: "function_call",
    call_id: callId,
    name: "record_finding",
    arguments: JSON.stringify({
      site,
      side,
      confidence: 78,
      values,
      evidence,
    }),
  };
}

/** 三条判定（两条臀肌 + 一条腰椎）和一份引用第一条判定的计划。 */
function fullTurn() {
  return {
    status: 200,
    body: {
      status: "completed",
      output: [
        {
          type: "function_call",
          call_id: "call_search_1",
          name: "search_evidence",
          arguments: JSON.stringify({ site: "gluteus-medius" }),
        },
        finding("call_record_1", "gluteus-medius", "left", { tension: "weak" }),
        {
          type: "function_call",
          call_id: "call_search_2",
          name: "search_evidence",
          arguments: JSON.stringify({ site: "gluteus-maximus" }),
        },
        finding("call_record_2", "gluteus-maximus", "left", { tension: "weak" }),
        {
          type: "function_call",
          call_id: "call_search_3",
          name: "search_evidence",
          arguments: JSON.stringify({ site: "lumbar-vertebrae" }),
        },
        finding("call_record_3", "lumbar-vertebrae", null, { tension: "tight" }),
        {
          type: "function_call",
          call_id: "call_plan",
          name: "generate_plan",
          arguments: JSON.stringify({
            frequency: { unit: "per-week", count: 3 },
            exercises: [
              { name: "臀桥", sets: 3, reps: 10, finding: 1 },
              { name: "蚌式开合", sets: 3, reps: 12, finding: 1 },
            ],
          }),
        },
      ],
    },
  };
}

/** 3D 高亮只关心「肌肉 + 任一轴异常 + 部位/侧别」。 */
test("3D 异常集合：只取肌肉、按部位与侧别去重", () => {
  const card = (site: string, side: string | null, abnormal: boolean) => ({
    site,
    site_zh: site,
    side,
    side_zh: side === "left" ? "左" : side === "right" ? "右" : null,
    at: 1,
    finding: 1,
    confidence: 80,
    resolved: false,
    axes: [
      {
        axis: "tension",
        label: "张力",
        value: abnormal ? "紧" : "正常",
        measured: true,
        abnormal,
      },
    ],
    evidence: [],
    evidence_at: null,
    timeline: [],
  });
  const view = {
    total: 4,
    groups: [],
    error: null,
    sections: [
      {
        id: "gluteal-group",
        label: "臀肌群",
        kind: "muscle",
        cards: [
          card("gluteus-medius", "left", true),
          card("gluteus-medius", "left", true),
          card("gluteus-maximus", "right", true),
          card("gluteus-minimus", "left", false),
        ],
      },
      {
        id: "spine",
        label: "腰椎",
        kind: "bone",
        cards: [card("lumbar-vertebrae", null, true)],
      },
    ],
  } as unknown as FindingsView;

  expect(deriveAbnormalSites(view)).toEqual([
    { siteId: "gluteus-medius", side: "left" },
    { siteId: "gluteus-maximus", side: "right" },
  ]);
});

/** 3D 详情卡只透传原生算好的 worst；同侧优先，中线卡兜底。 */
test("3D 卡片：同侧优先、中线兜底与 worst 透传", () => {
  const card = (
    site: string,
    siteZh: string,
    side: string | null,
    abnormal: boolean,
  ) => ({
    site,
    siteZh,
    side,
    sideZh: side === "left" ? "左" : side === "right" ? "右" : null,
    at: 1,
    finding: 1,
    confidence: 0.8,
    resolved: false,
    axes: [
      {
        axis: "tension",
        label: "张力",
        value: abnormal ? "紧" : "正常",
        measured: true,
        abnormal,
      },
    ],
    evidence: [],
    evidence_at: null,
    timeline: [],
  });
  const view = {
    total: 4,
    groups: [],
    error: null,
    sections: [
      {
        id: "gluteal-group",
        label: "臀肌群",
        kind: "muscle",
        cards: [
          card("gluteus-maximus", "臀大肌", "left", true),
          card("gluteus-medius", "臀中肌", "right", false),
          card("transversus-abdominis", "腹横肌", null, true),
        ],
      },
      {
        id: "spine",
        label: "腰椎",
        kind: "bone",
        cards: [card("lumbar-vertebrae", "腰椎", null, true)],
      },
    ],
  } as unknown as FindingsView;

  const cards = deriveCards(view);
  expect(cards.map((entry) => entry.siteId)).toEqual([
    "gluteus-maximus",
    "gluteus-medius",
    "transversus-abdominis",
  ]);
  expect(cards.find((entry) => entry.siteId === "gluteus-maximus")?.worst).toBe(
    "张力 紧",
  );
  expect(cards.find((entry) => entry.siteId === "gluteus-medius")?.worst).toBe(
    "状态平稳",
  );
  expect(cards.find((entry) => entry.siteId === "gluteus-maximus")?.groupId).toBe(
    "gluteal-group",
  );
  expect(cards.find((entry) => entry.siteId === "gluteus-maximus")?.groupZh).toBe(
    "臀肌群",
  );

  const script = highlightScript(
    {
      left: "#1",
      right: "#2",
      abnormal: "#3",
      selected: "#4",
    },
    [{ siteId: "gluteus-maximus", side: "left" }],
    cards,
  );
  expect(script.includes('"worst":"张力 紧"')).toBe(true);
});

/** 「在档案里看依据」把部位与侧别解析成区域页目标。 */
test("3D 看依据：同侧卡优先、中线兜底、无卡不导航", () => {
  const card = (site: string, side: string | null) => ({
    site,
    siteZh: site,
    side,
    sideZh: side === "left" ? "左" : side === "right" ? "右" : null,
    at: 1,
    finding: 1,
    confidence: 0.8,
    resolved: false,
    axes: [],
    evidence: [],
    evidence_at: null,
    timeline: [],
  });
  const view = {
    total: 3,
    groups: [],
    error: null,
    sections: [
      {
        id: "gluteal-group",
        label: "臀肌群",
        kind: "muscle",
        cards: [
          card("gluteus-maximus", "left"),
          card("gluteus-medius", null),
        ],
      },
      {
        id: "core",
        label: "核心",
        kind: "muscle",
        cards: [card("transversus-abdominis", null)],
      },
      {
        id: "spine",
        label: "腰椎",
        kind: "bone",
        cards: [card("lumbar-vertebrae", null)],
      },
    ],
  } as unknown as FindingsView;

  expect(sectionForSite(view, "gluteus-maximus", "left")).toEqual({
    sectionId: "gluteal-group",
    focusSlug: "gluteus-maximus-left",
  });
  expect(sectionForSite(view, "gluteus-medius", "right")).toEqual({
    sectionId: "gluteal-group",
    focusSlug: "gluteus-medius-right",
  });
  expect(sectionForSite(view, "transversus-abdominis", null)).toEqual({
    sectionId: "core",
    focusSlug: "transversus-abdominis",
  });
  expect(sectionForSite(view, "lumbar-vertebrae", null)).toBe(null);
  expect(sectionForSite(view, "multifidus", "left")).toBe(null);
  expect(sectionForSite(undefined, "gluteus-maximus", "left")).toBe(null);
});

/** 从对话里落三条判定与一份计划，再回档案根页。 */
async function seededApp() {
  const responses: unknown[] = [fullTurn(), replyWith("计划和判定都记下了。")];
  const app = await open("./App.tsx", {
    network: {
      "POST https://api.deepseek.com/responses": () => responses.shift() as never,
    },
  });
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");
  await setApiKey(app);

  await app.press("id:tab-conversations");
  await app.waitFor("id:new-conversation");
  await app.press("id:new-conversation");
  await app.waitFor("id:message-input");
  await app.type("id:message-input", "帮我看看骨盆和腰");
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("计划和判定都记下了")));
  await app.press("id:back");
  await app.waitFor("id:new-conversation");

  await app.press("id:tab-profile");
  await app.waitFor("id:plan-card");
  return app;
}

// D 的完整路径：计划 → 关注肌群 → 全部区域 → 我的数据；区域、计划与数据子页
// 都能进入和返回，Tab 往返回根页。
test("档案页 D：顺序、区域/计划跳转与我的数据子页", async () => {
  const app = await seededApp();

  await app.waitFor("id:profile-attention");
  await app.waitFor("id:archive-section-gluteal-group");
  expect(app.shows("id:attention-gluteal-group")).toBe(true);
  expect(app.shows("id:attention-spine")).toBe(false);
  expect(app.shows("id:archive-section-spine")).toBe(true);

  // 顺序就是 D：生效计划 → 关注肌群 → 全部区域 → 我的数据。
  const texts = app.texts();
  const planAt = texts.indexOf("计划");
  const attentionAt = texts.indexOf("需要先处理的肌群");
  const sectionsAt = texts.indexOf("全部区域");
  const dataAt = texts.indexOf("我的数据");
  expect(planAt).toBeGreaterThanOrEqual(0);
  expect(attentionAt).toBeGreaterThan(planAt);
  expect(sectionsAt).toBeGreaterThan(attentionAt);
  expect(dataAt).toBeGreaterThan(sectionsAt);

  // 根页条数与区域页卡片数一致：臀肌群 2 处。
  expect(app.texts()).toContain("2 处");
  expect(app.shows("id:open-anatomy3d")).toBe(true);
  expect(app.texts()).not.toContain("3D 解剖 spike");
  expect(app.shows("id:open-anatomy3d-attention")).toBe(true);
  expect(app.texts().some((text) => text.includes("在 3D 里看这 2 处"))).toBe(true);
  await app.press("id:open-anatomy3d-attention");
  await app.waitFor("id:anatomy3d-title");
  await app.press("id:anatomy3d-back");
  await app.waitFor("id:open-anatomy3d");

  await app.press("id:attention-gluteal-group");
  await app.waitFor("id:site-gluteus-medius-left");
  expect(app.shows("id:site-gluteus-maximus-left")).toBe(true);
  expect(app.shows("id:site-lumbar-vertebrae")).toBe(false);
  await app.press("id:back");
  await app.waitFor("id:open-plan");

  // 计划页：完整动作、历史版本与「看判定」focus。
  await app.press("id:open-plan");
  await app.waitFor("id:plan-exercise-0");
  expect(app.texts()).toContain("臀桥 · 3×10");
  expect(app.texts()).toContain("蚌式开合 · 3×12");
  await app.press("id:plan-versions");
  await app.waitFor("id:plan-versions-list");
  expect(app.texts().some((text) => text.includes("（生效）"))).toBe(true);

  await app.press("id:plan-exercise-0");
  await app.waitFor("id:timeline-gluteus-medius-left");
  expect(app.shows("id:site-gluteus-medius-left-evidence")).toBe(true);
  expect(app.texts().some((text) => text.includes("单腿站立 30 秒"))).toBe(true);
  await app.press("id:back");
  await app.waitFor("id:plan-exercise-0");
  await app.press("id:back");
  await app.waitFor("id:open-basics");

  // 我的数据：四行各自能进入子页，系统返回键都回到根页。
  await app.press("id:open-basics");
  await app.waitFor("id:save-basics");
  await app.back();
  await app.waitFor("id:open-basics");

  await app.press("id:open-measurements");
  await app.waitFor("id:add-measurement");
  await app.back();
  await app.waitFor("id:open-basics");

  await app.press("id:open-training");
  await app.waitFor("id:save-training");
  await app.back();
  await app.waitFor("id:open-basics");

  await app.press("id:open-storage");
  await app.waitFor("id:storage-capacity");
  await app.back();
  await app.waitFor("id:open-basics");

  await app.press("id:open-settings");
  await app.waitFor("id:reveal-key");
  await app.back();
  await app.waitFor("id:open-basics");

  // 切 Tab 再回来：档案从根页开始，不留在旧子页。
  await app.press("id:archive-section-gluteal-group");
  await app.waitFor("id:site-gluteus-medius-left");
  await app.press("id:tab-today");
  // 计划可能把今天排成训练日，也可能留成休息日；只验证真的切到了今日页。
  await app.waitUntil(
    () => app.shows("id:today-rest") || app.shows("id:today-exercises-scroll"),
  );
  await app.press("id:tab-profile");
  await app.waitFor("id:open-basics");
  expect(app.shows("id:site-gluteus-medius-left")).toBe(false);
});

// 空档案 + 无计划：根页给首次评估与排计划入口，不装空索引。
test("档案页 D：空档案与无计划给明确入口", async () => {
  await freshDatabase();
  const app = await open("./App.tsx");
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");

  await app.press("id:tab-profile");
  await app.waitFor("id:findings-empty");
  expect(app.shows("id:plan-empty")).toBe(true);
  expect(app.texts()).toContain("还没有计划");
  expect(app.shows("id:profile-attention")).toBe(false);
  expect(app.shows("id:open-anatomy3d-attention")).toBe(false);
  expect(app.texts().some((text) => text.includes("在 3D 里看这"))).toBe(false);
  expect(app.shows("id:archive-section-gluteal-group")).toBe(false);

  // 我的数据仍在，空档案不妨碍编辑自己的数字。
  expect(app.shows("id:open-basics")).toBe(true);
  expect(app.shows("id:open-measurements")).toBe(true);
  expect(app.shows("id:open-training")).toBe(true);
  expect(app.shows("id:open-storage")).toBe(true);

  // 空档案也进 3D：没有异常可推，也不该把空档案显示成读失败。
  await app.press("id:open-anatomy3d");
  await app.waitFor("id:anatomy3d-title");
  expect(app.shows("id:anatomy3d-findings-warning")).toBe(false);
  await app.press("id:anatomy3d-back");
  await app.waitFor("id:findings-empty");

  await app.press("id:plan-start");
  await app.waitFor("id:new-conversation");
});

// 3D 身体图的 WebGL 画布不能在 headless 宿主里跑；这里只验原生页头与返回，
// 页面内部契约由 design/prototypes/anatomy-3d/verify.mjs 在 Edge 里覆盖。
test("3D 身体图：页头、重置与返回", async () => {
  const app = await seededApp();

  await app.press("id:open-anatomy3d");
  await app.waitFor("id:anatomy3d-title");
  expect(app.texts()).toContain("3D 身体图");
  expect(app.shows("id:anatomy3d-back")).toBe(true);
  expect(app.shows("id:anatomy3d-reset")).toBe(true);

  await app.waitUntil(
    () => app.shows("id:anatomy3d-webview") || app.shows("id:anatomy3d-error"),
  );
  await app.press("id:anatomy3d-reset");
  await app.press("id:anatomy3d-back");
  await app.waitFor("id:open-anatomy3d");
});

test("3D 身体图：档案读失败时仍能看模型，并可重试", async () => {
  const app = await seededApp();

  const failure = await Testing.failFindings(true);
  expect(failure).toBe(null);
  try {
    await app.press("id:open-anatomy3d");
    await app.waitFor("id:anatomy3d-title");
    await app.waitFor("id:anatomy3d-findings-warning");
    expect(app.texts()).toContain("档案没读出来，现在只显示解剖图");
    expect(app.shows("id:anatomy3d-findings-retry")).toBe(true);

    const cleared = await Testing.failFindings(false);
    expect(cleared).toBe(null);
    await app.press("id:anatomy3d-findings-retry");
    await app.waitUntil(() => !app.shows("id:anatomy3d-findings-warning"));
  } finally {
    await Testing.failFindings(false);
  }
});
