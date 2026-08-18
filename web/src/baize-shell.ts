import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import {
	bootstrapSession,
	checkSession,
	type OperatorSession,
} from "./workflow-client.js";
import "./baize-requirements.js";
import "./baize-workflow.js";

/**
 * baize-shell — 应用外壳:session 管理 + 需求列表/详情切换。
 * 需求列表点击进入详情;详情内联显示门禁/审批/恢复(workflow 组件自带)。
 * 监听 baize-open-requirement(列表)→ 切换到 workflow 详情;
 * 监听 baize-goto(workflow 返回)→ 切回需求列表。
 */
class BaizeShell extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		session: { state: true },
		loginToken: { state: true },
		loginError: { state: true },
		requirementId: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare session: OperatorSession | null;
	declare loginToken: string;
	declare loginError: string | null;
	declare requirementId: number;

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
		this.workspaceId = 1;
		this.session = null;
		this.loginToken = "";
		this.loginError = null;
		this.requirementId = 0;
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
	}

	private async handleLogin(event: Event): Promise<void> {
		event.preventDefault();
		try {
			this.session = await bootstrapSession(this.apiBase, this.loginToken);
			this.loginError = null;
		} catch (error) {
			this.loginError = error instanceof Error ? error.message : String(error);
		}
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

		// 需求详情视图(门禁/审批/恢复内联在 workflow 组件中)
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

		// 需求列表视图
		return html`<div class="app">
			<div class="topbar">
				<div class="brand"><span class="dot">◇</span> BaiZe Architect</div>
				<span class="spacer"></span>
				<button @click=${() => { this.session = null; }}>退出</button>
			</div>
			<baize-requirements
				.apiBase=${this.apiBase}
				.workspaceId=${this.workspaceId}
				@baize-open-requirement=${(e: Event) => { this.requirementId = (e as CustomEvent<{ id: number }>).detail.id; }}
			></baize-requirements>
		</div>`;
	}
}

customElements.define("baize-shell", BaizeShell);
