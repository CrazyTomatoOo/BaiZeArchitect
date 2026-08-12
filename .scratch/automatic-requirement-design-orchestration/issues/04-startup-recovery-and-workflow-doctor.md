# 04 — 在监听流量前恢复持久工作

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 让 Gateway 重启先确定性收敛 Run、Attempt、Claim、Staged Effect 和 Outbox，再接受请求，并提供只读诊断与精确的基础设施恢复命令。

**Blocked by:** 03 — 用幂等 Command 治理 Workflow 状态

**Status:** ready-for-agent

- [ ] 启动 reconciliation 完成前 HTTP 不开始监听，重复 reconciliation 保持幂等。
- [ ] queued Run 可安全重派；running Run 收敛为 `process_lost` 并消耗对应 Attempt 预算；已有 result snapshot 的 completed Run 继续确定性收尾。
- [ ] Workflow Attempt Claim、Diagnostic Claim、未发布 Attempt Effect 和 Outbox 状态按恢复策略重建或收敛，不依赖 TTL。
- [ ] Outbox 使用有界重试；耗尽后创建 Workflow Incident 并安全进入 `failed`，不重复外部副作用。
- [ ] `retry-recovery` 只重试精确 Incident 的确定性 Engine/Outbox 操作，不创建 Task、Attempt 或 Run。
- [ ] 未发布 Attempt 缺 Session 时失败并计入预算；当前已发布 provenance 缺 transcript 时产生不可豁免 Consistency error。
- [ ] 只读 Workflow Doctor 能以机器可读结果检查至少状态/事件、Claim、Outbox、Effect 和 DB/Session 配对基础不变量，且绝不修复数据。
- [ ] 真实重启测试覆盖 command commit 后 Outbox 前和 claim restore 后 redispatch 前的中断。
