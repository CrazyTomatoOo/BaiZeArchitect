import { LitElement, html, css } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { marked } from "marked";

/**
 * baize-markdown — markdown(含 mermaid)渲染组件(E05)。
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

	/** marked v9+:通过 marked.use 覆盖 renderer.code,token 形如 { text, lang, escaped }。 */
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
		// allowlist:仅同源相对路径,防 SSRF/外联
		if (!this.src.startsWith("/")) {
			this.text = "_(src 必须为同源相对路径)_";
			return;
		}
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

	/** DOMParser 注入 SVG(不执行脚本,避免 innerHTML XSS)。 */
	private _injectSvg(node: HTMLElement, svg: string) {
		const doc = new DOMParser().parseFromString(svg, "text/html");
		const root = doc.body.firstElementChild;
		if (!root || root.tagName.toLowerCase() !== "svg") {
			throw new Error("mermaid SVG root parse error");
		}
		const imported = this.ownerDocument.importNode(root, true);
		node.replaceChildren(imported);
	}

	/** 异步编排:parse 后的 .mermaid 占位 → mermaid.render → 注入 SVG。串行化防并发。 */
	private async _renderMermaid() {
		if (this._rendering) return;
		this._rendering = true;
		try {
			const root = this.renderRoot;
			const nodes = Array.from(
				root.querySelectorAll<HTMLElement>(".mermaid:not([data-rendered])"),
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
					this._injectSvg(node, svg);
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
