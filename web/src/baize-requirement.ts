import { LitElement, html, css, nothing } from "lit";
import "./baize-consent-modal.ts";
import "./baize-markdown.ts";

/**
 * 需求设计 — 旅程主视图(master-detail):左需求列表,右设计流水线。
 * ws 全局跟随(读 localStorage + 监听 baize-workspace-change);新建需求走 chat-intake(T05);
 * 审批 consent gate(baize-consent-modal);打回带意见重跑。逻辑方法保留自原版。
 */
interface Req {
	id: number;
	title: string;
	description?: string;
	done?: boolean;
	current?: string;
}

interface StageRow {
	stage: string;
	status: string;
	artifact_refs?: string;
	feedback?: string;
}
interface Ref {
	type?: string;
	title?: string;
	name?: string;
	description?: string;
	scenarioTitle?: string;
	precondition?: string;
	mainFlow?: string;
	exceptions?: string;
	postcondition?: string;
	items?: Array<{ title: string; description: string }>;
	file?: string;
	content?: unknown;
}

interface EvidenceSnapshot {
	architecture?: Record<string, unknown>;
	head_sha?: string;
	captured_at?: string;
}

interface DesignPackage {
	title?: string;
	content?: string;
	adr?: string;
	archived_at?: string;
}

type GeneRecord = Record<string, unknown>;
type GeneRef = { gene_id: string; source: string };

const STAGES: Array<{ cn: string; en: string }> = [
	{ cn: "分析", en: "analysis" },
	{ cn: "场景", en: "scenario" },
	{ cn: "用例", en: "usecase" },
	{ cn: "功能分解", en: "function" },
	{ cn: "功能设计", en: "design" },
	{ cn: "归档", en: "archive" },
];

class BaizeRequirement extends LitElement {
	static properties = {
		reqs: { state: true },
		workspaceId: { state: true },
		selected: { state: true },
		stages: { state: true },
		busy: { state: true },
		error: { state: true },
		feedback: { state: true },
		consent: { state: true },
		evidenceSnapshot: { state: true },
		designPackage: { state: true },
		geneRefs: { state: true },
		geneCatalog: { state: true },
	};

	declare reqs: Req[];
	declare workspaceId: number;
	declare selected: number;
	declare stages: StageRow[];
	declare busy: string;
	declare error: string;
	declare feedback: string;
	declare consent: { cn: string; en: string; refs: Ref[] } | null;
	declare evidenceSnapshot: EvidenceSnapshot | null;
	declare designPackage: DesignPackage | null;
	declare geneRefs: GeneRef[];
	declare geneCatalog: GeneRecord[];

	static styles = css`
		:host {
			display: block;
			height: 100%;
		}
		.layout {
			display: grid;
			grid-template-columns: 300px 1fr;
			gap: var(--gap);
			height: 100%;
			min-height: 0;
		}
		/* 左列:需求列表 */
		.col-list {
			display: flex;
			flex-direction: column;
			min-height: 0;
		}
		.col-head {
			display: flex;
			align-items: center;
			margin-bottom: var(--gap);
		}
		.col-head h2 {
			margin: 0;
			font-size: 1.1rem;
			font-weight: 650;
		}
		.btn-new {
			margin-left: auto;
			background: var(--accent);
			color: var(--accent-fg);
			border: none;
			border-radius: var(--radius-sm);
			padding: 6px 12px;
			font: inherit;
			font-size: 0.82rem;
			font-weight: 600;
			cursor: pointer;
			transition: background 0.2s, transform 0.1s;
		}
		.btn-new:hover {
			background: var(--info);
		}
		.btn-new:active {
			transform: scale(0.96);
		}
		.req-list {
			flex: 1;
			overflow: auto;
			display: flex;
			flex-direction: column;
			gap: 8px;
			padding-right: 2px;
		}
		.req {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 12px 14px;
			cursor: pointer;
			transition: border-color 0.2s, box-shadow 0.2s;
		}
		.req:hover {
			border-color: var(--border-strong);
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		}
		.req.active {
			border-color: var(--accent);
			background: var(--surface-2);
		}
		.req .badge {
			font-size: 11px;
			padding: 1px 8px;
			border-radius: 99px;
			font-weight: 600;
		}
		.badge.ok {
			background: rgba(52, 211, 153, 0.15);
			color: var(--ok);
		}
		.badge.warn {
			background: rgba(251, 191, 36, 0.15);
			color: var(--warn);
		}
		.req .t {
			display: block;
			font-weight: 600;
			font-size: 0.9rem;
			margin: 8px 0 4px;
		}
		.req .hint {
			display: block;
			color: var(--text-subtle);
			font-size: 0.72rem;
			font-family: var(--font-mono);
		}
		/* 右列:详情 */
		.col-detail {
			min-height: 0;
			overflow: auto;
		}
		.detail-row {
			display: flex;
			gap: var(--gap);
			height: 100%;
			min-height: 0;
		}
		.detail-row > .detail-card {
			flex: 1 1 auto;
			min-width: 0;
			overflow: auto;
		}
		.detail-card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 20px;
		}
		.detail-card h3 {
			margin: 0 0 16px;
			font-size: 1rem;
			font-weight: 600;
		}
		.empty-state {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			text-align: center;
			padding: 56px 24px;
			color: var(--text-muted);
			background: var(--surface);
			border: 1px dashed var(--border-strong);
			border-radius: var(--radius);
		}
		.empty-state h2 {
			margin: 0 0 8px;
			font-size: 1.05rem;
			font-weight: 600;
			color: var(--text);
		}
		.empty-state p {
			margin: 0 0 20px;
			font-size: 0.86rem;
			line-height: 1.6;
		}
		.empty-state .btn {
			background: var(--accent);
			color: var(--accent-fg);
			border: none;
			border-radius: var(--radius-sm);
			padding: 8px 16px;
			font: inherit;
			font-weight: 600;
			cursor: pointer;
			transition: background 0.2s;
		}
		/* 流水线 stage */
		.stage {
			background: var(--surface-2);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 14px;
			margin-bottom: 12px;
		}
		.stage .head {
			display: flex;
			align-items: center;
			gap: 10px;
		}
		.stage .name {
			font-weight: 600;
			font-size: 0.9rem;
		}
		.status {
			margin-left: auto;
			font-size: 11px;
			padding: 2px 9px;
			border-radius: 99px;
			font-weight: 600;
		}
		.status.未开始 {
			color: var(--text-subtle);
			background: var(--surface-hover);
		}
		.status.进行中 {
			color: var(--run);
			background: rgba(56, 189, 248, 0.15);
		}
		.status.待审 {
			color: var(--warn);
			background: rgba(251, 191, 36, 0.15);
		}
		.status.打回 {
			color: var(--danger);
			background: rgba(251, 113, 133, 0.15);
		}
		.status.完成 {
			color: var(--ok);
			background: rgba(52, 211, 153, 0.15);
		}
		button {
			font: inherit;
			cursor: pointer;
			background: var(--surface-hover);
			color: var(--text);
			border: 1px solid var(--border-strong);
			border-radius: var(--radius-sm);
			padding: 5px 12px;
			font-size: 0.8rem;
			transition: background 0.2s, border-color 0.2s;
		}
		button:hover {
			background: var(--surface-2);
		}
		button.primary {
			background: var(--accent);
			color: var(--accent-fg);
			border-color: transparent;
			font-weight: 600;
		}
		button.primary:hover {
			background: var(--info);
		}
		button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
		textarea {
			display: block;
			width: 100%;
			box-sizing: border-box;
			margin-top: 10px;
			background: var(--bg);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: var(--radius-sm);
			padding: 8px;
			font: inherit;
			font-size: 0.82rem;
			resize: vertical;
			transition: border-color 0.2s;
		}
		textarea:focus {
			outline: none;
			border-color: var(--accent);
		}
		.fb {
			margin-top: 10px;
			color: var(--danger);
			font-size: 0.78rem;
		}
		.refs {
			margin-top: 12px;
		}
		.refs .item {
			background: var(--bg);
			border: 1px solid var(--border);
			border-radius: var(--radius-sm);
			padding: 10px 12px;
			margin-bottom: 8px;
			font-size: 0.82rem;
		}
		.refs .item b {
			display: block;
			margin-bottom: 4px;
			font-weight: 600;
		}
		.refs .item p {
			margin: 2px 0;
			color: var(--text-muted);
			line-height: 1.5;
		}
		.refs .item pre {
			margin: 0;
			color: var(--text-muted);
			font-family: var(--font-mono);
			font-size: 0.74rem;
			white-space: pre-wrap;
			word-break: break-word;
		}
		.error {
			color: var(--danger);
			font-size: 0.82rem;
			margin-top: 12px;
			padding: 8px 12px;
			background: rgba(251, 113, 133, 0.1);
			border: 1px solid rgba(251, 113, 133, 0.3);
			border-radius: var(--radius-sm);
		}
		.design-context {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: var(--gap);
			margin-bottom: var(--gap);
		}
		.context-card {
			background: var(--surface-2);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 14px;
			min-width: 0;
		}
		.context-head {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-bottom: 8px;
		}
		.context-head h3 { margin: 0; font-size: 0.86rem; }
		.context-badge {
			margin-left: auto;
			color: var(--info);
			font-size: 0.7rem;
		}
		.context-note {
			margin: 0;
			color: var(--text-muted);
			font-size: 0.74rem;
			line-height: 1.5;
		}
		.context-stats {
			display: flex;
			gap: 10px;
			margin-top: 12px;
			flex-wrap: wrap;
		}
		.context-stats b { color: var(--text); font-size: 1rem; }
		.context-stats small { display: block; color: var(--text-subtle); font-size: 0.64rem; font-weight: 400; }
		.gene-row {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 6px 0;
			border-top: 1px solid var(--border);
			font-size: 0.76rem;
		}
		.gene-row span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.gene-row small { color: var(--text-subtle); font-family: var(--font-mono); }
		.gene-row button { margin-left: auto; padding: 3px 7px; font-size: 0.7rem; }
		.suggested-label { margin-top: 10px; color: var(--accent); font-size: 0.72rem; }
		@media (max-width: 900px) { .design-context { grid-template-columns: 1fr; } }
		.stepper {
			display: flex;
			gap: 6px;
			flex-wrap: wrap;
			margin-bottom: 14px;
		}
		.step {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding: 4px 10px;
			border-radius: 99px;
			border: 1px solid var(--border);
			color: var(--text-subtle);
			font-size: 0.75rem;
		}
		.step .dot {
			width: 7px;
			height: 7px;
			border-radius: 99px;
			background: var(--text-subtle);
		}
		.step.完成 {
			color: var(--ok);
			border-color: var(--ok);
		}
		.step.完成 .dot {
			background: var(--ok);
		}
		.step.待审 {
			color: var(--warn);
			border-color: var(--warn);
		}
		.step.待审 .dot {
			background: var(--warn);
		}
		.step.打回 {
			color: var(--danger);
			border-color: var(--danger);
		}
		.step.打回 .dot {
			background: var(--danger);
		}
		.step.进行中 {
			color: var(--run);
			border-color: var(--run);
		}
		.step.进行中 .dot {
			background: var(--run);
			animation: pulse 1.4s infinite;
		}
	`;

	constructor() {
		super();
		this.reqs = [];
		this.workspaceId = Number(
			localStorage.getItem("baize.ui.v1.workspace") ?? "0",
		);
		this.selected = 0;
		this.stages = [];
		this.busy = "";
		this.error = "";
		this.feedback = "";
		this.consent = null;
		this.evidenceSnapshot = null;
		this.designPackage = null;
		this.geneRefs = [];
		this.geneCatalog = [];
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		window.addEventListener(
			"baize-workspace-change",
			this.onWsChange as EventListener,
		);
		window.addEventListener(
			"baize-requirements-changed",
			this.onReqsChanged as EventListener,
		);
		if (this.workspaceId) await this.loadReqs();
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

	private onWsChange = (e: CustomEvent<{ id: number }>) => {
		this.workspaceId = e.detail.id;
		this.selected = 0;
		this.evidenceSnapshot = null;
		this.designPackage = null;
		this.geneRefs = [];
		this.geneCatalog = [];
		void this.loadReqs();
	};

	private onReqsChanged = (e: CustomEvent<{ id?: number }>) => {
		void this.loadReqs().then(() => {
			const id = e.detail?.id;
			if (id) {
				const r = this.reqs.find((x) => x.id === id);
				if (r) void this.pick(r);
			}
		});
	};

	async loadReqs(): Promise<void> {
		this.reqs = (await (
			await fetch(`/api/requirements?workspace=${this.workspaceId}`)
		).json()) as Req[];
	}

	async pick(r: Req): Promise<void> {
		this.selected = r.id;
		this.error = "";
		await this.reloadStages();
		await this.loadDesignContext();
	}

	async reloadStages(): Promise<void> {
		this.stages = (await (
			await fetch(`/api/requirements/${this.selected}/stages`)
		).json()) as StageRow[];
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
			this.evidenceSnapshot = snapshot && typeof snapshot === "object" ? (snapshot as EvidenceSnapshot) : null;
			this.designPackage = pkg && typeof pkg === "object" ? (pkg as DesignPackage) : null;
			this.geneRefs = Array.isArray(refs) ? (refs as GeneRef[]) : [];
			this.geneCatalog = Array.isArray(catalog) ? (catalog as GeneRecord[]) : [];
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

	// 门禁:该阶段是否可运行(前置全部完成 + 自身处于 未开始/打回)
	runnable(cn: string): boolean {
		const st = (name: string): string =>
			this.stages.find((x) => x.stage === name)?.status ?? "未开始";
		for (const s of STAGES) {
			if (s.cn === cn) break;
			if (st(s.cn) !== "完成") return false;
		}
		const cur = st(cn);
		return cur === "未开始" || cur === "打回";
	}

	async post(url: string, body?: unknown): Promise<boolean> {
		const r = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		if (!r.ok) {
			const e = (await r.json().catch(() => ({}))) as { error?: string };
			this.error = e.error ?? `请求失败(${r.status})`;
			return false;
		}
		this.error = "";
		return true;
	}

	async runStage(cn: string, en: string): Promise<void> {
		this.busy = cn;
		const ok = await this.post(
			`/api/requirements/${this.selected}/stage/${en}/run`,
		);
		this.busy = "";
		if (ok) await this.reloadStages();
		await this.loadReqs();
		await this.loadDesignContext();
	}

	async approve(cn: string, en: string): Promise<void> {
		const ok = await this.post(
			`/api/requirements/${this.selected}/stage/${en}/approve`,
		);
		if (ok) await this.reloadStages();
		await this.loadReqs();
		await this.loadDesignContext();
	}

	async reject(en: string): Promise<void> {
		if (!this.feedback.trim()) {
			this.error = "打回必须填写修改意见";
			return;
		}
		const ok = await this.post(
			`/api/requirements/${this.selected}/stage/${en}/reject`,
			{ feedback: this.feedback.trim() },
		);
		if (ok) {
			this.feedback = "";
			await this.reloadStages();
			await this.loadDesignContext();
		}
	}

private geneId(gene: GeneRecord): string {
	return String(gene.id ?? gene.gene_id ?? gene.name ?? "");
}

private geneLabel(gene: GeneRecord): string {
	return String(gene.summary ?? gene.title ?? gene.name ?? this.geneId(gene));
}

private recommendedGenes(): GeneRecord[] {
	const req = this.reqs.find((item) => item.id === this.selected);
	if (!req) return [];
	const query = new Set(`${req.title} ${req.description ?? ""}`.toLowerCase().match(/[\u4e00-\u9fff]{2,}|[a-z0-9_][a-z0-9_-]{1,}/g) ?? []);
	const selected = new Set(this.geneRefs.map((ref) => ref.gene_id));
	return this.geneCatalog
		.map((gene) => ({ gene, score: [...query].filter((token) => JSON.stringify(gene).toLowerCase().includes(token)).length }))
		.filter((item) => !selected.has(this.geneId(item.gene)) && item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, 3)
		.map((item) => item.gene);
}

private async toggleGene(geneId: string, add: boolean, source = "manual"): Promise<void> {
	const response = await fetch(`/api/requirements/${this.selected}/genes`, {
		method: add ? "POST" : "DELETE",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ geneId, source }),
	});
	if (response.ok) await this.loadDesignContext();
}

private renderDesignContext() {
	const arch = this.evidenceSnapshot?.architecture;
	const architecture = arch as Record<string, unknown> | undefined;
	const hotspots = Array.isArray(architecture?.hotspots) ? (architecture.hotspots as Array<Record<string, unknown>>) : [];
	const boundaries = Array.isArray(architecture?.boundaries) ? (architecture.boundaries as Array<Record<string, unknown>>) : [];
	const clusters = Array.isArray(architecture?.clusters) ? (architecture.clusters as Array<Record<string, unknown>>) : [];
	const selectedIds = new Set(this.geneRefs.map((ref) => ref.gene_id));
	const selectedGenes = this.geneCatalog.filter((gene) => selectedIds.has(this.geneId(gene)));
	const suggested = this.recommendedGenes();
	return html`<section class="design-context">
		<div class="context-card evidence-context">
			<div class="context-head"><h3>本次设计依据</h3><span class="context-badge">${this.evidenceSnapshot ? "已固化" : "待分析"}</span></div>
			${this.evidenceSnapshot ? html`<p class="context-note">分析阶段时保存的代码事实 · head ${this.evidenceSnapshot.head_sha || "unknown"}</p>
				<div class="context-stats"><b>${Number(architecture?.total_nodes ?? 0).toLocaleString()}<small>代码节点</small></b><b>${Number(architecture?.total_edges ?? 0).toLocaleString()}<small>关系边</small></b><b>${hotspots.length}<small>热点</small></b><b>${boundaries.length}<small>边界</small></b><b>${clusters.length}<small>模块</small></b></div>` : html`<p class="context-note">运行「分析」阶段后,这里会保存 AI 当时看到的代码架构事实。</p>`}
		</div>
		<div class="context-card package-context">
			<div class="context-head"><h3>设计包</h3><span class="context-badge">${this.designPackage ? "已归档" : "归档后生成"}</span></div>
			${this.designPackage?.content ? html`<baize-markdown .text=${this.designPackage.content}></baize-markdown>` : html`<p class="context-note">完成「归档」阶段后,设计包会在这里渲染为可读文档。</p>`}
		</div>
		<div class="context-card gene-context">
			<div class="context-head"><h3>复用经验</h3><span class="context-badge">${this.geneRefs.length} 个已选</span></div>
			<p class="context-note">运行分析时会自动匹配经验;也可以手动增减,选择结果会注入后续阶段 prompt。</p>
			${selectedGenes.length ? selectedGenes.map((gene) => html`<div class="gene-row"><span>${this.geneLabel(gene)}</span><small>${this.geneRefs.find((ref) => ref.gene_id === this.geneId(gene))?.source ?? "manual"}</small><button @click=${() => this.toggleGene(this.geneId(gene), false)}>移除</button></div>`) : html`<p class="context-note">尚未绑定经验。</p>`}
			${suggested.length ? html`<div class="suggested-label">推荐加入</div>${suggested.map((gene) => html`<div class="gene-row suggested"><span>${this.geneLabel(gene)}</span><button @click=${() => this.toggleGene(this.geneId(gene), true)}>加入</button></div>`)}` : nothing}
		</div>
	</section>`;
}

	renderRefs(refs: Ref[]) {
		if (!refs.length) return nothing;
		return html`<div class="refs">
			${refs.map((r) => {
				if (r.type === "scenario")
					return html`<div class="item"><b>${r.title}</b><p>${r.description}</p></div>`;
				if (r.type === "usecase")
					return html`<div class="item">
						<b>${r.title}</b>
						<p>
							场景:${r.scenarioTitle ?? "-"} · 前置:${r.precondition || "-"}<br />
							主流程:${r.mainFlow || "-"}<br />
							异常:${r.exceptions || "-"} · 后置:${r.postcondition || "-"}
						</p>
					</div>`;
				if (r.type === "domain")
					return html`<div class="item">
						<b>${r.name}</b>
						<p>${r.description}</p>
						${(r.items ?? []).map(
							(it) => html`<p>· ${it.title} — ${it.description}</p>`,
						)}
					</div>`;
				if (r.type === "archive")
					return html`<div class="item"><b>归档文件</b><p>${r.file}</p></div>`;
				// analysis / design 内联产物
				return html`<div class="item">
					<pre>${JSON.stringify(r.content ?? r, null, 2)}</pre>
				</div>`;
			})}
		</div>`;
	}

	renderStage(s: { cn: string; en: string }) {
		const row = this.stages.find((x) => x.stage === s.cn);
		const st = row?.status ?? "未开始";
		const refs = (() => {
			try {
				return JSON.parse(row?.artifact_refs ?? "[]") as Ref[];
			} catch {
				return [];
			}
		})();
		const isArchive = s.en === "archive";
		return html`<div class="stage">
			<div class="head">
				<span class="name">${s.cn}</span>
				<span class="status ${st}">${st}</span>
				${
					st === "待审"
						? html`<button @click=${() => this.openConsent(s, refs)}>通过</button>
							<button @click=${() => this.reject(s.en)}>打回(填意见)</button>`
						: this.runnable(s.cn)
							? html`<button
								class="primary"
								?disabled=${this.busy !== ""}
								@click=${() => this.runStage(s.cn, s.en)}
							>
								${
									this.busy === s.cn
										? "生成中…(约 1-2 分钟)"
										: st === "打回"
											? "按意见重新生成"
											: isArchive
												? "归档"
												: "开始"
								}
							</button>`
							: nothing
				}
			</div>
			${
				st === "待审" && !isArchive
					? html`<textarea
					rows="2"
					placeholder="修改意见(打回时必填):如 场景缺少异常分支、粒度太粗…"
					.value=${this.feedback}
					@input=${(e: Event) =>
						(this.feedback = (e.target as HTMLTextAreaElement).value)}
				></textarea>`
					: nothing
			}
			${
				st === "打回" && row?.feedback
					? html`<div class="fb">打回意见:${row.feedback}</div>`
					: nothing
			}
			${this.renderRefs(refs)}
		</div>`;
	}

	private openConsent(s: { cn: string; en: string }, refs: Ref[]) {
		this.consent = { cn: s.cn, en: s.en, refs };
	}

	private consentSummary(cn: string, refs: Ref[]) {
		const items = refs.map(
			(r) => html`<li>${r.title ?? r.name ?? r.type}</li>`,
		);
		return html`<p>即将通过「${cn}」阶段。本阶段产物 ${refs.length} 项:</p>${refs.length ? html`<ul>${items}</ul>` : html`<p style="color:var(--text-subtle)">(无结构化产物)</p>`}`;
	}

	private cancelConsent() {
		this.consent = null;
	}

	private async confirmConsent() {
		if (!this.consent) return;
		const { cn, en } = this.consent;
		this.consent = null;
		await this.approve(cn, en);
	}

	render() {
		if (!this.workspaceId) {
			return html`<div class="empty-state">
				<h2>请先选择工作区</h2>
				<p>工作区对应一个代码仓库,是设计需求的载体。在顶部切换,或先去创建一个。</p>
				<button
					class="btn"
					@click=${() =>
						this.dispatchEvent(
							new CustomEvent("baize-goto", {
								bubbles: true,
								composed: true,
								detail: { tab: "workspaces" },
							}),
						)}
				>
					去工作区页 →
				</button>
			</div>`;
		}
		return html`
			<div class="layout">
				<aside class="col-list">
					<div class="col-head">
						<h2>需求</h2>
						<button class="btn-new" @click=${() => this.newRequirement()}>+ 新建需求</button>
					</div>
					<div class="req-list">
						${
							this.reqs.length
								? this.reqs.map(
										(r) => html`<div
										class="req ${r.id === this.selected ? "active" : ""}"
										@click=${() => this.pick(r)}
									>
										<span class="badge ${r.done ? "ok" : "warn"}">${r.done ? "已完成" : "工作中"}</span>
										<span class="t">${r.title}</span>
										<span class="hint">${r.done ? "已归档" : `当前:${r.current}`}</span>
									</div>`,
									)
								: html`<div class="empty-state" style="padding:32px 16px">
									<p style="margin:0">本工作区还没有需求,点右上「新建需求」开始</p>
								</div>`
						}
					</div>
				</aside>
				<main class="col-detail">
					${
						this.selected
						? html`<div class="detail-row"><div class="detail-card">
								${this.renderDesignContext()}
								<h3>设计流水线(逐阶段审核,打回可带意见重跑)</h3>
								<div class="stepper">
									${STAGES.map((s) => {
										const st = this.stages.find((x) => x.stage === s.cn)?.status ?? "未开始";
										return html`<div class="step ${st}"><span class="dot"></span>${s.cn}</div>`;
									})}
								</div>
								${STAGES.map((s) => this.renderStage(s))}
								${this.error ? html`<div class="error">${this.error}</div>` : nothing}
						</div><baize-run-rail variant="column" .requirementId=${this.selected}></baize-run-rail></div>`
							: html`<div class="empty-state">
								<h2>选择一个需求</h2>
								<p style="margin:0">从左侧列表选择,查看设计流水线并逐阶段驱动</p>
							</div>`
					}
				</main>
			</div>
			<baize-consent-modal
				.open=${this.consent != null}
				.title=${this.consent ? `通过「${this.consent.cn}」阶段?` : ""}
				.summary=${this.consent ? this.consentSummary(this.consent.cn, this.consent.refs) : ""}
				@baize-consent-confirm=${() => this.confirmConsent()}
				@baize-consent-cancel=${() => this.cancelConsent()}
			></baize-consent-modal>
		`;
	}
}

customElements.define("baize-requirement", BaizeRequirement);
