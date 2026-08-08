import { LitElement, html, css, type PropertyValues } from "lit";

/**
 * baize-run-rail — 通用 Run 实时视图:订阅 Gateway SSE /api/runs/stream。
 * dock(默认)=浮动 dock(全局); column=需求详情页内全列流式视图。
 * token 级流式由 Gateway 转发,本组件只负责显示并按 Run 过滤。
 * dock 在需求页被抑制(column 接管富视图);离开需求页恢复跨需求指示。
 */
interface RunEvt {
	type: string;
	runId?: number;
	requirementId?: number;
	role?: string;
	requirementTitle?: string;
	text?: string;
}

class BaizeRunRail extends LitElement {
	static properties = {
		variant: {}, // "dock" | "column"
		requirementId: {}, // column 过滤:仅显示本需求事件
		active: { state: true },
		events: { state: true },
		open: { state: true },
		liveText: { state: true },
		suppress: {}, // 需求页抑制 dock(column 接管)
	};

	declare variant: "dock" | "column";
	declare requirementId?: number;
	declare active: RunEvt[];
	declare events: RunEvt[];
	declare open: boolean;
	declare liveText: string;
	declare suppress: boolean;

	private es: EventSource | null = null;

	static styles = css`
		:host {
			--rail-w: 360px;
		}
		/* dock variant:浮动,全局 */
		:host(:not([variant="column"])) {
			position: fixed;
			right: var(--pad);
			bottom: var(--pad);
			z-index: 90;
			max-width: 320px;
			pointer-events: none;
		}
		/* column variant:详情页内全列,不浮动 */
		:host([variant="column"]) {
			display: flex;
			flex: 0 0 var(--rail-w);
			min-width: 0;
			min-height: 0;
			pointer-events: auto;
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
		.col-panel {
			display: flex;
			flex-direction: column;
			height: 100%;
			min-height: 0;
			background: var(--surface);
			border: 1px solid var(--border-strong);
			border-radius: var(--radius);
			overflow: hidden;
			font-size: 0.82rem;
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
		.col-panel .body {
			flex: 1;
			max-height: none;
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
		.ev.live {
			color: var(--text-muted);
			white-space: pre-wrap;
			word-break: break-word;
		}
		.col-panel .ev.live {
			padding: 8px 12px;
			font-size: 0.8rem;
			line-height: 1.5;
		}
		.col-panel .placeholder {
			padding: 16px 12px;
			color: var(--text-subtle);
			font-size: 0.8rem;
			line-height: 1.5;
		}
	`;

	constructor() {
		super();
		this.variant = "dock";
		this.requirementId = undefined;
		this.active = [];
		this.events = [];
		this.open = true;
		this.liveText = "";
		this.suppress = false;
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

	updated(changed: PropertyValues): void {
		// column 切换需求时清掉上一需求的残留活跃 run 与 liveText
		if (changed.has("requirementId")) {
			this.active = [];
			this.liveText = "";
		}
	}

	private belongs(ev: RunEvt): boolean {
		return (
			this.requirementId == null || ev.requirementId === this.requirementId
		);
	}

	private onEv(ev: RunEvt) {
		this.events = [ev, ...this.events].slice(0, 30);
		if (ev.type === "start") {
			if (this.belongs(ev)) {
				this.active = [...this.active, ev];
				this.open = true;
				this.liveText = "";
			}
		} else if (ev.type === "done") {
			this.active = this.active.filter(
				(a) => a.runId !== ev.runId,
			);
		} else if (ev.type === "token") {
			if (this.belongs(ev)) {
				const next = this.liveText + (ev.text ?? "");
				// column:完整流;dock:末 400 字
				this.liveText = this.variant === "column" ? next : next.slice(-400);
			}
		}
	}

	render() {
		if (this.variant === "column") return this.renderColumn();
		return this.renderDock();
	}

	private renderColumn() {
		const scoped = this.events.filter((e) => this.belongs(e) && e.type !== "token");
		return html`<div class="col-panel">
			<div class="head">
				运行
				<span class="n">${this.active.length} 进行中</span>
			</div>
			<div class="body">
				${this.active.map(
					(a) => html`<div class="run">
						<span class="pulse"></span>${a.role ?? ""}
					</div>`,
				)}
				${
					this.liveText
						? html`<div class="ev live">${this.liveText}</div>`
						: this.active.length
							? null
							: html`<div class="placeholder">
								暂无运行。点「启动 Run」开始,token 实时滚动于此(完整流,不截断)。
							</div>`
				}
				${scoped.slice(0, 20).map(
					(e) => html`<div class="ev">
						<span class="k ${e.type === "done" ? "done" : ""}">${e.type}</span>
						${e.role ?? ""}
					</div>`,
				)}
			</div>
		</div>`;
	}

	private renderDock() {
		if (this.suppress) return null;
		if (!this.active.length && !this.events.length) return null;
		if (this.active.length && !this.open) {
			return html`<div class="closed-pill" @click=${() => (this.open = true)}>
				<span class="pulse"></span>${this.active.length} 运行中
			</div>`;
		}
		if (!this.active.length && this.events.length) {
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
						<span class="pulse"></span>${a.requirementTitle ?? ""} · ${a.role ?? ""}
					</div>`,
				)}
				${this.liveText ? html`<div class="ev live">${this.liveText}</div>` : null}
			${this.events.filter((e) => e.type !== "token").slice(0, 8).map(
					(e) => html`<div class="ev">
						<span class="k ${e.type === "done" ? "done" : ""}">${e.type}</span>
						${e.requirementTitle ?? ""} ${e.role ?? ""}
					</div>`,
				)}
			</div>
		</div>`;
	}
}

customElements.define("baize-run-rail", BaizeRunRail);
