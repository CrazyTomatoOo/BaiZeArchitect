# 01 — Store 子域拆类：产品数据面外置（单 slice）

**What to build:** 从 `WorkflowStore`（3895 行 god class）拆出 Store 子域产品数据面三小类——`SnapshotStore`、`AssetStore`、`WorkspaceStore`，共享同一 Database 句柄；`WorkflowStore` 保留为门面 + 跨域事务编排，公开签名零改动。纯机械移动，零行为变化。

**Source:** `docs/adr/ADR-006-store-subdomain-boundary.md`（accepted）；`CONTEXT-MAP.md` + `agent-runtime/persistence/CONTEXT.md`（词表已立）；grilling 2026-08 决策树（边界/门面/seam/契约/切面均已定满）。

**Blocked by:** None —— 边界文档已落盘（ADR-006 + CONTEXT-MAP）。

**Status:** done —— 实现于 grilling 2026-08 工作树，提交见 git。

- [x] 三新类落 `agent-runtime/persistence/`（`snapshot-store.ts` 53 行 / `asset-store.ts` 220 行 / `workspace-store.ts` 169 行），共享同一 Database；`WorkflowStore` 持引用组合（3895 → 3563 行）；`headless-runtime` / `operator-server` / `main` / 测试构造签名零改动（import 路径经 workflow-store 再导出保持稳定）
- [x] 迁移内容：snapshot 写（insertSnapshot→SnapshotStore，19 处 governance 调用改走 `this.snapshotStore`）、资产 7 方法 + `normalizeActor*`/`actorNameKey`/`ReusableAsset*Error`（→AssetStore）、workspace 4 方法 + `WORKSPACE_DELETE_ORDER` + `deleteBlockingTriggers` + `BusyWorkspaceError`（→WorkspaceStore）；operator-server 的 error 类 import 经再导出生效；共享 `parseJson` 落 `json.ts` 避免模块环
- [x] 级联删除保持单事务（`BusyWorkspaceError` 前置检查仍在事务内，无 TOCTOU）；migration 单链 0001–0013 不动；`WorkflowDoctor` / `applyCutover` / 治理读查询（JOIN snapshot_documents）原地不动
- [x] 契约：32 catalog 资产字节零变更（`npm run test:contracts` 33/33 绿）
- [x] 门禁：`npm run test` 274/274 全绿（workspace-cascade-delete / operator-workspaces / migration-actor-kind / negative-scan 覆盖全部移动面）+ `npm run typecheck` + `npm run build` 全绿
- [x] 负向扫描：`workflow-store.ts` 零残留（normalizeActor*/actorNameKey/WORKSPACE_DELETE_ORDER/deleteBlockingTriggers/insertSnapshot 定义/error 类全部迁出）；web 面无前端变更