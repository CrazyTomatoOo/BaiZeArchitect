# Task 并发与写冲突策略 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: [Orchestrator 计划与执行器契约](A03-orchestrator-plan-and-executor-contract.md), [Artifact 完成度与质量门禁](A04-artifact-readiness-and-quality-gates.md), [人工接管、决策与审批语义](A05-human-takeover-and-approval-semantics.md)

## Question

在“一 Requirement 一 Workflow、Task 与 Attempt 分离”的状态模型下，首版应继续保持每个 Requirement 只能有一个活动 Attempt，还是允许无写冲突的 Task 并行执行？需要决定：

- 串行执行是否足以满足首版体验，何时才值得开放并行；
- 若允许并行，Plan 依赖、Artifact 写集合、角色权限和人工门禁如何共同形成调度守卫；
- 同一 Artifact、Decision、Finding 或 DesignSession 的冲突键和锁粒度；
- Attempt 已采用隔离 Session；ContextManifest、唯一 Artifact 写所有权、pause/steer/replace-plan 与输入相关人工变更如何界定可并行 Task、精确提交守卫和迟到结果丢弃；
- 并行 Attempt 的事件顺序、失败传播、取消、重试和 Workflow readiness 判定；
- 如何替换当前 Requirement 级 `run_locks`，同时保持 SQLite 单进程实现简单且可审计。

输出应给出首版并发边界、冲突矩阵和锁策略，供「编排持久化、API、事件与恢复契约」采用。

## Resolution（2026-08-10）

### 1. 首版并发边界：一个 Workflow、一个活动治理 Attempt

- `ConcurrencyPolicy@v1` 固定 `maxActiveGovernanceAttemptsPerWorkflow = 1`。Planning、Analyst、Architect、Critic 的 Task 都使用同一个治理活动名额。
- PlanRevision 仍保存完整 DAG 和依赖；独立分支只表示执行顺序约束，不表示首版同时 dispatch。Engine 按稳定拓扑顺序一次派发一个 Task。
- 不实现同 Workflow 多 Agent 并行、角色 lane、Artifact 多资源锁、锁升级、超时抢占或分布式协调。未来只有真实延迟指标证明串行成为瓶颈时，才发布新的 Concurrency Policy 版本。
- 不同 Workflow 的 claim 互不冲突；SQLite 写事务仍由单进程串行提交。进程级模型调用背压是运行配置，不是本票的领域锁，也不得改变同 Workflow 的确定性顺序。
- 可执行策略资产：[`concurrency-policy-v1.json`](../assets/concurrency-policy-v1.json)。

### 2. 唯一调度顺序

Engine 每次调度使用以下固定优先级：

1. Workflow 必须为 `running`，没有未解决 Blocking Gate、显式 pause 或尚待安全点处理的人工命令。
2. 若 `needsPlanning = true`，只允许创建/执行 Planning Task；旧 Plan Task 不再派发。
3. 否则从当前 PlanRevision 按 `tasks[]` 数组序号形成稳定拓扑序，选择第一个 `ready` Task。
4. 当前 Task 的 Attempt 因模型、工具、Schema 或完成谓词失败且仍有预算时，立即为同一 Task 创建下一 Attempt，不切换到其他独立分支。
5. `blocked` 释放活动 claim，Task=`waiting_for_human`、Workflow=`waiting_for_human`；等待期间不执行其他分支。
6. `replan_requested` 释放 claim，Task=`waiting_for_replan`，停止旧 Plan 派发；下一次治理 claim 给新的 Planning Task。
7. Task 成功或 `skipped_satisfied` 后才选择下一个 ready Task；自动重试耗尽则 Workflow=`failed`，不继续其他分支。

因此，同一初始治理快照和同一命令/运行结果序列必须产生唯一 Task 执行顺序。Engine 不以模型响应速度、创建时间或数据库扫描顺序选择分支。

### 3. Plan 级逻辑写集合

每个执行 Task 的逻辑写集合由 `expectedArtifactEffects` 确定，写键固定为：

```text
ArtifactWriteKey = requirementId + artifactKind
```

- 同一 PlanRevision 内，一个 ArtifactWriteKey 最多由一个 Task 声明。多个无依赖或有依赖 Task 都不能在同一 Plan 中重复写同一 ArtifactKind。
- 一个 Task 可在其隔离 Attempt 中多次调用 `patch_artifact` 迭代同一个暂存候选，但成功发布时每个写键最多产生一个 current successor revision。
- 同一 kind 的后续返工必须由新 PlanRevision 中的一个 `rework` Task 完成；不能在原 DAG 放第二个 writer。
- Analyst 只能声明 `analysis/scenario/usecase/function`，Architect 只能声明 `design/architecture/data/api`；Critic、Planning Task 和 diagnostic-run 的 Artifact 写集合必须为空。
- Engine 在采用 PlanProposal/Replacement Proposal 时拒绝重复写键，错误为 `plan_write_set_conflict`。运行时仍对 Artifact base revision 做 CAS，以防人工治理命令改变 current 指针。
- Decision、Finding 和 Blocking Gate 在执行中创建新稳定身份，不预声明为 Artifact 写键；已有 Decision/Finding 的人工处置使用精确 subject version/digest 冲突规则。

### 4. 用治理 claim 替换 Requirement 级 Run 锁

首版使用两个持久、无租约的活动声明：

```text
WorkflowAttemptClaim
  workflowId       PRIMARY KEY
  attemptId        UNIQUE
  taskId
  acquiredAt

DiagnosticRunClaim
  requirementId    PRIMARY KEY
  runId            UNIQUE
  acquiredAt
```

#### WorkflowAttemptClaim

- 覆盖 Attempt 从 `queued`、模型运行、结果解析/校验到候选副作用发布或失败的完整生命周期。Run 已 completed 但 Attempt 尚未完成校验时，claim 仍不能释放。
- 获取 claim、创建 Attempt、创建一一对应的 Run、追加 `attempt_queued/run_queued` 治理事件及写入 dispatch outbox 必须在同一个 SQLite `BEGIN IMMEDIATE` 事务中完成。
- Attempt 进入 `succeeded/failed/cancelled/superseded` 的事务必须同时追加终态事件、删除 claim，并写入下一次调度或 abort outbox。
- claim 不是时间租约，不设 TTL、heartbeat 或“锁过期后自动抢占”。模型慢、事件循环阻塞或时钟漂移都不能产生第二个 Attempt。
- 只有 Attempt 终态事务、启动恢复器或合法 cancel/supersede 命令能释放 claim。

#### DiagnosticRunClaim

- `diagnostic-run` 不创建 Task/Attempt，不占 WorkflowAttemptClaim，可与一个治理 Attempt 同时运行。
- 同一 Requirement 同时最多一个 diagnostic-run；它使用独立 session、固定只读 ContextManifest 和独立 Run 事件流。
- diagnostic 看不到活动 Attempt 的 Staged Effect，不能调用任何治理写工具，结果不进入 PlanningContext、Readiness、ApprovalPacket 或 Artifact 历史。
- pause、steer、门禁不会自动取消诊断；`cancel-run` 可显式终止。Requirement/仓库快照变化后的迟到诊断结果标记 stale，但仅供审计。

现有 `run_locks(requirement_id, run_id)` 和 `RunInProgressError` 在新控制面切换时删除；不得同时保留 Run 锁和 Attempt claim，也不提供兼容 fallback。

### 5. Claim 获取事务

```text
claimNextAttempt(workflowId):
  BEGIN IMMEDIATE
    wf = load workflow + current plan + gates
    assert wf.state == running
    assert no WorkflowAttemptClaim(workflowId)
    assert no pending safe-point replan/pause command

    task = planning task if needsPlanning
           else first ready task in stable topological order
    if no task: COMMIT and return

    revalidate dependencies, retry authorization and completion policy
    resolve all exact inputs
    build ContextManifest
    build EffectPublicationToken
    validate role contract and logical write set

    insert Attempt(status=queued)
    insert Run(status=queued, attemptId)
    insert WorkflowAttemptClaim
    append workflow/task/attempt/run queued events
    insert dispatch outbox row
  COMMIT
```

- 唯一约束是并发 scheduler 的最后防线；“先查询再插入”不能发生在两个事务中。
- 人工命令和调度器都通过 `BEGIN IMMEDIATE`、expectedVersion 与 subject digest 串行竞争。若 pause/replace 等命令先提交，调度守卫失败；若 claim 先提交，命令按本票第 7 节处理现存 Attempt。
- dispatch 是事务后的外部副作用。提交成功但尚未启动模型时，claim 和 outbox 足以让恢复器判定，不允许第二次创建 Attempt。

### 6. EffectPublicationToken：精确提交守卫

Attempt 启动时生成不可变 Token：

```text
EffectPublicationToken
  attemptId
  planRevisionId
  taskId / taskVersion
  contextManifestDigest
  roleContractDigest
  inputVersionVector[]
    subjectType / subjectId / subjectVersion / subjectDigest
  writeBases[]
    artifactKind / artifactId? / baseRevisionId? / baseDigest? / absentMarker?
  tokenDigest
```

发布事务必须重新验证：

1. Workflow 状态为 `running`，或仅因纯控制 pause 而为 `paused`；
2. WorkflowAttemptClaim 仍精确指向该 Attempt；
3. Attempt 仍为可提交的 `running`，且 Run 已得到唯一终态结果；
4. PlanRevision 仍是当前版本，Task 未 superseded 且 taskVersion 匹配；
5. ContextManifest、Role Contract、所有输入 subject version/digest 仍匹配；
6. 每个 Artifact current/absent 基线与 writeBases 完全匹配；
7. 所有 Staged Effect 都属于该 Attempt，满足角色权限、Schema、completion policy 和 current 唯一性；
8. 没有已提交的 cancel、replace-plan 或命中 Token 的输入失效事件。

全部通过后，Engine 在同一事务发布该 Attempt 的全部 Staged Effect、完成 Attempt/Task、释放 claim、追加单调 workflow events 并写调度 outbox；不接受部分发布。

Token 不包含宽泛的 Workflow version 作为唯一判据。pause、steer、无关审计或不在输入向量中的 subject 变化不自动使结果 stale。真正改变 Plan/Task、精确输入或写基线的事实才使 Token 失效。

Token 失效时：

- 不发布任何 Staged Effect；
- Attempt=`superseded`，错误码 `stale_publication_token`；
- 不消耗模型/契约失败重试预算；
- 释放 claim，并根据当前 Workflow 状态等待、暂停或重新规划；
- 对仍运行的 Run 写 abort outbox；其迟到结果按第 9 节处理。

### 7. 人工命令与活动 Attempt 的冲突矩阵

| 命令/事实 | 对 claim | 对 Publication Token | 结果 |
| --- | --- | --- | --- |
| `pause`，Attempt 已 running | 保留 | 不失效 | Attempt 可按原精确输入完成；发布后 Workflow 仍 paused，不继续调度 |
| `pause`，Attempt/Run 仅 queued 未 dispatch | 取消并释放 | 失效 | Attempt/Run cancelled，取消 dispatch outbox |
| `steer` | 活动 Attempt 保留 | 不失效 | 停止后续派发；活动 Attempt 终态后以其已发布事实和 HumanDirective 重新规划 |
| `cancel-run` | 终态事务释放 | 失效 | Run/Attempt cancelled，Staged Effect 丢弃，Workflow paused，事务后 abort |
| `replace-plan` | 旧 Attempt superseded 并释放 | 失效 | 新 PlanRevision 原子采用；迟到结果不可发布 |
| Requirement revision 变化 | 命中输入则 supersede/释放 | 命中时失效 | abort 受影响 Run并重新规划 |
| Artifact current/rejection 变化 | 命中输入或 writeBase 则 supersede/释放 | 命中时失效 | 精确失效，不影响无关 Attempt |
| DecisionDisposition/Finding/Approval 变化 | 命中输入向量则 supersede/释放 | 命中时失效 | 精确失效；无关 subject 不误杀 |
| `provide-human-input` | 正常情况下无活动 claim | 生成后续输入版本 | 解决门禁后重新调度；不注入旧 Attempt |
| diagnostic-run 开始/结束 | 无影响 | 无影响 | 只更新诊断审计，不触发治理调度 |

“命中”由 ContextManifest 的 subject 引用和 writeBases 判定，不通过事件类型进行全局粗暴失效。

### 8. 领域冲突矩阵

| 资源 | 冲突键 | 可写者 | 首版规则 |
| --- | --- | --- | --- |
| 治理执行槽 | `workflowId` | Workflow Engine | 最多一个 WorkflowAttemptClaim |
| 诊断槽 | `requirementId` | Gateway | 最多一个 DiagnosticRunClaim；不与治理槽冲突 |
| Artifact current | `requirementId + artifactKind` | Analyst/Architect 的唯一所有者 | Plan 每键单 writer；发布时 base CAS |
| Attempt 暂存区 | `attemptId + effectLocalId` | 当前专业角色/Critic | 仅本 Attempt 可见；全有或全无发布 |
| Decision | `decisionId + decisionVersion/digest` | Agent 只创建，Human 只追加 disposition | 人工处置 CAS；变化只失效引用者 |
| Finding Thread | `requirementId + fingerprint + threadVersion` | Agent 创建 Finding，Critic 验证，Human 可接受 major 风险 | 发布事务合并/创建线程并校验版本；每次仅一个治理 Attempt |
| Approval/Packet | `subjectType + subjectId + version + digest` | 真实 Human | expected subject CAS；变化使旧批准 stale |
| DesignSession 治理 transcript | `requirementId + workflowSeq` | Engine/Human command | 仅追加；角色 Attempt 使用隔离 session，不争用 transcript |
| RepositorySnapshot | `snapshotRef` | 无写者 | 所有 Agent 只读；活动 Run 不跟随实时工作树 |
| Workflow event stream | `workflowId + seq` | Engine | 事务内单调分配；SQLite 提交顺序为权威顺序 |
| Run event stream | `runId + seq` | Run adapter | 每 Run 独立；token 流不参与治理事件排序 |

由于同 Workflow 治理执行串行，不需要为 Artifact、Decision、Finding 再建立运行时锁表；它们依靠计划静态校验、不可变 revision 和发布 CAS 保障正确性。

### 9. 终态竞争与迟到结果

- Run 和 Attempt 的终态转换必须使用 expected-status CAS；首个合法终态事务获胜，后到者不能覆盖。
- 若 cancel、replace-plan 或输入失效先提交，Attempt 已 cancelled/superseded 且 claim 已释放。abort 是提交后的 best-effort 外部动作，不阻塞人工命令。
- 模型随后返回时，可追加 `late_run_result_discarded` 审计事件，保存受限摘要、result digest 和原 Run provenance；不得把 Run/Attempt 改回 completed，不得发布 Staged Effect 或触发 Task 完成。
- 若 Run/Attempt 成功发布事务先提交，后续人工命令必须读取新的 Workflow/subject version；旧 expectedVersion 命令返回冲突，不静默重放到最新对象。
- diagnostic-run 同样使用终态 CAS；其迟到结果最多改变诊断审计状态，永不影响 Workflow。
- 所有领域状态、claim、事件和 outbox 变化以 SQLite 事务提交顺序为准；时间戳只用于展示，不用于判定先后。

### 10. Task 结果、失败传播与 Readiness

| Attempt/Task 结果 | claim | Workflow/调度结果 |
| --- | --- | --- |
| Attempt failed，仍有自动/人工授权预算 | 终态释放后同 Task 立即重新获取 | 不运行其他 ready Task |
| Task 重试耗尽 | 释放 | Task/Workflow failed |
| 角色合法 `blocked` | 释放 | Task waiting_for_human；Workflow waiting_for_human |
| 角色合法 `replan_requested` | 释放 | Task waiting_for_replan；下一 claim 给 Planning Task |
| Task completed | 释放 | 若 running，选择下一个稳定 ready Task |
| Task completed while paused | 释放 | 保留 completed 与已发布事实；不调度，等待 resume |
| Attempt cancelled | 释放 | Task 保持可恢复；Workflow paused |
| Attempt superseded/stale | 释放 | 不耗失败预算；按当前事实重新规划或等待 |
| diagnostic completed/failed/cancelled | 仅释放 diagnostic claim | 不改变 Workflow、Task、Readiness |

- Readiness 只在没有 WorkflowAttemptClaim、当前 Plan 全部 Task 终态、无未发布 Staged Effect 时重算。
- 串行策略下不存在“某并行分支失败后是否取消其他分支”；任何当前 Task 的最终失败立即停止 Workflow。
- Planning Task 使用同一 claim，故不会与执行 Task 同时运行或采用计划。

### 11. 事件顺序与 SSE

- 每个治理事务从 Workflow 的单调 `next_event_seq` 分配一个或多个连续 seq；Task、Attempt、Artifact 发布、claim 释放和状态转换事件在同一事务中具有确定顺序。
- SSE 的治理重放键为 `(workflowId, seq)`；不能按 createdAt、Run id 或跨 Run token 到达顺序重建状态。
- Run token/工具进度继续使用 `(runId, seq)` 独立流。Web 可交错展示，但不得据此推导 Workflow 状态。
- diagnostic 命令创建与终态可产生审计事件，但不递增 Workflow 状态版本、不唤醒治理 scheduler、不参与 Readiness。
- claim 本身不需要 heartbeat 事件；`attempt_queued`、Attempt 终态和恢复事件足以审计其生命周期。

### 12. 崩溃恢复不变量

Gateway 启动时，在任何自动 dispatch 前必须完成 claim reconciliation：

1. claim 指向不存在或已终态 Attempt/Run：追加恢复事件后删除孤儿 claim；
2. queued/running Attempt 缺少 claim：若同 Workflow 无竞争活动记录，恢复 claim；若存在多个活动 Attempt，视为数据库不变量破坏并将 Workflow 置 failed，不能任选其一；
3. claim 与 Attempt/Task/Workflow 归属不一致：Workflow failed，保留记录等待人工处理；
4. queued Run 与 dispatch outbox 的重新派发、running Run 的失联失败/重试规则由「编排持久化、API、事件与恢复契约」定义，但处理完成前不得释放 claim 或派发新 Attempt；
5. diagnostic claim 使用相同孤儿检查，但诊断恢复失败不改变 Workflow；
6. outbox 消费必须幂等，不能因重复启动创建第二个 Attempt/Run。

恢复器不通过 `acquiredAt` 推测死亡，不自动偷取长时间 claim。单进程 SQLite 是本策略的前提；多 Gateway/分布式 lease 明确超出本图范围。

### 13. 对上下游票据的约束

- 「Orchestrator 计划与执行器契约」的静态校验必须新增每 Plan、每 ArtifactWriteKey 单 writer 规则，并继续使用稳定拓扑数组顺序。
- 「Artifact 完成度与质量门禁」的 current revision 唯一性由 Plan 写集合校验与发布 base CAS 共同保证；Readiness 必须等待治理 claim 和 Staged Effect 清空。
- 「人工接管、决策与审批语义」的 pause/steer 精确语义通过 EffectPublicationToken 实现；replace/cancel/输入变更使用终态 CAS，不等待 abort。
- 「编排持久化、API、事件与恢复契约」必须落地两类 claim、Token 快照、逻辑写键、workflow seq、终态 CAS、dispatch/abort outbox 与启动恢复矩阵，并删除现有 `run_locks`。
- 「实施切面、测试矩阵与发布门禁」必须覆盖：并发 scheduler 争抢、单 writer 计划拒绝、pause 后成功发布、steer 后安全点重规划、replace/cancel 与迟到结果、输入精确失效、claim/outbox 崩溃恢复及 diagnostic 共存。
