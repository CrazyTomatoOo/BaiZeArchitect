import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import { loadRequirementViews, type RequirementView } from "./baize-data.js";
import { MODEL_ROLE_GROUPS, MODEL_ROLE_KEYS, ROLE_LABELS, customizedRoleCount, findModel, modelSpecLabel } from "./model-profiles.js";
import {
	createRequirement,
	getModelConfig,
	stateLabel,
	type ModelConfig,
	type ModelProfile,
	type ModelRoleKey,
} from "./workflow-client.js";

const INITIAL_CUSTOMIZED = Object.fromEntries(MODEL_ROLE_KEYS.map((role) => [role, false])) as Record<ModelRoleKey, boolean>;

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
		.create { margin-top: var(--gap); display: flex; flex-direction: column; gap: 8px; }

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
		.picker-status {
			display: flex;
			align-items: baseline;
			gap: var(--gap);
			flex-wrap: wrap;
			margin-top: 6px;
			font-size: var(--text-xs);
			color: var(--text-muted);
		}
		.picker-status .count {
			font-family: var(--font-mono);
			font-variant-numeric: tabular-nums;
			color: var(--accent);
		}
		.picker-table { width: 100%; }
		.picker-table th { font-size: var(--text-xs); }
		.picker-table td { vertical-align: middle; }
		.picker-table select { width: 100%; min-width: 140px; }
		.picker-group td {
			padding: var(--gap) 0 4px;
			font-size: var(--text-xs);
			letter-spacing: 0.06em;
			color: var(--text-subtle);
		}
		.role-name { font-weight: 500; }
		.role-inherited {
			margin-left: var(--radius-sm);
			color: var(--text-subtle);
			font-size: var(--text-xs);
		}
		.model-meta {
			margin-top: 4px;
			color: var(--text-subtle);
			font-size: var(--text-xs);
			font-family: var(--font-mono);
			font-variant-numeric: tabular-nums;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			max-width: 100%;
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
			"analysis-analyst": { provider: "", modelId: "" },
			"scenario-analyst": { provider: "", modelId: "" },
			"usecase-analyst": { provider: "", modelId: "" },
			"function-analyst": { provider: "", modelId: "" },
			"design-architect": { provider: "", modelId: "" },
			"architecture-architect": { provider: "", modelId: "" },
			"data-architect": { provider: "", modelId: "" },
			"api-architect": { provider: "", modelId: "" },
			critic: { provider: "", modelId: "" },
		};
		this.customized = {
			"analysis-analyst": false,
			"scenario-analyst": false,
			"usecase-analyst": false,
			"function-analyst": false,
			"design-architect": false,
			"architecture-architect": false,
			"data-architect": false,
			"api-architect": false,
			critic: false,
		};
	}

	connectedCallback(): void {
		super.connectedCallback();
		void this.load();
		void this.loadModelConfig();
	}

	override updated(changed: Map<string, unknown>): void {
		super.updated(changed);
		if (changed.has("workspaceId") && this.workspaceId > 0) {
			void this.load();
		}
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
			this.customized = { ...INITIAL_CUSTOMIZED };
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
	/** 列表卡模型档徽标:存在需求级自定义时显示,否则不占位。 */
	private renderModelBadge(v: RequirementView) {
		if (!this.modelConfig) return nothing;
		const count = customizedRoleCount(v.projection.workflow.modelRoles, this.modelConfig.defaultRoles);
		return count > 0 ? html`<span class="badge" data-testid="model-badge-${v.id}">模型档 ${count}/${MODEL_ROLE_KEYS.length}</span>` : nothing;
	}

	private restoreDefaults(): void {
		if (!this.modelConfig) return;
		this.modelRoles = { ...this.modelConfig.defaultRoles };
		this.customized = { ...INITIAL_CUSTOMIZED };
	}

	private anyCustomized(): boolean {
		return MODEL_ROLE_KEYS.some((role) => this.customized[role]);
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
				this.customized = { ...INITIAL_CUSTOMIZED };
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
		const count = MODEL_ROLE_KEYS.filter((role) => this.customized[role]).length;
		return html`
			<div class="model-picker" data-testid="model-picker">
				<div class="picker-header">
					<span class="title">模型档</span>
					<span class="spacer"></span>
					<button type="button" ?disabled=${count === 0} @click=${() => this.restoreDefaults()}>恢复部署默认</button>
				</div>
				<div class="picker-status">
					<span class="count" data-testid="model-custom-count">${count}/${MODEL_ROLE_KEYS.length} 需求级自定义</span>
					<span>· 缺省 = 部署默认档</span>
					<span>· 创建后不可改</span>
				</div>
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
						${MODEL_ROLE_GROUPS.map(
							(group) => html`<tr class="picker-group" data-testid="picker-group-${group.label}"><td colspan="4">${group.label}</td></tr>
								${group.roles.map((role) => this.renderModelRow(role))}`,
						)}
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
						${models.map((m) => html`<option value=${m.id}>${m.name}</option>`)}
					</select>
					<div class="model-meta" data-testid="model-meta-${role}">${modelSpecLabel(findModel(this.modelConfig, selected))}</div>
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
									${this.renderModelBadge(v)}
									<span class="badge" data-tone=${v.state === "archived" ? "ok" : v.state === "failed" ? "bad" : "accent"}>${stateLabel(v.state)}</span>
								</button>`)}
						</div>`}
		`;
	}
}

customElements.define("baize-requirements", BaizeRequirements);
