import { expect, open, test } from "nsh/test";

import { ensureOnboarded, replyWith, setApiKey } from "./test-helpers";

// #7：三类错误态各有明确出路；输入不丢；超长自动裁剪重发一次并提示。
// 全部离线：网络由 `open` 的 `network` 桩替代，真实响应语料在 Rust 测试里回放。

test("没填 key 时直接去设置，字不丢，换好 key 后能发出去", async () => {
  const app = await open("./App.tsx", {
    network: {
      "POST https://api.deepseek.com/responses": replyWith("好，先说左腿的感觉。"),
    },
  });
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");

  // 先把可能残留的 key 清掉（同一进程里的测试共用一个库）。
  await app.press("id:tab-profile");
  await app.waitFor("id:open-settings");
  await app.press("id:open-settings");
  await app.waitFor("id:reveal-key");
  if (app.shows("id:clear-api-key")) {
    await app.press("id:clear-api-key");
    await app.wait(200);
  }
  await app.press("id:back");

  await app.press("id:tab-conversations");
  await app.waitFor("id:new-conversation");
  await app.press("id:new-conversation");
  await app.waitFor("id:message-input");
  const draft = `左膝有点紧 ${Date.now() % 10000}`;
  await app.type("id:message-input", draft);
  await app.press("id:send");

  // 配置问题：只有「去设置」，没有「重试」；打了一半的字还在。
  await app.waitFor("id:open-settings");
  expect(app.shows("id:retry-send")).toBe(false);
  expect(app.value("id:message-input")).toBe(draft);

  // 去设置填 key，回来接着发。
  await app.press("id:open-settings");
  await app.waitFor("id:reveal-key");
  await app.press("id:reveal-key");
  await app.type("id:api-key", "sk-test-lianlian");
  await app.press("id:save-api-key");
  await app.waitFor("id:settings-message");
  await app.press("id:back");

  await app.press("id:tab-conversations");
  await app.waitFor("id:new-conversation");
  await app.press("text:新会话 >> nth=0");
  await app.waitFor("id:message-input");
  // 草稿按会话缓存：换屏再回来还在。
  expect(app.value("id:message-input")).toBe(draft);
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("先说左腿的感觉")));
  expect(app.texts().some((text) => text.includes(draft))).toBe(true);
  expect(app.value("id:message-input")).toBe("");
});

test("断网只给重试，重试成功后才落库", async () => {
  let mode: "offline" | "ok" = "offline";
  const app = await open("./App.tsx", {
    network: {
      "POST https://api.deepseek.com/responses": () =>
        mode === "offline" ? { error: "offline" } : replyWith("这次通了。"),
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
  const draft = `断网测试 ${Date.now() % 10000}`;
  await app.type("id:message-input", draft);
  await app.press("id:send");

  await app.waitFor("id:retry-send");
  expect(app.value("id:message-input")).toBe(draft);
  expect(app.texts().some((text) => text.includes(draft))).toBe(false);

  mode = "ok";
  await app.press("id:retry-send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("这次通了")));
  expect(app.texts().some((text) => text.includes(draft))).toBe(true);
  expect(app.value("id:message-input")).toBe("");
});

test("请求超长自动裁剪最旧的历史重发一次，并提示开新会话", async () => {
  const responses: unknown[] = [
    replyWith("第一轮的回答。"),
    {
      status: 400,
      body: { error: { message: "This model's maximum context length is 1000000 tokens" } },
    },
    replyWith("裁剪之后的回答。"),
  ];
  const app = await open("./App.tsx", {
    network: {
      "POST https://api.deepseek.com/responses": () => responses.shift() as never,
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
  const longTitle = `超长测试 ${Date.now() % 10000}`;
  await app.type("id:message-input", longTitle);
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("第一轮的回答")));

  await app.type("id:message-input", "再问一句");
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("裁剪之后的回答")));

  // 三次请求里，第三次带的历史更短（裁剪过一次）。
  const requests = app.requests();
  expect(requests.length).toBe(3);
  const body = (index: number) => JSON.parse(requests[index].body ?? "{}");
  expect(body(0).input.length).toBe(3); // 系统 + 状态 + 本轮
  expect(body(1).input.length).toBe(5); // 系统 + 2 条历史 + 状态 + 本轮
  expect(body(2).input.length).toBe(4); // 裁掉一半历史后重发
  expect(body(0).input[0].content).toContain("当前状态在最后一条消息之前给出");
  expect(body(0).input[1].content).toContain("【当前状态】");
  expect(body(0).input[2].content).toContain("超长测试");

  // 重发成功后在会话里给一句说明；说明记在会话上，重开会话仍看得见。
  expect(app.texts().some((text) => text.includes("只带了最近 1 条消息"))).toBe(true);
  await app.press("id:back");
  await app.waitFor("id:new-conversation");
  await app.press(`text:${longTitle}`);
  await app.waitFor("id:conv-send-notice");
  expect(app.texts().some((text) => text.includes("只带了最近 1 条消息"))).toBe(true);
});
