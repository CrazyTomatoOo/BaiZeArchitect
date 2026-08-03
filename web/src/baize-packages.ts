import { LitElement, html, css } from "lit";

/**
 * baize-packages — 历史 Design Package 列表 + 查看 + 审批门。Dark token 化。
 */
interface Pkg {
	name: string;
	repoId: string;
	status: string;
}

class BaizePackages extends LitElement {
	static properties = {
		packages: { state: true },
		selected: { state: true },
		content: { state: true },
	};

	declare packages: Pkg[];
	declare selected: string;
	declare content: string;

	static styles = css`
		:host {
			display: block;
		}
		h2 {
			font-size: .85rem;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: .06em;
			margin: 0 0 .8rem;
		}
		ul {
			list-style: none;
			margin: 0;
			padding: 0;
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			overflow: hidden;
		}
		li {
			display: flex;
			gap: .6rem;
			align-items: center;
			padding: .55rem .9rem;
			border-bottom: 1px solid var(--border);
			cursor: pointer;
			transition: background .15s;
		}
		li:last-child {
			border-bottom: none;
		}
		li:hover {
			background: var(--surface-2);
		}
		.name {
			font-family: var(--font-mono);
			font-size: .78rem;
			color: var(--text);
		}
		.status {
			font-size: .68rem;
			padding: .14rem .55rem;
			border-radius: 999px;
			font-weight: 600;
			letter-spacing: .03em;
		}
		.status.accepted {
			background: rgba(34, 197, 94, .15);
			color: var(--accent);
		}
		.status.pending {
			background: rgba(245, 158, 11, .15);
			color: var(--warn);
		}
		button {
			margin-left: auto;
			background: var(--surface-2);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: .28rem .8rem;
			font: inherit;
			font-size: .75rem;
			cursor: pointer;
			transition: border-color .2s, color .2s;
		}
		button:hover {
			border-color: var(--accent);
			color: var(--accent);
		}
		pre {
			white-space: pre-wrap;
			background: var(--bg);
			border: 1px solid var(--border);
			color: var(--text);
			padding: .8rem;
			border-radius: 6px;
			font-size: .78rem;
			font-family: var(--font-mono);
			max-height: 420px;
			overflow: auto;
			margin-top: 1.2rem;
		}
	`;

	constructor() {
		super();
		this.packages = [];
		this.selected = "";
		this.content = "";
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		await this.load();
	}

	async load(): Promise<void> {
		const r = await fetch("/api/packages");
		this.packages = (await r.json()) as Pkg[];
	}

	async view(p: Pkg): Promise<void> {
		this.selected = p.name;
		const r = await fetch(`/api/packages/${encodeURIComponent(p.name)}`);
		this.content = await r.text();
	}

	async approve(p: Pkg): Promise<void> {
		await fetch(`/api/packages/${encodeURIComponent(p.name)}/approve`, {
			method: "POST",
		});
		await this.load();
		if (this.selected === p.name) await this.view(p);
	}

	render() {
		return html`
			<h2>历史 Design Package(审批)</h2>
			<ul>
				${this.packages.map(
					(p) => html`<li @click=${() => this.view(p)}>
						<span class="status ${p.status}">${p.status}</span>
						<span class="name">${p.name}</span>
						${
							p.status !== "accepted"
								? html`<button
									@click=${(e: Event) => {
										e.stopPropagation();
										this.approve(p);
									}}
								>
									approve
								</button>`
								: ""
						}
					</li>`,
				)}
			</ul>
			${this.content ? html`<pre>${this.content}</pre>` : ""}
		`;
	}
}

customElements.define("baize-packages", BaizePackages);
