# V07 删除前端审计视图与入口

status: closed
assignee: pi
blocked-by: none
labels: wayfinder:task

## Question

前端审计视图的完整删除：视图本体、状态、方法、SSE 订阅、入口按钮、客户端读取方法与 E2E audit 段——删除后 web 包无 audit 残留且全绿。

## 执行面

1. **`web/src/baize-workflow.ts`**：删 `renderAuditView()`；删 `auditOpen / auditEvents / auditReceipts / auditIncidents / auditRunEvents / auditRunId / auditLive` 的 properties 声明、`declare`、初始化；删 `unsubscribeAudit` 及其订阅/清理逻辑；删 `open-audit` 入口按钮与 open/close/loadMoreAuditEvents/toggleAuditLive/selectAuditRun/auditRunIds 等方法；删 `.audit-view` 等 audit 专用 CSS（`.command-row`、`.mono` 等共享类先查引用再定）。
2. **`web/src/workflow-client.ts`**：删除仅服务审计视图的读取方法（listReceipts / listIncidents / events JSON 拉取等）——先验证主页面无引用再删。
3. **E2E**：`web/e2e/approval-audit.spec.ts` 移除 audit 段（含 live tail 用例），approval 段全部保留；评估 spec 与 fixture（`approval-audit.html`）改名为 approval-only 命名。
4. **vitest**：验证 `web/src/baize-workflow.test.ts` 无 audit 断言（2026-08-18 侦察未见匹配，执行时复核）。

## Acceptance

- `web/` 下 `npm run typecheck`、`npm run test`、`npm run build` 通过；
- grep `audit`（case-insensitive）于 `web/src` 无审计视图残留；
- E2E approval 段在本票内可只跑相关 spec 验证（全量 e2e 归 V10）。

## Resolution（2026-08-18）

**删除**:`renderAuditView()`;7 个 `audit*` 状态字段（properties/declare/constructor 三层）;`unsubscribeAudit` 及 disconnect 清理；`openAuditView/closeAuditView/selectAuditRun/loadMoreAuditEvents/toggleAuditLive/tailAuditEvents/auditRunIds` 七方法；`open-audit`（摘要块）与 `approval-open-audit`（批准包「来源与溯源」节）两入口——「来源与溯源」节因唯一内容即审计指针而整节移除；`.audit-view` CSS;`workflow-client.ts` 四类型（WorkflowEventEnvelope/RunEventEnvelope/CommandReceiptListItem/WorkflowIncidentRecord）+ 四函数（listWorkflowEvents/listRunEvents/listCommandReceipts/listWorkflowIncidents);E2E audit 用例、四条 audit mock 路由（events?/receipts/incidents/runs events?）与 helpers(workflowEvents/runEvents/receipts/incidents/appendEvent/extraEvents)。

**保留与改名**：主页面摘要块保留——改名 `renderStatusSummary()`、testid `status-summary`、标题「待处理与版本」;`.audit` 共享 CSS 类改名 `.fact-block`(status-summary/revision-facts/package 三处共用）;E2E 改名 `approval.spec.ts` + `approval.html`(fixture 标题同步）;`subscribeWorkflowEvents/subscribeRunEvents` 保留（主页面双流在用）;SSE stream mock 路由保留。

**验证**:typecheck ✓;vitest 27/27 ✓;build ✓;`approval.spec.ts` desktop 3/3 ✓;`web/` 全仓 grep `audit`(case-insensitive）零命中。三视口全量 e2e 归 V10。
