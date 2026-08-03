import { LitElement, html, css } from "lit";

/**
 * baize-app — 设计 run/watch:表单(repoId+需求)→ POST /api/runs → ws 实时流事件。
 * Dark Mode(OLED)token 化;events/plan 用 mono;run 按钮绿色 accent。
 */
class BaizeApp extends LitElement {
	static properties = {
		repoId: { state: true },
		requirement: { state: true },
		events: { state: true },
		plan: { state: true },
		file: { state: true },
		running: { state: true },
	};

	declare repoId: string;
	declare requirement: string;
	declare events: Array<{ type: string; [k: string]: unknown }>;
	declare plan: unknown | null;
	declare file: string;
	declare running: boolean;

	static styles = css`
		:host {
			display: block;
		}
		form {
			display: grid;
			gap: .8rem;
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			padding: 1.2rem;
		}
		label {
			display: block;
			font-size: .76rem;
			color: var(--text-muted);
			margin-bottom: .3rem;
			text-transform: uppercase;
			letter-spacing: .05em;
		}
		input,
		textarea {
			width: 100%;
			box-sizing: border-box;
			background: var(--bg);
			color: var(--text);
			border: 1px solid var(--border);
			border-radius: 6px;
			padding: .55rem .7rem;
			font: inherit;
			font-size: .88rem;
			transition: border-color .2s;
		}
		input:focus,
		textarea:focus {
			outline: none;
			border-color: var(--accent-2);
		}
		textarea {
			resize: vertical;
			font-family: var(--font-mono);
			font-size: .82rem;
		}
		button {
			background: var(--accent);
			color: #052e16;
			border: none;
			border-radius: 6px;
			padding: .65rem 1.2rem;
			font: inherit;
			font-weight: 600;
			font-size: .88rem;
			cursor: pointer;
			transition: filter .2s, transform .1s;
		}
		button:hover {
			filter: brightness(1.12);
		}
		button:active {
			transform: scale(.98);
		}
		button[disabled] {
			opacity: .5;
			cursor: default;
		}
		h2 {
			font-size: .85rem;
			color: var(--text-muted);
			text-transform: uppercase;
			letter-spacing: .06em;
			margin: 1.4rem 0 .5rem;
		}
		.events {
			font-family: var(--font-mono);
			font-size: .76rem;
			background: var(--bg);
			border: 1px solid var(--border);
			color: var(--accent);
			padding: .8rem;
			border-radius: 6px;
			max-height: 220px;
			overflow: auto;
			white-space: pre-wrap;
		}
		.plan {
			white-space: pre-wrap;
			background: var(--bg);
			border: 1px solid var(--border);
			color: var(--text);
			padding: .8rem;
			border-radius: 6px;
			font-size: .8rem;
			font-family: var(--font-mono);
			max-height: 380px;
			overflow: auto;
		}
		.done {
			color: var(--accent);
			font-weight: 600;
			margin-top: .8rem;
		}
	`;

	constructor() {
		super();
		this.repoId = "lws";
		this.requirement = "";
		this.events = [];
		this.plan = null;
		this.file = "";
		this.running = false;
	}

	async run(): Promise<void> {
		if (!this.requirement || this.running) return;
		this.events = [];
		this.plan = null;
		this.file = "";
		this.running = true;
		try {
			const r = await fetch("/api/runs", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					repoId: this.repoId,
					requirement: this.requirement,
				}),
			});
			const { runId } = (await r.json()) as { runId: string };
			const ws = new WebSocket(`/ws?run=${runId}`);
			ws.onmessage = (m) => {
				const ev = JSON.parse(m.data) as {
					type: string;
					[k: string]: unknown;
				};
				this.events = [...this.events, ev];
				if (ev.type === "plan") this.plan = ev.plan;
				if (ev.type === "done") {
					this.file = ev.file as string;
					this.running = false;
				}
				if (ev.type === "error") this.running = false;
			};
		} catch (e) {
			this.events = [...this.events, { type: "error", error: String(e) }];
			this.running = false;
		}
	}

	render() {
		return html`
			<form
				@submit=${(e: Event) => {
					e.preventDefault();
					this.run();
				}}
			>
				<div>
					<label for="repo">仓库 ID</label>
					<input
						id="repo"
						.value=${this.repoId}
						@input=${(e: Event) =>
							(this.repoId = (e.target as HTMLInputElement).value)}
					/>
				</div>
				<div>
					<label for="req">设计需求</label>
					<textarea
						id="req"
						rows="3"
						placeholder="为 disaggregatedset webhook 增加 subdomainPolicy 校验…"
						@input=${(e: Event) =>
							(this.requirement = (e.target as HTMLTextAreaElement).value)}
					></textarea>
				</div>
				<button ?disabled=${this.running}>
					${this.running ? "运行中…" : "提交设计"}
				</button>
			</form>
			${
				this.events.length
					? html`<h2>事件流</h2>
						<div class="events">
							${this.events.map((e) => JSON.stringify(e)).join("\n")}
						</div>`
					: ""
			}
			${
				this.plan
					? html`<h2>Plan(architect 产出)</h2>
						<div class="plan">${JSON.stringify(this.plan, null, 2)}</div>`
					: ""
			}
			${this.file ? html`<div class="done">✓ 写入: ${this.file}</div>` : ""}
		`;
	}
}

customElements.define("baize-app", BaizeApp);
