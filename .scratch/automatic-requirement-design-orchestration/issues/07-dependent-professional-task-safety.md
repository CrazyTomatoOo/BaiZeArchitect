# 07 — 安全执行有依赖的专业 Task

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 让后续 Architect 等专业 Task 从祖先输出解析精确 revision，按稳定顺序执行，并在暂停、取消、替换计划、输入变化及迟到结果竞争中只发布仍然有效的工作。

**Blocked by:** 06 — 通过隔离 Attempt 发布首个 Analyst Artifact

**Status:** ready-for-agent

- [ ] `task_output` 只能引用依赖祖先声明的 Artifact kind，并在 Task 激活时解析为唯一已发布 revision；零个或多个候选都不启动 Attempt。
- [ ] Architect 只能写 design/architecture/data/api，不能修改 Requirement 或 Analyst 所有 Artifact。
- [ ] scheduler 按 Plan ordinal 稳定拓扑顺序串行派发，当前失败 Task 的重试优先于无关 ready Task。
- [ ] Effect Publication Token 精确绑定 Plan、Task、Context digest、Role Contract、input version vector 和 Artifact write bases。
- [ ] pause 本身不使精确输入失效；cancel-run 取消 Attempt 并暂停；replace-plan 和命中输入的治理变化 supersede 受影响 Attempt。
- [ ] publication 通过 Artifact base CAS 与 Task/Attempt terminal CAS；终态竞争只有第一个合法提交获胜。
- [ ] superseded/cancelled/failed Attempt 的迟到结果只追加审计，不发布 Effect、不复活 Task，也不错误消耗 supersede 的失败预算。
- [ ] blocked 结果停止其他分支并形成精确门禁；replan_requested 等待新 PlanRevision，而不修改当前 DAG。
- [ ] 真实进程 Crash Point 覆盖 dispatch/ack、result/finalize、stage/publish 和 publish/outbox 边界。
