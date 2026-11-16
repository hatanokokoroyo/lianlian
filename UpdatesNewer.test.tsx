import { beforeAll, expect, open, test } from "nsh/test";
import { Updates } from "lianlian/native";

import { ensureOnboarded, freshDatabase } from "./test-helpers";

beforeAll(freshDatabase);

test("跳过低版本后，出现更高版本仍然提示", async () => {
  await Updates.skip("9.9.9");

  const app = await open("./App.tsx", {
    modules: {
      "nsh/updater": {
        checkForUpdate: async () => ({
          version: "9.9.10",
          notes: "又修了一版",
          url: "https://example.com/newer.apk",
          canInstall: false,
        }),
      },
    },
  });
  await ensureOnboarded(app);

  await app.waitFor("id:update-banner");
  expect(app.texts()).toContain("新版本 9.9.10");
});
