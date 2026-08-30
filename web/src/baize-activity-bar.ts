import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { sharedStyles, cycleTheme } from "./baize-styles.js";

/** 主题三态。 */
type Theme = "system" | "light" | "dark";

/** Activity Bar 顶层视图。workspace = 进入工作空间后的需求+资产视图。 */
type ActiveView = "workspace";

/** 20×20 图标 SVG 字符串。 */
const ICONS: Record<string, string> = {
	workspace: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h12M4 10h12M4 14h12"/></svg>`,
	manage: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="2.5"/><path d="M16.8 10c0 .2 0 .4-.1.6l1.8 1-1.5 2.6-2-.8a5.4 5.4 0 01-1.5.8l-.2 2.1H9.5l-.2-2.1a5.4 5.4 0 01-1.5-.8l-2 .8-1.5-2.6 1.8-1c0-.2-.1-.4-.1-.6s0-.4.1-.6l-1.8-1 1.5-2.6 2 .8c.4-.3.9-.6 1.5-.8l.2-2.1h2.1l.2 2.1c.6.2 1.1.5 1.5.8l2-.8 1.5 2.6-1.8 1c.1.2.1.4.1.6z"/></svg>`,
	"theme-system": `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="3"/><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.3 3.3l1.4 1.4M15.3 15.3l1.4 1.4M3.3 16.7l1.4-1.4M15.3 4.7l1.4-1.4"/><path d="M16 10a6 6 0 11-6-6"/></svg>`,
	"theme-light": `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="3"/><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.3 3.3l1.4 1.4M15.3 15.3l1.4 1.4M3.3 16.7l1.4-1.4M15.3 4.7l1.4-1.4"/></svg>`,
	"theme-dark": `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 10.4a7 7 0 11-8.4-8.4 9 9 0 008.4 8.4z"/></svg>`,
};

/**
 * baize-activity-bar — 左侧 48px 图标条。
 * 负责顶层视图切换、Side Bar 折叠触发、三态主题切换。
 */
class BaizeActivityBar extends LitElement {
	static properties = {
		activeView: { type: String, attribute: "active-view" },
		theme: { type: String },
		sidebarCollapsed: { type: Boolean, attribute: "sidebar-collapsed" },
		workspaceId: { type: Number, attribute: "workspace-id" },
	};

	declare activeView: ActiveView;
	declare theme: Theme;
	declare sidebarCollapsed: boolean;
	declare workspaceId: number;

	static styles = [sharedStyles, css`
		:host {
			display: flex;
			flex-direction: column;
			align-items: center;
			width: 100%;
			height: 100%;
			background: var(--surface-2);
			padding-top: var(--gap);
			gap: var(--gap-dense);
		}
		.icon-btn {
			position: relative;
			width: var(--activity-bar-w);
			height: var(--activity-bar-w);
			display: flex;
			align-items: center;
			justify-content: center;
			color: var(--text-muted);
			background: transparent;
			border: none;
			border-left: var(--accent-border-w) solid transparent;
			border-radius: 0;
			cursor: pointer;
			padding: 0;
		}
		.icon-btn:hover {
			color: var(--text);
			background: var(--surface-hover);
		}
		.icon-btn.active {
			color: var(--text);
			border-left-color: var(--accent);
		}
		.icon-btn svg {
			width: var(--icon-size);
			height: var(--icon-size);
		}
		.spacer {
			flex: 1;
			min-height: 0;
		}

	/* <900px: 底部横排 bar */
	@media (max-width: 899.98px) {
		:host {
			flex-direction: row;
			justify-content: space-around;
			padding-top: 0;
		height: var(--activity-bar-w);
		}
		.icon-btn {
			border-left: none;
		border-bottom: var(--accent-border-w) solid transparent;
		}
		.icon-btn.active {
			border-bottom-color: var(--accent);
		}
		.spacer { display: none; }
	}
	`];

	constructor() {
		super();
		this.activeView = "workspace";
		this.theme = "system";
		this.sidebarCollapsed = false;
		this.workspaceId = 0;
	}

	private onViewClick(view: ActiveView): void {
		if (view === this.activeView) {
			this.dispatchEvent(new CustomEvent("baize-sidebar-toggle", { bubbles: true, composed: true }));
		} else {
			this.dispatchEvent(new CustomEvent("baize-view-change", { detail: { view }, bubbles: true, composed: true }));
		}
	}

	private onThemeClick(): void {
		const next = cycleTheme(this.theme);
		this.dispatchEvent(new CustomEvent("baize-theme-toggle", { detail: { theme: next }, bubbles: true, composed: true }));
	}

	private renderIcon(key: string, active: boolean, label: string, onClick: () => void): TemplateResult {
		return html`
			<button
				class="icon-btn ${active ? "active" : ""}"
				aria-pressed=${active}
				aria-label=${label}
				title=${label}
				@click=${onClick}
			>
				${unsafeHTML(ICONS[key])}
			</button>
		`;
	}
	render() {
		return html`
			${this.workspaceId > 0 ? this.renderIcon("workspace", this.activeView === "workspace", "工作空间", () => this.onViewClick("workspace")) : nothing}
			<div class="spacer"></div>
			${this.renderIcon(`theme-${this.theme}`, false, "主题切换", () => this.onThemeClick())}
		`;
	}
}

customElements.define("baize-activity-bar", BaizeActivityBar);
