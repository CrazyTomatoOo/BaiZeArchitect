# 06 — 通过隔离 Attempt 发布首个 Analyst Artifact

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 完成第一个专业 Task 的端到端执行：精确上下文、隔离模型 Session、受限 Analyst 工具、暂存副作用和原子发布共同产生一个受治理 Artifact revision。

**Blocked by:** 05 — 通过 Planning Task 采用合法 PlanProposal

**Status:** ready-for-agent
**Status:** done

- [x] ready Analyst Task 原子取得 Workflow Attempt Claim，并创建 Attempt 与唯一 governance Run；同 Workflow 第二个治理 Attempt 无法并发取得 claim。
- [x] Context Manifest 固定 Requirement、Plan/Task、Role Contract、Skill digest、Repository Snapshot、治理快照、精确 Artifact/Decision/Finding/HumanDirective 输入和 input digest。
- [x] 每个 Attempt 使用全新隔离 Pi Session；不读取 Design Session 或其他角色 transcript。
- [x] Analyst 只可写 analysis/scenario/usecase/function，并可按契约提出 Decision、Finding 和 Human Input gate；越权立即失败。
- [x] mutating tool 调用只写 Attempt Effect ledger，在 Role Result Schema、声明引用、工具审计和 completion policy 全部通过前不可见。
- [x] 成功发布在一个事务中创建 pending Artifact revision、provenance、Attempt/Task 终态、Claim 释放和连续事件。
- [x] 输出 Schema 无效、工具越权、必要 Effect 缺失或完成谓词失败均丢弃全部候选 Effect，并按预算创建新 Attempt 而非隐藏修复回合。
- [x] Scripted Model Driver 通过最终模型/工具边界验证正确调用顺序与上下文 digest。
