# Wayfinder Map — BaiZe 资产库用户角色定义 `wayfinder:map`

## Destination

一份评审可通过的《BaiZe 资产库用户角色定义规格》：用户角色（Actor，业务参与者）成为 workspace 级一等可复用资产（第四类 ReusableAsset kind=`actor`），场景/用例资产通过浮引用（assetId）引用参与者替代自由字符串；明确参与者 schema、引用与校验规则、API（含仅 actor 的 PATCH 更新）、导入导出重映射、资产库 UI 落点、存量兼容策略与验收标准。本图只产决策与规格，不修改业务代码。

## Notes

- Domain: 面向存量软件的需求设计与决策治理；角色是场景/用例资产的共享事实源，不是 Agent 角色（Orchestrator/Analyst/Architect/Critic），也不进入设计阶段 Artifact schema。
- Tracker: local-markdown（无 git remote）；票在 `tickets/`，`blocked-by` 表达依赖；open + 无阻塞 + 未认领为 frontier。
- Skills: wayfinder、grilling、domain-modeling；涉及 UI 交互使用 prototype。
- Baseline: [BaiZe 自动优先需求设计编排](../2026-08-auto-orchestration/map.md) A08 已定 ReusableAsset 模型（workspace 级、不可变 revision、Workflow 只能把精确 ReusableAssetRevision 作为 Task 输入来源）；本图只扩展资产库层，不重做 store/API 基础设施。
- 已验证现状：资产库 kind 仅 `scenario|usecase|function`；scenario content 的 actors 为自由字符串（`artifact/scenario/v1` 仅约束设计阶段 Artifact，资产库 content 为宽松对象）；store/server 层现有 create/delete/import/export，**无 update API**；schema 靠 kind 侧规则而非 content JSON Schema 校验。
- 已确认边界（grilling 2026-08）：改动只落在资产库层，Workflow Artifact 层（design 阶段 Analyst 产出的 scenario/usecase）不动；角色纯资产库操作，不触发审批/readiness/workflow 事件；引用语义为浮引用（跟随最新 revision）。

## Decisions so far

<!-- closed ticket title + one-line gist live here -->
- [角色资产 schema 与身份契约](tickets/R01-role-asset-schema-and-identity.md) — 术语定为 Actor（业务参与者）、kind=actor；身份仅 assetId、content 仅 name(必填, trim+大小写不敏感唯一)+description(可空)；title=name 镜像；资产库层独立契约 asset/actor/v1（artifact-content 不动）；统一 ReusableAssetKind 类型 + 新 migration 表重建扩 CHECK；纯资产库操作。
- [场景/用例引用角色与校验规则](tickets/R02-scenario-usecase-role-references.md) — 同字段不同形状：scenario.actors→[{assetId}]、usecase.actor→{assetId}、function 不受影响；server 层校验（create/import 分支）聚合返回 400 invalid_actor_ref+invalidRefs；导入批内先建 actor 再建引用方；归档宽准入（workflow archive 不转引用不校验）；详情后端 enrich 返回 resolvedActors；CONTEXT.md 加 Actor 消歧（业务参与者 vs 操作者身份）。
- [资产库 API 契约：更新、删除与导入导出](tickets/R03-asset-api-update-delete-import-export.md) — PATCH 仅对 kind=actor（追加 revision、title 随 name 同步、409 name_conflict、无乐观锁）；禁删扫同 ws scenario/usecase current revision → 409 asset_referenced+refs；导出引用内嵌快照 {assetId,name,description}、旧字符串原样；导入按 name 复用或新建 actor 并重写 assetId；审计与现状一致不记 actorSnapshot。
- [资产库 UI 落点与引用展示](tickets/R04-asset-library-ui-surface.md) — 资产库加「参与者库」tab；actor 新建为结构化表单、其它 kind 维持 JSON；新建场景/用例显示只读参与者提示、invalid_actor_ref 按 path 逐条红字；详情三态渲染（引用解析/存量原文/悬空占位）+ 保留 JSON；空态沿用+删除冲突提示；kind 联合类型加 actor、AssetDetail 加可选 resolvedActors、导出导入 UI 格式不变后端透明。
- [验收标准、测试矩阵与评审清单](tickets/R05-acceptance-criteria-and-review.md) — 机器可读验收资产 [actor-asset-spec-v1.json](assets/actor-asset-spec-v1.json) + 人类评审入口 [docs/资产库用户角色定义规格.md](../../docs/资产库用户角色定义规格.md)；测试矩阵=行为×变量六维（CRUD/引用校验/禁删/重映射/导出/归档）；评审清单四项（契约完整/一致性/无兼容层/无越界）；门禁=用户人工评审通过；本图即终点，实现转既有流程。

**图状态：5/5 票 closed，frontier 空 —— 到达 Destination（评审通过后）**

## Not yet specified

- 设计态检索：未来设计阶段 Task 把 ReusableAssetRevision 作为输入来源时，若该资产 content 含角色浮引用，是否需要/如何解析或嵌快照；待资产库形态落地后细化。
- 角色资产规模治理：角色库较大时的列表分页/检索/去重；首版资产库无分页，不预铺。

## Out of scope

- 设计阶段 Artifact schema 变更（`artifact/scenario/v1` 的 actors、`usecaseItem.actor` 改为引用）；由用户明确拍板只在资产库层落地。
- 角色权限/职责枚举、角色继承等 RBAC 结构；用户拍板首版 schema 仅 `name + description`。
- actor 资产纳入审批/readiness/治理生命周期；用户拍板纯资产库操作，与现有 scenario 资产同权。
- 全 kind 统一更新 API；PATCH 仅对 kind=actor 开放，scenario/usecase/function 维持 create/delete。