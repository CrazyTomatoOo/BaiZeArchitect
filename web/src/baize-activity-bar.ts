import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { sharedStyles, cycleTheme } from "./baize-styles.js";
import { VIEW_LABELS, VIEW_ORDER, type WorkbenchView } from "./baize-asset-library-constants.js";

/** 主题三态。 */
type Theme = "system" | "light" | "dark";

/** Activity Bar 顶层视图;null = 当前路由无对应图标(如关系图全幅)。 */
type ActiveView = WorkbenchView | null;

/** 20×20 图标 SVG 字符串,键 = 视图 id / 主题键。 */
const ICONS: Record<string, string> = {
	requirements: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="12" height="14" rx="1.5"/><line x1="7" y1="7" x2="13" y2="7"/><line x1="7" y1="10" x2="13" y2="10"/><line x1="7" y1="13" x2="11" y2="13"/></svg>`,
	scenario: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M8.5 8l3.5 2-3.5 2z" fill="currentColor" stroke="none"/></svg>`,
	function: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="11" y="3" width="6" height="6" rx="1"/><rect x="3" y="11" width="6" height="6" rx="1"/><rect x="11" y="11" width="6" height="6" rx="1"/></svg>`,
	usecase: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><ellipse cx="12.5" cy="10" rx="5" ry="3"/><line x1="7.8" y1="7.8" x2="9.5" y2="8.8"/></svg>`,
	design: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l5 5-9 9H3v-5z"/><line x1="10" y1="5" x2="15" y2="10"/></svg>`,
	architecture: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2.5" width="6" height="4" rx="1"/><rect x="2.5" y="13" width="6" height="4" rx="1"/><rect x="11.5" y="13" width="6" height="4" rx="1"/><line x1="10" y1="6.5" x2="10" y2="10"/><line x1="5.5" y1="13" x2="5.5" y2="10"/><line x1="14.5" y1="13" x2="14.5" y2="10"/><line x1="5.5" y1="10" x2="14.5" y2="10"/></svg>`,
	data: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="10" cy="4.5" rx="6" ry="2.2"/><path d="M4 4.5v11c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2v-11"/><path d="M4 10c0 1.2 2.7 2.2 6 2.2s6-1 6-2.2"/></svg>`,
	api: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 5L3 10l4 5"/><path d="M13 5l4 5-4 5"/></svg>`,
	stakeholder: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="6.5" r="3"/><path d="M4 16.5c0-3.3 2.7-5 6-5s6 1.7 6 5"/></svg>`,
	"theme-system": `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="3"/><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.3 3.3l1.4 1.4M15.3 15.3l1.4 1.4M3.3 16.7l1.4-1.4M15.3 4.7l1.4-1.4"/><path d="M16 10a6 6 0 11-6-6"/></svg>`,
	"theme-light": `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="10" r="3"/><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.3 3.3l1.4 1.4M15.3 15.3l1.4 1.4M3.3 16.7l1.4-1.4M15.3 4.7l1.4-1.4"/></svg>`,
	"theme-dark": `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 10.4a7 7 0 11-8.4-8.4 9 9 0 008.4 8.4z"/></svg>`,
};

/**
 * baize-activity-bar — 左侧 64px 图标条(原型 C:图标 + 文字标注)。
 * 9 个视图图标(需求 + 8 个资产库)负责顶层视图切换;重复点击当前视图折叠 Side Bar;底部三态主题切换。
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
			gap: 2px;
			overflow-y: auto;
		}
		.icon-btn {
			width: 56px;
			flex: 0 0 auto;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 2px;
			padding: 6px 0;
			color: var(--text-muted);
			background: transparent;
			border: none;
			border-radius: 6px;
			cursor: pointer;
		}
		.icon-btn:hover {
			color: var(--text);
			background: var(--surface-hover);
		}
		.icon-btn.active {
			color: var(--accent-hi);
			background: var(--accent-glow);
		}
		.icon-btn svg {
			width: var(--icon-size);
			height: var(--icon-size);
		}
		.icon-btn .lbl {
			font-size: 9px;
			letter-spacing: 0.02em;
		}
		.spacer {
			flex: 1;
			min-height: 0;
		}

		/* <900px: 底部横排 bar,标注省略 */
		@media (max-width: 899.98px) {
			:host {
				flex-direction: row;
				justify-content: space-around;
				padding-top: 0;
				height: 100%;
				overflow-y: visible;
			}
			.icon-btn {
				width: auto;
				flex: 1 1 0;
				padding: var(--gap-dense) 0;
			}
			.icon-btn .lbl { display: none; }
			.spacer { display: none; }
		}
	`];

	constructor() {
		super();
		this.activeView = null;
		this.theme = "system";
		this.sidebarCollapsed = false;
		this.workspaceId = 0;
	}

	private onViewClick(view: WorkbenchView): void {
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
				<span class="lbl">${label}</span>
			</button>
		`;
	}
	render() {
		if (this.workspaceId === 0) {
			return html`
				<div class="spacer"></div>
				${this.renderIcon(`theme-${this.theme}`, false, "主题切换", () => this.onThemeClick())}
			`;
		}
		return html`
			${VIEW_ORDER.map((view) => this.renderIcon(view, this.activeView === view, VIEW_LABELS[view], () => this.onViewClick(view)))}
			<div class="spacer"></div>
			${this.renderIcon(`theme-${this.theme}`, false, "主题切换", () => this.onThemeClick())}
		`;
	}
}

customElements.define("baize-activity-bar", BaizeActivityBar);
