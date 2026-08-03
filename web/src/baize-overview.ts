import { LitElement, html, css } from "lit";

/** T05 总览仪表盘:跨 workspace 资产/需求计数。 */
class BaizeOverview extends LitElement {
	static properties = { counts: { state: true } };

	declare counts: Record<string, number>;

	static styles = css`
		:host {
			display: block;
		}
		.grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
			gap: .8rem;
		}
		.card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 1rem;
		}
		.num {
			font-size: 1.6rem;
			font-weight: 700;
			color: var(--accent);
			font-family: var(--font-mono);
		}
		.label {
			font-size: .76rem;
			color: var(--text-muted);
			margin-top: .2rem;
		}
	`;

	constructor() {
		super();
		this.counts = {};
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		this.counts = (await (await fetch("/api/overview")).json()) as Record<
			string,
			number
		>;
	}

	render() {
		const items: Array<[string, string]> = [
			["workspaces", "工作区"],
			["requirements", "需求"],
			["scenarios", "场景"],
			["use_cases", "用例"],
			["function_domains", "功能域"],
			["function_items", "功能项"],
		];
		return html`<div class="grid">
			${items.map(
				([k, label]) => html`<div class="card">
					<div class="num">${this.counts[k] ?? 0}</div>
					<div class="label">${label}</div>
				</div>`,
			)}
		</div>`;
	}
}

customElements.define("baize-overview", BaizeOverview);
