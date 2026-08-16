# 05 — 导入导出快照与重映射

**What to build:** 资产库跨 workspace 导出导入不丢参与者语义：导出时把场景/用例中的参与者引用替换为内嵌快照 `{ assetId, name, description }`（旧字符串 shape 原样）；导入时按 name（trim + 大小写不敏感）复用目标 workspace 已有参与者或自动新建并重写引用方 assetId（快照不作覆盖源、新建 source=import）。

**Blocked by:** 03 — 场景/用例引用校验

**Status:** ready-for-agent

- [ ] 导出 scenario/usecase：引用形状 `actors`/`actor` → 内嵌快照 `{ assetId, name, description }`（导出时当前定义）；旧字符串 shape 原样导出
- [ ] 导入：内嵌快照按 name 匹配目标 ws 参与者 → 复用其 assetId（不覆盖定义）；不存在 → 新建（source=import）并以新 assetId 重写引用方 content
- [ ] 导入后按引用校验规则通过（批内自包含）
- [ ] 导出/导入文件格式与现状兼容（同一 JSON 数组）
- [ ] 主 seam（HTTP 契约测试）覆盖以上