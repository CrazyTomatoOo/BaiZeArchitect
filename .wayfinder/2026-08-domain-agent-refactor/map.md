# Wayfinder Map — BaiZe 受限领域 Agent 重构 `wayfinder:map`

## Destination

一份评审可通过的《BaiZe 受限领域 Agent 重构方案》：将当前固定阶段 LLM 流水线重构为持续运行、持久会话、受控领域工具和可审计 Artifact 闭环；明确目标架构、迁移顺序、数据契约和验收标准。本图只产决策与实施计划，不改代码。

## Notes

- Domain: 面向存量软件的需求设计与决策治理；借鉴 OpenClaw 的 Gateway / session / workspace / memory 运行模型，但不做通用 Agent。
- Tracker: local-markdown（无 git remote）；票在 `tickets/`，`blocked-by` 表达依赖；open + 无阻塞 + 未认领为 frontier。
- Skills: wayfinder、grilling、domain-modeling、research。
- 不变约束：保持 Node + Pi SDK + Lit Web + 单进程 SQLite 作为首版落地；先建立正确闭环，不为远期企业化预置 PostgreSQL、Redis、独立 MCP Gateway 或多 Agent 平台。
- 已知问题：`runStage`、`chatIntake` 皆为一次性内存 Session；主链没有代码检索工具；`gateway.ts` 是同步运行；产物、归档和 Gene 的事实源分裂；`server.ts`、`cli.ts`、`gateway.ts` 形成多入口。

## Decisions so far

<!-- closed ticket title + one-line gist live here -->
- [Pi SDK 会话持久化与流式执行可行性](tickets/R02-pi-session-capability.md) — Pi JSONL 提供 transcript 恢复、订阅、取消与 steering；BaiZe SQLite 必须拥有 Run、事件、锁和治理状态。
- [首版运行边界与设计会话契约](tickets/R01-runtime-session-contract.md) — Gateway 唯一入口；一个需求=持久主会话顺序多 Run、归档只读；异步可恢复可重放；证据驱动门禁；Critic 主会话内隔离子 Run。
- [Artifact、决策与审批生命周期](tickets/R03-artifact-governance-lifecycle.md) — 全部一等实体；Artifact 不可变+Revision 链；审批三点(Revision/Decision/归档)；归档=DesignPackage 快照+工具检索注入；证据=Req 级快照+TraceLink。
- [领域工具、Skill 与证据策略](tickets/R04-domain-tool-skill-policy.md) — 纯领域工具集禁用 shell；角色模式+版本化 Skill；Agent 主动调工具取证+TraceLink；工具治理=超时+裁剪+审计+门禁分层。

## Not yet specified

- 多仓与跨 workspace 设计记忆的作用域、检索排序和数据隔离；待首版单 workspace/仓库闭环确定后细化。
- 开发、测试和线上反馈接入 Experience 的数据来源及晋级评测；第一期只保留候选经验入口。

## Out of scope

- 通用聊天渠道、任意命令执行、通用自动化和跨领域 Agent 市场。
- 多租户、SSO、组织权限、分布式队列、PostgreSQL/Redis/MinIO 迁移；它们只在单机闭环通过验收后另起 effort。
- UI 视觉重构；沿用既有 Web 信息架构，只增加运行态和 Artifact 视图所需界面。
