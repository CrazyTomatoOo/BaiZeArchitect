# 实施切面、测试矩阵与发布门禁 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: [Artifact 完成度与质量门禁](A04-artifact-readiness-and-quality-gates.md), [自动工作流与人工接管交互原型](A07-automatic-workflow-operator-experience.md), [自动编排切换与旧路径删除策略](A08-cutover-and-obsolete-path-removal.md)

## Question

全部契约确定后，实施应如何切成每一步都可验证、可回退且不留下半成品双轨的纵向切面？需要决定：

- Store/状态机、计划器、专业任务执行、质量门禁、人工控制、Web 投影和 cutover 的依赖顺序；
- 每个切面的最小端到端能力、必须立即删除的旧符号/路由/表和完成判据；
- CutoverReport check/apply、LegacyRequirementBundle、legacy_pre_policy archive、pending re-entry、ReusableAsset 与配对快照回退如何落入 fixture/crash-point 测试，且不产生可部署双轨；
- 状态转换、Plan Schema、权限越界、自动返工、人工暂停、崩溃恢复、SSE 重放和归档门禁的测试矩阵；
- 无模型 API Key 的确定性测试替身，以及有模型的黄金需求验收集；
- 观测指标、失败预算、发布/回退条件和旧路径最终删除时点；
- 最终《自动优先需求设计编排实施规格》的目录和评审清单。

输出应是可直接交给实现阶段的分层计划、命令级验证清单和发布门禁。

## Resolution（2026-08-11）

机器可读实施与验收资产：[`implementation-plan-v1.json`](../assets/implementation-plan-v1.json)。本票与该资产构成最终《自动优先需求设计编排实施规格》的执行入口；地图继续只做决策索引，不复制各票细节。

### 1. 实施组织：依赖栈评审，单次可部署切换

- 实施使用七个有依赖的纵向切面。切面可分别提交、测试和评审，但 S1–S6 的新 Workflow Store、Engine、HTTP 与 Web 只能由测试入口装配，不能注册到生产 main。
- 实施期间不存在运行时 feature flag、双写、旧 API adapter、影子写或新旧入口并存。可部署版本只有“切换前完整旧系统”和“S7 后完整新系统”。
- S1–S6 保持旧生产 smoke 仍可运行；它们的可回退含义是撤销该切面及其依赖下游提交，因为没有生产数据使用新 schema。
- S7 在同一可部署版本中接通新 Gateway/Web，并硬删旧 Route、UI、Role/Skill、共享 Session、Store 方法、`run_locks`、schema 和 smoke 断言。
- 第一次新业务写入前，S7 可通过配对 DB/Session 快照恢复旧二进制；第一次写入后禁止回退，只能停新写并前向修复。

### 2. 七个纵向切面

| 切面 | 最小端到端结果 | 主要完成判据 |
| --- | --- | --- |
| S1 确定性契约测试架 | 所有 Wayfinder 机器契约可执行；生产 `PiModelDriver` 与测试 `ScriptedModelDriver` 有显式注入边界 | 无网络、无 API Key 时，固定 Clock/ID/Digest/Snapshot/Actor 和脚本模型输出字节稳定；任何工具顺序或参数偏差立即失败 |
| S2 Workflow 治理内核 | Requirement 创建 `pending` Workflow；状态、Command Receipt、Workflow Event、Incident、Outbox 和启动恢复形成原子闭环 | headless 测试可 create/start/pause/resume/fail/recover；事务中断无部分 receipt/state/event/outbox |
| S3 计划与 Task 执行 | Planning Task 产生并采用 Plan；串行 Task→Attempt→Run 使用 claim、隔离 Session、ContextManifest 和暂存副作用 | Scripted Model 完成有序 DAG；非法计划、越权、输出错误、竞态和迟到结果均按契约收敛且无部分发布 |
| S4 Artifact 质量闭环 | Analyst/Architect/Critic 产物、Evidence、Decision/Finding、两轮返工和 Readiness 最终形成 ApprovalPacket | 11 项 Readiness 独立验证；缺任一产物、证据、处置、Critic coverage 或 transcript 都不能 ready |
| S5 人工控制与公开 API | 统一 Command、Operator Session、Projection、Workflow/Run SSE、Approval、Recovery 和 Diagnostic Run 可通过测试服务器端到端使用 | 仅用 `workflow-api/v1` 完成 create→archive、冲突、重放、恢复；新 Route 尚未注册生产 main |
| S6 Web 操作体验 | 引导式概览、同页详情、门禁队列、专注审批和独立审计视图对接新 API | 六状态、Receipt/SSE、stale、审批与三 viewport/a11y E2E 通过；生产 shell 仍未切换 |
| S7 Cutover 与硬删除 | `check/apply` 迁移历史、切换新入口、删除全部旧表面并替换 Compose smoke | 全部 PR/RC 门禁、真实副本 rehearsal、黄金集、负向旧符号扫描和 `workflow-doctor` 通过，形成唯一可部署新版本 |

每个切面的具体目标路径、行为、测试、完成门禁和撤销范围以 `implementation-plan/v1` 为准。实现可以在不改变契约的前提下调整文件拆分，但不能跨越切面完成门禁提前暴露生产入口。

### 3. 无 Key 的确定性 Model Driver

- 定义唯一 `ModelDriver` 边界。生产入口只构造 `PiModelDriver`；测试入口直接注入 `ScriptedModelDriver`，生产环境变量和 HTTP 均不能选择测试 Driver。
- 每个脚本 fixture 精确声明 role、Context digest、按序工具调用、最终结构化结果和可选 Crash Point；少调用、多调用、错序、错参或 digest 不符均使测试失败。
- Clock、ID、hash、RepositorySnapshot、Actor、model usage、Outbox transport 和 crash injector 都由测试显式注入。
- Compose 无网 smoke 使用专门测试装配注入 Scripted Driver，但通过最终生产 HTTP/Web 契约执行；不能以真实模型失败作为“smoke 通过”。
- 不使用真实模型录制回放作为 PR fixture，也不在普通 PR CI 中要求模型凭据。

### 4. 必测矩阵

#### Contract 与 Schema

- 所有 JSON 资产解析、版本和交叉引用；PlanProposal 每条静态规则至少一个负例。
- 九种 Artifact kind 各有最小正例，以及缺字段、多字段、错类型、错误 `sourceRefs` 负例。
- Role 输入/输出、Skill/Contract 固定、工具矩阵和 Artifact 唯一写所有权。
- Cutover、API、Persistence 的 removed surfaces 清单必须相等或为明确子集。

#### 状态、命令与权限

- 七个 Workflow 状态 × 全部 Command × `workflow:operate/workflow:approve` × 正确/过期 Workflow 与 subject version。
- 同 commandId 同 digest 重放、异 digest 冲突、两个合法并发命令首个持久提交获胜。
- pause、steer、cancel-run、replace-plan、revise-requirement、Decision 改选与 Approval 撤销对活动 Attempt 的精确影响。

#### Plan、Task、Role 与质量

- Plan DAG、深度/数量预算、TaskKind/Role、输入祖先、write-set、completion policy 与禁止 DSL/latest。
- 单 governance claim、单 diagnostic claim、稳定拓扑顺序、当前 Task retry 优先、terminal CAS 与迟到结果丢弃。
- ImpactProfile 每个维度到 Required Artifact Set 的映射；unknown 阻塞。
- 11 项 Readiness 各自单独为 false、其余十项为 true；不得 force-ready。
- Critic 首次盲审、零 Finding 覆盖、定向复审、Finding severity、两轮返工上限和 major risk acceptance。
- ApprovalPacket 对每项受治理输入变化都改变 digest；批准与归档同一事务。

#### HTTP、SSE 与 Web

- Operator bootstrap Cookie 安全属性、统一 PUT Command、bounded Projection 和分页历史。
- Workflow/Run SSE 分流、Last-Event-ID 重放、断线重连、retention 越界和先 Receipt 后 Projection 收敛。
- Web 覆盖 running/waiting/rework/failed/ready/paused-stale、单主动作、同页详情、Gate Queue、专注审批、审计、三 viewport、键盘/focus/dialog/live-region。
- 负向断言：不存在 Reviewer、角色选择、自由 Prompt Run、直接归档和旧 endpoint 调用。

### 5. Runtime 与 Cutover Crash Point

Runtime 至少在以下事务边界真实中断并重启：

1. Command commit 后、Outbox delivery 前；
2. Attempt/Run commit 后、模型派发前；
3. 模型派发后、running ack 前；
4. result snapshot 后、Attempt finalize 前；
5. effects staged 后、publication 前；
6. effect publication commit 后、Outbox delivery 前；
7. 外部副作用完成后、Outbox delivery mark 前；
8. claim restore 后、redispatch 前。

Cutover fixture 不提交不透明二进制，而由声明式 manifest 在临时目录生成真实旧 SQLite 与 Session 文件树。固定集合为：empty、完整 legacy archive、缺 attachment、pending re-entry、manual asset source、三类混合、活动旧 Run 阻塞、DB/Session fingerprint 不符、非法旧 JSON、重复 apply。

每组均执行 check、apply、重复 apply、对账和旧表面负向扫描。另在配对备份后、CutoverReport 后、migration 事务中、commit 后启动前、启动后首次业务写前终止真实子进程；重启后只允许“完整旧状态”或“完整新状态”，不允许混合状态。

### 6. CI 与命令级门禁

实现必须新增并维护这些 `agent-runtime` scripts：

```text
test:contracts
test:integration
test:recovery
test:cutover
test:workflow-smoke
test:golden
workflow:doctor
cutover:check
cutover:apply
```

每个 PR 无 Key 强制运行：

```bash
npm --prefix agent-runtime ci
npm --prefix agent-runtime run typecheck
npm --prefix agent-runtime test
npm --prefix agent-runtime run test:contracts
npm --prefix agent-runtime run test:integration
npm --prefix agent-runtime run test:recovery
npm --prefix agent-runtime run test:cutover

npm --prefix web ci
npm --prefix web run typecheck
npm --prefix web test
npm --prefix web run build
npm --prefix web run test:e2e

trap 'docker compose down -v' EXIT
docker compose build
docker compose up -d
npm --prefix agent-runtime run test:workflow-smoke
```

PR 必需 Job 分为 contracts/static negative scan、runtime unit/typecheck、SQLite integration、recovery/crash、cutover fixture、Web unit/build、三 viewport Playwright、network-none Compose 自动工作流 smoke。不得把其中任何一项只放 nightly；nightly 仅增加 seed、模型种类和长时 soak。

Release Candidate 另需：

```bash
npm --prefix agent-runtime run test:golden
npm --prefix agent-runtime run cutover:check -- --db <copy.db> --sessions <copy-dir> --out <report>
npm --prefix agent-runtime run cutover:apply -- --report <report> --db <rehearsal.db> --sessions <rehearsal-dir>
npm --prefix agent-runtime run workflow:doctor -- --db <rehearsal.db> --sessions <rehearsal-dir> --format json
```

真实副本演练必须在隔离目录，绝不操作生产原件。命令实际参数名可按 CLI 框架实现，但 package script 名称、输入对象和门禁语义固定。

### 7. 真实模型黄金 Requirement

使用冻结 Repository Snapshot 的八个案例：最小闭环、全量 architecture/data/api 影响、必填 Human Input、critical Decision、Critic 返工关闭、major Finding 风险接受、steer 安全重规划、首次非法计划/结果在预算内恢复。

- 每个案例运行 3 次，共 24 次；只在有凭据的 RC 环境运行。
- 越权、错误归档、错误 subject/digest、错误状态转换等安全不变量通过率必须 100%。
- 每个案例至少 2/3 达到预期门禁或 `ready_to_archive`；总体预期结果率至少 90%。
- 所有成功必须在既定 Plan/Task/Attempt/Rework 预算内。
- 不比较自然语言全文、Task 精确数量或具体方案措辞；比较 Schema、治理事实、证据、门禁和终态。

### 8. 发布、回退和 24 小时守护期

发布采用维护窗口全量切换，不做 workspace 灰度：

1. 所有 PR 与 RC 门禁通过；
2. 停业务写入，确认无 queued/running 旧 Run；
3. 创建并验证配对 DB/Session 快照及旧二进制恢复命令；
4. 运行 `cutover check`，apply 输入必须匹配 Report digest；
5. 运行 `cutover apply` 并启动唯一新版本；
6. 执行 post-migration gates、`workflow-doctor`、network-none smoke 与 RC 证据检查；
7. 全部通过后才开放第一次业务写入。

首次业务写前失败可恢复配对快照和旧二进制；首次业务写后禁止回退。发生零容忍问题时立即停止新写入并前向修复。开放后 24 小时加强告警和值守，但不引入 allowlist、shadow write 或旧路径 fallback。

### 9. 可观测性与失败预算

首发不新增 Prometheus 或产品指标后台。事实来自 `workflow_events`、`workflow_incidents`、`workflow_commands`、结构化日志和只读 `workflow-doctor` JSON 报告。Doctor 与 CI 使用同一检查器，覆盖 DB/Session fingerprint、Claim、事件序号、Outbox、Attempt/effect、Approval/Packet digest、Consistency/transcript 与旧表面残留。

以下失败预算为零，任一发生即阻止发布；守护期发生则停止新写：错误归档、受治理 subject digest 不匹配、事件断序、Receipt 重放不一致、orphan Claim、失败/取消/superseded Attempt 发布 effect、Consistency error、当前 provenance transcript 缺失、Outbox exhausted、Cutover 对账差异、旧写路径仍可达。

Plan 首次通过率、PlanRevision 数、Attempt 重试率、返工轮数、门禁/接管率、time-to-ready、模型 Token/延迟、Finding 严重度/关闭率首发只记录，不预设武断阈值。累计至少 20 个真实完成 Workflow 后再开决策票判断 Skill/Gene 或指标门禁；本实施不做自动学习。

### 10. 最终完成定义

只有同时满足以下条件，自动编排改造才算完成：

- 七个切面的完成门禁全部通过；
- PR 与 RC 全部门禁通过；
- 生产 main 只有一条自动 Workflow 路径；
- cutover-policy 列出的旧 Route、符号、UI、Role、Skill、表和列全部由负向扫描确认不存在；
- network-none Compose smoke 经 Scripted Model 与真实 Command API 到达 archived；
- 真实模型黄金集满足 100% 安全不变量、每例 2/3、总体 90%；
- CutoverReport、MigrationAttestation、配对备份证据和 Doctor 报告已保存；
- 发布时无零容忍事件；
- README、API 文档和操作说明只描述新路径。

本决策关闭后，地图不再有未指定实现问题。后续工作应离开 Wayfinder，严格按 S1→S7 进入实现；若实现发现必须改变已定治理语义，应新开决策 effort，而不是在代码中静默偏离。
