import { LitElement, html, css } from "lit";

/**
 * baize-overview — 总览仪表盘(现代化):计数卡片 + 各工作区进展条。
 * 数据:GET /api/overview(counts)+ /api/workspaces + 每 ws /api/requirements(N+1,workspace 少可接受)。
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
	["design_sessions", "设计会话"],
	["runs", "Runs"],
	["artifacts", "产物"],
	["decisions", "Decision"],
	["findings", "Finding"],
	["design_packages", "DesignPackage"],
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
		.page-head h1 {
			margin: 0;
			font-size: 1.4rem;
			font-family: var(--font-display);
			font-weight: 600;
			letter-spacing: -0.01em;
		}
		.page-head .sub {
			margin: 4px 0 24px;
			color: var(--text-muted);
			font-size: 0.88rem;
		}
		/* 计数卡片 */
		.stats {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
			gap: var(--gap);
			margin-bottom: 32px;
		}
		.stat {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 16px;
			position: relative;
			overflow: hidden;
			transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
		}
		.stat:hover {
			border-color: var(--border-strong);
			transform: translateY(-2px);
		}
		.stat::before {
			content: "";
			position: absolute;
			left: 0;
			top: 0;
			bottom: 0;
			width: 3px;
			background: var(--accent);
			opacity: 0.7;
		}
		.stat .num {
			font-size: 1.9rem;
			font-weight: 700;
			color: var(--text);
			font-family: var(--font-mono);
			font-variant-numeric: tabular-nums;
			line-height: 1.1;
		}
		.stat .label {
			font-size: 0.76rem;
			color: var(--text-muted);
			margin-top: 6px;
		}
		/* 工作区进展 */
		.section-title {
			margin: 0 0 14px;
			font-size: 1rem;
			font-weight: 600;
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
			padding: 16px;
			transition: border-color 0.2s;
		}
		.ws-row:hover {
			border-color: var(--border-strong);
		}
		.ws-top {
			display: flex;
			align-items: center;
			gap: 10px;
			margin-bottom: 10px;
		}
		.ws-name {
			font-weight: 600;
			font-size: 0.92rem;
		}
		.ws-meta {
			margin-left: auto;
			color: var(--text-muted);
			font-size: 0.78rem;
			font-family: var(--font-mono);
		}
		.ws-meta .running {
			color: var(--run);
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
			transition: width 0.4s ease;
		}
		.empty {
			display: flex;
			flex-direction: column;
			align-items: center;
			padding: 48px 24px;
			color: var(--text-muted);
			background: var(--surface);
			border: 1px dashed var(--border-strong);
			border-radius: var(--radius);
			font-size: 0.86rem;
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
			])) as [Record<string, number>, Array<{ id: number; name: string }>];
			this.counts = c;
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
			<header class="page-head">
				<h1>总览</h1>
				<p class="sub">跨工作区的资产与需求进展一览</p>
			</header>
			<div class="stats">
				${COUNTS.map(
					([k, label]) => html`
						<div class="stat">
							<div class="num">${this.counts[k] ?? 0}</div>
							<div class="label">${label}</div>
						</div>
					`,
				)}
			</div>
			<h3 class="section-title">各工作区进展</h3>
			${
				!this.wsProgress.length
					? html`<div class="empty">${this.busy ? "加载中…" : "还没有工作区,先去工作区页创建一个"}</div>`
					: html`<div class="ws-list">
						${this.wsProgress.map((w) => {
							const pct = w.total ? Math.round((w.done / w.total) * 100) : 0;
							return html`
								<div class="ws-row">
									<div class="ws-top">
										<span class="ws-name">${w.name}</span>
										<span class="ws-meta">
											${w.done}/${w.total} 完成${
												w.running
													? html` · <span class="running">▶ ${w.running} 进行中</span>`
													: ""
											}
										</span>
									</div>
									<div class="bar">
										<div class="fill" style="width:${pct}%"></div>
									</div>
								</div>
							`;
						})}
					</div>`
			}
		`;
	}
}

customElements.define("baize-overview", BaizeOverview);
