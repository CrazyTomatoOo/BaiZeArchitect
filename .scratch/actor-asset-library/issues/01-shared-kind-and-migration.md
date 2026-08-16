# 01 — 共享 kind 类型与数据库迁移

**What to build:** 为资产库新增第四种资产类别做好地基——`actor` 成为一处定义、处处可用：抽共享 `ReusableAssetKind`（含 `'actor'`）供 store/server/web 统一引用，新 migration 重建 `reusable_assets` 表把 kind CHECK 扩含 `'actor'`（存量行不丢、revision 约束不变），迁移 seam 测试证明以上两条。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] 抽共享 `ReusableAssetKind = 'scenario' | 'usecase' | 'function' | 'actor'` 常量与校验器，store/server/web 不再各自维护 kind 枚举
- [ ] 新 migration 重建 `reusable_assets` 表，kind CHECK 含 `'actor'`；`mapLegacyArtifactKind` 不加 actor
- [ ] 迁移后存量行不丢、revision/source 约束不变；迁移 seam 测试通过
- [ ] `web assetKindLabel`: actor → 「参与者」（可在 UI 票展开，此处至少类型打通）