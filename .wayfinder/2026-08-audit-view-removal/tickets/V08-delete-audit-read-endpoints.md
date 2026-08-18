# V08 删除 audit 专用只读端点与 contract 同步

status: closed
assignee: pi
blocked-by: V07
labels: wayfinder:task

## Question

audit 专用只读 JSON 端点（`GET /api/workflows/:id/receipts`、`/incidents`、`/events`、`/api/runs/:id/events`）的删除，与 workflow-api-v1 contract 的双侧同步修订。SSE `events/stream` 保留。

## 执行面

1. **consumer 核查（先做）**：四个端点在 `headless-runtime.ts`、Workflow Doctor、`scripts/smoke-gateway.mjs`、demo fixtures、后端测试中的全部引用逐一枚举；凡有 audit 视图之外的 consumer，该端点保留并在 Resolution 记录理由（部分保留是合法结果）。
2. **删除**：`operator-server.ts` 路由分支、`headless-runtime.ts` 对应方法；`workflow-store.ts` 中仅服务这些方法的查询随删（共享查询保留）。
3. **contract 同步**：`agent-runtime/contracts` 的 workflow-api-v1.json 与 `.wayfinder/2026-08-auto-orchestration/assets/workflow-api-v1.json` 必须双侧同改——contract 测试断言字节一致。
4. **后端测试**：引用被删端点的测试同步移除/改写。

## Acceptance

- `agent-runtime/` 下 `npm run test`、`npm run test:contracts`、`npm run typecheck` 通过；
- 被删路由返回 404（或不可达），SSE stream 行为不变；
- consumer 核查清单写入 Resolution。

## Resolution（2026-08-18）

**Consumer 核查结果**:
- `listCommandReceipts` / `listWorkflowIncidents`：消费者仅为 operator-server 两条路由、headless-runtime 接口+实现、operator-audit-reads.test.ts——Workflow Doctor / smoke-gateway.mjs / fixtures 均无引用 → **全层删除**（store 方法 + `CommandReceiptListItem`/`WorkflowIncidentRecord` 类型一并移除）。
- `getWorkflowEvents` / `getRunEvents`：除 JSON 路由外仍被 **SSE stream replay**(operator-server 两条 stream 路由）、store 内部事件通知（3422/3431 行）、runtime 级测试消费 → **方法保留，仅删 JSON 路由**；SSE 流不动。

**删除**:`GET /api/workflows/:id/receipts`、`/incidents`、`/events`(JSON)、`/api/runs/:id/events`(JSON）四条路由；headless-runtime 接口两成员+实现两块；store 两方法+两类型；`operator-audit-reads.test.ts` 整文件（四个测试全部覆盖被删面）。

**Contract 同步**（双侧字节一致，cp 后 diff 验证）:
- `workflow-api-v1.json`:`eventReads` 收敛为仅 SSE 两条；`removedPaths` 追加四个被删端点；
- `cutover-policy-v1.json`:`replacementReads` 移除两条 events 路径；`removedHttpPaths` 追加四个端点（loader 交叉引用断言其与 api.removedPaths 的 GET/POST 子集集合相等——首轮漏改导致 206 个测试红，补齐后恢复）;
- `operator-experience-v1.json`:`informationArchitecture.auditView` 整块移除；guidedSummary contents "audit summaries" → "status summaries";
- `implementation-plan-v1.json` 中 "audit view" 检查清单项保留不动——历史计划文档，非现行行为契约。

**测试改写**(operator-events.test.ts)：两个 JSON 路由测试删除（分页/连续性与 run 事件内容断言已由 SSE 与 runtime 级测试覆盖）;"event reads use explicit external error semantics" 改写指向 stream 路由（401/404/400/416 语义不变）;"create to archive" 尾部 run 事件断言由 HTTP 改 `runtime.getRunEvents`。

**验证**:`npm run test` 256/257——唯一失败为 negative-scan「production web entry imports only baize-workflow」，系用户未提交的 `web/src/main.ts` → `baize-shell.ts` 重构所致，先于本票存在、与本票无关；`npm run test:contracts` ✓;`npm run typecheck` ✓；被删路由实测返回 404（改写前测试的 404!==200 即证据）。
