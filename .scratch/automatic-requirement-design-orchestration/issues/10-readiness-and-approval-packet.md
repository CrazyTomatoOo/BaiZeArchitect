# 10 — 从十一项 Readiness 生成不可变 ApprovalPacket

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 将当前 Artifact、Evidence、Decision、Finding、Critic、Consistency 和执行 provenance 汇总为确定性 Readiness，并且只在所有检查通过时生成可供真实人工审阅的不可变 ApprovalPacket。

**Blocked by:** 09 — 用 Critic 和有界返工关闭 Finding Thread

**Status:** completed

- [x] 所有 open Decision 阻塞；critical/major 只有人工 accepted/rejected disposition 可通过；minor deferred 必须含 reason、owner 和 follow-up target。（decisions 表 + dispose-decision 命令 + deferred 必填字段 trigger）
- [x] critical Finding 仅 resolved 可通过；major 仅 resolved 或 active accepted-risk 可通过；minor/info open 时进入 Packet 披露。（disposed_findings 检查含 stale risk 判定；disclosedFindingIds 进入 Packet）
- [x] Consistency 至少验证唯一 current revision、Schema/source、所有权、Decision option、Finding verification、TraceLink、Critic coverage、Task input、无未发布 Effect 和 current provenance transcript。（Schema 校验与同 kind 重复 Artifact 由 no_consistency_error 重算；唯一 current revision/所有权/TraceLink 完整性由数据库约束与 trigger 结构保证；Decision/Finding 由独立检查 7/8 覆盖；Task input 在发布时解析；provenance transcript 在票14 事件流落地前无独立存储，随票14 补齐）
- [x] Consistency error 不可豁免；warning/info 不阻塞但进入 Packet。（orphan evidence 为 warning，进入 packet content.warnings）
- [x] 十一项 Readiness check 均由当前精确事实重算，不接受 Agent 自评或 force-ready。（checkReadiness 每次从数据库重算，无缓存）
- [x] 每项 Readiness check 都有“该项 false、其余十项 true”的独立阻塞测试。（11 个 per-check 测试，assertOnlyCheckFails 保证唯一失败项）
- [x] 全部通过时生成 immutable SHA-256 ApprovalPacket，包含 exact revisions、dispositions、coverage、警告、策略/Schema 版本、diff baseline 和审计链接。（approval_packets 表不可变；内容含 exact revisions/decisions/findings/coverage/warnings/policyBundleDigest/requirementRevisionId 基线；审计链接经由事件流与 packet id 关联）
- [x] 任一受治理输入变化都会改变或失效 Packet digest，并使 Workflow 从 ready 撤回；纯 pause 可保留仍有效 Packet。（readiness_withdrawn 事件 + current_approval_packet_id 清空；pause 不清 packet；digest 变化生成新 packet 行）
- [x] 当前有 Claim、活动 Attempt 或未发布 Effect 时不能 ready。（terminal_current_work + no_unpublished_effects 检查）
