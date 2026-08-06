import { LitElement, html, css } from "lit";
import "./baize-markdown.js";

/**
 * baize-asset-library — 资产库(现代化):三 tab 分库(场景/用例/功能),列表+详情。
 * workspace 复用池。监听 window baize-workspace-change。
 */
interface AssetData {
	scenarios: Array<Record<string, unknown>>;
	usecases: Array<Record<string, unknown>>;
	functions: Array<{ domain: Record<string, unknown>; items: unknown[] }>;
}

const TABS = [
	{ id: "req", cn: "需求管理" },
	{ id: "scenario", cn: "场景" },
	{ id: "usecase", cn: "用例" },
	{ id: "function", cn: "功能" },
	{ id: "sediment", cn: "沉淀" },
] as const;

class BaizeAssetLibrary extends LitElement {
	static properties = {
		ws: { state: true },
		tab: { state: true },
		data: { state: true },
		selectedId: { state: true },
		view: { type: String },
		reqs: { state: true },
		busy: { state: true },
		sediment: { state: true },
		sedSub: { state: true },
		selGene: { state: true },
	};

	declare ws: number;
	declare tab: (typeof TABS)[number]["id"];
	declare data: AssetData | null;
	declare selectedId: number | null;
	declare view: string;
	declare reqs: Array<Record<string, unknown>>;
	declare busy: string;
	declare sediment: {
		packages: Array<Record<string, unknown>>;
		genes: Array<Record<string, unknown>>;
	} | null;
	declare sedSub: "pkg" | "gene";
	declare selGene: string | null;

	static styles = css`
		:host {
			display: block;
		}
		.page-head h1 {
			margin: 0;
			font-size: 1.4rem;
			font-weight: 650;
			letter-spacing: -0.01em;
		}
		.page-head .sub {
			margin: 4px 0 20px;
			color: var(--text-muted);
			font-size: 0.88rem;
		}
		.tabs {
			display: flex;
			gap: 4px;
			margin-bottom: 20px;
			border-bottom: 1px solid var(--border);
		}
		.tab {
			padding: 9px 18px;
			background: transparent;
			border: none;
			border-bottom: 2px solid transparent;
			color: var(--text-muted);
			cursor: pointer;
			font: inherit;
			font-size: 0.88rem;
			transition: color 0.2s, border-color 0.2s;
		}
		.tab:hover {
			color: var(--text);
		}
		.tab.active {
			color: var(--accent);
			border-bottom-color: var(--accent);
			font-weight: 600;
		}
		.body {
			display: grid;
			grid-template-columns: 320px 1fr;
			gap: var(--gap);
			min-height: 300px;
		}
		.list {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			overflow: auto;
			max-height: 62vh;
		}
		.item {
			padding: 11px 14px;
			border-bottom: 1px solid var(--border);
			cursor: pointer;
			color: var(--text-muted);
			font-size: 0.86rem;
			transition: background 0.15s, color 0.15s;
		}
		.item:last-child {
			border-bottom: none;
		}
		.item:hover {
			background: var(--surface-hover);
			color: var(--text);
		}
		.item.active {
			background: var(--surface-2);
			color: var(--text);
			border-left: 3px solid var(--accent);
		}
		.detail {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 20px;
		}
		.detail h3 {
			margin: 0 0 12px;
			font-size: 1rem;
			font-weight: 600;
		}
		.detail .k {
			color: var(--text-subtle);
			font-size: 0.72rem;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			margin-top: 12px;
		}
		.detail p {
			margin: 4px 0;
			color: var(--text-muted);
			font-size: 0.86rem;
			line-height: 1.6;
			white-space: pre-wrap;
		}
		.empty {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			padding: 48px 24px;
			color: var(--text-muted);
			background: var(--surface);
			border: 1px dashed var(--border-strong);
			border-radius: var(--radius);
			font-size: 0.86rem;
			grid-column: 1 / -1;
		}
		.fn-group {
			border-bottom: 1px solid var(--border);
		}
		.fn-group:last-child {
			border-bottom: none;
		}
		.fn-group .gname {
			color: var(--text);
			font-size: 0.86rem;
			font-weight: 600;
			padding: 10px 14px 4px;
		}
		.fn-item {
			padding: 7px 14px 7px 28px;
			color: var(--text-muted);
			font-size: 0.82rem;
			cursor: pointer;
			transition: background 0.15s, color 0.15s;
		}
		.fn-item:hover {
			background: var(--surface-hover);
			color: var(--text);
		}
		.fn-item.active {
			background: var(--surface-2);
			color: var(--text);
			border-left: 3px solid var(--accent);
		}
	`;

	constructor() {
		super();
		this.ws = Number(localStorage.getItem("baize.ui.v1.workspace") ?? "0");
		this.tab = "req";
		this.view = "req";
		this.reqs = [];
		this.data = null;
		this.selectedId = null;
		this.busy = "";
		this.sediment = null;
		this.sedSub = "pkg";
		this.selGene = null;
	}

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener(
			"baize-workspace-change",
			this.onWs as EventListener,
		);
		if (this.ws) void this.load();
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener(
			"baize-workspace-change",
			this.onWs as EventListener,
		);
	}

	private onWs = (e: CustomEvent<{ id: number }>) => {
		this.ws = e.detail.id;
		this.load();
	};

	protected updated(changed: Map<string, unknown>) {
		if (changed.has("view") && this.view) this.tab = this.view as (typeof TABS)[number]["id"];
	}

	private async load() {
		this.busy = "load";
		this.selectedId = null;
		try {
			const r = await fetch(`/api/assets?workspace=${this.ws}`);
			this.data = (await r.json()) as AssetData;
			const rr = await fetch(`/api/requirements?workspace=${this.ws}`);
			this.reqs = (await rr.json()) as Array<Record<string, unknown>>;
			await this.loadSediment();
		} catch {
			this.data = null;
			this.reqs = [];
		}
		this.busy = "";
	}

	private list(): Array<Record<string, unknown>> {
		if (!this.data) return [];
		if (this.tab === "req") return this.reqs ?? [];
		if (this.tab === "scenario") return this.data.scenarios;
		if (this.tab === "usecase") return this.data.usecases;
		return [];
	}

	private renderListDetail() {
		const items = this.list();
		const sel = items.find((x) => (x.id as number) === this.selectedId) ?? null;
		return html`
			<div class="list">
				${
					items.length
						? items.map(
								(x) => html`<div
								class="item ${x.id === this.selectedId ? "active" : ""}"
								@click=${() => (this.selectedId = x.id as number)}
							>
								${x.title ?? "(无标题)"}
							</div>`,
							)
						: html`<div class="empty">(无)</div>`
				}
			</div>
			<div class="detail">
				${sel ? this.renderDetail(sel) : html`<div class="empty">从左侧选择一项查看详情</div>`}
			</div>
		`;
	}

	private renderDetail(x: Record<string, unknown>) {
		if (this.tab === "scenario" || this.tab === "req") {
			return html`<h3>${x.title ?? ""}</h3><p>${x.description ?? ""}</p>`;
		}
		return html`
			<h3>${x.title ?? ""}</h3>
			${x.scenarioTitle ? html`<div class="k">所属场景</div><p>${x.scenarioTitle}</p>` : null}
			<div class="k">前置条件</div><p>${x.precondition || "—"}</p>
			<div class="k">主流程</div><p>${x.main_flow || "—"}</p>
			<div class="k">异常</div><p>${x.exceptions || "—"}</p>
			<div class="k">后置</div><p>${x.postcondition || "—"}</p>
		`;
	}

	private renderFunctions() {
		const groups = this.data?.functions ?? [];
		let selItem: Record<string, unknown> | null = null;
		let selDomain: Record<string, unknown> | null = null;
		for (const g of groups) {
			for (const it of g.items as Array<Record<string, unknown>>) {
				if ((it.id as number) === this.selectedId) {
					selItem = it;
					selDomain = g.domain;
				}
			}
		}
		return html`
			<div class="list">
				${
					groups.length
						? groups.map(
								(g) => html`<div class="fn-group">
								<div class="gname">${g.domain.name ?? "(无域)"}</div>
								${(g.items as Array<Record<string, unknown>>).map(
									(it) => html`<div
										class="fn-item ${it.id === this.selectedId ? "active" : ""}"
										@click=${() => (this.selectedId = it.id as number)}
									>
										${it.title ?? "(无标题)"}
									</div>`,
								)}
							</div>`,
							)
						: html`<div class="empty">(无)</div>`
				}
			</div>
			<div class="detail">
				${
					selItem
						? html`<h3>${selItem.title ?? ""}</h3>
							${selDomain ? html`<div class="k">所属功能域</div><p>${selDomain.name ?? "—"}</p>` : null}
							<div class="k">描述</div><p>${selItem.description || "—"}</p>`
						: html`<div class="empty">从左侧选择功能项查看详情</div>`
				}
			</div>
		`;
	}

	private async loadSediment() {
		try {
			const [sp, sg] = await Promise.all([
				fetch(`/api/sedimentation?workspace=${this.ws}`).then((r) => r.json()),
				fetch(`/api/genes`).then((r) => r.json()),
			]);
			this.sediment = {
				packages: (sp?.packages ?? []) as Array<Record<string, unknown>>,
				genes: (Array.isArray(sg) ? sg : (sg?.genes ?? [])) as Array<Record<string, unknown>>,
			};
		} catch {
			this.sediment = { packages: [], genes: [] };
		}
	}

	private renderSediment() {
		const s = this.sediment;
		if (!s) return html`<div class="empty">加载中…</div>`;
		return html`
			<div class="tabs">
				<button class="tab ${this.sedSub === "pkg" ? "active" : ""}" @click=${() => (this.sedSub = "pkg")}>决策记录</button>
				<button class="tab ${this.sedSub === "gene" ? "active" : ""}" @click=${() => (this.sedSub = "gene")}>gene</button>
			</div>
			<div class="body">
				${this.sedSub === "pkg" ? this.renderPkgListDetail(s.packages) : this.renderGeneListDetail(s.genes)}
			</div>
		`;
	}

	private renderPkgListDetail(pkgs: Array<Record<string, unknown>>) {
		const sel = pkgs.find((x) => (x.id as number) === this.selectedId) ?? null;
		return html`
			<div class="list">
				${
					pkgs.length
						? pkgs.map(
								(x) => html`<div
								class="item ${x.id === this.selectedId ? "active" : ""}"
								@click=${() => (this.selectedId = x.id as number)}
							>
								${x.title ?? "(无标题)"}
							</div>`,
							)
						: html`<div class="empty">(暂无归档决策记录)</div>`
				}
			</div>
			<div class="detail">
				${
					sel
						? html`<h3>${sel.title ?? ""}</h3><baize-markdown .text=${String(sel.content ?? "")}></baize-markdown>`
						: html`<div class="empty">从左侧选择一项查看详情</div>`
				}
			</div>
		`;
	}

	private renderGeneListDetail(genes: Array<Record<string, unknown>>) {
		const sel = genes.find((x) => String(x.id) === this.selGene) ?? null;
		return html`
			<div class="list">
				${
					genes.length
						? genes.map(
								(g) => html`<div
								class="item ${String(g.id) === this.selGene ? "active" : ""}"
								@click=${() => (this.selGene = String(g.id))}
							>
								${g.summary ?? g.id ?? "(无)"}
							</div>`,
							)
						: html`<div class="empty">(暂无 gene)</div>`
				}
			</div>
			<div class="detail">
				${sel ? this.renderGeneDetail(sel) : html`<div class="empty">从左侧选择 gene 查看详情</div>`}
			</div>
		`;
	}

	private renderGeneDetail(g: Record<string, unknown>) {
		const md = (v: unknown) => String(v ?? "—");
		return html`
			<h3>${g.summary ?? g.id ?? ""}</h3>
			<div class="k">前置条件</div><baize-markdown .text=${md(g.preconditions)}></baize-markdown>
			<div class="k">策略</div><baize-markdown .text=${md(g.strategy)}></baize-markdown>
			<div class="k">验证</div><baize-markdown .text=${md(g.validation)}></baize-markdown>
			<div class="k">约束</div><baize-markdown .text=${md(g.constraints)}></baize-markdown>
			${g._source ? html`<div class="k">来源</div><p>${String(g._source)}</p>` : null}
		`;
	}

	render() {
		return html`
			<header class="page-head">
				<h1>${TABS.find((t) => t.id === this.tab)?.cn ?? "资产库"}</h1>
				<p class="sub">workspace 复用池,跨需求沉淀</p>
			</header>
			${
				!this.ws
					? html`<div class="empty">请先在顶部选择工作区</div>`
					: this.tab === "function"
						? html`<div class="body">${this.renderFunctions()}</div>`
						: this.tab === "sediment"
							? html`${this.renderSediment()}`
							: html`<div class="body">${this.renderListDetail()}</div>`
			}
		`;
	}
}

customElements.define("baize-asset-library", BaizeAssetLibrary);
