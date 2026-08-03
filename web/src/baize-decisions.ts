import { LitElement, html, css } from "lit";

/** T06 待决策项:pending 的 design-package(critic+审批)+ approve。 */
interface Pkg {
	name: string;
	repoId: string;
	status: string;
}

class BaizeDecisions extends LitElement {
	static properties = { list: { state: true } };

	declare list: Pkg[];

	static styles = css`
		:host {
			display: block;
		}
		.card {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 1rem;
		}
		h3 {
			margin: 0 0 .6rem;
			font-size: .8rem;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: .06em;
		}
		.row {
			display: flex;
			align-items: center;
			gap: .6rem;
			padding: .5rem .7rem;
			border: 1px solid var(--border);
			border-radius: 6px;
			margin-bottom: .4rem;
			font-family: var(--font-mono);
			font-size: .76rem;
		}
		.status {
			font-size: .7rem;
			padding: .12rem .5rem;
			border-radius: 999px;
			font-weight: 600;
		}
		.status.pending {
			background: rgba(245, 158, 11, .15);
			color: var(--warn);
		}
		.status.accepted {
			background: rgba(34, 197, 94, .15);
			color: var(--accent);
		}
		button {
			margin-left: auto;
			background: var(--accent);
			color: #052e16;
			border: none;
			border-radius: 6px;
			padding: .25rem .8rem;
			font: inherit;
			font-weight: 600;
			font-size: .74rem;
			cursor: pointer;
		}
		.empty {
			color: var(--text-muted);
			font-size: .8rem;
		}
	`;

	constructor() {
		super();
		this.list = [];
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		await this.load();
	}

	async load(): Promise<void> {
		this.list = (await (await fetch("/api/packages")).json()) as Pkg[];
	}

	async approve(p: Pkg): Promise<void> {
		await fetch(`/api/packages/${encodeURIComponent(p.name)}/approve`, {
			method: "POST",
		});
		await this.load();
	}

	render() {
		const pending = this.list.filter((p) => p.status !== "accepted");
		return html`<div class="card">
			<h3>待决策项(${pending.length})</h3>
			${pending.length
				? pending.map(
						(p) => html`<div class="row">
							<span class="status pending">${p.status}</span>
							<span>${p.name}</span>
							<button @click=${() => this.approve(p)}>approve</button>
						</div>`,
					)
				: html`<div class="empty">无待决策项。</div>`}
			<h3 style="margin-top:1rem">已接受(${this.list.length - pending.length})</h3>
			${this.list
				.filter((p) => p.status === "accepted")
				.map(
					(p) => html`<div class="row">
						<span class="status accepted">${p.status}</span>
						<span>${p.name}</span>
					</div>`,
				)}
		</div>`;
	}
}

customElements.define("baize-decisions", BaizeDecisions);
