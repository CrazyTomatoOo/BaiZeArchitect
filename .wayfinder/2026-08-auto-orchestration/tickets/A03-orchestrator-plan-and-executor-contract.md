# Orchestrator 计划与执行器契约 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: [需求设计工作流状态与转换契约](A01-workflow-state-and-transition-contract.md), [固定角色契约与上下文边界](A02-fixed-role-contracts-and-context-boundaries.md)

## Question

Orchestrator Agent 应输出什么结构化计划，确定性执行器又应如何校验、接受和推进该计划，才能实现动态编排而不把流程主权交给 LLM？需要决定：

- Plan 与 Task 的最小 Schema：角色、目标、输入 Artifact Revision、预期输出、依赖、完成条件、最大尝试次数和人工门禁提示；
- 计划是一次生成完整 DAG、逐步滚动规划，还是二者结合；
- 允许哪些动态分支、返工边和跳过规则，如何防止循环与任务爆炸；
- 执行器如何从 Task 创建 Run、收集结构化结果、判断成功并请求下一计划；
- 非法计划、Schema 不匹配、角色越权、模型无工具调用和部分完成时的确定性降级策略；
- 用户接管后如何修改计划而不篡改历史记录。

输出应包含 Plan/Task JSON Schema、计划校验规则和执行伪代码。

## Resolution（2026-08-10）

### 1. 计划单位：完整、有限、不可变的 DAG

- 每个 `PlanRevision` 都是一张一次生成的完整有限 DAG；采用后不追加 Task、不修改边、不原地改条件。
- Orchestrator 可以用 `task_output` 符号引用尚未产生的上游 Artifact。Task 激活时，Engine 将符号引用解析为精确 Artifact revision，再生成该 Attempt 的 Context Manifest。
- 单个 Plan 内只允许无条件 `dependsOn` 边，不提供条件节点、返工回边、循环、脚本或表达式 DSL。
- 运行结果要求返工、Task 请求重规划、重试耗尽后的人工恢复，或整张 DAG 完成但 Readiness 未通过时，创建新的 PlanRevision。旧计划与旧 Task 永不覆盖。
- 已完成 Task 不复制到新计划；它们发布的 Artifact、Decision、Finding 等事实作为新计划的显式输入。旧计划尚未完成的 Task 在新版本采用时统一标记 `superseded`。

### 2. 规划本身仍使用 Task → Attempt → Run

- Workflow 首次启动或需要重规划时，Engine 创建 `kind = plan`、`source = engine` 的 Planning Task，角色固定为 Orchestrator。
- Planning Task 直接属于 Workflow，记录 `basePlanRevisionId`；首次为空，重规划时指向当前版本。它不是尚不存在的 PlanRevision 的子任务。
- Planning Task 严格产生 Attempt 和 Run，沿用统一的失败、取消、审计和重试模型；不新增 PlanningRun、PlanningCycle 或隐式模型调用。
- `PlanProposal.tasks` 禁止包含 `plan` 或 Orchestrator Task，防止模型递归创建规划者。
- 有效 proposal 被采用时，Engine 在一个事务中创建 PlanRevision、执行 Tasks 和 `plan_adopted` 事件，并记录来源 Planning Task/Attempt/Run。

### 3. `PlanProposal@v1` 与 Task Schema

可执行的 JSON Schema 资产：[`plan-proposal-v1.schema.json`](../assets/plan-proposal-v1.schema.json)。

顶层最小结构：

```json
{
  "schemaVersion": "plan-proposal/v1",
  "base": {
    "workflowId": 42,
    "workflowVersion": 7,
    "basePlanRevisionId": 3,
    "planningContextDigest": "sha256:<64 hex>"
  },
  "objective": "完成当前需求的可实施设计与独立评审",
  "tasks": [],
  "rationale": "任务拆分与依赖理由"
}
```

Task 的最小结构：

```json
{
  "key": "design-api",
  "kind": "design",
  "role": "architect",
  "objective": "基于需求分析形成 API 设计",
  "dependsOn": ["analyze-core"],
  "inputs": [
    {
      "type": "task_output",
      "taskKey": "analyze-core",
      "artifactKind": "analysis",
      "purpose": "设计约束"
    }
  ],
  "expectedArtifactEffects": [
    { "kind": "api", "operation": "create_or_revise" }
  ],
  "completionPolicyRef": "architect-task/v1",
  "maxAttempts": 2
}
```

Schema 只表达声明式工作图：

- `key` 是 PlanRevision 内唯一的稳定局部键，由 Engine 分配数据库 ID；Agent 不输出持久化 ID、Run 参数或状态转换。
- `objective` 是任务目标，不是可绕过 Role Contract 的自由 Prompt。Engine 使用固定 Role Contract 模板和 Context Manifest 构造实际输入。
- `inputs` 是 `artifact_revision | task_output | decision | finding | human_directive` 的封闭判别联合；不存在 `latest`、任意查询、SQL、JSONPath 或代码表达式。
- `expectedArtifactEffects` 只声明专业 Artifact 的 `create_or_revise` 预期；Decision、Finding 与 Blocking Gate 仍由专业角色在执行中按 Role Contract 提出。
- `completionPolicyRef` 必须来自当前 PlanRevision 固定 Role Contract 与 Engine Policy 的白名单。具体策略由「Artifact 完成度与质量门禁」决定，Orchestrator 不能提供代码或自定义表达式。
- `maxAttempts` 是 1–3 的有界建议，采用后成为 Task 固定预算；Planning Task 由 Engine 固定为最多 2 次 Attempt。
- Plan 不包含人工门禁节点或 skip 标志。只有 Analyst/Architect 的合法 `blocked` 结果可以形成门禁提案；skip 只能由 Engine 根据完成策略判定。

### 4. 固定 TaskKind 与角色矩阵

| TaskKind | 允许角色 | 创建者 | 语义 |
| --- | --- | --- | --- |
| `plan` | Orchestrator | 仅 Engine | 产生一个 PlanProposal |
| `analyze` | Analyst | PlanProposal | 需求、约束、场景、用例和功能分析 |
| `design` | Architect | PlanProposal | 设计、架构、数据或 API 方案 |
| `review` | Critic | PlanProposal | `initial_blind` 独立评审 |
| `rework` | Analyst 或 Architect | PlanProposal | 针对显式 Finding/Decision/人工指令返工 |
| `verify` | Critic | PlanProposal | `rework_verification` 定向复审 |

首版不允许任意 TaskKind 字符串。更细的差异通过 objective、显式输入、预期 Artifact effect 和 completion policy 表达，不新增角色或任务语言。

### 5. 输入绑定解析规则

- `artifact_revision` 必须指向当前 Requirement 且存在于 PlanningContext 的治理快照；kind、revision 与 digest 必须匹配。
- `task_output` 的 `taskKey` 必须是当前 Plan 内该 Task 的直接或间接依赖祖先；所需 ArtifactKind 必须出现在来源 Task 的 expectedArtifactEffects 中，并符合来源角色写所有权。
- Engine 只在依赖 Task `completed` 后解析 `task_output`。必须得到唯一、已发布的 revision；零个或多个候选均记 `input_resolution_failed`，不启动 Attempt。
- `decision`、`finding`、`human_directive` 必须属于同一 Requirement 和 planning governance snapshot；引用状态在 Attempt 启动前变化时，原计划输入过期，触发重规划而不是读取新值。
- Requirement revision、repositorySnapshotRef、治理截止版本与 Role Contract 引用由 Engine 自动加入 Context Manifest，不由 Orchestrator 重复声明。

### 6. 计划静态校验

Engine 按以下顺序验证 proposal；任一失败都不得创建 PlanRevision 或执行 Task：

1. JSON Schema、`additionalProperties: false`、字段长度和枚举校验通过。
2. Workflow 仍为 `running`，且 workflowVersion、basePlanRevisionId、planningContextDigest 与 Planning Task 输入完全匹配。
3. tasks 为 1–12 项，key 唯一，依赖只指向同 Plan task，图无环且最大深度不超过 6。
4. kind/role 符合固定矩阵，且 proposal 中不存在 Orchestrator/plan Task。
5. 所有既有事实引用属于 PlanningContext；所有 task_output 引用均指向依赖祖先及其声明输出。
6. expectedArtifactEffects 符合 Analyst/Architect 的唯一写所有权；Critic 的数组必须为空；同一 PlanRevision 内 `(requirementId, artifactKind)` 写键最多由一个 Task 声明，否则 `plan_write_set_conflict`。
7. completionPolicyRef 存在、适用于 role/kind 且固定在本 PlanRevision；maxAttempts 在 1–3 内。
8. 不存在状态命令、工具列表、Prompt、动态角色、条件/循环表达式、人工批准或归档指令。
9. 至少一项 Task 的 completion policy 尚未被当前精确事实满足；全被满足时 Engine 应直接重算 Readiness，而不是采用空工作计划。
10. 当前没有未解决 Blocking Gate、显式 pause 或与采用事务竞争的 replacement command。

校验通过的 Orchestrator proposal 自动采用，不增加“计划审批”人工门禁。采用事务使用 expectedVersion；并发变化导致事务失败时按 stale 处理。

### 7. 自动采用、重规划和安全预算

- 有效 PlanProposal 自动采用，符合“首次明确 start，后续自动推进”的已定原则。
- 规划执行期间上下文变化时，Run 可为 `completed`，但 Attempt 记 `superseded` / `stale_planning_context`；不发布计划、不消耗 Planning Task 的失败重试预算，并基于新快照创建新的 Planning Task。
- 非 stale 的 Schema/静态校验失败记 `plan_validation_failed`，消耗一次 Planning Attempt；最多自动尝试 2 次，耗尽后 Workflow 进入可恢复 `failed`。
- 单 PlanRevision 最多 12 个执行 Task、DAG 深度最多 6、单 Task 最多 3 次 Attempt。
- 没有人工干预时最多连续采用 5 个 PlanRevision；第五个版本执行完仍未通过 Readiness，进入 `failed`，错误为 `planning_budget_exhausted`。
- 人工审查后可 retry 或 replace-plan 开启新的恢复轮次；旧 revision、失败和预算事件保持可审计。
- Task 结果不会在当前 DAG 内激活条件分支。以下事实只会触发新的 Planning Task：合法 `replan_requested`、质量策略要求返工、当前计划执行完但 Readiness 未通过，以及人工 replace-plan。
- `blocked` 不立即重规划：Engine 发布合法门禁并进入 waiting；门禁解决后原 Task 回到可执行状态并创建新 Attempt，除非人工同时要求 replace-plan。

### 8. Task、Attempt、Run 的分层状态

| 层级 | 状态 | 含义 |
| --- | --- | --- |
| Run | `queued / running / completed / failed / cancelled` | 模型与工具进程事实；沿用现有 Run 控制面 |
| Attempt | `queued / running / succeeded / failed / cancelled / superseded` | 一次 Role Contract 执行结果 |
| Task | `pending / running / waiting_for_human / waiting_for_replan / completed / failed / superseded / skipped_satisfied` | Plan 中一项工作的治理状态 |

- Task `ready` 是由 Workflow=`running`、依赖终态、输入可解析、无活动 Attempt 推导的调度属性，不作为稳定状态。
- Run 正常返回但输出 JSON 非法时：Run=`completed`，Attempt=`failed`。
- 角色合法返回 `blocked` 时：Attempt=`succeeded`，Task=`waiting_for_human`，Workflow 根据门禁进入 `waiting_for_human`。
- 角色合法返回 `replan_requested` 时：Attempt=`succeeded`，Task=`waiting_for_replan`；新计划采用后旧 Task=`superseded`。
- completion policy 已被精确输入满足且无需新评审时，Engine 可在不建 Attempt/Run 的情况下将 Task 记 `skipped_satisfied`，并记录判定证据。
- replace-plan 采用后，旧计划所有非终态 Task=`superseded`；已 completed/skipped_satisfied 的历史不改写。

### 9. 确定性降级与失败矩阵

| 情况 | Run | Attempt / Task | Engine 动作 |
| --- | --- | --- | --- |
| Task/Context/Role Contract 在 Attempt 创建前无效 | 不创建 | Task=`failed` | `task_contract_invalid`，Workflow=`failed` |
| 模型/传输/工具执行异常 | `failed` | Attempt=`failed` | 未达 maxAttempts 则新 Attempt，否则 Task/Workflow=`failed` |
| 工具越权 | `failed` 或被中止 | Attempt=`failed` | `tool_policy_violation`，消耗预算；候选副作用不发布 |
| 最终 JSON 非法 | `completed` | Attempt=`failed` | `output_schema_invalid`，按预算重试 |
| JSON 合法但 effectRefs/完成条件不满足 | `completed` | Attempt=`failed` | `completion_predicate_failed`，按预算重试 |
| Orchestrator 输出静态非法计划 | `completed` | Planning Attempt=`failed` | `plan_validation_failed`，最多两次 |
| Orchestrator 输出已过期 | `completed` | Attempt/Task=`superseded` | 不消耗失败预算，重新规划 |
| Analyst/Architect 未调用写工具 | `completed` | 由完成策略决定 | 所需 effect 已存在才可完成，否则 `completion_predicate_failed` |
| Critic 零 Finding | `completed` | 可 succeeded/completed | 必须有合法 CriticReport、全量 reviewedTargets 和零 Finding 声明 |
| 只完成部分 Artifact/Finding 写入 | `completed` | Attempt=`failed` | Attempt 暂存结果全部不发布，不接受部分完成 |
| Run 被人工取消 | `cancelled` | Attempt=`cancelled`，Task 保留待恢复 | Workflow=`paused`，恢复后新 Attempt |
| Task 重试耗尽 | 终态 | Task=`failed` | Workflow=`failed`，等待人工 retry/replace-plan |

“没有工具调用”本身不是统一失败条件：Orchestrator 本应零工具，Critic 可以零 Finding；专业任务是否必须写入由 expectedArtifactEffects 与 completionPolicyRef 确定。

### 10. 事件驱动执行器伪代码

```text
on workflow_started | workflow_resumed | gate_resolved | task_terminal:
  schedule(workflowId)

schedule(workflowId):
  wf = loadWorkflowWithVersion(workflowId)
  if wf.state != running:
    return

  reconcileTerminalRunsAndAttempts(wf)
  if workflowStateChanged():
    return

  if needsPlanning(wf):
    ensureOnePlanningTask(
      idempotencyKey = wf.id + wf.version + currentPlanId + contextDigest
    )
    return

  plan = currentPlanRevision(wf)
  ready = deriveReadyTasks(plan)
  for task in stableTopologicalOrder(ready):
    if completionPolicyAlreadySatisfied(task):
      markSkippedSatisfied(task, evidence)
      continue
    inputs = resolveExactInputs(task)
    manifest = buildContextManifest(task, inputs)
    validateBeforeAttempt(task, manifest, pinnedRoleContract)
    dispatchAccordingToConcurrencyPolicy(task, manifest)

  if noActiveAttempts(plan) and allTasksTerminal(plan):
    if readinessPolicyPasses(wf):
      transitionWorkflow(ready_to_archive)
    else:
      requestPlanning(reason = readiness_not_met)

on planning_run_terminal(run):
  if run failed/cancelled:
    failOrRetryPlanningAttempt()
    return
  proposal = parsePlanProposal(run.result)
  if proposal.base no longer matches:
    markAttemptSuperseded(stale_planning_context)
    requestPlanning(reason = context_changed)
    return
  validateSchemaAndStaticRules(proposal)
  transaction(expectedWorkflowVersion):
    supersedeNonTerminalTasksOfOldPlan()
    createPlanRevision(source = orchestrator, proposal, provenance)
    createTasksFromProposal()
    append(plan_adopted)
  schedule(workflowId)

on role_run_terminal(run):
  map Run process result to Attempt result
  if Attempt failed:
    discardAttemptStagedEffectsFromEffectiveView()
    retryOrFailTask()
    schedule(workflowId)
    return

  validateRoleResultAndCompletionPolicy()
  transaction(expectedWorkflowVersion, expectedTaskVersion):
    publishAttemptStagedEffects()
    markAttemptSucceeded()
    apply completed | blocked | replan_requested task outcome
    append task/attempt/domain events
  schedule(workflowId)
```

调度顺序使用 Plan tasks 数组序号作为稳定拓扑次序；实际可同时 dispatch 多少 ready Task、写锁和冲突处理由「Task 并发与写冲突策略」决定。执行器必须由持久事件唤醒，不依赖递归内存调用链。

### 11. 人工 Replacement Proposal

- 人工接管后不 patch 当前 DAG，也不需要 Orchestrator 转述；`replace-plan` 提交与 `PlanProposal@v1` 同构的完整 Replacement Proposal。
- 命令另带 `commandId`、expectedWorkflowVersion、basePlanRevisionId、actor 和 reason；`source = human_override` 由 Engine 写入，不接受客户端伪造。
- Replacement Proposal 使用相同 Schema、TaskKind/角色、DAG、预算、Artifact 权限、completion policy 与输入引用验证器；自动 Orchestrator proposal 的“Workflow 必须 running、无 pause/门禁”采用守卫不适用，改用「人工接管、决策与审批语义」的命令状态守卫。
- 采用产生新的 PlanRevision 并保留旧版本；事务内先把旧计划所有非终态 Task/Attempt 标为 superseded，活动 Run 随后 best-effort abort，迟到结果不得发布；已发布领域事实不回滚，必须被替代计划显式引用或留作审计。
- steer 只向后续 PlanningContext 写入显式 humanDirective，不修改当前 Plan。pause/resume/replace-plan 的精确状态与权限继续由「人工接管、决策与审批语义」决定。

### 12. 下游约束

- 「Artifact 完成度与质量门禁」必须给出可注册的 completionPolicyRef、Readiness Policy 和自动返工触发，不允许模型自评替代。
- 「Task 并发与写冲突策略」必须在本票静态验证和 dispatch 钩子上定义并发上限、写集合冲突与稳定调度，不改变 Plan DAG 语义。
- 「编排持久化、API、事件与恢复契约」必须持久化 Planning Task provenance、PlanProposal 原文与 digest、分层状态、失败码、预算计数、replacement source 和 plan/task 事件。
