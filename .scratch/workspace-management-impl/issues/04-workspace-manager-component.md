# 04 — 工作区管理页组件（baize-workspace-manager + client 三函数）

**What to build:** 工作区管理页 UI——行式卡片列出全部工作区（name + repo_path），顶部「新建工作空间」折叠表单（name + repo_path），行内「进入」与「删除」按钮，删除为两步确认（不可恢复文案），零态引导创建；typed client 三个新函数齐备。本票交付组件本体与组件级测试，接入 shell 由 05 负责。

**Source:** spec 故事 77 + Implementation Decisions 节；决议 09（`.scratch/workspace-management/issues/09-decide-web-shell-navigation-and-state.md`）与 06 的 IA 草图（prototypes/panel-ia-sketch.md，仅参考创建表单/零态观念）。

**Blocked by:** 01（list/create API）, 02（delete API）——组件消费真实端点。

**Status:** done

- [x] 新组件 `baize-workspace-manager`：`.card.item` 行式卡（`name` 主行 + `repo_path` 等宽副行），行容器 div.card.item（行内按钮防嵌套）；右侧「进入」primary + 「删除」danger 直接显示
- [x] 新建折叠表单：`名称` + `repo_path` 必填；400/409 行内错误回显（malformed_workspace/duplicate_repo_path 文案映射）；成功经 `baize-enter-workspace` 事件直达进入
- [x] 删除：行内两步确认（role="dialog"，文案沿决议 10「将级联删除其下所有需求与资产（含设计历史、审批记录），不可恢复」）；失败保留弹层行内错误回显；进行中禁用
- [x] 零态卡片「还没有工作空间,点击「新建工作空间」创建第一个来组织需求与资产。」；数据加载失败行内错误
- [x] workflow-client 增 `listWorkspaces / createWorkspace / deleteWorkspace`（typed）+ WorkspaceApiError + 纯助手（normalizeWorkspaceInput / 错误文案映射，文案真源在 client 层）；组件测试（vitest 40/40）+ `npm run typecheck` `npm run test` `npm run build` 全绿