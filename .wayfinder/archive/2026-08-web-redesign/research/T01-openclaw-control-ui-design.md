# T01 — OpenClaw Control UI 页面设计调研

## Question

OpenClaw Control UI 的**页面设计**是什么样的,哪些可借到 BaiZe?按四维度深挖:

- 视觉语言:配色(尽量到 hex)、暗色/亮色主题、密度、字体、圆角/阴影、状态色。
- 信息架构/导航:sidebar 分区与页面清单、agent 作用域切换、设置/配置的组织方式。
- 交互模式:WS 实时更新、chat/流式、命令面板/键盘操作、浏览器本地 UI 状态(theme 存哪)。
- 布局/组件:页面骨架、卡片、列表-详情、徽章/状态点、空态/加载态。

## Findings

调研方法:官方文档(docs.openclaw.ai/web/control-ui)+ 仓库 `ui/` 目录源码精读(Vite+Lit SPA,`ui/src/styles/base.css` 是 design token 单一来源,`ui/src/styles/layout.css` 是骨架尺寸来源,`ui/src/app-routes.ts` 是页面清单来源)。本地 shallow clone 于 /tmp/openclaw-src。

### 1. 视觉语言

**主题体系**:三套内置主题 + 一个浏览器本地自定义槽。`ThemeName = "claw" | "knot" | "dash" | "custom"`,每套有 dark/light 两个变体,通过 `<html data-theme="..." data-theme-mode="...">` 切换 CSS vars(来源:`ui/src/app/theme.ts`、`ui/src/styles/base.css` L190/L314/L458)。自定义主题从 tweakcn.com 导入,只存浏览器。

**默认主题 Claw(深色)token 全表**(来源:base.css L3-108,注释里附 WCAG 2.1 AA 对比度审计):

| Token | 值 | 用途 |
| --- | --- | --- |
| `--bg` | `#0e1015` | 页面底色(相对亮度 ≈0.005) |
| `--bg-accent` | `#13151b` | 次级底 |
| `--bg-elevated` / `--popover` | `#191c24` | 浮层 |
| `--bg-hover` / `--bg-muted` | `#1f2330` | hover |
| `--card` | `#161920` | 卡片底 |
| `--panel` / `--panel-strong` | `#0e1015` / `#191c24` | 面板 |
| `--text` | `#d4d4d8` | 正文 |
| `--text-strong` | `#f4f4f5` | 强调文字 |
| `--muted` | `#8b8b94` | 次要文字 |
| `--border` | `#1e2028` | 边框(极暗,靠亮度差区分层) |
| `--border-strong` | `#2e3040` | 强边框 |
| `--accent` | `#ff5c5c` | 品牌红(龙虾),bg 上 6.3:1 |
| `--primary` | `#d13c3c`(hover `#c22e2e`) | 主按钮,白字 4.75:1 |
| `--accent-2` / `--run` | `#14b8a6` | 青色,**"运行中"专用色**,bg 上 7.7:1 |
| `--ok` | `#22c55e` | 成功,6.66:1 |
| `--warn` | `#f59e0b` | 警告,6.93:1 |
| `--danger` | `#f87171` | 错误文本,5.52:1 |
| `--destructive` | `#ef4444` | 破坏性按钮 |
| `--info` | `#60a5fa` | 信息,5.97:1 |
| `--selection-bg` | `#005fcc` | 选区 |

状态色配套 `*-muted`(0.75 alpha)和 `*-subtle`(0.08 alpha)变体,用于徽章底色。**注意:运行中 = 青 `#14b8a6`,与成功绿 `#22c55e` 显式区分**,这是 operator UI 的关键设计。

**其他主题**:Knot 是纯黑风(`--bg #080808`,accent `#e5243b` 红);Dash 是暖棕风(`--bg #1a1210`,`--card #221a16`,accent `#b47840`,text `#d8c8b8`)。亮色模式:`--bg #faf9f7`,accent `#bd4531`,text `#403c35`(10.4:1 AAA)。

**字体**:`--font-body: "Inter", -apple-system, ...`;等宽 `--mono: "JetBrains Mono", ui-monospace, SFMono-Regular, ...`(base.css L76/L123)。Text size 可调(md 档),输入框保底 16px 防 iOS 自动缩放。

**圆角/阴影/间距**(base.css L87-116):

- 圆角:`--radius-sm 6px / md 10px / lg 14px / xl 20px / full 9999px`,默认 10px——偏圆润。
- 阴影:全 rgba 黑,`sm 0 1px 2px/0.25 → xl 0 24px 48px/0.5`,另有 `--shadow-glow: 0 0 24px var(--accent-glow)` 品牌光晕。
- 间距:4px 基数刻度,`--space-1: 4px … --space-8: 40px`。

**密度**:偏高密度 operator 风——侧边栏会话行紧凑、工具调用行可折叠("Ran 13 commands, read 6 files"),表格+概述 tiles 组合(来源:control-ui 文档 Sessions 段)。

### 2. 信息架构/导航

**骨架:只有 sidebar,无顶栏**(文档原话:"The sidebar is the only navigation chrome on desktop, with no top bar")。导航全部围绕"当前 agent"组织:

- **顶部 identity 行**:agent 头像/emoji + 名字 + 连接状态点 + 实时副标题。点击开 agent 菜单(内联 agent 切换器、New agent、Agent settings;>10 个 agent 时出现过滤框,pinned 排前,pin 集存浏览器)。
- **Pages 区**:Home(agent 主会话,带 unread/running 徽章)+ 固定目的地(默认 Automations、Plugins);Pages 头的 customize 菜单可 pin 其余所有目的地(Usage、插件 tab 等),右键导航区直接开 pin 编辑器。
- **会话列表分区**(zone):Pinned → 自定义组 → Threads → Groups → Coding(绑定 worktree/exec node 的会话,行内显示 `repo ⎇ branch` + 节点主机,默认折叠,折叠头保留真实计数和运行指示)。Threads 头有排序(Created/Last updated、Group by、Active/Archived/All 状态过滤,均持久化)和 "+" 新建。父会话可展开子 run(disclosure + 计数)。
- **attention chips**:sidebar 底部上方的紧凑警示条(失败/过期 cron、模型 auth 过期、待审批),点击跳到所属页面。
- **footer**:一整张 identity 卡,离线仍显示("Reconnecting…"),点开 app 菜单(Settings、Usage、Help、版本 chip、颜色模式开关)。非 main 分支源码运行时 footer 显示红色分支名。

**完整页面清单**(来源:`ui/src/app-routes.ts` import 列表,33 个 page 模块):
about, activity, agents, approvals, apps, channels, chat, config, connection, cron, custodian, dashboards, debug, labs, lobsterdex(图鉴彩蛋), logs, memory-import, model-providers, model-setup, new-session, nodes, plugin, plugins, profile, sessions, skill-workshop, skills, tasks, usage, workboard, worktrees。

**agent 作用域**:选 agent 后 Chat + Usage + Automations + Tasks + Workboard + Sessions 全部跟随;每个被 scope 的页面暴露 **Agent 控件**,有 **All agents** 逃逸口(拓宽页面 scope 但不改 chat 的具体 agent);Agents 设置页有自己的 URL 选择,不跟随共享 scope。

**Settings 组织**(文档 Config 段):独立设置侧边栏(宽 288px),顶部是 **Search settings** 搜索框,然后分组:

- 顶部:Ask OpenClaw(系统修复 agent 聊天页)、Profile、Appearance、Notifications
- Connections:Connection、Channels、Communications、Talk、Devices
- Agents & Tools:Agents、Labs、Models、MCP、Memory、Automation
- Privacy & Security:Security、Approvals
- System:Infrastructure、Advanced(无 curated 家的 config 段 + 原始 JSON5 编辑器)、Debug、Logs、About

Agents 设置页 = **Agent defaults 模板行 + 每 agent tabs**(Overview/Files/Tools/Skills/Channels/Automations/Memory)。Config 编辑是 **schema 驱动**(`config.schema` 提供 title/description/UI hints),原始 JSON 编辑器只在能安全 round-trip 时可用;写入带 base-hash 防并发覆盖,`config.apply` 应用并重启。

### 3. 交互模式

**WebSocket 实时**:浏览器直连 Gateway WS(同端口),auth 在握手参数里(`connect.params.auth.token/password`)。UI 全部是 WS RPC 的视图:`chat.history/send/abort`、`sessions.list/patch`、`config.get/set/apply/patch`、`cron.*`、`logs.tail` 等(来源:文档 + `ui/src/api/gateway.ts`)。远端状态变更通过 `config.changed` notice 实时推给所有连接客户端,live 应用。Gateway Host 卡片每 10s 轮询 `system.info`。连接状态直接呈现在 identity 行(连接点、Reconnecting…),离线 login gate 处理断线。

**chat/流式**:运行中的 session 头条(headline)先显示模型安全前言,activity 积累后由 utility model 换成紧凑状态摘要;**session rail**:compact pill 显示实时摘要,展开后显示评估、计划进度、PR、耗时、只读伴生线程;宽屏时展开 rail dock 成 **400px 右列**,窄屏/移动为 overlay。工具调用流式渲染成 kind-aware 行:shell 命令语法高亮 + 终端式输出、edit/write 显示有界 inline diff(行号 + `+added -removed` 统计),连续调用折叠成汇总("Ran 13 commands…"),展开看原始参数/输出。选中消息文字弹出 "More details" / "Ask in side chat"。

**命令面板/键盘**(来源:`ui/src/components/command-palette.ts`、`ui/src/app/app-shell-chrome.ts` L340-375):

- **⌘K / Ctrl-K**:命令面板(也是 sidebar 折叠时顶栏的搜索按钮)。
- **⌘B / Ctrl-B**:折叠/展开 sidebar(完全隐藏,全宽工作区)。
- **Cmd/Ctrl-Shift-,**:打开 Settings(特意不占用浏览器原生 Cmd-,)。
- **Esc**:关闭抽屉/退出 Settings takeover(overlay、输入框优先消费 Esc)。
- 桌面端内容区左上角固定控制簇:sidebar 开关 + 命令面板按钮(对应 macOS titlebar)。
- 会话列表:Cmd/Ctrl-click 多选、Shift-click 范围选,右键/kebab 出上下文菜单,支持批量操作;拖拽行到 Pinned/自定义组完成 pin/分组。

**浏览器本地 UI 状态**(来源:`ui/src` grep localStorage key):`openclaw.control.settings.v1`(dashboard 设置)、`openclaw.control.user.v1`(个人身份:显示名+头像)、`openclaw.control.token.v1`(当前 tab 的 token,密码不持久化)、`openclaw.i18n.locale`、`openclaw:sessions:custom-groups`(折叠态)、`openclaw-custom-theme`(tweakcn 导入主题)、`openclaw.native.lastRoute`。**双层模型**:theme/mode/text size/language/chat 显示偏好经 gateway config `ui.prefs` 跨设备同步(agent 可经审批 gate 修改,客户端经 `config.changed` 实时应用),每个浏览器保留本地镜像实现秒开;无写权限的 viewer 只改本地。分区分组名/顺序存 gateway(`sessions.groups.*`),折叠态留浏览器——**"内容归属服务端,展开折叠等纯视觉态留本地"**是其取舍线。

### 4. 布局/组件

**页面骨架**(来源:`ui/src/styles/layout.css`):

- `--shell-nav-expanded-width: 258px`(sidebar 展开宽),折叠后 `--shell-nav-width: 0px`(完全隐藏,不是 rail)。
- 设置页二级导航 `--shell-settings-nav-width: 288px`。
- 内容区 `max-width: 1120px` 居中。
- 窄视口:sidebar 变 slide-over 抽屉 + 紧凑 header(抽屉开关、品牌、搜索);手机上 Chat 把导航行吸收进标题栏。
- 桌面无顶栏;导航用标准浏览器 history(back/forward 可用)。

**卡片**:背景 `--card #161920`,边框 `--border #1e2028`(极暗,分层主要靠背景亮度阶梯:bg → card → elevated → hover 四级 `#0e1015→#161920→#191c24→#1f2330`),圆角 10-14px,阴影 md-lg。概述 tiles(stat cards)置于表格上方(如 Sessions 页:会话数/运行中/未读/总 token/归档数;Automations 页:数量/失败数/调度器状态/下次唤醒)。

**列表-详情钻取**:Sessions 页 = 概述 tiles + 表格(行有 kind glyph + live-run 点、状态 = 小圆点 + 文字、Tokens 列显示上下文窗口用量条),行 kebab/右键菜单,行点击开 drawer(显示 runtime、时长等);Automations 行点击开**整页详情**(头部 Active/Paused 开关 + Run now,Settings/Run history 两 tab);Plugins Installed 行开详情视图,overflow 菜单 enable/disable/remove;chat Background tasks rail 里行点击开 in-rail 紧凑详情(带返回键)。

**徽章/状态点**(来源:`ui/src/styles/components.css` L556-577):`.statusDot` 组件,变体 `.ok`(绿)/`.warn`(琥珀)/`.muted`(灰);未读 = 行内圆点,打开即标记已读;agent 可发布短暂状态行并请求注意(琥珀 icon);cloud worker 会话用 globe 徽章,本地会话默认无徽章;归档行内联置灰 + 归档 glyph;brand 徽章(来源验证)用于插件商店。

**空态/加载态**:专门的 empty-states 模块(`ui/src/pages/skill-workshop/empty-states.ts`);Sessions/Usage 视图有空态;加载中保留旧快照(channel probe 刷新时保留上一份数据并标注 partial);自动化表格下方放 "starter suggestions" 填充空态;离线时 footer 显示 Reconnecting + 重试动作;chat 历史按有界窗口 + 单条消息截断加载,避免大会话阻塞首屏。

## 对 BaiZe 的可借鉴点

1. **"运行中"专用色独立于成功/失败**(`--run #14b8a6` 青 vs `--ok #22c55e` 绿):BaiZe 的 5 阶段工作流 + ws 实时 run 流恰好需要"阶段进行中/等待审批/已完成/失败"四态,OpenClaw 的状态色体系(ok/warn/danger/info/run + muted/subtle 变体)可直接整套搬,BaiZe 已是 CSS vars dark 主题,改造成本只是换值。
2. **亮度阶梯分层代替可见边框**(bg `#0e1015` → card `#161920` → elevated `#191c24` → hover `#1f2330`,边框 `#1e2028` 极暗):BaiZe 总览/决策页卡片多,这套四级阶梯是低成本的高级感来源。
3. **只有 sidebar 的导航 + 作用域切换**:BaiZe 的"工作区"概念可对标 OpenClaw 的 agent identity 行——sidebar 顶部放当前工作区/需求,点击切换;下面 Pages 区放 5 个固定目的地(需求/场景/用例/资产/决策)。比现在的 tab 导航更能承载"作用域"语义。
4. **session 列表分区 + attention chips**:BaiZe 的"设计 run"列表可借用 Threads 分区模型(进行中/待审批/已归档三区 + Active/Archived/All 过滤持久化);**审批 gate 对标 attention chip**——有待审批方案时 sidebar 底部上方出现琥珀 chip,点击直达审批页,这比在 tab 上挂红点更醒目。
5. **run rail(400px 右列)**:BaiZe 的 ws 实时 run 流可借 session rail 模型——窄时一个 compact pill 显示当前阶段,展开 dock 成右列显示评估/产物/耗时;不打断主内容区。
6. **schema 驱动 config + 双模式编辑**(form 优先,raw JSON 只在安全 round-trip 时可用,base-hash 防并发覆盖):BaiZe 设置/配置页可照搬此纪律。
7. **本地/服务端状态分界线**:"分组名、顺序、主题偏好归服务端同步;折叠态、token、个人身份归浏览器 localStorage",BaiZe 若做多端可直接采用这条线;键命名风格 `openclaw.control.settings.v1`(带版本号)也值得借。
8. **键盘纪律**:⌘K 命令面板、⌘B 折叠 sidebar、Esc 退出 takeover、 deliberately 不占浏览器原生快捷键——BaiZe 键位可直接复用这组肌肉记忆。
9. **工具行折叠汇总**("Ran 13 commands, read 6 files" + 展开看 diff):若 BaiZe run 流里有 agent 工具调用,kind-aware 行 + 自动折叠是控制信息密度的好范式。

不可直接借/需注意:三套主题 + tweakcn 导入对 BaiZe 是过剩(YAGNI,一套深色即可);Inter + JetBrains Mono 需本地打包或系统栈fallback(OpenClaw 用系统栈 fallback,未确认是否内嵌字体文件);33 个页面的体量远超 BaiZe 需求,只借骨架不借清单。

## 来源清单

- <https://docs.openclaw.ai/web/control-ui> — 维度 2(sidebar 结构、Settings 分组、页面行为)、3(WS auth、session rail、快捷键、ui.prefs 同步)、4(rail 400px、徽章语义)
- <https://github.com/openclaw/openclaw> `ui/src/styles/base.css`(L3-233) — 维度 1 全部 hex/字体/圆角/阴影/状态色,含 WCAG 审计注释
- <https://github.com/openclaw/openclaw> `ui/src/styles/layout.css`(L8/L186/L209/L237) — 维度 4:sidebar 258px、设置导航 288px、内容 max-width 1120px
- <https://github.com/openclaw/openclaw> `ui/src/styles/components.css`(L556-577) — 维度 4:statusDot 组件
- <https://github.com/openclaw/openclaw> `ui/src/app/theme.ts` — 维度 1:主题名/模式解析(claw/knot/dash/custom × light/dark/system)
- <https://github.com/openclaw/openclaw> `ui/src/app-routes.ts` — 维度 2:33 个页面模块清单
- <https://github.com/openclaw/openclaw> `ui/src/app/app-shell-chrome.ts`(L340-395) — 维度 3:快捷键实现(⌘K/⌘B/Cmd-Shift-,/Esc)
- <https://github.com/openclaw/openclaw> `ui/src` localStorage 键 grep — 维度 3:本地状态键名
- 本地起点:`docs/research-ui-agent-skill-refs.md` §1(架构层,未重复)

**未能确认**:sidebar 各分区的具体像素级行高/padding(需跑起来量,源码分散在多文件未逐个追);文档站截图中的实际渲染效果未用浏览器核对(以源码 token 为准);字体文件是否随包分发(未见 fonts 目录证据,倾向系统栈 fallback);dashboards/custodian/lobsterdex 三个页面的具体用途(文档未展开,源码未精读)。
