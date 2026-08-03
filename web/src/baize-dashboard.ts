import { LitElement, html, css } from "lit";

/**
 * baize-dashboard — 复用可见性:repo 选择 → mcp 证据(hotspots/boundaries/clusters)+
 * 历史 ADR + 已蒸馏 gene。Dark token 化;数据用 mono。
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
		}
		.repos {
			display: flex;
			gap: .4rem;
			margin-bottom: 1rem;
		}
		.repos button {
			background: var(--surface);
			color: var(--text-muted);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: .4rem .9rem;
			font: inherit;
			font-size: .8rem;
			font-family: var(--font-mono);
			cursor: pointer;
			transition: color .2s, border-color .2s, background .2s;
		}
		.repos button:hover {
			color: var(--text);
		}
		.repos button.active {
			background: var(--accent);
			border-color: var(--accent);
			color: #052e16;
			font-weight: 600;
		}
		.cols {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 1rem;
		}
		@media (max-width: 768px) {
			.cols {
				grid-template-columns: 1fr;
			}
		}
		.card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 1rem;
		}
		h3 {
			font-size: .74rem;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: .06em;
			margin: 0 0 .5rem;
		}
		h3 + h3,
		ul + h3 {
			margin-top: 1rem;
		}
		ul {
			margin: 0;
			padding-left: 1.1rem;
			font-size: .78rem;
			font-family: var(--font-mono);
			color: var(--text);
		}
		li {
			margin-bottom: .25rem;
		}
		li .num {
			color: var(--accent-2);
		}
		pre {
			white-space: pre-wrap;
			background: var(--bg);
			border: 1px solid var(--border);
			color: var(--text);
			padding: .7rem;
			border-radius: 6px;
			font-size: .76rem;
			font-family: var(--font-mono);
			max-height: 240px;
			overflow: auto;
		}
		.empty {
			color: var(--text-muted);
			font-size: .78rem;
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
				<div class="card">
					<h3>高影响热点(fan_in)</h3>
					${
						a?.hotspots?.length
							? html`<ul>
								${a.hotspots.map(
									(h) =>
										html`<li>
											${h.qualified_name}
											<span class="num">(${h.fan_in})</span>
										</li>`,
								)}
							</ul>`
							: html`<div class="empty">无(先跑 scripts/evidence.sh)</div>`
					}
					<h3>跨包边界</h3>
					${
						a?.boundaries?.length
							? html`<ul>
								${a.boundaries.map(
									(b) =>
										html`<li>
											${b.from} → ${b.to}
											<span class="num">(${b.call_count})</span>
										</li>`,
								)}
							</ul>`
							: html`<div class="empty">无</div>`
					}
					<h3>真实模块(Leiden)</h3>
					${
						a?.clusters?.length
							? html`<ul>
								${a.clusters.map(
									(c) =>
										html`<li>
											${(c.top_nodes ?? []).slice(0, 3).join("/")}
											<span class="num"
												>(cohesion ${Number(c.cohesion).toFixed(2)})</span
											>
										</li>`,
								)}
							</ul>`
							: html`<div class="empty">无</div>`
					}
				</div>
				<div class="card">
					<h3>历史决策(ADR,沉淀复用)</h3>
					${
						adr
							? html`<pre>${adr}</pre>`
							: html`<div class="empty">无(先跑 scripts/evolve.sh)</div>`
					}
					<h3>已蒸馏 gene(${this.genes.length})</h3>
					${
						this.genes.length
							? html`<ul>
								${this.genes.map(
									(g) =>
										html`<li>
											${String(g.summary ?? g.id ?? "").slice(0, 90)}
										</li>`,
								)}
							</ul>`
							: html`<div class="empty">无</div>`
					}
				</div>
			</div>
		`;
	}
}

customElements.define("baize-dashboard", BaizeDashboard);
