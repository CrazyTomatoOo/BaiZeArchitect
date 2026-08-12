# 09 — 用 Critic 和有界返工关闭 Finding Thread

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 为每个 Workflow 加入独立 Critic 审查，并把同一问题跨 Artifact revisions 的返工与验证收敛为最多两轮的 Finding Thread。

**Blocked by:** 08 — 从 Impact Profile 派生有证据的 Required Artifact Set

**Status:** ready-for-agent

- [ ] initial Critic Review Bundle 冻结待审 Artifact revisions、已接受 Decision、Repository Snapshot 和检查目标，不包含历史 Critic Finding 或 transcript。
- [ ] Critic 只读上游并且唯一写能力是 record Finding；不能修改 Artifact、raise Decision、请求人工、replan 或声明批准/拒绝。
- [ ] CriticReport 覆盖全部 exact review targets；零 Finding 只有在显式 coverage attestation 完整时有效。
- [ ] Finding fingerprint 跨 successor revisions 维持稳定 Thread identity，旧 revision 被替换不会自动关闭 Finding。
- [ ] rework Task 只由对应 Artifact 所有角色修改 successor revision；verify Critic 只看到目标 Finding 和 disposition evidence。
- [ ] critical 只能由 Critic verify resolved；major 可 verify resolved 或进入精确人工风险接受；minor/info 保持可披露。
- [ ] 同一 Finding Thread 最多两轮自动 rework→verify；仍 open 时打开人工 Blocking Gate，不继续自动循环。
- [ ] verification results 缺失、目标 revision 不匹配、Finding 引用不属于 Attempt 或 coverage 不完整时，Critic Attempt 失败且不发布候选 Finding。
- [ ] 测试覆盖零 Finding、四种 severity、两轮关闭、两轮仍失败、stale risk Approval 和 fingerprint 不变/变化情形。
