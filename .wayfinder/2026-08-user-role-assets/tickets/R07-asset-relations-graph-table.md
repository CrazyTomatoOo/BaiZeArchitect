# R07 asset_relations 显式关系图表

status: closed
assignee: pi(grilling with user)
blocked-by: R06-stakeholder-rename-and-migration.md
labels: wayfinder:grilling

Part of [BaiZe 资产库用户角色定义](../map.md)

## Question

新建 `asset_relations` 显式关系表，废弃 scenario/usecase content 字段里的 assetId 浮引用——关系表 schema、关系类型词汇、生命周期/级联、查询与 enrich 契约的精确定义是什么？

## 已锁定的决策边界（grilling 2026-08-25）

- 显式关系图（asset_relations 表）：独立于 content 存 from/to/relationship_type 拓扑，不靠 content 字段里的 assetId。
- 字段引用废弃：scenario content 的 `actors`、usecase content 的 `actor` 里的 assetId 字段删除——content 纯内容，关系纯关系表。
- 资产详情 enrich 返回 resolvedGraph（该资产的入边/出边）。
- 可查全 workspace 的资产拓扑。
- 本决议取代 R02 的「字段级浮引用」决议；R02 的 server 层校验、导入批内自包含、resolvedActors enrich 形状全部转移至关系表层。

## 本票要决议的细节

1. 表 schema：`asset_relations(id PK, from_asset_id FK→reusable_assets(id), to_asset_id FK→reusable_assets(id), relationship_type text, created_at, ...)`；是否存 revision 粒度（边指向 asset 还是 revision？资产级——因为浮引用本就跟随最新 revision）；唯一约束 `(from_asset_id, to_asset_id, relationship_type)` 是否去重；级联删除（from 或 to 资产删除时边级联销毁）。
2. 关系类型词汇：需要哪些 relationship_type 枚举？至少含 `scenario→stakeholder`（场景含干系人）、`usecase→stakeholder`（用例主参与者）、`usecase→scenario`（用例场景关系）、`architecture→usecase`、`architecture→function`、`design→architecture` 等跨 kind 关系。完整枚举 vs 开放字符串（带校验白名单）？首次要覆盖哪些边？
3. 废弃字段的具体改法：`artifact-content-v1.schema.json` 的 `scenarioItem.actors`（stringList→去掉？还是保留为自由文本描述？）、`usecaseItem.actor`（string→去掉？）；资产库层 content schema（非 artifact-content）如何同步；存量已发布的含 assetId 的 content 如何迁移（剥离 assetId、转移到 asset_relations、还是冻结存量不转）。
4. 写入时机：手动 create asset 时如何声明关系（API body 加 `relations: [{ toAssetId, type }]`？）；import 时如何建关系（R09 决议）；归档 promote 时如何建关系（从 Artifact content 的字段引用解析并迁移到 asset_relations——见 R08）。
5. 校验位置：server 层校验 toAssetId 存在性、relationship_type 合法性、自环禁止、同 workspace 约束——与 R02 校验迁移对齐。
6. enrich 契约：GET /api/assets/:id 返回 `resolvedGraph: { incoming: [{ fromAssetId, type, title }], outgoing: [{ toAssetId, type, title }] }`；GET /api/assets?workspaceId= 是否返回全 workspace 拓扑摘要还是按需查询。
7. 查询 API：是否需要新增 `GET /api/assets/graph?workspaceId=` 端点返回全 workspace 资产拓扑图（前端架构图渲染用）。

## Resolution（grilling 2026-08-25）

### 1. 表 schema：双级（资产级 join + revision 级追溯）

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

- **资产级** `from_asset_id`/`to_asset_id`：join、级联、唯一约束、enrich 解析最新 revision（浮跟随）。
- **revision 级** `from_revision_id`/`to_revision_id`：写入时钉死当前 revisionId，留存历史追溯（创建时指向哪个版本）。
- **唯一约束** `(from_asset_id, to_asset_id, relationship_type)`：同对同类型去重，不同类型可并存（如 scenario→stakeholder 既是 involves 又可加备注）。
- **级联删除**：from 或 to 资产删除时边级联销毁（`on delete cascade`，沿用 0011/0016 的 reusable_asset_revisions 级联模式）。
- **展示语义**：resolvedGraph 展示时解析 `to_asset_id`/`from_asset_id` 的最新 revision title/kind（浮跟随），revisionId 留作历史追溯但不默认展示。
- **Migration 编号**：跟随 R06 的 0013 重写策略——若 R06 重写 0013，本表加入新 migration 0019（asset-relations）或直接写入 0013 重写后的 SQL（视实现阶段决定，本票只定 schema 形状）。

### 2. 关系类型词汇：kind 对决定语义 + 两类边

relationship_type 字段是 text（无 DB CHECK），server 层维护 (fromKind, toKind, type) 白名单校验。两类边：

- **`contains`（包含 DAG）**：scenario→usecase、usecase→function、function→api、function→data、design→architecture。
- **`involves`（跨切关联）**：scenario→stakeholder、usecase→stakeholder。

DAG 允许多父（同一 function 被多个 usecase 引用、同一 api/data 被多个 function 引用）。architecture 是全局独立叶子（不关联其他资产，但 design→architecture 是它的入边）。stakeholder 是跨切关联节点（被 scenario/usecase involves，不在 contains 树里）。

白名单扩展改代码不改 migration（无需 DB CHECK 变更）。首次覆盖上述 7 种 (fromKind, toKind, type) 组合。

### 3. 废弃字段：实际无存量可废弃

事实：R02 指定的字段级 assetId 引用（scenario.actors→[{assetId}]、usecase.actor→{assetId}）从未在代码里实现——R01-R05 只产规格不写代码，asset-store.ts 的 createReusableAsset 对非 stakeholder kind 的 content 原样存（无 assetId 处理）。因此 R07 的「废弃字段引用」是废弃一个从未实现的规格，不是迁移存量代码。

content 字段处置（用户决议 B 保留文案）：资产库层 scenario content 的 `actors`、usecase content 的 `actor` 保留为自由文本描述（人可读文案），asset_relations 表存结构化引用（机可读边）。两者并存：content 存文案、表存引用。artifact-content-v1.schema.json 的 `scenarioItem.actors`（stringList）和 `usecaseItem.actor`（string）保持不变（Out of scope 边界）。

### 4. 写入时机：create+import 声明，归档解析

- **手动 create**：POST /api/assets body 加可选 `relations: [{ toAssetId, type }]`。server 解析 toAssetId → 当前 revisionId，存入 `to_revision_id`；from 端用新建资产的 revisionId。校验 (fromKind, toKind, type) 白名单、同 workspace、自环禁止。
- **import**：POST /api/assets/import body 加可选 `relations: [{ toAssetId, type }]` 边表（或 `{ fromTitle, toTitle, type }` 按 title 映射——R09 决议细节）。批内先建全部资产 → 再建关系边（校验 toAssetId 存在性）。
- **归档 promote**（R08）：从 Artifact content 的 `actors`/`actor` 自由文本或结构化字段解析干系人引用，建 involves 边；从 scenario→usecase→function 层级解析 contains 边。

### 5. 校验位置：server 层

operator-server 的 create 与 import 分支校验：
- toAssetId 存在性（同 workspace）
- (fromKind, toKind, type) 白名单
- 自环禁止（from_asset_id != to_asset_id）
- 同 workspace 约束（from 和 to 必须同 workspace）
聚合全部无效边后一次性返回 `400 { error: "invalid_relations", invalidRelations: [{ toAssetId, type, reason }] }`，无部分写入。沿用 R02 的聚合校验模式。

### 6. enrich 契约：详情 resolvedGraph

GET /api/assets/:id 返回：
```jsonc
{
  // ...现有 ReusableAssetDetail 字段...
  "resolvedGraph": {
    "incoming": [{ "fromAssetId": 3, "fromRevisionId": 7, "type": "contains", "title": "登录场景", "kind": "scenario" }],
    "outgoing": [{ "toAssetId": 5, "toRevisionId": 9, "type": "involves", "title": "管理员", "kind": "stakeholder" }]
  }
}
```
title/kind 解析自最新 revision（浮跟随），revisionId 留作追溯。GET /api/assets?workspaceId= 列表接口同样返回各资产 resolvedGraph（前端从列表拼局部拓扑）。

### 7. 查询 API：新增拓扑端点

新增 `GET /api/assets/graph?workspaceId=` 端点，返回全 workspace 资产拓扑：
```jsonc
{
  "nodes": [{ "assetId": 1, "kind": "scenario", "title": "登录场景" }, /* ... */ ],
  "edges": [{ "fromAssetId": 1, "toAssetId": 2, "type": "contains" }, /* ... */ ]
}
```
前端架构图渲染用（@antv/g6 已是 web 依赖）。nodes 含 kind+title，edges 含 from/to/type。节点级数据（无 revision 粒度，最新 revision 的 title）。
