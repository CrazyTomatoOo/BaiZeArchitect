import { LitElement, html, css } from "lit";

/**
 * baize-dashboard — 复用可见性:repo 选择 → 该 repo 的 mcp 证据(hotspots/boundaries/
 * clusters)+ 历史 ADR(沉淀)+ 已蒸馏 gene。即"下次设计会注入什么"的仪表盘。
 * ponytail: 只读展示,不引图表库;hotspots/boundaries 用列表。
 */
interface Evidence {
	repositoryId?: string;
	architecture?: {
		hotspots?: Array<{ name: string; qualified_name: string; fan_in: number }>;
		boundaries?: Array<{ from: string; to: string; call_count: number }>;
		clusters?: Array<{
			label: string;
			members: number;
			cohesion: number;
			top_nodes: string[];
		}>;
	};
	priorAdr?: { content?: string; status?: string };
}

class BaizeDashboard extends LitElement {
	static properties = {
		repos: { state: true },
		repo: { state: true },
		evidence: { state: true },
		genes: { state: true },
	};

	declare repos: string[];
	declare repo: string;
	declare evidence: Evidence | null;
	declare genes: Array<Record<string, unknown>>;

	static styles = css`
		:host {
			display: block;
			font-family: system-ui, sans-serif;
			max-width: 960px;
			margin: 0 auto;
			padding: 1rem;
		}
		h2 {
			font-size: 1rem;
		}
		h3 {
			font-size: .85rem;
			margin: .8rem 0 .3rem;
		}
		.repos {
			display: flex;
			gap: .4rem;
			margin-bottom: .8rem;
		}
		.repos button {
			padding: .3rem .7rem;
			cursor: pointer;
		}
		.repos button.active {
			background: #2563eb;
			color: #fff;
		}
		.cols {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 1rem;
		}
		ul {
			margin: 0;
			padding-left: 1.1rem;
			font-size: .8rem;
		}
		pre {
			white-space: pre-wrap;
			background: #f5f5f5;
			padding: .5rem;
			border-radius: 4px;
			font-size: .78rem;
			max-height: 220px;
			overflow: auto;
		}
		.empty {
			color: #888;
			font-size: .8rem;
		}
	`;

	constructor() {
		super();
		this.repos = [];
		this.repo = "";
		this.evidence = null;
		this.genes = [];
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		await this.loadRepos();
		await this.loadGenes();
	}

	async loadRepos(): Promise<void> {
		this.repos = (await (await fetch("/api/repos")).json()) as string[];
		if (this.repos.length && !this.repo) {
			this.repo = this.repos[0];
			await this.loadEvidence();
		}
	}

	async loadGenes(): Promise<void> {
		this.genes = (await (await fetch("/api/genes")).json()) as Array<
			Record<string, unknown>
		>;
	}

	async loadEvidence(): Promise<void> {
		if (!this.repo) return;
		this.evidence = (await (
			await fetch(`/api/evidence/${encodeURIComponent(this.repo)}`)
		).json()) as Evidence | null;
	}

	async pick(r: string): Promise<void> {
		this.repo = r;
		await this.loadEvidence();
	}

	render() {
		const a = this.evidence?.architecture;
		const adr = this.evidence?.priorAdr?.content?.trim();
		return html`
			<h2>复用仪表盘(evidence / ADR / gene)</h2>
			<div class="repos">
				${this.repos.map(
					(r) => html`<button
						class=${r === this.repo ? "active" : ""}
						@click=${() => this.pick(r)}
					>
						${r}
					</button>`,
				)}
			</div>
			<div class="cols">
				<div>
					<h3>高影响热点(fan_in)</h3>
					${a?.hotspots?.length
						? html`<ul>
								${a.hotspots.map(
									(h) => html`<li>${h.qualified_name} (${h.fan_in})</li>`,
								)}
							</ul>`
						: html`<div class="empty">无(先跑 scripts/evidence.sh)</div>`}
					<h3>跨包边界</h3>
					${a?.boundaries?.length
						? html`<ul>
								${a.boundaries.map(
									(b) =>
										html`<li>${b.from} → ${b.to} (${b.call_count})</li>`,
								)}
							</ul>`
						: html`<div class="empty">无</div>`}
					<h3>真实模块(Leiden)</h3>
					${a?.clusters?.length
						? html`<ul>
								${a.clusters.map(
									(c) =>
										html`<li>
											${(c.top_nodes ?? []).slice(0, 3).join("/")}
											(cohesion ${Number(c.cohesion).toFixed(2)})
										</li>`,
								)}
							</ul>`
						: html`<div class="empty">无</div>`}
				</div>
				<div>
					<h3>历史决策(ADR,沉淀复用)</h3>
					${adr
						? html`<pre>${adr}</pre>`
						: html`<div class="empty">无(先跑 scripts/evolve.sh)</div>`}
					<h3>已蒸馏 gene(${this.genes.length})</h3>
					${this.genes.length
						? html`<ul>
								${this.genes.map(
									(g) =>
										html`<li>${String(g.summary ?? g.id ?? "").slice(0, 90)}</li>`,
								)}
							</ul>`
						: html`<div class="empty">无</div>`}
				</div>
			</div>
		`;
	}
}

customElements.define("baize-dashboard", BaizeDashboard);
