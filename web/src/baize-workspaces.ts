import { LitElement, html, css } from "lit";

/** T03 工作区管理:1 repo = 1 workspace。现代化布局:页面头 + 空态 hero + 工作区卡片 + 新建表单。 */
interface Ws {
	id: number;
	repo_path: string;
	name: string;
}

const folderSvg = html`<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

class BaizeWorkspaces extends LitElement {
	static properties = {
		list: { state: true },
		repoPath: { state: true },
		name: { state: true },
	};

	declare list: Ws[];
	declare repoPath: string;
	declare name: string;

	static styles = css`
		:host {
			display: block;
		}
		.page {
			max-width: 720px;
		}
		.page-head h1 {
			margin: 0;
			font-size: 1.4rem;
			font-weight: 650;
			letter-spacing: -0.01em;
		}
		.page-head .sub {
			margin: 4px 0 24px;
			color: var(--text-muted);
			font-size: 0.88rem;
		}
		/* 空态 hero */
		.empty {
			display: flex;
			flex-direction: column;
			align-items: center;
			text-align: center;
			padding: 48px 24px;
		}
		.empty-icon {
			color: var(--accent);
			opacity: 0.8;
			margin-bottom: 16px;
		}
		.empty h2 {
			margin: 0 0 8px;
			font-size: 1.15rem;
			font-weight: 600;
		}
		.empty > p {
			margin: 0 0 24px;
			color: var(--text-muted);
			font-size: 0.88rem;
			max-width: 380px;
			line-height: 1.6;
		}
		/* 表单卡片 */
		.form-card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 20px;
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
		}
		.form-card.hero {
			width: 100%;
			max-width: 460px;
			text-align: left;
		}
		.form-card h3 {
			margin: 0 0 16px;
			font-size: 0.95rem;
			font-weight: 600;
		}
		.field {
			margin-bottom: 14px;
		}
		.field label {
			display: block;
			margin-bottom: 6px;
			font-size: 0.78rem;
			font-weight: 500;
			color: var(--text-muted);
		}
		input {
			display: block;
			width: 100%;
			box-sizing: border-box;
			background: var(--bg);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: var(--radius-sm);
			padding: 9px 11px;
			font: inherit;
			font-size: 0.86rem;
			transition: border-color 0.2s, box-shadow 0.2s;
		}
		input::placeholder {
			color: var(--text-subtle);
		}
		input:focus {
			outline: none;
			border-color: var(--accent);
			box-shadow: 0 0 0 3px rgba(124, 140, 255, 0.15);
		}
		.btn {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: 6px;
			background: var(--accent);
			color: var(--accent-fg);
			border: none;
			border-radius: var(--radius-sm);
			padding: 9px 18px;
			font: inherit;
			font-size: 0.86rem;
			font-weight: 600;
			cursor: pointer;
			transition: background 0.2s, transform 0.1s;
		}
		.btn:hover {
			background: var(--info);
		}
		.btn:active {
			transform: scale(0.97);
		}
		/* 工作区列表 */
		.list {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 14px;
			margin-bottom: 20px;
		}
		.ws-card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 16px;
			cursor: default;
			transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
		}
		.ws-card:hover {
			border-color: var(--border-strong);
			box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
			transform: translateY(-2px);
		}
		.ws-top {
			display: flex;
			align-items: baseline;
			gap: 8px;
			margin-bottom: 8px;
		}
		.ws-name {
			font-weight: 600;
			font-size: 0.95rem;
		}
		.ws-id {
			color: var(--text-subtle);
			font-family: var(--font-mono);
			font-size: 0.72rem;
		}
		.ws-path {
			color: var(--text-muted);
			font-family: var(--font-mono);
			font-size: 0.76rem;
			word-break: break-all;
			line-height: 1.5;
		}
	`;

	constructor() {
		super();
		this.list = [];
		this.repoPath = "";
		this.name = "";
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		await this.load();
	}

	async load(): Promise<void> {
		this.list = (await (await fetch("/api/workspaces")).json()) as Ws[];
	}

	async add(): Promise<void> {
		if (!this.repoPath) return;
		await fetch("/api/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				repoPath: this.repoPath,
				name: this.name || this.repoPath.split("/").pop(),
			}),
		});
		this.repoPath = "";
		this.name = "";
		await this.load();
		this.dispatchEvent(new CustomEvent("baize-workspaces-changed", { bubbles: true, composed: true }));
	}

	private renderForm(mode: "hero" | "card") {
		return html`
			<div class="form-card ${mode}">
				<h3>${mode === "hero" ? "新建工作区" : "添加工作区"}</h3>
				<form
					@submit=${(e: Event) => {
						e.preventDefault();
						this.add();
					}}
				>
					<div class="field">
						<label>仓库路径</label>
						<input
							placeholder="/Volumes/.../lws"
							.value=${this.repoPath}
							@input=${(e: Event) =>
								(this.repoPath = (e.target as HTMLInputElement).value)}
						/>
					</div>
					<div class="field">
						<label>名称(可选,默认取目录名)</label>
						<input
							placeholder="lws"
							.value=${this.name}
							@input=${(e: Event) => (this.name = (e.target as HTMLTextAreaElement).value)}
						/>
					</div>
					<button class="btn">创建工作区</button>
				</form>
			</div>
		`;
	}

	render() {
		const empty = this.list.length === 0;
		return html`
			<div class="page">
				<header class="page-head">
					<h1>工作区</h1>
					<p class="sub">每个工作区对应一个代码仓库,是需求设计的载体</p>
				</header>
				${empty
					? html`<div class="empty">
							<div class="empty-icon">${folderSvg}</div>
							<h2>创建工作区开始设计</h2>
							<p>一个工作区 = 一个代码仓库。创建后,即可在其中录入需求并驱动设计流水线。</p>
							${this.renderForm("hero")}
						</div>`
					: html`<div class="list">
								${this.list.map(
									(w) => html`<div class="ws-card">
										<div class="ws-top">
											<span class="ws-name">${w.name}</span>
											<span class="ws-id">#${w.id}</span>
										</div>
										<div class="ws-path">${w.repo_path}</div>
									</div>`,
								)}
							</div>
							${this.renderForm("card")}`}
			</div>
		`;
	}
}

customElements.define("baize-workspaces", BaizeWorkspaces);
