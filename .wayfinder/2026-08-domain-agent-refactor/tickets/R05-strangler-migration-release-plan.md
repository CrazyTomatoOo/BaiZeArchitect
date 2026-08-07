# 渐进迁移切面与发布门禁 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: [首版运行边界与设计会话契约](R01-runtime-session-contract.md), [Artifact、决策与审批生命周期](R03-artifact-governance-lifecycle.md), [领域工具、Skill 与证据策略](R04-domain-tool-skill-policy.md)

## Question

怎样以可回归验证的切面，将当前 `cli.ts` / `server.ts` / `gateway.ts` 固定阶段系统迁移为目标架构，而不并存两条事实源或无限期保留兼容层？需要确定：

- 删除、替换和保留模块的顺序；
- 每阶段可运行的垂直切片与明确的完成判据；
- 现有 workspace、requirements、evidence 和设计资产如何处理；
- API/UI 切换点及不保留旧路径的时机；
- 端到端、崩溃恢复、并发、审批审计和证据复用验收测试。

输出为实施 Backlog、依赖关系和发布门禁。

## Resolution（2026-08-07）

1. **自底向上五切面，无兼容层，即删即替**：①运行基础设施(Session/Run/Event 持久化+异步 Run+锁+steer/cancel+事件重放) → ②领域内核(Artifact/Revision/Decision/Finding/Evidence/Approval/Trace 一等实体+事务+外键) → ③受限工具层(9 工具+禁 shell+超时裁剪审计+门禁分层+版本化 Skill) → ④Agent 闭环(持久主会话编排+角色模式+Critic 隔离子 Run+证据驱动门禁+search_prior_designs 替代文件扫描) → ⑤下线旧路径(删 cli/server/stage_progress/artifact_refs/runStage/文件扫描归档)。
2. **现有数据一次性迁移后删旧表**：workspaces/requirements/stage_progress/scenarios/use_cases/function_* → Artifact/Revision 模型；evidence/*.json → evidence_snapshots；out/*.md 不迁移(仅导出格式)。
3. **实施 Backlog 与发布门禁**：完整方案见 `docs/refactor-plan.md`；每切面须通过 typecheck + node --test + smoke-gateway + 对应切面验收；切面 5 全量回归后方视为重构落地。

destination 到达——frontier 空。
