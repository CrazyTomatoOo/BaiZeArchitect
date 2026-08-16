# 02 — Actor 资产创建与更新

**What to build:** 参与者资产可在资产库中创建与就地修正：POST 新建（name 必填、description 缺省归一化为空、title=name 镜像、首个 revision）、PATCH 仅对 kind=actor 追加新修订（name/description 至少一项、title 随 name 同步、唯一性 trim+大小写不敏感、无乐观锁），错误码契约完备。

**Blocked by:** 01 — 共享 kind 类型与数据库迁移

**Status:** completed

- [x] POST /api/assets kind=actor 创建成功反回 201 与 revision 1；content 存储 `{ name, description }`（description 缺省 → ""）、title=name
- [x] name 空 / content 缺失 → 400 `malformed_body`
- [x] 唯一性：同 workspace 内 normalize=`trim().toLowerCase()` 冲突（创建或 PATCH）→ 409 `name_conflict`
- [x] PATCH /api/assets/:id 仅 kind=actor：追加 revision（revisionNo 递增、digest 重算）、content 合并 `{ name, description }`、title 随 name 同步；返回 `200 { revisionId, revisionNo }`
- [x] PATCH 空 body → 400 `malformed_body`；非 actor kind / 不存在 → 404 `unknown_asset`
- [x] 主 seam（HTTP 契约测试）覆盖以上；存储层行为经 headless runtime 可观察