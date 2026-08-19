# Context Map

## Contexts

- [BaiZe 需求设计（治理域）](./CONTEXT.md) — 已确认需求从设计、自动推进、人工门禁到最终归档的治理语言（Workflow、Plan Revision、Task、Attempt、Approval、Outbox Job…）。
- [Store（存储域）](./agent-runtime/persistence/CONTEXT.md) — Workspace registry、Reusable Asset 资产库与内容寻址 Snapshot Document 的持久化子域（schema、写读方法、级联删除语义）。

## Relationships

- **治理域 → Store**: 治理事务经 `WorkflowStore` 门面调用 Store 子域方法——snapshot 写入（createRequirement / bindEvidenceSnapshot / adoptPlan…）、workspace 存在性前置、Reusable Asset 引用解析；Store 不反向依赖治理域。
- **Store → 治理域（单一只读例外）**: `deleteWorkspace` 在单事务内对活动 Run/Claim 做只读前置检查（BusyWorkspaceError）并跨表销毁其下全部治理事实行。
- **Workspace**: 两域共有的根实体——Store 拥有其表与级联删除，治理域以 workspace scope 消费其下 Requirement/Workflow。