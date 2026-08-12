# 03 — 用幂等 Command 治理 Workflow 状态

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 让 start、pause 和 resume 通过同一确定性命令边界改变 Workflow，并使成功、拒绝、冲突和重放都成为可审计的持久事实。

**Blocked by:** 02 — 原子创建 pending Workflow

**Status:** ready-for-agent

- [ ] start 只允许 `pending → running`；pause 和 resume 严格遵守七状态转换表及门禁/Readiness 分流。
- [ ] Workflow Engine 是唯一状态写入者，调用方不能直接设置下一状态或伪造 Actor。
- [ ] 每条合法 envelope 使用 expected Workflow version 和全局唯一 commandId；状态与 version 冲突不会自动作用到最新对象。
- [ ] Command Receipt、状态/version、连续 Workflow Event、Incident 与 Outbox Job 在同一事务中提交。
- [ ] 同 commandId + 同 request digest 精确重放首次 HTTP/领域结果；不同 digest 返回幂等冲突并留下去重审计事实。
- [ ] capability denial、业务拒绝、状态冲突和版本冲突均保存 Receipt；malformed transport 不伪造领域 Receipt。
- [ ] Workflow version 与 event sequence 独立、正确递增，事务 Crash Point 不会留下部分更新。
