# 05 — shell 首屏与选中态（managerOpen + localStorage + 返回入口）

**What to build:** 登录成功后首屏 = 工作区管理页（无已存选择亦然）；进入工作区 → 需求列表；详情两级返回（详情 → 列表 → 管理页）；选中工作区被记住，刷新/重开直达最近；失效（工作区已删）回落管理页并清键；删除当前工作区回到管理页；页面不再从文档读静态 workspace-id。

**Source:** spec 故事 78 + Implementation Decisions 节；决议 09 全部条款。

**Blocked by:** 04（管理页组件）——shell 渲染它并消费其事件。

**Status:** ready-for-agent

- [ ] shell 视图四态：`!session` → 登录；`requirementId > 0` → 详情（优先）；`managerOpen` → 管理页；否则需求列表；进入工作区 = 清 manager + 清 requirementId + 写键；返回管理页 = 置 manager
- [ ] 选中态：`localStorage["baize.workspaceId"]` 进入时写入；加载序——有合法已存键直达该工作区需求列表；无键/键值不在工作区列表（已删）→ 管理页并清键；管理页列表数据每次进入拉取（无缓存）
- [ ] 列表顶栏「管理工作空间」入口（与退出同排）；详情视图不加新入口（两级返回保持）
- [ ] 删除当前所在工作区 → 回管理页 + 清键（消费 02 删除成功信号）
- [ ] index.html 移除静态 `workspace-id="1"`；shell 自持选中态，列表/详情收到动态 workspaceId
- [ ] shell 状态逻辑 vitest + `npm run typecheck` `npm run test` `npm run build` 全绿