import { LitElement, html, css } from "lit";

/**
 * baize-asset-library — 资产库页(T03/T06 F1):三 tab 分库(场景/用例/功能),
 * 列表+详情(workspace 复用池,跨需求可见)。GET /api/assets?workspace=。
 * workspace 选择器暂自持(step6 统一全局 workspace 作用域后改读共享状态)。
 */
interface AssetData {
	scenarios: Array<Record<string, unknown>>;
	usecases: Array<Record<string, unknown>>;
	functions: Array<{ domain: Record<string, unknown>; items: unknown[] }>;
}

const TABS = [
	{ id: "scenario", cn: "场景" },
	{ id: "usecase", cn: "用例" },
	{ id: "function", cn: "功能" },
] as const;

class BaizeAssetLibrary extends LitElement {
	static properties = {
		ws: { state: true },
		workspaces: { state: true },
		tab: { state: true },
		data: { state: true },
		selectedId: { state: true },
		busy: { state: true },
	};

	declare ws: number;
	declare workspaces: Array<{ id: number; name: string }>;
	declare tab: (typeof TABS)[number]["id"];
	declare data: AssetData | null;
	declare selectedId: number | null;
	declare busy: string;

	static styles = css`
		:host {
			display: block;
		}
		.head {
			display: flex;
			align-items: center;
			gap: var(--gap);
			margin-bottom: var(--gap);
		}
		h2 {
			margin: 0;
			font-size: 1rem;
		}
		select {
			background: var(--surface-2);
			border: 1px solid var(--border);
			color: var(--text);
			border-radius: var(--radius-sm);
			padding: 6px 8px;
			font: inherit;
			font-size: 0.85rem;
		}
		.tabs {
			display: flex;
			gap: 0.3rem;
			margin-bottom: var(--gap);
			border-bottom: 1px solid var(--border);
		}
		.tab {
			padding: 0.5rem 1rem;
			background: transparent;
			border: none;
			border-bottom: 2px solid transparent;
			color: var(--text-muted);
			cursor: pointer;
			font: inherit;
			font-size: 0.85rem;
		}
		.tab.active {
			color: var(--accent);
			border-bottom-color: var(--accent);
		}
		.body {
			display: grid;
			grid-template-columns: 300px 1fr;
			gap: var(--gap);
			min-height: 300px;
		}
		.list {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			overflow: auto;
			max-height: 60vh;
		}
		.item {
			padding: 8px 12px;
			border-bottom: 1px solid var(--border);
			cursor: pointer;
			color: var(--text-muted);
			font-size: 0.85rem;
		}
		.item:hover {
			background: var(--surface-hover);
			color: var(--text);
		}
		.item.active {
			background: var(--surface-2);
			color: var(--text);
		}
		.detail {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: var(--pad);
		}
		.detail h3 {
			margin: 0 0 8px;
			font-size: 0.95rem;
		}
		.detail p {
			margin: 4px 0;
			color: var(--text-muted);
			font-size: 0.85rem;
		}
		.detail .k {
			color: var(--text-subtle);
			font-size: 0.75rem;
			text-transform: uppercase;
			letter-spacing: 0.05em;
			margin-top: 10px;
		}
		.empty {
			color: var(--text-subtle);
			font-size: 0.85rem;
			padding: var(--pad);
		}
		.fn-group {
			padding: 8px 12px;
			border-bottom: 1px solid var(--border);
		}
		.fn-group .gname {
			color: var(--text);
			font-size: 0.85rem;
			font-weight: 600;
		}
		.fn-item {
			padding: 5px 12px 5px 24px;
			color: var(--text-muted);
			font-size: 0.82rem;
			cursor: pointer;
		}
		.fn-item:hover {
			background: var(--surface-hover);
			color: var(--text);
		}
		.fn-item.active {
			background: var(--surface-2);
			color: var(--text);
		}
	`;

	constructor() {
		super();
		this.ws = Number(localStorage.getItem("baize.ui.v1.workspace") ?? "0");
		this.workspaces = [];
		this.tab = "scenario";
		this.data = null;
		this.selectedId = null;
		this.busy = "";
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		this.addEventListener("baize-workspace-change", this.onWorkspaceChange as EventListener);
		if (this.ws) await this.load();
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		this.removeEventListener("baize-workspace-change", this.onWorkspaceChange as EventListener);
	}

	private async load() {
		this.busy = "load";
		this.selectedId = null;
		try {
			const r = await fetch(`/api/assets?workspace=${this.ws}`);
			this.data = (await r.json()) as AssetData;
		} catch {
			this.data = null;
		}
		this.busy = "";
	}

	private onWorkspaceChange = (e: CustomEvent<{ id: number }>) => {
		this.ws = e.detail.id;
		this.load();
	};
	private list(): Array<Record<string, unknown>> {
		if (!this.data) return [];
		if (this.tab === "scenario") return this.data.scenarios;
		if (this.tab === "usecase") return this.data.usecases;
		return [];
	}

	render() {
		return html`
		<div class="head">
			<h2>资产库</h2>
			<span class="empty">${this.busy ? "加载中…" : ""}</span>
		</div>
			<div class="tabs">
				${TABS.map(
					(t) => html`
						<button
							class="tab ${this.tab === t.id ? "active" : ""}"
							@click=${() => {
								this.tab = t.id;
								this.selectedId = null;
							}}
						>
							${t.cn}
						</button>
					`,
				)}
			</div>
			${
			!this.ws
				? html`<div class="empty">请先在顶部选择工作区。</div>`
					: this.tab === "function"
						? this.renderFunctions()
						: this.renderListDetail()
			}
		`;
	}

	private renderListDetail() {
		const items = this.list();
		const sel = items.find((x) => (x.id as number) === this.selectedId) ?? null;
		return html`
			<div class="body">
				<div class="list">
					${
						items.length
							? items.map(
									(x) => html`
									<div
										class="item ${x.id === this.selectedId ? "active" : ""}"
										@click=${() => (this.selectedId = x.id as number)}
									>
										${x.title ?? "(无标题)"}
									</div>
								`,
								)
							: html`<div class="empty">(无)</div>`
					}
				</div>
				<div class="detail">
					${
						sel
							? this.renderDetail(sel)
							: html`<div class="empty">从左侧选择一项查看详情</div>`
					}
				</div>
			</div>
		`;
	}

	private renderDetail(x: Record<string, unknown>) {
		if (this.tab === "scenario") {
			return html`<h3>${x.title ?? ""}</h3><p>${x.description ?? ""}</p>`;
		}
		return html`
			<h3>${x.title ?? ""}</h3>
			${
				x.scenarioTitle
					? html`<div class="k">所属场景</div><p>${x.scenarioTitle}</p>`
					: null
			}
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
			<div class="body">
				<div class="list">
					${
						groups.length
							? groups.map(
									(g) => html`
									<div class="fn-group">
										<div class="gname">${g.domain.name ?? "(无域)"}</div>
										${(g.items as Array<Record<string, unknown>>).map(
											(it) => html`
												<div
													class="fn-item ${it.id === this.selectedId ? "active" : ""}"
													@click=${() => (this.selectedId = it.id as number)}
												>
													${it.title ?? "(无标题)"}
												</div>
											`,
										)}
									</div>
								`,
								)
							: html`<div class="empty">(无)</div>`
					}
				</div>
				<div class="detail">
					${
						selItem
							? html`<h3>${selItem.title ?? ""}</h3>
								${
									selDomain
										? html`<div class="k">所属功能域</div><p>${selDomain.name ?? "—"}</p>`
										: null
								}
								<div class="k">描述</div><p>${selItem.description || "—"}</p>`
							: html`<div class="empty">从左侧选择功能项查看详情</div>`
					}
				</div>
			</div>
		`;
	}
}

customElements.define("baize-asset-library", BaizeAssetLibrary);
