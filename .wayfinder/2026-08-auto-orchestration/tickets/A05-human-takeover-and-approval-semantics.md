# 人工接管、决策与审批语义 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: [需求设计工作流状态与转换契约](A01-workflow-state-and-transition-contract.md), [固定角色契约与上下文边界](A02-fixed-role-contracts-and-context-boundaries.md), [Orchestrator 计划与执行器契约](A03-orchestrator-plan-and-executor-contract.md), [Artifact 完成度与质量门禁](A04-artifact-readiness-and-quality-gates.md)

## Question

“自动优先、允许人工接管”在领域模型和审计上具体意味着什么，才能既不中断正常自动路径，也不让人工操作绕过质量门禁？需要决定：

- steer、pause、resume、cancel、retry、replace-plan、force-role 各自的权限与语义；
- 人工补充信息、选择 Decision、接受 Finding 风险、打回 Artifact 和批准归档的区别；
- 接管期间自动执行器是否冻结，何时可自动恢复；
- 人工强制跳过任务是否允许，若允许需记录哪些 actor/reason/diff 和风险接受信息；
- Approval 的 subject 类型、状态、撤销/替代规则，以及 Reviewer Agent 删除后的审批呈现责任；
- API 重试、重复点击和多人操作时如何保证幂等与所有权。

输出应是人工控制命令表、Approval/Decision 语义和审计要求。

## Resolution（2026-08-10）

### 1. 接管原则：命令式、无租约、不建第二条执行路径

- 人工接管不是新的 Workflow 状态，也不创建长期 operator lease。它由一组类型化人工命令组成，继续使用 `pending / running / waiting_for_human / paused / failed / ready_to_archive / archived` 七个治理状态。
- 每条命令都由 Workflow Engine 校验和提交；人类不能直接 patch Workflow、Task、Attempt、Run、Artifact 状态或 Approval 投影。
- 自动执行器只在 Workflow=`running` 且无待处理重规划/门禁时派发新 Attempt。人工命令改变事实后，Engine 重算门禁、Readiness 和调度，不依赖模型解释命令。
- 不保留“手选角色并写治理事实”的并列主流程。角色级人工排障只允许只读 `diagnostic-run`；治理变化必须通过 steer、领域命令或完整 Replacement Proposal。
- `archived` 仍是无出边终态；归档后不允许撤销 Approval、重开 Workflow 或修改治理事实，新业务版本必须创建新 Requirement。

### 2. 人工控制命令矩阵

| 命令 | 允许状态 / 前置条件 | 能力 | 确定性效果 |
| --- | --- | --- | --- |
| `start` | `pending` | `workflow:operate` | 首次进入 `running` 并创建 Planning Task |
| `steer` | 除 `pending/archived` 外 | `workflow:operate` | 追加 HumanDirective；不注入活动 Run，在安全点触发重新规划 |
| `pause` | `running/waiting_for_human/ready_to_archive` | `workflow:operate` | 停止新派发并进入 `paused`；从 ready 暂停时保留当前 Packet |
| `resume` | `paused` | `workflow:operate` | Engine 重算：有门禁→waiting，Readiness 通过且 Packet 有效→ready，否则→running |
| `cancel-run` | 当前 Workflow 的 queued/running Run | `workflow:operate` | Run/Attempt=`cancelled`，候选副作用不发布，Workflow=`paused` |
| `retry-task` | `failed`，目标为当前 Plan 的失败 Task | `workflow:operate` | 授权同一 Task 一个额外 Attempt；不重置原自动预算 |
| `retry-planning` | `failed`，规划失败或连续计划预算耗尽 | `workflow:operate` | 基于最新快照创建一个 Planning Task，并开启新的人工恢复轮次 |
| `retry-recovery` | `failed`，精确 recoverable WorkflowIncident/version | `workflow:operate` | 重排原确定性 outbox/reconciliation；不创建 Task/Attempt/Run，不重置模型预算 |
| `replace-plan` | `running/waiting_for_human/paused/failed/ready_to_archive` | `workflow:operate` | 用完整 Replacement Proposal 原子创建新 PlanRevision 并 supersede 旧非终态工作 |
| `diagnostic-run` | 任一非 archived Requirement | `workflow:operate` | 用固定 Role Contract 和独立 session 做只读诊断；结果不进入治理事实 |
| `provide-human-input` | 精确 Blocking Gate 仍 open | `workflow:operate` | 追加 HumanResponse 并解决该门禁；不自动修改 Requirement 或 Decision |
| `revise-requirement` | 任一非 archived Workflow，精确 current requirement revision | `workflow:operate` | 创建 Requirement successor，使旧依赖失效并触发重新规划 |
| `dispose-decision` | 精确 Decision/version | minor 为 operate；major/critical 为 approve | 追加 accepted/rejected/deferred DecisionDisposition；不原地改历史 |
| `approve-artifact` | current revision 完成策略通过且 digest 匹配 | `workflow:approve` | 追加 revision Approval，current revision 投影为 approved |
| `reject-artifact` | exact current revision/digest | `workflow:operate` | 追加 rejected Approval，revision 终止为 rejected，要求 successor 并重新规划 |
| `accept-major-finding-risk` | major Finding Thread 当前版本可接受 | `workflow:approve` | 追加精确绑定的风险 Approval，Finding 投影为 accepted_risk |
| `revoke-approval` | active Approval 且 Workflow 未 archived | `workflow:approve` | 追加 ApprovalRevocation，相关门禁/Readiness/Packet 失效 |
| `approve-approval-packet` | `ready_to_archive`，当前 Packet digest 完全匹配 | `workflow:approve` | 原子批准 Packet、包内 pending revisions 并归档 |
| `reject-approval-packet` | `ready_to_archive`，或从 ready 暂停且 Packet 仍有效 | `workflow:operate` | Packet rejected；记录目标与原因，自动重规划或在 paused 中等待 resume |

所有命令都禁止对 archived Workflow 执行。状态合法但 subject/version 已变化时也必须拒绝，不能自动改为操作“最新值”。

### 3. pause、steer 与活动 Attempt 的竞态

#### `pause`

- pause 立即阻止新 Attempt 派发；已经 queued 但模型尚未启动的 Attempt/Run 取消，Task 保持可恢复。
- 已经 running 的 Attempt 默认继续。它可在 paused 期间按原 Task、Plan 和精确输入守卫完成并发布候选副作用；Workflow 仍保持 paused，不继续调度。
- 因此 Attempt 提交不能仅比较会被 pause 改变的 Workflow state version。提交守卫必须验证 PlanRevision、Task version、ContextManifest 的精确输入引用和 effect publication token；纯控制状态变化不使输入自动 stale。
- 用户若不接受活动工作的结果，必须执行 `cancel-run`，或直接用 `replace-plan` 使旧 Attempt superseded。

#### `steer`

- steer 追加版本化 `HumanDirective`，不调用现有 `session.steer()`，也不改变活动 Attempt 的 ContextManifest。
- 有活动 Attempt 时，Engine 停止从旧 Plan 派发更多 Task，允许活动 Attempt 完成；在其进入终态后的安全点创建 Planning Task。
- 无活动 Attempt 时立即请求规划。新 PlanRevision 采用后，旧计划的非终态 Task 全部 superseded。
- paused 下 steer 只记录指令并标记需要重规划；直到 resume 才创建/推进 Planning Task。waiting 下 steer 不解决现有门禁。
- failed 下 steer 也只记录指令；必须由 retry-planning 或 replace-plan 执行恢复，steer 本身不离开 failed。
- ready 下 steer 使 ApprovalPacket/Readiness 失效并进入重新规划。

#### 输入相关人工变更

- revise-requirement、Decision 改选、Artifact rejection、Approval revocation 等会改变活动 Attempt 已引用的输入时，Engine 只 supersede 受影响的 Attempt，并 best-effort abort 对应 Run；迟到结果不得发布。
- pause 和 steer 本身不修改当前 Attempt 已引用的事实，因此不以 Workflow version 的宽泛变化误杀可用结果。

### 4. replace-plan、retry 与诊断

#### Replacement Proposal

- `replace-plan` 使用「Orchestrator 计划与执行器契约」的完整 PlanProposal Schema、DAG/预算/角色/输入/写作用域/completion policy 校验器，不支持 PlanPatch。
- 命令另带 commandId、expectedWorkflowVersion、basePlanRevisionId、actor provenance 和必填 reason；`source=human_override` 由服务端写入。
- Proposal 通过后，采用事务先创建新 PlanRevision，再把旧计划所有非终态 Task/Attempt 标为 superseded；活动 Run 随后 best-effort abort。任何迟到结果均不可发布。
- 原状态为 paused 时采用后仍 paused；原状态为 waiting 时未解决门禁继续存在；原状态为 running/failed/ready 时由 Engine 根据新计划和门禁重算为 running 或 waiting。ready 下替换会使 Packet 失效。
- 自动 Orchestrator proposal 仍只能在 running、无 pause/门禁时采用；本命令仅用相同结构验证器，并以本票的人工状态守卫取代自动采用状态守卫。

#### Retry

- `retry-task` 每条成功命令只给指定失败 Task 一个额外 Attempt，不修改 Task 原 maxAttempts，也不重开其他 Task。
- 若 Task 的 Artifact/Decision/Finding/Requirement 输入、PlanRevision 或 Role Contract 已过期，拒绝 retry，要求重新规划。
- `retry-planning` 基于最新治理快照创建新 Planning Task，并重置“无人工连续最多五个 PlanRevision”的恢复轮次；Planning Task 自身仍遵守最多两次自动 Attempt。
- retry 命令成功后，仍有未解决门禁则 Workflow→waiting_for_human，否则 Workflow→running 并派发被授权的 Attempt/Planning Task。
- `retry-recovery` 只处理 `outbox_exhausted` 或可恢复 reconciliation incident；必须精确绑定 incident/version，重放原幂等操作，不能借此重新调用模型或绕过质量门禁。成功后 Engine 重算 waiting/ready/running。
- 取消 Run 后不使用 retry；resume 会为未完成 Task 创建新的 Attempt。

#### Diagnostic Run

- `diagnostic-run` 只能使用四个固定 Role Contract，拥有独立 session、固定 ContextManifest 和只读工具策略。
- 任何 patch/Decision/Finding/gate 等候选副作用均禁止或丢弃；输出不参与 PlanningContext、Readiness、ApprovalPacket 或 Artifact 历史。
- 诊断目的、选择角色、输入 revision、actor、Run/Context digest 和输出均保留审计链接。需要治理变化时转为 steer、领域命令或 replace-plan。

### 5. HumanResponse 与 Requirement 修订

- `provide-human-input` 绑定一个 open Blocking Gate 的 id/version 和回答 Schema，生成不可变 HumanResponse。它只解决该门禁，并作为后续 ContextManifest 的显式输入。
- 解决最后一个门禁后：若 Workflow 未显式 paused，Engine 自动恢复并重新调度；若已 paused，只更新事实，等待 resume。
- 回答门禁不自动修改 Requirement、不选择 Decision、不接受 Finding 风险，也不构成 Approval。
- `revise-requirement` 必须引用 current requirement revision、提交完整 successor content 和 reason。Engine 不从普通回答自然语言猜测是否应该更新需求基线。
- Requirement successor 会使依赖旧 revision 的 Plan/Task/Attempt、Artifact provenance、Critic coverage、Readiness 和 ApprovalPacket 失效；受影响运行 superseded 后重新规划。

### 6. DecisionDisposition：处置追加，不原地覆盖

Decision 保留稳定身份；每次人工选择形成不可变 `DecisionDisposition`：

```text
decisionId / decisionVersion
dispositionVersion
outcome = accepted | rejected | deferred
optionId?               # accepted 必填且必须属于 Decision
reason
owner? / followUpTarget? # deferred 必填
actorRef
subjectDigest
supersedesDispositionId?
createdAt
```

- accepted 必须绑定合法 option；rejected 表示当前选项均不采用并要求 reason；deferred 仅允许 minor，且必须有 reason、owner、followUpTarget，并满足已定 Readiness 限制。
- critical/major disposition 要求 `workflow:approve`，并在同一事务中创建 subject=`decision_disposition` 的 Approval；minor disposition 由 `workflow:operate` 执行并保留 actor。
- 改选不更新旧 disposition，而是追加带 supersedesDispositionId 的新记录。Decision 行上的 status、selectedOption、version 只是最新有效 disposition 的查询投影。
- disposition 变化使引用旧 decision version/digest 的 Artifact、Task/Attempt、Critic coverage、Readiness 和 Packet 精确失效；Engine 重新规划。
- Agent 只能 raise open Decision，永远不能创建 disposition 或 Approval。

### 7. Artifact 拒绝与 Finding 风险接受

#### Artifact revision

- 提前批准只允许 current revision，且该 revision 的 kind Schema、来源、证据和对应 completion policy 已通过；Approval 精确绑定 revision digest。
- reject-artifact 必须引用 exact current revision/digest、reason 和至少一个要求修改的 target；被拒 revision 终止为 rejected，不能再翻回 approved，必须产生 successor。
- rejection 会使相关 Task/coverage/Readiness/Packet 失效；若未 paused 且没有更高优先级门禁，Engine 自动请求重新规划。

#### Finding Thread

- `accept-major-finding-risk` 只允许 major，必须绑定 Finding Thread/version、目标 Artifact revision、EvidenceSnapshot、影响说明和 reason。
- 任一绑定对象变化，风险 Approval 自动 stale，Finding 回到策略重新判定；人工可在归档前显式 revoke。
- critical Finding 只能由 Critic verify 为 resolved，不存在风险接受命令；minor/info 不单独批准，最终 Packet approval 表示人工已看到并接受披露风险。
- 达到两轮自动返工上限而仍 open 的 Finding Gate 不会因 retry、skip 或诊断 Run 自动解决；只能继续返工、major 风险接受，或修改相关治理事实。

### 8. Approval、Revocation 与有效性投影

Approval 是不可变的人类判断记录：

```text
approvalId
requirementId
subjectType = decision_disposition | artifact_revision | finding_risk_acceptance | approval_packet
subjectId / subjectVersion / subjectDigest
outcome = approved | rejected
actorRef
reason
supersedesApprovalId?
commandId
createdAt
```

- actor 来自 Gateway 的可信会话，不来自请求 body；Approval 不再强制依附某个 Agent Run，runId 可为空，provenance 由 command/event 提供。
- Approval 行不原地修改。撤销追加 `ApprovalRevocation(approvalId, actorRef, reason, commandId)`；替代判断追加新 Approval 并引用 supersedesApprovalId。
- `active | stale | revoked | superseded` 是根据 subject 当前 digest、Revocation 和替代关系计算的有效性投影，不是客户端可写状态。
- subject 产生 successor 或相关策略输入变化时旧 Approval 自动 stale，不继承给新对象。
- Artifact rejection 要求 successor；Packet rejection 要求治理输入发生实质变化后生成新 digest，二者不能通过对同一 subject 反复翻转 outcome 绕过返工。
- Workflow archived 后所有 Approval/Revocation 命令关闭，历史判断保持冻结。

### 9. ApprovalPacket 呈现、拒绝与归档事务

- Reviewer Agent 完全删除。Engine 确定性生成 ApprovalPacket；Web 只呈现结构化 Packet，不生成模型“是否建议批准”的意见。
- 审批面必须显示当前 digest、Required Artifact revisions、Decision dispositions、Finding/风险接受、Critic coverage、Consistency warning/info、Readiness checks、策略/Schema 版本和 provenance 链接。
- UI 加载的 digest 一旦因 SSE 事件过期，批准按钮立即禁用并要求重新读取；客户端提交的摘要或截屏不是审批 subject。
- `approve-approval-packet` 仅在 ready_to_archive 且 packetId/digest、Workflow version、全部 Readiness 检查仍一致时执行。单一事务必须：创建 Packet Approval、为包内 pending revisions 派生 Approval 并转 approved、追加归档事件、冻结 DesignSession/Design Package、Workflow→archived。
- `reject-approval-packet` 必须有 reason 和至少一个结构化 target。ready 下拒绝使 Packet 失效、Workflow→running 并自动创建 Planning Task；若 Workflow 是从 ready 暂停且 Packet 仍有效，则拒绝后保持 paused，resume 后自动规划。
- 相同 digest 被拒后，在 Artifact revision、Decision/Finding disposition、Requirement、证据或其他受治理输入至少一项发生变化前，不得再次提交审批。
- ready_to_archive 可 pause 而不使 Packet 失效；paused 中不可批准。若 Packet 仍有效，resume 回 ready；若已被修改或拒绝，resume 后进入 running/waiting 并重新规划。

### 10. 身份、权限、幂等与多人竞争

首版区分两个能力，但不强制四眼原则；同一真实用户可以同时拥有二者：

| 能力 | 范围 |
| --- | --- |
| `workflow:operate` | start/steer/pause/resume/cancel/retry/replace-plan/diagnostic、HumanResponse、Requirement 修订、minor Decision、Artifact/Packet 拒绝 |
| `workflow:approve` | critical/major Decision、Artifact 批准、major Finding 风险接受、Approval 撤销/替代、最终 Packet 批准 |

- Gateway 从可信本地会话解析 `ActorRef` 和 capabilities；客户端不能在 body 中提交 actor。Agent、Run、Orchestrator 和 service principal 永远不能获得 workflow:approve。
- 首版不要求修改者与审批者是不同人；若未来需要四眼原则，应新增 Policy 版本，不能把它藏在 UI。
- 每条命令使用统一 envelope：

```text
schemaVersion
commandId
workflowId
expectedWorkflowVersion
expectedSubjectVersion/digest?
type
payload
reason?
```

- commandId 全局唯一。命令日志保存 payload digest 与完整结果：同 commandId + 同 payload digest 返回首次结果；同 commandId + 不同 digest 返回 `idempotency_conflict`。
- 状态、Workflow version、subject version/digest、权限或前置条件不符时返回冲突/拒绝，服务端不自动把意图重放到最新对象。
- 命令校验、写 command receipt、修改状态/领域事实、追加事件和 outbox/SSE 序号必须在同一 SQLite 事务中。Run abort、模型派发等外部副作用在提交后执行，可通过 receipt/outbox 恢复。
- 记录成功、业务拒绝和版本冲突的 actor、capabilities、commandId、payload digest、reason、expected/actual versions、结果与时间；敏感回答正文按正常领域数据策略存储，不复制到通用错误日志。
- 多人不靠 Workflow 所有者或租约互斥。两个合法命令竞争时，先成功提交者获胜；后者必须重新读取后以新 commandId 明确决定，不能静默覆盖。

### 11. 明确禁止的绕过

首版不存在以下命令或后门：

- `force-role` 写治理事实；仅有只读 diagnostic-run；
- 人工 `force-skip`、直接写 Task completed 或伪造 skipped_satisfied；
- `force-ready`、忽略必需 Artifact、跳过 Critic；
- critical Finding risk acceptance；
- Consistency error waiver；
- 任意 patch 当前 Plan、Workflow status、Decision row、Approval row 或 Artifact revision status；
- 用模型摘要、Reviewer 文本或自然语言“已批准”代替绑定 digest 的真实人工 Approval。

人工可通过完整 replace-plan 移除尚未执行的 Task，但新计划仍须通过相同静态验证，最终仍受 Artifact Policy 与 Readiness Policy 约束。

### 12. 对上下游决策的修订与约束

- 「需求设计工作流状态与转换契约」需补充 `ready_to_archive --pause--> paused`，并说明 Packet 可在纯暂停时保持有效。
- 「Orchestrator 计划与执行器契约」的自动 proposal 继续要求 running；人工 Replacement Proposal 复用结构校验器，但采用本票的命令状态守卫，并原子 supersede 活动 Attempt。
- 「Task 并发与写冲突策略」必须区分纯控制命令与输入相关治理变更，定义 Attempt 精确提交守卫、受影响集合和迟到结果丢弃。
- 「编排持久化、API、事件与恢复契约」必须持久化 HumanDirective/Response、DecisionDisposition、Approval/Revocation、command receipt、capability/ActorRef、Packet reject target，以及提交后 Run abort/dispatch outbox。
- 「自动工作流与人工接管交互原型」必须展示 stale digest、冲突恢复、pause/active Attempt、风险接受与 Packet 审批，不得重新暴露手动角色主流程。
