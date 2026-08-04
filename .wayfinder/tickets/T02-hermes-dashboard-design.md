# T02 — Hermes Agent Dashboard 页面设计调研 `wayfinder:research`

status: closed
assignee: pi(research)
blocked-by:
research: research/T02-hermes-dashboard-design.md

## Question

Hermes Agent(NousResearch/hermes-agent)web dashboard 的**页面设计**是什么样的,哪些可借到 BaiZe?按四维度深挖:

- 视觉语言:配色、主题、密度、字体、组件视觉风格。
- 信息架构/导航:页面清单(sessions/skills/MCP/cron/env/system 等)、profile 切换器、machine 控制 vs 当前 profile 的分层。
- 交互模式:PTY/xterm.js TUI bridge、schema 驱动 config editor、REST 交互、实时性做法。
- 布局/组件:dashboard 骨架、卡片/面板、表格、表单、状态呈现。

来源:`hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard`、
`NousResearch/hermes-agent` 仓库 dashboard 源码(先确认其前端栈)。起点见 `docs/research-ui-agent-skill-refs.md` §2。

产出:`research/T02-hermes-dashboard-design.md`(四维度 findings + 对 BaiZe 的可借鉴点 + 证据链接)。

## Resolution(2026-08-05,research 子代理)

findings 落盘:`research/T02-hermes-dashboard-design.md`(195 行,四维度 + 可借鉴点 + 来源清单)。
gist:React 19 + Tailwind v4 + 自研 DS(非 Lit);Hermes Teal(`#041c1c` 底 + `#ffe6cb` 奶油字);三层基色 + `color-mix` 透明度阶梯派生全部面板;sidebar w-64 + 底部常驻系统状态区;profile switcher + amber scope banner 防歧义三连;schema 驱动 AutoField 表单;`display:none` 保活长连接页;状态四档 + pulse=live。不借:PTY 嵌入、8 主题系统、React/Tailwind 栈、插件 slots。
