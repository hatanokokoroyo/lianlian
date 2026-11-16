import { beforeAll, expect, open, test } from "nsh/test";

import { ensureOnboarded, freshDatabase } from "./test-helpers";

beforeAll(freshDatabase);

test("检查失败时照常用应用，不弹任何更新提示", async () => {
  const app = await open("./App.tsx", {
    modules: {
      "nsh/updater": {
        checkForUpdate: async () => {
          throw new Error("offline");
        },
      },
    },
  });
  await ensureOnboarded(app);
  await app.wait(500);

  expect(app.shows("id:update-banner")).toBe(false);
  expect(app.shows("id:tab-today")).toBe(true);
});
