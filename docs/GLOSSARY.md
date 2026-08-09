# BaiZeArchitect 术语表

来源：[`/Volumes/work/Project/BaiZeArchitect/.omo/plans/refactor-2.0.md`](.omo/plans/refactor-2.0.md) §2 领域模型。

| 中文 | English | Definition | Glossary note（UI 用法） |
|------|---------|------------|--------------------------|
| 需求 | Requirement | 用户输入的原始业务诉求 | Workbench 运行基于单个 Requirement 创建，运行标题、需求版本等 UI 文案中直接使用。 |
| 领域 | Domain | 需求所属的业务领域 | 用于分类与筛选，UI 中显示为领域标签或过滤条件。 |
| 设计任务 | Design Task | 一次需求解析与方案生成的会话 | Workbench 中一次运行（Run）对应一次 Design Task，列表项与详情页标题使用运行 ID。 |
| 决策 | Decision | 多选方案中的一次绑定选择 | `DecisionPanel` 展示决策的标题、重要性、选项、推荐、理由；按钮文案使用 `actions.approve` / `actions.reject` / `actions.requestChanges`。 |
| 发现 | Finding | Agent 对需求/方案的分析结论 | `FindingCard` 展示 Finding 的标题、严重等级、角色、置信度和处理结果。 |
| 审批 | Approval | 人类用户对 agent 决策的确认、拒绝或要求修改 | 审批动作映射到 `decision.rejectTitle` / `decision.requestChangesTitle` 等文案，原因必填。 |
| 运行时 | Runtime | 一组 agent 角色按编排顺序执行的过程 | `ProgressRail` 与 `AgentStream` 展示运行时步骤与事件，状态标签使用 `status.*` 命名空间。 |
| 角色 | Role | Agent 在运行时所承担的职责 | 角色 ID 为英文小写（`orchestrator` 等），UI 显示使用 `roles.*` 本地化标签。 |
| 用户 | User | 通过 GitHub OAuth 登录的个体 | 登录页使用 `login.*` 文案；登录后 header 展示当前用户名。 |
| 团队 | Team | 用户所属的组织单元，拥有操作权限 | 团队令牌与审批权限相关，错误提示使用 `error.approvalPermissionRequired`。 |
| 架构投影快照 | Architecture Projection Snapshot | 同一仓库提交与投影版本对应的不可变、可审计 C4 事实图 | 架构浏览、导出和需求证据均显示并引用同一快照标识。 |
| 可见图 | Visible Graph | 一个架构投影快照经层级、根、筛选、聚焦和聚合展开后可呈现的节点与关系集合 | 画布、导出和节点/边计数以可见图为准，且首版上限为 500 个节点。 |

## 角色定义

| 角色 | 颜色 | 职责 | UI 用法 |
|------|------|------|---------|
| Orchestrator | 灰色 | 解析需求、分配任务、汇总输出 | `roles.orchestrator` |
| Architect | 蓝色 | 生成架构/方案选项 | `roles.architect` |
| Critic | 橙色 | 评审方案、发现风险 | `roles.critic` |
| Analyst | 紫色 | 需求拆解、术语澄清 | `roles.analyst` |
| Reviewer | 绿色 | 人工审批决策 | `roles.reviewer` |
| Translator | 粉色 | 多语言输出与一致性校验 | `roles.translator` |

## i18n 命名空间速查

- `app.*` — 应用级标题与描述
- `nav.*` — 导航文案
- `roles.*` — 6 个 agent 角色显示名称
- `actions.*` — 按钮动作（批准、拒绝、要求修改等）
- `status.*` — 运行/决策状态（空闲、运行中、已完成、失败、待审批）
- `severity.*` — Finding 严重等级（严重、高、中、低、信息）
- `events.*` — SSE 事件类型标签
- `workbench.*` — Workbench 页面文案
- `decision.*` — 决策面板与审批弹窗文案
- `finding.*` — Finding 卡片文案
- `common.*` — 通用组件（空数据提示等）
- `auth.*` — 登录/加载状态文案
- `error.*` — 前端错误与后端 `messageKey` 映射
