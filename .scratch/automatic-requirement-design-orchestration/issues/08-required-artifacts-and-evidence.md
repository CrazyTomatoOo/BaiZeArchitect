# 08 — 从 Impact Profile 派生有证据的 Required Artifact Set

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 让专业 Task 产出的结构化 Impact Profile 决定当前需求必须具备哪些 Artifact，并用 kind Schema、精确来源和 Evidence Snapshot 阻止不完整或无证据设计继续。

**Blocked by:** 07 — 安全执行有依赖的专业 Task

**Status:** ready-for-agent

- [ ] requirement、analysis、design 始终必需；process/actors/behavior/architecture/data/api 的 `yes` 精确增加 scenario/usecase/function/architecture/data/api。
- [ ] 任一 Impact Profile 维度 `unknown` 打开阻塞门禁，`no` 不增加对应 kind，Plan 不能移除 Engine 派生的必需 kind。
- [ ] 九种 Artifact kind 均按版本化封闭内容 Schema 校验，并各有最小正例、缺字段、多字段、错类型和错误 sourceRefs 负例。
- [ ] 每个 Required Artifact kind 只能有一个 current、Schema-valid、pending 或 approved revision；draft/rejected 不满足质量要求。
- [ ] 所有 required revisions 具有可解析输入 provenance；analysis/design/architecture/data/api 还具有绑定同一 Evidence Snapshot 的有效直接 TraceLink。
- [ ] Repository Snapshot 和 Evidence Snapshot 变化会精确使相关 completion/Readiness 输入 stale，而不是读取最新值继续。
- [ ] Analyst/Architect completion policy 对暂存候选视图执行，缺少预期 Effect、来源或证据时整个 Attempt 失败且不部分发布。
- [ ] 通过主 HTTP + Scripted Model 接缝可观察 Required Artifact Set 及其阻塞原因。
