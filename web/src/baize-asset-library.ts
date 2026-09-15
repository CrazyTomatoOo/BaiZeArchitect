import { LitElement, html, css, nothing, type PropertyValues } from "lit";
import { sharedStyles } from "./baize-styles.js";
import { type AssetKind } from "./workflow-client.js";
import "./baize-asset-detail.js";
import "./baize-asset-form.js";
import "./baize-asset-graph.js";
import "./baize-asset-import.js";
import {
	assetTabFromPath,
	positiveInteger,
	SPECIALIZED_VIEW_KINDS,
	TAB_KINDS,
	TAB_LABELS,
	type Renderable,
	type WorkbenchTab,
} from "./baize-asset-library-constants.js";

/** 位置变更事件——shell.navigate 在 pushState 后派发;与侧栏共用。 */
const LOCATION_CHANGE_EVENT = "baize-location-change";

/**
 * baize-asset-library — 资产库主区(T3 重组)。
 * 删除 list-pane(条目已在侧栏);主区 = 顶部工具条(新建/导入/关系图) + 居中 880px 内容栏。
 * 内容栏:默认 baize-asset-detail(读 URL ?asset=<id>);新建/编辑时 baize-asset-form;
 * 导入时 baize-asset-import;关系图模式占主区全幅(不受 880px 约束)。
 */
class BaizeAssetLibrary extends LitElement {
	static properties = {
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		activeTab: { state: true },
		selectedAssetId: { state: true },
		formMode: { state: true },
		formKind: { state: true },
		formAssetId: { state: true },
		refresh: { state: true },
		narrowView: { state: true },
	};

	declare apiBase: string;
	declare workspaceId: number;
	declare activeTab: WorkbenchTab;
	declare selectedAssetId: number | null;
	declare formMode: "create" | "edit" | null;
	declare formKind: AssetKind | null;
	declare formAssetId: number | null;
	declare refresh: number;
	declare narrowView: boolean;

	private mediaQuery: MediaQueryList | null = null;

	static styles = [sharedStyles, css`
		:host {
			display: flex;
			flex-direction: column;
			height: 100%;
			background: var(--bg);
		}
		.mtoolbar {
			flex: 0 0 auto;
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--gap);
			padding: var(--gap) var(--pad);
			border-bottom: 1px solid var(--border);
			background: var(--surface);
		}
		.mtoolbar .spacer {
			flex: 1;
		}
		.mbody {
			flex: 1 1 0;
			min-height: 0;
			overflow-y: auto;
			display: flex;
			justify-content: center;
		}
		.mcol {
			width: 100%;
			max-width: var(--main-content-max);
			padding: var(--space-sm) var(--space-md);
		}
		.empty-hint {
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: 200px;
			color: var(--text-subtle);
			font-size: var(--text-base);
		}
		.graph-mode {
			flex: 1 1 0;
			min-height: 0;
			display: flex;
			flex-direction: column;
		}
	`];

	constructor() {
		super();
		this.apiBase = "";
		this.workspaceId = 0;
		this.activeTab = "scenario";
		this.selectedAssetId = null;
		this.formMode = null;
		this.formKind = null;
		this.formAssetId = null;
		this.refresh = 0;
		this.narrowView = false;
		this.readUrl();
	}

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("popstate", this.handleLocationChange);
		window.addEventListener(LOCATION_CHANGE_EVENT, this.handleLocationChange);
		this.mediaQuery = window.matchMedia("(max-width: 1023px)");
		this.narrowView = this.mediaQuery.matches;
		this.mediaQuery.addEventListener("change", this.handleMediaChange);
	}

	disconnectedCallback(): void {
		window.removeEventListener("popstate", this.handleLocationChange);
		window.removeEventListener(LOCATION_CHANGE_EVENT, this.handleLocationChange);
		this.mediaQuery?.removeEventListener("change", this.handleMediaChange);
		super.disconnectedCallback();
	}

	protected updated(changed: Map<string, unknown>): void {
		if ((changed.has("workspaceId") || changed.has("apiBase")) && this.workspaceId > 0 && this.isConnected) {
			this.refresh++;
		}
	}

	/**
	 * 地址栏 → 组件状态同步。侧栏导航经 shell.navigate(pushState)不触发 popstate,
	 * 统一由 baize-location-change 事件驱动;tab 实际变化时重置选择/表单。
	 */
	private readonly handleLocationChange = (): void => {
		const previousTab = this.activeTab;
		this.readUrl();
		if (this.activeTab !== previousTab) {
			this.selectedAssetId = null;
			this.formMode = null;
			this.formKind = null;
			this.formAssetId = null;
		}
	};

	private readonly handleMediaChange = (event: MediaQueryListEvent): void => {
		this.narrowView = event.matches;
	};

	private readUrl(): void {
		this.activeTab = assetTabFromPath(window.location.pathname) ?? "scenario";
		const params = new URLSearchParams(window.location.search);
		const selected = params.get("asset");
		this.selectedAssetId = selected === null ? null : positiveInteger(selected, 0) || null;
	}

	private updateUrl(
		changes: Partial<{
			tab: WorkbenchTab;
			selectedAssetId: number | null;
		}>,
		replace = false,
	): void {
		const tab = changes.tab ?? this.activeTab;
		const params = new URLSearchParams(window.location.search);
		params.delete("tab"); // 旧 ?tab= 形态清理(若有)
		if (changes.selectedAssetId !== undefined) {
			if (changes.selectedAssetId === null) params.delete("asset");
			else params.set("asset", String(changes.selectedAssetId));
		}
		const query = params.toString();
		const url = query.length > 0 ? `/assets/${tab}?${query}` : `/assets/${tab}`;
		if (replace) window.history.replaceState({}, "", url);
		else window.history.pushState({}, "", url);
		this.readUrl();
		// 通知侧栏等导航组件重读地址栏(pushState 不触发 popstate)
		window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
	}

	/** 侧栏头部常驻「新建」入口:卡片列表域在主区打开创建表单(层级域由树内联创建,不经此路径)。 */
	requestCreate(): void {
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

	private handleFormCancel(): void {
		this.formMode = null;
		this.formKind = null;
		this.formAssetId = null;
	}

	private handleAssetSaved(event: CustomEvent<{ assetId: number }>): void {
		this.formMode = null;
		this.formKind = null;
		this.formAssetId = null;
		this.selectedAssetId = event.detail.assetId;
		this.updateUrl({ selectedAssetId: event.detail.assetId }, true);
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

	private handleNavigateAsset(event: CustomEvent<{ tab: WorkbenchTab; assetId: number }>): void {
		const { tab, assetId } = event.detail;
		this.activeTab = tab;
		this.selectedAssetId = assetId;
		this.updateUrl({ tab, selectedAssetId: assetId });
	}

	private handleGraphNodeSelect(event: CustomEvent<{ tab: WorkbenchTab; assetId: number }>): void {
		this.handleNavigateAsset(event);
	}

	render(): Renderable {
		const isGraphMode = this.activeTab === "graph";
		return html`
			<div class="mtoolbar">
				<span class="spacer"></span>
				<baize-asset-import
					.apiBase=${this.apiBase}
					.workspaceId=${this.workspaceId}
					@baize-import-complete=${(event: CustomEvent<{ assetId: number | null }>) => this.handleImportComplete(event)}
				></baize-asset-import>
				<button class=${isGraphMode ? "primary" : nothing} @click=${() => this.updateUrl({ tab: isGraphMode ? "scenario" : "graph" })}>
					${isGraphMode ? "返回列表" : "关系图"}
				</button>
			</div>
			${isGraphMode
				? html`<div class="graph-mode">
						<baize-asset-graph
							.apiBase=${this.apiBase}
							.workspaceId=${this.workspaceId}
							.refresh=${this.refresh}
							@baize-graph-node-select=${(event: CustomEvent<{ tab: WorkbenchTab; assetId: number }>) => this.handleGraphNodeSelect(event)}
						></baize-asset-graph>
					</div>`
				: html`<div class="mbody">
						<div class="mcol">
							${this.formMode
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
									: html`<div class="empty-hint">从侧栏选择一条资产查看详情。</div>`}
						</div>
					</div>`}
		`;
	}
}

customElements.define("baize-asset-library", BaizeAssetLibrary);

export { BaizeAssetLibrary };
