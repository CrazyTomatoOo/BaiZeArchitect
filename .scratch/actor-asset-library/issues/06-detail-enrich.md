# 06 — 详情引用 enrich

**What to build:** 资产详情可读：GET `/api/assets/:id` 对含参与者的 scenario/usecase 附带 `resolvedActors: [{ assetId, name, description }]`（后端解析最新 revision、content 本体不动）；存量字符串 shape 原样返回。前端零二次请求。

**Blocked by:** 03 — 场景/用例引用校验

**Status:** ready-for-agent

- [ ] GET 详情（含引用 shape）额外返回 `resolvedActors`，内容来自参与者最新 revision
- [ ] content 本体不被修改；旧字符串 shape 不带 resolvedActors、原样返回
- [ ] 悬空引用（理论不应发生）在 resolvedActors 中对应缺失或占位语义明确
- [ ] 主 seam（HTTP 契约 / operator-reads 测试）覆盖以上