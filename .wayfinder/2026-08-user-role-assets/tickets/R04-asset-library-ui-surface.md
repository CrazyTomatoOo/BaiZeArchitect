# R04 资产库 UI 落点与引用展示

status: closed
assignee: pi(grilling with user)
blocked-by: R01-role-asset-schema-and-identity.md, R02-scenario-usecase-role-references.md
labels: wayfinder:grilling

## Question

资产库页（`baize-asset-library`）如何呈现角色库 tab、场景/用例新建时的角色提示，以及详情中的引用解析展示？

## 已锁定的决策边界（grilling 2026-08）

- UI 落点：资产库页加「角色库」tab（`KINDS` 增加 `role`）；场景/用例新建仍为 JSON/纯文本自由编辑，不强制选择器。
- 展示解析：详情视图解析角色引用，显示角色名与最新描述；存量字符串数组兼容展示。
- 纯资产库操作，不触发审批/门禁；无独立治理 UI（与现有资产一致）。

## Resolution（2026-08）

1. **tab/表单**：`KINDS` 增加 `actor` → 资产库页自动出现「参与者库」tab；actor 新建用**结构化双字段表单**（名称必填 / 描述选填 → content `{ name, description }`），与其余 kind（scenario/usecase/function）维持通用 JSON/纯文本 textarea。列表/详情与现有 tab 同构（标题 + revision 徽标 + 详情 JSON）。
2. **提示/报错**：新建/编辑 scenario 或 usecase 时，表单下方显示**只读「可用参与者」提示**（复用 listAssets 过滤 kind=actor，列出 id+name 供粘贴 assetId）；server 返回 `invalid_actor_ref` 聚合错误时按 `path` 逐条红字提示（如「actors[1]: 参与者 12 不存在」）。提示是只读辅助，不做选择器。
3. **详情渲染（三态）**：① actors 为引用形状且 `resolvedActors` 有值 → 渲染名称+最新描述清单；② actors 为字符串数组（存量）→ 渲染原文；③ 引用形状但 resolvedActors 缺该 assetId（理论不应发生：禁删 + 新建校验兜底）→ 占位「参与者 3（已不存在）」。content 完整 JSON 保留在现有 `<pre>` 块供核对。
4. **空态/删除冲突**：空态沿用现有模式（「X库为空。归档需求或手动新建后,资产会出现在这里。」）；参与者库空态补充「请先新建参与者，再在场景/用例中引用它」。删除被引用 actor → `409 asset_referenced` 时在错误区提示「该参与者被以下资产引用,无法删除」并把 refs 中 assetId 翻译为引用方标题展示；成功删除/其它错误与现状一致。
5. **类型/导入导出**：前端 kind 联合类型扩展含 `'actor'`（对应 R01 共享 `ReusableAssetKind`）；`AssetDetail` 增加可选 `resolvedActors`；导出/导入 UI 文件格式不变（同一 JSON 数组），内嵌快照生成与导入重映射全部由后端完成，前端无需感知角色特殊处理。actor tab 的导入文本允许含 actor 条目。