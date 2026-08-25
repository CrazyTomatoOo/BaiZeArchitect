# R09 导入导出与 API 契约适配关系表层

status: closed
assignee: pi(grilling with user)
blocked-by: R06-stakeholder-rename-and-migration.md, R07-asset-relations-graph-table.md
labels: wayfinder:grilling

Part of [BaiZe 资产库用户角色定义](../map.md)

## Question

字段引用废弃后，导入导出重映射、PATCH 更新、禁删引用扫描等 API 契约如何从「content 字段里的 assetId」迁移到「asset_relations 表」——其精确契约是什么？

## 已锁定的决策边界（grilling 2026-08-25）

- 本票取代 R03 的导入导出重写决议（字段级 assetId 重写），改为关系表层契约。
- R03 的 PATCH 更新仅 kind=actor（现 stakeholder）开放——改为 stakeholder 仍可 PATCH（name/description），方法名与逻辑随 R06 改名。
- R03 的禁删引用扫描从「扫 content 字段里的 assetId」改为「扫 asset_relations 表里 to_asset_id = 该资产 的边」。

## 本票要决议的细节

1. 导出形状：导出数组是否额外含 `asset_relations` 边表（全 workspace 的关系拓扑快照）？还是导出仅资产列表、关系由 asset_relations 表单独导出（分两段 JSON）？R03 决议导出含引用快照对象——现在引用不在 content 里，导出如何携带关系信息。
2. 导入重映射：import 时如何重建关系边——导入资产列表后，用原导出的 asset_relations 边表（含 from/to 的 title 或临时 id 映射）重建 asset_relations。重映射逻辑：import 按 title 复用或新建资产（R03 逻辑保留），asset_relations 边的 from/to assetId 按新建后的 id 重写。批内顺序：先建全部资产 → 再建关系边（校验 toAssetId 存在性）。
3. PATCH 契约：`PATCH /api/assets/:id` 仅 kind=stakeholder，body `{ name?, description? }`——改名冲突仍 409 `name_conflict`；方法名 `updateStakeholderReusableAsset`。非 stakeholder kind 仍 404。stakeholder 改名后，引用它的 asset_relations 边的 from 端 title 是否需同步刷新（resolvedGraph enrich 时从资产读最新 title，边表不存 title）。
4. 禁删引用扫描：DELETE 前 `select count(*) from asset_relations where to_asset_id = ?`（或 from_asset_id，取决于边方向定义）；非空 → `409 { error: "asset_referenced", refs: [{ kind, assetId, type }] }`；空 → 200。资产删除时 asset_relations 边级联销毁（R07 表定义级联）。
5. 校验位置迁移：R02 决议 server 层校验 content 字段里的 assetId——现在校验迁移到 asset_relations 表的写入（server 层 create/import asset 时校验 relations 声明的 toAssetId 存在性、type 合法性）。
6. API body 扩展：create asset 的 POST body 是否加可选 `relations: [{ toAssetId, type }]` 字段（声明该资产的出边）？import body 是否加 `relations: [{ fromTitle, toTitle, type }]`（按 title 映射）？

## Resolution（grilling 2026-08-25）

### 1. 导出形状：单段含边表

导出返回 `{ assets: ReusableAssetDetail[], relations: [{ fromTitle, fromKind, toTitle, toKind, type }] }`。现有 `exportReusableAssets` 返回 `ReusableAssetDetail[]`，改为返回含 assets + relations 的对象。relations 边表用 title+kind（不用 assetId）——跨 workspace 可移植。`GET /api/assets/export?workspaceId=` 返回此对象。

### 2. 导入重映射：title 映射

import body 接收 `{ assets: [{ kind, title, content }], relations: [{ fromTitle, fromKind, toTitle, toKind, type }] }`。批内顺序：先建全部资产（按 title+kind 复用或新建，R03 逻辑保留），再解析 relations 边——用 (fromKind, fromTitle) 和 (toKind, toTitle) 反查新建后的 assetId，建 asset_relations 边。校验沿用 R07：toAssetId 存在性、(fromKind,toKind,type) 白名单、自环禁止、同 workspace。聚合全部无效边后一次性返回 `400 { error: "invalid_relations", invalidRelations: [{ reason }] }`，无部分写入。

### 3. PATCH 契约：stakeholder 专用，边表不刷新

`PATCH /api/assets/:id` 仅 kind=stakeholder，body `{ name?, description? }` 至少一项非空。方法名 `updateStakeholderReusableAsset`（R06 改名后）。成功=追加新 revision（revisionNo 递增 + digest 重算），title 随 name 同步，返回 `200 { revisionId, revisionNo }`。`{}`→`400 malformed_body`；重名→`409 name_conflict`；非 stakeholder/不存在→`404 unknown_asset`；无乐观锁。stakeholder 改名后 asset_relations 边表**不刷新**——R07 决议边表不存 title，resolvedGraph enrich 时动态读最新 title（浮跟随）。

### 4. 禁删引用扫描：双向扫

DELETE 前 `select count(*) from asset_relations where from_asset_id = ? OR to_asset_id = ?`。非空 → `409 { error: "asset_referenced", refs: [{ assetId, kind, title, type }] }`（列出引用方资产）；空 → `200 { deleted: true }`。扫描与删除在同一事务。资产删除时 asset_relations 边级联销毁（R07 表定义 `on delete cascade`）。双向扫保证 contains DAG 中父节点（如 scenario）被 usecase 引用时不能删，子节点（如 usecase）被 scenario 包含时也不能删——任一方向有边即禁删。

### 5. 校验位置迁移：server 层 relations 写入校验

R02 决议的 server 层校验 content 字段里的 assetId——现在校验完全迁移到 asset_relations 表的写入。operator-server 的 create 与 import 分支：当 body 含 `relations` 时校验每条边的 toAssetId 存在性（同 workspace）、(fromKind, toKind, type) 白名单（R07 定义）、自环禁止（from != to）、同 workspace 约束。聚合全部无效边后一次性返回 `400 invalid_relations`。沿用 R02 的聚合校验模式（不再扫 content 字段）。

### 6. API body 扩展

- **POST /api/assets**：body 加可选 `relations: [{ toAssetId, type }]`（声明新建资产的出边）。server 解析 toAssetId → 当前 revisionId 存入 `to_revision_id`（R07）；from 端用新建资产的 revisionId。校验 (fromKind, toKind, type) 白名单 + 同 workspace + 自环禁止。
- **POST /api/assets/import**：body 加可选 `relations: [{ fromTitle, fromKind, toTitle, toKind, type }]`（按 title 映射的边表）。批内先建全部资产 → 再按 title+kind 反查 assetId 重建边。校验同上。
- **POST /api/assets**（手动 create）与 **POST /api/assets/import** 的 `relations` 字段都是**可选**——不带 relations 时行为与现状一致（只建资产不建边）。
