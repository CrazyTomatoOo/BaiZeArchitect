# 20 — 切换唯一生产入口并删除旧路径

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 完成唯一可部署的新版本：把已验证的自动 Workflow HTTP/Web 接到生产入口，替换部署 Smoke 与 CI，并在同一变更中硬删除全部旧手动编排路径和兼容表面。

**Blocked by:** 19 — 迁移历史数据并证明崩溃安全

**Status:** ready-for-agent

- [ ] production Gateway main 只注册 workflow-api/v1、Operator Session、Projection/detail、双 SSE、Reusable Asset、legacy import 和 Design Package 读取。
- [ ] production Web shell 使用引导式 Workflow 页面，正常路径没有角色选择、自由 Prompt Run、Reviewer 或审计视图（审计视图已删除 2026-08-18，见 `.wayfinder/2026-08-audit-view-removal/map.md`）。
- [ ] 旧 Requirement Run list/create、Run steer/cancel、direct archive、global Run stream、old evidence/design-package Route 和 client-supplied actor endpoint 均不存在。
- [ ] Reviewer Role/Skill、普通角色共享 Session、run_locks/RunInProgressError、旧 Store helpers、旧 Web components/controls、tombstone adapter 和兼容 fallback 均硬删除。
- [ ] negative scan 与 Workflow Doctor 证明 cutover policy 中所有旧 Route、符号、UI、表和列不可达或不存在。
- [ ] Compose smoke 改为 network-none + Scripted Model，通过最终生产 HTTP/Web 契约从 create 到真实人工 packet approval 后 archived。
- [ ] PR CI 强制 contracts、runtime unit/typecheck、SQLite integration、recovery/crash、cutover fixtures、Web unit/build、三 viewport Playwright、negative scan 和 Compose smoke。
- [ ] RC 门禁包含 8 个 Golden Requirement × 3 次：安全不变量 100%、每例至少 2/3、总体至少 90%，以及隔离真实副本 check/apply/Doctor rehearsal。
- [ ] 发布 runbook 固定停写、活动 Run 检查、paired snapshot、check、apply、启动、post-migration gates、Doctor、Smoke、首次写开放顺序。
- [ ] 首次新业务写前失败可整体恢复旧 snapshot/binary；首次写后禁止回退，零容忍事件停止新写并前向修复，进入 24 小时 Guard Period。
- [ ] README、API 和操作文档只描述新路径；S1–S6 的测试装配限制被移除但 Scripted Model 仍不可由生产配置选择。
