# Artifact 完成度与质量门禁 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: [需求设计工作流状态与转换契约](A01-workflow-state-and-transition-contract.md), [固定角色契约与上下文边界](A02-fixed-role-contracts-and-context-boundaries.md), [Orchestrator 计划与执行器契约](A03-orchestrator-plan-and-executor-contract.md)

## Question

自动编排器应依据哪些可计算事实判断“任务完成”“需要返工”和“可请求归档”，避免把模型的一段自然语言结果误当作完成？需要决定：

- 不同需求类型最少需要哪些 Artifact，以及“按需产物”由谁声明；
- Artifact Revision 的 draft/pending/approved/rejected 如何参与状态转换；
- TraceLink、EvidenceSnapshot、开放 Decision、Finding 严重度和一致性检查的硬门禁；
- Critic 是所有工作流必经，还是只对满足风险条件的变更必经；
- Finding 如何关闭、接受风险或触发定向返工，并防止无限评审循环；
- ready_to_archive 的确定性判定和最终人工 Approval 所需摘要、diff 与证据包。

输出应是一份机器可执行的 Readiness Policy 和归档前检查清单。

## Resolution（2026-08-10）

### 1. 机器策略资产与主权

本决策提供两份可执行资产：

- [`artifact-content-v1.schema.json`](../assets/artifact-content-v1.schema.json)：Draft 2020-12 JSON Schema，定义九种 ArtifactKind 的首版内容契约。
- [`readiness-policy-v1.json`](../assets/readiness-policy-v1.json)：Artifact 要求、Revision 生命周期、Task completion policy、证据、Decision、Finding、Critic、Consistency、Readiness 与 ApprovalPacket 的版本化策略配置。

Workflow Engine 是唯一策略执行者。Agent 只能产生符合 Role Contract 的候选 Artifact、Decision、Finding、门禁或评审结果；“我认为已完成”“Critic 说通过”和自然语言摘要都不是完成事实。Task completion 是局部契约，Readiness 是对当前完整治理快照的重新计算，二者不能互相替代。

### 2. Required Artifact Set：Engine 根据 Impact Profile 派生

每个 Requirement 固定要求以下当前 Artifact revision：

```text
requirement + analysis + design
```

`analysis` 必须包含 `ImpactProfile@v1`，六个维度均为 `yes | no | unknown` 并带理由。Engine 使用 `ArtifactPolicy@v1` 确定性派生条件产物：

| ImpactProfile 维度 | `yes` 时新增必需 ArtifactKind | 判定边界 |
| --- | --- | --- |
| `process` | `scenario` | 用户、系统或事件流程及生命周期变化 |
| `actors` | `usecase` | 参与者目标、权限或交互变化 |
| `behavior` | `function` | 系统行为、能力或业务规则分解变化 |
| `architecture` | `architecture` | 组件边界、依赖、部署或非功能约束变化 |
| `data` | `data` | 持久数据、生命周期、迁移、隐私或保留策略变化 |
| `api` | `api` | HTTP、RPC、事件、消息或函数调用契约变化 |

- 任一维度为 `unknown` 时，Required Artifact Set 不完整；Analyst 必须返回合法 `blocked` 或把问题治理为 Decision，Engine 不得猜测 `no`。
- Orchestrator 只能为 Engine 派生的 Required Artifact Set 安排 Task，不能删除必需 kind；可以增加有明确目的的产物，但增加后同样进入 Schema、证据和评审门禁。
- `scenario/usecase/function` 是条件 ArtifactKind，不是固定独立 Agent 或固定 Task 模板。Orchestrator 可在一个或多个 `analyze` Task 中组合产出，只要所有权、依赖、expected effects 和 completion policy 合法。
- 人工可通过修改 Requirement 或解决 Impact Decision 改变事实，随后 Engine 重新派生集合并创建新 PlanRevision；不提供“本次忽略某个必需 kind”的直接开关。

### 3. 按 ArtifactKind 的内容 Schema

全部 Artifact 使用结构化 JSON，而不是任意 Markdown 或 `content: unknown`。共同 envelope 是：

```text
schemaVersion
artifactKind
summary
sourceRefs[] = requirement_revision | artifact_revision | decision |
               finding | human_directive | trace_link
```

各 kind 的最小实施结构由 Schema 资产精确定义：

| ArtifactKind | 关键必填结构 |
| --- | --- |
| `requirement` | title、description；goals/nonGoals/constraints 可在人工基线中补充 |
| `analysis` | goals、nonGoals、constraints、acceptanceCriteria、ImpactProfile、openQuestions |
| `scenario` | actors、preconditions、trigger、main/alternate flow、expected outcome |
| `usecase` | actor、goal、preconditions、main/alternative flow、postconditions |
| `function` | responsibility、inputs/outputs、business rules、acceptance criteria |
| `design` | change units、alternatives、failure handling、test strategy、implementation order、rollout/rollback |
| `architecture` | components、relationships、constraints、NFR、Decision refs |
| `data` | entities/fields/lifecycle、relationships、migration/rollback、privacy/retention |
| `api` | interface kind/name/contract/errors/compatibility、security、versioning、tests |

- 除 Requirement 基线外，`sourceRefs` 至少一项，并且必须在 Attempt 的 Context Manifest 中可解析。
- `additionalProperties`/`unevaluatedProperties` 关闭；模型不能用未治理的任意字段偷渡状态、Prompt 或审批。
- `analysis.openQuestions` 非空时，每项必须映射到显式 Decision、Blocking Gate 或已记录的非阻塞处置；自由文本问题不能被遗忘后继续 ready。
- Schema 通过只证明结构完整。事实正确性、跨产物一致性、证据和评审由后续门禁继续验证。

### 4. Task Completion Policy Registry

Plan 的 `completionPolicyRef` 只能引用当前 PlanRevision 固定的以下策略：

| completionPolicyRef | 适用 Task | 局部完成条件 |
| --- | --- | --- |
| `analyst-task/v1` | `analyze` | 预期 effect 齐全、仅写 Analyst kind、Schema/来源/本地证据有效；产出 analysis 时 ImpactProfile 完整，openQuestions 均有治理处置 |
| `architect-task/v1` | `design` | 预期 effect 齐全、仅写 Architect kind、Schema/来源/本地证据有效 |
| `critic-review/v1` | `review` | CriticReport 合法、覆盖全部冻结 targets、Finding refs 属于本 Attempt、评审快照匹配 |
| `rework-task/v1` | `rework` | successor revision 合法、每个目标 Finding 有 resolution claim，并重新满足 Schema/来源/证据 |
| `critic-verify/v1` | `verify` | 每个目标 Finding 有 `resolved | still_open` 验证结果，目标是合法 successor revision，覆盖与快照匹配 |

- Completion validator 对本 Attempt 的暂存候选视图执行；只有全部通过才按 A02 的事务规则发布副作用。
- Task completed 不表示其 Artifact 已 human-approved，也不表示整包 Readiness 通过。
- Engine 在 Readiness 阶段重新执行同一 Schema 与证据检查；不能复用一个不可验证的历史布尔值。

### 5. Artifact Revision 生命周期

| 状态 | 含义 | 是否进入有效视图 | 是否可进入 Readiness |
| --- | --- | --- | --- |
| `draft` | Attempt 暂存或未完成候选 | 否 | 否 |
| `pending` | 成功 Attempt 已发布的当前候选 | 是 | 是，仍需其余门禁 |
| `approved` | 真实人工已接受的不可变 revision | 是 | 是 |
| `rejected` | 真实人工明确打回的 revision | 历史可见，不得作为 current | 否 |

- Artifact 内容不可变；状态和 current-revision 投影是治理事实。每个 Required ArtifactKind 在一个治理快照中必须恰有一个 current revision。
- 正常路径不要求逐份人工批准。Readiness 可包含 `pending | approved`；最终 ApprovalPacket 获批时，包内全部 pending revisions 在同一事务中产生 revision Approval 并转为 approved。
- 人工可以提前单独批准或拒绝 revision。批准不继承：产生 successor revision 后，旧 approved 仍是历史，新的 current revision 从 draft/pending 开始，旧 Readiness 与 ApprovalPacket 立即失效。
- rejected revision 不可恢复或原地修改；返工必须产生带 predecessor/fork provenance 的新 revision。

### 6. Evidence Coverage 硬门禁

Evidence 分成输入血缘和仓库证据，二者不可互相替代：

1. **输入血缘**：每个当前必需 revision 必须从产生它的 Task/Context Manifest 追溯到 Requirement revision，以及它直接使用的 Artifact/Decision/Finding/humanDirective。
2. **仓库证据**：`analysis`、`design` 及被要求的 `architecture/data/api` 当前 revision，各至少一个有效 TraceLink。`scenario/usecase/function` 默认只要求输入血缘；若声明具体代码事实，该声明仍必须有 TraceLink。

所有最终 revision 的 TraceLink 必须指向 ApprovalPacket 固定的同一个 EvidenceSnapshot，并满足：

- source revision/Decision 存在且属于同一 Requirement；
- EvidenceSnapshot 与最终 repository snapshot 相同；
- file/symbol/node 在该快照中存在，行区间合法；
- major/critical Decision 至少有 TraceLink 或显式 humanDirective 依据。

EvidenceSnapshot 变化会使相关 TraceLink coverage、Critic coverage、Consistency Report、Readiness 与 ApprovalPacket 全部过期。较旧快照上产生的 Artifact 可以保留历史，但必须在当前快照上重新取证或返工后才能进入最终包。

### 7. Decision 门禁

Decision 严重度固定为 `critical | major | minor`；状态固定为 `open | accepted | rejected | deferred`。

| 严重度 | 可进入 Readiness 的状态 | 额外要求 |
| --- | --- | --- |
| critical | accepted / rejected | 必须真实人工决定并记录 Approval；不可 deferred |
| major | accepted / rejected | 必须真实人工决定并记录 Approval；不可 deferred |
| minor | accepted / rejected / deferred | deferred 必须有 reason、owner、followUpTarget，且不得影响当前 Required Artifact 正确性 |

任何 severity 的 open Decision 都阻塞。Agent 只能通过 `raise_decision` 创建 open Decision，不能改变状态或伪造人类选择。accepted 必须绑定合法 option；rejected/deferred 必须记录理由。具体人工命令与多人幂等由「人工接管、决策与审批语义」落实。

### 8. Finding Thread、返工与风险接受

Finding 严重度固定为 `critical | major | minor | info`；治理状态固定为 `open | resolution_proposed | resolved | accepted_risk`。

| 严重度 | Readiness 规则 |
| --- | --- |
| critical | 只能 resolved；不允许 accepted_risk，且必须由 Critic verify |
| major | resolved 且 Critic verify，或由真实人工显式 accepted_risk |
| minor / info | 可保持 open/resolution_proposed 进入 ApprovalPacket；最终包批准即表示人工看见并接受这些非阻塞风险 |

- 首次 Finding 生成稳定 fingerprint，形成 Finding Thread。目标 revision 被 successor 替换不会自动关闭或重置问题。
- `rework` Task 必须引用 Finding，产出 successor revision 和结构化 resolution claim。
- `verify` Task 的 CriticReport 必须增加 `verificationResults[]`，每项为 `findingId + successorRevisionId + result(resolved|still_open) + evidenceRefs`。Engine 根据合法结果更新 Finding；Critic 不直接写治理状态。
- 同一 Finding Thread 最多自动执行两轮 rework→verify。第二轮仍 `still_open` 时，Engine 打开 Blocking Gate；只有人工干预后才可继续，且仍受 A03 的连续五个 PlanRevision 全局预算约束。
- verify 发现的新问题按 fingerprint 归并到已有 Thread 或创建新 Thread；改标题、换 revision 或重复 Finding 都不能刷新循环预算。

### 9. Critic 是所有 Workflow 的必经门禁

- 每个 Workflow 在首次完整 Required Artifact Set 后都必须有 `review` Task，不提供低风险跳过或人工 skip。
- initial review 对 ApprovalPacket 将包含的所有精确 revision 做 `initial_blind` 覆盖；允许零 Finding，但必须有完整 coverage attestation。
- 返工后可只对受影响 successor revisions 与目标 Finding 做 `rework_verification`；Engine 最终必须证明所有包内 revision 都有未过期覆盖。
- Artifact revision、Required Artifact Set、accepted major/critical Decision 或 EvidenceSnapshot 变化，都会使相关 Critic coverage 过期。
- Critic 只提供 Finding 与验证事实，不输出批准、拒绝、blocked 或 replan；Engine 根据本策略产生返工或门禁。

### 10. Consistency Report

一致性结果必须是版本化结构：

```text
checkId
policyVersion
governanceSnapshotVersion
requiredArtifactSetDigest
evidenceSnapshotId
subjectRefs[]
severity = error | warning | info
code
evidence
```

- `error` 表示高置信确定性不变量失败，一律阻塞 Readiness，不存在单 Workflow 人工豁免。
- `warning/info` 不阻塞，但必须进入 ApprovalPacket。
- 若某检查可能合理例外，它不得注册为 error；应降级 warning 或发布新版 Policy，而不是提供管理员打洞命令。
- Readiness 只接受与当前 governance snapshot、Required Artifact Set 和 EvidenceSnapshot 完全匹配的最新完整报告。
- 首版 error 检查至少覆盖：revision/current 唯一性、Schema 与来源引用、Artifact 所有权、Decision option、Finding verification、TraceLink 完整性、Critic coverage、Plan/Task 输入解析、无未发布 Staged Effect，以及当前 Required Artifact provenance 所依赖的执行 transcript 未丢失。

### 11. `ReadinessPolicy@v1` 纯函数

Engine 对当前治理快照逐条运行以下检查；任一失败都保持/返回 `running` 或按既定门禁进入 waiting，不生成可批准 Packet：

| Check ID | 必须成立的事实 |
| --- | --- |
| `workflow_tasks_terminal` | 当前 Plan 无活动 Attempt，所有必需 Task completed/skipped_satisfied，无 failed/waiting_for_replan |
| `no_blocking_gate` | 无 open Blocking Gate |
| `impact_profile_complete` | 六个影响维度均为 yes/no，Required Artifact Set 可确定 |
| `required_artifacts_complete` | 每个必需 kind 恰有一个 current pending/approved revision，且内容 Schema 有效 |
| `no_unpublished_effects` | 无活动或未发布 Staged Effect |
| `evidence_coverage_complete` | provenance、单一 EvidenceSnapshot 和 TraceLink 分层策略通过 |
| `decisions_disposed` | Decision 分级矩阵通过 |
| `findings_disposed` | Finding 分级矩阵与循环预算通过 |
| `critic_coverage_current` | 所有最终 revisions 的 Critic review/verify 覆盖未过期 |
| `consistency_errors_clear` | 当前完整 Consistency Report 无 error |
| `approval_packet_buildable` | Engine 可从上述精确事实生成并 hash ApprovalPacket |

```text
evaluateReadiness(workflowId, expectedVersion):
  snapshot = loadGovernanceSnapshot(workflowId)
  required = deriveRequiredArtifactSet(snapshot.requirement, snapshot.analysis)
  context = freezeEvaluationContext(snapshot, required)

  results = readinessPolicy.validators.map(v => v.evaluate(context))
  if any result.failed:
    invalidateCurrentApprovalPacketIfAny()
    return { ready: false, results }

  packet = buildApprovalPacket(context, results)
  digest = sha256(canonicalJson(packet))
  transaction(expectedVersion):
    persistImmutablePacket(packet, digest)
    transitionWorkflow(ready_to_archive)
  return { ready: true, packetId, digest, results }
```

不提供 `force-ready`。人工可以拒绝 ApprovalPacket、修改 Requirement、解决 Decision、接受允许接受的风险或要求 replace-plan；Engine 必须在事实变化后重新计算全部规则。

### 12. ApprovalPacket 契约

ApprovalPacket 是 Engine 确定性生成的不可变结构，至少包含：

1. Role Contract、Artifact Schema、Artifact/Readiness Policy 版本与 digest；
2. Requirement、Workflow、当前 PlanRevision、repository/EvidenceSnapshot 引用；
3. ImpactProfile、Required Artifact Set 及每个条件 kind 的派生理由；
4. 全部选定 Artifact revision 的内容、状态、digest 与 diff；diff 基线依次为最近 approved revision、predecessor revision、空；
5. Decision 选项、状态、人工 Approval 与证据；
6. Finding Thread、严重度、返工/验证历史、accepted-risk actor/reason；
7. Critic coverage、verificationResults 和零 Finding 声明；
8. provenance graph、TraceLink coverage 与 EvidenceSnapshot；
9. 完整 Consistency Report，包含非阻塞 warning/info；
10. Plan/Task/Attempt 结果摘要与逐条 Readiness check 结果。

原始模型 transcript、隐藏推理和全量工具输出不进入 Packet 正文，只提供审计链接。任何受治理输入、策略版本、revision、Decision/Finding 状态、Critic/Consistency 结果或 EvidenceSnapshot 变化都会产生不同 digest，并使旧 Packet/Approval 无效。人工 Approval 必须绑定当前 digest；批准事务同时批准包内 pending revisions，并将 minor/info open Finding 记录为该包内已知风险接受。

### 13. 对既有与下游票据的约束

- `CriticReport@v1` 需补充仅在 `rework_verification` 模式可用的 `verificationResults[]`；这完善「固定角色契约与上下文边界」中的首版 Schema，不赋予 Critic 状态写权限。
- 「人工接管、决策与审批语义」必须实现 Decision 处置、major Finding 风险接受、Packet 拒绝/批准及 digest 绑定；不得新增 force-ready、critical-risk acceptance 或 consistency-error waiver。
- 「Task 并发与写冲突策略」以每 Plan、每 ArtifactKind 单 writer 和发布时 base revision CAS 保证 current 唯一；Readiness 只在无活动治理 claim、Plan Task 全终态且无未发布 Staged Effect 时重算。
- 「编排持久化、API、事件与恢复契约」必须持久化 Policy/Schema 版本、Required Artifact Set、provenance、Finding Thread/cycle、Critic coverage、Consistency Report、ApprovalPacket/digest 与失效事件。
- 「实施切面、测试矩阵与发布门禁」必须用有效/无效 Artifact 样例、证据过期、Decision/Finding 矩阵、两轮返工上限、Packet digest 失效和不可 force-ready 覆盖本策略。

