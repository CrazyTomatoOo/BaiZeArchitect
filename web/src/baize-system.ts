import { LitElement, html, css } from "lit";

/**
 * baize-system — 系统页(现代化):子 tab [证据可视化 | 设置]。
 * 证据可视化由架构浏览器提供;设置 = 模型配置入口(provider/modelId/apiKey → /api/config,保存即生效)。
 */
class BaizeSystem extends LitElement {
	static properties = {
		tab: { state: true },
		cfgProvider: { state: true },
		cfgModelId: { state: true },
		cfgApiKey: { state: true },
		cfgHasKey: { state: true },
		cfgSaved: { state: true },
		diagnostics: { state: true },
		statusLoading: { state: true },
		reindexing: { state: true },
		statusMessage: { state: true },
	};

	declare tab: "status" | "settings";
	declare cfgProvider: string;
	declare cfgModelId: string;
	declare cfgApiKey: string;
	declare cfgHasKey: boolean;
	declare cfgSaved: string;
	declare diagnostics: {
		ok: boolean;
		checkedAt: string;
		server: { sseClients: number };
		model: { provider: string; modelId: string; hasKey: boolean };
		workspaces: Array<{ id: number; name: string }>;
		evidenceRepositories: string[];
		geneCount: number;
		gitnexus: { available: boolean; version?: string };
	} | null;
	declare statusLoading: boolean;
	declare reindexing: boolean;
	declare statusMessage: string;
	static styles = css`
		:host {
			display: block;
		}
		.page-head h1 {
			margin: 0;
			font-size: 1.4rem;
			font-family: var(--font-display);
			font-weight: 600;
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
			background: var(--accent-hi);
		}
		.saved {
			margin-left: 10px;
			color: var(--ok);
			font-size: 0.8rem;
		}
		.status-grid {
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
			gap: var(--gap);
		}
		.status-card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 16px;
		}
		.status-card h3 { margin: 0 0 10px; font-size: 0.95rem; }
		.status-row { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid var(--border); font-size: 0.82rem; }
		.status-row:last-child { border-bottom: 0; }
		.status-ok { color: var(--ok); }
		.status-warn { color: var(--warn); }
		.status-muted { color: var(--text-muted); }
		.status-action { margin-top: 14px; }
		.status-message { margin-left: 10px; color: var(--text-muted); font-size: 0.8rem; }
		.status-loading { color: var(--text-muted); }
	`;

	constructor() {
		super();
		this.tab = "status";
		this.cfgProvider = "";
		this.cfgModelId = "";
		this.cfgApiKey = "";
		this.cfgHasKey = false;
		this.cfgSaved = "";
		this.diagnostics = null;
		this.statusLoading = false;
		this.reindexing = false;
		this.statusMessage = "";
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		await this.loadConfig();
		await this.loadStatus();
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

	async loadStatus(): Promise<void> {
		this.statusLoading = true;
		try {
			this.diagnostics = (await (await fetch("/api/system/status")).json()) as typeof this.diagnostics;
		} catch {
			this.statusMessage = "状态加载失败";
		} finally {
			this.statusLoading = false;
		}
	}

	async reindex(): Promise<void> {
		const workspaceId = Number(new URLSearchParams(location.search).get("workspace") ?? 0);
		if (!workspaceId) {
			this.statusMessage = "请先选择工作区";
			return;
		}
		this.reindexing = true;
		this.statusMessage = "正在启动重新索引…";
		try {
			const res = await fetch("/api/system/reindex", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ workspaceId }),
			});
			const body = (await res.json()) as { status?: string; error?: string };
			this.statusMessage = res.ok ? "已启动重新索引,完成后刷新状态" : body.error ?? "重新索引失败";
		} catch {
			this.statusMessage = "重新索引请求失败";
		} finally {
			this.reindexing = false;
			await this.loadStatus();
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
	private renderStatus() {
		const d = this.diagnostics;
		if (this.statusLoading && !d) return html`<div class="status-loading">正在读取系统状态…</div>`;
		const gitnexusOk = d?.gitnexus.available ?? false;
		return html`<div class="status-grid">
			<div class="status-card">
				<h3>运行状态</h3>
				<div class="status-row"><span>网关</span><strong class="status-ok">${d?.ok ? "正常" : "未知"}</strong></div>
				<div class="status-row"><span>SSE 连接</span><span>${d?.server.sseClients ?? 0} 个</span></div>
				<div class="status-row"><span>模型</span><span>${d?.model.provider ?? "—"} / ${d?.model.modelId ?? "—"}</span></div>
				<div class="status-row"><span>API Key</span><strong class=${d?.model.hasKey ? "status-ok" : "status-warn"}>${d?.model.hasKey ? "已配置" : "未配置"}</strong></div>
			</div>
			<div class="status-card">
				<h3>索引与资产</h3>
				<div class="status-row"><span>工作区</span><span>${d?.workspaces.length ?? 0} 个</span></div>
				<div class="status-row"><span>证据索引</span><span>${d?.evidenceRepositories.length ?? 0} 个仓库</span></div>
				<div class="status-row"><span>经验 gene</span><span>${d?.geneCount ?? 0} 条</span></div>
				<div class="status-row"><span>GitNexus</span><strong class=${gitnexusOk ? "status-ok" : "status-warn"}>${gitnexusOk ? `可用 ${d?.gitnexus.version ?? ""}` : "不可用"}</strong></div>
				<div class="status-action"><button class="btn" ?disabled=${this.reindexing} @click=${() => this.reindex()}>${this.reindexing ? "启动中…" : "手动重新索引"}</button><span class="status-message">${this.statusMessage}</span></div>
			</div>
		</div>`;
	}

	private renderSettings() {
		return html`<div class="card">
			<h3>模型配置</h3>
			<p class="desc">新增需求/阶段流水线调用 LLM 时使用此配置。保存后立即生效(无需重启)。</p>
			<div class="field">
				<label>Provider(如 bailian)</label>
				<input .value=${this.cfgProvider} @input=${(e: Event) => (this.cfgProvider = (e.target as HTMLInputElement).value)} />
			</div>
			<div class="field">
				<label>模型 ID(如 glm-5.2 / qwen-max)</label>
				<input .value=${this.cfgModelId} @input=${(e: Event) => (this.cfgModelId = (e.target as HTMLInputElement).value)} />
			</div>
			<div class="field">
				<label>API Key(留空保持现有)</label>
				<input type="password" placeholder=${this.cfgHasKey ? "已配置(留空不变)" : "未配置,必填"} .value=${this.cfgApiKey} @input=${(e: Event) => (this.cfgApiKey = (e.target as HTMLInputElement).value)} />
				<div class="key-state ${this.cfgHasKey ? "ok" : "missing"}">${this.cfgHasKey ? "● API Key 已配置" : "● 缺少 API Key(新增需求会报错)"}</div>
			</div>
			<button class="btn" @click=${() => this.saveConfig()}>保存配置</button><span class="saved">${this.cfgSaved}</span>
		</div>`;
	}

	render() {
		return html`
			<header class="page-head">
				<h1>系统</h1>
				<p class="sub">运行状态诊断、索引管理与模型配置</p>
			</header>
			<div class="tabs">
				<button class="tab ${this.tab === "status" ? "active" : ""}" @click=${() => (this.tab = "status")}>状态诊断</button>
				<button class="tab ${this.tab === "settings" ? "active" : ""}" @click=${() => (this.tab = "settings")}>设置</button>
			</div>
			${this.tab === "status" ? this.renderStatus() : this.renderSettings()}
		`;
	}
}

customElements.define("baize-system", BaizeSystem);
