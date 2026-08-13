import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import { attentionCount, loadRequirementViews, type RequirementView } from "./baize-data.js";
import { stateLabel } from "./workflow-client.js";

const JOURNEY_GUIDE = [
	{ label: "规划", desc: "系统把需求拆成可执行的任务图" },
	{ label: "分析", desc: "梳理场景、用例与功能边界" },
	{ label: "设计", desc: "产出架构、数据与接口设计" },
	{ label: "评审", desc: "独立评审,提出问题与风险" },
	{ label: "批准", desc: "你审阅设计包并做出最终决定" },
	{ label: "归档", desc: "沉淀为不可变设计包与可复用资产" },
];

/** baize-overview — 总览:待我处理 + 需求进展一览 + 旅程引导空态。 */
class BaizeOverview extends LitElement {
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
		.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--gap); margin-top: var(--gap); }
		.stat strong { display: block; font-family: var(--font-display); font-size: var(--text-2xl); font-weight: 600; line-height: 1.1; font-variant-numeric: tabular-nums; }
		.stat span { font-size: var(--text-xs); color: var(--text-muted); }
		.rows { margin-top: var(--gap); display: grid; gap: var(--gap); }
		.row { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; cursor: pointer; }
		.row .title { font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.row .grow { flex: 1; min-width: 0; }
		.todo { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: var(--text-sm); flex-wrap: wrap; }
		.todo:last-child { border-bottom: none; }
		.todo .grow { flex: 1; min-width: 0; }
		.guide { display: grid; gap: 10px; }
		.guide .item { display: flex; gap: 10px; align-items: flex-start; }
		.guide .num { flex: 0 0 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--text-subtle); font-size: var(--text-xs); }
		.guide .t { font-weight: 600; font-size: var(--text-sm); }
		.guide .d { color: var(--text-muted); font-size: var(--text-sm); }
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

	private get attention(): RequirementView[] {
		return this.views.filter((v) => attentionCount(v) > 0);
	}

	render() {
		if (this.loading) return html`<div class="empty">加载中…</div>`;
		if (this.error) return html`<div class="error">${this.error}</div>`;

		if (this.views.length === 0) {
			return html`
				<div class="page-head"><h1>总览</h1><p class="sub">一个需求从描述到归档的完整旅程。</p></div>
				<div class="card" style="margin-top:var(--gap)">
					<h3>设计旅程</h3>
					<div class="guide">
						${JOURNEY_GUIDE.map((step, i) => html`
							<div class="item">
								<span class="num">${i + 1}</span>
								<div><div class="t">${step.label}</div><div class="d">${step.desc}</div></div>
							</div>`)}
					</div>
					<div class="command-row" style="margin-top:14px">
						<button class="primary" @click=${() => this.dispatchEvent(new CustomEvent("baize-goto", { detail: { tab: "requirements", create: true }, bubbles: true, composed: true }))}>创建第一个需求</button>
					</div>
				</div>`;
		}

		const running = this.views.filter((v) => v.state === "running" || v.state === "pending").length;
		const toApprove = this.views.filter((v) => v.state === "ready_to_archive").length;
		const archived = this.views.filter((v) => v.state === "archived").length;
		const todo = this.attention.reduce((n, v) => n + attentionCount(v), 0);

		return html`
			<div class="page-head"><h1>总览</h1><p class="sub">跨需求的进展与待办,一眼看清今天要做什么。</p></div>
			<div class="stats">
				<div class="card stat"><strong>${this.views.length}</strong><span>需求</span></div>
				<div class="card stat"><strong>${running}</strong><span>进行中</span></div>
				<div class="card stat"><strong>${todo}</strong><span>待我处理</span></div>
				<div class="card stat"><strong>${toApprove}</strong><span>待批准</span></div>
				<div class="card stat"><strong>${archived}</strong><span>已归档</span></div>
			</div>

			${this.attention.length > 0
				? html`<div class="card" style="margin-top:var(--gap)">
						<h3>待我处理</h3>
						${this.attention.map((v) => html`
							<div class="todo">
								<span class="badge" data-tone=${v.state === "failed" ? "bad" : v.state === "ready_to_archive" ? "accent" : "warn"}>${stateLabel(v.state)}</span>
								<span class="grow">${v.title}</span>
								<span class="badge">${attentionCount(v)} 项</span>
								<button @click=${() => this.open(v.id, v.state === "ready_to_archive" ? { approval: true } : undefined)}>去处理</button>
							</div>`)}
					</div>`
				: html`<div class="card" style="margin-top:var(--gap)"><div class="empty">当前没有需要你处理的事项。</div></div>`}

			<div class="card" style="margin-top:var(--gap)">
				<h3>需求进展</h3>
				<div class="rows">
					${this.views.map((v) => html`
						<button class="card row" @click=${() => this.open(v.id)}>
							<div class="grow">
								<div class="title">${v.title}</div>
								<div class="journey" style="margin-top:6px">
									${v.stages.map((s, i) => html`${i > 0 ? html`<span class="step-link ${v.stages[i - 1]!.status === "done" ? "done" : ""}"></span>` : nothing}<span class="step" data-status=${s.status}><span class="dot">${s.status === "done" ? "✓" : i + 1}</span><span class="name">${s.label}</span></span>`)}
								</div>
							</div>
							<span class="badge" data-tone=${v.state === "archived" ? "ok" : v.state === "failed" ? "bad" : "accent"}>${stateLabel(v.state)}</span>
						</button>`)}
				</div>
			</div>`;
	}
}

customElements.define("baize-overview", BaizeOverview);
