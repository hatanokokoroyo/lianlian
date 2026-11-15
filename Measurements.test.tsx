import { expect, open, test } from "nsh/test";

import { deleteAllMeasurements, ensureOnboarded } from "./test-helpers";

// #5：每次记录都追加一条带时间的测量，折线图跟着变；单条可删，删完回到引导态；
// 基本属性里的「当前体重」始终是最新一条测量；重开 app 仍在。
test("测量追加入库、折线图重画、单条可删、当前值来自最新一条", async () => {
  const app = await open("./App.tsx");
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");

  await app.press("id:tab-profile");
  await app.waitFor("id:open-measurements");
  await app.press("id:open-measurements");
  await app.waitFor("id:add-measurement");

  // 先清干净（两种都清），空态应当给引导而不是空白坐标轴。
  await deleteAllMeasurements(app);
  await app.press("id:measurement-kind-height");
  await deleteAllMeasurements(app);
  await app.press("id:measurement-kind-weight");
  await app.waitFor("id:measurement-empty-weight");
  expect(app.texts().some((text) => text.includes("还没有体重记录"))).toBe(true);
  expect(app.shows("id:weight-chart")).toBe(false);

  // 第一次记录：只有一个点也能读（当前值 + 一条记录）。
  await app.type("id:measurement-value", "62.4");
  await app.press("id:add-measurement");
  await app.waitFor("id:weight-chart");
  expect(app.texts()).toContain("62.4");

  // 第二次记录：不覆盖旧值，差值是首尾之差。
  await app.type("id:measurement-value", "63.1");
  await app.press("id:add-measurement");
  await app.wait(200);
  expect(app.texts()).toContain("63.1");
  expect(app.texts()).toContain("62.4 kg");
  expect(app.texts()).toContain("+0.7 kg");

  // 删掉最新那条：折线图立即重画，当前值退回上一条。
  await app.press("text:删除 >> nth=0");
  await app.waitFor("text:确认删除");
  await app.press("text:确认删除");
  await app.wait(200);
  expect(app.texts()).not.toContain("63.1");
  expect(app.texts()).toContain("62.4");

  // 基本属性里的当前体重来自最新一条测量（这里只剩 62.4）。
  await app.press("id:measurements-back");
  await app.waitFor("id:save-basics");
  // 当前值来自最新一条测量，不是可编辑的草稿。
  expect(app.texts()).toContain("当前 — cm · 62.4 kg");

  // 重开 app：测量还在库里。
  const reopened = await open("./App.tsx");
  await reopened.waitUntil(() => reopened.shows("id:onboarding-next") || reopened.shows("id:tab-today"));
  await ensureOnboarded(reopened);
  await reopened.waitFor("id:tab-today");
  await reopened.press("id:tab-profile");
  await reopened.waitFor("id:open-measurements");
  expect(reopened.texts()).toContain("当前 — cm · 62.4 kg");
  await reopened.press("id:open-measurements");
  await reopened.waitFor("id:weight-chart");
  expect(reopened.texts()).toContain("62.4");
});
