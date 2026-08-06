# BaiZe web 重构方案

> Wayfinder 图 `BaiZe web 重构方案(仿 OpenClaw/Hermes)` 的终点产物。
> 决策来源:T01/T02 调研 + T03 IA + T04 视觉 + T05 交互 + T06 逐页分叉。
> 本文档只产方案,不动代码;实施另起 effort。

## 1. 概述

把 BaiZe web(现 Vite+Lit 5 组件 ~1156 行,tab 导航,dark)从「带 tab 的单页」重构为「sidebar 工作台」,视觉/IA/交互/组件四个维度借鉴 OpenClaw Control UI 与 Hermes Agent Dashboard。技术栈不变(Vite+Lit,与 OpenClaw 同栈)。

**不做**:换栈、TUI、gateway 后端重构(仅 T05 的 ws 基建在迁移计划里列为前置)。

## 2. 设计依据(精简)

| 维度 | 借(OpenClaw/Hermes) | 不借 |
| --- | --- | --- |
| 视觉 | 亮度分层(color-mix 派生思路)、状态色语义四档+pulse、系统字体栈 | 三套主题、Inter/JetBrains 打包、33 页体量 |
| IA | sidebar 导航、作用域置顶、底部常驻状态区 | OpenClaw 33 页清单、Hermes machine/profile 双层(BaiZe 单层 workspace 即可) |
| 交互 | ws 流式 run rail、⌘K 面板、consent gate、本地/服务端状态分界 | PTY/xterm、插件 slots |
| 组件 | 列表-详情、徽章/脉冲点、schema 驱动表单 | — |

## 3. 设计 tokens(T04 变体 C — Graphite Indigo)

沿用 CSS vars(扩展现有 `--bg/--text/--border/--font-ui`),不抽 theme 模块。

```css
:root {
  /* 基面(石墨 + 可见边框) */
  --bg:#111317; --surface:#1a1d23; --surface-2:#21242b; --surface-hover:#2a2e36;
  --border:#2c3038; --border-strong:#3a3f49;
  /* 文字 */
  --text:#d8dbe0; --text-muted:#878c96; --text-subtle:#545862;
  /* accent(BaiZe 签名)+ 状态 */
  --accent:#7c8cff; --accent-fg:#111317;
  --ok:#34d399; --run:#38bdf8; --warn:#fbbf24; --danger:#fb7185; --info:#818cf8; --muted:#6b7280;
  /* 几何 */
  --radius:6px; --radius-sm:4px; --pad:14px; --gap:12px;
  /* 字体(系统栈,无字体文件) */
  --font-ui:-apple-system,"SF Pro Text",system-ui,sans-serif;
  --font-mono:"SF Mono",ui-monospace,"JetBrains Mono",monospace;
  /* 布局 */
  --sidebar-w:258px; --rail-w:400px; --content-max:1120px;
}
```

状态语义(全站一致):`--run` 脉冲=运行中 · `--warn`=待审/attention · `--ok`=完成 · `--danger`=失败/打回 · `--muted`=归档。

## 4. 信息架构(T03)

**入口页(未选工作区)**:进入即显示工作区列表(选择/创建/管理),无 sidebar;点选工作区进入工作台。管理工作区(增删)始终回此入口页。

**工作台(已选工作区)**:顶部栏左 logo、**右上角** workspace 切换器(下拉)+「管理工作区」按钮(回入口);左侧 sidebar 四区(实施演进,2026-08-06 对齐实现):
- 总览(独立置顶)
- 工作:需求 · 待决策(有待审批显琥珀 chip `n`)
- 资产库:需求管理 · 场景库 · 用例库 · 功能库(各独立 nav,非单页 tab)
- 管理:系统 · 证据(证据独立 nav,见 §6.6 子页)
(工作区管理不放 sidebar,统一在入口页)

**作用域**:workspace 单作用域,工作台各页随之过滤;切换经右上角切换器,`?workspace=` URL 深链。

**落地页**:localStorage 记住上次(键 `baize.ui.v1.lastPage`/`workspace`);未选 → 入口页,已选 → 需求页。

## 5. 交互模式(T05)

| 模式 | 决策 |
| --- | --- |
| 实时性 | ws 真流式 + 400px run rail 右列(窄屏收 compact pill;切页不丢,`display:none` 保活)。gateway 需补 ws 广播阶段事件(现状纯 HTTP)。 |
| 需求录入 | chat 化:全屏对话,agent 反问澄清 → 右侧实时生成结构化预览 → 确认落库(替代纯 textarea)。 |
| 键盘 | ⌘K 命令面板(切页/切 workspace/新建需求/触发阶段 run)+ ⌘B 折叠 sidebar + Esc 退出浮层;不占浏览器原生键。 |
| 审批 | consent gate:「通过」弹本阶段产物摘要+确认;「打回」保留意见框;琥珀 chip 任意页直达待决策。 |
| 状态分界 | UI 偏好(上次页/折叠态/rail 态)→ localStorage `baize.ui.v1.*`;领域数据 → 服务端。 |

## 6. 逐页设计要点

### 6.1 需求页(列表 + 详情)

- **列表**:stats bar(需求/场景/用例/功能计数)+ 5 阶段 filter tabs + FTS 搜索 + 行卡片(标题/meta/阶段进度条/badge);运行中 run 行 pulse badge;「新建需求」触发 chat 录入。
- **详情**:6 阶段 pipeline 条(状态点)→ 当前阶段卡片(产物列表 + consent 审批)→ run rail 右列(ws 事件流/产物/耗时)。
- **数据**:gateway `GET /api/requirements?ws=`、`POST /api/requirements/:id/stage/:stage/run`、`POST .../approve`。

### 6.2 资产库页(四 tab 分库 — T06 F1,实施演进含需求管理)

- 四 tab(各独立 nav 项,列表+详情):**需求管理** · 场景库 · 用例库 · 功能库。workspace 复用池,跨需求可见。
- 需求管理 tab:需求作资产化浅视图(list-detail 标题+描述);与「工作→需求」流水线页分工——后者是设计工作面(6 阶段+run rail),本 tab 是跨需求浏览/复用入口。
- 场景详情:前置/主流程/异常;用例详情:前置/步骤/后置;功能详情:功能域归属/输入输出。
- **数据**:store `listRequirements/getScenarios/getUsecases/getFunctions(workspaceId)`。

### 6.3 总览页

- 计数卡片(需求/场景/用例/功能/待决策数)+ 各 workspace 进展条 + 近期 run 活动流(借 Hermes sessions 范式:stats bar + filter + 行卡片 + pulse)。
- **数据**:store counts + 近期 runs。

### 6.4 待决策页

- pending 列表(critic findings + approval gate + 人工添加)→ 选中项展开详情 → approve/reject 走 consent gate。琥珀 chip 从任意页直达。
- **数据**:`/api/packages` pending 或 store findings。

### 6.5 工作区页

- 列表/切换/新建;切换非默认 workspace 触发防歧义三连。
- **数据**:`GET /api/repos`。

### 6.6 系统页(T06 F3 — 证据独立子页)

- 系统页主区:设置(schema 驱动表单,借 Hermes AutoField)+ 摘要入口卡片(ADR 历史 / gene 复用 / 证据可视化)。
- **子页**:证据可视化(收编旧 baize-dashboard:热点/boundaries/clusters + ADR 历史 + gene 复用)—— 独立子页,不在系统页主区内挤。
- **数据**:`/api/evidence/<repo>`、`/api/genes`、`manage_adr(get)`。

## 7. 组件模式清单

| 组件 | 说明 |
| --- | --- |
| `baize-shell` | sidebar(workspace switcher + 四区 nav + status footer)+ 命令面板挂载点 + run rail 挂载点 + 路由 + 落地页记忆 |
| `baize-run-rail` | 400px dock / 窄屏 pill;SSE 事件流;切页保活(display:none);column 变体(详情页全列) |
| `baize-command-palette` | ⌘K;切页/切 workspace/新建需求/触发阶段 run |
| `baize-consent-modal` | 审批摘要确认;打回意见框 |
| `baize-chat-intake` | 全屏 chat + 右侧结构化预览;确认落库 |
| `baize-pipeline` | 6 阶段条 + 状态点(pulse=run) |
| list-detail | 列表左 + 详情右(需求/资产库/待决策共用) |
| card | 产物卡片(surface + border + radius) |
| badge/pulse | 状态四档 + pulse=live |
| empty / loading | 空态文案 + 骨架屏 |

## 8. 迁移计划(现有 5 组件 → 新结构)

按依赖 + 价值排序:

1. **tokens 落地**:`baize-shell` `:root` 加 T04 C 变量集(替换现有 `--bg/--text/--border/--font-ui` 值,新增 `--surface/--accent/--run` 等)。一处改,全站跟随。
2. **`baize-shell` 重写**:tab → sidebar(T03 结构)+ status footer + palette/rail 挂载点 + localStorage 落地页记忆。
3. **`baize-requirement` 拆**:列表视图 + 详情视图;详情接 run rail + consent;新建需求 → `baize-chat-intake`。
4. **新增 `baize-asset-library`**(四 tab:需求管理/场景/用例/功能)。
5. **`baize-overview` 重做**(计数卡片 + 活动流)。
6. **`baize-workspaces` 适配**:workspace 单作用域 + 防歧义三连。
7. **`baize-dashboard` 拆 → `baize-system` + 证据子页**;新增 `baize-decisions`(待决策页,从 requirement 内审批抽出独立页)。
8. **新增全局件**:`baize-run-rail`、`baize-command-palette`、`baize-consent-modal`、`baize-chat-intake`。
9. **gateway 补 ws**:广播阶段 run 事件(T05 决策的基建,实施 effort 前置)。

## 9. 验收标准

- [x] 6 页 + sidebar shell 按 T04 变体 C 渲染,截图对照 mock(2026-08-06 视觉验收通过,8 截图见 §11.3)。
- [x] 状态色语义一致:绿=连/成、青=运行、琥珀=待审(截图核对一致)。
- [x] run 流切页不丢:SSE + `?hidden`(display:none)保活已接线;token 级 live 流需真实 run 端到端。
- [x] ⌘K / ⌘B / Esc 键盘可用(live 实测:命令面板开/关、sidebar 折叠/展开)。
- [x] 审批 consent gate:live 验(种子「场景」为待审 → 通过弹摘要 modal + 确认通过/取消,见 acc-02)。
- [x] workspace 切换防歧义三连(switcher 变色 + amber banner + URL):banner 原为死 CSS 未渲染,2026-08-06 补实现;live 验(2 工作区,acc-09-scope-banner)。
- [x] 落地页 localStorage 记忆(live 实测 reload 停原页)+ 首访分流。
- [x] 现有功能不退化:6 阶段流水线/资产库/证据/ADR/gene 各页渲染正常(docker 验收)。

## 10. 附

- 原型:`web/redesign-mock.html`(`?variant=A|B|C`,C 为胜出方案)。
- 调研:`.wayfinder/research/T01-openclaw-control-ui-design.md`、`T02-hermes-dashboard-design.md`。
- 决策票:`.wayfinder/tickets/T01`~`T06`。

## 11. 实施偏离记录(2026-08-06 验收)

> 实施已完成(13 组件 / 4248 行,9 步迁移基本落地)。以下偏离方案原文,记此备查。

### 11.1 SSE 替代 ws(§5 实时性 / §8 步骤 9)

- 原文:T05/§5 决定「gateway 新建 **ws** 通道」广播阶段事件。
- 实施:改用 **SSE(EventSource)** —— `agent-runtime/gateway.ts` `broadcastRun()` + `sseClients`,`/api/runs/stream` 单向推送。
- 理由:本场景只需服务端→客户端单向推送(阶段 run 进度 / token 流),SSE 无新依赖、够用;ws 的双向能力未用到。
- 验收影响:§9 第 3 条「ws run 流切页不丢」由 SSE + `display:none` 保活满足,行为等价。不回退。

### 11.2 sidebar IA 与 §4 的漂移(已决策:保留,文档对齐)

验收截图(2026-08-06)显示 live sidebar 与原 §4 规划(对齐前)不一致:

| 原 §4 规划(对齐前) | 实际实施 |
| --- | --- |
| 工作:需求 · 资产库 · 总览 | 总览(独立置顶)+ 工作:需求 · 待决策 |
| 治理:待决策 | (无「治理」组,待决策并入「工作」) |
| 资产库 = 单页 3 tab(场景/用例/功能,§6.2) | 资产库组 = 4 个独立 nav:**需求管理** · 场景库 · 用例库 · 功能库 |
| 管理:系统 | 管理:系统 · 证据(证据独立 nav,符合 §6.6 子页决策) |

- **决策(2026-08-06,用户拍板)**:保留实施现状,文档对齐实现 —— §4 已回写为四区、§6.2 已回写为四 tab(含需求管理)。「需求管理」作为需求资产化浅视图留在资产库,与「工作→需求」流水线页分工(浏览复用 vs 设计工作面)。
- 接受的概念取舍:需求兼具「工作面」与「可浏览资产」双重身份;双入口(工作→需求 / 资产库→需求管理)按上述分工共存,不视为冗余。

### 11.3 验收快照(9 张,`docs/acceptance-2026-08-06/`)

workspaces / requirement-detail / overview / asset-scenarios / decisions / system / evidence / mock-variantC / scope-banner。视觉基线对照(§9 第 1 条)已通过(2026-08-06)。
