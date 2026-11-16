import { beforeAll, expect, open, test } from "nsh/test";
import { Conversations, Findings, Storage } from "lianlian/native";

import { ensureOnboarded, freshDatabase, replyWith, setApiKey } from "./test-helpers";

// 一个文件一个干净的库：`nsh test` 的多个文件共用一个进程。
beforeAll(freshDatabase);

const evidence = {
  user_said: "单腿站的时候骨盆会掉",
  test_and_feedback: "单腿站立 30 秒：左侧骨盆掉下去",
  reasoning: "左侧臀中肌支撑不住，骨盆下沉",
  uncertainty: "没排除脚踝",
};

/** 一轮里先查再写，落一条带依据日志的判定。 */
function evidenceTurn() {
  return {
    status: 200,
    body: {
      status: "completed",
      output: [
        {
          type: "function_call",
          call_id: "call_search",
          name: "search_evidence",
          arguments: JSON.stringify({ site: "gluteus-medius" }),
        },
        {
          type: "function_call",
          call_id: "call_record",
          name: "record_finding",
          arguments: JSON.stringify({
            site: "gluteus-medius",
            side: "left",
            confidence: 78,
            values: { tension: "weak" },
            evidence,
          }),
        },
      ],
    },
  };
}

// #17：档案页显示本地数据占用与各表占比；归档不动档案；删除会话后依据日志仍在。
// 「来源会话已删除」这个标注由 `llm::agent` 的 search_evidence 结果覆盖（Rust 单测）。
test("容量仪表、归档与删除会话后的依据日志", async () => {
  const responses: unknown[] = [evidenceTurn(), replyWith("记下了：左侧臀中肌张力弱。")];
  const app = await open("./App.tsx", {
    network: {
      "POST https://api.deepseek.com/responses": () => responses.shift() as never,
    },
  });
  await app.waitUntil(() => app.shows("id:onboarding-next") || app.shows("id:tab-today"));
  await ensureOnboarded(app);
  await app.waitFor("id:tab-today");
  await setApiKey(app);

  // 通过产品入口落一条判定与它的依据日志（不直接写库，也不绕过网关）。
  await app.press("id:tab-conversations");
  await app.waitFor("id:new-conversation");
  await app.press("id:new-conversation");
  await app.waitFor("id:message-input");
  await app.type("id:message-input", "帮我看看骨盆");
  await app.press("id:send");
  await app.waitUntil(() => app.texts().some((text) => text.includes("左侧臀中肌")));
  const id = (await Conversations.list()).active[0].id;
  expect((await Findings.load()).total).toBe(1);

  await app.press("id:tab-profile");
  await app.waitFor("id:storage-capacity");
  await app.waitFor("id:storage-table-evidence");
  expect(app.texts()).toContain("本地数据");
  expect(app.texts()).toContain("依据日志");
  expect(app.texts().some((text) => text.includes("已用"))).toBe(true);

  const before = await Storage.load();
  const evidenceBefore = before.tables.find((table) => table.id === "evidence");
  expect(evidenceBefore).toBeDefined();
  expect(evidenceBefore!.bytes).toBeGreaterThan(0);
  expect(evidenceBefore!.share).toBeGreaterThan(0);
  expect(before.databaseBytes).toBeGreaterThan(0);
  expect(before.totalBytes).toBeGreaterThan(0);

  // 归档只是会话自己的字段变了：档案条目与依据日志一个字节都不动。
  expect(await Conversations.setArchived(id, true)).toBeNull();
  expect((await Findings.load()).total).toBe(1);
  const archived = await Storage.load();
  const evidenceArchived = archived.tables.find((table) => table.id === "evidence");
  expect(evidenceArchived!.bytes).toBe(evidenceBefore!.bytes);

  // 删除会话删消息与照片，依据日志与判定都留下（ADR-0005）。
  expect(await Conversations.delete(id)).toBeNull();
  expect((await Findings.load()).total).toBe(1);
  const deleted = await Storage.load();
  const evidenceDeleted = deleted.tables.find((table) => table.id === "evidence");
  expect(evidenceDeleted).toBeDefined();
  expect(evidenceDeleted!.bytes).toBe(evidenceBefore!.bytes);
});
