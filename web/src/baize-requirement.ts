import { LitElement, html, css, nothing } from "lit";
import "./baize-consent-modal.ts";

/**
 * 需求设计 — 旅程主视图(master-detail):左需求列表,右设计流水线。
 * ws 全局跟随(读 localStorage + 监听 baize-workspace-change);新建需求走 chat-intake(T05);
 * 审批 consent gate(baize-consent-modal);打回带意见重跑。逻辑方法保留自原版。
 */
interface Req {
	id: number;
	title: string;
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
	};

	declare reqs: Req[];
	declare workspaceId: number;
	declare selected: number;
	declare stages: StageRow[];
	declare busy: string;
	declare error: string;
	declare feedback: string;
	declare consent: { cn: string; en: string; refs: Ref[] } | null;

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
	}

	async reloadStages(): Promise<void> {
		this.stages = (await (
			await fetch(`/api/requirements/${this.selected}/stages`)
		).json()) as StageRow[];
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
	}

	async approve(cn: string, en: string): Promise<void> {
		const ok = await this.post(
			`/api/requirements/${this.selected}/stage/${en}/approve`,
		);
		if (ok) await this.reloadStages();
		await this.loadReqs();
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
		}
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
							? html`<div class="detail-card">
								<h3>设计流水线(逐阶段审核,打回可带意见重跑)</h3>
								<div class="stepper">
									${STAGES.map((s) => {
										const st = this.stages.find((x) => x.stage === s.cn)?.status ?? "未开始";
										return html`<div class="step ${st}"><span class="dot"></span>${s.cn}</div>`;
									})}
								</div>
								${STAGES.map((s) => this.renderStage(s))}
								${this.error ? html`<div class="error">${this.error}</div>` : nothing}
							</div>`
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
