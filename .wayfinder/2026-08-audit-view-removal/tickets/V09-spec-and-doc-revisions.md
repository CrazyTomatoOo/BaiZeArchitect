# V09 spec 与文档修订

status: closed
assignee: pi
blocked-by: none
labels: wayfinder:task

## Question

删除审计视图的文档同步：spec 故事 24、操作体验节、票 17 范围、README——四处修订后文档无「独立审计视图」表述残留。

## 执行面

1. **`.scratch/automatic-requirement-design-orchestration/spec.md`**：删除用户故事 24（auditor 独立审计视图）；操作体验节「完整事件与 Command Receipt 在独立审计视图呈现」改写为「不提供独立审计视图；完整事件与 Command Receipt 经 Workflow Doctor / 存储层直达可查」。
2. **票 17**（`.scratch/.../issues/17-focused-approval-and-audit-experience.md`）：标题与范围剔除 audit（focused approval experience）；audit 相关验收勾选项标注作废并链接本图（`.wayfinder/2026-08-audit-view-removal/map.md`），不悄悄抹除历史。
3. **`README.md`**：「旅程式需求详情 + 批准/审计视图」行修订为去除审计视图表述。
4. **`CONTEXT.md`**：不动——Workflow Event / Command Receipt / Workflow Incident 术语仍有效（存储与 SSE 层保留）。

## Acceptance

- 全仓文档 grep「独立审计视图 / audit view」无规范性残留（历史记录与本图自身除外）。

## Resolution（2026-08-18）

**spec.md**(`.scratch/automatic-requirement-design-orchestration/spec.md`):
- 故事 24 原地删除线撤回（保留编号，避免 25–67 重编号使 map 中「故事 64」等引用失效）;
- 操作体验节（L18）:「完整事件与 Command Receipt 在独立审计视图呈现」→「不提供独立审计视图，完整事件与 Command Receipt 经 Workflow Doctor 与存储层直达可查」;
- 同节 L177（扫描新发现）:"history uses a separate audit view" → "retained immutably and reachable through SSE replay and Workflow Doctor;no separate audit view is provided";
- 故事 61（扫描新发现）:「paged immutable history … complete audit remains available」所承诺的分页 JSON 历史已随 V08 端点删除失效 → 改写为 bounded Projection + 完整保留事件历史经 SSE/存储可回放；
- 事件流不变量（L166）:"Both support JSON history, SSE replay, …" → 删 "JSON history, "。

**票 17**：标题改为「交付专注审批（原含独立审计视图，已作废）」;What-to-build 剔除审计范围并链接本图；两条 audit 验收勾选项删除线作废+批注（不抹除历史）;**文件名不改**（保持 issues 间数字引用稳定）。

**票 18/票 20**（扫描新发现）：票 18 的 Blocked-by 标题引用同步；票 20 未结验收项「Web shell 使用…与审计视图」改写为「没有…或审计视图」并链接本图。

**README.md**:HTTP 契约表删除 4 行已删端点（receipts/incidents/events JSON ×2)，保留双 SSE 行；组件表「批准/审计视图」→「批准审阅」。

**CONTEXT.md**：不动（决议遵守）。

**有意保留**（历史记录，豁免）:A07/A09 已关闭票、implementation-plan-v1.json 检查清单、operator-experience 原型 README、workspace-management issue 05 的勘察叙述。

**验收扫描**：全仓 grep `审计视图|audit view|audit-view|auditView`——剩余命中仅为上述豁免的历史记录与本图自身。
