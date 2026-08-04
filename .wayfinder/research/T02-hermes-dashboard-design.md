# T02 — Hermes Agent Dashboard 页面设计调研

## Question

Hermes Agent(NousResearch/hermes-agent)web dashboard 的**页面设计**是什么样的,哪些可借到 BaiZe?按四维度深挖:

- 视觉语言:配色、主题、密度、字体、组件视觉风格。
- 信息架构/导航:页面清单(sessions/skills/MCP/cron/env/system 等)、profile 切换器、machine 控制 vs 当前 profile 的分层。
- 交互模式:PTY/xterm.js TUI bridge、schema 驱动 config editor、REST 交互、实时性做法。
- 布局/组件:dashboard 骨架、卡片/面板、表格、表单、状态呈现。

调研基线:官方文档站 + 仓库 main 分支源码(shallow clone 至 /tmp/hermes-agent,2026-06 左右快照,截图版本 v0.15.1/v0.16.0)。**前端栈已确认为 React 19 + TypeScript + Vite + Tailwind CSS v4 + Nous 自研设计系统 `@nous-research/ui`(shadcn 风格 API)**——不是 Svelte/Lit。路由 react-router 8,图标 lucide-react,图表 @observablehq/plot,终端 xterm.js 6(证据:`web/package.json`)。

## Findings

### 1. 视觉语言

**主题模型(三层 palette + typography + layout,正交三层)**
每个主题 = `palette`(background / midground / foreground 三个色层,各带 hex + alpha)+ `typography`(fontSans / fontMono / fontDisplay / baseSize / lineHeight / letterSpacing / fontUrl)+ `layout`(radius + density)。density 三档:compact=0.85 / comfortable=1.0 / spacious=1.2,通过 `--spacing-mul` 乘到 Tailwind 的 `--spacing` 上整体缩放间距。另有 `colorOverrides`(钉死某个语义色)、`seriesColors`(图表双色)、`componentStyles`(按组件 bucket 注入 CSS vars,支持 clip-path/border-image)、`customCSS`、`layoutVariant`(standard/cockpit/tiled)(证据:`web/src/themes/types.ts`、`web/src/index.css`)。

**内置 8 主题(全部 dark,仅 1 个 light)**(`web/src/themes/presets.ts`):

| 主题 | background | midground(主文字/强调) | 字体 | radius |
| --- | --- | --- | --- | --- |
| Hermes Teal(默认) | `#041c1c` | `#ffe6cb`(奶油色) | 系统栈 | 0.5rem |
| Hermes Teal Large | 同上 | 同上 | 系统栈,18px | 0.5rem |
| Nous Blue(唯一 light) | `#E8F2FD` | `#0053FD` | 系统栈 | 0.5rem |
| Midnight | `#0a0a1f` | `#d4c8ff` | Inter + JetBrains Mono | 0.75rem |
| Ember | `#1a0a06` | `#ffd8b0` | Spectral 衬线 + IBM Plex Mono | 0.25rem |
| Mono | `#0e0e0e` | `#eaeaea` | IBM Plex Sans/Mono | 0 |
| Cyberpunk | `#040608` | `#9bffcf` | Share Tech Mono | 0 |
| Rosé | `#1a0f15` | `#ffd4e1` | Fraunces + DM Mono | 1rem |

- 默认主题的 `foreground` 是 `#ffffff` alpha 0(顶层高亮层,默认不可见);`warmGlow` 暖光 `rgba(255,189,56,0.35)`(legacy 字段)。
- 语义色(shadcn-compat tokens,`index.css`):destructive `#fb2c36`、success `#4ade80`、warning `#ffbd38`;Cyberpunk 覆盖为 `#ff0055`/`#00ff88`/`#ffd700`。
- **卡片/边框不靠新色值,靠 color-mix 调 transparency**:card = `midground 4% + background`,secondary 6%、muted 8%、accent 10%、border/input = `midground 15%`。这是"深底 + 奶油色细描边"观感的来源,已被官方截图证实(扁平、细边、无投影)。
- 数据系列色:input token `#ffe6cb`(奶油)/ output token `#34d399`(emerald-400),Analytics/Models 图表共用。
- 终端 pane:terminalBackground 默认 `#000000`,terminalForeground 默认 `#f0e6d2`,可随主题覆盖。

**字体与排版**

- base font-size 15px、line-height 1.55、letter-spacing 0(default);`small` 提到 1.0625rem、`code` 0.875rem(`index.css`)。
- 数字用 `tabular-nums`(Sessions/状态条)。
- Nous DS 自带展示字体 **Collapse、Rules Compressed/Expanded、Mondwest**(`index.css` 顶部注释),配合全大写 + 宽字距(导航 `tracking-[0.12em]`、品牌 `tracking-[0.0525rem]`)形成标志性的 condensed 大写标题风格——截图中 "HERMES AGENT"、"Config"、"GENERAL" 均是此风格。
- 终端字体:随包分发 JetBrains Mono woff2(Regular/Bold/Italic),xterm 直接引用,不依赖用户本机字体。
- 主题可声明 Google Fonts URL,切换时注入 `<link>`;字体还可独立于主题覆盖(`dashboard.font`)。

**密度与动效**

- 整体高密度(15px base、comfortable 默认);Large 主题给"嫌密"的用户(18px/1.65/spacious)。
- 动效克制:sidebar collapse 300ms `cubic-bezier(0.23,1,0.32,1)`、dialog-in(fade + translateY 4px + scale 0.98)、toast 滑入滑出、Live badge 的 `animate-pulse` 圆点、badge 上 2px repeating-conic grain 纹理(opacity 0.12)。

**主题切换**:header palette 图标即时切换,持久化到 `config.yaml` 的 `dashboard.theme`;用户可放 YAML 到 `~/.hermes/dashboard-themes/` 自定义主题;后端 `_BUILTIN_DASHBOARD_THEMES` 与前端 presets 保持同步(证据:`presets.ts` 注释、文档 "Themes & plugins" 节)。

### 2. 信息架构/导航

**整体定位:机器级管理面**。一个 dashboard server 管理机器上所有 profile;默认 `hermes dashboard` → `http://127.0.0.1:9119`,loopback 无 auth,非 loopback fail-closed 必须配 auth provider(证据:文档 Quick Start / Authentication 节)。

**页面清单(前端路由,`web/src/App.tsx` BUILTIN_NAV_REST + BUILTIN_ROUTES_CORE)**:

`/chat`(Terminal 图标,特殊持久化页)、`/sessions`、`/files`、`/analytics`、`/models`、`/logs`、`/cron`、`/skills`、`/plugins`、`/mcp`、`/channels`、`/webhooks`、`/pairing`、`/profiles`(+`/profiles/new` Profile Builder)、`/config`、`/env`(导航名 "Keys")、`/system`、`/docs`。插件可注入额外 tab(position: end / before:x / after:x),sidebar 单列 "PLUGINS" 分组。根路径 `/` 重定向到 `/sessions`。

- 注意(版本差异):文档把 **Status** 描述为 landing page(版本/gateway/活跃 session/最近 20 session,5s 自刷),但 main 分支代码 root redirect 到 `/sessions`,nav 无 Status 项,官方截图(v0.15.1/v0.16.0)nav 里也没有 Status——其职责似已拆进 sidebar System 区 + `/system` 页。**确切现状未能确认**(代码与文档不一致)。
- 各页面职责(文档 Pages 节,均有官方截图佐证):Sessions(浏览/搜索/重命名/导出/清理)、Chat(内嵌 TUI)、Config(150+ 字段表单)、API Keys(.env 分组管理)、Logs(三色日志 + live tail)、Analytics(token/成本图表)、Cron(定时任务)、Profiles、Skills(安装/开关/hub)、MCP(server + catalog)、Webhooks、Pairing、Channels(20+ 消息平台配置)、System(host stats/Portal/curator/gateway/memory/credential pool/ops/checkpoints/shell hooks)。

**导航骨架(桌面)**:
固定左 sidebar(`w-64`,可折叠为 `w-14` 纯图标,折叠态存 localStorage `hermes-sidebar-collapsed`),从上到下:

1. 品牌区(h-14):"HERMES AGENT" 两行大写 + 折叠按钮;
2. **ProfileSwitcher**(仅 ≥2 个 profile 时渲染);
3. nav 列表(core items + PLUGINS 分组);
4. **System 状态区**(常驻底部):Gateway Status(着色:running→success / starting→warning / failed→destructive / stopped→muted)、Active Sessions 计数、Restart Gateway、Update Hermes 按钮(`SidebarStatusStrip.tsx` + 截图证实);
5. Theme / Language switcher、AuthWidget(登录身份 + logout)、footer(版本号 + "Nous Research")。

移动端:sidebar 变抽屉(-translate-x-full + `bg-black/70` 遮罩),顶部 h-14 mobile header。

**machine vs profile 分层(核心设计)**:

- **ProfileSwitcher 是"写入目标选择器"**:sidebar 顶部一个 Select,默认项是 "this dashboard ({name})"(dashboard 自身 profile),其余为机器上其他 profile。选中后 Config、Keys、Skills、MCP、Models、Chat 全部读写该 profile(证据:`ProfileSwitcher.tsx` 注释 "The machine dashboard's single write-target selector")。
- **防歧义三连**:选中非自身 profile 时 ① switcher 图标和边框变 amber(`border-amber-500/50 text-amber-300`);② 全站顶部出现 amber banner:"Managing profile "X" — config, keys, skills, MCPs, model, and new chats apply to that profile."(`ProfileScopeBanner.tsx`,`bg-amber-500/10 text-amber-300`);③ 选择存 URL `?profile=<name>`,深链/刷新不丢。
- **机制上**:管理类 REST(`/api/config`、`/api/env`、`/api/skills`、`/api/mcp`、`/api/model/*`)接受 `?profile=` query 或 body `"profile"`;`/api/pty` WS 同样接受,用所选 profile 的 `HERMES_HOME` spawn。未知 profile 返回 404(文档 "Profile-scoped endpoints")。
- **明确不被 switcher 吸收的**:gateway 进程(用 `hermes -p <name> gateway` 管)、各 profile 的 session 数据库、cron 调度器(Cron 页跨 profile 聚合,自带 filter)。另外 "Set as active"(未来 CLI/gateway 默认 profile)与 switcher(dashboard 管理目标)是两个概念,Profiles 页文案明确区分(文档 Managing multiple profiles / Profiles 节)。
- `worker dashboard` 命令路由到机器 dashboard 并预选 `?profile=worker`;`--isolated` 才起独立 per-profile server。

### 3. 交互模式

**PTY + xterm.js 浏览器 TUI bridge(/chat)**

- 链路:`/api/pty` WebSocket(session token 认证,接受 `?profile=`)→ 服务端用 PTY spawn `hermes --tui` 真二进制 → 键入进 PTY,ANSI 输出流回浏览器(文档 Chat 节)。
- 渲染:xterm.js 6 + **WebGL addon** 逐 cell 整数像素绘制(mouse tracking SGR 1006、Unicode 11 宽字符、box-drawing 原生支持);7–9px 小字号时 WebGL 字显大,回退 canvas/DOM renderer(`ChatPage.tsx` 行 780 附近注释)。FitAddon 跟随窗口 resize;scrollback 5000;cursorBlink;字号按宽度 tier 自适应;字体用随包 JetBrains Mono。
- **持久 host 模式**:ChatPage 在 `<Routes>` 之外常驻渲染,离开 /chat 用 `display:none` 隐藏而不 unmount——PTY 子进程、WS、xterm 实例跨 tab 存活;URL 仍由路由掌管,深链/前进后退/高亮正常(`App.tsx` 行 145 注释)。关闭浏览器 tab,服务端 reap PTY。
- Resume:Sessions 行 ▶ → `/chat?resume=<id>` → `--resume` 加载全历史。`pty-reconnect.ts` 处理 WS 重连。
- **右 rail session switcher**(ChatGPT 式):终端占主屏,右 rail 上为 model picker、下为会话列表(标题/相对时间/消息数/来源 channel),点行就地 resume(终端原地 respawn),active 高亮,New chat + 刷新;窄屏折叠成 slide-over。rail 只读切换,删/改名/导出仍在 Sessions 页(文档 Chat 节)。
- 平台降级:native Windows 无 POSIX PTY,/chat 显示 "用 WSL2" banner,其余页面不受影响。

**Schema 驱动 config editor(/config)**

- `GET /api/config/schema` 返回每个字段的 type/description/category/options(150+ 字段从 `DEFAULT_CONFIG` 自动发现);`category_order` 由后端给。
- 控件映射(`AutoField.tsx`,逐一确认):`boolean`→Switch 开关行;`select`→Select 下拉(options 来自 schema);`number`→Input[type=number];`text`→textarea(min-h 80px);`list`→逗号分隔 Input;嵌套 record/array→递归 NestedValueEditor(缩进边框分组)。字段 hint = mono 字号的 key path + description 两行小字。
- 页面布局:左侧 FILTERS 面板(sections 列表,每节图标 + 字段计数,如 "general 15 / Agent 35 / Display 50"),右侧当前 category 的字段组(截图证实);顶部搜索跨 category;`**YAML**` 按钮切 raw 编辑;Save(立即写 config.yaml)/ Reset to defaults / Export JSON / Import JSON。生效时机:下次 agent session 或 gateway 重启(文档 Config 节 + 截图)。

**REST 交互模式**

- 全部 `/api/*` REST,前端 fetchJSON wrapper 统一注入 `?profile=`;401 envelope → 整页跳 /login 重跑 OAuth(文档 OAuth flow)。
- 资源族:`/api/status`、`/api/sessions`(含 search FTS5/stats/export/prune/PATCH rename)、`/api/config(+defaults+schema)`、`/api/env`、`/api/logs`、`/api/analytics/usage`、`/api/cron/jobs(+pause/resume/trigger)`、`/api/skills(+hub)`、`/api/mcp/servers(+test+catalog)`、`/api/messaging/platforms`、`/api/pairing`、`/api/webhooks`、`/api/credentials/pool`、`/api/memory`、`/api/gateway/start|stop|restart`、`/api/ops/*`、`/api/system/stats` 等(文档 REST API 节,完整列表已核对)。
- **后台长任务统一模式**:POST 触发(doctor/backup/update/skills install 等)→ 后台执行 → 前端轮询 `/api/actions/{name}/status`,live log 流入页面(System 页 "Each spawns a background action whose live log streams into the page")。
- WS 仅两条:`/api/pty`(browser chat)、`/api/ws`(Desktop chat,登录后用一次性 ticket 认证)。

**实时性**

- 以**轮询**为主:Status 页 5s 自刷;Logs live tail 每 5s 拉新行(可开关);live session 判定 = 最近 5 分钟活跃(行上绿色 pulse badge);update check 6h 缓存 + `?force=1` 绕过。
- 配置热路径:webhook subscriptions 文件 gateway 热加载(改完下个事件即生效,无需重启);CLI 内 `/reload` 重读 .env 配合 dashboard 改 key。
- 真正的 push 只有 PTY/chat 的 WS。

**Auth(与交互绑死)**

- loopback bind 无 auth;非 loopback 强制 auth gate,fail-closed(无 provider 拒绝 bind);`--insecure` 已是 no-op。
- 三种内置 provider:basic(scrypt 密码,限可信网络;登录限流 10 次/分/IP,统一 401 防枚举)、Nous Portal OAuth(PKCE S256,公网推荐)、self-hosted OIDC(Keycloak/Auth0/Okta 等,discovery 文档自动取端点);插件可注册自定义 provider。session = HMAC cookie(15min TTL,无 refresh v1);WS 用一次性 ticket(文档 Authentication 节)。

### 4. 布局/组件

**整体骨架**

- 桌面:左 sidebar(w-64/w-14)+ 右内容列(`px-3 sm:px-6`,`pt-2/4/6`),页面 header 由 PageHeaderProvider 提供(大标题 + 页面级 actions,如 Sessions 的 "Prune old sessions")。`html/body/#root` 100dvh + overflow hidden,滚动只发生在内容区内部。
- layoutVariant:`standard`(默认单列,max-width 内容)/ `cockpit`(左侧预留 HUD rail 给插件)/ `tiled`(放开内容 max-width 用满视口)。
- 路由级 lazy import + RouteFallback(Spinner + "Loading…");xterm chunk 首访 /chat 才下载。

**卡片/面板**

- 扁平、细边(`midground 15%`)、底色 4% tint、无投影;radius 默认 0.5rem(视觉偏方正,截图证实)。Config 的 FILTERS 面板和字段面板、Sessions 的行卡片、stats bar 都是同一边框盒子语言。

**列表/表格**

- Sessions 用**行卡片**而非 table:平台图标(CLI `>_`、Discord `#`、Telegram 纸飞机、cron 时钟)+ 标题 + meta 行(model、消息数、相对时间)+ 右侧 badge 组(Live pulse badge + source badge)+ 图标动作(改名/导出/删除)(截图证实)。
- stats bar:大数字 + 小 label(Total / Active in store / Archived / Messages)+ per-source chips(`cron:1` `discord:1` `telegram:1` `cli:1`)。
- Analytics:summary cards(token 输入/输出、cache hit%、成本、session 数 + 日均)+ @observablehq/plot 堆叠柱状图(hover tooltip)+ 日表 + per-model 表。真 table 用于数据密集的 breakdown。
- Cron 行:名称/prompt 预览/cron 表达式/状态 badge/投递目标/上次/下次运行 + 暂停/编辑/立即触发/删除。

**表单**

- Label + 两行 hint(mono key path + description);Input/Select/Switch/textarea 来自 Nous DS;秘密字段渲染 password input,列表视图 redacted;留空 = 保留原值(Channels 页)。
- 模态:ConfirmDialog(危险操作二次确认,如 Update now 显示将拉取的 commit 数)、预填 Edit modal(Cron)、ScheduleBuilder(cron 表达式可视化构建)、ModelPickerDialog、SkillEditorDialog、ToolsetConfigDrawer、HermesConsoleModal;toast 右上角滑入。
- Shell hook 创建表单带安全警告 + 显式 consent checkbox(危险操作的"consent gate"模式)。

**状态呈现**

- 语义四档色:success / warning / destructive / muted,全站一致(gateway 状态、cron state enabled→success/paused→warning/error→destructive、Live badge、update badge "up to date / N commits behind")。
- Live = 绿色 badge + `animate-pulse` 圆点(h-1.5 w-1.5 rounded-full)。
- 日志按 severity 着色(红/黄/dim);空态、加载态统一 Spinner + muted 文案。

**组件分层**

- 底层全靠 `@nous-research/ui`(Button/Select/Switch/Input/Label/Badge/Spinner/Typography/ConfirmDialog/SelectionSwitcher),本地仅 ~25 个业务组件;shadcn 风格 token 兼容层让 `bg-card`/`text-muted-foreground` 等类继续解析。
- 插件系统:shell slots(header-banner/header-left/header-right/pre-main)+ 页面级 slots + 插件 tab + 插件 FastAPI 路由(文档 Extending the Dashboard)。

## 对 BaiZe 的可借鉴点

BaiZe 现状:Vite+Lit、5 组件 ~1156 行、dark 主题 + CSS vars;领域为需求→场景→用例→功能资产、5 阶段工作流、审批 gate、ws 实时 run 流。

1. **三层 palette + color-mix 派生的 token 结构**。Hermes 只用 bg/midground/foreground 三个基色,卡片/边框/次级面全部 `color-mix(in srgb, midground X%, background)` 派生。BaiZe 已有 CSS vars,把现有 hardcoded 面板色改成"基色 + 透明度阶梯"(4/6/8/10/15%),一套基色换肤全站跟随,几乎零成本。BaiZe 单主题即可,**不需要**借 8 主题系统,但 typography(baseSize/lineHeight)+ layout(radius/density multiplier)这两个 token 层值得借——以后做"紧凑/宽松"切换只是一个 var。
2. **sidebar 底部常驻系统状态区**。Gateway Status(着色)+ Active Sessions + Restart/Update 按钮固定在 sidebar 底部,不占任何页面。BaiZe 可把 ws 连接状态、运行中 run 数、当前阶段同样常驻,契合"工作台"定位。
3. **Profile switcher + amber scope banner 的防歧义三连**。BaiZe 有 workspace 概念:切换非默认 workspace 时,① switcher 变色 ② 全站 banner 点名写入目标 ③ `?workspace=` 进 URL 可深链。写操作目标永远不歧义——这对有审批 gate 的系统尤其重要。
4. **Schema 驱动表单(AutoField 模式)**。后端出 schema(type/category/options),前端按类型映射控件(boolean→toggle、enum→select、text→textarea、list→逗号输入、嵌套→递归分组),左侧 category 列表带字段计数。BaiZe 的角色配置/工作流配置/gate 规则配置可直接套这个模式,加新配置项零前端改动;raw YAML/JSON 切换也值得借。
5. **Sessions 页列表范式**。stats bar(大数字 + 分类 chips)+ filter tabs(Chats/Automation/All)+ FTS5 搜索 + 行卡片(图标/标题/meta/badge/图标动作)+ live pulse badge。BaiZe 的需求列表/run 列表几乎是同构的:stats bar 放需求/场景/用例/功能资产计数,tabs 按 5 阶段过滤,运行中 run 用 pulse badge。
6. **长连接页面 persistent host(display:none 不 unmount)**。Hermes 让 PTY/WS/xterm 跨 tab 存活。BaiZe 不需要 PTY 本身(不是终端工具),但 **ws run 流页面切走再切回不丢流、不重放**是同一问题——display:none 方案比状态重建简单得多,直接可借。
7. **状态语义四档 + pulse = live**。success/warning/destructive/muted 全站一致,live 一律"绿 badge + 脉冲点"。BaiZe 的 run/审批状态映射:running=pulse success、待审批=warning、failed=destructive、完成/归档=muted,用户零学习成本。
8. **后台任务触发→轮询状态→live log 流入页面**。BaiZe 已有 ws 实时流(比 Hermes 的轮询更好),但对非流式长任务(导出、批量归档、迁移)这个"POST + poll /api/actions/{id}/status"模式是简单可靠的后备。
9. **危险操作的 consent gate 模式**。shell hook 创建带警告文案 + 显式 consent checkbox;Update now 先弹确认框列出将拉取的 commit 数。BaiZe 审批 gate 的批准/拒绝可借:批准前弹出"将采纳的决策摘要",比裸按钮安全。
10. **auth 分层策略**(若 BaiZe 远程部署):loopback 免 auth 保持本地体验,非 loopback fail-closed。与 OpenClaw 调研结论一致。

**明确不建议借的**:PTY/xterm 终端嵌入(BaiZe 无 TUI)、8 主题系统与主题 YAML 插件机制(YAGNI)、React/Tailwind 栈本身(BaiZe 已是 Lit,重构不换栈)、插件 slots 体系(现阶段无插件需求)。

## 来源清单

| 来源 | 用于维度 |
| --- | --- |
| <https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard> | 全维度基线:页面清单、profile 分层、PTY 链路、REST API 全集、auth、主题表 |
| 官方截图 admin-config-*.png(同站 /docs/assets/images/) | 视觉语言、Config 布局(左 filters 右字段)、sidebar 骨架 |
| 官方截图 admin-sessions-*.png | Sessions 行卡片、stats bar、Live badge、sidebar System 区 |
| `web/package.json`(github.com/NousResearch/hermes-agent) | 前端栈确认(React 19/Tailwind v4/@nous-research/ui/xterm/observable-plot) |
| `web/src/themes/presets.ts` / `types.ts` | 8 主题 hex/字体/radius/density 精确值、主题模型三层结构 |
| `web/src/index.css` | shadcn-compat token、color-mix 派生、语义色 hex、15px base、Nous DS 字体名 |
| `web/src/App.tsx` | 路由/页面清单、sidebar 骨架、Chat persistent host、插件 nav |
| `web/src/components/ProfileSwitcher.tsx` / `ProfileScopeBanner.tsx` | profile 切换器机制、amber banner 文案 |
| `web/src/components/AutoField.tsx` | schema→控件映射(逐类型确认) |
| `web/src/pages/ConfigPage.tsx` | category 分组、字段计数、YAML 切换 |
| `web/src/pages/ChatPage.tsx` | xterm 配置(WebGL/Fit/scrollback 5000/字号 tier/JetBrains Mono) |
| `web/src/components/SidebarStatusStrip.tsx` | gateway 状态着色四档 |
| `web/src/pages/SessionsPage.tsx` / `CronPage.tsx` | Badge tone 用法、live pulse、cron 状态色映射 |

**未能确认的点**:

- Status landing page 现状:文档描述与 main 分支代码(`/` → `/sessions`)矛盾,疑似已拆入 sidebar System 区 + /system 页,未逐版本核实。
- Nous DS 三个展示字体(Collapse / Rules Compressed / Mondwest)各自用于哪些具体元素(品牌/标题/正文),仅从 CSS 注释确认存在,未逐组件核对。
- 截图版本(v0.15.1/v0.16.0)与 main 分支有 nav 差异(Channels/Chat 项有无),最新 nav 以代码为准。
