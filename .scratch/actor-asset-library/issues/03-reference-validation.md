# 03 — 场景/用例引用校验

**What to build:** 新建与导入的场景/用例资产必须用浮引用（`actors: [{ assetId }]` / `actor: { assetId }`）指认存在的参与者：operator-server 的 create/import 分支解析引用、查同 workspace actor 存在性，聚合返回全部无效引用；导入批量内先建立参与者再建立引用方（批内自包含）；存量字符串 shape 与归档宽准入路径不被拒绝。

**Blocked by:** 02 — Actor 资产创建与更新

**Status:** ready-for-agent

- [ ] 新建 scenario：`actors: [{ assetId }]` 引用存在的 actor → 创建成功；引用不存在 → 400 `invalid_actor_ref`，`invalidRefs` 聚合列出全部无效引用（含 `path`，如 `actors[1]`），无部分写入
- [ ] 新建 usecase：`actor: { assetId }` 同上校验
- [ ] 存量字符串 shape（`actors: ["管理员"]`）通过（宽松），不强制转引用
- [ ] 归档宽准入：workflow archive → ReusableAsset content 原样、不校验
- [ ] 导入：批内先建/重映射所有 kind=actor 再建 scenario/usecase；校验视野 = 本批新建 + 存量
- [ ] 主 seam（HTTP 契约测试）覆盖以上