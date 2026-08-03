import { LitElement, html, css } from "lit";

/**
 * baize-packages — 历史 Design Package 列表 + 查看 + 审批门。
 * GET /api/packages 列表;点击查看(GET markdown);pending 时 approve(POST)。
 * ponytail: <pre> 渲 markdown(不引 marked,无 XSS/依赖);markdown-render 后续 polish。
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
			font-family: system-ui, sans-serif;
			max-width: 960px;
			margin: 0 auto;
			padding: 1rem;
		}
		h2 {
			font-size: 1rem;
		}
		ul {
			list-style: none;
			padding: 0;
		}
		li {
			display: flex;
			gap: .5rem;
			align-items: center;
			padding: .3rem .4rem;
			border-bottom: 1px solid #ddd;
			cursor: pointer;
		}
		li:hover {
			background: #f0f0f0;
		}
		.status {
			font-size: .72rem;
			padding: .1rem .4rem;
			border-radius: 3px;
			background: #eee;
		}
		.status.accepted {
			background: #d4f7d4;
			color: #161;
		}
		.status.pending {
			background: #fde9c8;
			color: #963;
		}
		button {
			padding: .2rem .6rem;
			cursor: pointer;
		}
		pre {
			white-space: pre-wrap;
			background: #f5f5f5;
			padding: .6rem;
			border-radius: 4px;
			font-size: .8rem;
			max-height: 420px;
			overflow: auto;
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
						<span>${p.name}</span>
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
			${
				this.content
					? html`<h2>${this.selected}</h2>
						<pre>${this.content}</pre>`
					: ""
			}
		`;
	}
}

customElements.define("baize-packages", BaizePackages);
