# 12 — 通过 Command 完成人工治理与最终归档

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 让操作员通过统一公开 Command API 完成全部有效接管、治理处置和最终人工归档，同时证明不存在可绕过 Readiness 的第二条路径。

**Blocked by:** 11 — 认证 Operator 并开放统一 Command 资源

**Status:** ready-for-agent

- [x] steer、pause/resume、cancel-run、retry-task、retry-planning、retry-recovery、replace-plan 和 diagnostic-run 按状态、capability 与 exact subject 守卫工作。
- [x] steer 追加 Human Directive 并在安全点重新规划，不调用活动 Session steer；replace-plan 采用完整校验 Proposal 并 supersede 旧非终态工作。
- [x] provide-human-input 只解决 exact gate；revise-requirement 创建 successor baseline 并使精确依赖 stale；二者不能相互代替。
- [x] DecisionDisposition、Artifact approve/reject、major Finding risk acceptance、Approval revocation 都追加不可变记录并精确绑定 subject version/digest。
- [x] critical Finding 不能接受风险；Agent 不能 disposition Decision 或创建 Approval；不存在 force-role 治理写入、force-skip、force-ready 或 Consistency waiver。
- [x] packet rejection 要求 reason 与 structured targets，并使同 digest 在治理输入变化前不能再次提交。
- [x] packet approval 只允许 `ready_to_archive` 且 Packet/Workflow/Readiness 全部仍 current；同一事务创建 Approval、批准包内 pending revisions、冻结设计包与 Session 并进入 archived。
- [x] archived 无任何命令出边，且真实人工 approval capability 是归档唯一入口。
- [x] 全部 command types × states × capabilities × current/stale subject 的外部矩阵测试通过。
