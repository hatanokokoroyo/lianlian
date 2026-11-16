import { beforeAll, expect, open, test } from "nsh/test";
import { Updates } from "lianlian/native";

import { ensureOnboarded, freshDatabase } from "./test-helpers";

beforeAll(freshDatabase);

test("跳过过的版本不再提示", async () => {
  await Updates.skip("9.9.9");

  const app = await open("./App.tsx", {
    modules: {
      "nsh/updater": {
        checkForUpdate: async () => ({
          version: "9.9.9",
          notes: "还是同一版",
          url: "https://example.com/same.apk",
          canInstall: false,
        }),
      },
    },
  });
  await ensureOnboarded(app);
  await app.wait(500);

  expect(app.shows("id:update-banner")).toBe(false);
});
