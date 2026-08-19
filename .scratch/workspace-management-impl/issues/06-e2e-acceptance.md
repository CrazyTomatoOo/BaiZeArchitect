# 06 — E2E 验收面（三视口工作区管理流）

**What to build:** 浏览器驱动的端到端验收：登录 → 管理页（列表/创建/删除两步确认）→ 进入 → 需求列表 → 详情返回；记住最近与失效回落；创建后直接进入新工作区；管理面未登录不可达。

**Source:** spec 故事 77–79 + Testing Decisions「Workspace lifecycle tests / Browser tests」；决议 09、10。

**Blocked by:** 04（管理页组件）, 05（shell 首屏与选中态）——全流程就绪后对接。

**Status:** done

- [x] `workspace-management.spec.ts`（route-level 全 mock，沿用 MockEventSource/fulfillJson 惯例）：登录 → 管理页列工作区 / 创建（201 + 直接进入 + 写键）/ 进入既有 → 需求列表 → 详情（primary-action 开始）→ 返回 → 顶栏回管理页
- [x] 删除流：行内两步确认（全量 danger 文案：工作区名 + 设计历史/审批记录 + 不可恢复，scope 至 role="dialog"）；409 `workspace_busy` 行内错误保留弹层；放行后成功移除回零态；删当前工作区清键
- [x] 记住最近：进入动作写键 + reload 直达该工作区；键失效（已删工作区）→ 管理页并清键
- [x] 页面导航：列表顶栏「管理工作空间」→ 管理页；零态（空列表）显示
- [x] 负向：无会话 → 登录表单，无管理面泄漏；三视口桌面/平板/窄屏全绿；`npm run test:e2e` 54/54 全量通过