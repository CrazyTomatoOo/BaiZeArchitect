# 19 — 迁移历史数据并证明崩溃安全

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 让 `cutover apply` 仅接受匹配的 Cutover Report，一次性迁移三类历史、生成可审计证明并删除旧数据库表面，同时通过真实进程终止证明不会留下混合状态。

**Blocked by:** 18 — 对生成的旧数据执行 Cutover 预检

**Status:** ready-for-agent

- [ ] apply 复核 Report digest、DB/Session fingerprint、停写状态、无活动旧 Run 与目标 schema；不匹配时在任何业务写前失败。
- [ ] 编号前向 migration 在一个事务中创建 deterministic baselines、legacy imports、Legacy Requirement Bundles、Migration Attestations、pending Workflows 和 Reusable Assets/revisions。
- [ ] 旧 archived 项形成只读 `legacy_pre_policy` Workflow/Design Package，不伪造新版 ApprovalPacket 或人工 Approval。
- [ ] 旧未归档项从 pending 重新治理，不导入旧 Run 输出为 current governed Artifact；manual assets 不创建 fake Requirement/Run。
- [ ] migration 对 origin legacy id 只保留无 FK 审计标量，并按策略删除 obsolete legacy tables/columns/locks。
- [ ] repeated apply 安全拒绝或返回既有 Attestation，不重复导入、重复事件或重复资产。
- [ ] 在 paired backup 后、Cutover Report 后、migration transaction 中、commit 后 startup 前、startup 后首次业务写前终止真实子进程。
- [ ] 每个 Crash Point 重启后只能得到完整旧状态或完整新状态，并通过计数、digest、Doctor 与 removed-surface 对账；不得混合。
- [ ] 首次新业务写入前保留并验证 paired DB/Session snapshot 与旧二进制恢复命令。
