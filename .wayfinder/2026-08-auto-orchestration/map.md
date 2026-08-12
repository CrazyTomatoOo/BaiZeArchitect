# Wayfinder Map — BaiZe 自动优先需求设计编排 `wayfinder:map`

## Destination

一份评审可通过、可直接交给实现阶段的《BaiZe 自动优先需求设计编排实施规格》：在现有 Gateway、SQLite、持久 Run、Artifact/Decision/Finding 基础上，以“确定性状态机 + Agent 规划”自动选择和推进角色任务；固定 Orchestrator、Analyst、Architect、Critic 四个 Agent 契约，将 Reviewer 改为真实人工门禁，并保留可审计的暂停、接管和恢复能力。本图只产决策、契约与实施计划，不修改业务代码。

## Notes

- Domain: 面向存量软件的需求设计与决策治理，不扩展为通用 Agent 或多 Agent 平台。
- Tracker: local-markdown（无 git remote）；票在 `tickets/`，`blocked-by` 表达依赖；open + 无阻塞 + 未认领为 frontier。
- Skills: wayfinder、grilling、domain-modeling；涉及交互行为时使用 prototype。
- Baseline: [BaiZe 受限领域 Agent 重构](../2026-08-domain-agent-refactor/map.md) 已完成“固定阶段流水线 → 通用持久 Run”的架构决策；本图只规划下一层自动编排，不重做 Gateway、Run、Artifact 基础设施。
- 已确认边界：自动优先、允许人工接管；状态机拥有最终流程控制权，Orchestrator Agent 只产生结构化计划与建议；首版固定四个 Agent 角色，Reviewer 不是模型角色；最终归档仍需真实人工批准。
- 不变约束：Node + Pi SDK + Lit Web + 单进程 SQLite；SQLite 是治理状态事实源，Pi JSONL 是对话 transcript 事实源；禁止原始 shell；不保留新旧编排路径的长期兼容层。
- 当前差距：角色由用户手选；普通角色共享持久主会话但缺少结构化角色 IO 校验；Run 结束不自动推进；没有 workflow/task 状态、计划契约、自动返工和 ready-to-archive 门禁；Reviewer 仍是模型角色；归档只检查无活动 Run。

## Decisions so far

<!-- closed ticket title + one-line gist live here -->
- [需求设计工作流状态与转换契约](tickets/A01-workflow-state-and-transition-contract.md) — 一需求一 Workflow；持久化七个治理状态、执行阶段由 Task 投影；Engine 独占转换权，状态行与追加事件原子更新，人工批准是归档唯一入口。
- [固定角色契约与上下文边界](tickets/A02-fixed-role-contracts-and-context-boundaries.md) — 四角色按版本化 Contract 与隔离 Attempt 执行；Orchestrator 零工具纯规划，专业 Artifact 单一写所有者，Critic 只写 Finding，Reviewer 由 Engine 审批包与真实人工门禁取代。
- [Orchestrator 计划与执行器契约](tickets/A03-orchestrator-plan-and-executor-contract.md) — Engine 以 Planning Task 获取完整有限 DAG，自动校验和采用；Task 使用声明式输入/输出契约与分层状态，动态返工只产生新 PlanRevision，并以安全预算限制重试和计划爆炸。
- [Artifact 完成度与质量门禁](tickets/A04-artifact-readiness-and-quality-gates.md) — Engine 从 ImpactProfile 派生必需产物并按 kind Schema、证据、Decision/Finding、全量 Critic 与不可豁免一致性规则重算 Readiness；两轮返工上限后转人工，最终审批绑定确定性 Packet digest。
- [人工接管、决策与审批语义](tickets/A05-human-takeover-and-approval-semantics.md) — 接管由无租约类型化命令完成；steer 在安全点重规划、replace-plan 原子替换、诊断只读且不可强跳，Decision/Approval 全部追加并精确绑定版本与 digest，真实人工权限和幂等事务守住最终归档。
- [Task 并发与写冲突策略](tickets/A10-task-concurrency-and-write-conflict-policy.md) — 首版每 Workflow 串行一个治理 Attempt、每 Requirement 可并存一个只读诊断；Plan 每 ArtifactKind 单 writer，持久无租约 claim 与精确发布 Token 负责终态竞态、迟到结果和崩溃恢复。
- [编排持久化、API、事件与恢复契约](tickets/A06-persistence-api-events-and-recovery.md) — 规范化状态与内容寻址快照落入事务化 SQLite；统一幂等 Command、Workflow/Run 双事件流和 outbox，按 queued/running/completed 阶段恢复，Repository Snapshot、可信 Actor 与 retry-recovery 保证可审计重放。
- [自动工作流与人工接管交互原型](tickets/A07-automatic-workflow-operator-experience.md) — 需求页采用单一主动作的引导式概览、同页工作流详情与专注审批；多门禁确定性排队，双 SSE 冲突冻结底稿，Command Receipt 与 Projection 分离反馈，高级接管和审计渐进暴露。
- [自动编排切换与旧路径删除策略](tickets/A08-cutover-and-obsolete-path-removal.md) — 以停写式 check→apply 一次切换；普通历史封存为 LegacyRequirementBundle、旧归档标注 legacy_pre_policy、未归档从 pending 重新治理，手工资产迁为 ReusableAsset；对账后同事务删旧表，并同版硬删手工 Run、Reviewer 与旧 API/UI。
- [实施切面、测试矩阵与发布门禁](tickets/A09-implementation-slices-and-release-gates.md) — 以 S1–S7 依赖实现栈和最终原子切换交付；PR 用 Scripted Model 跑全确定性矩阵，RC 用 8×3 真实模型与真实副本演练，零容忍 Doctor、首次写回退边界和 24 小时守护期共同把关发布。

## Not yet specified

<!-- none -->

## Out of scope

- 通用聊天、任意工具执行、开放式多 Agent 平台、运行时动态创造新角色。
- 将场景、用例、功能拆解分别扩成独立 Agent；首版只允许四个固定角色契约。
- 多租户、分布式队列、PostgreSQL/Redis、跨 Gateway 调度和跨 workspace 并行编排。
- 模型自动选型、成本路由、自动修改 Skill、无人批准直接归档。
- 长期保留“手动角色 Run”和“自动编排”两套并列主流程；人工指定角色只作为受审计的接管/诊断能力。
