# 14 — 分别重放 Workflow 与 Run 事件流

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 通过公开 HTTP 分离治理事件和模型执行事件，并让客户端从持久 Receipt 可靠收敛到最新 Projection，即使发生断线、重连或 catch-up 与 live 竞争。

**Blocked by:** 12 — 通过 Command 完成人工治理与最终归档；13 — 提供 bounded Workflow Projection 与不可变详情读取

**Status:** ready-for-agent

- [x] Workflow 与 Run 各有分页 JSON history 和独立 SSE endpoint；Workflow 流不包含 token，Run 流包含 token/result/process 事实（tool 事实由 run-event/v1 envelope 承载，当前 driver 无工具调用）。
- [x] 每个流使用本地连续整数 seq、版本化 envelope 和正确 event field；时间戳不作为顺序权威。
- [x] 首次连接使用 `after`，重连优先使用 Last-Event-ID；无自动 pruning 时任意有效 cursor 可重放。
- [x] catch-up 捕获数据库 watermark、缓冲 live 事件、按 seq flush 并去重，不丢失或重复观察业务事件。
- [x] heartbeat 不消耗 seq，客户端断线后可重连并继续精确游标。
- [x] accepted Command Receipt 可以先于 Projection 变化返回；后续 Workflow event 和重新读取 Projection 确认实际状态。
- [x] retention 越界（416 + watermark）、未知 Run/Workflow（404）、认证失败（401）和断流（close 清理订阅与 heartbeat）采用明确外部错误语义。
- [x] 同 commandId 重放不会产生重复领域事件，两个并发命令只呈现持久胜者及失败 Receipt。
- [x] create→archive 的测试仅通过公开 API、Receipt、双 SSE 与 Projection 完成，并验证 Run token 不污染 Workflow audit。
