# Decide workspace delete guards and data-loss documentation

Label: wayfinder:grilling
Assignee: pi-agent（2026-08-18 认领）
Status: closed
blocked-by: 07-research-cascade-delete-fk-graph; 08-decide-workspace-api-surface

## Question

级联删除（用户已拍板：连同工作区下所有需求与资产一并清掉；软归档作废）的护栏与数据丢失文档化。

## 待决议

1. **确认交互**：管理页删除按钮 → 确认形态（二次确认？键入工作区名确认？现有 overlay / `danger` 按钮 / 回执惯例）；删除进行中状态与失败回显。
2. **可删权限**：所有登录操作员可删 vs 能力位限定（结论随 08 的治理地位决议；若 08 定「引擎外 CRUD」，能力位问题在此收口）。
3. **活跃运行保护**：workspace 下存在 active/queued run 时是否禁删（07 的 engine 引用面 + 启动 reconcile 对缺失行的行为）；SSE 断连时是否禁用删除。
4. **删除后落点与清理**：回管理页 + 清 localStorage 键（与 09 协约）；已删工作区再被访问（旧 URL/旧投影）→ 404 预期。
5. **文档化**：ADR（数据破坏性语义——难反转、无外部预期、真实权衡，含与 01 软归档方案的对比）；CONTEXT.md 新增「工作区/Workspace」词条草稿（domain-modeling：仓库注册 + 快照归属 + 需求/资产容器 + 级联删除语义）；spec 操作体验节的数据丢失提示文案。

## Resolution（2026-08-18，grilling 一轮 + 状态词表侦察：migrations 0001/0004/0006/0010）

**D1 确认交互 —— 行内两步确认**。管理页行内 danger「删除」→ 该行展开内联确认（`role="dialog"`，沿 gate-form 先例）：文案「删除工作区 {name}?将级联删除其下所有需求与资产（含设计历史、审批记录），**不可恢复**」；操作 [删除(danger)] [取消]；无 `window.confirm`、无 typed-name。删除进行中：按钮禁用 + 「删除中…」；失败（409 workspace_busy / 500）→ 行内错误回显。

**D2 门禁范围 —— 仅引擎在飞（最小）**。`deleteWorkspace` 前置检查（按该工作区全部 requirement→workflow→task→attempt→run 聚合）：
- `runs.status ∈ ('queued','running')`
- `governance_claims.status = 'active'`
任一命中 → 拒绝，HTTP 409 `{ error: "workspace_busy" }`（附命中 run/claim 计数）。**不阻挡**：human_gates.open、design_sessions.active（删除者本人即人，确认文案已覆盖；07 的机械风险面仅有引擎在飞）。
- 位置：store.deleteWorkspace 单事务内先探测 busy 再删除（原子性最好）；竞态说明：门禁是 UX 防线而非竞态保证——删事务本身原子，并发插入由 FK 兜底（会后 FK 错误），删后 `foreign_key_check` 佐证干净（07）。
- 实现：store 抛 BusyWorkspaceError → runtime 透传 → HTTP 409。

**用后语义（已锁，回引）**：删除当前工作区 → 前端回管理页 + 清 `baize.workspaceId`（09）；删后一切访问 404（08）；干净删除不影响启动 reconcile（07）。

**文档化（内容本票定，落笔归 11）**：
- **ADR 成立**（domain-modeling 三条件全中：难反转——销毁治理历史；无外部预期——软归档先例被取代、33 表级联是隐藏复杂度；真实权衡——归档（可逆/零删代码）vs 级联（彻底/一事务）vs 空壳删（搁浅资产））→ 11 起草 `docs/adr/ADR-005-workspace-cascade-delete.md`：为何弃软归档（用户拍板 + 级联语义一致 + 07 已验证机械可行）、勿回退归档的说明。
- **CONTEXT.md「工作区/Workspace」词条草稿**（11 落位）：仓库注册（repo_path 唯一 = 身份，name = 标签可重）+ 快照归属 + 需求/资产/设计包容器；删除 = 级联销毁其下全部治理事实（不可恢复）；多操作员共享、无 per-workspace ACL；创建必填 repo_path（纯标签，不校验）。
- spec 操作体验节数据丢失提示文案（11）；负向扫描：管理页仅登录可见、删除按钮仅登录可见（11 验收）。

**雾区收口**：snapshot_documents 孤儿政策——07 已决（跳过删除、digest 去重下有界累积、未来独立 GC 需 suspend 触发器 + 引用计数）；本图不再有雾（多操作员可见性早已拍出范围）。

**关联**：07（删除顺序/竞态/原子性）、08（端点语义/无能力位/404）、09（行内按钮容器、删除后落点 + 清键）、11（ADR/CONTEXT/spec/README/契约/测试落笔，解阻）。