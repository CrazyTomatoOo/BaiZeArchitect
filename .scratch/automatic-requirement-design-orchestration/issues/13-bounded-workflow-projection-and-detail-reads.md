# 13 — 提供 bounded Workflow Projection 与不可变详情读取

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 为操作员和后续 Web 提供稳定的当前读模型与按需历史读取，使常用页面无需扫描完整事件流，同时审计对象仍可按精确身份展开。

**Blocked by:** 11 — 认证 Operator 并开放统一 Command 资源

**Status:** ready-for-agent

- [x] Requirement 列表可按 Workspace 读取 Workflow summary，Requirement detail 返回 current baseline 与 Workflow 链接。
- [x] Workflow Projection 有界返回 identity/state/version/lastEventSeq、Policy Bundle、current Requirement/Plan、稳定顺序 Tasks、每 Task latest Attempt、active Claim/Run、open Gates、Decision/Finding、Readiness、Packet 与 Incident 摘要。
- [x] older Plans、全部 Attempts、完整 Snapshot Documents 与事件不嵌入常用 Projection，而由精确详情或分页读取。
- [x] PlanRevision、Task、Attempt、Run、ApprovalPacket 和 Command Receipt detail 保留 immutable refs、版本、digest 与 provenance。
- [x] governed 与 `legacy_pre_policy` Design Package 可只读读取，历史状态不会伪装成新策略 Approval。
- [x] Workspace Reusable Asset 的 list/create/detail/delete/import/export 不创建 Requirement、Workflow、Task、Attempt、Run 或 Approval。
- [x] legacy import detail 暴露 classification、Bundle、Attestation 和 anomaly summary，但不成为 PlanningContext 运行时权威。
- [x] 读取结果的版本与 digest 可直接作为 Command expected subject，不要求客户端推导内部数据库版本。
- [x] 大型历史数据下 Projection 仍保持固定形状与有界大小。
