import { LitElement, html, css } from "lit";
import "./baize-dashboard.ts";

/**
 * baize-system — 系统页(现代化):子 tab [证据可视化 | 设置]。
 * 证据可视化 = 收编旧 baize-dashboard;设置 = 模型配置入口(provider/modelId/apiKey → /api/config,保存即生效)。
 */
class BaizeSystem extends LitElement {
	static properties = {
		tab: { state: true },
		cfgProvider: { state: true },
		cfgModelId: { state: true },
		cfgApiKey: { state: true },
		cfgHasKey: { state: true },
		cfgSaved: { state: true },
	};

	declare tab: "evidence" | "settings";
	declare cfgProvider: string;
	declare cfgModelId: string;
	declare cfgApiKey: string;
	declare cfgHasKey: boolean;
	declare cfgSaved: string;

	static styles = css`
		:host {
			display: block;
		}
		.page-head h1 {
			margin: 0;
			font-size: 1.4rem;
			font-weight: 650;
			letter-spacing: -0.01em;
		}
		.page-head .sub {
			margin: 4px 0 20px;
			color: var(--text-muted);
			font-size: 0.88rem;
		}
		.tabs {
			display: flex;
			gap: 4px;
			margin-bottom: 20px;
			border-bottom: 1px solid var(--border);
		}
		.tab {
			padding: 9px 18px;
			background: transparent;
			border: none;
			border-bottom: 2px solid transparent;
			color: var(--text-muted);
			cursor: pointer;
			font: inherit;
			font-size: 0.88rem;
			transition: color 0.2s, border-color 0.2s;
		}
		.tab:hover {
			color: var(--text);
		}
		.tab.active {
			color: var(--accent);
			border-bottom-color: var(--accent);
			font-weight: 600;
		}
		.card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 20px;
			max-width: 560px;
		}
		.card h3 {
			margin: 0 0 6px;
			font-size: 1rem;
			font-weight: 600;
		}
		.card .desc {
			margin: 0 0 16px;
			color: var(--text-muted);
			font-size: 0.84rem;
			line-height: 1.6;
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
		.field input {
			display: block;
			width: 100%;
			box-sizing: border-box;
			background: var(--bg);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: var(--radius-sm);
			padding: 8px 10px;
			font: inherit;
			font-size: 0.85rem;
			transition: border-color 0.2s;
		}
		.field input:focus {
			outline: none;
			border-color: var(--accent);
		}
		.key-state {
			font-size: 0.76rem;
			margin-top: 4px;
		}
		.key-state.ok {
			color: var(--ok);
		}
		.key-state.missing {
			color: var(--danger);
		}
		.btn {
			background: var(--accent);
			color: var(--accent-fg);
			border: none;
			border-radius: var(--radius-sm);
			padding: 8px 18px;
			font: inherit;
			font-size: 0.86rem;
			font-weight: 600;
			cursor: pointer;
			transition: background 0.2s;
		}
		.btn:hover {
			background: var(--info);
		}
		.saved {
			margin-left: 10px;
			color: var(--ok);
			font-size: 0.8rem;
		}
	`;

	constructor() {
		super();
		this.tab = "evidence";
		this.cfgProvider = "";
		this.cfgModelId = "";
		this.cfgApiKey = "";
		this.cfgHasKey = false;
		this.cfgSaved = "";
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		await this.loadConfig();
	}

	async loadConfig(): Promise<void> {
		try {
			const c = (await (await fetch("/api/config")).json()) as {
				provider: string;
				modelId: string;
				hasKey: boolean;
			};
			this.cfgProvider = c.provider;
			this.cfgModelId = c.modelId;
			this.cfgHasKey = c.hasKey;
		} catch {
			this.cfgSaved = "加载配置失败";
		}
	}

	async saveConfig(): Promise<void> {
		await fetch("/api/config", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				provider: this.cfgProvider,
				modelId: this.cfgModelId,
				apiKey: this.cfgApiKey || undefined,
			}),
		});
		this.cfgSaved = "已保存,立即生效";
		this.cfgApiKey = "";
		await this.loadConfig();
	}

	render() {
		return html`
			<header class="page-head">
				<h1>系统</h1>
				<p class="sub">证据可视化与模型配置</p>
			</header>
			<div class="tabs">
				<button
					class="tab ${this.tab === "evidence" ? "active" : ""}"
					@click=${() => (this.tab = "evidence")}
				>
					证据可视化
				</button>
				<button
					class="tab ${this.tab === "settings" ? "active" : ""}"
					@click=${() => (this.tab = "settings")}
				>
					设置
				</button>
			</div>
			${
				this.tab === "evidence"
					? html`<baize-dashboard></baize-dashboard>`
					: html`<div class="card">
						<h3>模型配置</h3>
						<p class="desc">
							新增需求/阶段流水线调用 LLM 时使用此配置。保存后立即生效(无需重启)。
						</p>
						<div class="field">
							<label>Provider(如 bailian)</label>
							<input
								.value=${this.cfgProvider}
								@input=${(e: Event) =>
									(this.cfgProvider = (e.target as HTMLInputElement).value)}
							/>
						</div>
						<div class="field">
							<label>模型 ID(如 glm-5.2 / qwen-max)</label>
							<input
								.value=${this.cfgModelId}
								@input=${(e: Event) =>
									(this.cfgModelId = (e.target as HTMLInputElement).value)}
							/>
						</div>
						<div class="field">
							<label>API Key(留空保持现有)</label>
							<input
								type="password"
								placeholder=${this.cfgHasKey ? "已配置(留空不变)" : "未配置,必填"}
								.value=${this.cfgApiKey}
								@input=${(e: Event) =>
									(this.cfgApiKey = (e.target as HTMLInputElement).value)}
							/>
							<div class="key-state ${this.cfgHasKey ? "ok" : "missing"}">
								${this.cfgHasKey ? "● API Key 已配置" : "● 缺少 API Key(新增需求会报错)"}
							</div>
						</div>
						<button class="btn" @click=${() => this.saveConfig()}>保存配置</button>
						<span class="saved">${this.cfgSaved}</span>
					</div>`
			}
		`;
	}
}

customElements.define("baize-system", BaizeSystem);
