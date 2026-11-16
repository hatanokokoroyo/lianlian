import { beforeAll, expect, open, test } from "nsh/test";
import { Updates } from "lianlian/native";

import { ensureOnboarded, freshDatabase } from "./test-helpers";

// `nsh test` 里同一个入口只有第一次 `open` 会拿到模块替身，
// 所以「更新提示」的每种情形各自占一个文件，每个文件只开一次应用。
beforeAll(freshDatabase);

const url =
  "https://github.com/hatanokokoroyo/lianlian/releases/download/v9.9.9/lianlian-9.9.9.apk";

test("有新版本时提示版本号与说明，能去下载，也能以后再说", async () => {
  const app = await open("./App.tsx", {
    modules: {
      "nsh/updater": {
        checkForUpdate: async () => ({
          version: "9.9.9",
          notes: "修好了打卡日期\n第二行不该显示",
          url,
          canInstall: false,
        }),
      },
    },
  });
  await ensureOnboarded(app);

  await app.waitFor("id:update-banner");
  expect(app.texts()).toContain("新版本 9.9.9");
  expect(app.texts()).toContain("修好了打卡日期");
  expect(app.shows("text:第二行不该显示")).toBe(false);

  await app.press("id:update-download");
  expect(app.openedUrls()).toContain(url);

  await app.press("id:update-later");
  await app.wait(500);
  expect(await Updates.skipped()).toBe("9.9.9");
  expect(app.shows("id:update-banner")).toBe(false);
});
