import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { sharedStyles } from "./baize-styles.js";
import { listAssets, assetKindLabel, ASSET_KINDS, type AssetKind } from "./workflow-client.js";
import { BaizeHierarchyTree } from "./baize-hierarchy-tree.js";
import "./baize-asset-list.js";
import "./baize-asset-detail.js";
import "./baize-asset-form.js";
import "./baize-asset-graph.js";
import "./baize-asset-import.js";
import {
	emptyKindCounts,
	isWorkbenchTab,
	positiveInteger,
	SPECIALIZED_VIEW_KINDS,
	TAB_KINDS,
	TAB_LABELS,
	TAB_ORDER,
	type Renderable,
	type WorkbenchTab,
} from "./baize-asset-library-constants.js";

class BaizeAssetLibrary extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		activeTab: { state: true },
		query: { state: true },
		page: { state: true },
		pageSize: { state: true },
		total: { state: true },
		kindCounts: { state: true },
		selectedAssetId: { state: true },
		graphKindFilter: { state: true },
		graphZoom: { state: true },
		graphOffset: { state: true },
		expandedNodes: { state: true },
		formMode: { state: true },
		formKind: { state: true },
		formAssetId: { state: true },
		refresh: { state: true },
		narrowView: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare activeTab: WorkbenchTab;
	declare query: string;
	declare page: number;
	declare pageSize: number;
	declare total: number;
	declare kindCounts: Readonly<Record<AssetKind, number>>;
	declare selectedAssetId: number | null;
	declare graphKindFilter: AssetKind | null;
	declare graphZoom: number;
	declare graphOffset: { x: number; y: number };
	declare expandedNodes: ReadonlySet<number>;
	declare formMode: "create" | "edit" | null;
	declare formKind: AssetKind | null;
	declare formAssetId: number | null;
	declare refresh: number;
	declare narrowView: boolean;

	private mediaQuery: MediaQueryList | null = null;

	static styles = [sharedStyles, css`
		:host {
			display: block;
			--asset-toolbar-offset: 8.5rem;
			--asset-mobile-toolbar-offset: 11rem;
			--asset-list-min-width: 15rem;
			--asset-pane-height: min(68vh, 42rem);
			--asset-placeholder-height: 11rem;
			--asset-fact-min-width: 7.5rem;
			--asset-graph-node-width: 8.125rem;
			--asset-graph-edge-width: 0.125rem;
			--asset-graph-node-height: 2.25rem;
		}
		.workspace { display: grid; gap: var(--gap); }
		.toolbar {
			position: sticky; top: 0; z-index: 2;
			display: grid; gap: var(--gap); padding: var(--pad) 0;
			background: var(--bg); border-bottom: 1px solid var(--border);
		}
		.toolbar-head { display: flex; align-items: start; justify-content: space-between; gap: var(--gap); }
		.heading { min-width: 0; }
		.heading h1 { margin: 0; font: 600 var(--text-display) var(--font-display); }
		.sub { margin: var(--space-2xs) 0 0; color: var(--text-muted); font-size: var(--text-base); }
		.count { color: var(--text-subtle); font: 600 var(--text-sm) var(--font-mono); white-space: nowrap; }
		.toolbar-actions { display: flex; align-items: center; justify-content: flex-start; gap: var(--gap); flex-wrap: wrap; }
		.search { width: min(280px, 30vw); }
		.tabs {
			position: sticky; top: var(--asset-toolbar-offset); z-index: 2;
			display: flex; gap: var(--space-2xs); overflow-x: auto;
			padding: var(--space-2xs) 0;
			background: var(--bg); border-bottom: 1px solid var(--border);
		}
		.tab { border: 0; border-bottom: 2px solid transparent; border-radius: 0; padding: var(--space-2xs) var(--gap); color: var(--text-muted); }
		.tab:hover { color: var(--text); }
		.tab.active { border-bottom-color: var(--accent); color: var(--accent); font-weight: 600; }
		.tab-count { margin-left: var(--space-2xs); color: var(--text-subtle); font: var(--text-xs) var(--font-mono); }
		.content { display: grid; grid-template-columns: minmax(var(--asset-list-min-width), 0.8fr) minmax(0, 1.4fr); gap: var(--gap); min-height: 0; }
		.pane { min-width: 0; height: var(--asset-pane-height); overflow: auto; }
		.list-pane { padding: var(--gap); }
		.detail-pane { padding: var(--gap); }
		.list { display: grid; gap: var(--space-2xs); }
		.asset-row { width: 100%; display: grid; gap: var(--space-2xs); text-align: left; border-color: transparent; border-left: 2px solid transparent; padding: var(--gap); }
		.asset-row:hover { border-color: var(--border); }
		.asset-row.selected { border-left-color: var(--accent); background: var(--surface-2); }
		.row-head { display: flex; align-items: center; gap: var(--space-2xs); min-width: 0; }
		.kind { color: var(--accent-hi); font-size: var(--text-xs); letter-spacing: 0.04em; }
		.title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
		.meta { color: var(--text-muted); font-size: var(--text-sm); }
		.digest { color: var(--text-subtle); font: var(--text-xs) var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.pager { display: flex; align-items: center; justify-content: space-between; gap: var(--gap); margin-top: var(--gap); color: var(--text-muted); font-size: var(--text-sm); }
		.pager-actions { display: flex; gap: var(--space-2xs); }
		.selected-note { margin: 0 0 var(--gap); color: var(--warn); font-size: var(--text-sm); }
		.detail-placeholder { display: grid; place-items: center; min-height: var(--asset-placeholder-height); color: var(--text-muted); text-align: center; }
		.detail { display: grid; gap: var(--gap); }
		.detail-head { display: flex; align-items: start; justify-content: space-between; gap: var(--gap); }
		.detail-title { margin: 0; font: 600 var(--text-xl) var(--font-display); overflow-wrap: anywhere; }
		.detail-sub { margin: var(--space-2xs) 0 0; color: var(--text-muted); font-size: var(--text-sm); }
		.detail-block { border-top: 1px solid var(--border); padding-top: var(--gap); }
		.detail-block h2 { margin: 0 0 var(--space-2xs); font-size: var(--text-base); }
		.facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--asset-fact-min-width), 1fr)); gap: var(--space-2xs); margin: 0; }
		.fact dt { color: var(--text-subtle); font-size: var(--text-xs); }
		.fact dd { margin: var(--space-2xs) 0 0; overflow-wrap: anywhere; }
		.field-list { display: grid; gap: var(--space-2xs); margin: 0; }
		.field dt { color: var(--text-muted); font-size: var(--text-sm); }
		.field dd { margin: var(--space-2xs) 0 0; }
		.value-list { display: grid; gap: var(--space-2xs); padding-left: var(--pad); }
		.value { white-space: pre-wrap; overflow-wrap: anywhere; }
		.array-item { border: 1px solid var(--border); border-radius: var(--radius); padding: var(--space-2xs) var(--gap); }
		.array-item summary { cursor: pointer; color: var(--text); }
		.relations { display: grid; gap: var(--space-2xs); }
		.relation-group h3 { margin: 0 0 var(--space-2xs); color: var(--text-muted); font-size: var(--text-sm); }
		.relation { width: 100%; text-align: left; }
		pre.raw { margin: var(--space-2xs) 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
		.form { display: grid; gap: var(--gap); }
		.form h2 { margin: 0; font: 600 var(--text-xl) var(--font-display); }
		.form-field { display: grid; gap: var(--space-2xs); }
		.form-field > label, .form-field legend { color: var(--text-muted); font-size: var(--text-sm); }
		.form-field input, .form-field textarea, .form-field select { width: 100%; }
		.array-editor { display: grid; gap: var(--space-2xs); }
		.graph-controls { display: flex; gap: var(--space-2xs); align-items: center; margin-bottom: var(--gap); }
		.graph-canvas { position: relative; width: 100%; min-height: var(--asset-placeholder-height); overflow: hidden; border: 1px solid var(--border); background: var(--bg); }
		.graph-layer { position: relative; transform-origin: top left; }
		.graph-edge { position: absolute; height: 0; border-top: var(--asset-graph-edge-width) solid var(--border-strong); transform-origin: left center; pointer-events: none; }
		.graph-node { position: absolute; width: var(--asset-graph-node-width); min-height: var(--asset-graph-node-height); display: grid; gap: var(--space-2xs); text-align: left; cursor: pointer; }
		.graph-node span { color: var(--accent); font-size: var(--text-xs); }
		.graph-node strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.array-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--space-2xs); align-items: start; }
		.array-actions { display: flex; gap: var(--space-2xs); flex-wrap: wrap; }
		.array-actions button { padding: var(--space-2xs) var(--gap); font-size: var(--text-xs); }
		.form-actions { display: flex; gap: var(--space-2xs); }
		.form-error { color: var(--danger); font-size: var(--text-sm); }
		.import-preview { display: grid; gap: var(--space-2xs); padding: var(--gap); }
		.import-preview h2 { margin: 0; font-size: var(--text-base); }
		.danger-zone { display: flex; gap: var(--space-2xs); align-items: center; flex-wrap: wrap; }
		.file-input { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; clip-path: inset(50%); }
		.file-button { display: inline-flex; align-items: center; position: relative; padding: var(--space-2xs) var(--pad); border: 1px solid var(--border-strong); border-radius: var(--radius); color: var(--text); cursor: pointer; white-space: nowrap; }
		.file-button:hover { background: var(--surface-hover); }
		.file-button:focus-within { outline: var(--focus-ring); outline-offset: 1px; }
		.mobile-back { display: none; }
		@media (max-width: 900px) {
			.toolbar { top: 0; }
			.toolbar-actions { align-items: stretch; }
			.search { width: 100%; flex: 1 1 100%; }
			.tabs { top: var(--asset-mobile-toolbar-offset); }
			.content { grid-template-columns: minmax(0, 1fr); }
			.pane { height: auto; max-height: none; overflow: visible; }
			.detail-pane { min-height: var(--asset-placeholder-height); }
			.mobile-back { display: inline-flex; }
		}
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 0;
		this.activeTab = "scenario";
		this.query = "";
		this.page = 1;
		this.pageSize = 12;
		this.total = 0;
		this.kindCounts = emptyKindCounts();
		this.selectedAssetId = null;
		this.graphKindFilter = null;
		this.graphZoom = 1;
		this.graphOffset = { x: 0, y: 0 };
		this.expandedNodes = new Set();
		this.formMode = null;
		this.formKind = null;
		this.formAssetId = null;
		this.refresh = 0;
		this.narrowView = false;
		this.readUrl();
	}

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("popstate", this.handlePopState);
		this.mediaQuery = window.matchMedia("(max-width: 1023px)");
		this.narrowView = this.mediaQuery.matches;
		this.mediaQuery.addEventListener("change", this.handleMediaChange);
	}

	disconnectedCallback(): void {
		window.removeEventListener("popstate", this.handlePopState);
		this.mediaQuery?.removeEventListener("change", this.handleMediaChange);
		super.disconnectedCallback();
	}

	protected updated(changed: Map<string, unknown>): void {
		if ((changed.has("workspaceId") || changed.has("apiBase")) && this.workspaceId > 0 && this.isConnected) {
			this.refresh++;
		}
	}

	private readonly handlePopState = (): void => {
		this.readUrl();
	};

	private readonly handleMediaChange = (event: MediaQueryListEvent): void => {
		this.narrowView = event.matches;
	};

	private readUrl(): void {
		const params = new URLSearchParams(window.location.search);
		const tab = params.get("tab");
		this.activeTab = isWorkbenchTab(tab) ? tab : "scenario";
		this.query = params.get("q") ?? "";
		this.page = positiveInteger(params.get("page"), 1);
		this.pageSize = positiveInteger(params.get("pageSize"), 12);
		const selected = params.get("selectedAssetId");
		this.selectedAssetId = selected === null ? null : positiveInteger(selected, 0) || null;
		const graphKind = params.get("graphKind");
		this.graphKindFilter = graphKind !== null && ASSET_KINDS.includes(graphKind as AssetKind) ? graphKind as AssetKind : null;
		const zoom = Number(params.get("graphZoom"));
		this.graphZoom = Number.isFinite(zoom) && zoom >= 0.6 && zoom <= 2 ? zoom : 1;
		this.graphOffset = { x: Number(params.get("graphX")) || 0, y: Number(params.get("graphY")) || 0 };
		const expanded = params.get("expandedNodes");
		if (expanded !== null) {
			this.expandedNodes = new Set(expanded.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0));
		} else {
			this.expandedNodes = new Set();
		}
	}

	private updateUrl(
		changes: Partial<{
			tab: WorkbenchTab;
			q: string;
			page: number;
			pageSize: number;
			selectedAssetId: number | null;
			graphKind: AssetKind | null;
			graphZoom: number;
			graphX: number;
			graphY: number;
			expandedNodes: string;
		}>,
		replace = false,
	): void {
		const params = new URLSearchParams(window.location.search);
		if (changes.tab !== undefined) params.set("tab", changes.tab);
		if (changes.q !== undefined) changes.q.length > 0 ? params.set("q", changes.q) : params.delete("q");
		if (changes.page !== undefined) params.set("page", String(changes.page));
		if (changes.pageSize !== undefined) params.set("pageSize", String(changes.pageSize));
		if (changes.selectedAssetId !== undefined) {
			if (changes.selectedAssetId === null) params.delete("selectedAssetId");
			else params.set("selectedAssetId", String(changes.selectedAssetId));
		}
		if (changes.graphKind !== undefined) {
			if (changes.graphKind === null) params.delete("graphKind");
			else params.set("graphKind", changes.graphKind);
		}
		if (changes.graphZoom !== undefined) params.set("graphZoom", String(changes.graphZoom));
		if (changes.graphX !== undefined) params.set("graphX", String(changes.graphX));
		if (changes.graphY !== undefined) params.set("graphY", String(changes.graphY));
		if (changes.expandedNodes !== undefined) {
			if (changes.expandedNodes.length > 0) params.set("expandedNodes", changes.expandedNodes);
			else params.delete("expandedNodes");
		}
		const query = params.toString();
		const url = query.length > 0 ? `/assets?${query}` : "/assets";
		if (replace) window.history.replaceState({}, "", url);
		else window.history.pushState({}, "", url);
		this.readUrl();
	}

	private chooseTab(tab: WorkbenchTab): void {
		this.updateUrl({ tab, page: 1, q: "" });
		this.total = 0;
		this.selectedAssetId = null;
		this.formMode = null;
		this.query = "";
		this.page = 1;
	}

	private chooseAsset(assetId: number): void {
		this.selectedAssetId = assetId;
		this.updateUrl({ selectedAssetId: assetId });
	}

	private openCreate(): void {
		if (this.activeTab === "graph") return;
		const kind = TAB_KINDS[this.activeTab as Exclude<WorkbenchTab, "graph">][0]!;
		if (SPECIALIZED_VIEW_KINDS[kind]) return;
		this.formMode = "create";
		this.formKind = kind;
		this.formAssetId = null;
	}

	private openEdit(): void {
		if (this.selectedAssetId === null) return;
		this.formMode = "edit";
		this.formAssetId = this.selectedAssetId;
		this.formKind = null;
	}

	private handleAssetPage(event: CustomEvent<{ total?: number; kindCounts?: Readonly<Record<AssetKind, number>> }>): void {
		if (typeof event.detail.total === "number") this.total = event.detail.total;
		if (event.detail.kindCounts) this.kindCounts = event.detail.kindCounts;
	}

	private handleSelectAsset(event: CustomEvent<number>): void {
		this.chooseAsset(event.detail);
	}

	private handleNavigateAsset(event: CustomEvent<{ tab: WorkbenchTab; assetId: number }>): void {
		const { tab, assetId } = event.detail;
		this.activeTab = tab;
		this.query = "";
		this.page = 1;
		this.selectedAssetId = assetId;
		this.updateUrl({ tab, q: "", page: 1, selectedAssetId: assetId });
	}

	private handlePageChange(event: CustomEvent<number>): void {
		this.updateUrl({ page: event.detail });
	}

	private handlePageSizeChange(event: CustomEvent<number>): void {
		this.updateUrl({ pageSize: event.detail, page: 1 });
	}

	private handleQueryInput(event: Event): void {
		const query = (event.target as HTMLInputElement).value;
		this.updateUrl({ q: query, page: 1 });
		this.query = query;
		this.page = 1;
	}

	private handleExpand(event: CustomEvent<number>): void {
		const next = new Set(this.expandedNodes);
		next.has(event.detail) ? next.delete(event.detail) : next.add(event.detail);
		this.expandedNodes = next;
		this.updateUrl({ expandedNodes: [...next].join(",") }, true);
	}

	private handleGraphFilter(event: CustomEvent<{ kindFilter: AssetKind | null }>): void {
		this.graphKindFilter = event.detail.kindFilter;
		this.updateUrl({ graphKind: this.graphKindFilter }, true);
	}

	private handleGraphView(event: CustomEvent<{ zoom: number; offsetX: number; offsetY: number }>): void {
		this.graphZoom = event.detail.zoom;
		this.graphOffset = { x: event.detail.offsetX, y: event.detail.offsetY };
		this.updateUrl({ graphZoom: this.graphZoom, graphX: this.graphOffset.x, graphY: this.graphOffset.y }, true);
	}

	private handleGraphNodeSelect(event: CustomEvent<{ tab: WorkbenchTab; assetId: number }>): void {
		this.handleNavigateAsset(event);
	}

	private handleFormCancel(): void {
		this.formMode = null;
		this.formKind = null;
		this.formAssetId = null;
	}

	private handleAssetSaved(event: CustomEvent<{ assetId: number }>): void {
		const assetId = event.detail.assetId;
		this.formMode = null;
		this.formKind = null;
		this.formAssetId = null;
		this.selectedAssetId = assetId;
		this.updateUrl({ selectedAssetId: assetId });
		this.refresh++;
	}

	private handleAssetDeleted(): void {
		this.selectedAssetId = null;
		this.updateUrl({ selectedAssetId: null }, true);
		this.refresh++;
	}

	private handleImportComplete(event: CustomEvent<{ assetId: number | null }>): void {
		const assetId = event.detail.assetId;
		if (assetId) {
			this.selectedAssetId = assetId;
			this.updateUrl({ selectedAssetId: assetId }, true);
		}
		this.refresh++;
	}

	private renderTabs(): Renderable {
		return html`<nav class="tabs" aria-label="资产类型">
			${TAB_ORDER.map((tab) => {
				const count = tab === "graph" ? null : TAB_KINDS[tab].reduce((sum, kind) => sum + (this.kindCounts[kind] ?? 0), 0);
				return html`
					<button
						class="tab ${this.activeTab === tab ? "active" : ""}"
						aria-current=${this.activeTab === tab ? "page" : "false"}
						@click=${() => this.chooseTab(tab)}
					>
						${TAB_LABELS[tab]}
						${count !== null ? html`<span class="tab-count">${count}</span>` : ""}
					</button>
				`;
			})}
		</nav>`;
	}

	private activeKind(): AssetKind | null {
		if (this.activeTab === "graph") return null;
		return TAB_KINDS[this.activeTab as Exclude<WorkbenchTab, "graph">][0] ?? null;
	}

	render(): Renderable {
		const isHierarchyTab = this.activeTab === "scenario" || this.activeTab === "function";
		const showDetail = this.narrowView ? this.selectedAssetId !== null : true;
		const showList = this.narrowView ? this.selectedAssetId === null : true;
		const activeKind = this.activeKind();
		const canCreate = activeKind !== null && !SPECIALIZED_VIEW_KINDS[activeKind];
		return html`
			<section class="workspace" aria-labelledby="asset-library-title">
				<header class="toolbar">
					<div class="toolbar-head">
						<div class="heading">
							<h1 id="asset-library-title">设计模型资产</h1>
							<p class="sub">按类型浏览 Workspace 内可复用的设计事实，并追溯资产关系。</p>
						</div>
						<span class="count">${this.activeTab === "graph" ? "关系图" : this.total}</span>
					</div>
					<div class="toolbar-actions">
						${this.activeTab !== "graph"
							? html`
								<label class="search">标题过滤
									<input type="search" .value=${this.query} placeholder="搜索当前类型" @input=${(event: Event) => this.handleQueryInput(event)} />
								</label>
								${canCreate ? html`<button class="primary" @click=${() => this.openCreate()}>新建${assetKindLabel(activeKind)}</button>` : nothing}
							  `
							: nothing}
						<baize-asset-import
							.apiBase=${this.apiBase}
							.workspaceId=${this.workspaceId}
							@baize-import-complete=${(event: CustomEvent<{ assetId: number | null }>) => this.handleImportComplete(event)}
						></baize-asset-import>
					</div>
				</header>
				${this.renderTabs()}
				<div class="content">
					${showList
						? html`<section class="card pane list-pane" aria-label="资产列表">
								${isHierarchyTab
									? html`<baize-hierarchy-tree
											.apiBase=${this.apiBase}
											.workspaceId=${this.workspaceId}
											.rootKind=${activeKind!}
											.selectedAssetId=${this.selectedAssetId ?? 0}
											.expandedNodes=${this.expandedNodes}
											.page=${this.page}
											.pageSize=${this.pageSize}
											.query=${this.query}
											.narrowView=${this.narrowView}
											.refresh=${this.refresh}
											@baize-asset-page=${(event: CustomEvent<{ total?: number; kindCounts?: Readonly<Record<AssetKind, number>> }>) => this.handleAssetPage(event)}
											@select=${(event: CustomEvent<number>) => this.handleSelectAsset(event)}
											@expand=${(event: CustomEvent<number>) => this.handleExpand(event)}
											@navigate=${(event: CustomEvent<{ tab: WorkbenchTab; assetId: number }>) => this.handleNavigateAsset(event)}
									  ></baize-hierarchy-tree>`
									: html`<baize-asset-list
											.apiBase=${this.apiBase}
											.workspaceId=${this.workspaceId}
											.kind=${activeKind!}
											.query=${this.query}
											.page=${this.page}
											.pageSize=${this.pageSize}
											.selectedAssetId=${this.selectedAssetId ?? 0}
											.refresh=${this.refresh}
											@baize-asset-page=${(event: CustomEvent<{ total?: number; kindCounts?: Readonly<Record<AssetKind, number>> }>) => this.handleAssetPage(event)}
											@baize-select-asset=${(event: CustomEvent<number>) => this.handleSelectAsset(event)}
											@baize-page-change=${(event: CustomEvent<number>) => this.handlePageChange(event)}
											@baize-page-size-change=${(event: CustomEvent<number>) => this.handlePageSizeChange(event)}
									  ></baize-asset-list>`}
							</section>`
						: nothing}
									${showDetail
					? html`<section class="card pane detail-pane" aria-label="资产详情">
							${this.narrowView && this.selectedAssetId !== null
								? html`<button class="mobile-back" @click=${() => { this.selectedAssetId = null; this.updateUrl({ selectedAssetId: null }, true); }}>← 返回列表</button>`
								: nothing}
							${this.activeTab === "graph"
								? html`<div class="detail-placeholder">关系图节点详情将在此展示。</div>`
								: this.formMode
									? html`<baize-asset-form
											.apiBase=${this.apiBase}
											.workspaceId=${this.workspaceId}
											.mode=${this.formMode}
											.kind=${this.formKind}
											.assetId=${this.formAssetId}
											@baize-form-cancel=${() => this.handleFormCancel()}
											@baize-asset-saved=${(event: CustomEvent<{ assetId: number }>) => this.handleAssetSaved(event)}
									  ></baize-asset-form>`
									: this.selectedAssetId !== null
										? html`<baize-asset-detail
												.apiBase=${this.apiBase}
												.assetId=${this.selectedAssetId}
												.refresh=${this.refresh}
												@baize-edit-asset=${() => this.openEdit()}
												@baize-asset-deleted=${() => this.handleAssetDeleted()}
												@baize-navigate-asset=${(event: CustomEvent<{ tab: WorkbenchTab; assetId: number }>) => this.handleNavigateAsset(event)}
												@baize-asset-saved=${() => { this.refresh++; }}
									  ></baize-asset-detail>`
										: html`<div class="detail-placeholder">选择资产查看详情</div>`}
						</section>`
					: nothing}
				</div>
				${this.activeTab === "graph"
					? html`<baize-asset-graph
							.apiBase=${this.apiBase}
							.workspaceId=${this.workspaceId}
							.kindFilter=${this.graphKindFilter}
							.zoom=${this.graphZoom}
							.offsetX=${this.graphOffset.x}
							.offsetY=${this.graphOffset.y}
							.refresh=${this.refresh}
							@baize-asset-page=${(event: CustomEvent<{ total?: number; kindCounts?: Readonly<Record<AssetKind, number>> }>) => this.handleAssetPage(event)}
							@baize-graph-filter-change=${(event: CustomEvent<{ kindFilter: AssetKind | null }>) => this.handleGraphFilter(event)}
							@baize-graph-view-change=${(event: CustomEvent<{ zoom: number; offsetX: number; offsetY: number }>) => this.handleGraphView(event)}
							@baize-graph-node-select=${(event: CustomEvent<{ tab: WorkbenchTab; assetId: number }>) => this.handleGraphNodeSelect(event)}
					  ></baize-asset-graph>`
					: nothing}
			</section>
		`;
	}
}

customElements.define("baize-asset-library", BaizeAssetLibrary);
