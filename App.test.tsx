import { beforeAll, expect, open, test } from "nsh/test";

import { freshDatabase } from "./test-helpers";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
beforeAll(freshDatabase);

// 冷启动的主干：空档案 → 引导三步 → 今日页不再空白 → 档案可改 → 缺项会提示 →
// 重开 app 数据还在。数据真的落在 redb 里（Rust 侧校验），不是内存里过一遍。
test("首启引导、档案可改、缺项提示与重开仍在", async () => {
  const app = await open("./App.tsx");

  // 空档案启动进引导，而不是空白页。
  await app.waitFor("id:onboarding-next");
  expect(app.texts()).toContain("先认识你一下");

  // 第一步：基本属性 + 一条基础疾病。
  await app.press("id:basics-sex-female");
  await app.type("id:basics-age", "32");
  await app.type("id:basics-height", "168");
  await app.type("id:basics-weight", "62.4");
  await app.type("id:condition-input", "右侧踝关节扭伤过两次");
  await app.press("id:condition-add");
  expect(app.texts()).toContain("右侧踝关节扭伤过两次");

  await app.press("id:onboarding-next");
  await app.waitFor("id:training-days-3");
  expect(app.texts()).toContain("你平时怎么练");

  // 第二步：训练条件四项都填。
  await app.press("id:training-days-3");
  await app.press("id:training-minutes-30");
  await app.press("id:training-place-home");
  await app.press("id:training-equipment-band");
  await app.press("id:onboarding-next");

  // 第三步：走完引导。
  await app.waitFor("id:onboarding-step-3");
  expect(app.texts()).toContain("开始第一次评估");
  await app.press("id:onboarding-next");

  // 今日页不再是空白：训练条件齐了，进入「可以开始首次评估」。
  await app.waitFor("id:today-ready-title");
  expect(app.texts()).toContain("可以开始首次评估");

  // 档案页能看到刚填的东西，并且可以改。
  await app.press("id:tab-profile");
  await app.waitFor("id:save-basics");
  expect(app.texts()).toContain("右侧踝关节扭伤过两次");
  expect(app.texts()).toContain("齐全");

  await app.clear("id:basics-age");
  await app.type("id:basics-age", "33");
  await app.press("id:save-basics");
  // 保存会触发 refetch；等它落定再继续（成功提示是一次性的，不作为断言对象）。
  await app.wait(300);

  // 把器械取消掉：训练条件变成不齐全，今日页要提示。
  await app.press("id:training-equipment-band");
  await app.press("id:save-training");
  await app.waitFor("id:profile-training-missing");
  expect(app.texts()).toContain("不齐全");

  await app.press("id:tab-today");
  await app.waitFor("id:today-needs-training-title");
  expect(app.texts()).toContain("计划前需要先补训练条件");
  // 缺项清单在提示语里（一句话），用包含判断而不是整串相等。
  expect(app.texts().some((text) => text.includes("手边有什么"))).toBe(true);

  // 重开 app：引导不再出现（引导标记落库了），改过的年龄也还在。
  const reopened = await open("./App.tsx");
  await reopened.waitFor("id:today-needs-training-title");
  await reopened.press("id:tab-profile");
  await reopened.waitFor("id:save-basics");
  // 输入框里的值不进 texts()，按 value 断言；这一步同时验证它来自库而不是内存。
  expect(reopened.value("id:basics-age")).toBe("33");
  expect(reopened.texts()).toContain("右侧踝关节扭伤过两次");

  // 改而不存：再开一次应当还是库里的 33，说明编辑没有悄悄漏进存储。
  await reopened.clear("id:basics-age");
  await reopened.type("id:basics-age", "44");
  const third = await open("./App.tsx");
  await third.waitFor("id:today-needs-training-title");
  await third.press("id:tab-profile");
  await third.waitFor("id:save-basics");
  expect(third.value("id:basics-age")).toBe("33");
});
