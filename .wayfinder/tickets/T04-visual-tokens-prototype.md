# T04 — 视觉语言/设计 tokens 原型页 `wayfinder:prototype`

status: closed
assignee: pi(prototype with user)
blocked-by: T01, T02

## Question

BaiZe web 的新视觉语言是什么?做一个粗原型页让人有实物可 react:

- 基于 T01/T02 提取的 tokens,定 BaiZe 的配色/暗色/密度/字体/圆角/状态色。
- 选信息最密的一页(建议需求设计页)套用新视觉做粗 mock。
- 沿用 CSS vars(现有 `--bg/--text/--border/--font-ui`)扩展,不引 UI 框架。

产出:原型页文件(链接挂到票上)+ token 清单。

## Resolution(2026-08-05,prototype 3 变体 → C 胜出)

原型:`web/redesign-mock.html`(三变体 `?variant=A|B|C`,浮动底栏切换)。用户选定 **C — Graphite Indigo**。
- 立场:石墨基色 + **可见边框** + 6px 圆角 + compact 密度 + 靛蓝 `#7c8cff` 签名 accent。介于 A(冷暗无框)与 B(暖有机)之间,紧凑适合多卡片工作台。
- **token 清单(C)**:
  - 基面:`--bg #111317` / `--surface #1a1d23` / `--surface-2 #21242b` / `--surface-hover #2a2e36` / `--border #2c3038` / `--border-strong #3a3f49`
  - 文字:`--text #d8dbe0` / `--text-muted #878c96` / `--text-subtle #545862`
  - accent:`--accent #7c8cff` / `--accent-fg #111317`
  - 状态:`--ok #34d399` / `--run #38bdf8` / `--warn #fbbf24` / `--danger #fb7185` / `--info #818cf8` / `--muted #6b7280`
  - 几何:`--radius 6px` / `--radius-sm 4px` / `--pad 14px` / `--gap 12px` / sidebar 258px / rail 400px
  - 字体:系统栈 `--font-ui` + `--font-mono`(无字体文件, ponytail: 不打包 Inter/JetBrains)
- **落地形式**:沿用 CSS vars(扩展现有 `--bg/--text/--border/--font-ui`),不抽 theme 模块。
- 落选 A/B 保留在 mock 内作 T06 参考;mock 标 `PROTOTYPE`,不入产线组件(T06 时按 C 重写真实 Lit 组件)。
