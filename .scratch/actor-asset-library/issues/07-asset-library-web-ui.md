# 07 — 资产库 Web「参与者库」UI

**What to build:** 资产库页可管理参与者并读懂引用：新增「参与者库」tab；参与者用结构化表单（名称/描述）新建；新建/编辑场景用例时表单下方显示可用参与者只读提示；详情三态渲染参与者引用（引用解析 / 存量原文 / 悬空占位）并保留 content JSON；删除被引用参与者时提示引用方标题；前端类型加 `'actor'` 与 `resolvedActors`。

**Blocked by:** 02 — Actor 资产创建与更新; 03 — 场景/用例引用校验; 04 — 参与者删除守卫; 06 — 详情引用 enrich

**Status:** ready-for-agent

- [ ] 资产库页出现「参与者库」tab（KINDS 增加 actor），列表/详情与其他库同构
- [ ] 参与者新建为结构化双字段表单（名称必填/描述选填）→ 提交 content `{ name, description }`；其余 kind 维持 JSON/纯文本 textarea
- [ ] 新建/编辑场景用例时表单下方显示「可用参与者」只读提示（id+name，复用 listAssets 过滤 kind=actor）
- [ ] `invalid_actor_ref` 按 path 逐条红字提示（如「actors[1]: 参与者 12 不存在」）
- [ ] 详情三态渲染：引用+resolvedActors → 名称+最新描述清单；存量字符串 → 原文；悬空 → 占位「参与者 N（已不存在）」；content JSON 保留 `<pre>` 块
- [ ] 空态沿用现有模式；参与者库空态补充「请先新建参与者，再在场景/用例中引用它」
- [ ] 删除被引用参与者 → 「该参与者被以下资产引用,无法删除」+ 引用方标题（assetId 翻译）
- [ ] 前端类型：kind 联合加 `'actor'`；`AssetDetail` 加可选 `resolvedActors`；导出/导入 UI 格式不变（后端透明）
- [ ] Web seam：`baize-asset-library` 组件单测覆盖 tab/表单/提示/三态/删除冲突文案