import { LitElement, html, css } from "lit";

/**
 * baize-overview — 总览仪表盘(T06 §6.3):计数卡片 + 各工作区进展条。
 * 数据:GET /api/overview(counts)+ /api/workspaces + 每 ws /api/requirements(N+1,workspace 少可接受)。
 * 待决策计数 / 近期活动流待 step7(待决策页带 pending 端点)接入。
 */
interface WsProgress {
	id: number;
	name: string;
	total: number;
	done: number;
	running: number;
}

const COUNTS: Array<[string, string]> = [
	["workspaces", "工作区"],
	["requirements", "需求"],
	["scenarios", "场景"],
	["use_cases", "用例"],
	["function_domains", "功能域"],
	["function_items", "功能项"],
];

class BaizeOverview extends LitElement {
	static properties = {
		counts: { state: true },
		wsProgress: { state: true },
		busy: { state: true },
	};

	declare counts: Record<string, number>;
	declare wsProgress: WsProgress[];
	declare busy: string;

	static styles = css`
		:host {
			display: block;
		}
		h2 {
			margin: 0 0 var(--gap);
			font-size: 1rem;
		}
		section + section {
			margin-top: calc(var(--gap) * 2);
		}
		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
			gap: var(--gap);
		}
		.card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: var(--pad);
		}
		.num {
			font-size: 1.7rem;
			font-weight: 700;
			color: var(--accent);
			font-family: var(--font-mono);
		}
		.label {
			font-size: 0.76rem;
			color: var(--text-muted);
			margin-top: 0.2rem;
		}
		.ws-list {
			display: flex;
			flex-direction: column;
			gap: var(--gap);
		}
		.ws-row {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: var(--pad);
		}
		.ws-row .top {
			display: flex;
			align-items: center;
			gap: var(--gap);
			margin-bottom: 8px;
		}
		.ws-row .name {
			font-weight: 600;
			font-size: 0.9rem;
		}
		.ws-row .meta {
			color: var(--text-muted);
			font-size: 0.8rem;
			font-family: var(--font-mono);
			margin-left: auto;
		}
		.bar {
			height: 6px;
			background: var(--surface-2);
			border-radius: 99px;
			overflow: hidden;
		}
		.bar .fill {
			height: 100%;
			background: var(--accent);
			border-radius: 99px;
		}
		.running {
			color: var(--run);
		}
		.empty {
			color: var(--text-subtle);
			font-size: 0.85rem;
			padding: var(--pad);
		}
	`;

	constructor() {
		super();
		this.counts = {};
		this.wsProgress = [];
		this.busy = "";
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		this.busy = "load";
		try {
			const [c, ws] = (await Promise.all([
				fetch("/api/overview").then((r) => r.json()),
				fetch("/api/workspaces").then((r) => r.json()),
			])) as [
				Record<string, number>,
				Array<{ id: number; name: string }>,
			];
			this.counts = c;
			// ponytail: N+1 per workspace(/api/requirements 每 ws);workspace 少可接受
			const progress: WsProgress[] = [];
			for (const w of ws) {
				const reqs = (await (
					await fetch(`/api/requirements?workspace=${w.id}`)
				).json()) as Array<{ done: boolean; current: string }>;
				progress.push({
					id: w.id,
					name: w.name,
					total: reqs.length,
					done: reqs.filter((r) => r.done).length,
					running: reqs.filter((r) => r.current && !r.done).length,
				});
			}
			this.wsProgress = progress;
		} catch {
			// 静默:counts/wsProgress 留空,UI 显空态
		}
		this.busy = "";
	}

	render() {
		return html`
			<h2>总览</h2>
			<section>
				<div class="grid">
					${COUNTS.map(
						([k, label]) => html`
							<div class="card">
								<div class="num">${this.counts[k] ?? 0}</div>
								<div class="label">${label}</div>
							</div>
						`,
					)}
				</div>
			</section>
			<section>
				<h2>各工作区进展</h2>
				${!this.wsProgress.length
					? html`<div class="empty">
							${this.busy ? "加载中…" : "还没有工作区。"}
						</div>`
					: html`<div class="ws-list">
							${this.wsProgress.map((w) => {
								const pct = w.total
									? Math.round((w.done / w.total) * 100)
									: 0;
								return html`
									<div class="ws-row">
										<div class="top">
											<span class="name">${w.name}</span>
											<span class="meta">
												${w.done}/${w.total} 完成${w.running
													? html` · <span class="running">▶ ${w.running} 进行中</span>`
													: ""}
											</span>
										</div>
										<div class="bar">
											<div class="fill" style="width:${pct}%"></div>
										</div>
									</div>
								`;
							})}
						</div>`}
			</section>
		`;
	}
}

customElements.define("baize-overview", BaizeOverview);
