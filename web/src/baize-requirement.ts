import { LitElement, html, css, nothing } from "lit";

interface Run {
	id: number;
	kind: string;
	status: "queued" | "running" | "completed" | "failed" | "cancelled";
	prompt: string;
	error: string | null;
	created_at: string;
	finished_at: string | null;
}

interface Req {
	id: number;
	title: string;
	description?: string;
	done?: boolean;
	current?: string;
	latestRun?: Run | null;
}

interface EvidenceSnapshot {
	architecture?: Record<string, unknown> | string;
	head_sha?: string;
	captured_at?: string;
}

interface DesignPackage {
	title?: string;
	content?: string;
	snapshot?: string;
	status?: string;
	archived_at?: string;
}

type GeneRecord = Record<string, unknown>;
type GeneRef = { gene_id: string; source: string };
type AgentRole =
	| "orchestrator"
	| "analyst"
	| "architect"
	| "critic"
	| "reviewer";

const ROLES: Array<{ value: AgentRole; label: string }> = [
	{ value: "orchestrator", label: "编排" },
	{ value: "analyst", label: "分析" },
	{ value: "architect", label: "架构" },
	{ value: "critic", label: "评审" },
	{ value: "reviewer", label: "复核" },
];

class BaizeRequirement extends LitElement {
	static properties = {
		reqs: { state: true },
		workspaceId: { state: true },
		selected: { state: true },
		runs: { state: true },
		role: { state: true },
		prompt: { state: true },
		busy: { state: true },
		error: { state: true },
		evidenceSnapshot: { state: true },
		designPackage: { state: true },
		geneRefs: { state: true },
		geneCatalog: { state: true },
	};

	declare reqs: Req[];
	declare workspaceId: number;
	declare selected: number;
	declare runs: Run[];
	declare role: AgentRole;
	declare prompt: string;
	declare busy: string;
	declare error: string;
	declare evidenceSnapshot: EvidenceSnapshot | null;
	declare designPackage: DesignPackage | null;
	declare geneRefs: GeneRef[];
	declare geneCatalog: GeneRecord[];

	static styles = css`
		:host { display: block; height: 100%; }
		.layout { display: grid; grid-template-columns: 300px 1fr; gap: var(--gap); height: 100%; min-height: 0; }
		.col-list, .col-detail { min-height: 0; display: flex; flex-direction: column; }
		.col-head { display: flex; align-items: center; margin-bottom: var(--gap); }
		.col-head h2 { margin: 0; font-size: 1.1rem; }
		.btn-new { margin-left: auto; }
		.req-list { overflow: auto; display: flex; flex-direction: column; gap: 8px; }
		.req { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; cursor: pointer; }
		.req.active { border-color: var(--accent); background: var(--surface-2); }
		.req .badge { display: inline-block; margin-bottom: 5px; padding: 1px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
		.badge.ok { color: var(--ok); background: rgba(52, 211, 153, .15); }
		.badge.warn { color: var(--warn); background: rgba(251, 191, 36, .15); }
		.req .t { display: block; font-weight: 600; }
		.req .hint { display: block; margin-top: 5px; color: var(--text-subtle); font-size: .75rem; }
		.detail-card { overflow: auto; padding-right: 4px; }
		.detail-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
		.detail-head h2 { margin: 0; }
		.detail-head p { margin: 5px 0 0; color: var(--text-subtle); white-space: pre-wrap; }
		.controls { display: grid; grid-template-columns: 150px 1fr auto auto; gap: 8px; align-items: start; margin-bottom: 16px; }
		.controls select, .controls textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: inherit; font: inherit; padding: 8px; }
		.controls textarea { min-height: 42px; resize: vertical; }
		.controls button { white-space: nowrap; }
		.status { color: var(--text-subtle); font-size: .8rem; }
		.error { color: var(--danger); margin: 8px 0; white-space: pre-wrap; }
		.runs, .context-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; margin-bottom: 12px; }
		.runs h3, .context-card h3 { margin: 0 0 10px; font-size: .95rem; }
		.run { display: grid; grid-template-columns: 60px 110px 1fr auto; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid var(--border); font-size: .82rem; }
		.run:first-of-type { border-top: 0; }
		.run-kind, .run-status { color: var(--text-subtle); }
		.run-error { color: var(--danger); grid-column: 3 / -1; }
		.context-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
		.context-note { color: var(--text-subtle); font-size: .8rem; }
		.context-card pre { max-height: 220px; overflow: auto; margin: 0; white-space: pre-wrap; font: .75rem var(--font-mono); }
		.gene-row { display: flex; align-items: center; gap: 8px; border-top: 1px solid var(--border); padding: 6px 0; font-size: .8rem; }
		.gene-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.gene-row small { color: var(--text-subtle); }
		.gene-row button { margin-left: auto; padding: 3px 7px; font-size: .7rem; }
		.suggested { color: var(--accent); }
		.empty-state { padding: 40px 16px; text-align: center; color: var(--text-subtle); }
		@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } .col-list { max-height: 220px; } .controls { grid-template-columns: 1fr; } .context-grid { grid-template-columns: 1fr; } }
	`;

	constructor() {
		super();
		this.reqs = [];
		this.workspaceId = Number(
			localStorage.getItem("baize.ui.v1.workspace") ?? "0",
		);
		this.selected = 0;
		this.runs = [];
		this.role = "orchestrator";
		this.prompt = "";
		this.busy = "";
		this.error = "";
		this.evidenceSnapshot = null;
		this.designPackage = null;
		this.geneRefs = [];
		this.geneCatalog = [];
	}

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener(
			"baize-workspace-change",
			this.onWsChange as EventListener,
		);
		window.addEventListener(
			"baize-requirements-changed",
			this.onReqsChanged as EventListener,
		);
		if (this.workspaceId) void this.loadReqs();
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener(
			"baize-workspace-change",
			this.onWsChange as EventListener,
		);
		window.removeEventListener(
			"baize-requirements-changed",
			this.onReqsChanged as EventListener,
		);
	}

	private onWsChange = (event: CustomEvent<{ id: number }>) => {
		this.workspaceId = event.detail.id;
		this.selected = 0;
		void this.loadReqs();
	};

	private onReqsChanged = (event: CustomEvent<{ id?: number }>) => {
		void this.loadReqs().then(() => {
			const id = event.detail?.id;
			const requirement = this.reqs.find((item) => item.id === id);
			if (requirement) void this.pick(requirement);
		});
	};

	private async loadReqs(): Promise<void> {
		const response = await fetch(
			`/api/requirements?workspace=${this.workspaceId}`,
		);
		this.reqs = (await response.json()) as Req[];
		if (!this.selected && this.reqs[0]) await this.pick(this.reqs[0]);
	}

	private async pick(requirement: Req): Promise<void> {
		this.selected = requirement.id;
		this.error = "";
		await Promise.all([this.refreshRuns(), this.loadDesignContext()]);
	}

	private async refreshRuns(): Promise<void> {
		if (!this.selected) return;
		const response = await fetch(`/api/requirements/${this.selected}/runs`);
		this.runs = response.ok ? ((await response.json()) as Run[]) : [];
	}

	private async loadDesignContext(): Promise<void> {
		if (!this.selected) return;
		const getJson = async (url: string): Promise<unknown> => {
			const response = await fetch(url);
			return response.ok ? response.json() : null;
		};
		try {
			const [snapshot, pkg, refs, catalog] = await Promise.all([
				getJson(`/api/requirements/${this.selected}/evidence-snapshot`),
				getJson(`/api/requirements/${this.selected}/design-package`),
				getJson(`/api/requirements/${this.selected}/genes`),
				getJson("/api/genes"),
			]);
			this.evidenceSnapshot =
				snapshot && typeof snapshot === "object"
					? (snapshot as EvidenceSnapshot)
					: null;
			this.designPackage =
				pkg && typeof pkg === "object" ? (pkg as DesignPackage) : null;
			this.geneRefs = Array.isArray(refs) ? (refs as GeneRef[]) : [];
			this.geneCatalog = Array.isArray(catalog)
				? (catalog as GeneRecord[])
				: [];
		} catch {
			this.error = "加载设计依据失败";
		}
	}

	private newRequirement(): void {
		this.dispatchEvent(
			new CustomEvent("baize-new-requirement", {
				bubbles: true,
				composed: true,
			}),
		);
	}

	private async post(
		path: string,
		body?: unknown,
	): Promise<Record<string, unknown> | null> {
		const response = await fetch(path, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const payload = (await response.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;
		if (!response.ok) {
			this.error = String(payload.error ?? `请求失败(${response.status})`);
			return null;
		}
		this.error = "";
		return payload;
	}

	private async runAgent(): Promise<void> {
		if (!this.selected || !this.prompt.trim() || this.busy) return;
		this.busy = "run";
		const result = await this.post(`/api/requirements/${this.selected}/runs`, {
			prompt: this.prompt.trim(),
			role: this.role,
		});
		if (result) {
			this.prompt = "";
			await Promise.all([this.refreshRuns(), this.loadReqs()]);
		}
		this.busy = "";
	}

	private async archive(): Promise<void> {
		if (!this.selected || this.busy) return;
		this.busy = "archive";
		const result = await this.post(
			`/api/requirements/${this.selected}/archive`,
		);
		if (result)
			await Promise.all([
				this.refreshRuns(),
				this.loadReqs(),
				this.loadDesignContext(),
			]);
		this.busy = "";
	}

	private geneId(gene: GeneRecord): string {
		return String(gene.id ?? gene.gene_id ?? gene.name ?? "");
	}

	private geneLabel(gene: GeneRecord): string {
		return String(gene.summary ?? gene.title ?? gene.name ?? this.geneId(gene));
	}

	private recommendedGenes(): GeneRecord[] {
		const requirement = this.reqs.find((item) => item.id === this.selected);
		if (!requirement) return [];
		const tokens = new Set(
			`${requirement.title} ${requirement.description ?? ""}`
				.toLowerCase()
				.match(/[\u4e00-\u9fff]{2,}|[a-z0-9_][a-z0-9_-]{1,}/g) ?? [],
		);
		const selected = new Set(this.geneRefs.map((ref) => ref.gene_id));
		return this.geneCatalog
			.map((gene) => ({
				gene,
				score: [...tokens].filter((token) =>
					JSON.stringify(gene).toLowerCase().includes(token),
				).length,
			}))
			.filter((item) => !selected.has(this.geneId(item.gene)) && item.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 3)
			.map((item) => item.gene);
	}

	private async toggleGene(geneId: string, add: boolean): Promise<void> {
		const response = await fetch(`/api/requirements/${this.selected}/genes`, {
			method: add ? "POST" : "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ geneId, source: "manual" }),
		});
		if (response.ok) await this.loadDesignContext();
	}

	private renderContext() {
		const architecture = this.evidenceSnapshot?.architecture;
		const architectureText =
			typeof architecture === "string"
				? architecture
				: JSON.stringify(architecture ?? {}, null, 2);
		const selected = this.geneRefs
			.map((ref) =>
				this.geneCatalog.find((gene) => this.geneId(gene) === ref.gene_id),
			)
			.filter(Boolean) as GeneRecord[];
		const suggested = this.recommendedGenes();
		return html`<section class="context-grid">
			<div class="context-card"><h3>本次设计依据</h3>${this.evidenceSnapshot ? html`<p class="context-note">已固化 · ${this.evidenceSnapshot.head_sha || "unknown"}</p><pre>${architectureText}</pre>` : html`<p class="context-note">尚未生成证据快照。</p>`}</div>
			<div class="context-card"><h3>DesignPackage</h3>${this.designPackage ? html`<pre>${this.designPackage.content || this.designPackage.snapshot || "已归档"}</pre>` : html`<p class="context-note">完成通用 Run 后可归档。</p>`}</div>
			<div class="context-card"><h3>复用经验 (${this.geneRefs.length})</h3>
				${selected.length ? selected.map((gene) => html`<div class="gene-row"><span>${this.geneLabel(gene)}</span><button @click=${() => this.toggleGene(this.geneId(gene), false)}>移除</button></div>`) : html`<p class="context-note">尚未绑定经验。</p>`}
				${suggested.length ? html`<p class="context-note">推荐加入</p>${suggested.map((gene) => html`<div class="gene-row suggested"><span>${this.geneLabel(gene)}</span><button @click=${() => this.toggleGene(this.geneId(gene), true)}>加入</button></div>`)}` : nothing}
			</div>
		</section>`;
	}

	private renderRuns() {
		return html`<section class="runs"><h3>Runs</h3>${this.runs.length ? this.runs.map((run) => html`<div class="run"><span>#${run.id}</span><span class="run-kind">${run.kind}</span><span>${run.prompt}</span><span class="run-status">${run.status}</span>${run.error ? html`<span class="run-error">${run.error}</span>` : nothing}</div>`) : html`<p class="context-note">尚无 Run。</p>`}</section>`;
	}

	render() {
		if (!this.workspaceId)
			return html`<div class="empty-state"><h2>请先选择工作区</h2><p>工作区对应一个代码仓库,请先创建或选择工作区。</p></div>`;
		return html`<div class="layout">
			<aside class="col-list"><div class="col-head"><h2>需求</h2><button class="btn-new" @click=${this.newRequirement}>+ 新建需求</button></div><div class="req-list">${this.reqs.length ? this.reqs.map((requirement) => html`<div class="req ${requirement.id === this.selected ? "active" : ""}" @click=${() => this.pick(requirement)}><span class="badge ${requirement.done ? "ok" : "warn"}">${requirement.done ? "已归档" : "工作中"}</span><span class="t">${requirement.title}</span><span class="hint">${requirement.done ? "SQLite DesignPackage 已归档" : `最近: ${requirement.latestRun?.kind ?? "尚未运行"}`}</span></div>`) : html`<div class="empty-state"><p>本工作区还没有需求。</p></div>`}</div></aside>
			<main class="col-detail">${
				this.selected
					? html`<div class="detail-card">
				${(() => {
					const requirement = this.reqs.find(
						(item) => item.id === this.selected,
					);
					return requirement
						? html`<div class="detail-head"><div><h2>${requirement.title}</h2><p>${requirement.description ?? ""}</p></div></div>`
						: nothing;
				})()}
				<div class="controls"><select .value=${this.role} @change=${(
					event: Event,
				) => {
					this.role = (event.target as HTMLSelectElement).value as AgentRole;
				}}>${ROLES.map((item) => html`<option value=${item.value}>${item.label}</option>`)}</select><textarea placeholder="输入本次设计 Run 的任务或问题" .value=${this.prompt} @input=${(
					event: Event,
				) => {
					this.prompt = (event.target as HTMLTextAreaElement).value;
				}}></textarea><button class="primary" ?disabled=${Boolean(this.busy) || !this.prompt.trim()} @click=${this.runAgent}>${this.busy === "run" ? "运行中…" : "启动 Run"}</button><button ?disabled=${Boolean(this.busy) || this.reqs.find((item) => item.id === this.selected)?.done} @click=${this.archive}>${this.busy === "archive" ? "归档中…" : "归档"}</button></div>
				${this.error ? html`<div class="error">${this.error}</div>` : nothing}
				${this.renderRuns()}${this.renderContext()}
			</div><baize-run-rail variant="column" .requirementId=${this.selected}></baize-run-rail>`
					: html`<div class="empty-state"><h2>选择一个需求</h2><p>从左侧选择需求,启动一个通用设计 Run。</p></div>`
			}</main>
		</div>`;
	}
}

customElements.define("baize-requirement", BaizeRequirement);
