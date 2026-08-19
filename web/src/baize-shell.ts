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
import "./baize-workflow.js";
import "./baize-workspace-manager.js";

/**
 * baize-shell — 应用外壳:session 管理 + 视图切换(管理页 / 需求列表 / 详情)。
 * 视图四态(决议 09):!session → 登录;requirementId > 0 → 详情(优先);managerOpen → 管理页;否则需求列表。
 * 登录后按 localStorage["baize.workspaceId"] 解析选中态:合法键直达该工作区需求列表;
 * 无键/键已失效(工作区被删)→ 回管理页并清键。
 * 监听:baize-open-requirement(列表→详情)、baize-goto(详情→列表)、
 * baize-enter-workspace(管理页→进入)、baize-workspace-deleted(删除当前→清键)。
 */
class BaizeShell extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		session: { state: true },
		loginToken: { state: true },
		loginError: { state: true },
		requirementId: { state: true },
		managerOpen: { state: true },
		workspaceId: { state: true },
		initializing: { state: true },
	};

	declare apiBase: string;
	declare session: OperatorSession | null;
	declare loginToken: string;
	declare loginError: string | null;
	declare requirementId: number;
	declare managerOpen: boolean;
	declare workspaceId: number;
	declare initializing: boolean;

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
		this.requirementId = 0;
		this.managerOpen = false;
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

	/** 登录成功后的加载序:合法已存键直达其需求列表;否则回管理页(无键不清、失效清键)。 */
	private async resolveInitialView(): Promise<void> {
		try {
			const stored = localStorage.getItem("baize.workspaceId");
			let workspaces: readonly import("./workflow-client.js").WorkspaceSummary[] | null = null;
			try {
				workspaces = await listWorkspaces(this.apiBase);
			} catch {
				workspaces = null; // 列表不可用:保留已存选择,仍回管理页
			}
			const resolved = resolveStoredWorkspace(stored, workspaces);
			if (resolved.clearKey) localStorage.removeItem("baize.workspaceId");
			if (resolved.workspaceId !== null) {
				this.workspaceId = resolved.workspaceId;
				this.managerOpen = false;
				this.requirementId = 0;
				return;
			}
		} catch {
			// localStorage 不可用(如隐私模式)→ 不持久化,仍回管理页
		}
		this.workspaceId = 0;
		this.managerOpen = true;
		this.requirementId = 0;
	}

	private async handleLogin(event: Event): Promise<void> {
		event.preventDefault();
		try {
			this.session = await bootstrapSession(this.apiBase, this.loginToken);
			this.loginError = null;
			// 先进入加载态再解析选中态:避免 session 已立但视图未决的闪屏。
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
		this.managerOpen = false;
		this.requirementId = 0;
		localStorage.setItem("baize.workspaceId", String(id));
	}

	private handleWorkspaceDeleted(event: Event): void {
		const id = (event as CustomEvent<{ id: number }>).detail.id;
		if (id === this.workspaceId) {
			this.workspaceId = 0;
			localStorage.removeItem("baize.workspaceId");
		}
	}

	private handleOpenManager(): void {
		this.managerOpen = true;
		this.requirementId = 0;
	}

	private topbar(): ReturnType<typeof html> {
		return html`<div class="topbar">
			<div class="brand"><span class="dot">◇</span> BaiZe Architect</div>
			<span class="spacer"></span>
			${this.managerOpen
				? nothing
				: html`<button @click=${() => this.handleOpenManager()}>管理工作空间</button>`}
			<button @click=${() => { this.session = null; }}>退出</button>
		</div>`;
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

		// 需求详情视图(门禁/审批/恢复内联在 workflow 组件中);两级返回:详情 → 列表 → 管理页。
		if (this.requirementId > 0) {
			return html`<div class="app">
				<baize-workflow
					.apiBase=${this.apiBase}
					.workspaceId=${this.workspaceId}
					.requirementId=${this.requirementId}
					@baize-goto=${() => { this.requirementId = 0; }}
				></baize-workflow>
			</div>`;
		}

		if (this.managerOpen) {
			return html`<div class="app">
				${this.topbar()}
				<div class="view-host">
					<baize-workspace-manager
						.apiBase=${this.apiBase}
						@baize-enter-workspace=${(e: Event) => this.handleEnterWorkspace(e)}
						@baize-workspace-deleted=${(e: Event) => this.handleWorkspaceDeleted(e)}
					></baize-workspace-manager>
				</div>
			</div>`;
		}

		// 需求列表视图
		return html`<div class="app">
			${this.topbar()}
			<div class="view-host">
				<baize-requirements
					.apiBase=${this.apiBase}
					.workspaceId=${this.workspaceId}
					@baize-open-requirement=${(e: Event) => { this.requirementId = (e as CustomEvent<{ id: number }>).detail.id; }}
				></baize-requirements>
			</div>
		</div>`;
	}
}

customElements.define("baize-shell", BaizeShell);