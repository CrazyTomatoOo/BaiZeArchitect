# Design — BaiZe Architect

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow. Implementation lives in `web/index.html` (`:root` token
block + `[data-theme]` / `@media` overrides) + `web/src/*.ts` (Lit shadow-DOM
components consuming the tokens by name).

## Genre

atmospheric — 双主题 AI 工作台（暗色 Graphite Indigo 收紧 + 亮色，系统跟随 +
手动覆写）。OKLCH 色板；对比度经 XYZ Y 通道验证达 WCAG AA。

## Macrostructure family

- App pages: VS Code 式五层 — Activity Bar（最左图标条 48px）+ Side Bar（导航/
  列表 240px）+ 主区/Editor Group（单面板 + 内部 tab：任务/产物/治理）+
  Panel（底部可折叠）+ Status Bar（底部固定 24px）。
  页面间只变 archetype knobs（Side Bar 域列表形态、主区 tab 组合），不变主题。
- Marketing pages: 无（本产品无营销页）。
- Content pages: 无独立内容页；markdown 渲染遵循正文排版规则。

### 布局骨架

Shell `:host` 纵向 flex：`.topbar`（固定 `--topbar-h` 40px）→ `.workbench-row`
（`flex: 1; min-height: 0`）→ `.panel`（height 0 或 `--panel-h-open` 240px）→
`.status-bar`（固定 `--status-bar-h` 24px）。

`.workbench-row` 横向 grid 四列：
`var(--activity-bar-w) | var(--side-bar-w) | minmax(0, 1fr) | var(--rail-w)`

Side Bar 折叠 = 列宽 0 + `transition: width var(--dur-1)`。右栏可隐藏 = 列宽 0。
Panel 折叠 = height 0 + `overflow: hidden` + transition；展开时主区 flex 收缩，
不覆盖。

`--content-max` 已删除——主区占满视口减去侧栏。保留 max-width 的仅：登录表单
`min(360px, 100%)`、模态 `max-width: 720px`、长文本正文 `max-width: 72ch`。

## Theme

双主题：暗色 Graphite Indigo 收紧（默认）+ 亮色（系统跟随 + 手动覆写）。
同一变量名覆写——消费端零改动。

### 暗色（收紧后）

- `--bg`            oklch(17.0% 0.009 264.3)   石墨纸面（-1.6% L）
- `--surface`       oklch(21.5% 0.012 264.3)   一级抬升（-1.5% L）
- `--surface-2`     oklch(24.5% 0.014 267.0)   二级抬升（-1.5% L）
- `--surface-hover` oklch(28.5% 0.016 264.3)   （-1.6% L）
- `--border`        oklch(48.0% 0.026 265.5)   被动可见边框 3.0:1
- `--border-strong` oklch(52.0% 0.023 260.1)   交互轮廓 ≥3:1
- `--text`          oklch(89.1% 0.008 260.7)   14.2:1
- `--text-muted`    oklch(63.9% 0.016 264.5)   5.8:1 次级文本
- `--text-subtle`   oklch(60.6% 0.016 264.4)   5.1:1 标签/脚注（AA）
- `--accent`        oklch(68.1% 0.169 275.0)   靛蓝 #7c8cff，面积 ≤5%/viewport
- `--accent-fg`     oklch(17.0% 0.009 264.3)   accent 上的字色 7.2:1
- `--run`           oklch(75.4% 0.139 232.7)   运行中（青）
- `--ok`            oklch(77.3% 0.153 163.2)
- `--warn`          oklch(83.7% 0.164 84.4)
- `--danger`        oklch(71.9% 0.169 13.4)

### 亮色（共享 Indigo 色相 H=275，只调明度）

- `--bg`            oklch(98.5% 0.003 264.0)   近白微冷纸面
- `--surface`       oklch(96.5% 0.004 264.0)   一级抬升
- `--surface-2`     oklch(94.5% 0.005 264.0)   二级抬升
- `--surface-hover` oklch(92.5% 0.006 264.0)
- `--border`        oklch(65.0% 0.012 265.0)   被动可见边框 3.1:1
- `--border-strong` oklch(50.0% 0.015 260.0)   交互轮廓 5.8:1
- `--text`          oklch(15.0% 0.008 260.0)   19.4:1
- `--text-muted`    oklch(42.0% 0.014 264.0)   8.2:1 次级文本
- `--text-subtle`   oklch(44.0% 0.014 264.0)   7.5:1 标签/脚注（AA）
- `--accent`        oklch(45.0% 0.169 275.0)   靛蓝（同色相降明度）6.8:1
- `--accent-fg`     oklch(98.5% 0.003 264.0)   accent 上的字色 6.8:1
- `--run`           oklch(45.0% 0.139 232.7)   6.7:1
- `--ok`            oklch(45.0% 0.153 163.2)   6.8:1
- `--warn`          oklch(60.0% 0.164 84.4)   4.0:1
- `--danger`        oklch(48.0% 0.169 13.4)   6.9:1

### 切换机制

- localStorage key：`baize.theme`，值 `"system"` | `"light"` | `"dark"`，默认
  `"system"`。
- 三态循环：system → light → dark → system。Activity Bar 底部主题图标触发。
- `<html data-theme="light"|"dark">` 属性 + `@media (prefers-color-scheme: light)`
  + `:root[data-theme]` 覆写优先级：
  1. `:root` 暗色默认
  2. `:root:not([data-theme="dark"])` in `@media (prefers-color-scheme: light)`
     → 系统亮色跟随
  3. `:root[data-theme="light"]` → 手动亮色覆写
  4. `:root[data-theme="dark"]` → 手动暗色覆写（覆盖系统亮色）
- 尺寸/字体/动画 token 不随主题变——仅在 `:root` 定义一次。

对比度纪律：正文 ≥4.5:1；非文本交互轮廓 ≥3:1；语义色只作状态点/徽章/左边条，
不作大面积填充。

## Typography

- Display: "Space Grotesk Variable"（@fontsource-variable 自托管，latin only），
  weight 600，style normal；CJK 回退系统 sans（诚实栈，不伪装）。
- Body: -apple-system, "SF Pro Text", system-ui, sans-serif；weight 400。
- Mono: "SF Mono", ui-monospace, "JetBrains Mono", monospace；数据位专用，
  数字容器加 `font-variant-numeric: tabular-nums`。
- Display tracking: 0；侧栏分组标签 10px/0.06em/`--text-subtle`，不作装饰 eyebrow。
- Type scale anchor: `--text-base` = 0.8125rem（13px）；页 h1 用 display 栈 + 700。

## Spacing

4-point named scale（`--pad` 12px · `--gap` 8px · `--gap-dense` 4px ·
radius 4/3px）。组件必须用 named tokens，不得内联裸值。

布局尺寸 token（双主题共享——尺寸不随主题变）：
`--topbar-h` 40px · `--activity-bar-w` 48px · `--side-bar-w` 240px
（`--side-bar-w-min` 160px · `--side-bar-w-max` 480px，拖拽预留，首版不实现）·
`--rail-w` 320px · `--panel-h-open` 240px · `--status-bar-h` 24px。

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

- Primary: accent 实底 · 4px 圆角 · 600 字重 · `--accent-fg` 字色。
- Secondary: 透明底 · 1px `--border-strong` 描边 · `--text` 字色。
- Danger: 透明底 · 1px `--danger` 描边 · `--danger` 字色。
- Disabled: 40% 不透明度 + not-allowed，不换灰色实底。
- 全站唯一按钮声音；白底按钮退役。

## Per-page allowances

五层布局下各表面的内容规则：

- **主区/Editor Group**：单面板 + 内部 tab（任务/产物/治理）。主区自身
  `overflow-y: auto`，内容纵向排列。不设 max-width——Side Bar + 右栏提供结构。
- **Side Bar**：混合模式——Activity Bar 切换顶层视图（需求/资产/管理），Side Bar
  内为当前视图的域列表。需求视图=需求列表，资产视图=9 类资产导航，管理视图=
  工作空间列表。
- **右栏**：gate 队列 + 批准审阅常驻；无 gate 时右栏隐藏，主区扩展全宽。
- **Panel**：底部可折叠——公告流 + 命令回执历史。默认折叠，不自动展开。
- **空态**：自适应高度（不得固定 ≥300px 死区），一行 `--text-muted` 说明 +
  可选内联动作。
- 统计卡用 `repeat(auto-fit, minmax(150px, 1fr))`，末行不留孤儿。

## Responsive floor

两档——直接从完整五层跳到坍缩，无中间态。

- ≥900px（`min-width: 900px`）：完整五层——Activity Bar 左侧 48px 竖排 +
  Side Bar 240px + 主区 1fr + 右栏 320px + Panel 可折叠 + Status Bar 24px。
- <900px（`max-width: 899.98px`）：五层逐层坍缩——
  - Activity Bar → 底部固定横排 bar 48px（`flex-direction: row` +
    `justify-content: space-around`，位于 Status Bar 之上）
  - Side Bar → off-canvas 抽屉（`transform: translateX(-100%)` + transition +
    scrim 遮罩），汉堡按钮触发，宽度 `min(var(--side-bar-w), 80vw)`
  - 右栏 → `display: none`，gate 队列 fallback 到主区 hero 下方竖排
  - Panel → `display: none`，公告降级为 aria-live region
  - Status Bar → 精简（只留连接指示灯 + 工作流状态 + 待处理计数，隐藏版本号/
    事件序号/角色）
  - workbench-row grid → 单列 `1fr`
- 320/375/414/768 验证：无横向滚动；可点击文本不折行；Activity Bar 图标
  touch target ≥44px；`html,body{overflow-x:clip}`。
- 不实现 swipe 手势——汉堡按钮 + scrim + Esc 关闭。

## What pages MUST share

wordmark（◇ BaiZe Architect）、accent 及其位置、display/body/mono 栈、
CTA voice、radius 节奏、状态色语义（ok/warn/danger/run）、
面板结构（Activity Bar 图标 + Side Bar 视图 + Status Bar 状态语义）。

## What pages MAY differ on

五层内 archetype knobs：主区 tab 组合（任务/产物/治理可增减）、Side Bar 域列表
形态（树/列表/分组）、tab/chip 形态、空态文案。

## Exports

### index.html token 块

```css
/* — 暗色默认 — */
:root {
  --bg: oklch(17.0% 0.009 264.3);
  --surface: oklch(21.5% 0.012 264.3);
  --surface-2: oklch(24.5% 0.014 267);
  --surface-hover: oklch(28.5% 0.016 264.3);
  --border: oklch(48.0% 0.026 265.5);
  --border-strong: oklch(52.0% 0.023 260.1);
  --text: oklch(89.1% 0.008 260.7);
  --text-muted: oklch(63.9% 0.016 264.5);
  --text-subtle: oklch(60.6% 0.016 264.4);
  --accent: oklch(68.1% 0.169 275);
  --accent-hi: oklch(74% 0.165 275);
  --accent-fg: oklch(17.0% 0.009 264.3);
  --run: oklch(75.4% 0.139 232.7);
  --ok: oklch(77.3% 0.153 163.2);
  --warn: oklch(83.7% 0.164 84.4);
  --danger: oklch(71.9% 0.169 13.4);
  --scrim: oklch(12% 0.01 264 / 0.55);
  --accent-glow: oklch(68.1% 0.169 275 / 0.15);
  --accent-line: oklch(68.1% 0.169 275 / 0.55);
  --nav-card: oklch(20% 0.01 264 / 0.72);
  --ok-soft: oklch(77.3% 0.153 163.2 / 0.15);
  --warn-soft: oklch(83.7% 0.164 84.4 / 0.12);
  --warn-line: oklch(83.7% 0.164 84.4 / 0.3);
  --scrim-strong: oklch(8% 0.01 264 / 0.6);
  --shadow-1: oklch(10% 0.01 264 / 0.3);
  --shadow-2: oklch(10% 0.01 264 / 0.5);
  --radius: 4px; --radius-sm: 3px; --radius-card: 4px;
  --radius-input: 4px; --radius-pill: 999px;
  --pad: 12px; --gap: 8px; --gap-dense: 4px;
  --space-2xs: 0.5rem; --space-xs: 0.75rem; --space-sm: 1rem; --space-md: 1.5rem;
  --topbar-h: 40px; --activity-bar-w: 48px;
  --side-bar-w: 240px; --side-bar-w-min: 160px; --side-bar-w-max: 480px;
  --rail-w: 320px; --panel-h-open: 240px; --status-bar-h: 24px;
  --font-display: "Space Grotesk Variable", -apple-system, system-ui, sans-serif;
  --font-body: -apple-system, "SF Pro Text", system-ui, sans-serif;
  --font-mono: "SF Mono", ui-monospace, "JetBrains Mono", monospace;
  --text-xs: 0.625rem; --text-sm: 0.75rem; --text-base: 0.8125rem;
  --text-lg: 1rem; --text-xl: 1.25rem; --text-display: 1.9rem;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
  --dur-1: 150ms; --dur-2: 250ms;
}

/* — 系统跟随亮色 — */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg: oklch(98.5% 0.003 264.0);
    /* ... 全部亮色 token ... */
  }
}

/* — 手动亮色 — */
:root[data-theme="light"] { /* ... 全部亮色 token ... */ }

/* — 手动暗色（覆盖系统亮色）— */
:root[data-theme="dark"] { /* ... 全部暗色 token ... */ }
```

（Tailwind `@theme` / DTCG `tokens.json` / shadcn 变量：本项目为 Lit，不引入
这些消费端；如需跨项目复用，按上表机械映射。）
