# 05 — 通过 Planning Task 采用合法 PlanProposal

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 让 running Workflow 通过受治理的 Planning Task 调用零工具 Orchestrator，得到完整有限 DAG，并只在所有静态规则成立时采用不可变 PlanRevision。

**Blocked by:** 04 — 在监听流量前恢复持久工作

**Status:** done
- [x] Engine 创建 `plan` Planning Task，规划严格经过 Task → Attempt → Run，且 PlanProposal 不能递归包含 plan 或 Orchestrator Task。
- [x] Orchestrator 使用固定 Role Contract、隔离 Session 和 Planning Context，拥有零工具和零领域写入能力。
- [x] PlanProposal Schema、base Workflow/version/context digest、Task key、依赖、DAG 无环、最大 12 Task、最大深度 6、kind/role、输入祖先、写所有权、每 kind 单 writer、completion policy、1–3 Attempts 和禁止字段全部校验。
- [x] 合法 proposal 自动创建不可变 PlanRevision、Tasks、provenance 和 `plan_adopted` 事件；无需额外人工计划审批。
- [x] 非 stale 的非法 proposal 消耗 Planning Attempt，最多两次后 Workflow `failed`；无部分 Plan/Task 写入。
- [x] Planning Context 已变化时，Run 可 completed，但 Attempt/Task superseded、不消耗失败预算，并基于新快照重新规划。
- [x] 五个无人工连续 PlanRevision 的预算生效，耗尽后形成可恢复失败。
- [x] 每一条 Plan 静态规则至少有一个通过公开测试接缝观测的负例。
