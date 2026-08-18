# Decide workspace API surface

Label: wayfinder:grilling
Assignee: pi-agent（2026-08-18 认领）
Status: closed
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

## Resolution（2026-08-18，grilling 一轮 + 先例侦察）

**G1 治理地位 —— 引擎外注册表 CRUD**。先例 = Reusable Asset CRUD（createReusableAsset / deleteReusableAsset 直接 runtime→store，无事件/回执/outbox）；命令引擎 19 命令全 workflow_id 作用域，工作区非治理对象；级联删除要删事件本身，塞进命令体系自相矛盾。→ headless-runtime 增 `listWorkspaces()` / `deleteWorkspace(id)`（直接委托 store）。

**G2 能力位 —— 不新增**。现状服务端零能力校验（capabilities 仅随 session 下发，前端用）；首个服务端强制位 = 半强制模型（approval/operate 仍不强制），且逼近图级划出的 ACL；授权 = 登录会话 + UI 确认 + 10 的护栏（active/queued run 门禁等）。demo token 与 `identity.capabilities` 均不动。

**G3 端点形状**：
- `GET /api/workspaces` → 200 `{ workspaces: [{ id, name, repoPath, createdAt }] }`（id 升序）；401 匿名/伪造 cookie（现有会话惯例）。
- `POST /api/workspaces` body `{ name, repoPath }`：trim 非空校验 → 400 `{ error: "malformed_workspace" }`；重复 repo_path（唯一约束）→ 409 `{ error: "duplicate_repo_path" }`；成功 201 `{ workspaceId }`。**name 允许重复**（repo_path 是身份，name 是标签）。
- `DELETE /api/workspaces/:id`：沿 asset 先例 → 404 `{ error: "unknown_workspace" }` 或 200 `{ deleted: true }`；级联 = 07 的单事务逆拓扑删除（33 表）+ 删后 PRAGMA foreign_key_check；护栏（有 active run 禁删、确认交互）归 10。删后一切 workspace-gated 读取按现有惯例 404（workspaceExists 检查）。

**运行时 / store 面**：store 增 `listWorkspaces()`（id/name/repoPath/createdAt，id 升序）与 `deleteWorkspace(id)`（07 删除顺序单事务 + 22 触发器 suspend/restore + 删后 foreign_key_check；事务失败抛错 → HTTP 500）；runtime 委托包装。`createWorkspace` 已有（store 直插，沿用）。

**契约 / 文档同步面（改动清单，11 落笔）**：`workflow-api-v1.json` 增 `workspaces` 段（沿 reusableAssets 结构：list / create / delete 三条目 + purpose）；双侧字节一致（agent-runtime/contracts/ ↔ .wayfinder/2026-08-auto-orchestration/assets/）；README 端点表 +3 行（GET / POST / DELETE `/api/workspaces`）。`identity.capabilities` 不动（G2）。

**错误语义对齐表**：401 会话缺失（现有惯例）；400 畸形 body；404 unknown_workspace（删除/读取）；409 重复 repo_path；200 / 201 成功。无 403（不引入能力位强制）。

**关联**：07（删除顺序）；10（active run 门禁 / 确认，解阻）；09（管理页消费 GET/POST、键失效判定用 GET 结果）；11（契约 / README / negative-scan / 测试）。