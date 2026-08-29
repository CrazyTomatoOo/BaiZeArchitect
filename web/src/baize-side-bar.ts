import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { sharedStyles } from "./baize-styles.js";
import "./baize-requirements.js";
import "./baize-workspace-manager.js";

/** Side Bar 当前承载的顶层视图。 */
type ActiveView = "requirements" | "assets" | "manage";

/** 资产库九大分类。 */
type AssetTab = "scenario" | "function" | "usecase" | "design" | "architecture" | "data" | "api" | "stakeholder" | "graph";

const ASSET_TABS: readonly { tab: AssetTab; label: string }[] = [
	{ tab: "scenario", label: "场景库" },
	{ tab: "function", label: "功能库" },
	{ tab: "usecase", label: "用例库" },
	{ tab: "design", label: "设计库" },
	{ tab: "architecture", label: "架构库" },
	{ tab: "data", label: "数据库" },
	{ tab: "api", label: "接口库" },
	{ tab: "stakeholder", label: "干系人库" },
	{ tab: "graph", label: "关系图" },
];

const TITLE_MAP: Record<ActiveView, string> = {
	requirements: "需求",
	assets: "资产库",
	manage: "工作空间",
};

/**
 * baize-side-bar — 240px 左侧辅助面板。
 * 根据 activeView 委托给需求列表、资产导航或工作区管理器。
 */
class BaizeSideBar extends LitElement {
	static properties = {
		activeView: { type: String, attribute: "active-view" },
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
	};

	declare activeView: ActiveView;
	declare apiBase: string;
	declare workspaceId: number;

	static styles = [sharedStyles, css`
		:host {
			display: flex;
			flex-direction: column;
			width: 100%;
			height: 100%;
			background: var(--surface);
			overflow: hidden;
		}
		.header {
			flex: 0 0 var(--topbar-h);
			display: flex;
			align-items: center;
			padding: 0 var(--pad);
			border-bottom: 1px solid var(--border);
			font-weight: 600;
			color: var(--text);
		}
		.content {
			flex: 1 1 0;
			min-height: 0;
			overflow-y: auto;
		}
		.nav-list {
			display: flex;
			flex-direction: column;
			padding: var(--gap) 0;
		}
		.nav-item {
			display: flex;
			align-items: center;
			width: 100%;
			padding: var(--gap) var(--pad);
			text-align: left;
			color: var(--text);
			background: transparent;
			border: none;
			border-radius: 0;
			cursor: pointer;
			font-size: var(--text-base);
		}
		.nav-item:hover {
			background: var(--surface-hover);
		}
	`];

	constructor() {
		super();
		this.activeView = "requirements";
		this.apiBase = "";
		this.workspaceId = 0;
	}

	private onAssetTabChange(tab: AssetTab): void {
		this.dispatchEvent(new CustomEvent("baize-asset-tab-change", { detail: { tab }, bubbles: true, composed: true }));
	}

	private onOpenRequirement(e: Event): void {
		const detail = (e as CustomEvent<{ id: number }>).detail;
		this.dispatchEvent(new CustomEvent("baize-open-requirement", { detail, bubbles: true, composed: true }));
	}

	private onEnterWorkspace(e: Event): void {
		const detail = (e as CustomEvent<{ id: number }>).detail;
		this.dispatchEvent(new CustomEvent("baize-enter-workspace", { detail, bubbles: true, composed: true }));
	}

	private onWorkspaceDeleted(e: Event): void {
		const detail = (e as CustomEvent<{ id: number }>).detail;
		this.dispatchEvent(new CustomEvent("baize-workspace-deleted", { detail, bubbles: true, composed: true }));
	}

	private renderAssetsNav(): TemplateResult {
		return html`
			<div class="nav-list" role="list">
				${ASSET_TABS.map(({ tab, label }) => html`
					<button class="nav-item" role="listitem" @click=${() => this.onAssetTabChange(tab)}>${label}</button>
				`)}
			</div>
		`;
	}

	render(): TemplateResult {
		return html`
			<div class="header">${TITLE_MAP[this.activeView]}</div>
			<div class="content">
				${this.activeView === "requirements" ? html`
					<baize-requirements
						.apiBase=${this.apiBase}
						.workspaceId=${this.workspaceId}
						@baize-open-requirement=${this.onOpenRequirement}
					></baize-requirements>
				` : nothing}
				${this.activeView === "assets" ? this.renderAssetsNav() : nothing}
				${this.activeView === "manage" ? html`
					<baize-workspace-manager
						.apiBase=${this.apiBase}
						@baize-enter-workspace=${this.onEnterWorkspace}
						@baize-workspace-deleted=${this.onWorkspaceDeleted}
					></baize-workspace-manager>
				` : nothing}
			</div>
		`;
	}
}

customElements.define("baize-side-bar", BaizeSideBar);
