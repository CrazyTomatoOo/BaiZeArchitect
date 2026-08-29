import { LitElement, html, css } from "lit";
import { sharedStyles } from "./baize-styles.js";

/**
 * baize-tab-bar — 主区内部三 tab(任务/产物/治理)。受控组件:宿主传入
 * activeTab,点击上抛 baize-tab-change {tab} 事件,由 baize-workflow 切换。
 * 票 #81:从 baize-workflow.renderTabBar() 抽取,data-testid 契约
 * (tab-bar/tab-tasks/tab-artifacts/tab-governance)原样保留。
 */
class BaizeTabBar extends LitElement {
	static properties = {
		activeTab: { type: String },
	};
	declare activeTab: string;

	constructor() {
		super();
		this.activeTab = "tasks";
	}

	static styles = [sharedStyles, css`
		:host { display: block; }

		/* — 标签页 — */
		.tab-bar { display: flex; gap: 0; margin-top: 16px; border-bottom: 1px solid var(--border); }
		.tab { background: none; border: none; padding: 8px 16px; cursor: pointer; font-size: var(--text-sm); color: var(--text-muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
		.tab:hover { color: var(--text); }
		.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
	`];

	private switchTab(tab: string): void {
		this.dispatchEvent(new CustomEvent("baize-tab-change", { detail: { tab }, bubbles: true, composed: true }));
	}

	render() {
		const tabs = [
			{ id: "tasks", label: "任务" },
			{ id: "artifacts", label: "产物" },
			{ id: "governance", label: "治理" },
		];
		return html`<div class="tab-bar" data-testid="tab-bar">
			${tabs.map((t) => html`<button class="tab ${this.activeTab === t.id ? "active" : ""}" data-testid="tab-${t.id}" @click=${() => this.switchTab(t.id)}>${t.label}</button>`)}
		</div>`;
	}
}

customElements.define("baize-tab-bar", BaizeTabBar);
