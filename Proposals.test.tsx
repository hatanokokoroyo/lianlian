import { beforeEach, expect, open, test } from "nsh/test";

import { ensureOnboarded, freshDatabase, replyWith, setApiKey } from "./test-helpers";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
// 每个测试都从干净库开始：每张卡的编号都是 1，断言 testID 里的提案编号才有意义。
beforeEach(freshDatabase);

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

const defaultItems = [
  item("gluteus-medius", "left", 78),
  item("soleus", "left", 52),
  item("soleus", "right", 64),
];

/** 一轮里模型直接开一张卡，然后说一句话。 */
function proposeTurn(text: string, items: unknown[] = defaultItems) {
  return {
    status: 200,
    body: {
      status: "completed",
      output: [
        {
          type: "function_call",
          call_id: "call_propose",
          name: "propose_findings",
          arguments: JSON.stringify({ items }),
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

async function openCard(items: unknown[] = defaultItems) {
  const responses: unknown[] = [
    proposeTurn("先看看我这几条判断。", items),
    replyWith("先看看我这几条判断。"),
    replyWith("好，先按这个方向。"),
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
  await app.waitFor("id:message-list >> id:proposal-card");
  return app;
}

const lastRequestBody = (app: Awaited<ReturnType<typeof openCard>>) => {
  const requests = app.requests();
  const body = JSON.parse(requests[requests.length - 1].body ?? "{}");
  return { requests, body, last: body.input[body.input.length - 1] };
};

// #45 主路径一：默认勾选（含低置信度不勾）→ 全部采纳 → 一次提交一轮回复。
test("提议卡：全部采纳，提交后立即解锁，只触发一轮回复", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const responses: unknown[] = [
    proposeTurn("先看看我这几条判断。"),
    replyWith("先看看我这几条判断。"),
  ];
  let calls = 0;
  const app = await open("./App.tsx", {
    network: {
      "POST https://api.deepseek.com/responses": async () => {
        calls += 1;
        if (calls === 3) {
          // 审核后的那一轮：先卡在闸门上，测试好断言「回复还没回来就已经解锁」。
          await gate;
          return replyWith("都记下了。");
        }
        return responses.shift() as never;
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
  await app.type("id:message-input", "蹲不下去");
  await app.press("id:send");
  await app.waitFor("id:message-list >> id:proposal-card");

  expect(app.texts()).toContain("3 条");
  expect(app.texts().some((text) => text.includes("建议采纳这 2 项"))).toBe(true);
  expect(app.texts().some((text) => text.includes("低置信度"))).toBe(true);
  expect(app.texts().some((text) => text.includes("采纳勾选的 2 项"))).toBe(true);
  // 读屏能把每一项分开：编号、部位与当前决定都在标签里。
  expect(app.shows("label:第 1 项、臀中肌左、采纳")).toBe(true);
  expect(app.shows("label:第 2 项、比目鱼肌左、不要")).toBe(true);
  // 待审时这一条会话不能发：输入、照片、发送都禁用。
  expect(app.shows("id:review-lock")).toBe(true);
  expect(app.enabled("id:message-input")).toBe(false);
  expect(app.enabled("id:pick-photo")).toBe(false);
  expect(app.enabled("id:send")).toBe(false);

  // 第 2 项（52 分）手动勾上 → 全部采纳。
  await app.press("id:proposal-item-1");
  await app.waitFor("text:全部采纳");
  const pressed = app.press("id:accept-proposal");

  // 模型回复还被闸门挡着：卡已经定案、输入条已经恢复（不用等回复跑完）。
  await app.waitUntil(() => app.texts().some((text) => text.includes("已写进 3 项，不要 0 项")));
  expect(app.shows("id:review-lock")).toBe(false);
  expect(app.enabled("id:message-input")).toBe(true);
  expect(app.enabled("id:pick-photo")).toBe(true);
  expect(app.shows("text:思考中…")).toBe(true);
  // 整张卡只触发一轮：原始一轮 + 工具跑完的那一轮 + 审核后这一轮。
  expect(app.requests().length).toBe(3);

  release();
  await pressed;
  await app.waitUntil(() => app.texts().some((text) => text.includes("都记下了")));
  // 决策消息不渲染、不计条数；只多了模型这一轮回复。
  expect(app.texts()).toContain("4 条");

  const { requests, last } = lastRequestBody(app);
  expect(requests.length).toBe(3);
  expect(String(last.content)).toContain("采纳第 1、2、3 项");
  expect(String(last.content)).toContain("左臀中肌");
  expect(app.shows("id:proposal-summary-1")).toBe(true);
});

// #45 主路径二：全部取消 → 可选的为什么 → 这 N 项都不要 → 卡置 Dismissed。
test("提议卡：全部不要，理由进证据，整张卡只触发一轮", async () => {
  const app = await openCard();

  expect(app.texts()).toContain("3 条");
  await app.press("id:proposal-item-0");
  await app.press("id:proposal-item-2");
  await app.waitFor("text:这 3 项都不要");
  expect(app.texts().some((text) => text.includes("都不是？全部不要"))).toBe(true);
  // 「为什么」带编号与部位，读屏能分辨是哪一项。
  expect(app.shows("label:第 1 项臀中肌左为什么不要")).toBe(true);

  await app.press("id:reject-reason-0");
  await app.waitFor("id:reject-reason-0");
  expect(app.shows("label:第 1 项臀中肌左：为什么不要（可选）")).toBe(true);
  await app.type("id:reject-reason-0", "膝盖前面紧，不像臀中肌");
  await app.press("id:accept-proposal");

  await app.waitUntil(() => app.texts().some((text) => text.includes("已写进 0 项，不要 3 项")));
  expect(app.shows("id:review-lock")).toBe(false);
  expect(app.texts()).toContain("4 条");

  const { requests, last } = lastRequestBody(app);
  expect(requests.length).toBe(3);
  expect(String(last.content)).toContain(
    "不要第 1 项（左臀中肌，理由：膝盖前面紧，不像臀中肌）",
  );
  expect(String(last.content)).toContain("不要第 2 项（左比目鱼肌，没写理由）");
});

// #46：已处理的卡默认收起；点开只读回看 ✓/✗、编号与拒绝理由。
test("已处理的卡默认收起，展开能看到 ✓/✗ 与理由", async () => {
  const app = await openCard();

  // 默认勾第 1、3 项；第 2 项不要并写一句理由。
  await app.press("id:reject-reason-1");
  await app.waitFor("id:reject-reason-1");
  await app.type("id:reject-reason-1", "不是小腿，是膝盖");
  await app.press("id:accept-proposal");

  await app.waitUntil(() => app.texts().some((text) => text.includes("已写进 2 项，不要 1 项")));
  expect(app.texts().some((text) => text.includes("展开看当时的选择"))).toBe(true);
  // 收起时没有逐项行，也没有可点的勾选圈 / 依据。
  expect(app.shows("id:proposal-summary-1")).toBe(true);
  expect(app.shows("id:reviewed-item-1-0")).toBe(false);
  expect(app.shows("id:reviewed-evidence-1-0")).toBe(false);

  await app.press("id:proposal-summary-1");
  await app.waitFor("id:reviewed-item-1-0");
  expect(app.shows("id:reviewed-item-1-2")).toBe(true);
  expect(app.texts()).toContain("✓");
  expect(app.texts()).toContain("✗");
  expect(app.texts()).toContain("不是小腿，是膝盖");
  expect(app.shows("id:reviewed-evidence-1-1")).toBe(true);
});

// #45：提交已经落库，模型这一轮失败不回滚；重试只重发这一轮。
test("提议卡：提交后模型失败仍保留结果，重试只重发这一轮", async () => {
  const responses: unknown[] = [
    proposeTurn("先看看我这几条判断。"),
    replyWith("先看看我这几条判断。"),
    { error: "offline" },
    replyWith("这次通了。"),
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

  await app.press("id:accept-proposal");
  await app.waitFor("id:retry-send");
  // 卡已经定案、输入条恢复；失败的是随后那一轮模型回复。
  expect(app.texts().some((text) => text.includes("已写进 2 项，不要 1 项"))).toBe(true);
  expect(app.shows("id:review-lock")).toBe(false);
  expect(app.enabled("id:message-input")).toBe(true);
  expect(app.texts()).toContain("3 条");

  await app.press("id:retry-send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("这次通了")));
  expect(app.texts()).toContain("4 条");

  const requests = app.requests();
  expect(requests.length).toBe(4);
  const last = JSON.parse(requests[3].body ?? "{}");
  const lastTurn = last.input[last.input.length - 1];
  expect(String(lastTurn.content)).toContain("采纳第 1、3 项");
});

/** 八项：卡头对齐后，提交按钮在下一屏。 */
const eightItems = [
  item("gluteus-medius", "left", 80),
  item("gluteus-medius", "right", 75),
  item("soleus", "left", 70),
  item("soleus", "right", 68),
  item("gastrocnemius", "left", 66),
  item("gastrocnemius", "right", 64),
  item("tibialis-anterior", "left", 62),
  item("tibialis-anterior", "right", 61),
];

test("八项卡：生成后能滚到提交按钮", async () => {
  const app = await openCard(eightItems);
  expect(app.texts().some((text) => text.includes("建议采纳这 8 项"))).toBe(true);
  // 卡头对齐后提交按钮在下一屏：滚到底再按。
  await app.scroll("id:message-list", 800);
  await app.press("id:accept-proposal");
  await app.waitUntil(() => app.texts().some((text) => text.includes("已写进 8 项，不要 0 项")));
});

// B：模型开完卡，这一轮随后失败；卡片行不能跟着丢。
test("开卡后本轮失败：卡片仍可见、仍待审，不会再多开一张", async () => {
  const responses: unknown[] = [
    proposeTurn("先看看我这几条判断。"),
    { error: "offline" },
    replyWith("卡片还在，先把它审完。"),
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

  // 这一轮在开卡之后失败：卡片行已经补进时间线，卡仍是待审、仍锁着输入。
  await app.waitFor("id:proposal-card");
  expect(app.count("id:proposal-card")).toBe(1);
  expect(app.shows("id:review-lock")).toBe(true);
  expect(app.shows("id:retry-send")).toBe(true);
  expect(app.enabled("id:retry-send")).toBe(false);

  // 审完这张卡：只跑这一轮，没有第二张卡。
  await app.press("id:accept-proposal");
  await app.waitUntil(() => app.texts().some((text) => text.includes("已写进 2 项")));
  expect(app.count("id:proposal-card")).toBe(0);
  expect(app.count("id:reviewed-proposal-1")).toBe(1);
  expect(app.requests().length).toBe(3);
});
