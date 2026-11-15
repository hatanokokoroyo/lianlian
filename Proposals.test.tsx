import { beforeAll, expect, open, test } from "nsh/test";

import { ensureOnboarded, freshDatabase, replyWith, setApiKey } from "./test-helpers";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
beforeAll(freshDatabase);

/** 四段依据：提议里每一项都要有。 */
const evidence = {
  user_said: "蹲到一半膝盖前面紧",
  test_and_feedback: "靠墙踝背屈：右脚离墙 4 cm",
  reasoning: "踝背屈受限让膝盖代偿",
  uncertainty: "没排除髋",
};

const item = (site: string, side: string, confidence: number) => ({
  site,
  side,
  confidence,
  values: { tension: "weak" },
  evidence,
});

/** 一轮里模型直接开一张 3 项的卡，然后说一句话。 */
function proposeTurn(text: string) {
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
              item("gluteus-medius", "left", 78),
              item("soleus", "left", 52),
              item("soleus", "right", 64),
            ],
          }),
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        },
      ],
    },
  };
}

// #10：一轮想改多条 → 一张卡一屏审完；低置信度默认不勾；接受后可撤销。
test("提议卡：一张卡、默认不勾低置信度、接受后撤销回到待确认", async () => {
  // 带 function_call 的那一轮之后还要一次请求（工具跑完，模型接着说）。
  const responses: unknown[] = [proposeTurn("先看看我这几条判断。"), replyWith("先看看我这几条判断。")];
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

  // 一轮只出一张卡（不是三条）。
  await app.waitFor("id:proposal-card");
  expect(app.texts().some((text) => text.includes("它想改这 3 处"))).toBe(true);
  expect(app.texts().some((text) => text.includes("低置信度"))).toBe(true);
  // 第 3 项（52 分）默认不勾：按钮上写的是「接受选中 2 项」。
  expect(app.texts().some((text) => text.includes("接受选中 2 项"))).toBe(true);

  // 展开依据看一眼。
  await app.press("id:proposal-evidence-1");
  await app.waitFor("id:proposal-evidence-1");
  expect(app.texts().some((text) => text.includes("靠墙踝背屈"))).toBe(true);

  // 接受选中：卡上剩下的项还能继续审（不是进摘要就消失了）。
  await app.press("id:accept-proposal");
  await app.waitUntil(() =>
    app.texts().some((text) => text.includes("已写进 2 项，还剩 1 项可审")),
  );
  expect(app.shows("id:accepted-proposal-1")).toBe(false);

  // 撤销要写理由，撤销后回到待确认（可以重新勾）。
  await app.press("id:undo");
  await app.waitFor("id:undo-reason");
  await app.type("id:undo-reason", "这两条记得不对");
  await app.press("id:undo-confirm");
  await app.waitFor("id:proposal-card");

  // 继续勾剩下那项（低置信度，手动勾上），三项全部审完。
  await app.press("id:proposal-item-1");
  await app.press("id:accept-proposal");
  await app.waitFor("id:accepted-proposal-1");
  expect(app.texts().some((text) => text.includes("已写进档案 3 项"))).toBe(true);
  expect(app.shows("id:proposal-card")).toBe(false);
});

// 拒绝一项：理由进证据，模型在下一轮给出下一步（不是一句「好的」）。
test("提议卡：拒绝并说明会落成证据，并自动让模型接着说", async () => {
  const responses: unknown[] = [
    proposeTurn("先看看我这几条判断。"),
    // 工具跑完之后的那一次。
    replyWith("先看看我这几条判断。"),
    // 拒绝之后自动发起的那一轮。
    replyWith("那换个方向：先测髋，不急着记小腿。"),
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

  await app.press("id:reject-item-1");
  await app.waitFor("id:reject-reason");
  await app.type("id:reject-reason", "不是小腿，是膝盖");
  await app.press("id:reject-proposal");

  // 自动发起的那一轮里，用户消息就是这句拒绝。
  await app.waitUntil(() =>
    app.texts().some((text) => text.includes("那换个方向")),
  );
  const requests = app.requests();
  // 三次：原始那一轮、工具跑完的那一轮、拒绝之后的那一轮。
  expect(requests.length).toBe(3);
  const body = JSON.parse(requests[requests.length - 1].body ?? "{}");
  const lastTurn = body.input[body.input.length - 1];
  expect(String(lastTurn.content)).toContain("我拒绝了第 2 项，理由：不是小腿，是膝盖");

  // 卡上该项标成已拒绝，另外两项还可以审。
  expect(app.texts().some((text) => text.includes("已拒绝"))).toBe(true);
});
