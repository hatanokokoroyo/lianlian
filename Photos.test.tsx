import { beforeAll, expect, open, test } from "nsh/test";

import { ensureOnboarded, freshDatabase, replyWith, setApiKey } from "./test-helpers";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
beforeAll(freshDatabase);

// 一张 1×1 的 PNG：选择器把用户挑的文件原样交给 app（缩放由平台自己做）。
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  ),
  (char) => char.charCodeAt(0),
);

// #8：选一张照片 → 落私有目录 → 当轮随消息发给模型 → 会话里能看能点开。
// 全部离线：网络走 `open` 的桩，选图走 `onPick` 的假选择器。
test("照片：选图、发给模型、会话里留着，取消不留垃圾", async () => {
  const app = await open("./App.tsx", {
    network: {
      "POST https://api.deepseek.com/responses": replyWith("看到了：站姿还行，膝盖有点锁死。"),
    },
  });
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");
  await setApiKey(app);

  await app.press("id:tab-conversations");
  await app.waitFor("id:new-conversation");
  await app.press("id:new-conversation");
  await app.waitFor("id:message-input");

  // 选择器把长边缩到 2048、只让挑一张。
  app.onPick(() => [{ name: "stance.png", type: "image/png", data: PNG }]);
  await app.press("id:pick-photo");
  await app.waitFor("id:photo-pending");
  const picks = app.picks();
  expect(picks.length).toBe(1);
  expect(picks[0].maxDimension).toBe(2048);
  expect(picks[0].limit).toBe(1);

  const draft = `站姿拍照 ${Date.now() % 10000}`;
  await app.type("id:message-input", draft);
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("站姿还行")));

  // 当轮请求里带的是照片的块，不是纯文本。
  const requests = app.requests();
  const body = JSON.parse(requests[requests.length - 1].body ?? "{}");
  const turn = body.input[body.input.length - 1];
  const parts = turn.content as { type: string; text?: string; image_url?: string }[];
  expect(Array.isArray(parts)).toBe(true);
  expect(parts[0].type).toBe("input_text");
  expect(parts[0].text).toContain(draft);
  expect(parts[1].type).toBe("input_image");
  expect((parts[1].image_url ?? "").startsWith("data:image/png;base64,")).toBe(true);

  // 会话里照片是可点的缩略图；点开有大图，能关掉。
  await app.waitFor("id:message-photo-1");
  await app.press("id:message-photo-1");
  await app.waitFor("id:photo-preview");
  await app.press("id:close-photo-preview");

  // 重开会话（重新从库里读）：照片还在。
  await app.press("id:back");
  await app.waitFor("id:new-conversation");
  await app.press(`text:${draft}`);
  await app.waitFor("id:message-photo-1");

  // 取消选择：不留下待发照片，也不新增库里的照片。
  app.onPick(() => null);
  await app.press("id:pick-photo");
  await app.wait(200);
  expect(app.shows("id:photo-pending")).toBe(false);
  expect(app.picks().length).toBe(2);
});

// 只发照片、不写字也是一条消息（拍照本身就是一句话）。
test("照片：不写字也能发，历史轮不重发原图", async () => {
  const app = await open("./App.tsx", {
    network: {
      "POST https://api.deepseek.com/responses": replyWith("看到了。"),
    },
  });
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");
  await setApiKey(app);

  await app.press("id:tab-conversations");
  await app.waitFor("id:new-conversation");
  await app.press("id:new-conversation");
  await app.waitFor("id:message-input");

  app.onPick(() => [{ name: "knee.png", type: "image/png", data: PNG }]);
  await app.press("id:pick-photo");
  await app.waitFor("id:photo-pending");
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("看到了")));

  // 第二轮：历史里那张照片只留占位，不重发 base64。
  await app.type("id:message-input", "再看一眼");
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("再看一眼")));
  const requests = app.requests();
  const body = JSON.parse(requests[requests.length - 1].body ?? "{}");
  const historyPhotoTurns = (body.input as { content: unknown }[]).filter(
    (item) => typeof item.content === "string" && item.content.includes("[用户发了一张照片]"),
  );
  expect(historyPhotoTurns.length).toBe(1);
  const raw = JSON.stringify(body);
  expect(raw.includes("data:image/png;base64,")).toBe(false);
});
