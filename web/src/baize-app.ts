import { LitElement, html, css } from "lit";

/**
 * baize-app — run/watch 页。表单(repoId + 需求)→ POST /api/runs → ws 实时流事件
 * (architect/critic phase、plan、critique、done)→ 渲染 emerging plan + 写入文件。
 * ponytail: 用 Lit static-properties API(无 decorators,需 declare 字段做 TS 类型)。
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
			font-family: system-ui, sans-serif;
			max-width: 960px;
			margin: 0 auto;
			padding: 1rem;
		}
		h1 { font-size: 1.1rem; margin: 0 0 1rem; }
		form { display: grid; gap: .5rem; margin-bottom: 1rem; }
		label { display: block; font-size: .85rem; }
		input,
		textarea {
			width: 100%;
			box-sizing: border-box;
			font: inherit;
			padding: .4rem;
		}
		textarea {
			resize: vertical;
		}
		button {
			padding: .5rem 1.2rem;
			cursor: pointer;
		}
		button[disabled] {
			opacity: .5;
			cursor: default;
		}
		.events {
			font-family: ui-monospace, monospace;
			font-size: .78rem;
			background: #1a1a1a;
			color: #eee;
			padding: .6rem;
			border-radius: 4px;
			max-height: 220px;
			overflow: auto;
			white-space: pre-wrap;
		}
		.plan {
			white-space: pre-wrap;
			background: #f5f5f5;
			padding: .6rem;
			border-radius: 4px;
			font-size: .82rem;
			max-height: 360px;
			overflow: auto;
		}
		h2 {
			font-size: .95rem;
			margin: 1rem 0 .4rem;
		}
		.done {
			color: green;
			font-weight: 600;
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
			<h1>BaiZe Architect — 设计 run/watch</h1>
			<form
				@submit=${(e: Event) => {
					e.preventDefault();
					this.run();
				}}
			>
				<label
					>仓库 ID<input
						.value=${this.repoId}
						@input=${(e: Event) =>
							(this.repoId = (e.target as HTMLInputElement).value)}
				/></label>
				<label
					>设计需求<textarea
						rows="3"
						placeholder="为 disaggregatedset webhook 增加 subdomainPolicy 校验…"
						@input=${(e: Event) =>
							(this.requirement = (e.target as HTMLTextAreaElement).value)}
					></textarea></label
				>
				<button ?disabled=${this.running}>
					${this.running ? "运行中…" : "提交设计"}
				</button>
			</form>
			${this.events.length
				? html`<h2>事件流</h2>
						<div class="events">
							${this.events.map((e) => JSON.stringify(e)).join("\n")}
						</div>`
				: ""}
			${this.plan
				? html`<h2>Plan(architect 产出)</h2>
						<div class="plan">${JSON.stringify(this.plan, null, 2)}</div>`
				: ""}
			${this.file ? html`<div class="done">✓ 写入: ${this.file}</div>` : ""}
		`;
	}
}

customElements.define("baize-app", BaizeApp);
