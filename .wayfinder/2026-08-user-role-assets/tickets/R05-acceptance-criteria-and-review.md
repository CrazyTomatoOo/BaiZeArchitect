# R05 验收标准、测试矩阵与评审清单

status: closed
assignee: pi(grilling with user)
blocked-by: R01-role-asset-schema-and-identity.md, R02-scenario-usecase-role-references.md, R03-asset-api-update-delete-import-export.md, R04-asset-library-ui-surface.md
labels: wayfinder:grilling

## Question

这张图的验收标准、测试矩阵与评审清单是什么？「评审通过的规格」如何被证明？

## 已锁定的决策边界（grilling 2026-08）

- Destination 是单一规格文档《BaiZe 资产库用户角色定义规格》，被评审通过即到终点；本图不改业务代码。
- 规格覆盖：角色 schema、引用与校验、API 契约、导入导出重映射、UI 落点、存量兼容。
- 与既有三张图（workbench / evidence-redesign / auto-orchestration）的验收惯例对齐：以测试矩阵 + 评审清单判定，而非直接交付实现。

## Resolution（2026-08）

1. **规格落点**：机器可读验收资产 `.wayfinder/2026-08-user-role-assets/assets/actor-asset-spec-v1.json`（schema `asset/actor/v1`、API 契约、错误码表、重映射算法、验收矩阵）+ 人类评审入口 `docs/资产库用户角色定义规格.md`（聚合 R01–R04 决议、索引导航）；map Decisions-so-far 索引两者。仿照 A09 的 `implementation-plan-v1.json` 模式。
2. **测试矩阵**：机器资产内定义为「行为×变量」二维表，覆盖——① actor CRUD（create 201+rev1；PATCH name→新 rev+title 同步；PATCH desc→仅 desc 变；PATCH 重名→409；唯一性 trim+大小写）；② 引用校验（新建强制→invalid_actor_ref；存量宽松通过；聚合错误 invalidRefs 全列；批内自包含先 actor 后引用方）；③ 禁删（被引用→409 asset_referenced；未引用→200）；④ 导入重映射（同名复用 assetId；新名新建 source=import）；⑤ 导出形状（内嵌快照 {assetId,name,description}；旧字符串原样）；⑥ 归档宽准入（不转引用不校验）。实现阶段由测试驱动执行，本图只定义矩阵与判据。
3. **评审清单（四项）**：① 契约完整——R01–R04 决议逐项落入规格；② 一致性——与既有 store/server/web 类型、CHECK 约束、A08 ReusableAsset 模型无冲突；③ 无兼容层——无新旧引用形状并存的双写/适配；④ 无越界——未动 artifact-content、未加 RBAC/审批/审计。
4. **发布门禁**：用户对《资产库用户角色定义规格》人工评审通过 = 本图终点；实现（切面化落地 + 测试矩阵执行）由实现阶段规划，本图不产出实现细节。
5. **终点后**：本图即终点——规格评审通过后实现直接走 BaiZe 既有实现流程，不再开新的 wayfinder 决策图（所有决策已在 R01–R05 定满）。