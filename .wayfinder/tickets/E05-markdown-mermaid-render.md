# E05 — markdown/mermaid 渲染方案 `wayfinder:research`

status: closed
assignee: pi(research)
blocked-by:
research: research/E05-markdown-mermaid-render.md

## Question

Lit web component shadow DOM 内渲染 markdown + mermaid 的可行方案?调研:

- 库选型:marked + mermaid / markdown-it / 其他;shadow DOM 样式隔离(mermaid 注入 SVG 的样式穿透)。
- mermaid 初始化时序(异步 render after markdown parse);与 BaiZe CSS vars(`--bg/--text/--accent` 等)集成(主题)。
- 落地:共享 `baize-markdown` 组件 vs 各页内联。

产出:`research/E05-markdown-mermaid-render.md`(库选型 + 集成方案 + 代码骨架 + 陷阱)。

## Resolution(2026-08-06,research 子代理)

findings 落盘:`research/E05-markdown-mermaid-render.md`(六节)。
gist:marked(sync parse)+ mermaid.js(dynamic import,~280KB code-split);markdown-it 备选(CommonMark 严格/锚点插件时)。关键:用 `mermaid.render(id,code)` 返回 SVG 字符串自行注入 shadowDOM(非 `mermaid.run()`——后者扫 document 跨不了 shadow 边界),零全局副作用。主题:mermaid `themeVariables` 只收 hex 不收 CSS vars(open #6860),运行时 getComputedStyle 读 `--bg/--text/--surface/--border` 等解 hex,喂 `theme:'base',darkMode:true`。时序:marked.parse(sync)→ unsafeHTML 注入→ updated()→ dynamic import('mermaid')+ initialize(once)→ 循环 await mermaid.render() 每个 .mermaid 占位。落地:共享 `baize-markdown` 组件(代码骨架在 findings)。
