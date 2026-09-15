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
import { assetKindLabel } from "./workflow-client.js";
import "./baize-requirements.js";
import "./baize-asset-entries.js";
import "./baize-hierarchy-tree.js";
import type { BaizeHierarchyTree } from "./baize-hierarchy-tree.js";
import type { BaizeRequirements } from "./baize-requirements.js";

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
	};

	declare activeView: ActiveView;
	declare apiBase: string;
	declare workspaceId: number;
	declare activeAssetTab: WorkbenchTab;
	declare selectedAssetId: number;

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
		.lib-head .spacer { flex: 1; }
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

	/** 场景库/功能库头部「新建」:委托层级树打开根节点内联创建表单,与需求侧栏的常驻新建入口对齐。 */
	private onCreateRoot(): void {
		const tree = this.renderRoot.querySelector<BaizeHierarchyTree>("baize-hierarchy-tree");
		tree?.requestRootCreate();
	}

	/** 需求视图头部「新建」:委托 baize-requirements 切换内联创建表单,与层级库的 requestRootCreate 对齐。 */
	private onCreateRequirement(): void {
		const req = this.renderRoot.querySelector<BaizeRequirements>("baize-requirements");
		req?.requestCreate();
	}

	/** 卡片列表资产域头部「新建」:创建表单在主区,派发事件由壳层桥接到 baize-asset-library。 */
	private onCreateEntry(): void {
		this.dispatchEvent(new CustomEvent("baize-asset-create", { bubbles: true, composed: true }));
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
				@baize-asset-select=${this.onAssetSelect}
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
				@select=${this.onAssetSelect}
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
		if (isRequirements) {
			return html`
				<div class="lib-head">
					<span>需求</span>
					<span class="spacer"></span>
					<button class="primary" @click=${this.onCreateRequirement}>＋ 新建需求</button>
				</div>
				<div class="content">${this.renderRequirements()}</div>
			`;
		}
		const rootKind = this.activeAssetTab === "scenario" ? "scenario-domain" : "function-domain";
		const entryKind = isHierarchy ? null : (TAB_KINDS[this.activeAssetTab as Exclude<WorkbenchTab, "graph">]?.[0] ?? null);
		return html`
			<div class="lib-head">
				<span>${VIEW_LABELS[this.activeAssetTab as WorkbenchView]}</span>
				${isHierarchy
					? html`<span class="spacer"></span><button class="primary" @click=${this.onCreateRoot}>＋ 新建${assetKindLabel(rootKind)}</button>`
					: entryKind
						? html`<span class="spacer"></span><button class="primary" @click=${this.onCreateEntry}>＋ 新建${assetKindLabel(entryKind)}</button>`
						: nothing}
			</div>
			<div class="content">
				${isHierarchy ? this.renderHierarchyTree() : this.renderAssetEntries()}
			</div>
		`;
	}
}

customElements.define("baize-side-bar", BaizeSideBar);
