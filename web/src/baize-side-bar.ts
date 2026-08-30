import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { sharedStyles } from "./baize-styles.js";

/** Side Bar 当前承载的顶层视图。 */
type ActiveView = "workspace";

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

/**
 * baize-side-bar — 240px 左侧辅助面板。
 */
class BaizeSideBar extends LitElement {
	static properties = {
		activeView: { type: String, attribute: "active-view" },
		apiBase: { type: String, attribute: "api-base" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		subView: { state: true },
	};

	declare activeView: ActiveView;
	declare apiBase: string;
	declare subView: "requirements" | "assets";
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
		.hint {
			padding: var(--pad);
			color: var(--text-muted);
			font-size: var(--text-sm);
		}
		.sub-tabs {
			display: flex;
			gap: 0;
			width: 100%;
		}
		.sub-tab {
			flex: 1;
			padding: var(--gap-dense) 0;
			background: none;
			border: none;
			border-bottom: var(--accent-border-w) solid transparent;
			color: var(--text-muted);
			font-size: var(--text-sm);
			font-weight: 600;
			cursor: pointer;
			text-align: center;
		}
		.sub-tab:hover {
			color: var(--text);
			background: var(--surface-hover);
		}
		.sub-tab.active {
			color: var(--accent);
			border-bottom-color: var(--accent);
		}
	`];

	constructor() {
		super();
		this.activeView = "workspace";
		this.apiBase = "";
		this.workspaceId = 0;
		this.subView = "requirements";
	}

	protected override willUpdate(): void {
		const path = window.location.pathname;
		this.subView = path.startsWith("/assets") ? "assets" : "requirements";
	}


	private onAssetTabChange(tab: AssetTab): void {
		this.dispatchEvent(new CustomEvent("baize-asset-tab-change", { detail: { tab }, bubbles: true, composed: true }));
	}

	private onOpenRequirement(e: Event): void {
		const detail = (e as CustomEvent<{ id: number }>).detail;
		this.dispatchEvent(new CustomEvent("baize-open-requirement", { detail, bubbles: true, composed: true }));
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
		if (this.workspaceId === 0) {
			return html`<div class="header"><span class="hint">未选择工作空间</span></div>`;
		}
		return html`
			<div class="header">
				<div class="sub-tabs">
					<button class="sub-tab ${this.subView === "requirements" ? "active" : ""}"
						@click=${() => { this.subView = "requirements"; this.dispatchEvent(new CustomEvent("baize-sub-view-change", { detail: { subView: "requirements" }, bubbles: true, composed: true })); }}>
						需求
					</button>
					<button class="sub-tab ${this.subView === "assets" ? "active" : ""}"
						@click=${() => { this.subView = "assets"; this.dispatchEvent(new CustomEvent("baize-sub-view-change", { detail: { subView: "assets" }, bubbles: true, composed: true })); }}>
						资产
					</button>
				</div>
			</div>
			<div class="content">
				${this.subView === "requirements" ? html`
					<baize-requirements
						.apiBase=${this.apiBase}
						.workspaceId=${this.workspaceId}
						@baize-open-requirement=${this.onOpenRequirement}
					></baize-requirements>
				` : nothing}
				${this.subView === "assets" ? this.renderAssetsNav() : nothing}
			</div>
		`;
	}
}

customElements.define("baize-side-bar", BaizeSideBar);
