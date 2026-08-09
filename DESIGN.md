# Design — BaiZe Architect

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow. Implementation lives in `web/index.html` (`:root` token
block) + `web/src/*.ts` (Lit shadow-DOM components consuming the tokens by name).

## Genre

atmospheric — 暗色 AI 工作台（Graphite Indigo，T04 变体 C 的产品决策）。

## Macrostructure family

- App pages: Workbench（sidebar rail + content grid + 右侧 run rail）。
  页面间只变 archetype knobs（列表/详情分栏、卡片网格、tab），不变主题。
- Marketing pages: 无（本产品无营销页）。
- Content pages: 无独立内容页；markdown 渲染（baize-markdown）遵循正文排版规则。

## Theme

- `--bg`            oklch(18.6% 0.009 264.3)   石墨纸面
- `--surface`       oklch(23.0% 0.012 264.3)   一级抬升
- `--surface-2`     oklch(26.0% 0.014 267.0)   二级抬升
- `--surface-hover` oklch(30.1% 0.016 264.3)
- `--border`        oklch(43.4% 0.026 265.5)   可见边框（被动）
- `--border-strong` oklch(50.5% 0.023 260.1)   交互轮廓 ≥3:1
- `--text`          oklch(89.1% 0.008 260.7)   13.4:1
- `--text-muted`    oklch(63.9% 0.016 264.5)   5.5:1 次级文本
- `--text-subtle`   oklch(60.6% 0.016 264.4)   4.8:1 标签/脚注（AA）
- `--accent`        oklch(68.1% 0.169 275.0)   靛蓝 #7c8cff，面积 ≤5%/viewport
- `--accent-fg`     oklch(18.6% 0.009 264.3)   accent 上的字色 6.2:1
- `--run`           oklch(75.4% 0.139 232.7)   运行中（青）
- `--ok`            oklch(77.3% 0.153 163.2)
- `--warn`          oklch(83.7% 0.164 84.4)
- `--danger`        oklch(71.9% 0.169 13.4)

对比度纪律：正文 ≥4.5:1；非文本交互轮廓 ≥3:1；语义色只作状态点/徽章/左边条，
不作大面积填充。

## Typography

- Display: "Space Grotesk Variable"（@fontsource-variable 自托管，latin only），
  weight 600，style normal；CJK 回退系统 sans（诚实栈，不伪装）。
- Body: -apple-system, "SF Pro Text", system-ui, sans-serif；weight 400。
- Mono: "SF Mono", ui-monospace, "JetBrains Mono", monospace；数据位专用，
  数字容器加 `font-variant-numeric: tabular-nums`。
- Display tracking: 0；侧栏分组标签 11px/0.06em/`--text-subtle`，不作装饰 eyebrow。
- Type scale anchor: `--text-display` = 1.9rem；页 h1 用 display 栈 + 700。

## Spacing

4-point named scale（`--pad` 14px · `--gap` 12px · radius 6/4px）。组件必须用
named tokens，不得内联裸值。

## Motion

- Easings: `--ease-out` cubic-bezier(0.16,1,0.3,1) · `--ease-in-out`
  cubic-bezier(0.65,0,0.35,1)。时长 150/250ms。
- Reveal: none — 工作台不做 scroll reveal；仅 transform/opacity 状态过渡。
- Reduced-motion: 空间运动折叠为 ≤150ms opacity。

## Microinteractions stance

- Silent success（保存即生效 + 行内小字反馈），无庆祝 toast。
- hover 800ms tooltip / focus 0ms。
- 乐观更新 + 可撤销优先于确认对话框（归档除外：审批 gate 保留）。

## CTA voice

- Primary: accent 实底 · 6px 圆角 · 600 字重 · `--accent-fg` 字色。
- Secondary: 透明底 · 1px `--border-strong` 描边 · `--text` 字色。
- Danger: 透明底 · 1px `--danger` 描边 · `--danger` 字色。
- Disabled: 40% 不透明度 + not-allowed，不换灰色实底。
- 全站唯一按钮声音；白底按钮退役。

## Per-page allowances

- App pages MUST NOT use enrichment — 功能承载页面。
- 空态自适应高度（不得固定 ≥300px 死区），一行 `--text-muted` 说明 + 可选内联动作。
- 统计卡用 `repeat(auto-fit, minmax(150px, 1fr))`，末行不留孤儿。

## Responsive floor

- ≤900px：sidebar 折叠为 off-canvas 抽屉（汉堡按钮 + 遮罩），内容列 `minmax(0,1fr)`。
- 320/375/414/768 验证：无横向滚动；可点击文本不折行；`html,body{overflow-x:clip}`。

## What pages MUST share

wordmark（◇ BaiZe Architect）、accent 及其位置、display/body/mono 栈、CTA voice、
radius 节奏、状态色语义（ok/warn/danger/run）。

## What pages MAY differ on

Workbench family 内的分栏与 archetype knobs；tab/chip 形态；空态文案。

## Exports

### tokens.css

```css
:root {
  --bg: oklch(18.6% 0.009 264.3);
  --surface: oklch(23.0% 0.012 264.3);
  --surface-2: oklch(26.0% 0.014 267.0);
  --surface-hover: oklch(30.1% 0.016 264.3);
  --border: oklch(43.4% 0.026 265.5);
  --border-strong: oklch(50.5% 0.023 260.1);
  --text: oklch(89.1% 0.008 260.7);
  --text-muted: oklch(63.9% 0.016 264.5);
  --text-subtle: oklch(60.6% 0.016 264.4);
  --accent: oklch(68.1% 0.169 275.0);
  --accent-fg: oklch(18.6% 0.009 264.3);
  --run: oklch(75.4% 0.139 232.7);
  --ok: oklch(77.3% 0.153 163.2);
  --warn: oklch(83.7% 0.164 84.4);
  --danger: oklch(71.9% 0.169 13.4);
  --font-display: "Space Grotesk Variable", -apple-system, system-ui, sans-serif;
  --font-body: -apple-system, "SF Pro Text", system-ui, sans-serif;
  --font-mono: "SF Mono", ui-monospace, "JetBrains Mono", monospace;
  --space-2xs: 0.5rem; --space-xs: 0.75rem; --space-sm: 1rem; --space-md: 1.5rem;
  --text-xs: 0.6875rem; --text-sm: 0.8125rem; --text-base: 0.875rem;
  --text-lg: 1rem; --text-xl: 1.25rem; --text-display: 1.9rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-1: 150ms; --dur-2: 250ms;
  --radius-card: 6px; --radius-input: 6px; --radius-pill: 999px;
}
```

（Tailwind `@theme` / DTCG `tokens.json` / shadcn 变量：本项目为 Lit，不引入
这些消费端；如需跨项目复用，按上表机械映射。）
