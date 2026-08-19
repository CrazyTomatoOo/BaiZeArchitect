# 06 — E2E 验收面（三视口工作区管理流）

**What to build:** 浏览器驱动的端到端验收：登录 → 管理页（列表/创建/删除两步确认）→ 进入 → 需求列表 → 详情返回；记住最近与失效回落；创建后直接进入新工作区；管理面未登录不可达。

**Source:** spec 故事 77–79 + Testing Decisions「Workspace lifecycle tests / Browser tests」；决议 09、10。

**Blocked by:** 04（管理页组件）, 05（shell 首屏与选中态）——全流程就绪后对接。

**Status:** ready-for-agent

- [ ] `workspace-management.spec.ts`（route-level 全 mock，沿用既有 MockEventSource/fulfillJson 惯例）：登录 → 管理页列出工作区 → 创建（走通 201 与直接进入）→ 进入既有工作区 → 需求列表 → 详情 → 返回
- [ ] 删除流：行内两步确认（danger 文案）/ 409 `workspace_busy` 行内回显 / 删除成功回管理页
- [ ] 记住最近：进入后 reload 直达该工作区；键值指向已删工作区（GET 列表不含）→ 管理页
- [ ] 页面导航：列表顶栏「管理工作空间」→ 管理页；零态（空列表）显示
- [ ] 负向：无会话直达任意管理面路由 → 登录表单；三视口桌面/平板/窄屏全绿；`npm run test:e2e` 通过