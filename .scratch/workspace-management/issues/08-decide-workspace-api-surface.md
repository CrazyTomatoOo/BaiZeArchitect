# Decide workspace API surface

Label: wayfinder:grilling
Assignee: （未认领）
Status: open
blocked-by: 07-research-cascade-delete-fk-graph

## Question

工作区生命周期管理的 HTTP 面与治理地位。现状：store 仅 `createWorkspace` / `workspaceExists`；HTTP 仅 `POST /api/workspaces/:id/requirements`。需要钉：列表/创建/删除端点形状与语义、能力位、命令体系内/外、契约三侧同步面。

## 待决议

1. **端点形状**：
   - `GET /api/workspaces` — 响应字段（id / name / repo_path / created_at；是否含需求数/资产数供管理页卡片展示）；排序规则。
   - `POST /api/workspaces` — 请求体（name + repo_path，02 已锁政策：必填、任意非空字符串、不校验真实路径）；重复 repo_path → 409；响应 201 + 新工作区身份。
   - `DELETE /api/workspaces/:id` — 级联语义按 07 的删除图；不存在 → 404；成功响应形态；是否允许删「自身当前所在」工作区无特别语义（前端落点归 09/10）。
2. **治理地位**：workspace CRUD 走 19 命令引擎（事件/回执/outbox/幂等/能力位）还是引擎外普通注册表 CRUD（现状 createWorkspace 即直插，无事件）？级联删除的破坏性是否需要能力位（新 `workspace:manage`？）——是否进命令回执体系（删除也是一条可追溯事件？）。
3. **契约同步面**：`workflow-api-v1.json` 增补（管理端点条目）+ 与 `.wayfinder/2026-08-auto-orchestration/assets/` 字节一致（workflow-contracts.test.ts 断言）+ README 端点表；headless-runtime 新增方法面（`listWorkspaces` / `deleteWorkspace`，store 侧 `createWorkspace` 已有）。
4. **会话/错误惯例**：匿名/伪造 cookie 下三端点行为（401，现有惯例）；已删 id → 404；`GET` 列表是否要求登录（是）。

## Answer（待 grilling）