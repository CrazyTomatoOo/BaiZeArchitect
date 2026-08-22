import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import { loadRequirementViews, type RequirementView } from "./baize-data.js";
import {
	createRequirement,
	getModelConfig,
	stateLabel,
	type ModelConfig,
	type ModelProfile,
	type ModelRoleKey,
} from "./workflow-client.js";

const ROLE_KEYS: readonly ModelRoleKey[] = ["orchestrator", "analyst", "architect", "critic"];

const ROLE_LABELS: Record<ModelRoleKey, string> = {
	orchestrator: "编排者",
	analyst: "分析者",
	architect: "架构者",
	critic: "评审者",
};

/** baize-requirements — 需求列表 + 新建。点击卡片进入旅程式详情。 */
class BaizeRequirements extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		createOpen: { type: Boolean, attribute: "create-open" },
		views: { state: true },
		loading: { state: true },
		error: { state: true },
		title: { state: true },
		summary: { state: true },
		description: { state: true },
		creating: { state: true },
		modelConfig: { state: true },
		modelConfigLoading: { state: true },
		modelConfigError: { state: true },
		modelRoles: { state: true },
		customized: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare createOpen: boolean;
	declare views: RequirementView[];
	declare loading: boolean;
	declare error: string | null;
	declare title: string;
	declare summary: string;
	declare description: string;
	declare creating: boolean;
	declare modelConfig: ModelConfig | null;
	declare modelConfigLoading: boolean;
	declare modelConfigError: string | null;
	declare modelRoles: Record<ModelRoleKey, ModelProfile>;
	declare customized: Record<ModelRoleKey, boolean>;

	static styles = [sharedStyles, css`
		.head { display: flex; align-items: center; gap: 12px; }
		.head .spacer { flex: 1; }
		.list { margin-top: var(--gap); display: grid; gap: var(--gap); }
		.item { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; cursor: pointer; }
		.item .title { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.item .grow { flex: 1; min-width: 0; }
		.create { margin-top: var(--gap); display: flex; flex-direction: column; gap: 8px; max-width: 720px; }

		.model-picker {
			margin-top: var(--gap);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: var(--pad);
			background: var(--surface);
		}
		.picker-header {
			display: flex;
			align-items: center;
			gap: 12px;
			flex-wrap: wrap;
		}
		.picker-header .title { font-weight: 600; font-size: var(--text-sm); }
		.picker-header .status {
			display: flex;
			align-items: center;
			gap: var(--gap);
			flex-wrap: wrap;
			font-size: var(--text-sm);
			color: var(--text-muted);
		}
		.picker-header .count {
			font-family: var(--font-mono);
			color: var(--accent);
		}
		.picker-header .default-profile {
			color: var(--text-subtle);
		}
		.picker-hint {
			margin: var(--gap) 0;
			color: var(--text-subtle);
			font-size: var(--text-xs);
		}
		.picker-table { width: 100%; }
		.picker-table th { font-size: var(--text-xs); }
		.picker-table td { vertical-align: middle; }
		.picker-table select { width: 100%; min-width: 140px; }
		.role-name { font-weight: 500; }
		.role-inherited {
			margin-left: var(--radius-sm);
			color: var(--text-subtle);
			font-size: var(--text-xs);
		}
		.model-meta {
			color: var(--text-subtle);
			font-size: var(--text-xs);
		}
		@media (max-width: 640px) {
			.picker-table th, .picker-table td { padding: var(--radius-sm) var(--radius-sm); }
			.picker-table select { min-width: 0; }
		}
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 1;
		this.createOpen = false;
		this.views = [];
		this.loading = true;
		this.error = null;
		this.title = "";
		this.summary = "";
		this.description = "";
		this.creating = false;
		this.modelConfig = null;
		this.modelConfigLoading = false;
		this.modelConfigError = null;
		this.modelRoles = {
			orchestrator: { provider: "", modelId: "" },
			analyst: { provider: "", modelId: "" },
			architect: { provider: "", modelId: "" },
			critic: { provider: "", modelId: "" },
		};
		this.customized = {
			orchestrator: false,
			analyst: false,
			architect: false,
			critic: false,
		};
	}

	connectedCallback(): void {
		super.connectedCallback();
		void this.load();
		void this.loadModelConfig();
	}

	private async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			this.views = await loadRequirementViews(this.apiBase, this.workspaceId);
		} catch (e) {
			this.error = e instanceof Error ? e.message : String(e);
		} finally {
			this.loading = false;
		}
	}

	private async loadModelConfig(): Promise<void> {
		this.modelConfigLoading = true;
		this.modelConfigError = null;
		try {
			const config = await getModelConfig(this.apiBase);
			this.modelConfig = config;
			this.modelRoles = { ...config.defaultRoles };
			this.customized = { orchestrator: false, analyst: false, architect: false, critic: false };
		} catch (e) {
			this.modelConfigError = e instanceof Error ? e.message : String(e);
		} finally {
			this.modelConfigLoading = false;
		}
	}

	private onProviderChange(role: ModelRoleKey, providerId: string): void {
		const provider = this.modelConfig?.providers.find((p) => p.id === providerId);
		const modelId = provider?.models[0]?.id ?? "";
		this.modelRoles = { ...this.modelRoles, [role]: { provider: providerId, modelId } };
		this.customized = { ...this.customized, [role]: true };
	}

	private onModelChange(role: ModelRoleKey, modelId: string): void {
		this.modelRoles = { ...this.modelRoles, [role]: { ...this.modelRoles[role], modelId } };
		this.customized = { ...this.customized, [role]: true };
	}

	private resetRole(role: ModelRoleKey): void {
		if (!this.modelConfig) return;
		this.modelRoles = { ...this.modelRoles, [role]: this.modelConfig.defaultRoles[role] };
		this.customized = { ...this.customized, [role]: false };
	}

	private restoreDefaults(): void {
		if (!this.modelConfig) return;
		this.modelRoles = { ...this.modelConfig.defaultRoles };
		this.customized = { orchestrator: false, analyst: false, architect: false, critic: false };
	}

	private anyCustomized(): boolean {
		return ROLE_KEYS.some((role) => this.customized[role]);
	}

	private async handleCreate(e: Event): Promise<void> {
		e.preventDefault();
		this.creating = true;
		this.error = null;
		try {
			const input: { title: string; summary: string; description: string; modelRoles?: Record<ModelRoleKey, ModelProfile> } = {
				title: this.title,
				summary: this.summary,
				description: this.description,
			};
			if (this.anyCustomized()) {
				input.modelRoles = { ...this.modelRoles };
			}
			const created = await createRequirement(this.apiBase, this.workspaceId, input);
			this.title = "";
			this.summary = "";
			this.description = "";
			if (this.modelConfig) {
				this.modelRoles = { ...this.modelConfig.defaultRoles };
				this.customized = { orchestrator: false, analyst: false, architect: false, critic: false };
			}
			this.createOpen = false;
			this.dispatchEvent(new CustomEvent("baize-open-requirement", { detail: { id: created.requirementId }, bubbles: true, composed: true }));
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.creating = false;
		}
	}

	private renderModelPicker() {
		if (!this.modelConfig) {
			if (this.modelConfigLoading) return html`<div class="model-picker">加载模型档…</div>`;
			if (this.modelConfigError) return html`<div class="model-picker error">模型档加载失败: ${this.modelConfigError}</div>`;
			return nothing;
		}
		const defaults = this.modelConfig.defaultRoles;
		const count = ROLE_KEYS.filter((role) => this.customized[role]).length;
		return html`
			<div class="model-picker" data-testid="model-picker">
				<div class="picker-header">
					<span class="title">执行模型档</span>
					<span class="status">
						<span class="count" data-testid="model-custom-count">有效模型档 · ${count}/4 自定义</span>
						<span class="default-profile mono">默认档 ${defaults.orchestrator.provider} / ${defaults.orchestrator.modelId}</span>
					</span>
					<span class="spacer"></span>
					<button type="button" ?disabled=${count === 0} @click=${() => this.restoreDefaults()}>恢复默认档</button>
				</div>
				<div class="picker-hint">创建后不可改 · 缺省 = 部署默认档</div>
				<table class="picker-table">
					<thead>
						<tr>
							<th>角色</th>
							<th>提供方</th>
							<th>模型</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						${ROLE_KEYS.map((role) => this.renderModelRow(role))}
					</tbody>
				</table>
			</div>
		`;
	}

	private renderModelRow(role: ModelRoleKey) {
		const config = this.modelConfig!;
		const selected = this.modelRoles[role];
		const provider = config.providers.find((p) => p.id === selected.provider);
		const isCustom = this.customized[role];
		const models = provider?.models ?? [];
		return html`
			<tr data-testid="model-row-${role}" data-custom=${isCustom}>
				<td>
					<span class="role-name">${ROLE_LABELS[role]}</span>
					${!isCustom ? html`<span class="role-inherited">默认</span>` : nothing}
				</td>
				<td>
					<select
						data-testid="model-provider-${role}"
						.value=${selected.provider}
						@change=${(e: Event) => this.onProviderChange(role, (e.target as HTMLSelectElement).value)}
					>
						${config.providers.map((p) => html`<option value=${p.id}>${p.name}</option>`)}
					</select>
				</td>
				<td>
					<select
						data-testid="model-select-${role}"
						.value=${selected.modelId}
						@change=${(e: Event) => this.onModelChange(role, (e.target as HTMLSelectElement).value)}
					>
						${models.map((m) => html`<option value=${m.id}>${m.name} · ${m.contextWindow.toLocaleString()} ctx · ${m.maxTokens.toLocaleString()} tok${m.reasoning ? " · thinking" : ""}</option>`)}
					</select>
				</td>
				<td>
					<button type="button" ?disabled=${!isCustom} @click=${() => this.resetRole(role)}>重置</button>
				</td>
			</tr>
		`;
	}

	render() {
		return html`
			<div class="page-head head">
				<div><h1>需求</h1><p class="sub">每个需求都会建立一条自动设计工作流。</p></div>
				<span class="spacer"></span>
				<button class="primary" @click=${() => (this.createOpen = !this.createOpen)}>${this.createOpen ? "收起" : "＋ 新建需求"}</button>
			</div>

			${this.createOpen
				? html`<form class="card create" @submit=${(e: Event) => void this.handleCreate(e)}>
						<h3>创建新需求</h3>
						<input type="text" placeholder="标题" .value=${this.title} @input=${(e: Event) => (this.title = (e.target as HTMLInputElement).value)} required />
						<input type="text" placeholder="一句话摘要" .value=${this.summary} @input=${(e: Event) => (this.summary = (e.target as HTMLInputElement).value)} required />
						<textarea placeholder="详细描述:目标、边界、约束" .value=${this.description} @input=${(e: Event) => (this.description = (e.target as HTMLTextAreaElement).value)} rows="4" required></textarea>
						${this.renderModelPicker()}
						<div class="command-row"><button class="primary" type="submit" ?disabled=${this.creating}>${this.creating ? "创建中…" : "创建需求并开始设计"}</button></div>
						${this.error ? html`<div class="error" data-testid="create-error">${this.error}</div>` : nothing}
					</form>`
				: nothing}

			${this.loading
				? html`<div class="empty">加载中…</div>`
				: this.views.length === 0
					? html`<div class="card" style="margin-top:var(--gap)"><div class="empty">还没有需求。点击「新建需求」,描述你想要设计的功能,系统会自动规划、分析、设计并评审,在关键节点请你决策。</div></div>`
					: html`<div class="list">
							${this.views.map((v) => html`
								<button class="card item" @click=${() => this.dispatchEvent(new CustomEvent("baize-open-requirement", { detail: { id: v.id }, bubbles: true, composed: true }))}>
									<div class="grow">
										<div class="title">需求 ${v.id} · ${v.title}</div>
										<div class="journey" style="margin-top:6px">
											${v.stages.map((s, i) => html`${i > 0 ? html`<span class="step-link ${v.stages[i - 1]!.status === "done" ? "done" : ""}"></span>` : nothing}<span class="step" data-status=${s.status}><span class="dot">${s.status === "done" ? "✓" : i + 1}</span><span class="name">${s.label}</span></span>`)}
										</div>
									</div>
									${v.gates.length > 0 ? html`<span class="badge" data-tone="warn">${v.gates.length} 待处理</span>` : nothing}
									<span class="badge" data-tone=${v.state === "archived" ? "ok" : v.state === "failed" ? "bad" : "accent"}>${stateLabel(v.state)}</span>
								</button>`)}
						</div>`}
		`;
	}
}

customElements.define("baize-requirements", BaizeRequirements);
