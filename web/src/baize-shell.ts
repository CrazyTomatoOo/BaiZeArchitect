import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
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
type ActiveView = "requirements" | "assets" | "manage";

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
		sidebarCollapsed: { state: true },
		statusSnapshot: { state: true },
		panelEntries: { state: true },
		panelOpen: { state: true },
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
	declare statusSnapshot: StatusSnapshot | null;
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

		/* — <900px 坍缩骨架 — */
		@media (max-width: 899.98px) {
			.workbench-row {
				grid-template-columns: minmax(0, 1fr);
			}
			/* Activity Bar 转底部 bar（占位暂时隐藏，票 #79 实现真实底部 bar） */
			.activity-bar-slot { display: none; }
			/* Side Bar 转 off-canvas 抽屉（占位暂时隐藏，票 #79 实现真实抽屉） */
			.side-bar-slot { display: none; }
			/* 右栏隐藏 */
			.rail-slot { display: none; }
			/* Panel 隐藏 */
			.panel-slot { display: none; }
		}
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.session = null;
		this.loginToken = "";
		this.loginError = null;
		this.initializing = true;
		this.activeView = "requirements";
		this.theme = "system";
		this.sidebarCollapsed = false;
		this.statusSnapshot = null;
		this.panelEntries = [];
		this.panelOpen = false;
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
		const order: Theme[] = ["system", "light", "dark"];
		const next = order[(order.indexOf(this.theme) + 1) % order.length];
		this.theme = next;
		localStorage.setItem("baize.theme", next);
		this.applyTheme();
	}

	/** Activity Bar 视图切换。 */
	private switchView(view: ActiveView): void {
		if (view === this.activeView) {
			// 点击已激活项 → 切换 Side Bar 折叠
			this.sidebarCollapsed = !this.sidebarCollapsed;
		} else {
			this.activeView = view;
			this.sidebarCollapsed = false;
			// 路由切换
			if (view === "requirements") this.navigate("/");
			else if (view === "assets") this.navigate("/assets");
			else if (view === "manage") this.navigate("/manage");
		}
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
			let workspaces: readonly import("./workflow-client.js").WorkspaceSummary[] | null = null;
			try {
				workspaces = await listWorkspaces(this.apiBase);
			} catch {
				workspaces = null;
			}
			const resolved = resolveStoredWorkspace(stored, workspaces);
			if (resolved.clearKey) localStorage.removeItem("baize.workspaceId");
			if (resolved.workspaceId !== null) {
				this.workspaceId = resolved.workspaceId;
				this.activeView = "requirements";
				if (window.location.pathname === "/" || window.location.pathname === "") {
					this.navigate("/");
				}
				return;
			}
		} catch {
			// localStorage 不可用 → 不持久化
		}
		this.workspaceId = 0;
		this.activeView = "manage";
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
		localStorage.setItem("baize.workspaceId", String(id));
		this.activeView = "requirements";
		this.navigate("/");
	}

	private handleWorkspaceDeleted(event: Event): void {
		const id = (event as CustomEvent<{ id: number }>).detail.id;
		if (id === this.workspaceId) {
			this.workspaceId = 0;
			localStorage.removeItem("baize.workspaceId");
		}
	}

	private navigate(path: string): void {
		if (window.location.pathname !== path || window.location.search !== "") {
			window.history.pushState({}, "", path);
		}
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
		return html`<baize-requirements
			.apiBase=${this.apiBase}
			.workspaceId=${this.workspaceId}
			@baize-open-requirement=${(e: Event) => {
				const id = (e as CustomEvent<{ id: number }>).detail.id;
				this.navigate(`/workflow/${id}`);
			}}
		></baize-requirements>`;
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
		// 从路径推断 activeView（路由可能在不含视图切换的情况下变化，如 /workflow/:id）
		const path = window.location.pathname;
		if (path.startsWith("/assets")) this.activeView = "assets";
		else if (path.startsWith("/manage")) this.activeView = "manage";
		else this.activeView = "requirements";
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
				<div class="brand"><span class="dot">◇</span> BaiZe Architect</div>
				<span class="spacer"></span>
				<button @click=${() => { this.session = null; }}>退出</button>
			</div>
			<div class="workbench-row" ?data-sidebar-collapsed=${this.sidebarCollapsed}>
				<div class="activity-bar-slot">
					<div class="placeholder">Activity Bar</div>
				</div>
				<div class="side-bar-slot">
					<div class="placeholder">Side Bar</div>
				</div>
				<main class="main-slot">
					${this.router.outlet()}
				</main>
				<div class="rail-slot">
					<div class="placeholder">右栏</div>
				</div>
			</div>
			<div class="panel-slot ${this.panelOpen ? "open" : ""}">
				<div class="placeholder">Panel</div>
			</div>
			<div class="status-bar-slot" @keydown=${(e: KeyboardEvent) => this.handleKeydown(e)}>
				<div class="placeholder">Status Bar</div>
			</div>
		`;
	}
}

customElements.define("baize-shell", BaizeShell);
