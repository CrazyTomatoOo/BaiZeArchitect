# 10 — 从十一项 Readiness 生成不可变 ApprovalPacket

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 将当前 Artifact、Evidence、Decision、Finding、Critic、Consistency 和执行 provenance 汇总为确定性 Readiness，并且只在所有检查通过时生成可供真实人工审阅的不可变 ApprovalPacket。

**Blocked by:** 09 — 用 Critic 和有界返工关闭 Finding Thread

**Status:** ready-for-agent

- [ ] 所有 open Decision 阻塞；critical/major 只有人工 accepted/rejected disposition 可通过；minor deferred 必须含 reason、owner 和 follow-up target。
- [ ] critical Finding 仅 resolved 可通过；major 仅 resolved 或 active accepted-risk 可通过；minor/info open 时进入 Packet 披露。
- [ ] Consistency 至少验证唯一 current revision、Schema/source、所有权、Decision option、Finding verification、TraceLink、Critic coverage、Task input、无未发布 Effect 和 current provenance transcript。
- [ ] Consistency error 不可豁免；warning/info 不阻塞但进入 Packet。
- [ ] 十一项 Readiness check 均由当前精确事实重算，不接受 Agent 自评或 force-ready。
- [ ] 每项 Readiness check 都有“该项 false、其余十项 true”的独立阻塞测试。
- [ ] 全部通过时生成 immutable SHA-256 ApprovalPacket，包含 exact revisions、dispositions、coverage、警告、策略/Schema 版本、diff baseline 和审计链接。
- [ ] 任一受治理输入变化都会改变或失效 Packet digest，并使 Workflow 从 ready 撤回；纯 pause 可保留仍有效 Packet。
- [ ] 当前有 Claim、活动 Attempt 或未发布 Effect 时不能 ready。
