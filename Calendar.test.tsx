import { beforeAll, expect, open, test } from "nsh/test";
import { Today } from "lianlian/native";

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

/** 本地的今天 + N 天。 */
function dateFromToday(offset: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date;
}

function isoOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthLabel(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function cellLabel(date: Date, status: string, isToday: boolean): string {
  return `label:${date.getMonth() + 1}月${date.getDate()}日 ${status}${isToday ? "，今天" : ""}`;
}

/** 每两天练一次：今天必定有课，明天必定空档，后天又有课。 */
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

// #16：五种格子、今天标记、未来只显示计划中、点任意一天看只读详情、翻月。
test("月历：今天标记、未来计划中、休息日与只读日详情", async () => {
  await freshDatabase();
  const app = await openWithPlan();
  const today = new Date();
  const tomorrow = dateFromToday(1);
  const dayAfter = dateFromToday(2);

  await app.press("id:tab-calendar");
  await app.waitFor("id:calendar-legend");

  // 今天：计划中 + 独立描边标记。
  expect(app.shows(cellLabel(today, "计划中", true))).toBe(true);
  // 未来：只有计划中（后天是训练日），明天是休息日。
  expect(app.shows(cellLabel(dayAfter, "计划中", false))).toBe(true);
  expect(app.shows(cellLabel(tomorrow, "休息日", false))).toBe(true);

  // 点今天：日详情只读显示动作快照。
  await app.press(`id:day-${today.getDate()}`);
  await app.waitFor("id:day-detail");
  expect(app.texts()).toContain("计划中");
  expect(app.texts().some((text) => text.includes("当天动作快照 · 只读"))).toBe(true);
  expect(app.texts().some((text) => text.includes("臀桥 · 3×10"))).toBe(true);
  expect(app.texts().some((text) => text.includes("蚌式开合 · 3×12"))).toBe(true);
  await app.press("id:back");
  await app.waitFor("id:calendar-legend");

  // 点休息日：说清楚没有安排，而不是空白。
  if (tomorrow.getMonth() !== today.getMonth()) {
    await app.press("id:next-month");
    await app.waitFor(cellLabel(tomorrow, "休息日", false));
  }
  await app.press(`id:day-${tomorrow.getDate()}`);
  await app.waitFor("id:day-detail-rest");
  expect(app.texts()).toContain("这天没有安排");
  await app.press("id:back");

  // 跨月翻页：上个月标题变化，回来仍是本月。
  await app.press("id:prev-month");
  await app.wait(200);
  const previous = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  expect(app.texts()).toContain(monthLabel(previous));
  await app.press("id:next-month");
  await app.wait(200);
  expect(app.texts()).toContain(monthLabel(today));
});

// 跨天结算后的「未完成」格子可以补勾；补完转回已完成。
test("月历：跨天结算为未完成，补勾后变成已完成", async () => {
  await freshDatabase();
  const app = await openWithPlan();
  const today = new Date();
  const tomorrowIso = isoOf(dateFromToday(1));

  // 把明天当作「今天」读一次 = 模拟过了自然日 00:00。
  const midnight = await Today.load(tomorrowIso);
  expect(midnight.day).toBeNull();

  await app.press("id:tab-calendar");
  await app.waitFor("id:calendar-legend");
  expect(app.shows(cellLabel(today, "未完成", true))).toBe(true);

  await app.press(`id:day-${today.getDate()}`);
  await app.waitFor("id:make-up");
  await app.press("id:make-up");
  await app.waitFor("id:makeup-exercise-0");
  await app.press("id:makeup-exercise-0");
  await app.waitFor("id:makeup-exercise-1");
  await app.press("id:makeup-exercise-1");
  await app.waitUntil(() => app.texts().some((text) => text.includes("已完成")));
  expect(app.shows("id:make-up")).toBe(false);

  await app.press("id:back");
  await app.waitFor("id:calendar-legend");
  expect(app.shows(cellLabel(today, "已完成", true))).toBe(true);
});

// 整天推迟：原日格子显示「已推迟」，目标日接管快照并在日详情里说明来源。
test("月历：原日标为已推迟，目标日接管动作快照", async () => {
  await freshDatabase();
  const app = await openWithPlan();
  const todayIsoValue = todayIso();
  const today = new Date();
  const tomorrow = dateFromToday(1);

  const error = await Today.postpone(todayIsoValue, isoOf(tomorrow));
  expect(error.error).toBeNull();

  await app.press("id:tab-calendar");
  await app.waitFor("id:calendar-legend");
  expect(app.shows(cellLabel(today, "已推迟", true))).toBe(true);

  await app.press(`id:day-${today.getDate()}`);
  await app.waitFor("id:day-detail-postponed");
  expect(app.texts().some((text) => text.includes("这一天推迟了"))).toBe(true);
  await app.press("id:back");

  if (tomorrow.getMonth() !== today.getMonth()) {
    await app.press("id:next-month");
    await app.waitFor(cellLabel(tomorrow, "计划中", false));
  }
  await app.press(`id:day-${tomorrow.getDate()}`);
  await app.waitFor("id:day-detail-state");
  expect(app.texts().some((text) => text.includes("推迟过来"))).toBe(true);
  expect(app.texts().some((text) => text.includes("臀桥 · 3×10"))).toBe(true);
});
