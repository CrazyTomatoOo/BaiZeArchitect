# 固定角色契约与上下文边界 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by:

## Question

首版 Orchestrator、Analyst、Architect、Critic 四个 Agent 角色应分别拥有哪些稳定职责、输入输出 Schema、工具权限、Artifact 写作用域和上下文隔离规则？需要决定：

- Orchestrator 是否只产 Plan/Task 建议，禁止直接修改专业 Artifact；
- Analyst 与 Architect 各自拥有和共同读取哪些 ArtifactKind；
- Critic 的只读上游、Finding 写入和独立 Session 契约；
- 普通专业角色是否继续共享 Requirement 主 transcript，还是以隔离 Run + Artifact 交接减少角色污染；
- Skill 版本、输入输出 JSON Schema 校验失败、工具越权和角色完成条件如何表达；
- 如何移除 Reviewer Agent，并把“整理审批材料”与“真实人工批准”分开。

输出应是角色权限矩阵和四份可版本化 Role Contract，而不是新增更多人格。

## Resolution（2026-08-10）

### 1. 总体边界：角色是版本化执行契约，不是共享人格

- 首版只有 `orchestrator`、`analyst`、`architect`、`critic` 四个 Agent Role；不允许运行时创建角色，也不保留 Reviewer Agent。
- 每个 `Attempt` 使用一条全新的隔离 Pi session；重试创建新的 Attempt、Run 和 session，不续写失败 Attempt 的 transcript。
- `DesignSession` 只承载 Requirement 级的人机治理交互、人工指令、接管与审批记录，不再作为普通专业角色共享的模型记忆。
- 角色之间只通过 Engine 固化的输入清单、受治理 Artifact revision、Decision、Finding 和工具审计结果交接；任何上游自由文本回答或隐藏 transcript 都不是下游输入。
- Workflow Engine 负责选用 Role Contract、组装输入、校验输出、发布暂存副作用并推进状态；Agent 不能直接修改 Workflow、PlanRevision、Task、Attempt 或审批状态。

### 2. Context Manifest 与可见性

每个 Attempt 在启动前生成不可变的 `ContextManifest@v1`，至少包含：

```text
contractRef          = role + contractVersion + skillVersion + skillDigest
workflowRef          = workflowId + expectedWorkflowVersion
planRevisionRef      = planRevisionId + revision
taskRef              = taskId + taskKind + objective + completionPredicate
requirementRef       = requirementArtifactId + revisionId
repositorySnapshotRef
artifactInputs[]     = artifactId + kind + revisionId + digest + purpose
decisionInputs[]     = decisionId + status + revision/version
findingInputs[]      = findingId + status + targetRevisionId
humanDirectiveRef?   = 已进入治理事件流的显式人工指令
governanceSnapshotVersion
inputDigest
```

- `repositorySnapshotRef` 固定本 Attempt 的仓库读取视图；仓库读取工具不得退回实时工作树。具体快照存储方式由「编排持久化、API、事件与恢复契约」落实。
- `governanceSnapshotVersion` 固定 Artifact、Decision、Finding 与 prior-design 查询的可见截止点。所有工具调用及返回值继续进入 Run 审计。
- `get_artifact` 只能读取清单中列出的 revision，以及当前 Attempt 自己的暂存 revision；不能隐式读取“最新版本”。
- Analyst、Architect 和 Critic 可通过受限工具读取同一 `repositorySnapshotRef`；它们不能读取其他 Attempt 的 session。Orchestrator 没有工具，只消费 Engine 提供的 `PlanningContext`。
- Context Manifest 的引用与摘要是契约输入；大对象可按引用经工具按需展开，但不得由模型自行扩大 Requirement、workspace 或时间范围。

### 3. Role Contract 版本模型

每份不可变 `RoleContract` 包含：

```text
role
contractVersion
inputSchemaRef
outputSchemaRef
skillRef = skillVersion + skillDigest
toolPolicyVersion
readPolicy
writePolicy
completionPolicy
```

- `PlanRevision` 创建时绑定本计划使用的四份 `roleContractRef`；该 Revision 下所有 Task 和 Attempt 固定使用这些版本。
- Skill 或 Contract 变更不热更新在途计划。采用新版必须显式产生新的 PlanRevision；同一 Task 的重试不得悄悄更换 Skill、Schema 或工具策略。
- Attempt 保存实际 Contract、Schema、Skill digest 和 Context Manifest 快照。旧版本可停止供新计划选择，但审计快照不可覆盖或删除。
- Contract 的职责、Schema、工具权限、Artifact 所有权或完成谓词发生不兼容变化时必须创建新 `contractVersion`，不能用 prompt 文案变化绕开版本治理。

### 4. 工具与写入权限矩阵

| 能力 / 受限工具 | Orchestrator | Analyst | Architect | Critic |
| --- | --- | --- | --- | --- |
| `inspect_repository` / `search_code` / `get_architecture` | — | 允许，限仓库快照 | 允许，限仓库快照 | 允许，限仓库快照 |
| `search_prior_designs` | — | 允许，限治理快照 | 允许，限治理快照 | 允许，限治理快照 |
| `get_artifact` | — | 允许，限 Context Manifest | 允许，限 Context Manifest | 允许，限 Review Bundle |
| `patch_artifact` | — | 仅拥有的 kind | 仅拥有的 kind | — |
| `raise_decision` | — | 允许，Attempt 暂存 | 允许，Attempt 暂存 | — |
| `record_finding` | — | 允许，Attempt 暂存 | 允许，Attempt 暂存 | 允许，Attempt 暂存 |
| `run_consistency_check` | — | 允许 | 允许 | 允许 |
| `request_human_input` | — | 允许，形成门禁提案 | 允许，形成门禁提案 | — |
| 写 Workflow / Plan / Task / Attempt / Approval | — | — | — | — |

Artifact 写所有权固定如下：

| ArtifactKind | 唯一可写角色 |
| --- | --- |
| `requirement` | 无 Agent；只能由显式人工治理命令产生新 revision |
| `analysis`、`scenario`、`usecase`、`function` | Analyst |
| `design`、`architecture`、`data`、`api` | Architect |

- 不允许 Task 级临时越权。若所有权需改变，必须发布新 Role Contract 并通过新 PlanRevision 采用。
- 所有专业角色可以读取 Task 清单显式列出的其他角色产物，但只有唯一所有者可创建或修改相应 kind。
- 哪些 ArtifactKind 在某类 Requirement 中必需，由「Artifact 完成度、质量门禁与自动返工策略」决定；写所有权不等于每次强制产出全部 kind。

### 5. 四份首版 Role Contract

#### `OrchestratorContract@v1`

**职责**：把版本化治理快照转换成可验证的计划建议；不做需求分析、架构设计、评审或审批材料整理。

**输入 `PlanningContext@v1`**：Requirement 基线、当前 Artifact revision 清单与摘要、Decision/Finding 状态、Readiness/Consistency 结果、Task/Attempt 结果摘要、显式人工指令，以及本 PlanRevision 可用的 Role Contract 引用。

**输出 `PlanProposal@v1`**：声明目标、Task 建议、固定角色、输入引用、预期输出、完成谓词、依赖和结构化规划理由。计划字段、静态验证与采用规则由「Orchestrator 计划与确定性执行器契约」细化。

**工具/副作用**：零工具、零领域写入；不能开门禁、写 Finding/Decision/Artifact 或改变治理状态。

**完成条件**：输出通过 JSON Schema，所有引用属于输入快照，并通过 Engine 的计划静态校验。通过只表示“提案有效”，不表示 Engine 必须采用。

#### `AnalystContract@v1`

**职责**：澄清需求语义、领域术语、约束、验收条件、场景、用例与功能边界；发现信息缺口。不得以 Analyst 身份决定方案架构。

**输入 `AnalystTaskInput@v1`**：Context Manifest、Task objective/completion predicate、Requirement revision、显式上游 Artifact/Decision/Finding、仓库快照和返工目标。

**输出 `AnalystRoleResult@v1`**：

```text
role = analyst
contractVersion
taskId / attemptId
outcome = completed | blocked | replan_requested
summary
effectRefs[]          # 本 Attempt 暂存的 Artifact/Finding/Decision 引用
gateProposalRefs[]    # blocked 时必填
replanReason?         # replan_requested 时为枚举 reason code + 说明
evidenceRefs[]
```

**工具/写入**：使用矩阵中的专业工具；只写 `analysis/scenario/usecase/function`，可提出 Decision、Finding 和人工门禁。

**完成条件**：Schema 有效，声明引用与工具审计一致，暂存副作用无越权，且 Task completion predicate 对暂存后的候选视图成立。`blocked` 必须至少引用一个有效门禁提案；`replan_requested` 只是建议，是否重规划由 Engine 决定。

#### `ArchitectContract@v1`

**职责**：基于已声明的需求分析输入形成可实施的设计、架构、数据和 API 方案，记录备选项、权衡、约束与证据。不得静默改写 Requirement 或 Analyst 所有的 Artifact。

**输入 `ArchitectTaskInput@v1`**：Context Manifest、Task objective/completion predicate、Requirement revision、显式 Analyst/既有设计输入、Decision/Finding、仓库快照和返工目标。

**输出 `ArchitectRoleResult@v1`**：字段与 Analyst 的 RoleResult 同构，但 `role = architect`，effectRefs 必须满足 Architect 写入策略。

**工具/写入**：使用矩阵中的专业工具；只写 `design/architecture/data/api`，可提出 Decision、Finding 和人工门禁。

**完成条件**：与 Analyst 相同，并额外要求所有被修改的专业 Artifact 显式引用其分析输入与证据；是否达到最终质量门禁不由 Architect 自评。

#### `CriticContract@v1`

**职责**：独立审查冻结产物的遗漏、矛盾、不可实施性、证据不足和风险；只记录结构化 Finding，不修 Artifact、不提出 Decision、不请求人工、不审批。

**输入 `CriticReviewInput@v1`**：

```text
ContextManifest
reviewMode = initial_blind | rework_verification
reviewTargets[]       # 冻结 Artifact revision 与检查目标
acceptedDecisionRefs[]
repositorySnapshotRef
verificationFindings[] # 仅 rework_verification 可有
```

- `initial_blind` 不包含本 Requirement 的历史 Critic Finding 或 Critic transcript。
- `rework_verification` 只额外带入本次需验证的旧 Finding 与处置证据，不带入无关历史评论。

**输出 `CriticReport@v1`**：

```text
role = critic
contractVersion
taskId / attemptId
reviewMode
reviewedTargets[]
coverageAttestation
findingRefs[]          # 允许为空，但必须显式声明零 Finding
summary
evidenceRefs[]
verificationResults[]  # 仅 rework_verification：findingId + successorRevisionId + resolved|still_open + evidenceRefs
```

**工具/写入**：只读 Review Bundle、仓库/治理快照与一致性结果；唯一写能力是 `record_finding`。

**完成条件**：Schema 有效、覆盖所有 reviewTargets、Finding 引用均属于本 Attempt 且目标 revision 合法；`rework_verification` 还必须对每个 verificationFinding 给出合法 verificationResult。Critic 无 `blocked`、`replan_requested`、`approved` 或 `rejected` 输出；Finding 的严重度与质量策略决定后续动作。

### 6. Attempt 暂存、校验与失败表达

- `patch_artifact`、`raise_decision`、`record_finding`、`request_human_input` 的写入先成为带 `attemptId` 的候选副作用，不进入当前有效治理视图。
- Agent 返回后，Engine 依次校验：输出 JSON Schema、Contract/Task/Attempt 引用、工具权限、声明 effectRefs 与工具审计一致性、角色完成谓词。
- 全部通过后，Engine 在一个治理事务中发布候选副作用并记录 Task outcome；任何一步失败都不发布该 Attempt 的候选结果。
- 输入或 Context Manifest 在 Attempt 创建前无效，记 Task/计划校验错误，不启动模型，也不创建违反“一 Attempt 一 Run”的空 Attempt。
- 工具参数错误可由 Agent 在当前 Attempt 内修正；工具越权立即终止并记 `tool_policy_violation`。
- 最终 JSON 非法记 `output_schema_invalid`；Schema 合法但必要副作用缺失或引用不一致记 `completion_predicate_failed`。
- 不在同一 session 追加隐藏的 JSON 修复回合。需要重试时必须按 Task 重试策略创建新的 Attempt、Run 和隔离 session。

### 7. Reviewer 删除与真实人工审批

- Reviewer 从 AgentRole、Skill、角色选择 UI、API 校验和运行分支中删除；不以“approval assistant”等名称保留兼容角色。
- Readiness 通过时，Engine 从冻结 Artifact revision、Decision、Finding 及处置、Consistency/Readiness 结果、来源链和执行摘要确定性生成不可变 `ApprovalPacket`，不再创建 Agent Task 整理材料。
- ApprovalPacket 带内容摘要；人工审批必须绑定该摘要。任何材料变化都会使旧 Packet 与旧审批失效，并撤销 ready 状态。
- 人工只记录 `approve` 或 `reject + comment`。Agent 文本和 Critic Finding 都不具有批准效力；只有绑定当前 Packet 的真实人工 approve 可触发归档。

### 8. 对下游票据的约束

- 「Orchestrator 计划与确定性执行器契约」必须引用 `PlanProposal@v1` 和 PlanRevision 固定的 Role Contract，不得让 Orchestrator 执行计划或调用工具。
- 「Artifact 完成度、质量门禁与自动返工策略」负责把 Artifact/Finding/Decision 规则写成 Engine 完成谓词，不得依赖角色自评的“通过”。
- 「Task 并发与写冲突策略」可依赖本票的唯一 Artifact 写所有权，并仍需处理同一角色多个 Task 对同一 Artifact 的 revision 冲突。
- 「编排持久化、API、事件与恢复契约」必须持久化 Contract/Skill/Context Manifest 快照、Attempt 暂存副作用、失败码、repository/governance snapshot 引用和 ApprovalPacket digest。
