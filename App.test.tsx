import { expect, open, test } from "nsh/test";

// 今日页的清单不是写死在 TSX 里的：它从 Rust 的 redb 库读出来（`Today.plan()`），
// 所以这条测试同时钉住「类型生成 + 原生模块 + 库读写」三件事。
test("今日清单来自库里的训练日", async () => {
  const app = await open("./App.tsx");
  expect(app.texts()).toContain("臀腿日");
  expect(app.texts()).toContain("蚌式开合");
  expect(app.texts()).toContain("还差 4 项");

  await app.press("id:exercise-clamshell");
  expect(app.texts()).toContain("还差 3 项");
  expect(app.texts()).toContain("25%");
});