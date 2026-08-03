import { LitElement, html, css } from "lit";

/** T04 需求设计页:需求列表 + 5 阶段进展 + 逐阶段触发 run + 人工审。 */
interface Req {
	id: number;
	workspace_id: number;
	title: string;
	description: string;
}
interface StageRow {
	requirement_id: number;
	stage: string;
	status: string;
	artifact_refs: string;
}

const STAGE_EN: Record<string, string> = {
	分析: "analysis",
	场景: "scenario",
	用例: "usecase",
	功能分解: "function",
};
const STAGES = ["分析", "场景", "用例", "功能分解"];

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
	};

	declare reqs: Req[];
	declare workspaceId: number;
	declare workspaces: Array<{ id: number; name: string }>;
	declare selected: number;
	declare stages: StageRow[];
	declare title: string;
	declare desc: string;
	declare busy: string;

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
		input {
			background: var(--bg);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: .45rem .6rem;
			font: inherit;
			font-size: .82rem;
			margin-right: .4rem;
		}
		.req {
			padding: .4rem .6rem;
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
		.stage {
			display: flex;
			align-items: center;
			gap: .6rem;
			padding: .5rem .6rem;
			border: 1px solid var(--border);
			border-radius: 6px;
			margin-bottom: .4rem;
		}
		.stage .name {
			width: 4.5rem;
			font-weight: 600;
			font-size: .82rem;
		}
		.status {
			font-size: .7rem;
			padding: .12rem .5rem;
			border-radius: 999px;
			font-weight: 600;
		}
		.status.完成 {
			background: rgba(34, 197, 94, .15);
			color: var(--accent);
		}
		.status.待审 {
			background: rgba(245, 158, 11, .15);
			color: var(--warn);
		}
		.status.未开始,
		.status.进行中 {
			background: var(--surface-2);
			color: var(--text-muted);
		}
		button {
			margin-left: auto;
			background: var(--surface-2);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: .25rem .7rem;
			font: inherit;
			font-size: .74rem;
			cursor: pointer;
		}
		button:hover {
			border-color: var(--accent);
			color: var(--accent);
		}
		button[disabled] {
			opacity: .4;
			cursor: default;
		}
		.refs {
			font-family: var(--font-mono);
			font-size: .7rem;
			color: var(--text-muted);
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
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		this.workspaces = (await (await fetch("/api/workspaces")).json()) as Array<{
			id: number;
			name: string;
		}>;
		if (this.workspaces.length) {
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
		this.stages = (await (
			await fetch(`/api/requirements/${r.id}/stages`)
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
	}

	async runStage(stage: string): Promise<void> {
		this.busy = stage;
		await fetch(`/api/requirements/${this.selected}/stage/${STAGE_EN[stage]}/run`, {
			method: "POST",
		});
		this.busy = "";
		await this.pick({ id: this.selected } as Req);
	}

	async approveStage(stage: string): Promise<void> {
		await fetch(`/api/requirements/${this.selected}/stage/${STAGE_EN[stage]}/approve`, {
			method: "POST",
		});
		await this.pick({ id: this.selected } as Req);
	}

	render() {
		return html`
			<div class="card">
				<h3>需求管理</h3>
				<select
					.value=${String(this.workspaceId)}
					@change=${(e: Event) => {
						this.workspaceId = Number((e.target as HTMLSelectElement).value);
						this.loadReqs();
					}}
				>
					${this.workspaces.map((w) => html`<option value=${w.id}>${w.name}</option>`)}
				</select>
				<input
					placeholder="需求标题"
					.value=${this.title}
					@input=${(e: Event) => (this.title = (e.target as HTMLInputElement).value)}
				/>
				<button @click=${() => this.addReq()}>录入需求</button>
				<div style="margin-top:.7rem">
					${this.reqs.map(
						(r) => html`<div
							class="req ${r.id === this.selected ? "active" : ""}"
							@click=${() => this.pick(r)}
						>
							${r.title}
						</div>`,
					)}
				</div>
			</div>
			${this.selected
				? html`<div class="card">
						<h3>设计进展(逐阶段)</h3>
						${STAGES.map((s) => {
							const row = this.stages.find((x) => x.stage === s);
							const st = row?.status ?? "未开始";
							const refs = row?.artifact_refs ?? "[]";
							return html`<div class="stage">
								<span class="name">${s}</span>
								<span class="status ${st}">${st}</span>
								<span class="refs">${refs === "[]" ? "" : refs.slice(0, 60)}</span>
								<button
									?disabled=${this.busy !== ""}
									@click=${() => this.runStage(s)}
								>
									${this.busy === s ? "运行中…" : "run"}
								</button>
								${st === "待审"
									? html`<button @click=${() => this.approveStage(s)}>审→完成</button>`
									: ""}
							</div>`;
						})}
					</div>`
				: ""}
		`;
	}
}

customElements.define("baize-requirement", BaizeRequirement);
