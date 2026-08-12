# 编排持久化、API、事件与恢复契约 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: [需求设计工作流状态与转换契约](A01-workflow-state-and-transition-contract.md), [Orchestrator 计划与执行器契约](A03-orchestrator-plan-and-executor-contract.md), [人工接管、决策与审批语义](A05-human-takeover-and-approval-semantics.md), [Task 并发与写冲突策略](A10-task-concurrency-and-write-conflict-policy.md)

## Question

现有 SQLite Store、Gateway API 和 SSE 事件模型需要怎样扩展，才能持久保存自动编排事实并在崩溃后确定性恢复？需要决定：

- 是否新增 workflows、plans、tasks、task_attempts、workflow_events 等表，以及如何持久化 Role Contract/Skill/Context Manifest 快照、Attempt 暂存副作用、HumanDirective/Response、DecisionDisposition、Approval/Revocation、command receipt、ActorRef/capability 和 ApprovalPacket digest；哪些信息可从现有 runs/run_events 派生而不重复存储；
- 如何以持久 WorkflowAttemptClaim、DiagnosticRunClaim 和 EffectPublicationToken 替换现有 Requirement 级 `run_locks`，并实现每 Workflow 单活动治理 Attempt、每 Requirement 单 diagnostic-run、终态 CAS 与逻辑写键约束；
- 启动/继续/暂停/接管/审批/重试/归档 API 的资源模型与幂等键；
- 领域事件名称、序号、SSE 重放和 Web 投影契约；
- Gateway 重启时 queued/running/planning/waiting 状态如何收敛，哪些任务可自动重试；
- Pi Session 丢失、模型超时、工具调用中断和数据库事务失败时的恢复策略。

输出应是最小数据库变更、HTTP/SSE 契约和故障恢复矩阵。

## Resolution（2026-08-10）

### 1. 事实源与总体持久化策略

机器可读决策资产：

- [SQLite 持久化模型](../assets/persistence-model-v1.json)
- [Workflow HTTP/SSE 契约](../assets/workflow-api-v1.json)
- [Workflow 事件目录](../assets/workflow-event-catalog-v1.json)
- [崩溃恢复策略](../assets/recovery-policy-v1.json)

首版继续以单进程 SQLite 为治理事实源，Pi JSONL 为执行 transcript 事实源；采用“规范化当前状态 + 内容寻址不可变快照 + 追加事件”，不做完整事件溯源，也不把整个 Workflow 放入一个 JSON aggregate。

- 身份、状态、版本、依赖、claim、subject 和高频查询键规范化为表列。
- PlanProposal、Task spec、ContextManifest、EffectPublicationToken、Role Contract/Skill、PolicyBundle、Run result、ApprovalPacket、Actor/Command/Outbox payload 等大对象进入不可变 `snapshot_documents`，以 `kind + digest` 内容寻址去重。
- Workflow 创建时固定一个 PolicyBundle；新部署的 Artifact/Readiness/Concurrency/Completion Policy 只影响新 Requirement。在途 Workflow 首版不隐式升级 Policy。
- 所有治理写事务使用 `BEGIN IMMEDIATE`；SQLite 启用 `foreign_keys=ON`、WAL、`synchronous=FULL` 和 5 秒 busy timeout。
- 首版不自动裁剪事件、receipt 或仍被引用的快照。

### 2. 最小数据库表面

#### 编排核心

- `workflows`：一 Requirement 一行；保存七态、`version`、`last_event_seq`、current Plan/Packet、PolicyBundle 和当前 failure subject。
- `plan_revisions`：不可变完整 DAG 版本与 Planning provenance。
- `tasks`、`task_dependencies`：Task 状态行与规范化 DAG 边。
- `task_write_keys`：对 `(planRevisionId, requirementId, artifactKind)` 建唯一约束，落实每 Plan 每 kind 单 writer。
- `task_attempts`：Attempt 状态、失败码、Context/Contract/Skill/Token/Result 快照引用。
- `runs`：模型/工具进程事实与 Attempt 隔离 Pi session 元数据。
- `workflow_attempt_claims`、`diagnostic_run_claims`：持久、无租约、无 TTL 的唯一 claim。

#### 不可变执行与恢复

- `snapshot_documents`、`repository_snapshots`、`attempt_effects`。
- `workflow_events`、`run_events`、`tool_calls`。
- `outbox_jobs`、`workflow_commands`、`workflow_command_conflicts`。

#### 人工治理

- `blocking_gates`、`human_directives`、`human_responses`、`workflow_incidents`。
- `decision_dispositions`、`approval_revocations`、`approval_packets`。

#### 领域表重塑

- 保留并升级 `artifacts/artifact_revisions`、`decisions/decision_options`、`findings`、`approvals`、`trace_links`、`evidence_snapshots`、`design_packages`；新增 `finding_threads`。
- `evidence_snapshots` 改为有独立 id 的多版本实体并引用 Repository Snapshot，不再以 requirement_id 为主键。
- Requirement identity 增加 `version/current_revision_id`；Requirement 正文只存在于 `kind=requirement` 的 Artifact revision，不再与 description/source 字段双写。
- Decision 问题与选项创建后不可变；Decision 行的 version/status/selected option 只是最新 disposition 投影。
- Finding 使用稳定 Thread + 不可变 Finding version；Approval 与 Revocation 均只追加。

### 3. Attempt 副作用与执行 Session

- 写工具只向统一 `attempt_effects` 账本写 `artifact_revision | decision | finding | blocking_gate` 候选 payload；RoleResult 引用 effect id。
- effect payload/digest 不可变；同一 logical key 的后续修改追加 effect version/supersedes 引用。
- Attempt 成功事务一次性校验并物化全部声明 effect；失败、取消或 superseded 时统一 discarded。正式领域查询永远不读取 staged effect。
- `design_sessions` 只保留 Requirement 级人机治理 transcript。
- 删除 `runs.session_id → design_sessions`；Run 直接保存隔离的 `session_file/pi_session_id`。
- 治理 Run 必须唯一引用 Attempt；Diagnostic Run 没有 Attempt，只引用固定 diagnostic context，且不写治理事实。
- Planning、Analyst、Architect、Critic 使用同一 Task/Attempt/Run 结构，不新增角色专表。

### 4. Repository Snapshot 与证据

- 每个 Attempt 的 `repositorySnapshotRef` 指向内容寻址、只读、可恢复的 `repository_snapshots`；相同 workspace content digest 复用。
- Snapshot 捕获受领域工具允许的文件，排除 `.git`、依赖、构建产物及敏感忽略路径；允许包含未提交修改。
- 工具只能获得 snapshot root/storage adapter，不能退回实时工作树。
- Snapshot manifest 作为不可变 document 保存；仍被 ContextManifest、EvidenceSnapshot、TraceLink 或 ApprovalPacket 引用时不得清理。
- 具体存储后端可使用 Git tree、硬链接目录或归档，但不得改变不可变读取语义。

### 5. 关键原子事务

| 事务 | 必须同一提交的事实 |
| --- | --- |
| 创建 Requirement | Requirement identity、requirement Artifact revision v1、DesignSession、Workflow=`pending`、PolicyBundle ref、`workflow_created` |
| 采用 Plan | PlanRevision、Tasks、依赖、write keys、旧工作 supersede、Workflow version、事件、schedule outbox |
| 创建 Attempt | Attempt、Run=`queued`、WorkflowAttemptClaim、ContextManifest、EffectPublicationToken、事件、dispatch outbox |
| Run 开始 | Run queued→running CAS、隔离 session 元数据、Run/Workflow 事件；提交后才调用模型 |
| Run 完成 | 完整 result snapshot、Run 终态 CAS、Run event、Workflow 摘要事件、finalize outbox |
| Attempt 收尾 | Token/claim/base CAS、全部 effect publish/discard、Attempt/Task 终态、claim 释放、Workflow version、事件、schedule outbox |
| 人工命令 | command receipt、状态/领域变化、Workflow version、事件、outbox |
| 最终归档 | Packet Approval、包内 revision Approval、DesignPackage、DesignSession freeze、Workflow archived、事件 |

任何模型派发、Run abort 或后续调度都不得发生在其数据库事务提交前。

### 6. Version 与 Event Sequence

Workflow 行维护两个独立计数器：

- `version`：每个成功改变治理判断的事务最多递增一次，服务于 expectedWorkflowVersion。
- `last_event_seq`：每条 Workflow event 都递增，包括命令拒绝、幂等冲突、诊断和恢复审计。

Task、Attempt、Gate、Decision/Finding Thread 等有各自 entity version。Run 使用独立 `last_event_seq`。时间戳只用于展示，不是排序依据。

### 7. HTTP 命令与读取资源

治理命令统一为幂等资源：

```http
PUT /api/workflows/{workflowId}/commands/{commandId}
```

Body 使用封闭 `workflow-command/v1` 判别联合，包含 expectedWorkflowVersion、可选 exact subject version/digest、type、payload 和必要 reason。Actor/capabilities 来自可信 operator session，客户端不得提交 actor。

- 成功、权限拒绝、版本/状态/subject 冲突与业务守卫拒绝都保存不可变 command receipt。
- 相同 commandId + 相同 request digest 永远重放首次 HTTP status/body；不同 digest 返回 `idempotency_conflict` 并追加去重审计。
- malformed JSON、Envelope Schema 非法、未认证或 Workflow 不存在不创建领域 receipt。
- 新增 `retry-recovery`：只在 Workflow failed 且绑定可恢复 workflow incident 时，重排原确定性 outbox/reconciliation；不创建 Task/Attempt/Run，不重置模型预算。

读取以当前聚合投影为主：

- `GET /api/workflows/:id` 一次返回当前状态/version/eventSeq、Policy、Requirement revision、当前 Plan 与最多 12 个 Task、latest Attempts、active claim/Run、Gates、Decision/Finding 摘要、Readiness、Packet 和 failure incident。
- 旧 Plan、全部 Attempts、Run、Packet 与 snapshot document 通过明细端点按需读取。
- `POST /api/requirements` 原子创建 Requirement/Workflow，返回 201 与两者 id、state/version/eventSeq。
- 不保留直接 archive、直接 cancel/steer Run、手工 POST 角色 Run 或客户端直接写状态的并列 API；具体删除由「自动编排切换与旧路径删除策略」安排。

### 8. Actor 与浏览器 Session

- 首版只有一个服务端配置的 ActorRef；默认本地 owner 同时拥有 `workflow:operate/workflow:approve`，不实现用户目录、登录或四眼原则。
- Gateway 默认显式绑定 loopback。非 loopback 必须配置 `BAIZE_TOKEN`。
- Bearer 只用于 `POST /api/session` bootstrap；Gateway 返回 HttpOnly、SameSite=Strict、TLS 下 Secure 的同源 operator cookie，使 fetch 与原生 EventSource 都能认证。
- `GET /api/session` 返回当前 ActorRef/capabilities；客户端不能修改。
- session 可在 Gateway 重启后重新 bootstrap；Command/Approval 保存的是 actor/capability snapshot，不依赖 session 长期存在。

### 9. Workflow/Run 双事件流与 SSE

- `workflow_events(workflow_id, seq)` 是低流量治理与审计流：状态、Plan、Task/Attempt、claim、Gate、Artifact/Decision/Finding、Approval/Packet、命令和恢复。
- `run_events(run_id, seq)` 只记录 token、工具、模型过程、result ref 和 Run 本地状态。
- Workflow 流不复制 token；Run 终态只以摘要进入 Workflow 流。
- Event type 是封闭目录并带 envelope/type version；大内容只放 snapshot document ref/digest。
- 初次页面先 `GET /api/workflows/:id` 获得投影与 lastEventSeq，再订阅 `/api/workflows/:id/events/stream`。
- 断线重连优先用 `Last-Event-ID`，首次连接才使用 `after` query。
- 服务端以 replay watermark + live buffer 完成历史到实时切换，按 seq 去重并保证不乱序；15 秒 heartbeat comment 不占 seq。
- Run 提供同构 JSON replay 与 SSE endpoint。首版不提供含多个 Workflow/Run 的全局 stream。
- SSE 进程内 publish 是 best effort，不进入 outbox；数据库事件回放才是可靠交付。

### 10. 事务 Outbox

`dispatch_run | finalize_attempt | schedule_workflow` 最多 5 次 delivery failure，退避 1/2/5/15/30 秒；`abort_run` 最多 3 次，退避 1/2/5 秒。

- worker 单进程处理，handler 以 dedupe key 和目标当前状态幂等。
- 启动时遗留 processing job 重置 pending，不增加 delivery failure。
- dispatch 耗尽：Run/Attempt=`dispatch_failed`，整个 outbox 重试周期只消耗一次 Task Attempt。
- finalize/schedule 耗尽：Workflow=`failed`，创建 `outbox_exhausted` incident；保留已完成 Run/result，供 `retry-recovery`。
- abort 耗尽只记录 `abort_delivery_failed` warning；治理终态已提交，迟到结果仍不可发布。

### 11. 启动与崩溃恢复顺序

Gateway 完成以下步骤前不监听业务 HTTP：

1. 应用 SQLite pragmas；
2. 校验并执行编号、前向、事务化 schema migrations；
3. `quick_check` 与 `foreign_key_check`；
4. 重置 interrupted outbox；
5. 对 Run/Attempt/claim/staged effect/Workflow projection 做确定性 reconciliation；
6. 追加恢复事件并建立缺失的幂等 outbox；
7. 启动 HTTP、outbox worker 和 scheduler。

数据库损坏、未知更高 schema、migration checksum 不匹配或 migration 失败时拒绝启动。单 Workflow 的不变量错误只使该 Workflow failed，不阻止其他 Workflow 服务。

### 12. Run/Attempt 故障恢复矩阵

| 持久事实 / 故障 | 确定性处理 | Attempt 预算 |
| --- | --- | --- |
| Run queued，claim/Attempt/dispatch job 合法 | 保留同一 Run 并重派；queued 保证模型未开始 | 不消耗 |
| Run running，Gateway 重启 | Run/Attempt=`process_lost`，discard effects、释放 claim，允许时新 Attempt | 消耗一次 |
| Run completed、result snapshot 完整、Attempt 未终结 | 同一 Attempt 重放 finalize；不重跑模型 | 不消耗 |
| Attempt 已发布、仅 schedule/outbox 未执行 | 重放幂等 outbox | 不消耗 |
| cancelled/superseded 收到迟到结果 | CAS 拒绝；只追加 late-result audit | 不消耗 |
| model timeout / transport / tool interrupted | Run/Attempt failed、discard effects，按 Task 预算重试 | 消耗一次 |
| output Schema / completion predicate 失败 | Run completed、Attempt failed、discard effects | 消耗一次 |
| stale publication token | Attempt superseded、discard effects | 不消耗 |
| SQLite 事务失败 | 完整 rollback；无事件/receipt/outbox 半提交；同 commandId/dedupe 重试 | 不消耗 |
| outbox finalize/schedule dead | Workflow failed + incident；`retry-recovery` 重放确定性工作 | 不消耗模型预算 |

### 13. Pi Session 丢失

- Attempt 发布前 session file/id 缺失：`session_missing`，Attempt failed、effect discarded，并消耗 Attempt 预算；仅有 result snapshot 不足以发布。
- 已发布后发现 transcript 缺失：不回滚历史；若当前 Required Artifact provenance 仍依赖该 Attempt，Consistency 产生不可豁免 `missing_execution_transcript` error。
- 修复方式只能是恢复 transcript，或执行新 Task 产生具有完整 provenance 的 successor revisions。

### 14. Schema Migration 与移除项

- 新增 `schema_migrations(version,name,checksum,applied_at)`；不再使用 `ALTER TABLE ... catch` 探测 schema。
- 每个 migration 使用 create-copy-validate-swap-drop 重塑表；成功后应用只支持当前 schema，不保留旧读写兼容分支。
- 删除 `run_locks`、`RunInProgressError`、Run→DesignSession FK、原地 Decision selection、可变 Approval 写入与 Requirement 正文双写。
- 现有数据按「自动编排切换与旧路径删除策略」执行停写式单次 cutover：普通 Requirement 进入 `legacy_archived` 或 `pending_reentry`，旧事实封存为 LegacyRequirementBundle，手工资产迁为 ReusableAsset；queued/running 旧 Run 阻塞迁移，旧表对账后同事务删除。

### 15. 对下游票据的约束

- 「自动工作流与人工接管交互原型」必须使用 Workflow 聚合投影、独立 Workflow/Run SSE、stale command receipt、恢复 incident 和 operator session cookie，不得依赖全局 Run stream。
- 「自动编排切换与旧路径删除策略」必须给出编号 migration、历史数据映射、旧 API/`run_locks`/共享 session/Reviewer 删除顺序；不得长期双写。
- 「实施切面、测试矩阵与发布门禁」必须覆盖每个原子事务的 crash point、outbox 重放、SSE replay barrier、commandId 全结果幂等、Session 丢失、Repository Snapshot 不可变性和启动 fail-closed。
- 自动编排质量指标所需原始事实可从 versioned Workflow events、commands、Attempts 和 failure codes 派生；本票不新增自学习或自动 Skill 修改。
