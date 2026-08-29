import { LitElement, html, css } from "lit";
import { sharedStyles } from "./baize-styles.js";
import type { StatusSnapshot } from "./baize-shell.js";

/**
 * baize-status-bar — VS Code 式底部状态栏。
 *
 * 纯展示组件：接收 StatusSnapshot、workspaceName、panelOpen。
 * 点击右侧箭头触发 baize-panel-toggle 事件。
 */
class BaizeStatusBar extends LitElement {
	static properties = {
		statusSnapshot: { state: true },
		workspaceName: { type: String },
		panelOpen: { type: Boolean },
	};
	declare statusSnapshot: StatusSnapshot | null;
	declare workspaceName: string;
	declare panelOpen: boolean;

	static styles = [sharedStyles, css`
		:host {
			display: flex;
			align-items: center;
			gap: var(--gap);
			width: 100%;
			height: 100%;
			font-size: var(--text-xs);
			color: var(--text-muted);
			user-select: none;
		}

		.indicator {
			display: inline-flex;
			align-items: center;
			gap: var(--gap-dense);
		}

		.dot {
			width: var(--status-dot-size);
			height: var(--status-dot-size);
			border-radius: var(--radius-pill);
			background: var(--text-subtle);
		}
		.dot.ok { background: var(--ok); }
		.dot.danger { background: var(--danger); }

		.spacer { flex: 1; }

		.mono {
			font-family: var(--font-mono);
			font-variant-numeric: tabular-nums;
		}

		.toggle {
			background: transparent;
			border: none;
			padding: 0 var(--gap-dense);
			color: var(--text-muted);
			cursor: pointer;
			font: inherit;
			line-height: 1;
		}
		.toggle:hover { color: var(--text); }

		/* — <900px 精简：只留指示灯 + 状态 + 待处理计数（DESIGN.md Responsive floor） — */
		@media (max-width: 899.98px) {
			.mono, .role { display: none; }
		}
	`];

	private togglePanel(): void {
		this.dispatchEvent(
			new CustomEvent("baize-panel-toggle", { bubbles: true, composed: true }),
		);
	}

	render() {
		const s = this.statusSnapshot;
		const dotClass = s ? (s.connected ? "ok" : "danger") : "";
		const connectionText = s ? (s.connected ? "已连接" : "已断开") : "未启动";

		return html`
			<span class="indicator"><span class="dot ${dotClass}"></span>${connectionText}</span>
			${s
				? html`
					<span>${s.workflowState}</span>
					<span class="mono">v${s.workflowVersion}·seq${s.lastEventSeq}</span>
					<span>门禁 ${s.pendingGates}·决策 ${s.pendingDecisions}·发现 ${s.pendingFindings}</span>
					<span class="spacer"></span>
					<span class="role">角色: ${s.runRole ?? "-"}</span>
				`
				: html`
					<span class="spacer"></span>
					<span>${this.workspaceName}</span>
				`}
			<button class="toggle" @click=${this.togglePanel} aria-label=${this.panelOpen ? "折叠面板" : "展开面板"}>
				${this.panelOpen ? "▾" : "▸"}
			</button>
		`;
	}
}

customElements.define("baize-status-bar", BaizeStatusBar);
