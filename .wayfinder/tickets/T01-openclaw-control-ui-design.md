# T01 — OpenClaw Control UI 页面设计调研 `wayfinder:research`

status: open
assignee: pi(research)
blocked-by:
research: research/T01-openclaw-control-ui-design.md

## Question

OpenClaw Control UI 的**页面设计**是什么样的,哪些可借到 BaiZe?按四维度深挖:

- 视觉语言:配色(尽量到 hex)、暗色/亮色主题、密度、字体、圆角/阴影、状态色。
- 信息架构/导航:sidebar 分区与页面清单、agent 作用域切换、设置/配置的组织方式。
- 交互模式:WS 实时更新、chat/流式、命令面板/键盘操作、浏览器本地 UI 状态(theme 存哪)。
- 布局/组件:页面骨架、卡片、列表-详情、徽章/状态点、空态/加载态。

来源:`docs.openclaw.ai/web/control-ui`(含站内截图)、`openclaw/openclaw` 仓库 UI 源码
(Vite+Lit,从源码抽真实 tokens)。起点见 `docs/research-ui-agent-skill-refs.md` §1。

产出:`research/T01-openclaw-control-ui-design.md`(四维度 findings + 对 BaiZe 的可借鉴点 + 证据链接)。
