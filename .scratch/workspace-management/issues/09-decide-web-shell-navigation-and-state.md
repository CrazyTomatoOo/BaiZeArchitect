# Decide web shell navigation and selected-workspace state

Label: wayfinder:grilling
Assignee: pi-agent（2026-08-18 认领）
Status: closed
blocked-by: none

## Question

前端「登录首屏 = 工作区管理页、进入工作区后才是需求列表」的视图流与选中工作区状态载体。前提（树事实，05c9daa 后）：`baize-shell` 挂载于 index.html（`workspace-id="1"` 硬编码），管 session + 需求列表（`baize-requirements`）/ 详情（`baize-workflow`）切换（`baize-open-requirement` / `baize-goto`）；两组件收 `workspaceId` 属性，默认 1。

## 待决议

1. **视图流与首屏**：登录成功后首屏 = 工作区管理页；进入工作区 → 需求列表；点需求 → 详情（不变）；需求列表需显式「返回管理页」入口（用户拍板）。shell 的视图状态如何表达（现有 CustomEvent 惯例 vs 状态枚举）——新工作区管理组件命名：`baize-workspace-manager.ts`（避开 negative-scan 已删名 `baize-workspaces.ts`）vs 修订 negative-scan 断言（该文件本就有红断言待修，见 Notes）。`baize-review-center` 保持不挂载。
2. **选中态载体**：`localStorage` 键（沿用 `baize.workspaceId`？）；「记住最近」写入时机（进入工作区时）；刷新/重开直达最近工作区；**失效回落**——已存 id 已不存在（被级联删除）→ 回管理页；无已存 → 回管理页（取代 03 旧决议「默认首个活跃」）；回落后是否清键。
3. **index.html 去硬编码**：`workspace-id="1"` 移除/动态化；`baize-requirements` / `baize-workflow` 的 `workspaceId` 由 shell 注入（属性在 `workspace-id` 变化时联动，Lit `updated`）；两个组件的默认值 1 处置。
4. **管理页形态**：列表布局（卡片 vs 行）、创建表单（repo_path + name，02 政策）、删除按钮（确认交互归 10）、零态（「创建第一个工作区」）；侧挂负向：负向扫描需覆盖「管理页仅登录可见」。
5. **删除后的落点**：删除当前所在工作区 → 回管理页 + 处理 localStorage 键（与 10 协约）。

## Resolution（2026-08-18，grilling 两轮；树事实见 Question 前提 + baize-shell.ts 侦察）

**1. 视图状态表达 —— `managerOpen: boolean`**。登录仍由 `!session` 隐式（token 表单）；详情仍由 `requirementId > 0` 隐式；`managerOpen=true` 渲染管理页。render 分支顺序：`!session` → 登录；`requirementId > 0` → 详情（优先于管理页，杜绝残留）；`managerOpen` → 管理页；else → 需求列表。进入工作区 = `managerOpen=false` + `requirementId=0` + 写键；返回管理页 = `managerOpen=true` + `requirementId=0`。

**2. 组件与文件 —— `web/src/baize-workspace-manager.ts`**（custom element `<baize-workspace-manager>`）。新面新名，不碰 negative-scan「已删旧件」名单（名单语义 = 旧面不可复活）；既有红断言（main.ts 只 import baize-workflow）留票 11 与 shell 现实一起修。

**3. 管理页形态**（沿 baize-requirements 惯例，行容器用 `div.card` 非 button——行内按钮防非法嵌套，整行不可点）：
- `.card.item` 行式卡：`name` 主行 + `repo_path` 等宽副行；右侧操作 = 「进入」primary 按钮 + 「删除」danger 按钮**直接显示**（不藏菜单）；删除确认交互归票 10。
- 「＋ 新建工作空间」折叠表单（head 按钮 + `.card.create` 窄表单）：`名称` + `repo_path`（02 政策：必填、任意非空字符串、不校验）；提交走 POST（08 形状）→ 成功 = 写键 + **直接进入**新工作区（Q4 拍板，沿「创建需求并开始设计」旅程式 UX）。
- 零态：`.card` + `.empty`「还没有工作空间，创建第一个来组织需求与资产」+ 新建按钮。
- 顶栏：与列表共用（品牌 + 退出）；**列表**顶栏新增「管理工作空间」入口（返回语义 = 两级：详情 → 列表 → 管理页）。
- 数据加载：进入管理页每次 `GET /api/workspaces`（08 端点形状），无缓存。

**4. 选中态 —— 键 `baize.workspaceId`**。写入时机 = 进入工作区（点「进入」或创建成功）；加载序：登录后若有合法已存键 → 直达该工作区需求列表（记住最近）；无键 / 键失效（工作区已被删）→ 管理页并清键；失效判定 = 键值不在 `GET /api/workspaces` 结果中。刷新 / 重开同序。删除当前所在工作区（10 协约）→ 回管理页 + 清键（前端行为本票锁定）。

**5. index.html 去硬编码**：移除 `workspace-id="1"` 属性；shell 不再收静态 workspaceId——自持 `workspaceId`（初始未选）与 `managerOpen`，按第 4 条加载；`baize-requirements` / `baize-workflow` 仍以 `.workspaceId` 属性接收**动态**值；两组件默认 1 仅作未注入兜底（实际由 shell 恒注入）。

**6. 既有债务（记档不改动，归 11）**：`baize-workflow` 自带 checkSession 登录兜底与 shell 重复（潜在双会话检查）；negative-scan 红断言。

**7. 负向扫描**：管理页仅登录可见（归 11 验收）。

**关联**：删除确认交互 / 能力位 / 活跃运行门禁 → 10；三端点形状 → 08；spec / README / 契约 / negative-scan → 11。无新雾——管理页形态确定后 10 的按钮容器与 08 的 GET 字段需求均明确。