# Artifact、决策与审批生命周期 `wayfinder:grilling`

status: open
assignee:
blocked-by:

## Question

需求设计的最小一等领域对象及其版本/审批关系应如何定义，才能替换当前“阶段状态 + JSON refs + Markdown 文件扫描”的混合事实源？需要确定：

- Requirement、Artifact、ArtifactRevision、Decision、Finding、EvidenceSnapshot、Approval、TraceLink、DesignPackage 的最小集合；
- 哪些对象不可变、哪些使用 Patch/Revisions；
- 打回、重新设计、归档和历史复用如何保留可审计链路；
- 人工审批作用于 Artifact revision、Decision 还是整个 Run；
- SQLite 首版所需的事务与外键约束。

不涉及组织级权限或多租户。
