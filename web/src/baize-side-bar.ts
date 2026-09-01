import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { sharedStyles } from "./baize-styles.js";
import {
	TAB_KINDS,
	TAB_LABELS,
	VIEW_LABELS,
	assetTabFromPath,
	type WorkbenchTab,
	type WorkbenchView,
} from "./baize-asset-library-constants.js";
import "./baize-requirements.js";
import "./baize-asset-entries.js";
import "./baize-hierarchy-tree.js";

/** Side Bar 当前承载的顶层视图。 */
type ActiveView = WorkbenchView | null;

/** 位置变更事件——shell.navigate 在 pushState 后派发;与资产库共用。 */
const LOCATION_CHANGE_EVENT = "baize-location-change";

/**
 * baize-side-bar — 240px 左侧辅助面板(T2 条目化)。
 * 直渲当前视图条目:需求卡片 / 资产条目 / 层级树;无 sub-tab 与 kind 导航。
 */
class BaizeSideBar extends LitElement {
	static properties = {
		activeView: { type: String, attribute: "active-view" },
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		activeAssetTab: { state: true },
		selectedAssetId: { state: true },
		refresh: { state: true },
	};

	declare activeView: ActiveView;
	declare apiBase: string;
	declare workspaceId: number;
	declare activeAssetTab: WorkbenchTab;
	declare selectedAssetId: number;
	declare refresh: number;

	static styles = [sharedStyles, css`
		:host {
			display: flex;
			flex-direction: column;
			width: 100%;
			height: 100%;
			background: var(--surface);
			overflow: hidden;
		}
		.lib-head {
			flex: 0 0 var(--topbar-h);
			display: flex;
			align-items: center;
			padding: 0 var(--pad);
			border-bottom: 1px solid var(--border);
			font-weight: 600;
			color: var(--text);
			font-size: var(--text-sm);
		}
		.content {
			flex: 1 1 0;
			min-height: 0;
			overflow-y: auto;
		}
		.hint {
			padding: var(--pad);
			color: var(--text-muted);
			font-size: var(--text-sm);
		}
	`];

	constructor() {
		super();
		this.activeView = null;
		this.apiBase = "";
		this.workspaceId = 0;
		this.activeAssetTab = "scenario";
		this.selectedAssetId = 0;
		this.refresh = 0;
	}

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("popstate", this.onLocationChange);
		window.addEventListener(LOCATION_CHANGE_EVENT, this.onLocationChange);
	}

	disconnectedCallback(): void {
		window.removeEventListener("popstate", this.onLocationChange);
		window.removeEventListener(LOCATION_CHANGE_EVENT, this.onLocationChange);
		super.disconnectedCallback();
	}

	/** pushState 不触发 popstate——壳层/资产库派发自定义事件,统一在此重读地址栏。 */
	private readonly onLocationChange = (): void => {
		this.requestUpdate();
	};

	protected override willUpdate(): void {
		const path = window.location.pathname;
		this.activeAssetTab = assetTabFromPath(path) ?? "scenario";
		const params = new URLSearchParams(window.location.search);
		const asset = params.get("asset");
		this.selectedAssetId = asset !== null ? Number(asset) || 0 : 0;
	}

	private onOpenRequirement(e: Event): void {
		const detail = (e as CustomEvent<{ id: number }>).detail;
		this.dispatchEvent(new CustomEvent("baize-open-requirement", { detail, bubbles: true, composed: true }));
	}

	private onAssetSelect(e: Event): void {
		const detail = (e as CustomEvent<{ assetId: number }>).detail;
		this.dispatchEvent(new CustomEvent("baize-asset-select", { detail, bubbles: true, composed: true }));
	}

	private onAssetPage(e: Event): void {
		// 资产条目加载完成,刷新计数
		this.refresh++;
	}

	private renderRequirements(): TemplateResult {
		return html`
			<baize-requirements
				.apiBase=${this.apiBase}
				.workspaceId=${this.workspaceId}
				@baize-open-requirement=${this.onOpenRequirement}
			></baize-requirements>
		`;
	}

	private renderAssetEntries(): TemplateResult {
		const tab = this.activeAssetTab;
		const kinds = TAB_KINDS[tab as Exclude<WorkbenchTab, "graph">];
		if (!kinds || kinds.length === 0) {
			return html`<div class="hint">该库暂不支持条目列表。</div>`;
		}
		const kind = kinds[0]!;
		return html`
			<baize-asset-entries
				.apiBase=${this.apiBase}
				.workspaceId=${this.workspaceId}
				.kind=${kind}
				.selectedAssetId=${this.selectedAssetId}
				.refresh=${this.refresh}
				@baize-asset-select=${this.onAssetSelect}
				@baize-asset-page=${this.onAssetPage}
			></baize-asset-entries>
		`;
	}

	private renderHierarchyTree(): TemplateResult {
		const tab = this.activeAssetTab;
		const rootKind = tab === "scenario" ? "scenario-domain" : "function-domain";
		return html`
			<baize-hierarchy-tree
				.apiBase=${this.apiBase}
				.workspaceId=${this.workspaceId}
				.rootKind=${rootKind}
				.selectedAssetId=${this.selectedAssetId}
				.page=${1}
				.pageSize=${48}
				.query=${""}
				.narrowView=${false}
				.refresh=${this.refresh}
				@select=${this.onAssetSelect}
				@baize-asset-page=${this.onAssetPage}
			></baize-hierarchy-tree>
		`;
	}

	render(): TemplateResult {
		if (this.workspaceId === 0) {
			return html`<div class="lib-head"><span class="hint">未选择工作空间</span></div>`;
		}
		const path = window.location.pathname;
		const isRequirements = !path.startsWith("/assets");
		const isHierarchy = this.activeAssetTab === "scenario" || this.activeAssetTab === "function";
		// 需求视图:baize-requirements 自带 side-head(标题+新建按钮),不再重复渲染 lib-head
		if (isRequirements) {
			return html`<div class="content">${this.renderRequirements()}</div>`;
		}
		return html`
			<div class="lib-head">${VIEW_LABELS[this.activeAssetTab as WorkbenchView]}</div>
			<div class="content">
				${isHierarchy ? this.renderHierarchyTree() : this.renderAssetEntries()}
			</div>
		`;
	}
}

customElements.define("baize-side-bar", BaizeSideBar);
