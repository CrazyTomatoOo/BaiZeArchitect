# 02 — 原子创建 pending Workflow

**Spec:** [BaiZe 自动优先需求设计编排规格](../spec.md)

**What to build:** 让创建 Requirement 的 headless 行为一次性建立完整治理起点，而不是先有需求、稍后再补 Workflow 或策略关联。

**Blocked by:** 01 — 让 Workflow 契约可执行并建立确定性 ModelDriver 接缝

**Status:** completed

- [x] 一次创建操作在同一事务中产生 Requirement、确定性的 requirement baseline revision、Design Session、唯一 `pending` Workflow、固定 Policy Bundle 引用和 `workflow_created` 事件。
- [x] 一个 Requirement 不能创建第二个 Workflow，且 Workflow 创建后不能更换 Policy Bundle。
- [x] Workflow current state、version 与连续 event sequence 的初始值符合状态和事件契约。
- [x] 大型契约与策略内容以 kind + digest 的不可变 Snapshot Document 去重保存，重复内容不产生可变副本。
- [x] 任一插入或校验失败都会回滚全部创建结果，不留下孤立 Requirement、Session、Workflow、快照或事件。
- [x] headless 外部测试可读取并验证完整初始治理投影，而无需访问内部 Store 结构。
