# 渐进迁移切面与发布门禁 `wayfinder:grilling`

status: open
assignee:
blocked-by: [首版运行边界与设计会话契约](R01-runtime-session-contract.md), [Artifact、决策与审批生命周期](R03-artifact-governance-lifecycle.md), [领域工具、Skill 与证据策略](R04-domain-tool-skill-policy.md)

## Question

怎样以可回归验证的切面，将当前 `cli.ts` / `server.ts` / `gateway.ts` 固定阶段系统迁移为目标架构，而不并存两条事实源或无限期保留兼容层？需要确定：

- 删除、替换和保留模块的顺序；
- 每阶段可运行的垂直切片与明确的完成判据；
- 现有 workspace、requirements、evidence 和设计资产如何处理；
- API/UI 切换点及不保留旧路径的时机；
- 端到端、崩溃恢复、并发、审批审计和证据复用验收测试。

输出为实施 Backlog、依赖关系和发布门禁。
