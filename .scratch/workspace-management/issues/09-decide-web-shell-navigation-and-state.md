# Decide web shell navigation and selected-workspace state

Label: wayfinder:grilling
Assignee: （未认领）
Status: open
blocked-by: none

## Question

前端「登录首屏 = 工作区管理页、进入工作区后才是需求列表」的视图流与选中工作区状态载体。前提（树事实，05c9daa 后）：`baize-shell` 挂载于 index.html（`workspace-id="1"` 硬编码），管 session + 需求列表（`baize-requirements`）/ 详情（`baize-workflow`）切换（`baize-open-requirement` / `baize-goto`）；两组件收 `workspaceId` 属性，默认 1。

## 待决议

1. **视图流与首屏**：登录成功后首屏 = 工作区管理页；进入工作区 → 需求列表；点需求 → 详情（不变）；需求列表需显式「返回管理页」入口（用户拍板）。shell 的视图状态如何表达（现有 CustomEvent 惯例 vs 状态枚举）——新工作区管理组件命名：`baize-workspace-manager.ts`（避开 negative-scan 已删名 `baize-workspaces.ts`）vs 修订 negative-scan 断言（该文件本就有红断言待修，见 Notes）。`baize-review-center` 保持不挂载。
2. **选中态载体**：`localStorage` 键（沿用 `baize.workspaceId`？）；「记住最近」写入时机（进入工作区时）；刷新/重开直达最近工作区；**失效回落**——已存 id 已不存在（被级联删除）→ 回管理页；无已存 → 回管理页（取代 03 旧决议「默认首个活跃」）；回落后是否清键。
3. **index.html 去硬编码**：`workspace-id="1"` 移除/动态化；`baize-requirements` / `baize-workflow` 的 `workspaceId` 由 shell 注入（属性在 `workspace-id` 变化时联动，Lit `updated`）；两个组件的默认值 1 处置。
4. **管理页形态**：列表布局（卡片 vs 行）、创建表单（repo_path + name，02 政策）、删除按钮（确认交互归 10）、零态（「创建第一个工作区」）；侧挂负向：负向扫描需覆盖「管理页仅登录可见」。
5. **删除后的落点**：删除当前所在工作区 → 回管理页 + 处理 localStorage 键（与 10 协约）。

## Answer（待 grilling）