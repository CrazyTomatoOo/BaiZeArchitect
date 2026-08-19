# Task: write workspace management spec for review

Label: wayfinder:task
Assignee: pi-agent（2026-08-18 认领）
Status: closed
blocked-by: 07-research-cascade-delete-fk-graph；08-decide-workspace-api-surface；09-decide-web-shell-navigation-and-state；10-decide-delete-guards

## Question

把 07–10 的决议汇总为可评审的实现 spec（Destination 交付物）：文档面修订清单、契约同步面、验收标准；**只写 spec，不实现**。评审通过后另行执行（新 effort）。

## 产出面

1. **master spec** `.scratch/automatic-requirement-design-orchestration/spec.md`：新增用户故事（工作区管理：登录首屏管理页、列表/创建/级联删除、进入/返回、记住最近）——编号策略按既有先例（编号保留、原地插入，防交叉引用失效）；操作体验节改写：登录 → 工作区管理页 → 进入 → 需求列表 → 详情。
2. **CONTEXT.md**：新增「工作区/Workspace」词条（草稿于 10，落实于此）。
3. **README**：端点表增补 `GET/POST/DELETE /api/workspaces`。
4. **契约目录**：`workflow-api-v1.json`（双侧：`agent-runtime/contracts/` 与 `.wayfinder/2026-08-auto-orchestration/assets/` 字节一致）改动清单。
5. **negative-scan.test.ts**：修「production web entry imports only baize-workflow」红断言（shell 现实化）；新组件命名登记（09 决议）。
6. **ADR 草稿**（10 决议）；验收标准清单（评审用）。
7. **收口**：本票关闭后 frontier 空，Destination = spec 交付评审。

## Resolution（2026-08-18）

**spec 落笔（`.scratch/automatic-requirement-design-orchestration/spec.md`，四处）**：
1. **User Stories 77–79**（编号接 76 后原地追加）：工作区管理页首屏（77）/ 记住最近 + 显式返回 + 失效回落（78）/ 级联删除 + 引擎在飞拒绝（79）——英文 "As a…" 风格与既有列表一致。
2. **Implementation Decisions 新节「### Workspace lifecycle and management」**：注册表 CRUD（Reusable Asset 先例、无事件/outbox、无能力位）、创建语义（name/repo_path、409/400/201）、级联删除（33 表逆拓扑单事务、触发器事务内 suspend/restore、snapshot 跳过、409 workspace_busy 门禁）、Web 首屏/选中态（localStorage 键 + 失效回落清键）、`baize-workspace-manager.ts` 与行内两步删除确认、**执行期同步清单**（README +3 行 / workflow-api-v1 workspaces 段双侧字节一致 / negative-scan 红断言修订 + 组件登记 / CONTEXT 词条 / ADR-005）。
3. **Testing Decisions +2 条**：工作区生命周期 HTTP/真实 SQLite 测试（建列删、409、401、删全量填充工作区后重开 Store 干净 foreign_key_check、忙拒绝）+ 浏览器测试（管理页、localStorage 回落、导航）+ 负向扫描（管理面仅登录可见）。
4. **Out of Scope +1 条**：改名 / 按工作区 ACL / project 上层 / 跨工作区迁移 / workspace 级会话 / 软归档恢复路径。

**CONTEXT.md**：新增「Workspace（工作区）」词条（仓库注册 + 快照归属 + 容器；删除 = 级联销毁治理事实；多操作员共享无 ACL）。**docs/adr/ADR-005-workspace-cascade-delete.md**：draft（resolution 来源 07/08/10；弃软归档原因 + 机械可行性与后果）。

**未应用（执行期，评审后另行执行）**：README/契约/negative-scan 改动仅在 spec 清单中描述——契约双侧字节一致不可单侧落笔；negative-scan 红断言为 shell 提交后的既有债务（05c9daa commit message 自注），按 Destination「评审后执行」纪律留待实现期统一修订。验收标准 = spec Testing Decisions 新增两条。

**收口**：frontier 空。Destination = spec 交付评审（本票关闭 ≠ 执行开启）。