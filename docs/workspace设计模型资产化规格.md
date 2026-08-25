# BaiZe workspace 设计模型资产化规格

> 本文件是《资产库用户角色定义》wayfinder 图重开后的**人类评审入口**。机器可读验收资产：[stakeholder-asset-spec-v1.json](../.wayfinder/2026-08-user-role-assets/assets/stakeholder-asset-spec-v1.json)。
> 图状态：R01-R09 全闭（R01/R02/R03 superseded，R05 voided），R10 终点产物票。评审通过后即达 Destination，实现走 BaiZe 既有流程。

## 背景与目标

workspace 设计产出的完整事实图景（干系人、场景、用例、功能、接口、数据库、架构图等）成为 workspace 级可复用资产，生命周期绑 workspace（=一个具体项目），归档时自动沉淀。本规格覆盖三项演进：(1) `actor` 资产 kind 硬重命名为 `stakeholder`（干系人）；(2) 新建 `asset_relations` 显式关系表，废弃字段级引用，全部跨 kind 关系走关系表；(3) Workflow 归档时同事务自动 promote 全部已批准产物为 workspace 资产。本规格只覆盖资产库层，**不修改设计阶段 Artifact schema**（`artifact-content-v1` 不动）。

**术语**：Stakeholder（干系人，资产 kind=stakeholder，中文「干系人」）与 Agent 角色（Role Contract）及操作者身份（可信 Actor/ActorRef）明确区分。见 CONTEXT.md 消歧说明。

## 1. Stakeholder 资产 Schema（`asset/stakeholder/v1`）

| 项 | 契约 |
|---|---|
| kind | `stakeholder` |
| 身份 | 仅 store 级 `assetId`；content 无 slug id |
| content | `{ name: string(必填非空), description?: string(可空→"") }`，additionalProperties: false |
| title | `title = content.name` 镜像：创建同步、PATCH 改名同步 |
| 唯一性 | workspace 内 `trim + 大小写不敏感` 归一化后唯一；冲突（创建/PATCH）→ `409 name_conflict` |
| 治理 | 纯资产库操作；不触发审批/readiness/workflow 事件 |
| 迁移 | 重写 0013 migration（非新增 0019）：CHECK `'actor'`→`'stakeholder'`、checksum `stakeholder-kind-v1`、文件改名 `0013-stakeholder-kind.ts`；无存量数据，demo/dev DB 删除重建 |
| 标签传播 | 全层统一「干系人」：`assetKindLabel`、`artifact-labels.ts` 展示标签都改；schema 字段名 `actors`/`actor` 不改（Out of scope 边界） |
| CONTEXT.md | Store 子域 `Actor`→`Stakeholder`；治理域消歧简化 |

## 2. asset_relations 显式关系表

### 表 Schema

```sql
create table asset_relations (
    id integer primary key autoincrement,
    from_asset_id integer not null references reusable_assets(id) on delete cascade,
    to_asset_id integer not null references reusable_assets(id) on delete cascade,
    from_revision_id integer not null references reusable_asset_revisions(id) on delete cascade,
    to_revision_id integer not null references reusable_asset_revisions(id) on delete cascade,
    relationship_type text not null,
    created_at text not null,
    unique(from_asset_id, to_asset_id, relationship_type)
);
```

- **双级**：`from/to_asset_id`（join/级联/唯一/enrich 浮跟随最新）+ `from/to_revision_id`（钉死创建时版本留存追溯）
- **唯一约束**：`(from_asset_id, to_asset_id, relationship_type)` 去重；不同 type 可并存
- **级联删除**：from 或 to 资产删除时边级联销毁
- **展示语义**：resolvedGraph 浮跟随最新 revision title/kind，revisionId 留作追溯

### 关系类型词汇

两类边，kind 对决定 type（server 白名单校验，无 DB CHECK）：

| 边类型 | 语义 | 合法 kind 对 |
|---|---|---|
| `contains` | 包含 DAG（多父） | scenario→usecase、usecase→function、function→api、function→data、design→architecture |
| `involves` | 跨切关联 | scenario→stakeholder、usecase→stakeholder |

- **DAG 多父**：同一 function 可被多个 usecase 引用、同一 api/data 被多个 function 引用
- **stakeholder 跨切**：不在 contains 层级树里
- **architecture 全局独立**：不关联其他资产，但 design→architecture 是它的入边
- 白名单扩展改代码不改 migration

### content 字段处置

- scenario content 的 `actors`、usecase content 的 `actor` **保留为自由文本描述**（人可读文案）
- `asset_relations` 表存结构化引用（机可读边）
- R02 的字段级 assetId 引用从未在代码实现，无存量废弃

## 3. 归档自动 promote

| 项 | 契约 |
|---|---|
| 触发点 | 同事务：`approve-packet` 命令事务内，workflow state→archived 后、appendEvent 前，调 `promoteRequirementArtifacts(workflowId, ALL_KINDS)` |
| 一致性 | 强一致：promote 失败则归档回滚；不用 outbox 异步（outbox 只发布 SSE 事件） |
| promote 范围 | 全部 7 种 kind：design/architecture/data/api/scenario/usecase/function（**不含 analysis**：analysis 是设计阶段中间产物，不沉淀为资产；**不含 stakeholder**：stakeholder 不由 promote 产生，只由手动 create/import 建立，`upsertReusableAssetByTitle` 拒绝 stakeholder kind） |
| 去重 | 跳过已 promote：查 `reusable_assets.origin_artifact_id`（无 FK 审计列，0016 定义）存在则跳过该 artifact（不追加 revision）；`assetExistsByOriginArtifactId` 查 `reusable_assets where origin_artifact_id = ?` |
| 关系迁移 | 解析 content 建边：actors/actor 自由文本按名匹配 stakeholder 建 involves 边；**contains 边由手动 create/import 声明，不由归档 promote 自动建**（artifact content 无跨 kind 包含字段，无法自动推断 scenario→usecase 包含关系） |
| 幂等 | 归档命令幂等（重复 approve-packet 返回 idempotency_conflict，不重复 promote）；同事务原子无 outbox 重试 |
| 手动接口 | 保留 `POST /api/requirements/:id/promote`（归档自动跳过已手动 promote 的 artifact） |
| 溯源 | `originApprovalId` 绑归档 packet_approval 记录；`source='workflow'` |

## 4. 导入导出与 API 契约

### 导出

`GET /api/assets/export?workspaceId=` 返回单段：
```jsonc
{ assets: [...], relations: [{ fromTitle, fromKind, toTitle, toKind, type }] }
```
边用 title+kind（不用 assetId），跨 workspace 可移植。

### 导入

`POST /api/assets/import` body：
```jsonc
{ assets: [{ kind, title, content }], relations: [{ fromTitle, fromKind, toTitle, toKind, type }] }
```
（relations 可选，不带则只建资产）
- 批内顺序：先建全部资产（按 title+kind 复用或新建）→ 再按 title+kind 反查 assetId 重建边
- 校验沿用 R07：toAssetId 存在性、白名单、自环、同 workspace

### PATCH

`PATCH /api/assets/:id`（仅 kind=stakeholder）body `{ name?, description? }`。改名追加 revision、title 同步；边表不刷新（enrich 动态读最新 title）。

### 禁删

`DELETE /api/assets/:id` 前双向扫：`from_asset_id = ? OR to_asset_id = ?`。非空 → `409 asset_referenced+refs`；空 → 200。

### create 扩展

`POST /api/assets` body 加可选 `relations: [{ toAssetId, type }]`。server 解析当前 revisionId 存入边表。

### enrich

- `GET /api/assets/:id` 返回 `resolvedGraph: { incoming, outgoing }` 浮跟随最新 revision
- `GET /api/assets?workspaceId=` 列表返回 `ReusableAssetSummary[]`（**不含 resolvedGraph**，避免 N+1；需拓扑用 graph 端点）
- 新增 `GET /api/assets/graph?workspaceId=` 返回 `{ nodes, edges }` 全拓扑

### 校验

server 层 create/import 校验 relations 写入：toAssetId 存在性 + (fromKind,toKind,type) 白名单 + 自环禁止 + 同 workspace。聚合 `400 invalid_relations`。

## 5. 测试矩阵（八维）

| 维度 | 变量（判据） |
|---|---|
| CRUD | create stakeholder 201+rev1；PATCH name→新rev+title同步；PATCH desc→仅desc变；PATCH 重名→409；唯一性；PATCH 空 body→400；PATCH 非 stakeholder→404 |
| 引用校验 | relations 写入校验：toAssetId 存在性；白名单；自环→400；跨 workspace→400；聚合 invalid_relations |
| 禁删 | 双向扫 from OR to 非空→409；空→200；级联销毁边 |
| 重映射 | import title 映射：同 title+kind 复用；新名新建；边按 title+kind 反查重建 |
| 导出 | 单段 {assets, relations}；边用 title+kind |
| 归档 | 同事务 promote 7 kind（analysis/stakeholder 排除）；去重跳过 origin_artifact_id（无 FK 审计列）；involves 边自动建（actors/actor 按名匹配 stakeholder）；contains 边不自动建（只手动声明）；幂等不重复；手动 promote 去重 |
| 关系建模 | contains 5 kind-pairs + involves 2 kind-pairs；DAG 多父；resolvedGraph 浮跟随；graph 端点全拓扑 |
| 迁移 | 0013 重写 actor→stakeholder；checksum；代码全量改名；CONTEXT.md；FTS 无迁移 |

完整机读矩阵见 [stakeholder-asset-spec-v1.json](../.wayfinder/2026-08-user-role-assets/assets/stakeholder-asset-spec-v1.json) 的 `acceptanceMatrix`。

## 6. 评审清单与门禁

评审清单（六项）：
1. **契约完整** — R06–R09 决议逐项落入本规格
2. **一致性** — 与既有 store/server/web 类型、CHECK 约束、A08 ReusableAsset 模型无冲突
3. **无兼容层** — 无 actor/stakeholder 双写/别名适配；无字段引用与关系表并存
4. **无越界** — 未动 artifact-content-v1.schema.json；未加 RBAC/审批/审计；归档自动 promote 不改 Workflow 治理状态机
5. **关系类型白名单完整性** — contains (5 kind-pairs) + involves (2 kind-pairs) 覆盖全部设计模型关系；DAG 多父语义正确
6. **归档去重幂等性** — origin_artifact_id 查询跳过已 promote；归档命令幂等保证不重复 promote；同事务原子无窗口期

**发布门禁**：用户对本文人工评审通过 = 本图终点。实现（切面化落地 + 测试矩阵执行）走 BaiZe 既有实现流程，不再开新 wayfinder 决策图。
