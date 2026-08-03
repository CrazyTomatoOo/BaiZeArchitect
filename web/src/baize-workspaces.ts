import { LitElement, html, css } from "lit";

/** T03 工作区管理:1 repo = 1 workspace。列表 + 添加。 */
interface Ws {
	id: number;
	repo_path: string;
	name: string;
}

class BaizeWorkspaces extends LitElement {
	static properties = {
		list: { state: true },
		repoPath: { state: true },
		name: { state: true },
	};

	declare list: Ws[];
	declare repoPath: string;
	declare name: string;

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
		ul {
			list-style: none;
			margin: 0 0 1rem;
			padding: 0;
		}
		li {
			display: flex;
			gap: .6rem;
			padding: .5rem .7rem;
			border: 1px solid var(--border);
			border-radius: 6px;
			margin-bottom: .4rem;
			font-family: var(--font-mono);
			font-size: .78rem;
		}
		li .id {
			color: var(--accent-2);
		}
		form {
			display: flex;
			gap: .5rem;
		}
		input {
			flex: 1;
			background: var(--bg);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: .5rem .7rem;
			font: inherit;
			font-size: .82rem;
		}
		button {
			background: var(--accent);
			color: #052e16;
			border: none;
			border-radius: 6px;
			padding: .5rem 1rem;
			font: inherit;
			font-weight: 600;
			cursor: pointer;
		}
	`;

	constructor() {
		super();
		this.list = [];
		this.repoPath = "";
		this.name = "";
	}

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		await this.load();
	}

	async load(): Promise<void> {
		this.list = (await (await fetch("/api/workspaces")).json()) as Ws[];
	}

	async add(): Promise<void> {
		if (!this.repoPath) return;
		await fetch("/api/workspaces", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ repoPath: this.repoPath, name: this.name || this.repoPath.split("/").pop() }),
		});
		this.repoPath = "";
		this.name = "";
		await this.load();
	}

	render() {
		return html`
			<div class="card">
				<h3>工作区(1 repo = 1 workspace)</h3>
				<ul>
					${this.list.map(
						(w) => html`<li>
							<span class="id">#${w.id}</span>
							<span>${w.name}</span>
							<span>${w.repo_path}</span>
						</li>`,
					)}
				</ul>
				<form
					@submit=${(e: Event) => {
						e.preventDefault();
						this.add();
					}}
				>
					<input
						placeholder="repo 路径(如 /Volumes/.../lws)"
						.value=${this.repoPath}
						@input=${(e: Event) =>
							(this.repoPath = (e.target as HTMLInputElement).value)}
					/>
					<input
						placeholder="名称"
						.value=${this.name}
						@input=${(e: Event) => (this.name = (e.target as HTMLInputElement).value)}
					/>
					<button>添加</button>
				</form>
			</div>
		`;
	}
}

customElements.define("baize-workspaces", BaizeWorkspaces);
