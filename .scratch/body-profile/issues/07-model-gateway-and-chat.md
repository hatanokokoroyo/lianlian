GitHub: #7
Status: resolved
Type: task
Blocked by: 1, 2

# 07: 模型网关与对话（含错误态）

**What to build:** 模型网关接口 + DeepSeek 实现（OpenAI 格式的 `/responses`，无状态、多轮自拼）、key 设置在本地、装配顺序按 ADR-0006 实现、三类错误态（可重试 / 配置问题 / 请求问题）各有明确出路，并把第一次真实对话的响应录下来当回归语料。

**Blocked by:** #1, #2

**Status:** resolved

- [x] 设置页可填 key，保存在本地；无效 key 给出"去设置"的直接出口
- [x] 真对话可用：一轮文本问答能完整往返并入库
- [x] 装配顺序为 `[系统提示][会话历史][档案投影+训练条件+未结提议][本轮消息]`，系统提示含"当前状态在最后一条消息之前给出"
- [x] 同一状态连续两次装配字节一致（可断言）；档案变化只影响尾部
- [x] 断网/超时/429 → 只给重试；key 无效/无额度 → 直接跳设置；请求超限 → 提示并自动裁剪重发一次
- [x] 已输入的文字在失败后不丢
- [x] 至少一份真实响应语料入库，测试不联网

## Comments

- 2026-11-15：`llm::prompt`（装配，纯函数）+ `llm::deepseek`（`POST https://api.deepseek.com/responses`，
  `reasoning.effort=none`，非流式）。失败按出路分类为 `retryable` / `config` / `request`；`TooLong`
  单独识别（context length 等措辞），自动裁掉最旧一半历史重发一次并在会话里提示「建议新开会话」。
  发送失败**不落库**，草稿按会话缓存在界面模块里（跳设置再回来还在）。
- 首次真实调用的请求与响应录在 `tests/corpus/deepseek-first-request.json` /
  `deepseek-first-reply.json`；Rust 测试断言「今天的装配 == 录下来的请求」，并回放响应解析；
  端到端测试用 `open` 的 `network` 桩，不联网。
- 偏差：流式输出未做（`fetch` 整包返回；先走非流式），`reasoning.effort=none` 关闭思考模式。
