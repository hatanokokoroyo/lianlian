import { beforeAll, expect, open, test } from "nsh/test";

import {
  ensureOnboarded,
  freshDatabase,
  replyWith,
  setApiKey,
} from "./test-helpers";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
beforeAll(freshDatabase);

// #6：会话能新建、续聊、归档、删除；消息按序落库，重开 app 还在。
// 回复走 #7 的网关（这里用 nsh 的 network 桩，不联网）。
test("会话新建、续聊、归档、删除与重开仍在", async () => {
  const network = {
    "POST https://api.deepseek.com/responses": replyWith("先做一个踝背屈测试，看看脚跟会不会抬。"),
  };
  const app = await open("./App.tsx", { network });
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");
  await setApiKey(app);

  await app.press("id:tab-conversations");
  await app.waitFor("id:new-conversation");
  const title = `右膝为什么响 ${Date.now() % 10000}`;

  // 新建并说第一句：用户那句与回复都按序出现。
  await app.press("id:new-conversation");
  await app.waitFor("id:message-input");
  await app.type("id:message-input", title);
  await app.press("id:send");
  await app.waitFor("id:send");
  await app.waitUntil(() =>
    app.texts().some((text) => text.includes("先做一个踝背屈测试")),
  );
  expect(app.texts().some((text) => text.includes(title))).toBe(true);

  // 续聊：同一个会话里再发一句，历史还在。
  await app.type("id:message-input", "还有上下楼梯时");
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("还有上下楼梯时")));
  expect(app.texts().some((text) => text.includes(title))).toBe(true);

  // 回到列表：标题取自第一句，并有摘要。
  await app.press("id:back");
  await app.waitFor("id:new-conversation");
  expect(app.texts().some((text) => text.includes(title))).toBe(true);

  // 归档：从默认列表消失，折叠区能找到。
  await app.press(`label:会话菜单：${title}`);
  await app.press(`label:归档：${title}`);
  await app.wait(200);
  await app.waitFor("id:archived-toggle");
  await app.press("id:archived-toggle");
  await app.waitFor("text:收起已归档 1 个");
  await app.press(`label:会话菜单：${title}`);
  await app.waitFor(`label:取消归档：${title}`);

  // 取消归档后又回到默认列表。
  await app.press(`label:取消归档：${title}`);
  await app.wait(200);
  expect(app.texts().some((text) => text.includes(title))).toBe(true);

  // 重开 app：消息还在。
  const reopened = await open("./App.tsx", { network });
  await reopened.waitUntil(
    () => reopened.shows("id:onboarding-next") || reopened.shows("id:tab-today"),
  );
  await ensureOnboarded(reopened);
  await reopened.press("id:tab-conversations");
  await reopened.waitFor("id:new-conversation");
  await reopened.press(`text:${title}`);
  await reopened.waitFor("id:message-input");
  expect(reopened.texts().some((text) => text.includes(title))).toBe(true);
  expect(reopened.texts().some((text) => text.includes("还有上下楼梯时"))).toBe(true);

  // 删除：只删这个会话，确认后从列表消失。
  await reopened.press("id:back");
  await reopened.waitFor("id:new-conversation");
  await reopened.press(`label:会话菜单：${title}`);
  await reopened.press(`label:删除：${title}`);
  await reopened.waitFor(`label:确认删除：${title}`);
  await reopened.press(`label:确认删除：${title}`);
  await reopened.wait(200);
  expect(reopened.texts().some((text) => text.includes(title))).toBe(false);

  const third = await open("./App.tsx", { network });
  await third.waitUntil(() => third.shows("id:onboarding-next") || third.shows("id:tab-today"));
  await ensureOnboarded(third);
  await third.press("id:tab-conversations");
  await third.waitFor("id:new-conversation");
  expect(third.texts().some((text) => text.includes(title))).toBe(false);
});
