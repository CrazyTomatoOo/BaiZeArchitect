import { LitElement, html, css } from "lit";

/**
 * baize-shell — app shell:sidebar 工作台(T03 IA)。
 * sidebar:顶部 workspace 切换器(跳工作区页)+ 三区 nav + 底部状态区。
 * 落地页:localStorage `baize.ui.v1.lastPage` 记忆;首次有 workspace→需求,无→工作区。
 * ⌘B 折叠 sidebar(persist)。子视图 ?hidden 挂载保活;子视图可派发 baize-goto 切页。
 * 注:资产库/待决策/系统页、workspace 单作用域、ws run rail、⌘K 面板待各自 step 落地后接入。
 */
class BaizeShell extends LitElement {
	static properties = {
		tab: { state: true },
		ws: { state: true },
		folded: { state: true },
	};

	declare tab: string;
	declare ws: string | null;
	declare folded: boolean;

	static styles = css`
		:host {
			display: block;
			min-height: 100vh;
			background: var(--bg);
			color: var(--text);
			font-family: var(--font-ui);
		}
		.app {
			display: grid;
			grid-template-columns: var(--sidebar-w) 1fr;
			min-height: 100vh;
		}
		.app.folded {
			grid-template-columns: 56px 1fr;
		}
		.sidebar {
			background: var(--surface);
			border-right: 1px solid var(--border);
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}
		.ws-switch {
			display: flex;
			align-items: center;
			gap: 0.5rem;
			padding: 0.9rem var(--pad);
			border-bottom: 1px solid var(--border);
			font-weight: 600;
			cursor: pointer;
		}
		.ws-switch:hover {
			background: var(--surface-hover);
		}
		.ws-switch .dot {
			color: var(--accent);
		}
		.ws-switch .name {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.ws-switch .caret {
			margin-left: auto;
			color: var(--text-muted);
		}
		.app.folded .ws-switch .name,
		.app.folded .ws-switch .caret,
		.app.folded .nav,
		.app.folded .status-foot {
			display: none;
		}
		.nav {
			padding: var(--gap) 0;
			flex: 1;
			overflow: auto;
		}
		.nav-group {
			padding: 0 var(--pad) var(--gap);
		}
		.nav-group + .nav-group {
			border-top: 1px solid var(--border);
			padding-top: var(--gap);
		}
		.nav-group .label {
			font-size: 11px;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: var(--text-subtle);
			margin-bottom: 6px;
		}
		.nav-item {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 7px 8px;
			border-radius: var(--radius-sm);
			color: var(--text-muted);
			background: transparent;
			border: none;
			cursor: pointer;
			font: inherit;
			font-size: 0.85rem;
			width: 100%;
			text-align: left;
		}
		.nav-item:hover {
			background: var(--surface-hover);
			color: var(--text);
		}
		.nav-item:focus-visible {
			outline: 2px solid var(--accent-2);
			outline-offset: 2px;
		}
		.nav-item.active {
			background: var(--surface-2);
			color: var(--text);
		}
		.status-foot {
			padding: var(--pad);
			border-top: 1px solid var(--border);
			font-size: 0.75rem;
			color: var(--text-muted);
		}
		.status-foot .live {
			color: var(--muted);
		}
		main {
			overflow: auto;
			max-width: var(--content-max);
			margin: 0 auto;
			padding: var(--pad) calc(var(--pad) * 1.4) 3rem;
		}
		[hidden] {
			display: none;
		}
	`;

	constructor() {
		super();
		const lastPage = localStorage.getItem("baize.ui.v1.lastPage");
		const hasWs = !!localStorage.getItem("baize.ui.v1.workspace");
		this.tab = lastPage ?? (hasWs ? "requirement" : "workspaces");
		this.ws = localStorage.getItem("baize.ui.v1.workspace");
		this.folded = localStorage.getItem("baize.ui.v1.sidebarFolded") === "1";
	}

	connectedCallback(): void {
		super.connectedCallback();
		this.addEventListener("baize-goto", (this.onGoto as EventListener));
		addEventListener("keydown", this.onKey);
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		removeEventListener("keydown", this.onKey);
	}

	private onGoto = (e: CustomEvent<{ tab: string }>) => {
		this.goto(e.detail.tab);
	};

	private onKey = (e: KeyboardEvent) => {
		const t = e.target as HTMLElement | null;
		if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
			return;
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
			e.preventDefault();
			this.folded = !this.folded;
			localStorage.setItem("baize.ui.v1.sidebarFolded", this.folded ? "1" : "0");
		}
	};

	private goto(tab: string) {
		this.tab = tab;
		localStorage.setItem("baize.ui.v1.lastPage", tab);
	}

	render() {
		return html`
			<div class="app ${this.folded ? "folded" : ""}">
				<aside class="sidebar">
					<div
						class="ws-switch"
						@click=${() => this.goto("workspaces")}
						title="切换/管理工作区"
					>
						<span class="dot">◇</span>
						<span class="name">${this.ws ?? "未选择工作区"}</span>
						<span class="caret">▾</span>
					</div>
					<nav class="nav">
						<div class="nav-group">
							<div class="label">工作</div>
							<button
								class="nav-item ${this.tab === "requirement" ? "active" : ""}"
								@click=${() => this.goto("requirement")}
							>
								需求
							</button>
							<button
								class="nav-item ${this.tab === "overview" ? "active" : ""}"
								@click=${() => this.goto("overview")}
							>
								总览
							</button>
						</div>
						<div class="nav-group">
							<div class="label">管理</div>
							<button
								class="nav-item ${this.tab === "workspaces" ? "active" : ""}"
								@click=${() => this.goto("workspaces")}
							>
								工作区
							</button>
						</div>
					</nav>
					<div class="status-foot">
						<div><span class="live">●</span> ws 未连接</div>
						<div>工作区:${this.ws ?? "—"}</div>
					</div>
				</aside>
				<main>
					<baize-requirement ?hidden=${this.tab !== "requirement"}></baize-requirement>
					<baize-workspaces ?hidden=${this.tab !== "workspaces"}></baize-workspaces>
					<div ?hidden=${this.tab !== "overview"}>
						<baize-overview></baize-overview>
						<baize-dashboard></baize-dashboard>
					</div>
				</main>
			</div>
		`;
	}
}

customElements.define("baize-shell", BaizeShell);
