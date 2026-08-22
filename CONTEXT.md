# BaiZe 需求设计

BaiZe 需求设计上下文描述一个已确认需求从开始设计、自动推进、人工门禁到最终归档的治理语言。

> Store（存储域）子域词表（Workspace / Reusable Asset / Actor / Snapshot Document）见 [agent-runtime/persistence/CONTEXT.md](agent-runtime/persistence/CONTEXT.md)；上下文关系见 [CONTEXT-MAP.md](CONTEXT-MAP.md)。

## Language

**Requirement（需求）**:
用户确认的一项设计意图，也是一次完整设计治理生命周期的边界。
_Avoid_: 工单、任务、Workflow

**Workflow（工作流）**:
一个 Requirement 从待开始到归档的唯一治理生命周期。
_Avoid_: 固定流水线、阶段链、Run

**Plan Revision（计划版本）**:
Workflow 在某一时刻采用的不可变工作计划；重新规划产生新版本，不覆盖历史版本。
_Avoid_: 可变计划、Prompt

**Task（设计任务）**:
计划中一项有明确角色契约、输入、预期输出、依赖和完成条件的设计工作。
_Avoid_: Run、Stage

**Attempt（执行尝试）**:
Task 的一次执行尝试；重试形成新的 Attempt，并保留之前的失败记录。
_Avoid_: Task、Retry Run

**Run（运行）**:
一次 Attempt 的模型与工具执行记录，不拥有 Workflow 的治理状态。
_Avoid_: Workflow、Task

**Design Session（设计会话）**:
绑定 Requirement、仅承载人与系统的需求级治理交互、接管和审批记录的持久会话；不作为专业角色共享记忆。
_Avoid_: Workflow、Run

**Blocking Gate（阻塞门禁）**:
在人工补充信息、解决重大决策或接受风险前禁止自动推进的治理条件。
_Avoid_: 普通 Finding、非阻塞 Decision

**Readiness Policy（就绪策略）**:
判断 Workflow 是否具备提交最终归档审批条件的一组确定性规则。
_Avoid_: 模型自评、自动归档

**Role Contract（角色契约）**:
某个 Agent Role 的不可变版本化执行边界，包含输入输出 Schema、Skill、工具权限、读写策略和完成条件。
_Avoid_: 人格 Prompt、动态角色

**Context Manifest（上下文清单）**:
一次 Attempt 可见事实与版本引用的不可变清单，用于隔离角色并固定输入边界。
_Avoid_: 共享聊天记忆、读取最新值

**Review Bundle（评审包）**:
交给 Critic 的冻结 Artifact revisions、已接受 Decision、仓库快照及定向复审 Finding 集合。
_Avoid_: 主会话、可变工作区

**Staged Effect（暂存副作用）**:
Agent 在 Attempt 内通过写工具产生、但尚未进入当前有效治理视图的候选 Artifact revision、Finding、Decision 或门禁提案。
_Avoid_: 已发布事实、工具临时文本

**Approval Packet（审批包）**:
Readiness 通过后由 Engine 从冻结治理事实确定性组装、以内容摘要绑定真实人工审批的不可变材料集合。
_Avoid_: Reviewer 输出、模型批准

**Plan Proposal（计划提案）**:
Orchestrator 或人工提交、尚未被 Engine 采用的完整有限 Task DAG；只有通过版本和静态校验后才形成 Plan Revision。
_Avoid_: 已采用计划、自由 Prompt

**Planning Task（规划任务）**:
由 Engine 直接创建并交给 Orchestrator、用于产生 Plan Proposal 的 Task；仍遵守 Task → Attempt → Run。
_Avoid_: 隐式模型调用、PlanningRun

**Task Output Binding（任务输出绑定）**:
Plan 中对依赖祖先预期 Artifact 输出的符号引用；Task 激活时必须解析为唯一精确 revision。
_Avoid_: latest、动态查询

**Replacement Proposal（替代计划提案）**:
人工接管时提交、使用同一 PlanProposal Schema 和校验器并产生新 Plan Revision 的完整 DAG。
_Avoid_: 原地 PlanPatch、覆盖历史

**Impact Profile（影响画像）**:
Analyst 对 Requirement 是否影响流程、参与者、行为、架构、数据和接口所作的结构化事实声明。
_Avoid_: Artifact 清单、Orchestrator 自选范围

**Required Artifact Set（必需产物集）**:
Engine 依据版本化 Artifact Policy 从 Requirement 基线与 Impact Profile 确定性派生的本次设计必需 ArtifactKind 集合。
_Avoid_: Plan 建议、所有 ArtifactKind

**Evidence Coverage（证据覆盖）**:
Readiness Policy 对当前必需 Artifact revisions 的输入血缘，以及代码相关产物对同一 Evidence Snapshot 中有效 TraceLink 的覆盖要求。
_Avoid_: Evidence Snapshot 存在性、模型声称已取证

**Finding Thread（发现线程）**:
同一问题跨 Artifact revisions 的稳定治理身份；通过 fingerprint 关联返工、验证、风险接受与自动循环预算。
_Avoid_: 单次 Critic 文本、每次返工产生的新问题编号

**Artifact Policy（产物策略）**:
Engine 用来从 Impact Profile 派生 Required Artifact Set，并绑定内容 Schema、完成、证据与 Readiness 规则的版本化策略。
_Avoid_: Orchestrator 建议、单次人工豁免

**Human Directive（人工指令）**:
由 steer 追加、供后续 Planning Context 使用的版本化人工方向；不注入或改写活动 Attempt。
_Avoid_: session.steer、自由 Prompt 覆盖

**Human Response（人工回答）**:
绑定 Blocking Gate 的不可变结构化回答，只解决该门禁并作为后续显式输入。
_Avoid_: Requirement revision、Decision disposition

**Decision Disposition（决策处置）**:
人类对一个 Decision 作出的不可变 accepted、rejected 或 deferred 记录；后续改选通过 superseding disposition 表达。
_Avoid_: 原地修改 Decision、Agent 选择

**Approval（批准记录）**:
可信人类对精确 subject version/digest 作出的不可变 approved 或 rejected 判断；撤销和替代使用追加记录。
_Avoid_: 可变状态位、模型意见

**Approval Revocation（批准撤销）**:
在归档前使一条 active Approval 失效的不可变人工记录，不删除或改写原批准。
_Avoid_: 删除 Approval、归档后 reopen

**Diagnostic Run（诊断运行）**:
人工指定固定角色、使用隔离 session 和只读上下文执行的非治理 Run；输出只供排障，不进入设计事实。
_Avoid_: force-role、手动 Task 主流程

**Concurrency Policy（并发策略）**:
规定 Workflow 内活动治理 Attempt、诊断 Run、调度顺序、写冲突和提交竞态的版本化 Engine 策略。
_Avoid_: 模型自行并发、进程线程池配置

**Workflow Attempt Claim（工作流尝试声明）**:
一个 Workflow 当前唯一活动治理 Attempt 的持久无租约声明，覆盖排队、运行、结果校验和副作用发布全过程。
_Avoid_: Run 锁、超时租约

**Artifact Write Key（产物写键）**:
由 Requirement 与 ArtifactKind 组成的逻辑 current 写入身份；同一 PlanRevision 每个写键最多一个 writer Task。
_Avoid_: 文件锁、Artifact revision id

**Effect Publication Token（副作用发布令牌）**:
Attempt 启动时固化 Plan、Task、Context、输入版本和 Artifact 写基线，并在发布 Staged Effect 前精确复核的不可变提交守卫。
_Avoid_: 仅 Workflow version、Run 未取消检查

**Repository Snapshot（仓库快照）**:
领域工具读取的内容寻址只读仓库视图，可包含未提交修改并跨 Attempt 去重复用。
_Avoid_: 实时工作树、仅记录 HEAD

**Workflow Event（工作流事件）**:
按 Workflow 内连续 seq 追加的版本化治理或审计事实；用于 SSE 回放与审计，不取代当前状态行。
_Avoid_: Run token、完整事件溯源

**Command Receipt（命令回执）**:
绑定 commandId、请求 digest、可信 Actor、expected/actual version 与首次结果的不可变幂等记录；业务拒绝同样保留。
_Avoid_: HTTP 临时响应、只记录成功命令

**Model Provider（模型提供方）**:
pi-ai 注册表中的一个模型服务端点与认证实体（原生 38 个 + 配置覆盖注册）；以 provider id 标识，密钥走该 provider 专属环境变量，不落配置文件。
_Avoid_: 模型、API 网关、bailian

**Model Catalog（模型目录）**:
配置声明的精选模型清单（provider × models 全量声明，配置即真相）；是用户可选模型与一切校验的唯一目录面，目录之外即非法。
_Avoid_: pi-ai 全量注册表、模型库、可选一切模型

**Model Profile（模型档）**:
按角色 (provider, modelId) 的完整四角色映射；部署默认档固化在 ModelConfig，需求在创建时可携带需求级档（API 字段 modelRoles），创建后不可改。
_Avoid_: 单模型设置、运行时切换、部分角色覆盖

**Model Usage（模型用量）**:
Run 记录中的 token 计数与所用 provider/model 身份（token run 事件），支持跨提供方对账。
_Avoid_: 无身份 token 计数、usage 本地日志

**Outbox Job（事务发件任务）**:
与治理变化同事务创建、在提交后幂等执行 Run 派发、收尾、中止或再次调度的持久任务。
_Avoid_: 进程内回调、SSE 消息

**Workflow Incident（工作流技术事件）**:
使单个 Workflow 进入 failed、可被精确诊断或恢复的版本化 Engine/outbox/reconciliation 故障 subject。
_Avoid_: Task Finding、未结构化错误字符串

**Operator Session（操作员会话）**:
由 Gateway 认证并映射到服务端固定 ActorRef/capabilities 的短期传输会话；领域审计保存 actor snapshot 而非依赖会话寿命。
_Avoid_: 客户端自报 actor、多用户账户目录

**Workflow Projection（工作流投影）**:
由当前状态行、版本化领域事实与连续事件序号组装的操作员读模型；页面可整体重取，但不能反向写入治理状态。
_Avoid_: 客户端状态机、Workflow Event 本身

**Gate Queue（门禁队列）**:
按严重度和 openedEventSeq 对当前 open Blocking Gate 形成的确定性操作员视图；每项仍使用独立 subject、命令和回执。
_Avoid_: 批量审批、第二套任务队列

**Cutover Report（切换报告）**:
对旧 schema、数据库与 session 指纹、迁移分类、anomaly、对账计数和删除面的内容寻址预检结果；apply 必须精确绑定其 digest。
_Avoid_: migration log、可跳过检查的清单

**Legacy Requirement Bundle（旧需求归档包）**:
cutover 时为一个旧 Requirement 生成、封存其旧会话、Run、Artifact 和治理行的只读内容寻址审计包；不进入新版 Readiness 或 PlanningContext。
_Avoid_: 当前 Artifact、兼容读取表

**Migration Attestation（迁移证明）**:
由编号 migration 生成、绑定 source/target schema、bundle digest、分类、anomaly 和 cutover actor 的不可变证明。
_Avoid_: 新版 Approval、人工补写记录

**Legacy Pre-policy Archive（策略前历史归档）**:
对切换前已归档 DesignPackage 的只读 archived Workflow 投影，由 migration attestation 而非新版 ApprovalPacket 证明其历史来源。
_Avoid_: governed archive、运行时可创建状态

**Implementation Slice（实施切面）**:
依赖实现栈中一段可独立评审和验证、但在最终 cutover 前不可成为生产入口的纵向能力交付。
_Avoid_: 可部署半成品、按 Store/API/Web 横切

**Scripted Model Driver（脚本模型驱动）**:
测试入口注入、按精确角色、上下文摘要、工具顺序和结构化结果执行的确定性模型替身；生产入口不可选择。
_Avoid_: 录制回放、模拟自然语言智能

**Golden Requirement（黄金需求）**:
使用冻结 Repository Snapshot 和真实模型重复执行、以治理事实与预期终点而非文案全文判定的发布验收案例。
_Avoid_: 单次演示、Prompt 快照测试

**Workflow Doctor（工作流诊断器）**:
只读检查 DB/Session 配对、Claim、事件、Outbox、Effect、Approval、Consistency 与旧表面残留并输出机器可读报告的统一发布检查器。
_Avoid_: 修复命令、常驻指标服务

**Guard Period（发布守护期）**:
首次新业务写入后的一段加强告警和值守窗口；发现零容忍不变量时停止新写并前向修复，不回退或启用旧路径。
_Avoid_: 灰度双轨、rollback window

> **Actor 消歧**：治理域的「Actor」指操作者身份（可信 Actor / ActorRef / actor snapshot，中文「操作员」）；Store 子域的 Actor（业务参与者，kind=actor，中文「参与者」）词条见 [agent-runtime/persistence/CONTEXT.md](agent-runtime/persistence/CONTEXT.md)。两者领域隔离，英文同名、中文不同词。
