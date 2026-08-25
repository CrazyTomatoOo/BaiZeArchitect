# R06 stakeholder 资产 kind 重命名与硬迁移

status: closed
assignee: pi(grilling with user)
blocked-by: none
labels: wayfinder:grilling

Part of [BaiZe 资产库用户角色定义](../map.md)

## Question

`actor` 资产 kind 硬重命名为 `stakeholder`（干系人），存量数据原地迁移、无兼容别名层——其精确迁移路径、已发布规格文档处置、CONTEXT.md 术语更新的完整契约是什么？

## 已锁定的决策边界（grilling 2026-08-25）

- 术语统一：actor（业务参与者）改名为 **stakeholder（干系人）**——同一概念、改名而非新增并列 kind。
- 硬迁移（无别名兼容）：新建 migration 把 `reusable_assets.kind` 的 `'actor'` 值原地改为 `'stakeholder'`，更新所有代码引用、migration checksum、FTS 索引重建。
- 不保留 `actor` 作为别名——读写都只认 `stakeholder`。
- 本决议取代 R01 的「kind 英文标识为 `actor`」决议；R01 的 schema 形状（name+description、title 镜像、唯一性规则）不变，仅 kind 名变。

## 本票要决议的细节

1. migration 编号与 checksum：0019 还是更高？checksum 串格式（`stakeholder-kind-v1`？）；迁移是否需要重建 reusable_assets 表的 CHECK 约束（SQLite 不能 ALTER CHECK，需 rebuild）还是直接 UPDATE kind 值（CHECK 约束里本就含 'actor'，改值不违反旧约束，但 CHECK 约束要不要同步改名）？
2. 代码引用更新面：`reusable-asset-kind.ts` 的 REUSABLE_ASSET_KINDS 常量、`asset-store.ts` 的 `kind === "actor"` 分支、`updateActorReusableAsset` 方法名（改名 `updateStakeholderReusableAsset`？）、`operator-server.ts` 的 PATCH 路由逻辑、`web/src/baize-workflow.ts` 的 `assetKindLabel` 与「参与者库」tab 文案、test 文件里的 `kind: "actor"` 断言——全量清单与逐文件改动点。
3. 已发布规格文档 `docs/资产库用户角色定义规格.md` 处置：原地改名（actor→stakeholder、参与者→干系人）还是标注 superseded 附录？机器可读验收资产 `assets/actor-asset-spec-v1.json` 是否重命名为 `stakeholder-asset-spec-v1.json`？
4. CONTEXT.md 术语：Store 子域词条 `Actor（业务参与者）` 改为 `Stakeholder（干系人）`；治理域 `Actor 消歧` 段落更新（消歧对象改名）；`Reusable Asset` 词条的 kind 列表更新。
5. FTS 索引：`reusable_asset_search` 虚拟表含 `kind` 列；迁移后需重建索引行让 kind='stakeholder'，还是 FTS 查询不受 kind 值改名影响（kind 是 unindexed 列，重建 vs 不重建的权衡）。
6. 归档宽准入路径：R02 决议归档产物走宽松路径，若存在存量归档产出的 actor 资产（kind='actor' 的 scenario/usecase 引用），迁移后这些资产是否也要同步把引用方 content 里的 assetId 引用转走（见 R07），还是归档产物 content 不动、仅 kind 值改。

## Resolution（grilling 2026-08-25）

### 1. Migration 策略：重写 0013，不新增 0019

用户明确豁免兼容性（无存量数据）。直接重写 `0013-actor-kind.ts` 的 SQL：CHECK 约束里 `'actor'` → `'stakeholder'`；checksum 串改 `actor-kind-v1` → `stakeholder-kind-v1`；migration name 改 `actor-kind` → `stakeholder-kind`；文件重命名 `0013-actor-kind.ts` → `0013-stakeholder-kind.ts`。沿用 0013 既有重建配方（建新表→拷贝→drop→rename），但因无存量数据拷贝步骤为空操作。现有 demo/dev DB 需删除重建（用户已确认）。

不新增 0019 forward migration——0013 的 'actor' CHECK 不留作历史死代码，直接从源头改。这与项目向前 migration 惯例（0015/0017 从不重写历史）相悖，但用户明确豁免兼容性，视此为 pre-production 阶段的源头修正。

### 2. 代码引用更新面（全量清单）

**store 层**：
- `reusable-asset-kind.ts`：`REUSABLE_ASSET_KINDS` 数组末项 `'actor'` → `'stakeholder'`
- `asset-store.ts`：`kind === "actor"` 分支（行 89,90,91,94,125,170）、`kind = 'actor'` SQL（行 191）、`normalizeActorContent`/`actorNameKey`/`actorNameExists` 函数名 → `normalizeStakeholderContent`/`stakeholderNameKey`/`stakeholderNameExists`、`"asset/actor/v1"` schemaRef → `"asset/stakeholder/v1"`、`updateActorReusableAsset` 方法 → `updateStakeholderReusableAsset`、`ReusableAssetNameConflictError` 消息 `actor name` → `stakeholder name`

**workflow-store.ts 门面**：`updateActorReusableAsset`（行 3194-3195）→ `updateStakeholderReusableAsset`

**headless-runtime.ts**：接口声明（行 108）+ 实现（行 466-467）`updateActorReusableAsset` → `updateStakeholderReusableAsset`

**operator-server.ts**：PATCH 路由逻辑引用 actor kind 的分支同步改名

**web 层**：
- `workflow-client.ts`：`assetKindLabel` map `actor: "参与者"` → `stakeholder: "干系人"`（行 769）；类型联合 `"scenario"|"usecase"|"function"|"actor"` → `..."stakeholder"`（行 795,805,830,851）
- `artifact-labels.ts`：`actor: "参与者"` → `actor: "干系人"`（行 90，artifact 字段标签，非 kind）；`actors: "参与者"` → `actors: "干系人"`（行 66，impactProfile 维度）
- `artifact-content.ts`：`dimensions` 数组含 `actors`（行 24）——这是 impactProfile 维度名，不改字段名，但展示标签已在 artifact-labels.ts 改

**contract 层**：`persistence-model-v1.json` 的 `reusable_assets.kind` 枚举列表 `'actor'` → `'stakeholder'`（行 714）

**test 文件**：`migration-actor-kind.test.ts` → `migration-stakeholder-kind.test.ts`、`operator-server.test.ts`/`operator-reads.test.ts` 里的 `kind: "actor"` 断言全改 `kind: "stakeholder"`

### 3. 已发布规格文档处置：删除，不保留

用户决议：删除 `docs/资产库用户角色定义规格.md` 和 `.wayfinder/2026-08-user-role-assets/assets/actor-asset-spec-v1.json`——不保留作为历史参考，R06-R09 的终点产物是新规格（不含 actor 命名、不含字段级引用）。R05 的验收资产和人类评审入口随之作废，由后续票重建。

### 4. CONTEXT.md 术语更新

**Store 子域**（`agent-runtime/persistence/CONTEXT.md`）：
- `Actor（业务参与者）` 词条 → `Stakeholder（干系人）`，kind=`actor` → kind=`stakeholder`，中文「参与者」→「干系人」
- `Reusable Asset` 词条的 kind 列表：`scenario、usecase、function 或 actor` → `...或 stakeholder`

**治理域**（`CONTEXT.md`）：
- `Actor 消歧` 段落更新：消歧对象改名为 Stakeholder（干系人），不再与 Store 子域的 Actor 同名撞车——消歧说明可简化为「治理域 Actor 指操作者身份；Store 子域 Stakeholder 指业务干系人」

### 5. FTS 索引：无需迁移操作

无存量数据 → FTS 虚拟表 `reusable_asset_search` 和 `asset_search_index` 在现有 DB 上为空。重写 0013 后新库直接建出 stakeholder kind；0018（fts-asset-search）在新库上正常建空 FTS 表。无重建索引行的迁移动作。若 demo/dev DB 被删除重建，FTS 也从空开始。

### 6. 归档宽准入：本票无存量迁移问题

用户确认无存量数据 → 不存在存量归档产出的 actor 资产或 content 里的存量 assetId 字段引用。R06 migration 只改 kind 值和 CHECK 约束；归档产物的 content 字段引用迁移（R02 决议的归档宽准入路径）不存在存量要处理。R07/R08 从零设计关系表和归档自动 promote，不背负存量迁移包袱。

### 标签传播决议：全层统一改名

用户决议 (B) 全部统一改名：资产 kind 标签 + artifact 字段展示标签都改为「干系人」。注意区分：`artifact-content-v1.schema.json` 的字段名 `actors`/`actor`（schema 层）不改——Out of scope 边界仍守（不动 artifact schema）；只改 `artifact-labels.ts` 里的中文展示标签。schema 字段名与展示标签分离。
