import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import { bootstrapSession, checkSession, type OperatorSession } from "./workflow-client.js";
import "./baize-overview.js";
import "./baize-requirements.js";
import "./baize-review-center.js";
import "./baize-asset-library.js";
import "./baize-workflow.js";

type Tab = "overview" | "requirements" | "review" | "assets" | "detail";

const NAV: Array<{ id: Tab; icon: string; label: string }> = [
	{ id: "overview", icon: "⌂", label: "总览" },
	{ id: "requirements", icon: "✎", label: "需求" },
	{ id: "review", icon: "◇", label: "审核中心" },
	{ id: "assets", icon: "▤", label: "资产库" },
];

const TITLES: Record<Tab, string> = {
	overview: "总览",
	requirements: "需求",
	review: "审核中心",
	assets: "资产库",
	detail: "需求详情",
};

/** baize-shell — 应用外壳:登录 + 顶栏 + 侧栏导航(总览/需求/审核中心/资产库)+ 移动端抽屉。 */
class BaizeShell extends LitElement {
	static properties = {
		session: { state: true },
		loginToken: { state: true },
		loginError: { state: true },
		tab: { state: true },
		navOpen: { state: true },
		selectedId: { state: true },
		pendingGate: { state: true },
		pendingApproval: { state: true },
		createOpen: { state: true },
	};

	declare session: OperatorSession | null;
	declare loginToken: string;
	declare loginError: string | null;
	declare tab: Tab;
	declare navOpen: boolean;
	declare selectedId: number;
	declare pendingGate: string | null;
	declare pendingApproval: boolean;
	declare createOpen: boolean;

	static styles = [sharedStyles, css`
		:host { display: block; min-height: 100vh; background: var(--bg); color: var(--text); font-family: var(--font-ui); font-size: var(--text-base); line-height: 1.55; }
		.shell { min-height: 100vh; display: grid; grid-template-rows: 52px minmax(0, 1fr); }
		.topbar { display: flex; align-items: center; gap: 12px; padding: 0 20px; border-bottom: 1px solid var(--border); background: var(--surface); }
		.brand { display: flex; align-items: center; gap: 8px; font-family: var(--font-display); font-weight: 600; font-size: var(--text-lg); letter-spacing: 0.01em; white-space: nowrap; }
		.brand .dot { color: var(--accent); }
		.crumb { color: var(--text-muted); font-size: var(--text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
		.top-actions { margin-left: auto; display: flex; align-items: center; gap: 10px; }
		.operator-badge { color: var(--text-muted); font-size: var(--text-xs); white-space: nowrap; border: 1px solid var(--border); border-radius: 999px; padding: 3px 10px; }
		.menu-btn { display: none; align-items: center; justify-content: center; width: 34px; height: 34px; padding: 0; background: transparent; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); color: var(--text); font: inherit; cursor: pointer; }
		.shell-body { display: grid; grid-template-columns: var(--sidebar-w) minmax(0, 1fr); min-height: 0; }
		.backdrop { position: fixed; inset: 0; background: var(--scrim); z-index: 40; }
		.sidebar { border-right: 1px solid var(--border); background: linear-gradient(180deg, var(--surface) 0%, var(--bg) 120%); display: flex; flex-direction: column; overflow: hidden; box-shadow: 12px 0 32px var(--shadow-1); }
		.nav { padding: 14px 10px; flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
		.nav-group { border: 1px solid var(--border); border-radius: calc(var(--radius) + 4px); background: var(--nav-card); padding: 8px; }
		.nav-label { display: flex; align-items: center; padding: 4px 6px 8px; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-subtle); }
		.nav-label::before { content: ""; width: 18px; height: 2px; margin-right: 7px; border-radius: 99px; background: var(--accent); opacity: 0.75; }
		.nav-stack { display: grid; gap: 4px; }
		.nav-item { position: relative; display: flex; align-items: center; gap: 10px; min-height: 38px; padding: 8px 10px; border-radius: var(--radius); color: var(--text-muted); background: transparent; border: 1px solid transparent; cursor: pointer; font: inherit; font-size: var(--text-sm); width: 100%; text-align: left; white-space: nowrap; transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out); }
		.nav-item:hover { background: var(--surface-hover); color: var(--text); }
		.nav-item:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
		.nav-item.active { background: var(--accent-glow); border-color: var(--accent-line); color: var(--text); box-shadow: inset 3px 0 0 var(--accent); }
		.nav-ico { width: 22px; flex: 0 0 22px; text-align: center; color: var(--text-subtle); }
		.nav-item.active .nav-ico { color: var(--accent-hi); }
		.status-foot { margin: 0 10px 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: calc(var(--radius) + 4px); background: var(--nav-card); font-size: var(--text-xs); color: var(--text-muted); display: grid; gap: 4px; }
		.main { overflow-y: auto; min-width: 0; }
		.content { max-width: var(--content-max); margin: 0 auto; padding: var(--pad) calc(var(--pad) * 1.4) 3rem; }
		/* — 登录 — */
		.login-wrap { min-height: 100vh; display: grid; place-items: center; padding: var(--pad); box-sizing: border-box; }
		.login-form { width: min(420px, 100%); box-sizing: border-box; }
		.login-brand { font-size: var(--text-xl); margin-bottom: 6px; font-family: var(--font-display); font-weight: 600; }
		.login-brand .dot { color: var(--accent); }
		.login-form p { margin: 4px 0 14px; color: var(--text-muted); }
		.login-form input { width: 100%; }
		.login-form button { margin-top: 10px; width: 100%; }
		@media (max-width: 900px) {
			.menu-btn { display: inline-flex; }
			.shell-body { grid-template-columns: minmax(0, 1fr); }
			.sidebar { position: fixed; top: 0; bottom: 0; left: 0; width: min(80vw, 280px); transform: translateX(-100%); transition: transform var(--dur-2) var(--ease-out); z-index: 50; }
			.shell-body.nav-open .sidebar { transform: none; }
			.topbar { position: sticky; top: 0; z-index: 30; }
			.content { padding: var(--pad) var(--pad) 3rem; }
		}
		@media (min-width: 901px) { .backdrop { display: none; } }
		@media (max-width: 480px) { .brand .word { display: none; } .crumb { display: none; } }
		@media (prefers-reduced-motion: reduce) { .sidebar { transition: none; } }
	`];

	constructor() {
		super();
		this.session = null;
		this.loginToken = "";
		this.loginError = null;
		this.tab = (localStorage.getItem("baize.ui.v2.tab") as Tab) || "overview";
		this.navOpen = false;
		this.selectedId = 0;
		this.pendingGate = null;
		this.pendingApproval = false;
		this.createOpen = false;
	}

	connectedCallback(): void {
		super.connectedCallback();
		this.addEventListener("baize-goto", this.onGoto as EventListener);
		this.addEventListener("baize-open-requirement", this.onOpenRequirement as EventListener);
		this.addEventListener("baize-intent-consumed", this.onIntentConsumed as EventListener);
		void this.checkSession();
	}

	disconnectedCallback(): void {
		this.removeEventListener("baize-goto", this.onGoto as EventListener);
		this.removeEventListener("baize-open-requirement", this.onOpenRequirement as EventListener);
		this.removeEventListener("baize-intent-consumed", this.onIntentConsumed as EventListener);
		super.disconnectedCallback();
	}

	private async checkSession(): Promise<void> {
		try {
			this.session = await checkSession("");
		} catch {
			this.session = null;
		}
	}

	private async handleLogin(e: Event): Promise<void> {
		e.preventDefault();
		try {
			this.session = await bootstrapSession("", this.loginToken);
			this.loginError = null;
		} catch (err) {
			this.loginError = err instanceof Error ? err.message : String(err);
		}
	}

	private onGoto = (e: CustomEvent<{ tab: string; create?: boolean }>) => {
		this.goto(e.detail.tab as Tab);
		if (e.detail.create) this.createOpen = true;
	};

	private onOpenRequirement = (e: CustomEvent<{ id: number; gate?: string; approval?: boolean }>) => {
		this.selectedId = e.detail.id;
		this.pendingGate = e.detail.gate ?? null;
		this.pendingApproval = e.detail.approval ?? false;
		this.goto("detail");
	};

	private onIntentConsumed = () => {
		this.pendingGate = null;
		this.pendingApproval = false;
	};

	private goto(tab: Tab): void {
		this.tab = tab;
		this.navOpen = false;
		if (tab !== "requirements") this.createOpen = false;
		localStorage.setItem("baize.ui.v2.tab", tab);
	}

	render() {
		if (!this.session) {
			return html`<div class="login-wrap">
				<form class="card login-form" @submit=${(e: Event) => void this.handleLogin(e)}>
					<div class="login-brand"><span class="dot">◇</span> BaiZe Architect</div>
					<p>输入 Operator Token 建立会话。</p>
					<input type="password" placeholder="Operator Token" aria-label="Operator Token" .value=${this.loginToken} @input=${(e: Event) => (this.loginToken = (e.target as HTMLInputElement).value)} autocomplete="off" />
					<button class="primary" type="submit">登录</button>
					${this.loginError ? html`<div class="error">${this.loginError}</div>` : nothing}
				</form>
			</div>`;
		}

		const activeNav = this.tab === "detail" ? "requirements" : this.tab;
		return html`
		<div class="shell">
			<header class="topbar">
				<button class="menu-btn" aria-label="切换导航" aria-expanded=${this.navOpen ? "true" : "false"} @click=${() => (this.navOpen = !this.navOpen)}>☰</button>
				<span class="brand"><span class="dot">◇</span><span class="word"> BaiZe Architect</span></span>
				<div class="crumb">${TITLES[this.tab]}</div>
				<div class="top-actions"><span class="operator-badge">${this.session.actorRef}</span></div>
			</header>
			<div class="shell-body ${this.navOpen ? "nav-open" : ""}">
				${this.navOpen ? html`<div class="backdrop" @click=${() => (this.navOpen = false)}></div>` : nothing}
				<nav class="sidebar" aria-label="主导航">
					<div class="nav">
						<section class="nav-group" aria-label="导航">
							<div class="nav-label">导航</div>
							<div class="nav-stack">
								${NAV.map((item) => html`
									<button class="nav-item ${activeNav === item.id ? "active" : ""}" @click=${() => this.goto(item.id)}>
										<span class="nav-ico">${item.icon}</span><span class="nav-text">${item.label}</span>
									</button>`)}
							</div>
						</section>
					</div>
					<div class="status-foot">
						<div>自动优先的需求设计编排</div>
						<div>描述 → 设计 → 决策 → 批准 → 归档</div>
					</div>
				</nav>
				<main class="main">
					${this.tab === "overview" ? html`<div class="content"><baize-overview api-base="" workspace-id="1"></baize-overview></div>` : nothing}
					${this.tab === "requirements" ? html`<div class="content"><baize-requirements api-base="" workspace-id="1" ?create-open=${this.createOpen}></baize-requirements></div>` : nothing}
					${this.tab === "review" ? html`<div class="content"><baize-review-center api-base="" workspace-id="1"></baize-review-center></div>` : nothing}
					${this.tab === "assets" ? html`<div class="content"><baize-asset-library api-base="" workspace-id="1"></baize-asset-library></div>` : nothing}
					${this.tab === "detail" ? html`<baize-workflow api-base="" workspace-id="1" requirement-id=${this.selectedId} pending-gate=${this.pendingGate ?? ""} ?pending-approval=${this.pendingApproval}></baize-workflow>` : nothing}
				</main>
			</div>
		</div>`;
	}
}

customElements.define("baize-shell", BaizeShell);
