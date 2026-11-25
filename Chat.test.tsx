import { beforeAll, expect, open, test } from "nsh/test";

import {
  ensureOnboarded,
  freshDatabase,
  replyWith,
  setApiKey,
} from "./test-helpers";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
beforeAll(freshDatabase);

const reviewEvidence = {
  user_said: "蹲到一半膝盖前面紧",
  test_and_feedback: "靠墙踝背屈：右脚离墙 4 cm",
  reasoning: "踝背屈受限让膝盖代偿",
  uncertainty: "没排除髋",
};

function proposeTurn() {
  return {
    status: 200,
    body: {
      status: "completed",
      output: [
        {
          type: "function_call",
          call_id: "call_propose",
          name: "propose_findings",
          arguments: JSON.stringify({
            items: [
              {
                site: "gluteus-medius",
                side: "left",
                confidence: 78,
                values: { tension: "weak" },
                evidence: reviewEvidence,
              },
              {
                site: "soleus",
                side: "right",
                confidence: 64,
                values: { mobility: "limited" },
                evidence: reviewEvidence,
              },
            ],
          }),
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "先看看我这几条判断。" }],
        },
      ],
    },
  };
}

// #7：三类错误态各有明确出路；用户消息不丢；超长自动裁剪重发一次并提示。
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

test("发送后用户消息立刻进列表，回复前显示思考气泡", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const app = await open("./App.tsx", {
    network: {
      "POST https://api.deepseek.com/responses": async () => {
        await gate;
        return replyWith("收到。");
      },
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
  const draft = `立即显示 ${Date.now() % 10000}`;
  await app.type("id:message-input", draft);
  const pressed = app.press("id:send");

  // 回复还没回来，用户消息已经进了时间线，输入框已清空。
  await app.waitUntil(() => app.texts().some((text) => text.includes(draft)));
  expect(app.value("id:message-input")).toBe("");
  expect(app.texts()).toContain("1 条");
  await app.waitFor("text:思考中…");

  release();
  await pressed;
  await app.waitUntil(() => app.texts().some((text) => text.includes("收到。")));
  expect(app.shows("text:思考中…")).toBe(false);
  expect(app.texts()).toContain("2 条");
});

test("断网时用户消息留在时间线，重试不重复", async () => {
  let attempts = 0;
  let mode: "offline" | "ok" = "offline";
  const app = await open("./App.tsx", {
    network: {
      "POST https://api.deepseek.com/responses": () => {
        attempts += 1;
        return mode === "offline" ? { error: "offline" } : replyWith("这次通了。");
      },
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
  expect(app.value("id:message-input")).toBe("");
  expect(app.texts()).toContain("1 条");
  expect(app.shows("text:思考中…")).toBe(false);

  mode = "ok";
  await app.press("id:retry-send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("这次通了")));
  expect(attempts).toBe(2);
  expect(app.texts()).toContain("2 条");
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
  // 自动裁剪重发复用的是同一条用户消息，不会再追加一条。
  expect(app.texts()).toContain("4 条");

  // 三次请求里，第三次带的历史更短（裁剪过一次）。
  const requests = app.requests();
  expect(requests.length).toBe(3);
  const body = (index: number) => JSON.parse(requests[index].body ?? "{}");
  expect(body(0).input.length).toBe(3); // 系统 + 状态 + 本轮
  expect(body(1).input.length).toBe(5); // 系统 + 2 条历史 + 状态 + 本轮
  expect(body(2).input.length).toBe(3); // 裁掉历史后重发：系统 + 状态 + 本轮
  expect(body(0).input[0].content).toContain("当前状态在最后一条消息之前给出");
  expect(body(0).input[0].content).toContain("scapula 肩胛骨");
  expect(body(0).input[0].content).toContain("不要向用户询问、复述或确认部位名");
  expect(body(0).input[0].content).toContain("这个我不聊");
  expect(body(0).input[1].content).toContain("【当前状态】");
  expect(body(0).input[2].content).toContain("超长测试");

  // 重发成功后在会话里给一句说明；说明记在会话上，重开会话仍看得见。
  // 裁剪按整轮切（#9）：只剩一轮历史时，再裁就是不带历史。
  expect(app.texts().some((text) => text.includes("这次没带历史"))).toBe(true);
  await app.press("id:back");
  await app.waitFor("id:new-conversation");
  await app.press(`text:${longTitle}`);
  await app.waitFor("id:conv-send-notice");
  expect(app.texts().some((text) => text.includes("这次没带历史"))).toBe(true);
});

// #45：待审时这一条会话不能发；提交后立刻恢复。
test("待审时输入条锁定，提交整张卡后恢复", async () => {
  const responses: unknown[] = [
    proposeTurn(),
    replyWith("先看看我这几条判断。"),
    replyWith("那就都记上。"),
    replyWith("接着说就好。"),
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
  await app.type("id:message-input", "蹲不下去");
  await app.press("id:send");
  await app.waitFor("id:proposal-card");

  expect(app.shows("id:review-lock")).toBe(true);
  expect(app.enabled("id:message-input")).toBe(false);
  expect(app.enabled("id:pick-photo")).toBe(false);
  expect(app.enabled("id:send")).toBe(false);

  await app.press("id:accept-proposal");
  await app.waitUntil(() => app.texts().some((text) => text.includes("已写进 2 项")));
  expect(app.shows("id:review-lock")).toBe(false);
  expect(app.enabled("id:message-input")).toBe(true);
  expect(app.enabled("id:pick-photo")).toBe(true);
  // 审核那一轮回复跑完再接着说，免得两个请求抢同一串假响应。
  await app.waitUntil(() => app.texts().some((text) => text.includes("那就都记上")));

  await app.type("id:message-input", "接着说");
  expect(app.enabled("id:send")).toBe(true);
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("接着说就好")));
});
