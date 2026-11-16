import { beforeAll, expect, open, test } from "nsh/test";
import { Plans, Testing } from "lianlian/native";

import { ensureOnboarded, freshDatabase, replyWith, setApiKey } from "./test-helpers";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
beforeAll(freshDatabase);

/** 四段依据：写判定时要齐。 */
const evidence = {
  user_said: "单腿站的时候骨盆会掉",
  test_and_feedback: "单腿站立 30 秒：左侧骨盆掉下去",
  reasoning: "左侧臀中肌支撑不住，骨盆下沉",
  uncertainty: "没排除脚踝",
};

/** 一轮里：查依据 → 写一条判定 → 用它排一份计划。 */
function planTurn() {
  return {
    status: 200,
    body: {
      status: "completed",
      output: [
        {
          type: "function_call",
          call_id: "call_search",
          name: "search_evidence",
          arguments: JSON.stringify({ site: "gluteus-medius" }),
        },
        {
          type: "function_call",
          call_id: "call_record",
          name: "record_finding",
          arguments: JSON.stringify({
            site: "gluteus-medius",
            side: "left",
            confidence: 78,
            values: { tension: "weak", stability: "poor" },
            evidence,
          }),
        },
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

// #12：计划在档案页可见，每个动作能点回它的判定；重新生成是新版本、旧版本只读可查；
// 复查日到了今日页顶部提示。
test("计划生成：档案页可见、动作点回判定、版本可查、复查日到期有提示", async () => {
  const responses: unknown[] = [planTurn(), replyWith("计划排好了：一周三次，第四周复查。")];
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
  await app.type("id:message-input", "帮我排个计划");
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("计划排好了")));

  // 档案页可见：频次、动作与处方。
  await app.press("id:tab-profile");
  await app.waitFor("id:plan-card");
  expect(app.texts().some((text) => text.includes("第 1 版 · 每周 3 次"))).toBe(true);
  expect(app.texts()).toContain("臀桥 · 3×10");
  expect(app.texts()).toContain("蚌式开合 · 3×12");
  expect(app.texts().some((text) => text.includes("来自「臀中肌左」的判定"))).toBe(true);

  // 每个动作能点回它对应的判定：展开那张卡并打开时间线。
  await app.press("id:plan-exercise-0");
  await app.waitFor("id:timeline-gluteus-medius-left");
  expect(app.texts().some((text) => text.includes("张力 弱"))).toBe(true);
  expect(app.texts().some((text) => text.includes("单腿站立 30 秒"))).toBe(true);

  // 旧版本只读可查：现在只有一版，列表说的是「生效」。
  await app.press("id:plan-versions");
  await app.waitFor("id:plan-versions-list");
  expect(app.texts().some((text) => text.includes("（生效）"))).toBe(true);

  // 复查日的数据判断：给未来的日期是「到了」，给过去的日期是「没到」。
  const future = await Plans.load("2099-01-01");
  expect(future.active?.reviewDue).toBe(true);
  expect(future.active?.version).toBe(1);
  const past = await Plans.load("2020-01-01");
  expect(past.active?.reviewDue).toBe(false);

  // 复查日到期：今日页顶部出现提示（把生效计划的复查日挪到昨天）。
  const expired = await Testing.expirePlan();
  expect(expired).toBe(null);
  await app.press("id:tab-today");
  await app.waitFor("id:today-review-due");
  expect(app.texts().some((text) => text.includes("复查日到了"))).toBe(true);
});
