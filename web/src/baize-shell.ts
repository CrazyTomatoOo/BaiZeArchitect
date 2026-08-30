import { LitElement, html, css, nothing } from "lit";
import { sharedStyles, cycleTheme } from "./baize-styles.js";
import {
	bootstrapSession,
	checkSession,
	listWorkspaces,
	resolveStoredWorkspace,
	type OperatorSession,
} from "./workflow-client.js";
import "./baize-requirements.js";
import "./baize-asset-library.js";
import "./baize-workflow.js";
import "./baize-workspace-manager.js";
import "./baize-activity-bar.js";
import "./baize-side-bar.js";
import "./baize-panel.js";
import "./baize-status-bar.js";

// URLPattern polyfill for non-Chromium browsers (Firefox/Safari)
import "urlpattern-polyfill";
import { Router, type RouteConfig } from "@lit-labs/router";

/** Status Bar 全局快照——baize-workflow emit baize-status-update 携带。 */
export interface StatusSnapshot {
	connected: boolean;
	workflowState: string;
	workflowVersion: number;
	lastEventSeq: number;
	pendingGates: number;
	pendingDecisions: number;
	pendingFindings: number;
	hasActiveRun: boolean;
	runRole: string | null;
}

/** Panel 条目——公告或回执。 */
export type PanelEntry =
	| { kind: "announce"; text: string; timestamp: number }
	| { kind: "receipt"; commandType: string; outcome: string; httpStatus: number; timestamp: number };

/** 主题三态。 */
type Theme = "system" | "light" | "dark";

/** Activity Bar 顶层视图。 */
type ActiveView = "workspace";

/** 解析主题偏好 → 实际应用到 <html> 的 data-theme 值。 */
function resolveTheme(pref: Theme): "light" | "dark" | null {
	if (pref === "light") return "light";
	if (pref === "dark") return "dark";
	// system: 跟随 prefers-color-scheme，不设 data-theme（CSS media query 处理）
	return null;
}

/**
 * baize-shell — VS Code 式五层应用外壳:topbar + workbench-row(Activity Bar +
 * Side Bar + 主区 + 右栏) + Panel + Status Bar。session 管理 + 路由视图切换 +
 * 双主题初始化。
 */
class BaizeShell extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		session: { state: true },
		loginToken: { state: true },
		loginError: { state: true },
		workspaceId: { state: true },
		initializing: { state: true },
		activeView: { state: true },
		theme: { state: true },
		sidebarCollapsed: { type: Boolean, reflect: true, attribute: "data-sidebar-collapsed" },
		drawerOpen: { state: true },
		statusSnapshot: { state: true },
		panelEntries: { state: true },
		panelOpen: { state: true },
		workspaces: { state: true },
		switcherOpen: { state: true },
	};
	declare apiBase: string;
	declare session: OperatorSession | null;
	declare loginToken: string;
	declare loginError: string | null;
	declare workspaceId: number;
	declare initializing: boolean;
	declare activeView: ActiveView;
	declare theme: Theme;
	declare sidebarCollapsed: boolean;
	declare drawerOpen: boolean;
	declare statusSnapshot: StatusSnapshot | null;
	declare workspaces: readonly import("./workflow-client.js").WorkspaceSummary[];
	declare switcherOpen: boolean;
	declare panelEntries: PanelEntry[];
	declare panelOpen: boolean;

	/** matchMedia 监听器引用——disconnectedCallback 撤销。 */
	private mediaQuery: MediaQueryList | null = null;
	private mediaHandler: (() => void) | null = null;

	private router = new Router(this, [
		{ path: "/", render: () => this.renderHome() },
		{ path: "/assets", render: () => this.renderAssets() },
		{ path: "/manage", render: () => this.renderManage() },
		{ path: "/workflow/:id", render: ({ id }) => this.renderWorkflow(Number(id)) },
		{ path: "/workflow/:id/:tab", render: ({ id, tab }) => this.renderWorkflow(Number(id), tab) },
	] as RouteConfig[]);

	static styles = [sharedStyles, css`
		:host {
			display: flex;
			flex-direction: column;
			height: 100vh;
			overflow: hidden;
		}

		/* — 精简顶栏 — */
		.topbar {
			flex: 0 0 var(--topbar-h);
			display: flex;
			align-items: center;
			gap: var(--gap);
			padding: 0 var(--pad);
			border-bottom: 1px solid var(--border);
			background: var(--surface);
		}
		.topbar .brand {
			font-family: var(--font-display);
			font-weight: 600;
			font-size: var(--text-base);
			display: flex;
			align-items: center;
			gap: var(--space-2xs);
		}
		.topbar .brand .dot { color: var(--accent); }
		.topbar .spacer { flex: 1; }
	.workspace-switcher {
			position: relative;
		}
		.switcher-btn {
			background: var(--surface-2);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: var(--gap-dense) var(--pad);
			color: var(--text);
			font-size: var(--text-sm);
			cursor: pointer;
			white-space: nowrap;
		}
		.switcher-btn:hover { background: var(--surface-hover); }
		.switcher-dropdown {
			position: absolute;
			right: 0;
			top: calc(100% + var(--gap-dense));
			min-width: 200px;
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			box-shadow: 0 var(--gap) var(--space-md) var(--shadow-1);
			z-index: 10;
			overflow: hidden;
		}
		.switcher-item {
			display: block;
			width: 100%;
			text-align: left;
			padding: var(--gap) var(--pad);
			background: transparent;
			border: none;
			color: var(--text);
			font-size: var(--text-sm);
			cursor: pointer;
		}
		.switcher-item:hover { background: var(--surface-hover); }
		.switcher-item.active { color: var(--accent); }
		.switcher-item.manage-link { border-top: 1px solid var(--border); color: var(--text-muted); }
		.switcher-scrim {
			position: fixed;
			inset: 0;
			z-index: 9;
			border: 0;
			background: transparent;
			cursor: default;
		}

		/* — workbench-row: 横向 grid 四列 — */
		.workbench-row {
			flex: 1 1 0;
			min-height: 0;
			display: grid;
			grid-template-columns:
				var(--activity-bar-w)
				var(--side-bar-w, 0px)
				minmax(0, 1fr)
				var(--rail-w, 0px);
			overflow: hidden;
		}
		/* Side Bar 折叠 = 列宽 0 */
		:host([data-sidebar-collapsed]) .workbench-row {
			grid-template-columns:
				var(--activity-bar-w)
				0px
				minmax(0, 1fr)
				var(--rail-w, 0px);
		}

		/* — Activity Bar 占位 — */
		.activity-bar-slot {
			background: var(--surface-2);
			border-right: 1px solid var(--border);
			display: flex;
			align-items: center;
			justify-content: center;
			overflow: hidden;
		}

		/* — Side Bar 占位 — */
		.side-bar-slot {
			background: var(--surface);
			border-right: 1px solid var(--border);
			overflow: hidden;
			transition: opacity var(--dur-1) var(--ease-out);
		}
		:host([data-sidebar-collapsed]) .side-bar-slot { opacity: 0; }

		/* — 主区 — */
		.main-slot {
			background: var(--bg);
			overflow-y: auto;
			min-width: 0;
		}

		/* — 右栏占位 — */
		.rail-slot {
			background: var(--surface);
			border-left: 1px solid var(--border);
			overflow: hidden;
		}

		/* — Panel（底部可折叠） — */
		.panel-slot {
			flex: 0 0 0;
			height: 0;
			overflow: hidden;
			transition: height var(--dur-1) var(--ease-out);
			background: var(--surface-2);
			border-top: 1px solid var(--border);
		}
		.panel-slot.open {
			height: var(--panel-h-open);
			flex: 0 0 var(--panel-h-open);
		}

		/* — Status Bar — */
		.status-bar-slot {
			flex: 0 0 var(--status-bar-h);
			display: flex;
			align-items: center;
			gap: var(--gap);
			padding: 0 var(--pad);
			background: var(--surface);
			border-top: 1px solid var(--border);
			font-size: var(--text-xs);
			color: var(--text-muted);
		}

		.placeholder {
			color: var(--text-subtle);
			font-size: var(--text-xs);
			padding: var(--space-xs);
		}

		/* — 登录页 — */
		.login-wrap {
			display: flex;
			align-items: center;
			justify-content: center;
			flex: 1;
			min-height: 0;
		}
		.login-form {
			max-width: 360px;
			width: 100%;
		}
		.login-form .brand {
			text-align: center;
			margin-bottom: var(--gap);
			font-family: var(--font-display);
			font-size: var(--text-xl);
			font-weight: 600;
		}
		.login-form .brand .dot { color: var(--accent); }
		.login-form p {
			text-align: center;
			color: var(--text-muted);
			margin-bottom: var(--gap);
		}
		.login-form input { width: 100%; margin-bottom: 10px; }
		.login-form button { width: 100%; }
		.login-form .error {
			margin-top: 10px;
			color: var(--danger);
			font-size: var(--text-sm);
			text-align: center;
		}

	/* — <900px 坍缩:Activity Bar→底部 bar / Side Bar→off-canvas 抽屉 / 右栏隐藏 / Panel 隐藏 — */
	.menu-button, .drawer-scrim { display: none; }
	@media (max-width: 899.98px) {
		/* workbench-row 单列 */
		.workbench-row {
			grid-template-columns: minmax(0, 1fr);
		}
		/* Activity Bar → 底部固定横排 bar 48px,在 Status Bar 之上 */
		.activity-bar-slot {
			position: fixed;
			bottom: var(--status-bar-h);
			left: 0;
			right: 0;
			z-index: 3;
			height: var(--activity-bar-w);
			border-right: none;
			border-top: 1px solid var(--border);
		}
		/* 顶栏显示汉堡按钮 */
		.menu-button { display: inline-flex; }
		/* Side Bar → off-canvas 抽屉 */
		.side-bar-slot {
			position: fixed;
			inset: 0 auto 0 0;
			z-index: 4;
			width: min(var(--side-bar-w), 80vw);
			box-sizing: border-box;
			transform: translateX(-100%);
			transition: transform var(--dur-2) var(--ease-out);
			border-right: 1px solid var(--border);
		}
		.side-bar-slot.drawer-open { transform: translateX(0); }
		/* scrim 遮罩 */
		.drawer-scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 3;
			border: 0;
			border-radius: 0;
			background: var(--scrim);
		}
		/* 右栏隐藏 */
		.rail-slot { display: none; }
		/* Panel 隐藏 */
		.panel-slot { display: none; }
		/* Status Bar 底部留出 Activity Bar 空间 */
		.status-bar-slot { margin-bottom: var(--activity-bar-w); }
	}
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.session = null;
		this.loginToken = "";
		this.loginError = null;
		this.initializing = true;
		this.activeView = "workspace";
		this.theme = "system";
		this.sidebarCollapsed = false;
	this.drawerOpen = false;
		this.statusSnapshot = null;
		this.panelEntries = [];
		this.panelOpen = false;
		this.workspaces = [];
		this.switcherOpen = false;
	}

	connectedCallback(): void {
		super.connectedCallback();
		this.initTheme();
		void this.checkAndLoad();
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		if (this.mediaQuery && this.mediaHandler) {
			this.mediaQuery.removeEventListener("change", this.mediaHandler);
		}
	}

	// — 主题初始化 —

	private initTheme(): void {
		const stored = localStorage.getItem("baize.theme") as Theme | null;
		this.theme = stored ?? "system";
		this.applyTheme();

		// 监听系统主题变化（仅 system 模式下需要更新）
		this.mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
		this.mediaHandler = () => {
			if (this.theme === "system") this.applyTheme();
		};
		this.mediaQuery.addEventListener("change", this.mediaHandler);
	}

	/** 设置 <html data-theme> 属性。 */
	private applyTheme(): void {
		const resolved = resolveTheme(this.theme);
		const html = document.documentElement;
		if (resolved === null) {
			html.removeAttribute("data-theme");
		} else {
			html.setAttribute("data-theme", resolved);
		}
	}

	/** Activity Bar 主题切换三态循环。 */
	private cycleTheme(): void {
		this.theme = cycleTheme(this.theme);
		localStorage.setItem("baize.theme", this.theme);
		this.applyTheme();
	}

	/** Activity Bar 视图切换。 */
	private switchView(view: ActiveView): void {
		if (view === this.activeView) {
			this.sidebarCollapsed = !this.sidebarCollapsed;
		} else {
			this.activeView = view;
			this.sidebarCollapsed = false;
			this.navigate("/");
		}
	}

	private toggleDrawer(): void {
		this.drawerOpen = !this.drawerOpen;
	}

	private closeDrawer(): void {
		this.drawerOpen = false;
	}

	// — Session + 路由 —

	private async checkAndLoad(): Promise<void> {
		try {
			this.session = await checkSession(this.apiBase);
		} catch {
			this.session = null;
		}
		if (this.session) await this.resolveInitialView();
		this.initializing = false;
	}

	/** 登录成功后的加载序:合法已存键直达其需求列表;否则回管理页。 */
	private async resolveInitialView(): Promise<void> {
		try {
			const stored = localStorage.getItem("baize.workspaceId");
			try {
				this.workspaces = await listWorkspaces(this.apiBase);
			} catch {
				this.workspaces = [];
			}
			const resolved = resolveStoredWorkspace(stored, this.workspaces);
			if (resolved.clearKey) localStorage.removeItem("baize.workspaceId");
			if (resolved.workspaceId !== null) {
				this.workspaceId = resolved.workspaceId;
				if (window.location.pathname === "/" || window.location.pathname === "") {
					this.navigate("/");
				}
				return;
			}
		} catch {
			// localStorage 不可用 → 不持久化
		}
		this.workspaceId = 0;
		if (window.location.pathname === "/" || window.location.pathname === "") {
			this.navigate("/manage");
		}
	}

	private async handleLogin(event: Event): Promise<void> {
		event.preventDefault();
		try {
			this.session = await bootstrapSession(this.apiBase, this.loginToken);
			this.loginError = null;
			this.initializing = true;
			await this.resolveInitialView();
		} catch (error) {
			this.loginError = error instanceof Error ? error.message : String(error);
		} finally {
			this.initializing = false;
		}
	}

	private handleEnterWorkspace(event: Event): void {
		const id = (event as CustomEvent<{ id: number }>).detail.id;
		this.workspaceId = id;
		this.switcherOpen = false;
		localStorage.setItem("baize.workspaceId", String(id));
		void this.refreshWorkspaces();
		this.navigate("/");
	}

	private handleWorkspaceDeleted(event: Event): void {
		const id = (event as CustomEvent<{ id: number }>).detail.id;
		if (id === this.workspaceId) {
			this.workspaceId = 0;
			localStorage.removeItem("baize.workspaceId");
		}
	}

	private async refreshWorkspaces(): Promise<void> {
		try {
			this.workspaces = await listWorkspaces(this.apiBase);
		} catch {
			// 保持现有列表
		}
	}

	private toggleSwitcher(): void {
		this.switcherOpen = !this.switcherOpen;
	}

	private closeSwitcher(): void {
		this.switcherOpen = false;
	}

	private get currentWorkspaceName(): string {
		const ws = this.workspaces.find((w) => w.id === this.workspaceId);
		return ws ? ws.name : `Workspace #${this.workspaceId}`;
	}

	private navigate(path: string): void {
		if (window.location.pathname !== path || window.location.search !== "") {
			window.history.pushState({}, "", path);
		}
		this.closeDrawer();
		void this.router.goto(path);
	}

	/** Panel toggle（Status Bar 按钮 / Cmd+J）。 */
	private togglePanel(): void {
		this.panelOpen = !this.panelOpen;
	}

	private handleKeydown(event: KeyboardEvent): void {
		// Cmd+J / Ctrl+J → toggle Panel
		if ((event.metaKey || event.ctrlKey) && event.key === "j") {
			event.preventDefault();
			this.togglePanel();
		}
		// Esc → close drawer
		if (event.key === "Escape" && this.drawerOpen) {
			this.closeDrawer();
		}
	}

	/** 接收 baize-workflow 的 baize-status-update 事件。 */
	private handleStatusUpdate(event: Event): void {
		this.statusSnapshot = (event as CustomEvent<StatusSnapshot>).detail;
	}

	/** 接收 baize-panel-announce 事件。 */
	private handlePanelAnnounce(event: Event): void {
		const detail = (event as CustomEvent<{ text: string; timestamp: number }>).detail;
		const entry: PanelEntry = { kind: "announce", text: detail.text, timestamp: detail.timestamp };
		this.panelEntries = [...this.panelEntries, entry].slice(-50);
	}

	/** 接收 baize-panel-receipt 事件。 */
	private handlePanelReceipt(event: Event): void {
		const detail = (event as CustomEvent<{ commandType: string; outcome: string; httpStatus: number; timestamp: number }>).detail;
		const entry: PanelEntry = { kind: "receipt", commandType: detail.commandType, outcome: detail.outcome, httpStatus: detail.httpStatus, timestamp: detail.timestamp };
		this.panelEntries = [...this.panelEntries, entry].slice(-50);
	}

	// — Route renderers —

	private renderHome(): ReturnType<typeof html> {
		if (this.workspaceId === 0) {
			return html`<div class="empty">请先选择或创建工作空间。</div>`;
		}
		return html`<div class="empty">从侧栏选择一个需求查看详情。</div>`;
	}

	private renderAssets(): ReturnType<typeof html> {
		if (this.workspaceId === 0) {
			return html`<div class="empty">请先选择或创建工作空间。</div>`;
		}
		return html`<baize-asset-library .apiBase=${this.apiBase} .workspaceId=${this.workspaceId}></baize-asset-library>`;
	}

	private renderManage(): ReturnType<typeof html> {
		return html`<baize-workspace-manager
			.apiBase=${this.apiBase}
			@baize-enter-workspace=${(e: Event) => this.handleEnterWorkspace(e)}
			@baize-workspace-deleted=${(e: Event) => this.handleWorkspaceDeleted(e)}
		></baize-workspace-manager>`;
	}

	private renderWorkflow(id: number, tab?: string): ReturnType<typeof html> {
		return html`<baize-workflow
			.apiBase=${this.apiBase}
			.workspaceId=${this.workspaceId}
			.requirementId=${id}
			.activeTab=${tab ?? "tasks"}
			@baize-goto=${() => { this.navigate("/"); }}
			@baize-status-update=${(e: Event) => this.handleStatusUpdate(e)}
			@baize-panel-announce=${(e: Event) => this.handlePanelAnnounce(e)}
			@baize-panel-receipt=${(e: Event) => this.handlePanelReceipt(e)}
		></baize-workflow>`;
	}

	protected override willUpdate(): void {
		// activeView 始终为 workspace(管理页是独立路由,不经 Activity Bar)
		this.activeView = "workspace";
	}

	render() {
		if (!this.session) {
			return html`<div class="login-wrap">
				<form class="login-form" @submit=${(e: Event) => void this.handleLogin(e)}>
					<div class="brand"><span class="dot">◇</span> BaiZe Architect</div>
					<p>输入 Operator Token 建立会话。</p>
					<input
						type="password"
						placeholder="Operator Token"
						aria-label="Operator Token"
						.value=${this.loginToken}
						@input=${(e: Event) => (this.loginToken = (e.target as HTMLInputElement).value)}
						autocomplete="off"
					/>
					<button class="primary" type="submit">登录</button>
					${this.loginError ? html`<div class="error">${this.loginError}</div>` : nothing}
				</form>
			</div>`;
		}

		if (this.initializing) {
			return html`<div class="placeholder">加载中…</div>`;
		}

	return html`
		<div class="topbar">
			<button class="menu-button" aria-label="打开工作台导航" aria-expanded=${this.drawerOpen} @click=${() => this.toggleDrawer()}>菜单</button>
			<div class="brand"><span class="dot">◇</span> BaiZe Architect</div>
			<span class="spacer"></span>
			<div class="workspace-switcher">
				<button class="switcher-btn" @click=${() => this.toggleSwitcher()} aria-expanded=${this.switcherOpen}>
					${this.workspaceId > 0 ? this.currentWorkspaceName : "选择工作空间"}
				</button>
				${this.switcherOpen ? html`
					<div class="switcher-dropdown" role="menu">
						${this.workspaces.map((ws) => html`
							<button class="switcher-item ${ws.id === this.workspaceId ? "active" : ""}" role="menuitem"
								@click=${() => { this.workspaceId = ws.id; localStorage.setItem("baize.workspaceId", String(ws.id)); this.closeSwitcher(); this.navigate("/"); }}>
								${ws.name}
							</button>
						`)}
						<button class="switcher-item manage-link" role="menuitem"
							@click=${() => { this.closeSwitcher(); this.navigate("/manage"); }}>
							管理工作空间…
						</button>
					</div>
					<button class="switcher-scrim" aria-label="关闭切换器" @click=${() => this.closeSwitcher()}></button>
				` : nothing}
			</div>
			<button @click=${() => { this.session = null; }}>退出</button>
		</div>
		<div class="workbench-row" style="--rail-w: ${window.location.pathname.startsWith("/workflow/") ? "var(--rail-w)" : "0px"}">
			<div class="activity-bar-slot">
			<baize-activity-bar
					.activeView=${this.activeView}
					.theme=${this.theme}
					.sidebarCollapsed=${this.sidebarCollapsed}
					.workspaceId=${this.workspaceId}
					@baize-view-change=${(e: Event) => this.switchView((e as CustomEvent<{ view: ActiveView }>).detail.view)}
					@baize-theme-toggle=${() => this.cycleTheme()}
					@baize-sidebar-toggle=${() => { this.sidebarCollapsed = !this.sidebarCollapsed; }}
				></baize-activity-bar>
			</div>
			<div class="side-bar-slot ${this.drawerOpen ? "drawer-open" : ""}" ?hidden=${this.workspaceId === 0}>
				<baize-side-bar
					.activeView=${this.activeView}
					.apiBase=${this.apiBase}
					.workspaceId=${this.workspaceId}
					@baize-open-requirement=${(e: Event) => {
						const id = (e as CustomEvent<{ id: number }>).detail.id;
						this.navigate(`/workflow/${id}`);
					}}
					@baize-asset-tab-change=${(e: Event) => {
						const tab = (e as CustomEvent<{ tab: string }>).detail.tab;
						this.navigate(`/assets?tab=${tab}`);
					}}
					@baize-enter-workspace=${(e: Event) => this.handleEnterWorkspace(e)}
					@baize-workspace-deleted=${(e: Event) => this.handleWorkspaceDeleted(e)}
					@baize-sub-view-change=${(e: Event) => {
						const sv = (e as CustomEvent<{ subView: string }>).detail.subView;
						if (sv === "assets") this.navigate("/assets");
						else this.navigate("/");
					}}
				></baize-side-bar>
			</div>
			${this.drawerOpen ? html`<button class="drawer-scrim" aria-label="关闭导航" @click=${() => this.closeDrawer()}></button>` : nothing}
			<main class="main-slot" @keydown=${(e: KeyboardEvent) => this.handleKeydown(e)}>
				${this.router.outlet()}
			</main>
			${window.location.pathname.startsWith("/workflow/") ? html`<div class="rail-slot"></div>` : nothing}
		</div>
		<div class="panel-slot ${this.panelOpen ? "open" : ""}">
			<baize-panel .entries=${this.panelEntries}></baize-panel>
		</div>
		<div class="status-bar-slot">
			<baize-status-bar
				.statusSnapshot=${this.statusSnapshot}
				.workspaceName=${"Workspace " + this.workspaceId}
				.panelOpen=${this.panelOpen}
				@baize-panel-toggle=${() => this.togglePanel()}
			></baize-status-bar>
		</div>
	`;
	}
}

customElements.define("baize-shell", BaizeShell);
