import { LitElement, html, css } from "lit";
import "./baize-dashboard.ts";

/**
 * baize-system — 系统页(现代化):子 tab [证据可视化 | 设置]。
 * 证据可视化 = 收编旧 baize-dashboard(热点/boundaries/clusters + ADR + gene);
 * 设置 = 最小(schema 驱动表单待 /api/config/schema 端点,现仅运行时说明)。
 */
class BaizeSystem extends LitElement {
	static properties = {
		tab: { state: true },
	};

	declare tab: "evidence" | "settings";

	static styles = css`
		:host {
			display: block;
		}
		.page-head h1 {
			margin: 0;
			font-size: 1.4rem;
			font-weight: 650;
			letter-spacing: -0.01em;
		}
		.page-head .sub {
			margin: 4px 0 20px;
			color: var(--text-muted);
			font-size: 0.88rem;
		}
		.tabs {
			display: flex;
			gap: 4px;
			margin-bottom: 20px;
			border-bottom: 1px solid var(--border);
		}
		.tab {
			padding: 9px 18px;
			background: transparent;
			border: none;
			border-bottom: 2px solid transparent;
			color: var(--text-muted);
			cursor: pointer;
			font: inherit;
			font-size: 0.88rem;
			transition: color 0.2s, border-color 0.2s;
		}
		.tab:hover {
			color: var(--text);
		}
		.tab.active {
			color: var(--accent);
			border-bottom-color: var(--accent);
			font-weight: 600;
		}
		.card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 20px;
			max-width: 720px;
		}
		.card h3 {
			margin: 0 0 10px;
			font-size: 1rem;
			font-weight: 600;
		}
		.card p {
			margin: 6px 0;
			color: var(--text-muted);
			font-size: 0.86rem;
			line-height: 1.6;
		}
		.card code {
			background: var(--surface-2);
			padding: 1px 5px;
			border-radius: 3px;
			font-family: var(--font-mono);
			font-size: 0.8rem;
			color: var(--text);
		}
		.card .muted {
			color: var(--text-subtle);
			font-size: 0.82rem;
		}
	`;

	constructor() {
		super();
		this.tab = "evidence";
	}

	render() {
		return html`
			<header class="page-head">
				<h1>系统</h1>
				<p class="sub">证据可视化与运行时设置</p>
			</header>
			<div class="tabs">
				<button
					class="tab ${this.tab === "evidence" ? "active" : ""}"
					@click=${() => (this.tab = "evidence")}
				>
					证据可视化
				</button>
				<button
					class="tab ${this.tab === "settings" ? "active" : ""}"
					@click=${() => (this.tab = "settings")}
				>
					设置
				</button>
			</div>
			${this.tab === "evidence"
				? html`<baize-dashboard></baize-dashboard>`
				: html`<div class="card">
						<h3>设置</h3>
						<p>
							配置编辑(schema 驱动表单,借 Hermes AutoField)待
							<code>/api/config/schema</code> 端点。
						</p>
						<p class="muted">
							运行时:provider/model 由 gateway env 决定;BAIZE_TOKEN 门控
							/api(默认关)。
						</p>
					</div>`}
		`;
	}
}

customElements.define("baize-system", BaizeSystem);
