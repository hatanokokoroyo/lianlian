import { beforeAll, expect, open, test } from "nsh/test";

import { ensureOnboarded, freshDatabase } from "./test-helpers";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
beforeAll(freshDatabase);

// 引导也是页面栈：第 2 步按返回应回第 1 步，而不是退出应用。
test("系统返回键在引导第 2 步回到第 1 步", async () => {
  await freshDatabase();
  const app = await open("./App.tsx");
  await app.waitFor("id:onboarding-next");

  await app.type("id:basics-age", "32");
  await app.press("id:onboarding-next");
  await app.waitFor("id:training-days-3");

  await app.back();

  await app.waitFor("id:basics-age");
  expect(app.shows("id:training-days-3")).toBe(false);
  expect(app.texts()).toContain("先认识你一下");
});

// 系统返回键应当沿着页面栈回退一级，而不是退出应用。
test("系统返回键从测量详情回到档案根页", async () => {
  const app = await open("./App.tsx");
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");

  await app.press("id:tab-profile");
  await app.waitFor("id:open-measurements");
  await app.press("id:open-measurements");
  await app.waitFor("id:add-measurement");

  await app.back();

  await app.waitFor("id:save-basics");
  expect(app.shows("id:add-measurement")).toBe(false);
});

test("系统返回键从日详情回到月历，再从月历根部回到今日", async () => {
  const app = await open("./App.tsx");
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");

  await app.press("id:tab-calendar");
  await app.waitFor("id:day-1");
  await app.press("id:day-1");
  await app.waitFor("id:day-detail");

  await app.back();
  await app.waitFor("id:prev-month");
  expect(app.shows("id:day-detail")).toBe(false);

  await app.back();
  await app.waitFor("id:today-ready-title");
});

test("系统返回键从聊天回到会话列表", async () => {
  const app = await open("./App.tsx");
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");

  await app.press("id:tab-conversations");
  await app.waitFor("id:new-conversation");
  await app.press("id:new-conversation");
  await app.waitFor("id:message-input");
  // 聊天是整屏详情页：底部 Tab 让位给输入条。
  expect(app.shows("id:tab-today")).toBe(false);

  await app.back();
  await app.waitFor("id:new-conversation");
  expect(app.shows("id:tab-today")).toBe(true);

  await app.waitFor("id:new-conversation");
  expect(app.shows("id:message-input")).toBe(false);
});
