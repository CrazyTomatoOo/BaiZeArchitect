# R08 归档自动 promote 全部已批准产物为资产

status: closed
assignee: pi(grilling with user)
blocked-by: R07-asset-relations-graph-table.md
labels: wayfinder:grilling

Part of [BaiZe 资产库用户角色定义](../map.md)

## Question

Workflow 归档至 `archived` 状态同事务自动 promote 全部已批准 design/architecture/data/api/scenario/usecase/function Artifact 为 workspace 资产——其触发点、事务边界、promote 范围、与现有手动 promote 的冲突、幂等与重试契约的精确定义是什么？

## 已锁定的决策边界（grilling 2026-08-25）

- 归档时自动：Workflow 转入 `archived` 状态的同事务里自动调 promote，把全部已批准 Artifact 沉淀为资产，不需额外命令。
- 默认归档自动沉淀，但允许操作员在归档前已手动 promote 过的产物跳过重复沉淀（去重）。
- 本票只决议 promote 落入资产库的机制；资产间关系（promote 时如何从 Artifact content 解析字段引用并迁移到 asset_relations）跨 R07 协调。

## 本票要决议的细节

1. 触发点与事务边界：归档命令（approve ApprovalPacket → workflow 状态 archived）的同事务里调 `promoteRequirementArtifacts(workflowId, ALL_APPROVED_KINDS)`；还是归档命令成功后再异步 outbox job promote（最终一致）？同事务更安全但事务更大；outbox 更解耦但有窗口期。归档是强一致还是最终一致？
2. promote 范围：全部已批准 ArtifactKind（design/architecture/data/api/scenario/usecase/function）还是可配置子集？`promoteRequirementArtifacts(workflowId, kinds)` 现签名传 kinds——归档自动是传全部 kind 还是 Engine 从 Required Artifact Set 派生？
3. 去重语义：操作员归档前已手动 promote 过某 kind（asset 已存在 current revision 指向该 Artifact），归档自动 promote 跳过该 kind 还是追加 revision？`upsertReusableAssetByTitle` 已有「按 title 复用或新建」逻辑——归档自动是否复用此逻辑、如何判断「已 promote 过」不重复追加 revision。
4. 关系迁移：归档 promote 产出的 scenario/usecase 资产，其 Artifact content 里的 actors/actor 字段引用（如果该 Requirement 的 design 阶段 Artifact content 含 stakeholder 引用）是否在 promote 时解析并建 asset_relations 边？跨 R07：promote 时从 content 字段引用迁移到 asset_relations。
5. 幂等与重试：归档命令幂等（重复归档命令返回 idempotency_conflict 不重复 promote）；若 promote 在事务内失败，归档回滚；若用 outbox 异步 promote 失败，outbox job 重试策略。
6. 与现有手动 promote 的关系：手动 `POST /api/requirements/:id/promote` 接口保留还是废弃？若保留，手动 promote 后归档自动 promote 去重跳过（同上去重逻辑）。
7. 归档产物的资产溯源：promote 产出的资产 `source='workflow'`、`origin_requirement_id`/`origin_artifact_id`/`origin_approval_id` 已由 `upsertReusableAssetByTitle` 记录——归档自动是否额外记 `origin_approval_id`（绑归档审批）。

## Resolution（grilling 2026-08-25）

### 1. 触发点与事务边界：同事务 promote（强一致）

在 `executeCommandTransaction` 的 `approve-packet` 分支内，workflow 状态转 `archived` 之后、`appendEvent` 之前，调 `promoteRequirementArtifacts(workflowId, ALL_KINDS)`。归档与沉淀原子成功或回滚——promote 失败则归档回滚，归档失败则不 promote。不用 outbox 异步——outbox 当前只发布 SSE 事件不执行业务逻辑，新增 promote delivery_type 超出本票范围且引入窗口期。

事务更大但可接受：`approve-packet` 事务已含 readiness 检查、artifact 状态更新、design_session 归档、design_package 插入、事件追加、outbox 入队。追加 promote（7 种 kind × extractAssetItems × upsertReusableAssetByTitle）在同 DB 事务内，better-sqlite3 同步无锁争用。

### 2. promote 范围：全部 7 种 kind

传 `['design','architecture','data','api','scenario','usecase','function']` 全部 7 种 kind。每种 kind 查已批准 revision（有 approval_records 的 artifact_revision）；有则 promote，无则返回 0。不从 Required Artifact Set 派生——Required Artifact Set 是 readiness 判据，不是 promote 范围；归档时全部已批准产物都沉淀。

### 3. 去重语义：跳过已 promote（查 origin_artifact_id）

归档自动 promote 不直接调 `upsertReusableAssetByTitle`——先查 `reusable_assets` 表是否存在 `origin_artifact_id = 该 artifact.id` 且 `workspace_id = workspace` 的资产：
- 存在 → 跳过该 artifact 的全部 items（不追加 revision，不重复入库）。
- 不存在 → 对每个 item 调 `upsertReusableAssetByTitle`（按 title 复用或新建）。

需在 AssetStore 新增查询方法 `assetExistsByOriginArtifactId(workspaceId, artifactId): boolean`（查 `reusable_assets where workspace_id = ? and origin_artifact_id = ?`）。`promoteRequirementArtifacts` 在 extractAssetItems 前先调此方法跳过已 promote 的 artifact。

手动 promote 后归档自动 promote：手动 promote 已建 `origin_artifact_id` 记录，归档自动查到则跳过——不重复追加 revision。

### 4. 关系迁移：解析 content 建边

promote 产出资产时同时建 asset_relations 边（R07 定义的两类边）：

- **involves 边**（scenario/usecase → stakeholder）：解析 Artifact content 的 `scenarios[].actors`（stringList）和 `useCases[].actor`（string），按名称（trim + 大小写不敏感）匹配同 workspace 内 stakeholder 资产的 content.name。匹配到则建 `involves` 边（from=promote 产出的 scenario/usecase 资产 assetId, to=stakeholder 资产 assetId, type='involves'）。未匹配到则不建边（自由文本不强制匹配）。
- **contains 边**（scenario→usecase, usecase→function, function→api/data, design→architecture）：解析 Artifact content 的结构层级。如 scenario content 含 `scenarios[]` 每个 scenario 的 title 对应 promote 产出的 scenario 资产——但 scenario→usecase 的 contains 边需要跨 artifact 解析（scenario artifact 和 usecase artifact 是不同 artifact）。在 promote 时按 (workspace, kind, title) 解析跨 kind 包含关系：同一 requirement 下已 promote 的 scenario 资产和 usecase 资产，如果 content 结构暗示关联（如 usecase 的 sourceRefs 引用 scenario revision），建 contains 边。

需在 AssetStore 或 WorkflowStore 新增 `buildRelationsFromPromotedAssets(workspaceId, requirementId, promotedAssetIds)` 方法。关系校验沿用 R07 的 (fromKind, toKind, type) 白名单。

### 5. 幂等与重试：同事务无重试需求

归档命令幂等：重复 `approve-packet` 命令返回 `idempotency_conflict`（不重复执行 promote）。promote 在同事务内——要么归档+promote 都成功，要么都回滚。不需要 outbox 重试策略。归档命令的幂等回执保证不会重复 promote。

### 6. 手动 promote 接口：保留

保留 `POST /api/requirements/:id/promote`。手动 promote 用于归档前预览/选择性 promote 子集。归档自动 promote 查 `origin_artifact_id` 跳过已手动 promote 的 artifact（去重）。

### 7. 资产溯源：绑归档审批

归档自动 promote 传 `originApprovalId = 归档审批的 approval_records.id`（`approve-packet` 事务内已插入的 packet_approval 记录）。`upsertReusableAssetByTitle` 已支持 `originApprovalId` 参数——归档自动 promote 传该参数绑定归档审批。手动 promote 传 `originApprovalId` 为 artifact 级 approval（现状不变）。归档自动的 `source='workflow'`、`origin_requirement_id`/`origin_artifact_id` 与现状一致。
