# 02 — 级联删除内核（store 事务 + DELETE 端点 + busy 门禁）

**What to build:** 已登录操作员删除一个工作区后，其下所有需求、资产与治理历史（事件、回执、审批、设计包等）在一次事务内彻底消失，系统保持可用；引擎在飞（run 排队/运行中或 claim 被持有）时删除被拒；删后该工作区一切访问 404。

**Source:** spec 故事 79 + Implementation Decisions「Workspace lifecycle and management」节；决议 07（FK 图与删除顺序，`.scratch/workspace-management/issues/07-research-cascade-delete-fk-graph.md`）与决议 10（护栏，`10-decide-delete-guards.md`）；ADR-005（docs/adr/）。

**Blocked by:** None — can start immediately（与 01 并行，共享 store/runtime/server 文件但方法独立，改动以追加为主）。

**Status:** done

- [x] store `deleteWorkspace(id)`：33 表逆拓扑单事务删除（顺序见 07 决议），22 个删除阻断触发器在事务内 suspend/restore（DDL 实时取自 sqlite_master，事务性可回滚）；`snapshot_documents` 永不触碰（digest 去重共享不可变）
- [x] 忙门禁在同一事务内先探后删：该工作区任一 `runs.status ∈ (queued, running)` 或 `governance_claims.status = active` → 抛 BusyWorkspaceError；并发竞态由事务原子性 + FK 兜底
- [x] `DELETE /api/workspaces/:id`：不存在 → 404 `{ error: "unknown_workspace" }`；忙 → 409 `{ error: "workspace_busy" }`（附命中计数）；成功 → 200 `{ deleted: true }`；删后该工作区一切 workspace-gated 读取 404
- [x] runtime 增 `deleteWorkspace(id)` 透传；路由接线完成
- [x] 集成测试：删除全量填充的工作区（含两级需求/资产/运行记录）→ 重开 Store，`PRAGMA foreign_key_check` 干净；忙拒绝用例（构造 queued run 与 active claim 各一）