import { beforeAll, expect, open, test } from "nsh/test";
import { Days } from "lianlian/native";

import { ensureOnboarded, freshDatabase, replyWith, setApiKey } from "./test-helpers";
import { todayIso } from "./ui/dates";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
beforeAll(freshDatabase);

const evidence = {
  user_said: "单腿站的时候骨盆会掉",
  test_and_feedback: "单腿站立 30 秒：左侧骨盆掉下去",
  reasoning: "左侧臀中肌支撑不住，骨盆下沉",
  uncertainty: "没排除脚踝",
};

/** 一轮里：查依据 → 写判定 → 排一份每天都练的计划（今天必定有清单）。 */
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
            values: { tension: "weak" },
            evidence,
          }),
        },
        {
          type: "function_call",
          call_id: "call_plan",
          name: "generate_plan",
          arguments: JSON.stringify({
            frequency: { unit: "per-week", count: 7 },
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

// #14：今日页就是今天的清单；勾选即时落库（重开仍在）；全部勾完落为已完成并给反馈；
// 部分完成仍是计划中；没有计划时是引导而不是空白。
test("今日页：清单、勾选、打卡、重开仍在与没有计划时的引导", async () => {
  const responses: unknown[] = [planTurn(), replyWith("计划排好了：每天两个动作。")];
  const app = await open("./App.tsx", {
    network: {
      "POST https://api.deepseek.com/responses": () => responses.shift() as never,
    },
  });
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");

  // 还没有计划：今日页给引导，不是空白。
  await app.waitFor("id:today-ready-title");
  expect(app.texts()).toContain("可以开始首次评估");

  await setApiKey(app);
  await app.press("id:tab-conversations");
  await app.waitFor("id:new-conversation");
  await app.press("id:new-conversation");
  await app.waitFor("id:message-input");
  await app.type("id:message-input", "帮我排计划");
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("计划排好了")));

  // 今日页：今天的清单在，进度 0/2，状态是计划中。
  await app.press("id:tab-today");
  await app.waitFor("id:exercise-gluteus-medius-0");
  expect(app.texts()).toContain("臀桥 · 3×10");
  expect(app.texts()).toContain("蚌式开合 · 3×12");
  expect(app.texts()).toContain("0/2 项");
  expect(app.texts()).toContain("计划中");

  // 勾一项：进度可见，日状态仍是计划中。
  await app.press("id:exercise-gluteus-medius-0");
  await app.waitUntil(() => app.texts().some((text) => text.includes("1/2 项")));
  expect(app.texts()).toContain("计划中");
  expect(app.texts()).toContain("还差 1 项，勾完就是今天的打卡。");
  expect(app.shows("id:checkin")).toBe(false);

  // 杀掉进程重开：勾过的还在库里。
  const reopened = await open("./App.tsx");
  await reopened.waitFor("id:exercise-gluteus-medius-0");
  expect(reopened.texts()).toContain("1/2 项");
  expect(reopened.texts()).toContain("计划中");

  // 勾完最后一项：落为已完成，并给出明确的打卡反馈。
  await reopened.press("id:exercise-gluteus-medius-1");
  await reopened.waitFor("id:checkin");
  expect(reopened.texts()).toContain("今天这笔账结清了");
  expect(reopened.texts()).toContain("已完成");
  expect(reopened.texts()).toContain("2/2 项");

  // 当天内取消勾选：退回计划中（契约 §6.4）。
  await reopened.press("id:exercise-gluteus-medius-1");
  await reopened.waitUntil(() => reopened.texts().some((text) => text.includes("1/2 项")));
  expect(reopened.texts()).toContain("计划中");
  expect(reopened.shows("id:checkin")).toBe(false);
});

/** 本地的今天 + N 天，`YYYY-MM-DD`。 */
function dayFromToday(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 每两天练一次：今天必定有课，明天必定空档。 */
function everyOtherDayPlanTurn() {
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
            values: { tension: "weak" },
            evidence,
          }),
        },
        {
          type: "function_call",
          call_id: "call_plan",
          name: "generate_plan",
          arguments: JSON.stringify({
            frequency: { unit: "every-n-days", count: 2 },
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

async function openWithPlan() {
  const responses: unknown[] = [
    everyOtherDayPlanTurn(),
    replyWith("计划排好了：两天一次。"),
  ];
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
  await app.type("id:message-input", "帮我排计划");
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("计划排好了")));
  await app.press("id:tab-today");
  await app.waitFor("id:exercise-gluteus-medius-0");
  return app;
}

// #15：跳过单个动作不挡打卡；整天推迟到空档日，原日变休息日，目标日接管快照；
// 目标日已有训练时给明确提示。
test("今日页：跳过一项与整天推迟", async () => {
  await freshDatabase();
  const app = await openWithPlan();

  // 跳过第一项：记录可见，但仍不能打卡。
  await app.press("id:skip-exercise");
  await app.waitFor("id:skip-option-0");
  await app.press("id:skip-option-0");
  await app.waitUntil(() => app.texts().some((text) => text.includes("已跳过")));
  expect(app.texts()).toContain("计划中");
  expect(app.shows("id:checkin")).toBe(false);

  // 勾完另一项：跳过不挡打卡。
  await app.press("id:exercise-gluteus-medius-1");
  await app.waitFor("id:checkin");
  expect(app.texts()).toContain("已完成");
  expect(app.texts().some((text) => text.includes("1 项已跳过"))).toBe(true);
});

test("今日页：整天推迟到空档日，已有训练的目标日会被拒绝", async () => {
  await freshDatabase();
  const app = await openWithPlan();

  const today = todayIso();
  const tomorrow = dayFromToday(1);
  const trainingDayAfterTomorrow = dayFromToday(2);

  await app.press("id:postpone");
  await app.waitFor("id:postpone-target");
  expect(app.value("id:postpone-target")).toBe(tomorrow);

  // 目标日已经有训练：明确提示，不静默叠加。
  await app.clear("id:postpone-target");
  await app.type("id:postpone-target", trainingDayAfterTomorrow);
  await app.press("id:postpone-confirm");
  await app.waitFor("id:postpone-error");
  expect(app.texts().some((text) => text.includes("已经有训练"))).toBe(true);

  // 改到空档日：今天变休息，明天接管动作快照。
  await app.clear("id:postpone-target");
  await app.type("id:postpone-target", tomorrow);
  await app.press("id:postpone-confirm");
  await app.waitFor("id:today-rest-title");
  expect(app.texts()).toContain("今天休息");

  const tomorrowView = await Days.day(today, tomorrow);
  expect(tomorrowView?.postponedFrom).toBe(today);
  expect(tomorrowView?.exercises.length).toBe(2);
  expect(await Days.day(today, today)).toBeNull();
});
