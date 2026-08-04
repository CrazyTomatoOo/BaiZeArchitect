# Wayfinder Map — BaiZe web 重构方案(仿 OpenClaw / Hermes) `wayfinder:map`

## Destination

一份评审通过的《BaiZe web 重构方案》文档:从**视觉语言、信息架构/导航、交互模式、
布局/组件**四个维度,借鉴 OpenClaw Control UI 与 Hermes Agent Dashboard 的页面设计,
覆盖全部页面。本图只产决策与文档,不动代码(实施另起 effort)。

## Notes

- Domain:需求工程工作台 web UI 重构(需求/场景/用例/功能资产 + 5 阶段工作流 + 审批)。
- Tracker:local-markdown(无 git remote);票在 `tickets/`,blocking 用 body 约定;research 产出在 `research/`。
- Skills:ui-ux-pro-max、grilling、prototype、research、domain-modeling。
- Charting grilling 结论(2026-08-05):hermes = NousResearch/hermes-agent;终点 = 方案文档;借鉴维度 = 全 4 项;范围 = 全部页面。
- 技术栈不变:Vite+Lit(与 OpenClaw Control UI 同栈),重构只动页面设计。
- 现有基础:`web/`(5 组件 ~1156 行,tab 导航 需求/工作区/总览,CSS vars `--bg/--text/--border/--font-ui`);`gateway.ts`(node http+ws);旧 `baize-dashboard`(证据/ADR/gene 可视化)。
- 已有调研:`docs/research-ui-agent-skill-refs.md`(架构级;T01/T02 做页面设计级深挖)。
- 上一张图(需求工程工作台)已完成,归档于 `archive/2026-08-workbench/`。

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [T01 OpenClaw Control UI 页面设计调研](tickets/T01-openclaw-control-ui-design.md) — Claw 深色 tokens(`#0e1015`/`#161920`/`#ff5c5c`/运行专色 `#14b8a6`)+ 亮度阶梯分层 + sidebar 导航 + attention chips/run rail;不借三主题与 33 页体量。findings: `research/T01-openclaw-control-ui-design.md`
- [T02 Hermes Agent Dashboard 页面设计调研](tickets/T02-hermes-dashboard-design.md) — Hermes Teal(`#041c1c`/`#ffe6cb`)+ color-mix 透明度阶梯派生 + sidebar 底部常驻状态区 + profile/scope 防歧义三连 + schema 驱动表单 + `display:none` 保活 + pulse=live;不借 PTY/8 主题/换栈。findings: `research/T02-hermes-dashboard-design.md`

## Not yet specified

- 方案文档的章节结构与验收标准(T06 整合时明确)。
- 重构后的视觉验证方式(如 agent_browser 截图基线对比)。
- 旧 baize-dashboard(证据可视化)在新 IA 的归宿:合并/保留/下线。
- 设计 tokens 落地形式(沿用 CSS vars 还是抽 theme 模块)。

## Out of scope

- 实施写码 —— 本图只产方案文档。
- gateway / 后端 API 变更(若 IA 需要新端点,记入方案,不实施)。
- TUI(独立 surface)。

## Tickets(frontier = open+unblocked+unclaimed)

- [T01 OpenClaw Control UI 页面设计调研](tickets/T01-openclaw-control-ui-design.md) `research` — **closed**:深色 tokens + IA/交互范式(findings 落盘)
- [T02 Hermes Agent Dashboard 页面设计调研](tickets/T02-hermes-dashboard-design.md) `research` — **closed**:Teal tokens + color-mix 派生 + 常驻状态区/schema 表单(findings 落盘)
- [T03 新信息架构/导航结构](tickets/T03-ia-navigation.md) `grilling` — open(blocked-by: T01, T02)
- [T04 视觉语言/设计 tokens 原型页](tickets/T04-visual-tokens-prototype.md) `prototype` — open(blocked-by: T01, T02)
- [T05 交互模式](tickets/T05-interaction-patterns.md) `grilling` — open(blocked-by: T01, T02)
- [T06 逐页设计要点+方案文档整合](tickets/T06-plan-doc-synthesis.md) `grilling` — open(blocked-by: T03, T04, T05)
