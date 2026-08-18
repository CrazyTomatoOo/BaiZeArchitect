# V10 验收与负向扫描

status: closed
assignee: pi
blocked-by: V07, V08, V09
labels: wayfinder:task

## Question

删除完成的总验收：全仓负向扫描无审计视图残留，全量质量门禁通过，地图可关闭。

## 执行面

1. **负向扫描**：全仓 grep `audit-view` / `auditOpen` / `open-audit` / `renderAuditView` / `auditLive` 等标识符无残留；`web/src` grep `audit` 仅剩无关命中。
2. **全量门禁**：`agent-runtime` test + test:contracts + typecheck；`web` typecheck + vitest + build + 三视口 Playwright e2e；`docker compose run --rm test` 容器冒烟（如本机可用）。
3. **手工冒烟**：启动 demo（`docker compose up -d demo` 或 tsx main.ts），需求详情页无审计入口、主流程（创建→开始→批准）回归正常。
4. **地图关闭**：本票 Resolution 记录扫描与门禁结果；map 的 Destination 达成判定 = 全绿 + 用户确认。

## Resolution（2026-08-18）

**负向扫描**：全仓 grep `audit-view|auditOpen|open-audit|renderAuditView|auditLive|auditEvents|auditReceipts|auditIncidents|auditRunEvents|unsubscribeAudit|listCommandReceipts|listWorkflowIncidents|approval-open-audit|audit-summary`——代码零命中；剩余命中全部为有意保留的历史记录（spec 故事 24 撤回批注、票 17/18/20 作废注记、本图自身）。

**全量门禁**:
- backend:`test` 256/257、`test:contracts` ✓、`typecheck` ✓。唯一失败 `negative-scan: production web entry imports only baize-workflow`——**既有红**：用户未提交的 `web/src/main.ts` → `baize-shell.ts` 重构（未跟踪新文件）所致，与本图无关；
- web:`typecheck` ✓、vitest 27/27 ✓、`build` ✓、Playwright 三视口 **33/33** ✓（含改名后 `approval.spec.ts`);
- compose 冒烟：2 PASS（生产 main 容器内启动、SPA 从镜像提供——均含本图改动）,4 FAIL（旧路由 404 检查 ×3、无凭证 session bootstrap 201 检查）——**既有红**:stash 本图全部改动后在改动前树上复跑，同样 4 项失败（归因实证）；根因为 smoke 脚本不带 Bearer 且服务端先认证后路由（旧路由得 401 非 404、无凭证 bootstrap 得 401 非 201)，漂移先于本图存在。

**手工冒烟**（本地生产 main + 种子 workspace，端口 18790):Bearer→cookie bootstrap 201 ✓；创建 Requirement 201（工作流 pending)✓；四条被删端点带认证访问全部 404 ✓;`GET /api/workflows/1`、`/api/requirements/1`、SSE `events/stream` 全部 200 ✓；浏览器实测详情页：`open-audit`/`audit-view`/`approval-open-audit` testid 均不存在、「审计视图」文本零出现、`status-summary`（改名后摘要块）正常渲染、hero 主动作「开始」在位 ✓。

**地图关闭判定**：本图范围内全部绿灯；两处既有红（negative-scan vs baize-shell 重构、smoke 脚本漂移）均已实证归因于图外工作，不阻塞本图 Destination，但需用户知悉并另行处置。frontier 空、Not yet specified 空——**Destination 达成（待用户最终确认）**。

## Acceptance

- 上述全绿；map 的 Decisions so far 追加本票后，frontier 为空、Not yet specified 为空 → Destination 达成。
