import { LitElement, html, css } from "lit";

/**
 * baize-shell — app shell:sidebar 工作台(T03 IA)。
 * sidebar:顶部 workspace 切换器(跳工作区页)+ 三区 nav + 底部状态区。
 * 落地页:localStorage `baize.ui.v1.lastPage` 记忆;首次有 workspace→需求,无→工作区。
 * ⌘B 折叠 sidebar(persist)。子视图 ?hidden 挂载保活;子视图可派发 baize-goto 切页。
 * 注:资产库/待决策/系统页、ws run rail、⌘K 面板均已挂载接入(原「待落地后接入」已兑现);workspace 单作用域(1 repo = 1 ws)。
 */
class BaizeShell extends LitElement {
	static properties = {
		tab: { state: true },
		ws: { state: true },
		wsName: { state: true },
		workspaces: { state: true },
		folded: { state: true },
		decCount: { state: true },
		wsConnected: { state: true },
	};

	declare tab: string;
	declare ws: number;
	declare wsName: string;
	declare workspaces: Array<{ id: number; name: string }>;
	declare folded: boolean;
	declare decCount: number;
	declare wsConnected: boolean;

	private es: EventSource | null = null;

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
			flex: 1;
			min-height: 0;
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
		.status-foot .live.on {
			color: var(--ok);
		}
		main {
			overflow: auto;
			padding: var(--pad) calc(var(--pad) * 1.4) 3rem;
		}
		[hidden] {
			display: none;
		}
		/* step6: workspace scope */
		.ws-select {
			background: transparent;
			border: none;
			color: var(--text);
			font: inherit;
			font-weight: 600;
			font-size: 0.9rem;
			max-width: 170px;
		}
		.ws-select option {
			background: var(--surface);
			color: var(--text);
		}
		.ws-switch .dot.active {
			color: var(--accent);
		}
		.scope-banner {
			background: rgba(245, 158, 11, 0.12);
			color: var(--warn);
			border: 1px solid rgba(245, 158, 11, 0.3);
			border-radius: var(--radius-sm);
			padding: 6px 12px;
			font-size: 0.8rem;
			margin-bottom: var(--gap);
			display: inline-flex;
			align-items: center;
			gap: 6px;
		}
		.shell {
			display: flex;
			flex-direction: column;
			min-height: 100vh;
		}
		.topbar {
			display: flex;
			align-items: center;
			gap: 12px;
			padding: 10px 20px;
			border-bottom: 1px solid var(--border);
			background: var(--surface);
		}
		.logo {
			display: flex;
			align-items: center;
			gap: 8px;
			font-weight: 650;
			font-size: 1rem;
		}
		.logo .dot {
			color: var(--accent);
		}
		.topbar-right {
			margin-left: auto;
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.manage {
			background: transparent;
			border: 1px solid var(--border-strong);
			color: var(--text-muted);
			border-radius: var(--radius-sm);
			padding: 6px 12px;
			font: inherit;
			font-size: 0.82rem;
			cursor: pointer;
			transition: color 0.2s, border-color 0.2s;
		}
		.manage:hover {
			color: var(--text);
			border-color: var(--accent);
		}
		.entry-main {
			flex: 1;
			overflow: auto;
			width: 100%;
			padding: var(--pad) calc(var(--pad) * 1.4) 3rem;
		}
	`;

	constructor() {
		super();
		const lastPage = localStorage.getItem("baize.ui.v1.lastPage");
		const wsParam = new URLSearchParams(location.search).get("workspace");
		const wsId = wsParam ? Number(wsParam) : Number(localStorage.getItem("baize.ui.v1.workspace") ?? "0");
		this.tab = lastPage && lastPage !== "workspaces" ? lastPage : "requirement";
		this.ws = Number.isFinite(wsId) ? wsId : 0;
		this.wsName = localStorage.getItem("baize.ui.v1.workspaceName") ?? "";
		this.workspaces = [];
		this.folded = localStorage.getItem("baize.ui.v1.sidebarFolded") === "1";
		this.decCount = 0;
		this.wsConnected = false;
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		this.addEventListener("baize-goto", this.onGoto as EventListener);
		this.addEventListener("baize-fold-toggle", this.onFoldToggle as EventListener);
		this.addEventListener("baize-new-requirement", this.onNewRequirement as EventListener);
		this.addEventListener("baize-workspaces-changed", this.onWorkspacesChanged as EventListener);
		this.addEventListener("baize-decisions-count", this.onDecisionsCount as EventListener);
		this.addEventListener("baize-select-workspace", this.onSelectWorkspace as EventListener);
		addEventListener("keydown", this.onKey);
		try {
			this.es = new EventSource("/api/runs/stream");
			this.es.onopen = () => {
				this.wsConnected = true;
			};
			this.es.onerror = () => {
				this.wsConnected = false;
			};
		} catch {
			this.es = null;
			this.wsConnected = false;
		}
		await this.loadWorkspaces();
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		this.removeEventListener("baize-goto", this.onGoto as EventListener);
		this.removeEventListener(
			"baize-fold-toggle",
			this.onFoldToggle as EventListener,
		);
		this.removeEventListener(
			"baize-new-requirement",
			this.onNewRequirement as EventListener,
		);
		this.removeEventListener("baize-workspaces-changed", this.onWorkspacesChanged as EventListener);
		this.removeEventListener("baize-decisions-count", this.onDecisionsCount as EventListener);
		this.removeEventListener("baize-select-workspace", this.onSelectWorkspace as EventListener);
		removeEventListener("keydown", this.onKey);
		this.es?.close();
	}

	private onGoto = (e: CustomEvent<{ tab: string }>) => {
		this.goto(e.detail.tab);
	};

	private onSelectWorkspace = (e: CustomEvent<{ id: number }>) => {
		this.setWs(e.detail.id);
	};
	private onFoldToggle = () => {
		this.folded = !this.folded;
		localStorage.setItem("baize.ui.v1.sidebarFolded", this.folded ? "1" : "0");
	};

	private onNewRequirement = () => {
		// chat-intake(step3)接入前:先跳到需求页
		this.goto("requirement");
	};

	private onKey = (e: KeyboardEvent) => {
		const t = e.target as HTMLElement | null;
		if (
			t &&
			(t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
		) {
			return;
		}
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
			e.preventDefault();
			this.folded = !this.folded;
			localStorage.setItem(
				"baize.ui.v1.sidebarFolded",
				this.folded ? "1" : "0",
			);
		}
	};

	private goto(tab: string) {
		this.tab = tab;
		localStorage.setItem("baize.ui.v1.lastPage", tab);
	}

	private async loadWorkspaces() {
		try {
			this.workspaces = (await (
				await fetch("/api/workspaces")
			).json()) as Array<{ id: number; name: string }>;
			if (this.ws && !this.wsName) {
				this.wsName =
					this.workspaces.find((w) => w.id === this.ws)?.name ?? "";
			}
		} catch {
			this.workspaces = [];
		}
	}

	private setWs(id: number) {
		this.ws = id;
		if (id && this.tab === "workspaces") this.tab = "requirement";
		this.wsName = this.workspaces.find((w) => w.id === id)?.name ?? "";
		if (id) {
			localStorage.setItem("baize.ui.v1.workspace", String(id));
			localStorage.setItem("baize.ui.v1.workspaceName", this.wsName);
		} else {
			localStorage.removeItem("baize.ui.v1.workspace");
			localStorage.removeItem("baize.ui.v1.workspaceName");
		}
		try {
			const u = new URL(location.href);
			if (id) u.searchParams.set("workspace", String(id));
			else u.searchParams.delete("workspace");
			history.replaceState(null, "", u);
		} catch {
			// file:// 无 history 时静默
		}
		this.dispatchEvent(
			new CustomEvent("baize-workspace-change", {
				detail: { id, name: this.wsName },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private onWorkspacesChanged = () => {
		this.loadWorkspaces();
	};

	private onDecisionsCount = (e: CustomEvent<{ count: number }>) => {
		this.decCount = e.detail.count;
	};

	render() {
		return html`
			<div class="shell">
				<header class="topbar">
					<span class="logo"><span class="dot">◇</span> BaiZe Architect</span>
					<div class="topbar-right">
						<select
							class="ws-select"
							.value=${String(this.ws)}
							@change=${(e: Event) =>
								this.setWs(Number((e.target as HTMLSelectElement).value))}
						>
							${this.workspaces.map(
								(w) =>
									html`<option value=${w.id} ?selected=${w.id === this.ws}>${w.name}</option>`,
							)}
						</select>
						${this.ws
							? html`<button class="manage" @click=${() => this.setWs(0)}>管理工作区</button>`
							: null}
					</div>
				</header>
				${this.ws
					? html`<div class="app ${this.folded ? "folded" : ""}">
							<aside class="sidebar">
								<nav class="nav">
							<button class="nav-item ${this.tab === "overview" ? "active" : ""}" @click=${() => this.goto("overview")}>总览</button>
							<div class="nav-group">
								<div class="label">工作</div>
								<button class="nav-item ${this.tab === "requirement" ? "active" : ""}" @click=${() => this.goto("requirement")}>需求</button>
								<button class="nav-item ${this.tab === "decisions" ? "active" : ""}" @click=${() => this.goto("decisions")}>
									待决策${this.decCount ? html` <span class="chip">${this.decCount}</span>` : null}
								</button>
							</div>
							<div class="nav-group">
								<div class="label">资产库</div>
								<button class="nav-item ${this.tab === "assets-req" ? "active" : ""}" @click=${() => this.goto("assets-req")}>需求管理</button>
								<button class="nav-item ${this.tab === "assets-scenario" ? "active" : ""}" @click=${() => this.goto("assets-scenario")}>场景库</button>
								<button class="nav-item ${this.tab === "assets-usecase" ? "active" : ""}" @click=${() => this.goto("assets-usecase")}>用例库</button>
								<button class="nav-item ${this.tab === "assets-function" ? "active" : ""}" @click=${() => this.goto("assets-function")}>功能库</button>
							</div>
							<div class="nav-group">
								<div class="label">管理</div>
							<button class="nav-item ${this.tab === "system" ? "active" : ""}" @click=${() => this.goto("system")}>系统</button>
							<button class="nav-item ${this.tab === "evidence" ? "active" : ""}" @click=${() => this.goto("evidence")}>证据</button>
							</div>
								<div class="status-foot">
									<div><span class="live ${this.wsConnected ? "on" : ""}">●</span> ws ${this.wsConnected ? "已连接" : "未连接"}</div>
									<div>工作区:${this.wsName || "—"}</div>
								</div>
							</aside>
							<main>
								<baize-overview ?hidden=${this.tab !== "overview"}></baize-overview>
								<baize-requirement ?hidden=${this.tab !== "requirement"}></baize-requirement>
								<baize-decisions ?hidden=${this.tab !== "decisions"}></baize-decisions>
								<baize-asset-library
									.view=${this.tab.startsWith("assets-") ? this.tab.slice(7) : "req"}
									?hidden=${!this.tab.startsWith("assets-")}
								></baize-asset-library>
							<baize-system ?hidden=${this.tab !== "system"}></baize-system>
							<baize-dashboard ?hidden=${this.tab !== "evidence"}></baize-dashboard>
							</main>
						</div>`
					: html`<main class="entry-main">
							<baize-workspaces></baize-workspaces>
						</main>`}
				<baize-command-palette></baize-command-palette>
			<baize-run-rail .suppress=${this.tab === "requirement"}></baize-run-rail>
				<baize-chat-intake></baize-chat-intake>
			</div>
		`;
	}
}

customElements.define("baize-shell", BaizeShell);
