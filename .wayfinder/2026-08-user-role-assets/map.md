# Wayfinder Map — BaiZe 资产库用户角色定义 `wayfinder:map`

## Destination

一份评审可通过的《BaiZe workspace 设计模型资产化规格》：(1) `actor` 资产 kind 硬重命名为 `stakeholder`（干系人），无存量数据需迁移、无兼容别名层；(2) 新建 `asset_relations` 显式关系表，废弃 scenario/usecase content 字段里的 assetId 浮引用，全部跨 kind 关系走关系表；(3) Workflow 归档至 `archived` 状态同事务自动 promote 全部已批准 design/architecture/data/api/scenario/usecase/function Artifact 为 workspace 资产。明确 stakeholder 重命名迁移、asset_relations schema 与关系类型词汇、归档自动 promote 事务边界与去重、导入导出与 API 契约适配、资产间关系 enrich 与验收标准。本图只产决策与规格，不修改业务代码。

## Notes

- Domain: 面向存量软件的需求设计与决策治理；资产是 workspace 设计产出的完整事实图景（干系人、场景、用例、功能、接口、数据库、架构图等），生命周期绑 workspace（=一个具体项目），归档时沉淀为可复用资产。角色/provider 是配置不是资产。
- Tracker: local-markdown（无 git remote）；票在 `tickets/`，`blocked-by` 表达依赖；open + 无阻塞 + 未认领为 frontier。
- Skills: wayfinder、grilling、domain-modeling；涉及 UI 交互使用 prototype。
- Baseline: [BaiZe 自动优先需求设计编排](../2026-08-auto-orchestration/map.md) A08 已定 ReusableAsset 模型（workspace 级、不可变 revision、Workflow 只能把精确 ReusableAssetRevision 作为 Task 输入来源）；本次展示重开在既有 Store/API 资产模型上扩展统一编辑与规模治理契约。
- 前序决议（R01-R05 已 closed）：已发布《资产库用户角色定义规格》定义了 actor kind、字段级浮引用、PATCH/禁删/导入导出、UI 落点与验收。R06-R09 演进此规格：R01（actor→stakeholder 重命名）、R02（字段引用废弃改 asset_relations 表）、R03（导入导出重写改关系表层）被取代；R04（UI 落点）结论框架保留但需随新形态重新评估；R05（验收）被 R06 voided——规格文档与验收资产已删除，终点需重建。
- 重开背景（grilling 2026-08-25）：用户修正「模型资产」= workspace 设计产出的完整资产图景（非 AI 模型配置）；三项决议：stakeholder 硬重命名、字段引用废弃改 asset_relations 表、归档自动 promote；旧图重开续接而非新建。
- 已确认边界（grilling 2026-08-25）：改动只落在资产库层，Workflow Artifact 层（design 阶段 Analyst 产出的 scenario/usecase）不动；资产纯资产库操作，不触发审批/readiness/workflow 事件；归档自动 promote 在归档同事务或紧邻 outbox（R08 决议）。

## Decisions so far

<!-- closed ticket title + one-line gist live here -->
- [角色资产 schema 与身份契约](tickets/R01-role-asset-schema-and-identity.md) — `[SUPERSEDED by R06]` 术语定为 Actor（业务参与者）、kind=actor；身份仅 assetId、content 仅 name(必填, trim+大小写不敏感唯一)+description(可空)；title=name 镜像；资产库层独立契约 asset/actor/v1；纯资产库操作。schema 形状保留，kind 名 `actor` 被 R06 硬重命名为 `stakeholder`。
- [场景/用例引用角色与校验规则](tickets/R02-scenario-usecase-role-references.md) — `[SUPERSEDED by R07]` 字段级浮引用（scenario.actors→[{assetId}]、usecase.actor→{assetId}）；server 层校验返回 400 invalid_actor_ref；导入批内先建 actor 再建引用方；归档宽准入；详情 enrich 返回 resolvedActors。字段引用被 R07 废弃，全部跨 kind 关系改走 asset_relations 表。
- [资产库 API 契约：更新、删除与导入导出](tickets/R03-asset-api-update-delete-import-export.md) — `[SUPERSEDED by R09]` PATCH 仅 kind=actor；禁删扫 content 字段；导出引用内嵌快照；导入按 name 重写 assetId。导入导出与禁删扫描被 R09 迁移到 asset_relations 表层。
- [资产库 UI 落点与引用展示](tickets/R04-asset-library-ui-surface.md) — 原 UI 框架被本次重开具体化为 8 个 kind tab + 第 9 个关系图 tab、主从双栏、服务端分页过滤与单资产直接关系详情；旧 actor 文案和 resolvedActors 数据源由 R06-R09 统一更新。
- [验收标准、测试矩阵与评审清单](tickets/R05-acceptance-criteria-and-review.md) — `[VOIDED by R06]` 验收资产 actor-asset-spec-v1.json + 人类评审入口 docs/资产库用户角色定义规格.md 已被 R06 决议删除（用户：不保留作历史参考）。R06-R09 终点需重建新规格与验收资产。

- [stakeholder 资产 kind 重命名与硬迁移](tickets/R06-stakeholder-rename-and-migration.md) — 重写 0013 migration（非新增 0019）：CHECK `'actor'`→`'stakeholder'`、checksum `stakeholder-kind-v1`、文件改名 0013-stakeholder-kind.ts；无存量数据豁免兼容（demo/dev DB 删除重建）；代码全量改名（reusable-asset-kind/asset-store/workflow-store/headless-runtime/operator-server/web workflow-client+artifact-labels/contract persistence-model-v1/test）；已发布规格文档+验收资产删除不保留；CONTEXT.md Store 子域 Actor→Stakeholder、治理域消歧简化；FTS 无迁移（无存量）；全层标签统一改名「干系人」（schema 字段名 actors/actor 不改，仅展示标签）。
- [asset_relations 显式关系图表](tickets/R07-asset-relations-graph-table.md) — 双级表（asset_id join+级联 / revision_id 追溯），unique(from,to,type) 去重，on delete cascade；两类边 `contains`（scenario→usecase/usecase→function/function→api|data/design→architecture DAG 多父）+ `involves`（scenario|usecase→stakeholder 跨切）；kind 对决定 type 白名单（server 校验无 DB CHECK）；content actors/actor 保留自由文案+表存引用（R02 字段引用从未实现无存量废弃）；create/import body 加 relations 声明 server 解析当前 revisionId；聚合校验 400 invalid_relations；GET /api/assets/:id enrich resolvedGraph 浮跟随最新 revision；新增 GET /api/assets/graph?workspaceId= 全拓扑端点（nodes+edges）。
- [归档自动 promote 全部已批准产物为资产](tickets/R08-archive-auto-promote.md) — 同事务 promote（approve-packet 事务内 state→archived 后调 promoteRequirementArtifacts）；全部 7 种 kind（不从 Required Artifact Set 派生）；去重跳过已 promote（查 origin_artifact_id 存在则跳过该 artifact 不追加 revision）；解析 content 建边（actors/actor 自由文本按名匹配 stakeholder 建 involves 边、结构层级建 contains 边）；归档命令幂等保证不重复 promote（同事务无 outbox 重试）；保留手动 POST /api/requirements/:id/promote（归档自动跳过已手动 promote）；originApprovalId 绑归档 packet_approval 记录。
- [导入导出与 API 契约适配关系表层](tickets/R09-import-export-api-relations.md) — 原决议的 stakeholder-only PATCH 被本次统一编辑决策替代；导出单段含边表 `{assets, relations:[{fromTitle,fromKind,toTitle,toKind,type}]}`；导入 title 映射重建边（先建资产→按 title+kind 反查 assetId 建边）；禁删双向扫（from OR to 非空→409 asset_referenced+refs）；校验迁移到 relations 写入（server 层 create/import 校验 toAssetId 存在性+白名单+自环+同 ws，聚合 400 invalid_relations）；POST /api/assets body 加可选 relations:[{toAssetId,type}]，POST /api/assets/import body 加可选 relations:[{fromTitle,fromKind,toTitle,toKind,type}]（皆可选，不带则只建资产）。
- [终点规格与验收资产重建](tickets/R10-spec-and-acceptance-rebuild.md) — 新结构按技术层分块（schema/runtime/api）；人类评审入口 docs/workspace设计模型资产化规格.md；本次重开扩展为十维测试矩阵，新增统一编辑、分页过滤、tab、详情交互；六项评审清单（+关系类型白名单完整性+归档去重幂等性）；旧 actor-asset-spec-v1.json + docs/资产库用户角色定义规格.md 已删除；终点资产 stakeholder-asset-spec-v1.json + docs/workspace设计模型资产化规格.md 已就位。
- [资产展示重开与统一编辑决议](../../docs/adr/ADR-009-unified-reusable-asset-editing.md) — 用户确认 8 种资产均使用严格 v1 业务字段结构化创建与完整 PUT 编辑；expectedRevisionId 乐观并发；title/content/outgoing relations 同事务追加不可变 revision；固定 toolbar/tabs、9 视图、主从独立滚动、服务端分页标题过滤、关系图节点联动、导入预览与删除阻断。


**图状态：10/10 票 closed（R01-R10 全闭），frontier 空 —— 到达 Destination（评审通过后）**

### 重开后续待决议（open tickets）

（无——全部决议票已闭，终点产物已就位）

## Not yet specified

- 设计态检索：R07 已定义 asset_relations 表与 GET /api/assets/graph 拓扑端点。未来设计阶段 Task 把 ReusableAssetRevision 作为输入来源时，是否应把该资产的 resolvedGraph（入边/出边拓扑）一并注入 Context Manifest，让角色看到关联资产上下文？这属于设计阶段 Task 输入层（非资产库层），超出本图边界，待资产库形态落地后由设计阶段图决议。

## Out of scope

- 设计阶段 Artifact schema 变更（`artifact/scenario/v1` 的 actors、`usecaseItem.actor` 改为引用）；由用户明确拍板只在资产库层落地。
- 角色权限/职责枚举、角色继承等 RBAC 结构；用户拍板首版 schema 仅 `name + description`。
- stakeholder 资产纳入审批/readiness/治理生命周期；用户拍板纯资产库操作，与现有 scenario 资产同权。