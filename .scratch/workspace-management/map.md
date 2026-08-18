# Wayfinder Map — 工作区管理（登录首屏 · 增删查 · 级联删除） `wayfinder:map`

## Destination

产出「工作区管理」实现 spec（评审通过后另行执行）：**token 登录后首屏 = 工作区管理页**（列表 + 创建 + 级联删除）；**进入工作区后才是需求列表**；「记住最近」工作区（localStorage）+ 需求列表显式返回管理页入口；后端配套 `GET / POST / DELETE /api/workspaces`（删除为级联：连同工作区下所有需求与资产）。Destination 达成 = spec 评审通过、待决问题清零。

## Notes

- Domain：BaiZeArchitect 的 operator-server（HTTP）+ workflow-store（SQLite）+ Lit/Vite web SPA。Workspace 实体已存在（`workspaces`: id, repo_path unique, name, created_at；migration 0001），`requirements` / `reusable_assets` / `design_packages` 均已带 `workspace_id on delete restrict`；缺口是生命周期管理与入口面，不是关联本身。
- **当前树事实（2026-08-18 重绘侦察，已核对）**：`web/index.html` 挂载 `<baize-shell workspace-id="1">`；`baize-shell`（176 行，commit 05c9daa）管理 session（checkSession/bootstrapSession）+ 需求列表（`baize-requirements`）/ 详情（`baize-workflow`）切换，监听 `baize-open-requirement` / `baize-goto`；`workspaceId=1` 硬编码于 index.html 属性 + 三组件默认值；`baize-review-center` 仍未挂载（孤儿）。
- **既有红（图外债务）**：negative-scan「production web entry imports only baize-workflow」当前红（shell 提交 05c9daa 使断言过期；其 commit message 注明「待 shell 定型后更新」）。同文件「old web components are deleted」含 `web/src/baize-workspaces.ts` → 新工作区管理组件不可复用该文件名（或显式修订该断言，属 09 决议）。
- **契约耦合**：`agent-runtime/contracts/*.json`（workflow-api-v1 等）由 loader 装载，`workflow-contracts.test.ts` 断言与 `.wayfinder/2026-08-auto-orchestration/assets/` 字节一致 → 新增端点必须双侧同步，改单侧全测试红（08 决议范围）。
- **级联删除底座（07 已闭，全量见票）**：33 表逆拓扑单事务、22 个删除阻断触发器事务内 suspend/restore、`snapshot_documents` 跳过（digest 去重 + 不可变 + 跨工作区共享，孤儿有界累积）、无需迁移 0014、启动 reconcile FK 违例即拒服。
- **重绘历史**：本图 2026-08-16 chart（目的地 = 生命周期管理：软归档 + 重命名 + 选择器；前提 = 无 shell，`baize-workflow` 唯一挂载）。2026-08-18 用户重提交 shell（05c9daa，提交前 9 秒推翻图中「无 shell」前提）并重拍目的地（首屏管理页、级联删除、不改名、登录者全可见）→ **同图重绘**：01/03/05/06 作废，02/04 保留，新 frontier 07–11。
- Tracker：local-markdown；票在 `issues/`（NN- 前缀沿用），`blocked-by` 表达依赖；open + 无阻塞 + 未认领即 frontier。
- Skills：wayfinder、grilling、domain-modeling（CONTEXT.md 需新增「工作区」词条 —— 本图决议的一部分，10 起草、11 落 spec）。

## Decisions so far

<!-- 索引：每行一个 closed 票；决议本体只存在其票内，此处一行 gist + 链接。 -->

- [Decide repo_path policy at workspace creation](issues/02-decide-repo-path-creation-policy.md) — repo_path 必填 + 用户提供 + 任意非空唯一字符串、无真实路径/git 校验；纯唯一键 + 标签；创建表单含 repo_path + name 两字段。（保留）
- [Decide the fate of the existing demo workspace 1](issues/04-decide-demo-workspace-1-fate.md) — seeder 不变、无迁移；demo 1 是普通工作区；原「可归档」表述随 01 作废失效，新语义下可被级联删除。（保留）
- [Research workspace cascade-delete FK graph](issues/07-research-cascade-delete-fk-graph.md) — 级联删除底座：33 表逆拓扑单事务删除、22 个删除阻断触发器事务内 suspend/restore、snapshot_documents 跳过（digest 去重不可变、可跨工作区共享）、**裁决无需迁移 0014**（cascade 无法绕过触发器且要重建 22 表）；outbox_jobs 同事务删（事件丢失 = 硬删除预期）；启动 reconcile FK 违例即拒服 → 删除必须原子；repo_path 目录永不删、session/run jsonl 最佳努力 GC。08/10/11 依此。
- [Decide web shell navigation and selected-workspace state](issues/09-decide-web-shell-navigation-and-state.md) — Web 面全锁：`managerOpen: boolean` 四态（登录/详情隐式）；管理页 = `baize-workspace-manager.ts`（避开 negative-scan 已删名）；行式卡（进入 primary + 删除 danger 行内显示）+ 新建窄表单 + 零态 + 共用顶栏；键 `baize.workspaceId` 记住最近、失效清键回管理页；创建后直接进入；列表顶栏「管理工作空间」入口（两级返回）；index.html 去 `workspace-id="1"` 硬编码。
- [Decide workspace API surface](issues/08-decide-workspace-api-surface.md) — 引擎外注册表 CRUD（Reusable Asset 先例，无事件/outbox）；**不新增能力位**（服务端零能力校验现状，任何已登录可删，护栏归 10）；三端点：GET → 200 `{workspaces:[{id,name,repoPath,createdAt}]}`、POST → 201 `{workspaceId}`（400 trim 校验 / 409 重复 repo_path, name 允许重复）、DELETE → 沿 asset 先例 404 `unknown_workspace` / 200 `{deleted:true}`（07 单事务级联 + 删后 foreign_key_check）；runtime 增 listWorkspaces/deleteWorkspace；契约 workspaces 段双侧同步归 11。
- [Decide workspace delete guards](issues/10-decide-delete-guards.md) — 行内两步确认（`role="dialog"` 沿 gate-form 例，danger + 不可恢复文案）；门禁 = **仅引擎在飞**（runs queued/running 或 claims active → 409 `workspace_busy`，store 事务内先探后删；human_gates/design_sessions 不挡，确认文案覆盖）；用后回管理页 + 清键（09 协约）；ADR 成立（docs/adr/ADR-005）+ CONTEXT「工作区」词条落笔归 11；snapshot 孤儿雾区收口。

## Not yet specified

当前无雾——级联删除的 snapshot_documents 孤儿政策已由 07/10 收口（跳过删除、有界累积、未来独立 GC）；多操作员可见性早已拍出范围并留 Out of scope。

## Out of scope

<!-- 超出本目的地的工作：scoping 行为，非路线步骤；closed 票在此留一行 gist + 链接。 -->

- [Decide workspace retirement semantics](issues/01-decide-workspace-archive-semantics.md)（作废）— 软归档（archived_at / archive / restore / 只读归档视图）被用户拍板的「级联删除」取代；删除面迁至 07/08/10。
- [Decide the selected-workspace state carrier in the web shell](issues/03-decide-selected-workspace-state-carrier.md)（作废）— 前提过期：「无 shell、baize-workflow 唯一挂载」被 05c9daa 推翻；且首屏重拍为管理页（03 的「默认首个活跃」不再成立）。状态载体决议点迁至 09。
- [Decide the web host for workspace management](issues/05-decide-web-host-for-workspace-management.md)（作废）— 前提过期，同 03；「扩展 baize-workflow 内部视图、不建 shell」的根基（无 shell）已不存在；管理页宿主迁移至 shell 级首屏。导航/状态迁移至 09。
- [Prototype the workspace management panel interaction](issues/06-prototype-workspace-management-panel.md)（作废）— 语义换血：重命名 / 已归档折叠区 / 恢复动作取消；IA 草图 `prototypes/panel-ia-sketch.md` 留作参考资产（创建表单、顶栏、零态观念可复用，重命名与已归档区不再适用）。
- 工作区改名（用户 2026-08-18 拍板不支持）。
- 按操作员隔离 workspace 可见性 / ACL（保持登录者全可见，2026-08-18）。
- 更高层 `project` 概念（「项目」= 既有 workspace）；跨工作区资产/需求迁移；workspace 级操作员会话。（既有）
- `baize-review-center` 挂载与泛化导航设施（仍为未挂载孤儿；本图仅在既有 shell 之上叠加首屏管理页）。

## Frontier 查询（open + 无阻塞 + 未认领）

- 11-task-write-mgmt-spec（task，terminal——已全解阻）