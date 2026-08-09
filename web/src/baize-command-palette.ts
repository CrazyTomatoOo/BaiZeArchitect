import { LitElement, html, css } from "lit";

/**
 * baize-command-palette — ⌘K 命令面板(T05 交互模式)。
 * 全局监听 ⌘K/Ctrl+K 开合;↑↓ 导航、Enter 选中、Esc 关闭;输入框聚焦时不拦截其他键。
 * 内置命令:切页(派发 baize-goto)、折叠 sidebar(派发 baize-fold-toggle)、
 * 新建需求(派发 baize-new-requirement,chat-intake 接入前由 shell 决定行为)。
 * 自带命令集,shell 只需挂载 + 监听事件;后续 step 可扩充命令。
 */
interface Cmd {
	id: string;
	label: string;
	hint?: string;
	/** 返回 true 表示执行后关闭面板 */
	run: () => boolean;
}

class BaizeCommandPalette extends LitElement {
	static properties = {
		open: { type: Boolean, reflect: true },
		query: { state: true },
		sel: { state: true },
	};

	declare open: boolean;
	declare query: string;
	declare sel: number;

	private cmds: Cmd[] = [];
	private inputEl: HTMLInputElement | null = null;

	static styles = css`
		:host {
			position: fixed;
			inset: 0;
			z-index: 100;
			display: none;
		}
		:host([open]) {
			display: block;
		}
		.backdrop {
			position: absolute;
			inset: 0;
			background: var(--scrim-strong);
		}
		.panel {
			position: relative;
			margin: 12vh auto 0;
			width: min(560px, 90vw);
			background: var(--surface);
			border: 1px solid var(--border-strong);
			border-radius: var(--radius);
			box-shadow: 0 12px 40px var(--shadow-2);
			overflow: hidden;
		}
		input {
			display: block;
			width: 100%;
			box-sizing: border-box;
			background: var(--surface-2);
			border: none;
			border-bottom: 1px solid var(--border);
			color: var(--text);
			font: inherit;
			font-size: 0.95rem;
			padding: 0.8rem var(--pad);
		}
		input:focus {
			outline: none;
		}
		ul {
			list-style: none;
			margin: 0;
			padding: 4px;
			max-height: 50vh;
			overflow: auto;
		}
		li {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px 10px;
			border-radius: var(--radius-sm);
			color: var(--text-muted);
			cursor: pointer;
			font-size: 0.88rem;
		}
		li.sel {
			background: var(--surface-hover);
			color: var(--text);
		}
		li .hint {
			margin-left: auto;
			color: var(--text-subtle);
			font-family: var(--font-mono);
			font-size: 0.75rem;
		}
		.empty {
			padding: 1rem var(--pad);
			color: var(--text-subtle);
			font-size: 0.85rem;
		}
	`;

	constructor() {
		super();
		this.open = false;
		this.query = "";
		this.sel = 0;
	}

	connectedCallback(): void {
		super.connectedCallback();
		this.cmds = [
			{
				id: "goto-requirement",
				label: "跳到 需求",
				hint: "需求设计页",
				run: () => {
					this.dispatch("baize-goto", "requirement");
					return true;
				},
			},
			{
				id: "goto-overview",
				label: "跳到 总览",
				hint: "总览仪表盘",
				run: () => {
					this.dispatch("baize-goto", "overview");
					return true;
				},
			},
			{
				id: "goto-workspaces",
				label: "跳到 工作区",
				hint: "工作区管理",
				run: () => {
					this.dispatch("baize-goto", "workspaces");
					return true;
				},
			},
			{
				id: "fold-sidebar",
				label: "折叠/展开 sidebar",
				hint: "⌘B",
				run: () => {
					this.dispatchEvent(
						new CustomEvent("baize-fold-toggle", {
							bubbles: true,
							composed: true,
						}),
					);
					return true;
				},
			},
			{
				id: "new-requirement",
				label: "新建需求",
				hint: "chat 录入",
				run: () => {
					this.dispatchEvent(
						new CustomEvent("baize-new-requirement", {
							bubbles: true,
							composed: true,
						}),
					);
					return true;
				},
			},
		];
		addEventListener("keydown", this.onKey);
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		removeEventListener("keydown", this.onKey);
	}

	private dispatch(name: string, tab: string) {
		this.dispatchEvent(
			new CustomEvent(name, { detail: { tab }, bubbles: true, composed: true }),
		);
	}

	private onKey = (e: KeyboardEvent) => {
		const t = e.target as HTMLElement | null;
		const typing =
			t &&
			(t.tagName === "INPUT" ||
				t.tagName === "TEXTAREA" ||
				t.isContentEditable);
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
			e.preventDefault();
			this.toggle();
			return;
		}
		if (!this.open) return;
		if (e.key === "Escape") {
			e.preventDefault();
			this.close();
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			this.sel = (this.sel + 1) % Math.max(1, this.filtered().length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			const n = Math.max(1, this.filtered().length);
			this.sel = (this.sel - 1 + n) % n;
		} else if (e.key === "Enter") {
			e.preventDefault();
			const list = this.filtered();
			const c = list[this.sel];
			if (c && c.run()) this.close();
		}
		// typing inside the palette input is allowed (handled by @input)
		void typing;
	};

	private toggle() {
		this.open ? this.close() : this.openPanel();
	}

	private openPanel() {
		this.open = true;
		this.query = "";
		this.sel = 0;
		this.updateComplete.then(() => {
			this.inputEl = this.renderRoot.querySelector("input");
			this.inputEl?.focus();
		});
	}

	private close() {
		this.open = false;
	}

	private filtered(): Cmd[] {
		const q = this.query.trim().toLowerCase();
		if (!q) return this.cmds;
		return this.cmds.filter(
			(c) => c.label.toLowerCase().includes(q) || c.id.includes(q),
		);
	}

	private onInput = (e: InputEvent) => {
		this.query = (e.target as HTMLInputElement).value;
		this.sel = 0;
	};

	private select(c: Cmd) {
		if (c.run()) this.close();
	}

	render() {
		const list = this.filtered();
		return html`
			<div class="backdrop" @click=${() => this.close()}></div>
			<div class="panel" role="dialog" aria-label="命令面板">
				<input
					type="text"
					placeholder="输入命令…(⌘K 开/关,↑↓ 选,Enter 执行,Esc 关)"
					.value=${this.query}
					@input=${this.onInput}
				/>
				<ul>
					${list.map(
						(c, i) => html`
						<li
							class=${i === this.sel ? "sel" : ""}
							@mouseenter=${() => (this.sel = i)}
							@click=${() => this.select(c)}
						>
							<span>${c.label}</span>
							${c.hint ? html`<span class="hint">${c.hint}</span>` : null}
						</li>
					`,
					)}
				</ul>
				${list.length === 0 ? html`<div class="empty">无匹配命令</div>` : null}
			</div>
		`;
	}
}

customElements.define("baize-command-palette", BaizeCommandPalette);
