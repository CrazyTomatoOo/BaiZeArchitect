# 需求设计工作流状态与转换契约 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by:

## Question

自动优先模式下，一个 Requirement 的 Workflow 应有哪些稳定状态、事件和转换规则，才能让确定性代码而不是 LLM 掌握最终流程控制？需要决定：

- Workflow、Plan、Task、Run、DesignSession、Requirement 的身份与基数关系；
- working、waiting_for_human、reviewing、rework_required、ready_to_archive、archived 等状态是否足够，以及哪些是持久状态、哪些只是派生视图；
- 每个转换的触发者、前置条件、幂等键和失败语义；
- 自动继续、暂停、恢复、取消、返工和终止的边界；
- 状态机如何保证 LLM 输出只能提出动作，不能越过门禁直接改变治理状态。

输出应是一份可实现的状态图和转换表，成为计划契约、持久化和 API 的上游约束。

## Resolution（2026-08-10）

### 1. 身份与聚合关系

- 一个 `Requirement` 终身只有一个 `Workflow`。创建 Requirement 时同时创建处于 `pending` 的 Workflow；不以“重新开始”创建第二条工作流。
- 一个 Workflow 包含多个不可变的 `PlanRevision`；重新规划产生新 Revision，而不是覆盖历史计划。
- 一个 Workflow 包含多个 `Task`；Task 是角色无关的工作单元，实际角色由其契约声明。
- 一个 Task 可以有多个 `Attempt`；重试创建新 Attempt，保留失败历史。
- 一个 Attempt 严格对应一个 `Run`。Run 负责一次模型/工具执行，不承担整个工作流状态。
- `DesignSession` 继续作为 Requirement 的持久 transcript 容器；它不拥有编排状态。普通角色和 Critic 的具体 Session 隔离方式由「固定角色契约与上下文边界」决定。

```text
Requirement 1 ─ 1 Workflow
Workflow    1 ─ * PlanRevision
Workflow    1 ─ * Task
Task        1 ─ * Attempt
Attempt     1 ─ 1 Run
Requirement 1 ─ 1 DesignSession
```

### 2. Workflow 持久治理状态

| 状态 | 含义 |
| --- | --- |
| `pending` | Requirement 已创建，但用户尚未显式开始需求设计。 |
| `running` | 自动执行器可规划或执行下一项 Task。 |
| `waiting_for_human` | 存在未解决的阻塞型人工输入、重大 Decision 或风险接受门禁。 |
| `paused` | 用户明确停止自动推进；解决门禁不会自动恢复。 |
| `failed` | Task 自动重试预算耗尽或编排器发生不可自动恢复的技术失败；允许人工恢复。 |
| `ready_to_archive` | Readiness Policy 当前通过，正在等待真实人工最终批准。 |
| `archived` | Design Package 已由人工批准并冻结；唯一业务终态，无出边。 |

`planning`、`analyzing`、`designing`、`reviewing`、`reworking` 不是 Workflow 状态，而是根据当前 Task 的 kind、role 和 provenance 计算的 UI/查询投影。普通 Decision、非阻塞 Finding 和单次 Attempt 失败也不直接改变 Workflow 状态。

### 3. 转换表

| 当前状态 | 触发命令或事实 | 守卫条件 | 下一状态 | 触发者 |
| --- | --- | --- | --- | --- |
| `pending` | `start` | 用户首次明确开始 | `running` | Human |
| `running` | `blocking_gate_opened` | 存在阻塞人工输入、重大 Decision 或必须接受的风险 | `waiting_for_human` | Engine，根据受限工具结果 |
| `waiting_for_human` | `gate_resolved` | 所有阻塞门禁均已解决，且未显式暂停 | `running` | Engine，根据 Human 操作 |
| `running` / `waiting_for_human` | `pause` 或取消活动 Run | 当前 Workflow 未归档 | `paused` | Human |
| `ready_to_archive` | `pause` | 当前 ApprovalPacket 仍有效 | `paused` | Human |
| `paused` | `resume` | 仍有阻塞门禁 | `waiting_for_human` | Human + Engine 判定 |
| `paused` | `resume` | 无阻塞门禁且 Readiness 通过 | `ready_to_archive` | Human + Engine 判定 |
| `paused` | `resume` | 无阻塞门禁且 Readiness 未通过 | `running` | Human + Engine 判定 |
| `running` | `retry_budget_exhausted` | Task 的自动 Attempt 已耗尽 | `failed` | Engine |
| `failed` | `retry` / `replace_plan` | 仍有未解决阻塞门禁 | `waiting_for_human` | Human + Engine 判定 |
| `failed` | `retry` / `replace_plan` | 无未解决阻塞门禁 | `running` | Human + Engine 判定 |
| `failed` | `retry_recovery` | 恢复成功且仍有阻塞门禁 | `waiting_for_human` | Human + Engine 判定 |
| `failed` | `retry_recovery` | 恢复成功、无门禁且 Readiness 通过 | `ready_to_archive` | Human + Engine 判定 |
| `failed` | `retry_recovery` | 恢复成功、无门禁且 Readiness 未通过 | `running` | Human + Engine 判定 |
| `running` | `readiness_passed` | 无活动 Task 且 Readiness Policy 通过 | `ready_to_archive` | Engine |
| `ready_to_archive` | `readiness_revoked` / `archive_rejected` | Artifact、Decision、Finding 或审批事实发生变化 | `running` | Engine，根据 Human/领域事实 |
| `ready_to_archive` | `archive_approved` | 真实人工 Approval 已记录，归档事务成功 | `archived` | Human + Engine |

Task 完成、普通 Finding、非阻塞 Decision、Plan Revision 创建以及 Attempt 的队列/运行/完成只追加事件或更新 Task 投影，Workflow 保持 `running`。

### 4. 自动恢复、暂停与失败语义

- 用户只需在 `pending` 时显式开始一次；之后默认自动推进。
- 未显式暂停时，最后一个阻塞门禁解决后自动从 `waiting_for_human` 恢复到 `running`。
- 若用户在等待期间执行 `pause`，门禁解决只更新领域事实；必须显式 `resume`，由 Engine 重新计算应进入 waiting、ready 或 running。
- 从 `ready_to_archive` pause 只冻结自动推进，不使当前 ApprovalPacket 失效；paused 中不可批准。resume 时 Packet 仍有效则回 ready，若其间被拒绝或治理事实变化则进入 running/waiting。
- 取消活动 Run 等价于“终止当前 Attempt 并暂停 Workflow”，不创建独立的 Workflow `cancelled` 状态。
- 单次 Attempt 失败先由 Task 重试策略处理；只有预算耗尽才进入 `failed`。`failed` 可通过 retry 或 replace-plan 恢复，不是业务终态。
- 首版不提供 Workflow reopen；归档后的新业务版本必须创建新的 Requirement。
- 历史 cutover 可由编号 migration 为旧已归档 DesignPackage 创建 `archiveClass=legacy_pre_policy` 的只读 archived Workflow，并绑定 MigrationAttestation 而非伪造新版 Approval；该例外不能由 Runtime/Agent/Command 产生，仍无出边。

### 5. 状态主权、幂等与事件

- Orchestrator、Analyst、Architect、Critic 都不得直接写 Workflow status。LLM 只能输出结构化 Plan/Task 建议，或通过受限工具产生 Decision、Finding、Artifact 等领域事实。
- Workflow Engine 是唯一状态转换执行者。它接收类型化 Command、检查当前状态和守卫条件，再提交转换。
- 持久化采用“当前状态行 + 追加事件”，不采用完整事件溯源。每次转换必须在同一事务内：校验 `expectedVersion`、更新状态和版本、追加不可变 `workflow_event`。
- 每个人工/API Command 必须携带 `commandId`；重复 commandId 返回原结果，不重复转换。状态版本冲突返回冲突，由调用方重新读取后决定。
- 最小领域事件包括 `workflow_created`、`workflow_started`、`human_gate_opened`、`human_gate_resolved`、`workflow_paused`、`workflow_resumed`、`workflow_failed`、`workflow_retry_requested`、`workflow_ready`、`workflow_readiness_revoked`、`workflow_archived`。Task/Attempt/Plan 使用独立事件，不伪装成 Workflow 状态转换。
- 状态行用于恢复和查询，追加事件用于审计、SSE 重放和投影重建；具体表、API 和恢复矩阵由「编排持久化、API、事件与恢复契约」决定。

### 6. 领域语言

本决策确认的 Requirement、Workflow、Plan Revision、Task、Attempt、Run、Design Session、Blocking Gate 与 Readiness Policy 定义已记录到 [BaiZe 需求设计领域词汇表](../../../CONTEXT.md)。
