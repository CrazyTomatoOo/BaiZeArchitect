# E05 — markdown/mermaid 渲染方案(调研)

> Ticket: E05 · `wayfinder:research` · 只读调研,不改源码。
> 目标:在 BaiZe(Lit 3 + shadow DOM + Vite,暗色 Graphite-Indigo 主题)内渲染 markdown(含 mermaid 图),替代当前 `baize-dashboard.ts:253` 的 `<pre>${adr}</pre>` 原文 dump。

---

## 1. 库选型推荐

### 结论(先看这个)

**marked + mermaid.js**(均动态 import)。markdown-it 作为可选替代,仅在需要 CommonMark 严格合规或 heading anchor 类插件时切换。

| 维度 | marked ✅(推荐) | markdown-it | mermaid.js ✅ |
| --- | --- | --- | --- |
| 角色 | markdown → HTML 解析器 | 同上,CommonMark 合规 | 图表 DSL → SVG |
| 体积(min+gzip,2025 实测) | ~12KB(单文件,零运行时依赖) | ~26KB(core)+ 插件按需 | ~280KB gzipped(仅在有图时加载) |
| 维护活跃度 | 极活跃,v12+(2024-2025),52M+ 周下载 | 活跃,100/100 维护分(pkgpulse) | 极活跃,v11+,89K★,mermaid-js 官方 |
| Lit 友好度 | 高:纯函数 `marked.parse(text)` 无 DOM 依赖,输出 HTML 字符串,直接喂 `unsafeHTML` | 高:同上,`md.render(text)` 返回字符串 | 中:本身依赖 DOM 渲染,需手动编排(见 §3) |
| mermaid 集成点 | `renderer.code` 覆盖:检测 `lang==='mermaid'` 输出占位 `<div class="mermaid">` | `renderer.rules.fence` 覆盖,API 更稳定跨版本 | — |
| 关键权衡 | API 在 v9 前后变过签名(`code(code,lang,esc)` → `code({text,lang})`),需锁定大版本 | fence rule 签名稳定;但体积大、core 需配插件才接近 marked 默认能力 | 大且重,必须 code-split(动态 import),否则拖垮首屏 |

**选 marked 的理由**(契合 BaiZe):

1. **最小依赖哲学**:`web/package.json` 目前仅 `lit` 一个运行时依赖,marked 零运行时依赖、单文件,符合 BaiZe「不引入多余包」的风格(对比 index.html 注释「系统字体栈,无字体文件」)。
2. **够用**:ADR/priorAdr 内容是标题+段落+列表+代码块+ mermaid,marked 默认覆盖全;不需 markdown-it 的锚点/脚注插件。
3. **mermaid 不可替代**:mermaid.js 是该领域唯一成熟、活跃维护、支持 flowchart/sequence/class/state 等全图种的开源库,无第二选项。`beautiful-mermaid` 等薄封装均基于它,不引入额外价值。

### 加载策略(对 Vite 至关重要)

mermaid ~280KB(gzip),**绝不能静态 import 进首屏**。两个库都走动态 import,Vite 自动 code-split:

```ts
// markdown 解析:静态 import(小),或也动态
import { marked } from "marked";
// mermaid:仅当检测到 .mermaid 占位时才动态 import
const mermaid = (await import("mermaid")).default;
```

> 若进一步优化,marked 也可动态 import(`await import('marked')`),使 markdown 渲染页面也懒加载。首版建议 marked 静态(体积可接受),mermaid 动态。

---

## 2. Shadow DOM 集成方案

### 核心问题:mermaid 注入的 SVG 样式如何穿越 shadow boundary?

mermaid v10+ 有两条渲染路径,对 shadow DOM 的友好度不同:

| 路径 | 行为 | shadow DOM 表现 |
| --- | --- | --- |
| `mermaid.run({ querySelector })` | 扫描 **document** 范围匹配元素并替换内容 | ❌ 默认查 document,穿不进 shadowRoot;即便传 `nodes`,内部仍有对 `document` 的依赖与样式注入,历史 bug 多 |
| `mermaid.render(id, code)` | 返回 `{ svg: string, bindFunctions }`,**你自己决定插哪** | ✅ 完美:SVG 字符串注入 shadowRoot,样式天然封装在 shadow 内 |

**推荐:`mermaid.render()` 逐图返回 SVG 字符串,手动 `el.innerHTML = svg`。** 这是唯一对 shadow DOM 零副作用的路径——mermaid 不接触 document,不注入全局 `<style>`,SVG 内联样式 + 属性自带,渲染结果完全在 shadowRoot 内隔离。

### mermaid 需要渲染在 light DOM 吗?

**不需要。** 用 `render()` 路径时,mermaid 只产出 SVG 字符串,宿主位置(shadow/light)由你决定。BaiZe 全组件 shadow DOM,继续放 shadowRoot 即可。

> 仅当使用 `mermaid.run()` 的旧式自动扫描,且图上绑了交互(点击跳转)时,才可能要 light DOM——BaiZe 的 ADR/设计图是只读静态图,无此需求。

### 样式隔离:markdown 内容样式不泄漏、不被污染

shadow DOM 天然双向隔离,但有一个坑:**可继承属性(`color`/`font`/`line-height`/`background`)默认穿透 shadow 边界**(web.dev 官方说明)。意味着:

- ✅ 好处:shadowRoot 内的 `<p>`/`<code>`/mermaid 文字会继承 host 的 `color:var(--text)`、`font-family:var(--font-ui)`,天然贴合 BaiZe 主题。
- ⚠️ 坑:host 外若有 `*{color:...}` 之类全局规则,可继承值会渗入;反之 markdown 内的 reset 也会影响后代。

对策:**在 `baize-markdown` 内层包一个 `.md` 容器,用 `all: initial` 不合适(会抹掉我们想要的继承),改为显式 reset 易冲突的几项**:

```css
:host { display: block; }
.md { color: var(--text); font: var(--text-base)/1.65 var(--font-ui); }
.md :is(h1,h2,h3,h4) { font-family: var(--font-ui); color: var(--text); line-height: 1.25; }
.md code { font-family: var(--font-mono); }
.md pre { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); }
/* mermaid SVG 里的文字继承 .md 的 color/font,自动暗色;再靠 themeVariables 兜底(见 §4) */
.md .mermaid svg { max-width: 100%; height: auto; display: block; }
```

markdown 渲染出的 HTML 经 Lit `unsafeHTML` 指令注入 `.md` 容器,**所有样式只作用于 shadowRoot 内**,不泄漏到 host,也不受 host 全局样式污染(不可继承属性天然隔离,可继承项用显式声明覆盖)。

---

## 3. Mermaid 初始化时序(异步编排)

### 时序链

```
[text/src 变更]
    │  ① 同步:marked.parse(text) → HTML 字符串(含 <div class="mermaid">RAW</div> 占位)
    │  ② Lit:unsafeHTML(html) → DOM patch,.mermaid 占位已入 shadowRoot
    ▼
[updated() 生命周期,DOM 已就绪]
    │  ③ 收集 this.renderRoot.querySelectorAll('.mermaid:not([data-rendered])')
    │  ④ 动态 import('mermaid')(仅首次,后续缓存)
    │  ⑤ mermaid.initialize({...themeVariables...})(仅首次,全局单例)
    ▼
[逐图 await]
    │  ⑥ for each node: const { svg, bindFunctions } = await mermaid.render(id, node.textContent)
    │     node.innerHTML = svg; node.dataset.rendered = '1';
    │     bindFunctions?.(node)  // 仅交互图需要
    ▼
[完成]
```

### 关键点

- **marked 同步、mermaid 异步**:两者必须串行(先 parse 出占位,再 render 图),不能在 parse 阶段调 mermaid。
- **`updated()` 而非 `firstUpdated()`**:`src` 异步 fetch 完会再次变更 `text`,需对每次变更重跑;用 `updated(changedProps)` 判断 `text` 变化才触发。
- **去重防抖**:同一节点别重复 render(mermaid 对同 id 会抛 duplicate)。用 `data-rendered` 属性跳过已处理节点;并设 `this._rendering` 布尔,避免上一次未完成时新一次并发(用 `Promise` 链串行化)。
- **id 唯一性**:`mermaid.render(id, code)` 的 id 用于 SVG 内部 `<style>` scope 与 clipPath id。多实例组件需全局自增计数器 `mermaid-${++counter}`,否则同页多图 id 冲突致样式串台。
- **错误隔离**:单图语法错不应整块 markdown 崩。`try/catch` 包 `render()`,失败时 `node.innerHTML = '<code class="mermaid-err">⚠ mermaid 语法错误</code>'` 并保留原文。
- **Lit Task 替代方案**:更「Lit 惯用法」的是 `@lit-labs/reactive-controller` 的 `Task`(lit.dev/docs/data/task),把 parse+render 包成异步 task,自动处理 pending/error 状态。BaiZe 现有组件未用 Task,首版用 `updated()` 命令式即可;若后续要 loading 态/错误态精细化,再迁 Task。

---

## 4. 主题集成(把 BaiZe CSS vars 喂给 mermaid)

### 致命约束:mermaid 不吃 CSS 变量

mermaid `themeVariables` **只认十六进制 hex,不认颜色名,也不认 `var(--x)`**([mermaid theming 官方](https://mermaid.js.org/config/theming.html):「The theming engine will only recognize hex colors」;[issue #6860](https://github.com/mermaid-js/mermaid/issues/6860)「Allow CSS Variables in themeVariables」仍 open,未实现)。

因此:**运行时读取 BaiZe 的 CSS var → 解析为 hex → 喂给 mermaid themeVariables。** 这一步必须在 `mermaid.initialize` 前、且在 CSS 已加载(组件 `connectedCallback` 之后)做。

### 读取 CSS var → hex 的 helper

```ts
/** 读 :root 上的 CSS var,返回归一化 hex(如 '#111317'),供 mermaid themeVariables 使用。 */
function cssVarHex(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  // mermaid 要求 hex;BaiZe token 全是 hex,直接 trim 即可。留 fallback 兜底非 hex 场景。
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) ? v : fallback;
}
```

### BaiZe token → mermaid themeVariables 映射

`theme: 'base'`(唯一可改主题),`darkMode: true`(影响派生色计算方向,暗色必须开)。映射对照 BaiZe `index.html :root`:

| mermaid themeVariable | 取自 BaiZe token | hex 值 | 作用 |
| --- | --- | --- | --- |
| `darkMode` | — | `true` | 派生色按暗色计算 |
| `background` | `--bg` | `#111317` | 图背景/对比基准 |
| `fontFamily` | `--font-ui` | 系统栈字符串 | 图文字字体 |
| `fontSize` | `--text-base` | `14px` | 图文字号 |
| `primaryColor` | `--surface-2` | `#21242b` | 节点填充(方框/圆) |
| `primaryTextColor` | `--text` | `#d8dbe0` | 节点内文字 |
| `primaryBorderColor` | `--border-strong` | `#3a3f49` | 节点边框 |
| `lineColor` | `--text-muted` | `#878c96` | 连线 |
| `secondaryColor` | `--surface-hover` | `#2a2e36` | 次级节点填充 |
| `secondaryTextColor` | `--text` | `#d8dbe0` | 次级节点文字 |
| `secondaryBorderColor` | `--border` | `#2c3038` | 次级节点边框 |
| `tertiaryColor` | `--bg` | `#111317` | subgraph 背景/第三层 |
| `tertiaryBorderColor` | `--border` | `#2c3038` | 第三层边框 |
| `tertiaryTextColor` | `--text-muted` | `#878c96` | 第三层文字 |
| `textColor` | `--text` | `#d8dbe0` | 图上标签/信号文字 |
| `noteBkgColor` | `--surface` | `#1a1d23` | note 背板 |
| `noteTextColor` | `--text` | `#d8dbe0` | note 文字 |
| `noteBorderColor` | `--border-strong` | `#3a3f49` | note 边框 |
| `errorBkgColor` | `--danger`(淡) | `#fb7185` | 语法错误背板 |

> `--accent #7c8cff`(靛蓝签名色)不进 themeVariables 全局(会染所有节点过艳),而用于**强调**:或在图里手写 `style Node fill:#7c8cff`,或留作 host 外的 accent 用途。若要流程图主色偏靛蓝,可把 `primaryColor` 设 `--accent` 配 `--accent-fg` 作 `primaryTextColor`,但默认按上表(石墨灰为主、靛蓝仅 accent)更符合 BaiZe 视觉。

### initialize 时机与一次性

`mermaid.initialize` 是**全局单例**,重复调用会重置主题。`baize-markdown` 多实例时,用一个模块级「已初始化」标志 + 主题快照;若 BaiZe 支持运行时切主题(redesign-mock.html 有 C/D 变体),则监听主题变更后重新 `initialize` + 全量重 render。首版单主题,init 一次即可。

---

## 5. 代码骨架:`baize-markdown` 组件

风格对齐 `baize-decisions.ts`/`baize-consent-modal.ts`(tabs 缩进、`static properties`、`declare` 字段、`static styles`、`customElements.define`)。新增依赖:`marked`(静态)、`lit/directives/unsafe-html`。

```ts
// web/src/baize-markdown.ts
import { LitElement, html, css, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { marked } from "marked";

/**
 * baize-markdown — markdown(含 mermaid)渲染组件。
 * 接收 .text(markdown 原文)或 .src(fetch 拉取),shadow DOM 内:
 *  1. marked.parse 同步出 HTML(mermaid 代码块转 <div class="mermaid"> 占位);
 *  2. unsafeHTML 注入后,updated() 异步逐图 mermaid.render() 注入 SVG。
 * 主题:运行时读 BaiZe CSS vars → hex → mermaid themeVariables(mermaid 不吃 var())。
 * mermaid 动态 import(~280KB gzip),仅首次有图时加载。
 */
class BaizeMarkdown extends LitElement {
 static properties = {
  text: { attribute: false },
  src: { type: String },
 };

 declare text: string;
 declare src: string;

 static styles = css`
  :host {
   display: block;
  }
  .md {
   color: var(--text);
   font: var(--text-base)/1.65 var(--font-ui);
   word-wrap: break-word;
  }
  .md :is(h1, h2, h3, h4) {
   font-family: var(--font-ui);
   color: var(--text);
   line-height: 1.25;
   margin: 1.4em 0 0.6em;
  }
  .md h1 { font-size: var(--text-2xl); }
  .md h2 { font-size: var(--text-xl); }
  .md h3 { font-size: var(--text-lg); }
  .md p { margin: 0.6em 0; }
  .md ul, .md ol { padding-left: 1.4em; }
  .md a { color: var(--accent); }
  .md code {
   font-family: var(--font-mono);
   font-size: 0.85em;
   background: var(--surface-2);
   border: 1px solid var(--border);
   border-radius: var(--radius-sm);
   padding: 1px 5px;
  }
  .md pre {
   background: var(--bg);
   border: 1px solid var(--border);
   border-radius: var(--radius);
   padding: 12px;
   overflow: auto;
  }
  .md pre code {
   background: none;
   border: 0;
   padding: 0;
  }
  .md blockquote {
   border-left: 3px solid var(--border-strong);
   color: var(--text-muted);
   margin: 0.8em 0;
   padding: 0 16px;
  }
  .md table {
   border-collapse: collapse;
   width: 100%;
   font-size: var(--text-sm);
  }
  .md th, .md td {
   border: 1px solid var(--border);
   padding: 6px 10px;
  }
  .md th { background: var(--surface-2); }
  .md .mermaid {
   display: flex;
   justify-content: center;
   margin: 16px 0;
   overflow-x: auto;
  }
  .md .mermaid svg {
   max-width: 100%;
   height: auto;
  }
  .md .mermaid-err {
   color: var(--danger);
   font-family: var(--font-mono);
   font-size: var(--text-sm);
   background: var(--bg);
   border: 1px solid var(--border);
   border-radius: var(--radius);
   padding: 12px;
   white-space: pre-wrap;
  }
  .md .md-empty {
   color: var(--text-muted);
   font-style: italic;
  }
 `;

 // marked 配置:覆盖 code renderer,把 ```mermaid 块转成占位 div(原文留 textContent 供 mermaid.render)
 private _markedReady = false;
 private _mermaidInit = false;
 private _rendering = false;
 private static _seq = 0;

 constructor() {
  super();
  this.text = "";
  this.src = "";
  this._configureMarked();
 }

 /** marked v12:通过 marked.use 覆盖 renderer.code。token 形如 { text, lang, escaped }。 */
 private _configureMarked() {
  if (this._markedReady) return;
  marked.use({
   renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
     if (lang === "mermaid") {
      // 占位:原文经 escape 后放 textContent,mermaid.render 时读回原码
      const esc = text
       .replace(/&/g, "&amp;")
       .replace(/</g, "&lt;")
       .replace(/>/g, "&gt;");
      return `<div class="mermaid">${esc}</div>`;
     }
     // 普通代码块走默认
     const cls = lang ? ` class="language-${lang}"` : "";
     return `<pre><code${cls}>${text}</code></pre>`;
    },
   },
  });
  this._markedReady = true;
 }

 connectedCallback(): void {
  super.connectedCallback();
  if (this.src) void this._loadSrc();
 }

 updated(changed: Map<string, unknown>): void {
  if (changed.has("text") || changed.has("src")) {
   void this._renderMermaid();
  }
 }

 private async _loadSrc() {
  if (!this.src) return;
  try {
   const r = await fetch(this.src);
   this.text = await r.text();
  } catch {
   this.text = "_(加载失败)_";
  }
 }

 /** 读 BaiZe CSS var → hex,喂 mermaid themeVariables(mermaid 不吃 var())。 */
 private _themeVars(): Record<string, string | boolean> {
  const v = (n: string, fb: string) => {
   const s = getComputedStyle(document.documentElement)
    .getPropertyValue(n)
    .trim();
   return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s) ? s : fb;
  };
  return {
   darkMode: true,
   background: v("--bg", "#111317"),
   fontFamily: "-apple-system, 'SF Pro Text', system-ui, sans-serif",
   fontSize: "14px",
   primaryColor: v("--surface-2", "#21242b"),
   primaryTextColor: v("--text", "#d8dbe0"),
   primaryBorderColor: v("--border-strong", "#3a3f49"),
   secondaryColor: v("--surface-hover", "#2a2e36"),
   secondaryTextColor: v("--text", "#d8dbe0"),
   secondaryBorderColor: v("--border", "#2c3038"),
   tertiaryColor: v("--bg", "#111317"),
   tertiaryBorderColor: v("--border", "#2c3038"),
   tertiaryTextColor: v("--text-muted", "#878c96"),
   lineColor: v("--text-muted", "#878c96"),
   textColor: v("--text", "#d8dbe0"),
   noteBkgColor: v("--surface", "#1a1d23"),
   noteTextColor: v("--text", "#d8dbe0"),
   noteBorderColor: v("--border-strong", "#3a3f49"),
   errorBkgColor: v("--danger", "#fb7185"),
  };
 }

 /** 异步编排:parse 后的 .mermaid 占位 → mermaid.render → 注入 SVG。串行化防并发。 */
 private async _renderMermaid() {
  if (this._rendering) return;
  this._rendering = true;
  try {
   const root = this.renderRoot;
   const nodes = Array.from(
    root.querySelectorAll<HTMLElement>(
     ".mermaid:not([data-rendered])",
    ),
   );
   if (!nodes.length) return;
   const mermaid = (await import("mermaid")).default;
   if (!this._mermaidInit) {
    mermaid.initialize({
     startOnLoad: false,
     securityLevel: "strict",
     theme: "base",
     themeVariables: this._themeVars(),
    });
    this._mermaidInit = true;
   }
   for (const node of nodes) {
    const code = node.textContent ?? "";
    const id = `mmd-${++BaizeMarkdown._seq}`;
    try {
     const { svg, bindFunctions } = await mermaid.render(id, code);
     node.innerHTML = svg;
     node.dataset.rendered = "1";
     bindFunctions?.(node); // 交互图(点击)才需要;静态图可省
    } catch (err) {
     node.classList.add("mermaid-err");
     node.textContent = `⚠ mermaid 渲染失败:\n${code}\n\n${
      (err as Error).message ?? err
     }`;
     node.dataset.rendered = "1";
    }
   }
  } finally {
   this._rendering = false;
  }
 }

 render() {
  if (!this.text.trim()) {
   return html`<div class="md"><p class="md-empty">(无内容)</p></div>`;
  }
  // marked.parse 同步;mermaid 异步在 updated() 里跑
  const htmlStr = marked.parse(this.text, { async: false }) as string;
  return html`<div class="md">${unsafeHTML(htmlStr)}</div>`;
 }
}

customElements.define("baize-markdown", BaizeMarkdown);
```

### 落地替换点(只读建议,不改源码)

`baize-dashboard.ts` 的 ADR 区(`:253` `<pre>${adr}</pre>`)替换为:

```ts
html`<baize-markdown .text=${adr ?? ""}></baize-markdown>`
```

`baize-requirement.ts:579` 的 `<pre>${JSON.stringify(...)}</pre>` 视内容性质:若是结构化产物 JSON,保留 `<pre>` 更合适;若是 markdown 文档,同样换 `baize-markdown`。

---

## 6. 陷阱与注意事项

1. **mermaid 不吃 CSS 变量**:必须运行时 `getComputedStyle` 解析 hex 后喂 `themeVariables`([#6860](https://github.com/mermaid-js/mermaid/issues/6860) 仍 open)。且只在 `connectedCallback` 后(此时 `:root` 样式已应用)读,否则读到空值。
2. **mermaid 体积大(~280KB gzip)**:必须动态 `import('mermaid')`,Vite 自动 split。静态 import 会进首屏 chunk,拖垮加载。无图时 `nodes.length===0` 直接 return,不触发 import。
3. **`mermaid.run()` vs `mermaid.render()`**:shadow DOM 必须用 `render()`(返回 SVG 字符串自注入);`run()` 默认扫 document,穿不进 shadowRoot,且内部依赖 document 易出 bug。
4. **id 唯一**:多实例/多图共享 SVG 内部 id(clipPath/style scope),重复会样式串台。用模块级自增计数器 `mmd-${++seq}`。
5. **重复渲染**:同一 `.mermaid` 节点别重复 `render()`(同 id 抛 duplicate)。用 `data-rendered` 跳过;并用 `_rendering` 串行化避免 `text` 连续变更时并发。
6. **可继承样式穿透 shadow 边界**:`color`/`font`/`line-height` 等 host 可继承值会渗入组件。BaiZe 已在 `:root` 设全局,基本吻合;但若 host 外有 `*{}` reset,需在 `.md` 显式重声明这几项。
7. **`securityLevel`**:默认 `strict` 最安全(禁 HTML 注入/脚本)。ADR 等可信内容可保持 strict;若图需 `click` 跳转交互才设 `'loose'`(评估 XSS 风险)。BaiZe 内容来自后端 evidence JSON,默认 strict。
8. **marked renderer.code 签名跨版本**:v9 前是 `code(code, infostring, escaped)` 位置参,v9+ 是 `code(token)` 对象参。锁 `marked@^12` 并用 token 形式;升级时留意。markdown-it 的 `renderer.rules.fence` 签名更稳定,作为备选时这点更省心。
9. **主题切换不自动重 render**:mermaid `initialize` 全局单例,BaiZe 若支持运行时切主题(redesign-mock 有 C/D 变体),需重新 `initialize` + 清 `data-rendered` + 重跑 `_renderMermaid`。首版单主题无此问题。
10. **XSS / 信任边界**:`unsafeHTML` + marked 输出 = 信任 markdown 源。BaiZe 的 markdown 来自后端(evidence/<repo>.json priorAdr.content、AI 生成的设计文档),属半信任。marked 默认不转义 inline HTML;若要更严,加 `marked.use({async:false})` 并在 renderer 里对非 mermaid 的 inline HTML 限制,或换 DOMPurify 清洗 `marked.parse` 输出再注入。ADR 场景风险低,首版可不加;面向用户自由输入时必须加。
11. **mermaid 动态导入与 Lit `updated` 时序**:`updated()` 触发时 DOM 已 patch(`.mermaid` 占位已在 shadowRoot),可直接 querySelector。但若 `text` 在 mermaid import 完成前又变,`_rendering` 串行化保证顺序;变更新文本后旧节点带 `data-rendered` 会被跳过——**这是 bug**:文本整体替换时 Lit 会重 patch 整个 `.md`,`data-rendered` 节点会被替换为新无属性节点,故无残留问题;但若只局部变(如 streaming),需手动清 `data-rendered`。首版整文本替换,无此问题。

---

## 参考

- marked vs markdown-it 体积/维护:[pkgpulse compare](https://www.pkgpulse.com/compare/markdown-it-vs-marked)、[2026 选型指南](https://www.pkgpulse.com/guides/marked-vs-remark-vs-markdown-it-parsers-2026)
- mermaid 主题与 themeVariables:[官方 theming](https://mermaid.js.org/config/theming.html)、[CSS 变量支持 issue #6860](https://github.com/mermaid-js/mermaid/issues/6860)
- shadow DOM 可继承样式穿透:[web.dev shadowdom-v1](https://web.dev/articles/shadowdom-v1)
- mermaid run/render 时序:[pub.towardsai 深读](https://pub.towardsai.net/floundering-with-mermaid-1f6b2d7b6500)、[Lit Task 异步](https://lit.dev/docs/data/task)
