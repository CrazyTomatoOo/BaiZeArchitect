# 04 — 参与者删除守卫

**What to build:** 删除参与者前检查引用完整性：扫描同 workspace 场景/用例的 current revision content，凡引用该参与者则拒绝删除并返回引用方清单；未被引用则删除成功（revisions 级联），扫描与删除同事务。

**Blocked by:** 03 — 场景/用例引用校验

**Status:** ready-for-agent

- [ ] 删除被场景/用例引用的 actor → 409 `{ error: "asset_referenced", refs: [{ kind, assetId }] }`（只列引用方资产）
- [ ] 删除未被引用的 actor → 200 `{ deleted: true }`；revision 级联清理
- [ ] 扫描仅针对 current revision（浮引用解析到最新）；扫描与删除同一事务
- [ ] 不存在资产 → 404 `unknown_asset`（现状保持）
- [ ] 主 seam（HTTP 契约测试）覆盖以上