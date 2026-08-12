# 自动编排切换与旧路径删除策略 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by: [固定角色契约与上下文边界](A02-fixed-role-contracts-and-context-boundaries.md), [Orchestrator 计划与执行器契约](A03-orchestrator-plan-and-executor-contract.md), [Artifact 完成度与质量门禁](A04-artifact-readiness-and-quality-gates.md), [编排持久化、API、事件与恢复契约](A06-persistence-api-events-and-recovery.md), [自动工作流与人工接管交互原型](A07-automatic-workflow-operator-experience.md)

## Question

在“不保留长期兼容层”的约束下，如何把现有通用手动 Run 切换为自动优先工作流，并删除 Reviewer Agent 与过时入口，同时保留必要的诊断和人工接管能力？需要决定：

- 现有 Requirement、DesignSession、Run、Artifact、Decision、Finding、Approval 与 EvidenceSnapshot 如何通过编号 migration 映射到目标 schema；哪些历史数据可保留、需冻结或必须拒绝自动迁移；
- 当前 `POST /api/requirements/:id/runs` 和角色下拉框如何退役，人工 force-role 以何种受审计接口保留；
- Reviewer Skill、角色枚举和相关 UI/测试的删除顺序；
- 进行中的旧 Run、已归档需求和未归档历史需求在切换时如何处理；
- 是否采用单次 cutover，还是短期 feature flag 仅用于发布回退，并明确何时删除；
- 哪些旧字段、事件和代码路径必须在每个实施切面后立即删除。

输出应是数据迁移与代码删除清单，不设计长期双轨运行。

## Resolution（2026-08-11）

机器可读策略：[`cutover-policy-v1.json`](../assets/cutover-policy-v1.json)。

### 1. 切换原则：停写式单次 cutover

- 自动编排以一次维护窗口切换，不使用运行时 feature flag、双写、影子主流程或旧 schema 读取 fallback。
- cutover 前停止 Gateway，并确保没有其他进程写 SQLite 或 Pi session 目录；新版本完成 migration、校验和恢复前不得监听业务 HTTP。
- 旧二进制、旧 Web 和旧 API 与新版本同时退役。不存在“旧路径只给管理员用”的隐藏入口。
- 回退只允许发生在首次 post-cutover 业务写入前：停止新版本，整体恢复配对的 SQLite 与 Pi session 目录快照，再启动旧二进制。一旦新系统接受任何 Requirement/Workflow Command/ReusableAsset 写入，只允许 roll forward。
- 不提供 down migration、选择性复制新行回旧库或重新打开旧路由。

### 2. 强制 `check → apply`

cutover 工具只有两个模式：

1. `cutover check` 只读旧库与 session 目录，生成内容寻址 `CutoverReport@v1`；
2. `cutover apply --report <digest>` 停写后重新计算数据库与 session 指纹，只有完全匹配报告才执行 migration。

CutoverReport 至少记录：

- 受支持旧 schema 的完整 fingerprint 与目标 migration checksum；
- SQLite、WAL 状态和 Pi session 目录 fingerprint；
- 每个 Requirement 的唯一迁移分类；
- queued/running/terminal Run 数量；
- 预计 LegacyRequirementBundle、MigrationAttestation 与 ReusableAsset 映射；
- 缺失 transcript/evidence/repository attachment anomaly；
- source table row-count、主键集合摘要和目标覆盖计数；
- 将被删除的表、列、路由、符号、组件、Skill 与文档引用。

apply 不接受 `--force`、skip Requirement、忽略活动 Run 或忽略计数差异。报告生成后任一数据库/session 字节变化都会使 digest stale，必须重新 check。

### 3. 历史数据的唯一三分类

| 分类 | 判定 | 迁移结果 |
| --- | --- | --- |
| `legacy_archived` | 普通 Requirement 的 DesignSession 已 archived，且恰有一个 DesignPackage | 保留 Requirement 身份和新 requirement baseline；创建只读 archived Workflow、LegacyRequirementBundle、MigrationAttestation 与 legacy DesignPackage |
| `pending_reentry` | 普通 Requirement 未归档 | 保留 Requirement 身份和新 requirement baseline；创建 pending Workflow 与新的治理 DesignSession，等待用户首次显式 start |
| `manual_asset_source` | Requirement `source=manual-assets`，或 `scenario/usecase/function` Artifact 的 revision 全部来自 `manual-asset` Run | 不创建 Workflow；迁为 workspace 级 ReusableAsset 后删除隐藏 Requirement/Run |

- 每个旧 Requirement 必须且只能命中一类。无法分类或手工/Agent provenance 混合时，migration 整体回滚并要求显式修复。
- `manual_asset_source` 还必须没有 DesignPackage、requirement gene、非 library Artifact、非 manual Run、Decision、Finding 或真实人工 Approval；否则不能删除其 Requirement 身份，check 必须阻塞。
- queued/running 旧 Run 是硬阻塞项。操作员必须在旧版本中等待完成或明确 cancel，然后重新 check；migration 不自动取消，也不创建伪失败 Attempt。
- completed/failed/cancelled 旧 Run 仅作为历史审计进入 LegacyRequirementBundle，不创建 Task、Attempt 或新版 Run，也不发布其模型文本。
- `legacy_archived` 与 `pending_reentry` 都创建一个新的 current requirement baseline，使用第 6 节同一确定性字段映射；两类差异只在 Workflow/DesignSession/DesignPackage 治理结果。

### 4. `LegacyRequirementBundle@v1`

每个普通 Requirement 生成一个内容寻址、只读的 `legacy_requirement_bundle` Snapshot Document，包含：

- 原 Requirement 行；
- 原 DesignSession 行与 transcript path/session id/digest/availability；
- 全部终态 Run、run_events 与 tool_calls；
- Artifact/revision、Decision/option、Finding、Approval；
- EvidenceSnapshot、TraceLink；
- DesignPackage 与 requirement gene links；
- 每张 source table 的 row-count、排序主键摘要和 canonical content digest。

旧 JSON 解析失败时保留原始文本/字节与摘要，不尝试修复。旧 Pi JSONL、Evidence 文件或 repository object 已缺失时记录类型化 anomaly 并继续，因为它们只服务历史审计；UI 必须显示“附件不完整”。会改变身份、分类、行数或引用完整性的异常仍阻塞整个 migration。

Legacy bundle 不是新版治理事实，不进入 Readiness、ApprovalPacket 或 PlanningContext；除非后来一个新 Task 显式引用已迁成 ReusableAsset 的精确 revision，否则 Engine 不读取旧 bundle 作为专业输入。

### 5. 已归档历史：`legacy_pre_policy`

- 旧归档没有新版 Packet digest、真实 ActorRef 或 Readiness 证明，migration 不得合成 governed ApprovalPacket/Approval。
- 迁移后的 Workflow 状态为 `archived`，PolicyBundle 为 `legacy-import/v1`，查询投影暴露 `archiveClass=legacy_pre_policy` 与“历史归档（切换前）”。
- MigrationAttestation 记录旧 DesignPackage、旧 Approval、bundle digest、anomaly、cutover actor、schema/checksum 和时间。
- legacy DesignPackage 的 `approval_packet_id/approval_id` 为空，改为绑定 `migration_attestation_document_id`；`archive_class=legacy_pre_policy`。
- 该 archiveClass 只能由编号 migration 创建。任何运行时命令、Agent 或状态转换都不能产生；它无出边，只允许 read/audit/export。
- 这是一项历史导入例外，不放宽新 Workflow “真实人工批准才 archived”的规则。

### 6. 未归档历史：从 `pending` 重新进入治理

- 保留 Requirement id、workspace、title 与 created_at；从旧 title/description 生成通过 `artifact/requirement/v1` Schema 的 current baseline revision：`summary/description = trim(description) || title`、`sourceRefs=[]`，并以 `source_migration_document_id` 绑定 MigrationAttestation。
- 旧 Artifact、Decision、Finding、Approval、Evidence 和 Run 只在 legacy bundle 中可见，不成为 current 专业事实，也不满足任何 completion/readiness policy。
- 创建 Workflow=`pending` 并固定当前生产 PolicyBundle；不会自动 start。用户首次明确 start 后，Engine 才创建 Planning Task。
- 旧共享 DesignSession transcript 进入 bundle；新 DesignSession 使用新的 governance session 文件。任何新 Attempt 都使用隔离 session，绝不续写旧主会话。
- Requirement baseline 之外不预建 Plan、Task、Attempt、Run、Gate、Decision、Finding、Packet、claim 或 outbox。

### 7. 手工资产库改为 `ReusableAsset`

当前 `ensureAssetRequirement()` + `ensureManualAssetRun()` 仅为满足 ArtifactRevision→Run 外键创建隐藏 Requirement 和 fake completed Run，必须删除。

目标模型新增：

```text
ReusableAsset(
  id, workspaceId, kind, title, currentRevisionId,
  legacyOriginRequirementId?, createdAt, updatedAt
)

ReusableAssetRevision(
  id, reusableAssetId, revisionNo, contentDocumentId, contentDigest,
  source = manual | import | migration,
  actorSnapshotDocumentId?, migrationAttestationDocumentId?, createdAt
)
```

- 仅允许 `scenario/usecase/function`；属于 workspace，不属于 Requirement/Workflow/Attempt。
- 旧手工资产按原 revision 顺序迁移并保留 legacy origin id mapping 与 digest；`legacyOriginRequirementId` 只是审计标量、没有 FK，隐藏 manual-assets Requirement 和 manual-asset Run 不进入目标 schema。
- `GET/POST /api/assets`、export/import、DELETE 端点保留产品能力，但改为 ReusableAsset 后端，不再创建 Run 或治理 Artifact。
- Workflow 只能把精确 ReusableAssetRevision 作为 Task 输入来源；Analyst 仍需发布新的 Requirement Artifact revision，不能让 library asset 直接满足 Readiness。

### 8. 目标持久化模型修订

「编排持久化、API、事件与恢复契约」的目标模型增加：

- `legacy_imports(requirement_id PK, workflow_id, import_class, bundle_document_id, attestation_document_id, anomaly_count, created_at)`；只能由 migration 写；
- `reusable_assets` 与 `reusable_asset_revisions`；
- Snapshot Document kinds：`cutover_report`、`migration_attestation`、`legacy_requirement_bundle`、`reusable_asset_content`；
- `artifact_revisions.source_migration_document_id`，用于 migrated requirement baseline；
- legacy DesignPackage 的 migration attestation/archive class 字段与约束；
- migration-only Workflow event `legacy_data_imported`，Runtime 不得 emit。

迁移不会把旧业务表永久保留为 `_legacy` 表或 view。bundle 与 ReusableAsset 对账完成后，在同一 `BEGIN IMMEDIATE` transaction 中 drop 旧表/列并 swap 目标表；原始数据只存在于配对运维备份和内容寻址 bundle。

### 9. 编号 migration 顺序

目标 migration runner 可在空库直接创建 target baseline；任何非空 legacy-v0 数据库必须先有 CutoverReport，并只接受报告确认的精确 legacy fingerprint。旧库执行顺序固定：

1. 停 Gateway；通过 SQLite backup API 形成数据库快照并复制 Pi session 目录；
2. 校验 report digest、legacy schema、`quick_check`、`foreign_key_check` 与零活动旧 Run；
3. `BEGIN IMMEDIATE`，创建 `schema_migrations`、Snapshot Document 与目标临时表；
4. 固定 Artifact/Readiness/Concurrency/Role/API PolicyBundle 与 migration actor snapshot；
5. 迁 manual asset source 为 ReusableAsset；
6. 为每个普通 Requirement 生成 baseline、LegacyRequirementBundle 和 MigrationAttestation；
7. 按分类创建 pending 或 legacy archived Workflow/DesignSession/DesignPackage/legacy_import；
8. 保留 requirement gene links；不导入 current 专业 Artifact、Decision/Finding/Approval/Evidence；
9. 校验分类总数、逐表 row-count/主键摘要、bundle digest、ReusableAsset 映射、外键和全部目标不变量；
10. drop 旧表/列、rename 目标表、记录 migration checksum 并 COMMIT；
11. 再执行 `quick_check`、`foreign_key_check` 和正常 startup reconciliation；全部通过后才 bind HTTP。

任一步失败完整 rollback 并拒绝启动；session 目录不在 migration 中原地修改。

### 10. 同版硬删除的 HTTP 与 Web 路径

以下旧路径不注册 tombstone/410 handler，直接 404：

- `GET/POST /api/requirements/:id/runs`；
- `POST /api/runs/:id/steer`；
- `POST /api/runs/:id/cancel`；
- `POST /api/requirements/:id/archive`；
- `GET /api/runs/stream`；
- `GET /api/requirements/:id/evidence-snapshot`；
- `GET /api/requirements/:id/design-package`。

替代面是 Workflow projection、Workflow/Run 明细与双事件流、统一 Workflow Command、`GET /api/design-packages/:id` 和 `GET /api/legacy-imports/:requirementId`。`POST /api/requirements` 保留路径但改为原子创建 Requirement + baseline + DesignSession + pending Workflow，并返回 201。

Web 同版删除：

- 角色下拉、自由 prompt、parent Run、启动 Run、直接 archive；
- 页面内与全局 `baize-run-rail`；
- Reviewer 选择和模型审批文案。

需求页直接采用「自动工作流与人工接管交互原型」的引导式 projection、同页详情和专注审批。旧页面若与 API schema version 不匹配，禁用所有命令并要求完整刷新；不加载旧组件。

### 11. Reviewer 与旧代码删除清单

#### Agent/runtime

- `AgentRole` 只保留 Orchestrator、Analyst、Architect、Critic；删除 `.pi/skills/reviewer/SKILL.md`。
- 删除 Gateway 手工角色 Run handler、共享 `openRequirementSession` Agent 路径、client role/prompt/parentRunId、直接 steer/cancel/archive、全局 Run stream。
- steer 只追加 HumanDirective；cancel-run 只走 Command/outbox；diagnostic-run 是唯一人工指定角色入口且强制只读。

#### Store/schema

- 删除 `RunInProgressError`、`run_locks` 表和所有 acquire/get/release DAO；
- 删除 Run→DesignSession FK、parent_run_id 手工链、`main/critic/manual-asset` kind 语义；
- 删除 `ensureAssetRequirement()`、`ensureManualAssetRun()`；
- 删除 `selectDecisionOption()`、`setDecisionStatus()` 的原地写权；
- 替换可变/客户端 actor `createApproval()`；
- 删除 direct `archiveDesignSession()` 主流程和“一律将活动 Run 判 failed”的 `recoverActiveRuns()`；
- 删除单行 EvidenceSnapshot overwrite、旧 ArtifactRevision `run_id` 来源和 DesignPackage `approved` 状态作为归档权威。

#### Web/docs/tests

- 删除 `web/src/baize-requirement.ts` 的 AgentRole/ROLES、prompt/runAgent/archive 与手工 Run UI；
- 删除 `web/src/baize-run-rail.ts`、`baize-shell.ts` mount/suppress 逻辑和 `main.ts` import；
- README、agent-runtime README 与 GLOSSARY 不再把 Reviewer 描述为 Agent，不再说明手工角色 Run/直接归档；
- 旧 Store/role/API/Web 测试删除或改写为目标行为，不能以 snapshot 保留旧 UI。

代码扫描必须在 release gate 中证明：业务源码不再包含 Reviewer role、`run_locks`、`ensureManualAssetRun`、旧路由字符串或“启动 Run/直接归档”控件。历史 Wayfinder 与 migration fixture 中的字符串不计入运行时代码扫描。

### 12. 回退边界与开放门禁

开放 HTTP 前必须同时满足：

- 每个普通 Requirement 恰有一个 Workflow，且状态只可能是 pending 或 archived；
- 每个普通 Requirement 有一个有效 current requirement baseline；
- pending Workflow 固定当前 PolicyBundle；legacy archive 固定 `legacy-import/v1`；
- legacy archive 恰有 bundle、attestation 和 legacy DesignPackage，但没有 governed Packet/Approval；
- 每个 manual asset source 恰映射到一个 ReusableAsset revision，且不存在 manual-assets Requirement；
- 无 Task、Attempt、Run、Gate、claim、staged effect 或待处理 outbox；
- source row-count/主键摘要全部被 bundle 或 ReusableAsset mapping 覆盖；
- 旧表、旧列、旧路由、Reviewer Skill/枚举、旧 Web 控件均不存在；
- migration checksum、`quick_check`、`foreign_key_check`、startup reconciliation 和只读 HTTP smoke 全部通过。

开放后首次 business write 是不可逆 roll-forward 边界。读取、health check 和 projection smoke 不跨越该边界；Requirement/Workflow Command/ReusableAsset mutation 会跨越。

### 13. 对「实施切面、测试矩阵与发布门禁」的约束

- 实施可在未发布分支中逐步构建目标模块，但任何可部署产物都不能同时暴露旧/新写路径；正式 release 只有一个 target runtime。
- 必须提供 legacy fixture：空库、pending、legacy archived、manual assets、terminal Run、active Run 阻塞、缺 session attachment、archive/package mismatch、mixed manual provenance、stale CutoverReport、事务中每个 crash point。
- 必须验证 rollback boundary、bundle/row-count/digest 对账、旧路径 404、Reviewer/旧符号源码扫描、ReusableAsset 不创建 Run、pending 首次 start、legacy archive 无命令、启动 fail-closed。
- 正式实施规格必须把每个切面“新增目标能力后立即删除的旧符号”列为完成判据，不能把删除统一拖到最后一个大提交。
