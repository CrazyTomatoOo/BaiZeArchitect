# Wayfinder Map — 审计视图删除 `wayfinder:map`

## Destination

审计视图从产品中删除：视图本体、入口、前端状态与相关测试同步移除，spec/文档同步修订，无残留引用；审计数据（事件/回执/事故）在存储与只读 API 层的去留由本图决议。Destination 达成 = 删除完成且全仓无审计视图残留（或按执行模式决议产出删除方案）。

## Notes

- Domain: 需求工作流详情的只读审计面；相关术语见 CONTEXT.md（Workflow Event、Command Receipt、Workflow Incident、Approval Packet、Workflow Doctor）。spec 依据：`.scratch/automatic-requirement-design-orchestration/spec.md` 用户故事 24 与操作体验节（「完整事件与 Command Receipt 在独立审计视图呈现」）、票 17（focused-approval-and-audit-experience）——删除需同步修订这三处。
- Tracker: local-markdown（无 git remote）；票在 `tickets/`，`blocked-by` 表达依赖；open + 无阻塞 + 未认领为 frontier。
- Skills: wayfinder、grilling、domain-modeling。
- **重绘历史**：本图原为「审计视图重构」（2026-08-18 chart）；第一轮锁定重构向边界（spec 终点 / 结构化替代 / overlay / 只读 API 扩展 / digest 单一位置），V01 grilling 将审计目的收窄至 Operator 自查 + 合规追溯两条问题后，用户拍板 Destination 重绘为「删除审计视图」；重构向票据 V02–V06 全部作废，原目录 `2026-08-audit-view-refactor` 更名为本目录。
- 仍有效边界：治理写路径（Engine/Outbox/命令/事件产生/存储）不动——删除的是 UI 呈现层，治理事实保留。
- 已验证删除面（2026-08-18 侦察）：
  - 前端 `web/src/baize-workflow.ts`：`renderAuditView()` + 7 个 `audit*` 状态字段 + `unsubscribeAudit` + `open-audit` 入口 + live-tail SSE 订阅 + 相关方法（loadMoreAuditEvents / toggleAuditLive / selectAuditRun / closeAuditView / auditRunIds）；
  - E2E `web/e2e/approval-audit.spec.ts` + `approval-audit.html`：票 17 混合测试，approval 段保留、audit 段移除；
  - 后端只读端点（去留待决议）：`GET /api/workflows/:id/receipts`、`/incidents`、`/events`（JSON 列表）、`/api/runs/:id/events`（JSON 列表）；SSE `events/stream` 双流为主页面所用，不动。
- 已锁定边界（重绘后 charting 2026-08-18，用户拍板）：
  1. **直接执行删除**——覆盖原第一轮「只产 spec」锁定；本图 Notes 显式携带执行，Destination = 已删除；
  2. **audit 专用只读 JSON 端点连同删除**（receipts / incidents / events 列表、runs/:id/events）；SSE `events/stream` 保留（主页面双流在用）；
  3. **文档修订面**：spec 故事 24 删除、操作体验节修订、票 17 范围剔除 audit、README 与 E2E 清理；CONTEXT.md 不动（事件/回执术语仍有效）；
  4. **接受无审计 UI**——显式记录：产品 UI 不再提供任何审计面；端点删除后审计事实仅经 Workflow Doctor / 存储层直达可查；未来如需审计 UI 另行立项。

## Decisions so far

- [V01 审计目的与问题清单](tickets/V01-audit-purpose-and-question-catalog.md) — 受众=Operator 自查、动作=合规追溯、问题清单仅「命令回执 + actor」「角色 Task 执行」两条、与 Workflow Doctor 严格分工；目的收窄直接促成删除拍板。
- [V07 删除前端审计视图与入口](tickets/V07-delete-frontend-audit-view.md) — 前端审计视图整体移除（视图/状态/方法/两入口/client 四类型四函数/E2E audit 段）；摘要块改名 status-summary 保留；typecheck+vitest+build+approval e2e 全绿，web 仓零 audit 残留。
- [V08 删除 audit 专用只读端点与 contract 同步](tickets/V08-delete-audit-read-endpoints.md) — 四条 JSON 只读路由删除（receipts/incidents/events、runs events）,SSE 流与 store 读取方法保留（stream replay 在用）;workflow-api/cutover-policy/operator-experience 三契约双侧同步；backend 256/257（唯一失败为用户未提交 shell 重构的既有红）。
- [V09 spec 与文档修订](tickets/V09-spec-and-doc-revisions.md) — spec 故事 24 原地撤回（编号保留）、操作体验节两处与故事 61/事件流不变量改写；票 17 范围剔除 audit、勾选项作废留痕；票 18/20 引用同步；README 端点表 −4 行；CONTEXT.md 不动；规范性残留扫描干净。
- [V10 验收与负向扫描](tickets/V10-verification-and-negative-scan.md) — 代码负向扫描零残留；web 全门禁绿（三视口 e2e 33/33）；手工冒烟通过（无审计入口、删端点 404、主流 200);backend 256/257 与 compose 4 红均实证归因为图外既有问题（baize-shell 重构、smoke 脚本漂移）。

**图状态：10/10 票 closed（V02–V06 作废）,frontier 空 —— Destination 达成（待用户确认）；两处图外既有红待用户处置（见 V10 Resolution)**

## Not yet specified

- 端点删除的精确 consumer 核查（headless-runtime / Workflow Doctor / smoke 脚本是否占用 receipts/incidents/events JSON）：已成票 V08 的第一步，不属雾区。当前无雾。

## Out of scope

- [V02 信息架构与溯源面整合](tickets/V02-information-architecture.md)、[V03 数据裁剪与结构化展示规则](tickets/V03-data-trimming-and-structured-fields.md)、[V04 入口语义与过滤上下文](tickets/V04-entry-semantics-and-filter-context.md)、[V05 排障控件归宿](tickets/V05-diagnostics-controls-relocation.md)、[V06 验收标准与评审清单](tickets/V06-acceptance-and-review.md) —— 重构向票据，随 Destination 重绘作废（已关闭）。
- 治理写路径 / 事件产生 / 存储层删除：治理事实（事件、回执、事故、digest）全部保留。
- SPA 路由引入、Workflow Doctor UI 建设。
