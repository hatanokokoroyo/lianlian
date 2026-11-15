import { expect, open, test } from "nsh/test";

// 今日页的清单不是写死在 TSX 里的：它从 Rust 的 redb 库读出来（`Today.plan()`），
// 所以这条测试同时钉住「类型生成 + 原生模块 + 库读写」三件事。
test("今日清单来自库里的训练日", async () => {
  const app = await open("./App.tsx");
  // 读库是异步的（resource），等第一条动作出现再断言。
  await app.waitFor("id:exercise-clamshell");

  expect(app.texts()).toContain("臀腿日");
  expect(app.texts()).toContain("还差 4 项");

  // 清单顺序是库里的顺序：臀桥在最前，蚌式开合在单腿臀桥之前。
  const rows = app.texts();
  const glute = rows.indexOf("臀桥");
  const clamshell = rows.indexOf("蚌式开合");
  const singleLeg = rows.indexOf("单腿臀桥");
  expect(glute).toBeLessThan(clamshell);
  expect(clamshell).toBeLessThan(singleLeg);

  await app.press("id:exercise-clamshell");
  expect(app.texts()).toContain("还差 3 项");
  expect(app.texts()).toContain("25%");
});