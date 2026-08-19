# 01 — 工作区注册表面（后端 list + create）

**What to build:** 已登录操作员可用 HTTP 列出全部工作区并创建新工作区；创建时必填 `name` 与 `repo_path`（trim 非空、`repo_path` 唯一即身份、`name` 允许重复），成功返回 201 + workspaceId，重复 repo_path 409、畸形 400；未登录/伪造 cookie 一律 401。本票同时把 CI 基线恢复全绿（见验收 4）。

**Source:** spec 故事 77 + Implementation Decisions「Workspace lifecycle and management」节（`.scratch/automatic-requirement-design-orchestration/spec.md`）；决议 08（`.scratch/workspace-management/issues/08-decide-workspace-api-surface.md`）。

**Blocked by:** None — can start immediately.

**Status:** done —— 实现于 fixed point `e10c671` 之后的工作树，提交见本票记录。

- [x] `GET /api/workspaces` → 200 `{ workspaces: [...] }`，id 升序，字段 `id / name / repoPath / createdAt`；匿名或伪造 cookie → 401（现有会话惯例）
- [x] `POST /api/workspaces` body `{ name, repoPath }`：任一 trim 空 → 400 `{ error: "malformed_workspace" }`（决议 08 锁码）；重复 `repo_path` → 409（唯一约束捕获）；成功 201 `{ workspaceId }`；`name` 允许重复
- [x] store 增 `listWorkspaces()`（id/name/repoPath/createdAt，id 升序）并经 runtime 透传到路由；`createWorkspace` 沿用既有实现
- [x] 新增后端 HTTP 测试（operator-*.test.ts 风格，真实 SQLite）覆盖 200/201/400/401/409 与列表排序；负向断言：任一未登录访问 401
- [x] 既有红断言「production web entry imports only baize-workflow」修订为 shell 现实（main.ts 导入 baize-shell，断言反向为「imports only baize-shell」），`agent-runtime` 全量测试与 negative-scan 恢复全绿