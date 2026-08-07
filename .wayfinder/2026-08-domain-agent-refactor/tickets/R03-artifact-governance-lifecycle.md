# Artifact、决策与审批生命周期 `wayfinder:grilling`

status: closed
assignee: pi(grilling with user)
blocked-by:

## Question

需求设计的最小一等领域对象及其版本/审批关系应如何定义，才能替换当前“阶段状态 + JSON refs + Markdown 文件扫描”的混合事实源？需要确定：

- Requirement、Artifact、ArtifactRevision、Decision、Finding、EvidenceSnapshot、Approval、TraceLink、DesignPackage 的最小集合；
- 哪些对象不可变、哪些使用 Patch/Revisions；
- 打回、重新设计、归档和历史复用如何保留可审计链路；
- 人工审批作用于 Artifact revision、Decision 还是整个 Run；
- SQLite 首版所需的事务与外键约束。

不涉及组织级权限或多租户。

## Resolution（2026-08-07）

1. **全部一等实体**：Requirement、Artifact(类型化: 需求规格/场景/用例/功能/设计/架构/数据/API)、ArtifactRevision、Decision(+DecisionOption)、Finding、EvidenceSnapshot、Approval、TraceLink、DesignPackage 全部为一等实体，取代 stage_progress.artifact_refs(JSON) + 文件扫描的混合事实源。
2. **Artifact 不可变 + Revision 链**：Artifact 不可变，每次修改生成新 ArtifactRevision；打回 = 在新 revision 标注 fork-from；可审计链路靠 revision 父链 + Approval 记录维持。
3. **审批三点作用**：人工审批作用于 ① 单个 ArtifactRevision(批准/打回该版本) ② 重大 Decision(选方案/接受风险) ③ 最终归档(整个 DesignPackage)；Approval 记录 actor/time/reason/diff，与 R01 证据驱动门禁一致。
4. **归档闭环 = DesignPackage 快照 + 工具检索注入**：归档把该需求所有当前 ArtifactRevision 快照成不可变 DesignPackage(含证据快照+决策+审批记录)，写入资产库；下次同仓新需求时 Agent 通过 `search_prior_designs` 工具检索注入。取代当前 `latestDesignPackage` 文件扫描(命名不一致断链已验证)。
5. **EvidenceSnapshot = Req 级设计时快照 + TraceLink 引用**：冻结该次设计依据的架构事实，存库；ArtifactRevision/Decision 通过 TraceLink 引用快照内具体节点(路径/符号/行)；审核看到的就是 Agent 当时看到的。
6. **SQLite 首版**：启用外键约束；writeStageAssets 的清旧-写新-改阶段须事务化；删除 Workspace 级联清理快照/设计包/Gene。
