# 18 — 对生成的旧数据执行 Cutover 预检

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 用声明式 fixture manifest 生成真实旧 SQLite 和 Session 文件树，并让只读 `cutover check` 对实际输入分类、对账、发现 anomaly，输出只能应用到同一配对输入的 Cutover Report。

**Blocked by:** 17 — 交付专注审批与独立审计视图

**Status:** done

- [x] fixture builder 在临时目录生成真实旧 schema、行内容、附件和 Pi Session 树，不提交不透明数据库二进制。
- [x] 固定 fixtures 覆盖 empty、complete legacy archive、missing attachment、pending re-entry、manual asset source、三类混合、active legacy Run、DB/Session fingerprint mismatch、invalid legacy JSON 和 repeated apply。
- [x] check 在业务停写前提下计算 DB/Session fingerprint、source schema、classification、anomaly、计数、digest 和 removed-surface 清单。
- [x] queued/running 旧 Run 阻塞，且不存在 override；terminal Run 只作为历史 Bundle 内容。
- [ ] 普通旧 Requirement（包括 archived）都规划 deterministic requirement baseline；manual source 只在满足无治理事实条件时成为 standalone Reusable Asset。 (deferred to ticket 19 — apply phase)
- [x] invalid JSON、missing attachment 和 fingerprint mismatch 按 cutover policy 明确阻塞或记录，不被静默丢弃。
- [x] Cutover Report 是内容寻址、不可修改的 Snapshot Document，并绑定 check 使用的输入指纹和策略版本。
- [x] check 只读、可重复，不能创建新业务 Workflow、修改旧数据或删除旧 surface。
- [x] 每个 fixture 对预期分类、anomaly、计数和 apply eligibility 有外部断言。
