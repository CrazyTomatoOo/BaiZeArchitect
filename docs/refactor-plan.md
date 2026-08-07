# BaiZe 受限领域 Agent 重构方案

> Wayfinder 图 `.wayfinder/2026-08-domain-agent-refactor/` 的终点产物。
> 决策依据：R01 运行契约、R02 Pi 能力调研、R03 产物治理、R04 工具策略。

## 目标

将当前固定阶段 LLM 流水线重构为持续运行、持久会话、受控领域工具、可审计 Artifact 闭环的领域 Agent；保留 Node + Pi SDK + Lit Web + 单进程 SQLite，不预置企业化中间件。

## 目标架构

```text
Web / CLI
  → Domain Gateway（唯一入口，长期运行）
    → Design Session / Run / Event / Approval（SQLite 拥有）
      → 受限需求设计 Agent Loop（Pi JSONL 拥有 transcript）
        → 领域工具层（9 工具，禁用 shell）
          → 代码知识 / 设计记忆 / Artifact / 决策 / 校验
```

- **Pi 管**：对话 transcript、工具循环、模型调用、thinking。
- **BaiZe SQLite 管**：Run、Session 映射、事件序列、锁、审批、Artifact/Decision/Finding/Evidence/Trace、DesignPackage。

## 核心决策摘要

| 维度 | 决策 |
| --- | --- |
| 运行入口 | Gateway 唯一；`cli.ts` 退役为 Gateway 客户端；删除 `server.ts` |
| 会话粒度 | 一个 Requirement = 一个持久主会话；顺序多 Run；归档后只读 |
| Run 模型 | 异步、先落库再执行、可恢复、事件可重放、支持 steer/cancel |
| 自主边界 | 证据驱动门禁：仅重大决策、最终归档、阻塞裁决阻塞人 |
| Critic | 主会话内隔离子 Run（独立 pi session，只读上游） |
| 产物 | 全部一等实体；Artifact 不可变 + Revision 链 |
| 审批 | 三点：ArtifactRevision / 重大 Decision / 归档 DesignPackage |
| 归档闭环 | DesignPackage 快照 + `search_prior_designs` 工具检索注入 |
| 证据 | Req 级设计时快照 + TraceLink 引用到 Artifact/Decision |
| 工具 | 纯领域 9 工具，禁用 bash/read/grep/find |
| Skill | 角色模式 + 版本化 + IO Schema 校验；DRAFT→STABLE |
| 证据注入 | Agent 主动调工具取证，不自动全量注入 |
| 工具治理 | 超时 + 结果裁剪 + 全量审计 + 门禁分层 |
| 兼容层 | 无；即删即替 |
| 现有数据 | 一次性迁移后删旧表 |

## 迁移切面（自底向上，无兼容层）

每切面完成即删除被取代的旧路径，遵循“不保留向后兼容”。

### 切面 1 — 运行基础设施

**新增**：`design_sessions`、`runs`、`run_events`(seq 递增)、`run_locks` 表；异步 Run 执行器（先落库 → 执行 → 终态）；按 Run 订阅的 SSE + 事件重放；`steer`/`cancel` 端点委托 `session.steer()`/`session.abort()`；重启后“运行中”Run 收敛为失败可重跑。

**替换**：`runStage`/`chatIntake` 的 `SessionManager.inMemory` → `SessionManager.create/open`（Pi JSONL），session 文件/id 落 SQLite。

**删除**：全局 `Set<ServerResponse>` 广播；`runStage` finally 中的立即 `dispose`（生命周期上移到 Run）。

**完成判据**：Run 重启后状态可查；SSE 断线重连可重放；并发同需求 Run 被锁拒绝；steer/cancel 端点可用。

### 切面 2 — 领域内核

**新增**：`artifacts`、`artifact_revisions`(fork_from)、`decisions`(+options)、`findings`、`evidence_snapshots`、`approvals`(actor/time/reason/diff)、`trace_links`、`design_packages` 表；启用外键约束；`writeStageAssets` 清旧-写新-改阶段事务化；删 Workspace 级联清理。

**迁移**：现有 `workspaces/requirements/stage_progress/scenarios/use_cases/function_*` → Artifact/Revision 模型，一次性转换后删旧表；`evidence/*.json` → `evidence_snapshots`；`out/*.md` 不迁移（仅导出格式）。

**完成判据**：任一 ArtifactRevision/Decision/Approval 可追溯到需求、证据、Run；打回生成新 revision 且 fork-from 链完整；级联删除无残留。

### 切面 3 — 受限工具层

**新增**：9 工具（`inspect_repository`/`search_code`/`get_architecture`/`search_prior_designs`/`get_artifact`/`patch_artifact`/`raise_decision`/`record_finding`/`run_consistency_check`/`request_human_input`）；禁用 `bash`/`read`/`grep`/`find`；每工具超时(检索 30s/校验 120s)+结果裁剪(N 条/N 字符)+全量审计落库；只读自动放行，写工具受门禁约束；Skill 版本化 + IO Schema 校验。

**完成判据**：Agent 能取证并 TraceLink 引用；工具调用审计可查；写工具触发门禁；无任意 shell 可达。

### 切面 4 — Agent 闭环

**新增**：持久主会话编排器（按 Requirement 创建/恢复 pi session，顺序多 Run，归档冻结）；角色模式加载 Skill；Critic 隔离子 Run；证据驱动门禁实现（`raise_decision`/归档/阻塞裁决阻塞人）；`search_prior_designs` 注入历史 DesignPackage 替代 `latestDesignPackage` 文件扫描。

**删除**：`STAGE_ORDER` 固定串行编排；逐阶段固定审批；`runDesign` 的 architect+critic 双 phase（被主会话+隔离子 Run 取代）。

**完成判据**：一个需求从澄清到归档在同一会话延续；Critic 子 Run 不污染主会话；归档后主会话只读；历史 DesignPackage 可被下次设计检索注入。

### 切面 5 — 下线旧路径

**删除**：`cli.ts` 独立流水线（降级为 Gateway 客户端或删除）；`server.ts` + `/runtime/plan`；`stage_progress` + `artifact_refs` JSON；`runStage` 固定阶段；`latestDesignPackage`/`runArchive` 文件扫描归档；旧产物路径。

**完成判据**：仓库内无两套运行路径；事实源唯一在 SQLite；Markdown 仅作导出。

## 验收标准（端到端）

1. 服务重启后，设计会话、Run 状态、审批记录、事件可查询。
2. Agent 可基于代码证据和历史设计修改 ArtifactRevision。
3. 任一 ArtifactRevision/Decision/Approval 可追溯到需求、证据、Run。
4. 并发运行同一需求被锁拒绝，不产生重复资产。
5. 用户可在运行中 steer，下一轮 Agent 吸收。
6. 归档、设计记忆、Gene 形成可验证闭环（历史 DesignPackage 注入下次设计）。
7. Web 不再保存 Agent 对话和编排状态，只显示 Gateway 状态。
8. Critic 子 Run 与主会话上下文隔离。

## 发布门禁

每切面须通过：类型检查、`node --test`、smoke-gateway 端到端、新增的对应切面验收。切面 5 完成后全量回归，方可视为重构落地。
