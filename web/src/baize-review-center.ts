import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import { loadRequirementViews, type RequirementView } from "./baize-data.js";
import { gateCategoryLabel } from "./workflow-client.js";

/** baize-review-center — 审核中心:聚合所有需求里需要人处理的事项(门禁/批准/恢复)。 */
class BaizeReviewCenter extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		views: { state: true },
		loading: { state: true },
		error: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare views: RequirementView[];
	declare loading: boolean;
	declare error: string | null;

	static styles = [sharedStyles, css`
		.section { margin-top: var(--gap); }
		.todo { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: var(--text-sm); flex-wrap: wrap; }
		.todo:last-child { border-bottom: none; }
		.todo .grow { flex: 1; min-width: 0; }
		.todo .req { color: var(--text-muted); font-size: var(--text-xs); display: block; }
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 1;
		this.views = [];
		this.loading = true;
		this.error = null;
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

	private open(id: number, intent?: { gate?: string; approval?: boolean }): void {
		this.dispatchEvent(new CustomEvent("baize-open-requirement", { detail: { id, ...intent }, bubbles: true, composed: true }));
	}

	render() {
		if (this.loading) return html`<div class="empty">加载中…</div>`;
		if (this.error) return html`<div class="error">${this.error}</div>`;

		const approvals = this.views.filter((v) => v.state === "ready_to_archive");
		const gateItems = this.views.flatMap((v) => v.gates.map((g) => ({ view: v, gate: g })));
		const failed = this.views.filter((v) => v.state === "failed");
		const total = approvals.length + gateItems.length + failed.length;

		return html`
			<div class="page-head"><h1>审核中心</h1><p class="sub">所有需要你判断的事项集中在这里,处理完工作流才会继续。</p></div>

			${total === 0
				? html`<div class="card" style="margin-top:var(--gap)"><div class="empty">当前没有需要你处理的事项。工作流都在自动推进。</div></div>`
				: nothing}

			${approvals.length > 0
				? html`<div class="card section"><h3>待批准归档</h3>
						${approvals.map((v) => html`
							<div class="todo">
								<span class="badge" data-tone="accent">待批准</span>
								<span class="grow">设计包已就绪,等待你的最终批准。<span class="req">需求 ${v.id} · ${v.title}</span></span>
								<button class="primary" @click=${() => this.open(v.id, { approval: true })}>去批准</button>
							</div>`)}
					</div>`
				: nothing}

			${gateItems.length > 0
				? html`<div class="card section"><h3>门禁待处理</h3>
						${gateItems.map(({ view, gate }) => html`
							<div class="todo">
								<span class="badge" data-tone="warn">${gateCategoryLabel(gate.category)}</span>
								<span class="grow">${gate.title}<span class="req">需求 ${view.id} · ${view.title}</span></span>
								<button @click=${() => this.open(view.id, { gate: gate.key })}>去处理</button>
							</div>`)}
					</div>`
				: nothing}

			${failed.length > 0
				? html`<div class="card section"><h3>失败待恢复</h3>
						${failed.map((v) => html`
							<div class="todo">
								<span class="badge" data-tone="bad">失败</span>
								<span class="grow">工作流遇到失败,需要选择恢复方式。<span class="req">需求 ${v.id} · ${v.title}</span></span>
								<button @click=${() => this.open(v.id)}>去恢复</button>
							</div>`)}
					</div>`
				: nothing}
		`;
	}
}

customElements.define("baize-review-center", BaizeReviewCenter);
