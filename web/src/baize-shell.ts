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

/**
 * baize-shell — 应用外壳:session 管理 + 路由视图切换。
 * 路由:/ = 登录或需求列表;/assets = 资产工作台;/manage = 管理页;/workflow/:id = 详情;/workflow/:id/:tab = 详情+tab。
 * session 走 cookie 不受路由影响;登录后跳回原 URL。
 */
class BaizeShell extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		session: { state: true },
		loginToken: { state: true },
		loginError: { state: true },
		workspaceId: { state: true },
		initializing: { state: true },
	};

	declare apiBase: string;
	declare session: OperatorSession | null;
	declare loginToken: string;
	declare loginError: string | null;
	declare workspaceId: number;
	declare initializing: boolean;

	private router = new Router(this, [
		{ path: "/", render: () => this.renderHome() },
		{ path: "/assets", render: () => this.renderAssets() },
		{ path: "/manage", render: () => this.renderManage() },
		{ path: "/workflow/:id", render: ({ id }) => this.renderWorkflow(Number(id)) },
		{ path: "/workflow/:id/:tab", render: ({ id, tab }) => this.renderWorkflow(Number(id), tab) },
	] as RouteConfig[]);

	static styles = [sharedStyles, css`
		:host { display: block; }
		.app {
			display: flex;
			flex-direction: column;
			min-height: 100vh;
			max-width: var(--content-max);
			margin: 0 auto;
			padding: var(--pad);
			box-sizing: border-box;
		}
		.topbar {
			display: flex;
			align-items: center;
			gap: var(--gap);
			padding-bottom: var(--pad);
			border-bottom: 1px solid var(--border);
		}
		.topbar .brand {
			font-family: var(--font-display);
			font-weight: 600;
			font-size: var(--text-lg);
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.topbar .brand .dot { color: var(--accent); }
		.topbar .spacer { flex: 1; }
		.view-host { margin-top: var(--gap); }
		.workbench-frame { display: grid; grid-template-columns: var(--workbench-rail-width) minmax(0, 1fr) var(--workbench-rail-width); gap: var(--gap); align-items: start; }
		:host { --workbench-rail-width: 12rem; }
		.workbench-rail { position: sticky; top: 0; display: grid; gap: var(--space-2xs); padding: var(--gap); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); }
		.workbench-rail h2 { margin: 0; font-size: var(--text-sm); color: var(--text-muted); }
		.workbench-rail p { margin: 0; color: var(--text-muted); font-size: var(--text-sm); }
		.workbench-rail button { text-align: left; }
		@media (max-width: 900px) {
			.workbench-frame { grid-template-columns: minmax(0, 1fr); }
			.workbench-rail { position: static; }
		}
		.login-wrap {
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: 80vh;
		}
		.login-form {
			max-width: 360px;
			width: 100%;
		}
		.login-form .brand {
			text-align: center;
			margin-bottom: var(--gap);
			font-family: var(--font-display);
			font-size: var(--text-2xl);
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
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.session = null;
		this.loginToken = "";
		this.loginError = null;
		this.workspaceId = 0;
		this.initializing = true;
	}

	connectedCallback(): void {
		super.connectedCallback();
		void this.checkAndLoad();
	}

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
				// 如果当前 URL 是根路径,导航到列表;否则保持原 URL(如刷新详情页)
				if (window.location.pathname === "/" || window.location.pathname === "") {
					this.router.goto("/");
				}
				return;
			}
		} catch {
			// localStorage 不可用 → 不持久化
		}
		this.workspaceId = 0;
		// 无有效 workspace → 管理页
		if (window.location.pathname === "/" || window.location.pathname === "") {
			this.router.goto("/manage");
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
		this.router.goto("/");
	}

	private handleWorkspaceDeleted(event: Event): void {
		const id = (event as CustomEvent<{ id: number }>).detail.id;
		if (id === this.workspaceId) {
			this.workspaceId = 0;
			localStorage.removeItem("baize.workspaceId");
		}
	}

	private handleOpenManager(): void {
		this.router.goto("/manage");
	}

	private topbar(): ReturnType<typeof html> {
		return html`<div class="topbar">
			<div class="brand"><span class="dot">◇</span> BaiZe Architect</div>
			<span class="spacer"></span>
			${this.routerLink("/assets") ? html`<button @click=${() => this.router.goto("/assets")}>资产库</button>` : nothing}
			${this.routerLink("/manage") ? html`<button @click=${() => this.handleOpenManager()}>管理工作空间</button>` : nothing}
			<button @click=${() => { this.session = null; }}>退出</button>
		</div>`;
	}

	private routerLink(path: string): boolean {
		return !window.location.pathname.startsWith(path);
	}

	// — Route renderers —

	private renderHome(): ReturnType<typeof html> {
		if (this.workspaceId === 0) {
			return html`<div class="empty">请先选择或创建工作空间。</div>`;
		}
		return html`<div class="home-stack">
			<baize-requirements
				.apiBase=${this.apiBase}
				.workspaceId=${this.workspaceId}
				@baize-open-requirement=${(e: Event) => {
					const id = (e as CustomEvent<{ id: number }>).detail.id;
					this.router.goto(`/workflow/${id}`);
				}}
			></baize-requirements>
		</div>`;
	}

	private renderAssets(): ReturnType<typeof html> {
		if (this.workspaceId === 0) {
			return html`<div class="empty">请先选择或创建工作空间。</div>`;
		}
		return html`<div class="workbench-frame">
			<aside class="workbench-rail" aria-label="工作台导航">
				<h2>工作台</h2>
				<button @click=${() => this.router.goto("/")}>需求</button>
				<button class="primary" aria-current="page">资产库</button>
			</aside>
			<main class="asset-main">
				<baize-asset-library .apiBase=${this.apiBase} .workspaceId=${this.workspaceId}></baize-asset-library>
			</main>
			<aside class="workbench-rail" aria-label="运行上下文">
				<h2>运行上下文</h2>
				<p>资产操作不产生治理 Run。</p>
				<p>当前 Workspace 的资产关系和 revision 在详情区查看。</p>
			</aside>
		</div>`;
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
			@baize-goto=${() => { this.router.goto("/"); }}
		></baize-workflow>`;
	}

	render() {
		if (!this.session) {
			return html`<div class="login-wrap">
				<form class="card login-form" @submit=${(e: Event) => void this.handleLogin(e)}>
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
			return html`<div class="app"><div class="empty">加载中…</div></div>`;
		}

		return html`<div class="app">
			${this.topbar()}
			<div class="view-host">
				${this.router.outlet()}
			</div>
		</div>`;
	}
}

customElements.define("baize-shell", BaizeShell);