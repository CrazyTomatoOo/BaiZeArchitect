import { LitElement, html, css, nothing } from "lit";

/**
 * 需求设计 — 旅程主视图:工作区选择 → 需求列表(工作中/已完成)→ 阶段流水线。
 * 流水线:分析→场景→用例→功能分解→功能设计→归档;门禁串行,待审可 通过/打回(意见)→重跑。
 */
interface Req {
	id: number;
	workspace_id: number;
	title: string;
	description: string;
	done?: boolean;
	current?: string;
}
interface StageRow {
	requirement_id: number;
	stage: string;
	status: string;
	artifact_refs: string;
	feedback: string;
}
interface Ref {
	type?: string;
	id?: number;
	title?: string;
	name?: string;
	description?: string;
	file?: string;
	content?: unknown;
	scenarioTitle?: string;
	precondition?: string;
	mainFlow?: string;
	exceptions?: string;
	postcondition?: string;
	items?: Array<{ title?: string; description?: string }>;
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
		workspaces: { state: true },
		selected: { state: true },
		stages: { state: true },
		title: { state: true },
		desc: { state: true },
		busy: { state: true },
		error: { state: true },
		feedback: { state: true },
		consent: { state: true },
	};

	declare reqs: Req[];
	declare workspaceId: number;
	declare workspaces: Array<{ id: number; name: string }>;
	declare selected: number;
	declare stages: StageRow[];
	declare title: string;
	declare desc: string;
	declare busy: string;
	declare error: string;
	declare feedback: string;
	declare consent: { cn: string; en: string; refs: Ref[] } | null;

	static styles = css`
		:host {
			display: block;
		}
		.card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 1rem;
			margin-bottom: 1rem;
		}
		h3 {
			margin: 0 0 .6rem;
			font-size: .8rem;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: .06em;
		}
		select,
		input,
		textarea {
			background: var(--bg);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: .45rem .6rem;
			font: inherit;
			font-size: .82rem;
		}
		select,
		input {
			margin-right: .4rem;
		}
		textarea {
			width: 100%;
			box-sizing: border-box;
			resize: vertical;
			margin-top: .4rem;
		}
		.req {
			display: flex;
			align-items: center;
			gap: .6rem;
			padding: .45rem .6rem;
			border: 1px solid var(--border);
			border-radius: 6px;
			margin-bottom: .3rem;
			cursor: pointer;
			font-size: .82rem;
		}
		.req.active {
			border-color: var(--accent);
			color: var(--accent);
		}
		.req .hint {
			margin-left: auto;
			font-size: .72rem;
			color: var(--text-muted);
		}
		.stage {
			border: 1px solid var(--border);
			border-radius: 6px;
			margin-bottom: .5rem;
			padding: .55rem .7rem;
		}
		.stage .head {
			display: flex;
			align-items: center;
			gap: .6rem;
		}
		.stage .name {
			width: 4.8rem;
			font-weight: 600;
			font-size: .82rem;
		}
		.status {
			font-size: .7rem;
			padding: .12rem .5rem;
			border-radius: 999px;
			font-weight: 600;
			white-space: nowrap;
		}
		.status.完成 {
			background: rgba(34, 197, 94, .15);
			color: var(--accent);
		}
		.status.待审 {
			background: rgba(245, 158, 11, .15);
			color: var(--warn);
		}
		.status.打回 {
			background: rgba(239, 68, 68, .15);
			color: #f87171;
		}
		.status.未开始 {
			background: var(--surface-2);
			color: var(--text-muted);
		}
		button {
			background: var(--surface-2);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: .25rem .7rem;
			font: inherit;
			font-size: .74rem;
			cursor: pointer;
		}
		button:hover:not([disabled]) {
			border-color: var(--accent);
			color: var(--accent);
		}
		button[disabled] {
			opacity: .4;
			cursor: default;
		}
		button.primary {
			background: var(--accent);
			border-color: var(--accent);
			color: #052e16;
			font-weight: 600;
		}
		.head button {
			margin-left: auto;
		}
		.refs {
			margin-top: .5rem;
			border-top: 1px dashed var(--border);
			padding-top: .5rem;
			font-size: .8rem;
		}
		.refs .item {
			margin-bottom: .55rem;
		}
		.refs .item b {
			font-size: .8rem;
		}
		.refs .item p {
			margin: .15rem 0 0;
			color: var(--text-muted);
			font-size: .76rem;
			white-space: pre-wrap;
		}
		.refs pre {
			margin: .2rem 0 0;
			background: var(--bg);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: .5rem;
			font-size: .72rem;
			max-height: 260px;
			overflow: auto;
			white-space: pre-wrap;
		}
		.fb {
			margin-top: .5rem;
			padding: .5rem .6rem;
			border-left: 3px solid var(--warn);
			background: var(--surface-2);
			border-radius: 0 6px 6px 0;
			font-size: .76rem;
			color: var(--text-muted);
			white-space: pre-wrap;
		}
		.error {
			margin-top: .6rem;
			padding: .5rem .7rem;
			border: 1px solid rgba(239, 68, 68, .4);
			border-radius: 6px;
			color: #f87171;
			font-size: .78rem;
		}
		.empty {
			color: var(--text-muted);
			font-size: .8rem;
			padding: .4rem 0;
		}
	`;

	constructor() {
		super();
		this.reqs = [];
		this.workspaceId = 0;
		this.workspaces = [];
		this.selected = 0;
		this.stages = [];
		this.title = "";
		this.desc = "";
		this.busy = "";
		this.error = "";
		this.feedback = "";
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		await this.loadWorkspaces();
	}

	async loadWorkspaces(): Promise<void> {
		this.workspaces = (await (await fetch("/api/workspaces")).json()) as Array<{
			id: number;
			name: string;
		}>;
		if (this.workspaces.length && !this.workspaceId) {
			this.workspaceId = this.workspaces[0].id;
			await this.loadReqs();
		}
	}

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

	async addReq(): Promise<void> {
		if (!this.title) return;
		await fetch("/api/requirements", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				workspaceId: this.workspaceId,
				title: this.title,
				description: this.desc,
			}),
		});
		this.title = "";
		this.desc = "";
		await this.loadReqs();
		const last = this.reqs[this.reqs.length - 1];
		if (last) await this.pick(last); // 新需求直接进入流水线(新用户旅程第 2 步)
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
		const items = refs.map((r) => html`<li>${r.title ?? r.name ?? r.type}</li>`);
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
		if (!this.workspaces.length) {
			return html`<div class="card">
				<h3>第一步:创建工作区</h3>
				<p class="empty">还没有工作区。工作区对应一个代码仓库,是设计需求的载体。</p>
				<button
					class="primary"
					@click=${() =>
						this.dispatchEvent(
							new CustomEvent("baize-goto", {
								bubbles: true,
								composed: true,
								detail: { tab: "workspaces" },
							}),
						)}
				>
					去创建工作区 →
				</button>
			</div>`;
		}
		return html`
			<div class="card">
				<h3>需求列表</h3>
				<select
					.value=${String(this.workspaceId)}
					@change=${(e: Event) => {
						this.workspaceId = Number((e.target as HTMLSelectElement).value);
						this.selected = 0;
						this.loadReqs();
					}}
				>
					${this.workspaces.map((w) => html`<option value=${w.id}>${w.name}</option>`)}
				</select>
				<div style="margin-top:.7rem">
					${
						this.reqs.length
							? this.reqs.map(
									(r) => html`<div
										class="req ${r.id === this.selected ? "active" : ""}"
										@click=${() => this.pick(r)}
									>
										<span class="status ${r.done ? "完成" : "待审"}">
											${r.done ? "已完成" : "工作中"}
										</span>
										${r.title}
										<span class="hint">${r.done ? "已归档" : `当前:${r.current}`}</span>
									</div>`,
								)
							: html`<div class="empty">本工作区还没有需求,先在下方录入。</div>`
					}
				</div>
				<div style="margin-top:.8rem;display:flex;gap:.5rem">
					<input
						style="flex:1"
						placeholder="需求标题"
						.value=${this.title}
						@input=${(e: Event) => (this.title = (e.target as HTMLInputElement).value)}
					/>
					<input
						style="flex:2"
						placeholder="需求描述(可选)"
						.value=${this.desc}
						@input=${(e: Event) => (this.desc = (e.target as HTMLInputElement).value)}
					/>
					<button class="primary" @click=${() => this.addReq()}>录入需求</button>
				</div>
			</div>
			${
				this.selected
					? html`<div class="card">
						<h3>设计流水线(逐阶段审核,打回可带意见重跑)</h3>
						${STAGES.map((s) => this.renderStage(s))} ${
							this.error
								? html`<div class="error">${this.error}</div>`
								: nothing
						}
					</div>`
					: nothing
			}
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
