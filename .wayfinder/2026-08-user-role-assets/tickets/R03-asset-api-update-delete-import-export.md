# R03 资产库 API 契约：更新、删除与导入导出

status: closed
assignee: pi(grilling with user)
blocked-by: R01-role-asset-schema-and-identity.md, R02-scenario-usecase-role-references.md
labels: wayfinder:grilling

## Question

角色资产的 PATCH 更新、被引用禁删、以及导入导出重映射的 API 契约精确定义是什么？

## 已锁定的决策边界（grilling 2026-08）

- PATCH 更新仅对 kind=role 开放（`PATCH /api/assets/:id` body `{ name?, description? }`），追加新 revision、current 指向最新；不扩展到 scenario/usecase/function。
- 删除语义：被 scenario/usecase 引用的 role 禁止删除（4xx + 指明引用数）；未被引用可删。
- 导入导出：导出时角色引用带定义快照；导入时按 name 匹配复用已有角色，不存在则自动创建并重映射 assetId。

## Resolution（2026-08）

1. **PATCH /api/assets/:id（仅 kind=actor）**：body 为 `{ name?: string, description?: string }` 至少一项非空，否则 `400 malformed_body`；成功=追加新 revision（revisionNo 递增 + content digest 重算），content 合并后为 `{ name, description }`，`title` 随 name 同步；返回 `200 { revisionId, revisionNo }`。重名 → `409 name_conflict`；非 actor kind / 不存在 → `404 unknown_asset`；**无乐观锁**（与现有 create 一致，后写生效）。
2. **删除前引用扫描**：DELETE 前扫描同 workspace 内所有 scenario/usecase 资产的 **current revision** content，凡引用该 actor assetId 者记入；非空 → `409 { error: "asset_referenced", refs: [{ kind, assetId }] }`（只列引用方资产，不列 revision）；未引用 → `200 { deleted: true }`；扫描与删除在同一事务。浮引用只看最新 → 只扫 current revision 足够。
3. **导出形状**：保留现有导出数组形状（AssetDetail 列）；对含引用的 scenario/usecase，content 内 `actors`/`actor` 引用替换为内嵌快照对象 `{ assetId, name, description }`（导出时嵌入当前定义）；旧字符串 shape 原样导出。
4. **导入重映射**：每个内嵌快照按 name（trim + 大小写不敏感）在目标 workspace 的 actor 资产中查找——找到则复用其 assetId（快照不作覆盖源、不校验定义）；找不到则用 name+description 新建 actor（source=import）并以新 assetId 重写引用方 content；随后按 R02 校验（批次自包含 + 存量）→ 通过。收窄 map Not-yet-specified 的「跨 workspace 同名冲突」雾：**复用优先**。
5. **审计一致性**：PATCH / 禁删与现有资产操作一致，**不记录 actorSnapshot**（server 调用仍不传 actorSnapshotDocumentId）；规格注明「资产库操作无审计快照」为一致现状，本图不追加。