import { LitElement, html, css } from "lit";

/**
 * baize-run-rail — 阶段 run 实时 dock(T05):订阅 gateway SSE /api/runs/stream,
 * 显示进行中 run(pulse)+ 近期事件;切页不丢(全局挂载)。浮动 dock(非 400px 列,
 * 全列待 requirement 详情重构)。token 级流式待 runStage 仪器化(现仅生命周期 start/done)。
 */
interface RunEvt {
	type: string;
	requirementId?: number;
	stage?: string;
	requirementTitle?: string;
}

class BaizeRunRail extends LitElement {
	static properties = {
		active: { state: true },
		events: { state: true },
		open: { state: true },
	};

	declare active: RunEvt[];
	declare events: RunEvt[];
	declare open: boolean;

	private es: EventSource | null = null;

	static styles = css`
		:host {
			position: fixed;
			right: var(--pad);
			bottom: var(--pad);
			z-index: 90;
			max-width: 320px;
			pointer-events: none;
		}
		.dock {
			background: var(--surface);
			border: 1px solid var(--border-strong);
			border-radius: var(--radius);
			box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
			overflow: hidden;
			pointer-events: auto;
			font-size: 0.8rem;
		}
		.head {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 8px 12px;
			border-bottom: 1px solid var(--border);
			font-weight: 600;
		}
		.head .n {
			margin-left: auto;
			color: var(--run);
			font-size: 0.75rem;
			font-family: var(--font-mono);
		}
		.head button {
			background: transparent;
			border: none;
			color: var(--text-muted);
			cursor: pointer;
			font: inherit;
		}
		.body {
			padding: 6px 0;
			max-height: 40vh;
			overflow: auto;
		}
		.run {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 5px 12px;
			color: var(--text);
		}
		.pulse {
			width: 8px;
			height: 8px;
			border-radius: 99px;
			background: var(--run);
			animation: pulse 1.4s infinite;
		}
		@keyframes pulse {
			0%,
			100% {
				opacity: 1;
			}
			50% {
				opacity: 0.35;
			}
		}
		.ev {
			padding: 3px 12px;
			color: var(--text-muted);
			font-family: var(--font-mono);
			font-size: 0.72rem;
		}
		.ev .k {
			color: var(--info);
		}
		.ev .k.done {
			color: var(--ok);
		}
		.closed-pill {
			background: var(--surface);
			border: 1px solid var(--border-strong);
			border-radius: 99px;
			padding: 5px 12px;
			color: var(--text-muted);
			cursor: pointer;
			pointer-events: auto;
			display: inline-flex;
			align-items: center;
			gap: 6px;
			font-size: 0.78rem;
		}
		.closed-pill .pulse {
			width: 7px;
			height: 7px;
		}
	`;

	constructor() {
		super();
		this.active = [];
		this.events = [];
		this.open = true;
	}

	connectedCallback(): void {
		super.connectedCallback();
		try {
			this.es = new EventSource("/api/runs/stream");
			this.es.onmessage = (e: MessageEvent) => {
				try {
					this.onEv(JSON.parse(e.data) as RunEvt);
				} catch {
					// 忽略非 JSON(如 :connected 注释)
				}
			};
		} catch {
			this.es = null;
		}
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		this.es?.close();
	}

	private onEv(ev: RunEvt) {
		this.events = [ev, ...this.events].slice(0, 30);
		if (ev.type === "start") {
			this.active = [...this.active, ev];
			this.open = true;
		} else if (ev.type === "done") {
			this.active = this.active.filter(
				(a) => !(a.requirementId === ev.requirementId && a.stage === ev.stage),
			);
		}
	}

	render() {
		if (!this.active.length && !this.events.length) return null;
		if (this.active.length && !this.open) {
			return html`<div class="closed-pill" @click=${() => (this.open = true)}>
				<span class="pulse"></span>${this.active.length} 运行中
			</div>`;
		}
		if (!this.active.length && this.events.length) {
			// 无活跃,仅近期事件 → 收成可点 pill 展开
			return html`<div class="closed-pill" @click=${() => (this.open = true)}>
				近期 ${this.events.length} 事件 ▸
			</div>`;
		}
		return html`<div class="dock">
			<div class="head">
				运行
				<span class="n">${this.active.length} 进行中</span>
				<button @click=${() => (this.open = false)}>▾</button>
			</div>
			<div class="body">
				${this.active.map(
					(a) => html`<div class="run">
						<span class="pulse"></span>${a.requirementTitle ?? ""} · ${a.stage ?? ""}
					</div>`,
				)}
				${this.events.slice(0, 8).map(
					(e) => html`<div class="ev">
						<span class="k ${e.type === "done" ? "done" : ""}">${e.type}</span>
						${e.requirementTitle ?? ""} ${e.stage ?? ""}
					</div>`,
				)}
			</div>
		</div>`;
	}
}

customElements.define("baize-run-rail", BaizeRunRail);
