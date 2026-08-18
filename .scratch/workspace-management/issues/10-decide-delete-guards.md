# Decide workspace delete guards and data-loss documentation

Label: wayfinder:grilling
Assignee: （未认领）
Status: open
blocked-by: 07-research-cascade-delete-fk-graph; 08-decide-workspace-api-surface

## Question

级联删除（用户已拍板：连同工作区下所有需求与资产一并清掉；软归档作废）的护栏与数据丢失文档化。

## 待决议

1. **确认交互**：管理页删除按钮 → 确认形态（二次确认？键入工作区名确认？现有 overlay / `danger` 按钮 / 回执惯例）；删除进行中状态与失败回显。
2. **可删权限**：所有登录操作员可删 vs 能力位限定（结论随 08 的治理地位决议；若 08 定「引擎外 CRUD」，能力位问题在此收口）。
3. **活跃运行保护**：workspace 下存在 active/queued run 时是否禁删（07 的 engine 引用面 + 启动 reconcile 对缺失行的行为）；SSE 断连时是否禁用删除。
4. **删除后落点与清理**：回管理页 + 清 localStorage 键（与 09 协约）；已删工作区再被访问（旧 URL/旧投影）→ 404 预期。
5. **文档化**：ADR（数据破坏性语义——难反转、无外部预期、真实权衡，含与 01 软归档方案的对比）；CONTEXT.md 新增「工作区/Workspace」词条草稿（domain-modeling：仓库注册 + 快照归属 + 需求/资产容器 + 级联删除语义）；spec 操作体验节的数据丢失提示文案。

## Answer（待 grilling）