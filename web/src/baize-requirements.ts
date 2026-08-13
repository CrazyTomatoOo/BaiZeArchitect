import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import { loadRequirementViews, type RequirementView } from "./baize-data.js";
import { createRequirement, stateLabel } from "./workflow-client.js";

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

	static styles = [sharedStyles, css`
		.head { display: flex; align-items: center; gap: 12px; }
		.head .spacer { flex: 1; }
		.list { margin-top: var(--gap); display: grid; gap: var(--gap); }
		.item { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; cursor: pointer; }
		.item .title { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.item .grow { flex: 1; min-width: 0; }
		.create { margin-top: var(--gap); display: flex; flex-direction: column; gap: 8px; max-width: 520px; }
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
	}

	connectedCallback(): void {
		super.connectedCallback();
		void this.load();
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

	private async handleCreate(e: Event): Promise<void> {
		e.preventDefault();
		this.creating = true;
		this.error = null;
		try {
			const created = await createRequirement(this.apiBase, this.workspaceId, {
				title: this.title,
				summary: this.summary,
				description: this.description,
			});
			this.title = "";
			this.summary = "";
			this.description = "";
			this.createOpen = false;
			this.dispatchEvent(new CustomEvent("baize-open-requirement", { detail: { id: created.requirementId }, bubbles: true, composed: true }));
		} catch (err) {
			this.error = err instanceof Error ? err.message : String(err);
		} finally {
			this.creating = false;
		}
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
						<div class="command-row"><button class="primary" type="submit" ?disabled=${this.creating}>${this.creating ? "创建中…" : "创建需求并开始设计"}</button></div>
						${this.error ? html`<div class="error">${this.error}</div>` : nothing}
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
