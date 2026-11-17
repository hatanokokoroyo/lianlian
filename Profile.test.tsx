import { beforeAll, expect, open, test } from "nsh/test";

import { ensureOnboarded, freshDatabase } from "./test-helpers";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
beforeAll(freshDatabase);

// 训练条件四项齐全时，档案页只报「齐全」，不能再同时提示缺项。
test("训练条件齐全时档案页不提示缺项", async () => {
  const app = await open("./App.tsx");
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");

  await app.press("id:tab-profile");
  await app.waitFor("id:profile-training");

  expect(app.texts()).toContain("齐全");
  expect(app.texts()).toContain("四项都填了，agent 可以据此排计划。");
  expect(app.texts().some((text) => text.includes("缺这几项"))).toBe(false);
  expect(app.shows("id:profile-training-missing")).toBe(false);
});
