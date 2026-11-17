import { beforeAll, expect, open, test } from "nsh/test";

import { ensureOnboarded, freshDatabase, replyWith, setApiKey } from "./test-helpers";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
beforeAll(freshDatabase);

/** 四段依据：提议里每一项都要有。 */
const evidence = {
  user_said: "单腿臀桥时左臀先发酸，做 5 个就开始抖",
  test_and_feedback: "俯卧屈膝抬臀 10 次 + 单腿站 30 秒，反馈左侧掉髋",
  reasoning: "伸髋末端发力不足，符合臀大肌上束张力弱",
  uncertainty: "未排除腘绳肌代偿",
};

const item = (site: string, side: string | null, values: Record<string, unknown>, confidence = 78) => ({
  site,
  side,
  confidence,
  values,
  evidence,
});

/** 一轮里模型开一张 3 项的卡，然后说一句话。 */
function threeItemTurn(text: string) {
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
              item("gluteus-maximus", "left", { tension: "weak" }),
              item("gluteus-medius", "left", { tension: "tight", pain: 4 }, 64),
              item("soleus", "left", { tension: "weak", stability: "poor" }, 72),
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

// #11：档案页按区域分组、左右分开，展开看四段依据，时间线倒序，
// 「已解决 / 撤回」都落库且历史不丢；肌群聚合看到成员最差值。
test("档案页：分组、依据、时间线、已解决与撤回", async () => {
  const responses: unknown[] = [threeItemTurn("先看看我这几条判断。"), replyWith("先看看我这几条判断。")];
  const app = await open("./App.tsx", {
    network: {
      "POST https://api.deepseek.com/responses": () => responses.shift() as never,
    },
  });
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");
  await setApiKey(app);

  // 先通过提议卡真的落三条判定（不绕过产品入口）。
  await app.press("id:tab-conversations");
  await app.waitFor("id:new-conversation");
  await app.press("id:new-conversation");
  await app.waitFor("id:message-input");
  await app.type("id:message-input", "蹲不下去");
  await app.press("id:send");
  await app.waitFor("id:proposal-card");
  await app.press("id:accept-proposal");
  await app.waitUntil(() => app.texts().some((text) => text.includes("已写进档案 3 项")));

  // 聊天是整屏详情页：先回列表，底部 Tab 才出现。
  await app.press("id:back");
  await app.waitFor("id:new-conversation");

  // 档案页：空档案的引导不再出现，部位按肌群分组。
  await app.press("id:tab-profile");
  await app.waitFor("id:site-gluteus-medius-left");
  expect(app.shows("id:findings-empty")).toBe(false);
  expect(app.shows("id:archive-section-gluteal-group")).toBe(true);
  expect(app.shows("id:archive-section-posterior-leg-superficial")).toBe(true);
  // 左右分开：只落了左侧，右侧那张卡不存在。
  expect(app.shows("id:site-gluteus-medius-right")).toBe(false);
  // 五轴都占一位，没测的写「未测」。
  expect(app.texts()).toContain("张力 弱");
  expect(app.texts()).toContain("稳定性 未测");
  expect(app.texts()).toContain("张力 紧");
  expect(app.texts()).toContain("疼痛 4 分");

  // 区域可折叠（契约 §5「40+ 部位 → 按区域分组 + 折叠」）。
  await app.press("id:archive-section-gluteal-group");
  await app.waitUntil(() => !app.shows("id:site-gluteus-medius-left"));
  await app.press("id:archive-section-gluteal-group");
  await app.waitFor("id:site-gluteus-medius-left");

  // 展开一条：四段依据原样显示。
  await app.press("id:site-gluteus-maximus-left");
  await app.waitFor("id:site-gluteus-maximus-left-evidence");
  expect(app.texts().some((text) => text.includes("俯卧屈膝抬臀"))).toBe(true);
  expect(app.texts().some((text) => text.includes("未排除腘绳肌代偿"))).toBe(true);

  // 时间线：第一次写入就是当前生效那条。
  await app.press("id:open-timeline-gluteus-maximus-left");
  await app.waitFor("id:timeline-gluteus-maximus-left");
  expect(app.texts().some((text) => text.includes("当前生效"))).toBe(true);

  // 「标记已解决」：追加一条正常判定，历史仍在（时间线还开着）。
  await app.press("id:mark-resolved-gluteus-maximus-left");
  await app.waitUntil(() => app.shows("id:site-gluteus-maximus-left-resolved"));
  expect(app.texts()).toContain("张力 正常");
  await app.waitUntil(() => app.texts().some((text) => text.includes("当前生效")));
  // 时间线把「解决」与普通「写入」分开标，且每条判定带自己的四段依据。
  expect(app.texts().some((text) => text.includes("解决"))).toBe(true);
  expect(app.texts().some((text) => text.includes("写入"))).toBe(true);
  expect(
    app.texts().some((text) => text.includes("推理：伸髋末端发力不足，符合臀大肌上束张力弱")),
  ).toBe(true);
  expect(app.shows("id:mark-resolved-gluteus-maximus-left")).toBe(false);

  // 历史里那条判错了也能撤回（不是只能撤当前生效那条）。
  await app.press("id:retract-entry-gluteus-maximus-left-1");
  await app.waitFor("id:retract-reason-gluteus-maximus-left");
  await app.type("id:retract-reason-gluteus-maximus-left", "三个月前把臀大肌看成臀中肌了");
  await app.press("id:retract-confirm-gluteus-maximus-left");
  await app.waitUntil(() =>
    app.texts().some((text) => text.includes("三个月前把臀大肌看成臀中肌了")),
  );
  // 当前生效的仍是「已解决」那条。
  expect(app.shows("id:site-gluteus-maximus-left-resolved")).toBe(true);
  expect(app.texts()).toContain("张力 正常");

  // 「判定有误」：必须写理由；撤回后那条判定不再出现在档案里（历史留在库里）。
  await app.press("id:site-gluteus-medius-left");
  await app.waitFor("id:retract-gluteus-medius-left");
  await app.press("id:retract-gluteus-medius-left");
  await app.waitFor("id:retract-reason-gluteus-medius-left");
  await app.press("id:retract-confirm-gluteus-medius-left");
  await app.waitUntil(() => app.texts().some((text) => text.includes("撤回要写理由")));
  expect(app.shows("id:site-gluteus-medius-left")).toBe(true);
  await app.type("id:retract-reason-gluteus-medius-left", "把臀中肌看成臀小肌了");
  await app.press("id:retract-confirm-gluteus-medius-left");
  await app.waitUntil(() => !app.shows("id:site-gluteus-medius-left"));

  // 肌群聚合：臀中肌撤回后消失，只剩臀大肌一块有判定，最差的一条来自它。
  await app.waitUntil(() => app.shows("id:group-gluteal-group-left"));
  expect(app.texts().some((text) => text.includes("最差的一条来自「臀大肌」"))).toBe(true);
  expect(app.texts().some((text) => text.includes("1 块有判定"))).toBe(true);

  // 重开 app：已解决与撤回都是落库的，不是内存里的。
  const reopened = await open("./App.tsx");
  await reopened.waitUntil(
    () => reopened.shows("id:onboarding-next") || reopened.shows("id:tab-today"),
  );
  await ensureOnboarded(reopened);
  await reopened.waitFor("id:tab-today");
  await reopened.press("id:tab-profile");
  await reopened.waitFor("id:site-gluteus-maximus-left");
  expect(reopened.shows("id:site-gluteus-maximus-left-resolved")).toBe(true);
  expect(reopened.shows("id:site-gluteus-medius-left")).toBe(false);
  await reopened.press("id:site-gluteus-maximus-left");
  await reopened.waitFor("id:open-timeline-gluteus-maximus-left");
  await reopened.press("id:open-timeline-gluteus-maximus-left");
  await reopened.waitFor("id:timeline-gluteus-maximus-left");
  expect(reopened.texts().some((text) => text.includes("当前生效"))).toBe(true);
  expect(reopened.texts().some((text) => text.includes("张力 弱"))).toBe(true);
  // 三条事件都在：写入、解决、撤回。
  expect(reopened.texts().some((text) => text.includes("写入"))).toBe(true);
  expect(reopened.texts().some((text) => text.includes("撤回"))).toBe(true);
});

// 空档案：不装空白列表，直接把用户送到首次评估。
test("档案页：没有任何判定时引导去首次评估", async () => {
  await freshDatabase();
  const app = await open("./App.tsx");
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");

  await app.press("id:tab-profile");
  await app.waitFor("id:findings-empty");
  expect(app.texts()).toContain("档案还是空的");
  expect(app.shows("id:group-gluteal-group-left")).toBe(false);

  await app.press("id:findings-start-assessment");
  await app.waitFor("id:new-conversation");
});
