import { LitElement, html, css } from "lit";
import "./baize-consent-modal.ts";

/**
 * baize-decisions — 待决策页(现代化):跨需求聚合 pending 阶段(待审/打回),
 * 列表+展开;通过走 consent gate,打回带意见。监听 window baize-workspace-change。
 */
interface DecisionItem {
	requirementId: number;
	requirementTitle: string;
	stage: string;
	stageEn: string;
	status: string;
	feedback: string;
	refs: unknown[];
	updated_at: string;
}

class BaizeDecisions extends LitElement {
	static properties = {
		ws: { state: true },
		items: { state: true },
		openKey: { state: true },
		feedback: { state: true },
		busy: { state: true },
		consent: { state: true },
	};

	declare ws: number;
	declare items: DecisionItem[];
	declare openKey: string | null;
	declare feedback: string;
	declare busy: string;
	declare consent: DecisionItem | null;

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
			margin: 4px 0 24px;
			color: var(--text-muted);
			font-size: 0.88rem;
		}
		.list {
			display: flex;
			flex-direction: column;
			gap: var(--gap);
			max-width: 720px;
		}
		.item {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			overflow: hidden;
			transition: border-color 0.2s, box-shadow 0.2s;
		}
		.item:hover {
			border-color: var(--border-strong);
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
		}
		.row {
			display: flex;
			align-items: center;
			gap: 12px;
			padding: 14px 16px;
			cursor: pointer;
		}
		.badge {
			font-size: 11px;
			padding: 2px 9px;
			border-radius: 99px;
			font-weight: 600;
			flex-shrink: 0;
		}
		.badge.warn {
			background: rgba(251, 191, 36, 0.15);
			color: var(--warn);
		}
		.badge.danger {
			background: rgba(251, 113, 133, 0.15);
			color: var(--danger);
		}
		.row .t {
			font-weight: 600;
			font-size: 0.92rem;
		}
		.row .s {
			margin-left: auto;
			color: var(--text-muted);
			font-size: 0.78rem;
			font-family: var(--font-mono);
		}
		.detail {
			padding: 16px;
			border-top: 1px solid var(--border);
			background: var(--surface-2);
		}
		.fb {
			color: var(--danger);
			font-size: 0.8rem;
			margin-bottom: 10px;
		}
		.refs {
			margin-bottom: 12px;
		}
		.refs .r {
			background: var(--bg);
			border: 1px solid var(--border);
			border-radius: var(--radius-sm);
			padding: 8px 10px;
			margin-bottom: 6px;
			font-size: 0.8rem;
			color: var(--text-muted);
		}
		.actions {
			display: flex;
			gap: 10px;
			align-items: flex-start;
			flex-wrap: wrap;
		}
		textarea {
			flex: 1;
			min-width: 200px;
			resize: vertical;
			height: 52px;
			background: var(--bg);
			border: 1px solid var(--border);
			color: var(--text);
			border-radius: var(--radius-sm);
			padding: 8px;
			font: inherit;
			font-size: 0.82rem;
			transition: border-color 0.2s;
		}
		textarea:focus {
			outline: none;
			border-color: var(--accent);
		}
		.btn {
			padding: 8px 16px;
			border-radius: var(--radius-sm);
			border: 1px solid var(--border-strong);
			background: var(--surface-hover);
			color: var(--text);
			cursor: pointer;
			font: inherit;
			font-size: 0.84rem;
			transition: background 0.2s;
		}
		.btn.primary {
			background: var(--ok);
			color: #06120c;
			border-color: transparent;
			font-weight: 600;
		}
		.btn.primary:hover {
			background: var(--run);
		}
		.btn:hover {
			background: var(--surface-2);
		}
		.empty {
			display: flex;
			flex-direction: column;
			align-items: center;
			padding: 48px 24px;
			color: var(--text-muted);
			background: var(--surface);
			border: 1px dashed var(--border-strong);
			border-radius: var(--radius);
			font-size: 0.86rem;
			max-width: 720px;
		}
	`;

	constructor() {
		super();
		this.ws = Number(localStorage.getItem("baize.ui.v1.workspace") ?? "0");
		this.items = [];
		this.openKey = null;
		this.feedback = "";
		this.busy = "";
		this.consent = null;
	}

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener("baize-workspace-change", this.onWs as EventListener);
		if (this.ws) void this.load();
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener("baize-workspace-change", this.onWs as EventListener);
	}

	private onWs = (e: CustomEvent<{ id: number }>) => {
		this.ws = e.detail.id;
		this.load();
	};

	private async load() {
		this.busy = "load";
		try {
			this.items = (await (
				await fetch(`/api/decisions?workspace=${this.ws}`)
			).json()) as DecisionItem[];
		} catch {
			this.items = [];
		}
		this.busy = "";
		this.dispatchEvent(
			new CustomEvent("baize-decisions-count", {
				detail: { count: this.items.length },
				bubbles: true,
				composed: true,
			}),
		);
	}

	private key(it: DecisionItem): string {
		return `${it.requirementId}:${it.stageEn}`;
	}

	private async approve(it: DecisionItem) {
		this.consent = null;
		const r = await fetch(
			`/api/requirements/${it.requirementId}/stage/${it.stageEn}/approve`,
			{ method: "POST" },
		);
		if (!r.ok) {
			const d = (await r.json().catch(() => ({}))) as { error?: string };
			this.error = d.error || "审批失败";
			return;
		}
		await this.load();
	}

	private error = "";

	private async reject(it: DecisionItem) {
		if (!this.feedback.trim()) {
			alert("打回必须填写意见");
			return;
		}
		const r = await fetch(
			`/api/requirements/${it.requirementId}/stage/${it.stageEn}/reject`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ feedback: this.feedback }),
			},
		);
		if (!r.ok) {
			const d = (await r.json().catch(() => ({}))) as { error?: string };
			alert(d.error || "打回失败");
			return;
		}
		this.feedback = "";
		await this.load();
	}

	private consentSummary(it: DecisionItem) {
		const refs = it.refs as Array<Record<string, unknown>>;
		return html`<p>
				${it.requirementTitle} ·「${it.stage}」(${it.status})。本阶段产物 ${refs.length} 项:
			</p>
			${refs.length
				? html`<ul>
						${refs.map((r) => html`<li>${r.title ?? r.name ?? r.type}</li>`)}
					</ul>`
				: html`<p style="color:var(--text-subtle)">(无结构化产物)</p>`}`;
	}

	render() {
		return html`
			<header class="page-head">
				<h1>待决策</h1>
				<p class="sub">跨需求聚合的待审批/打回阶段,逐条处理</p>
			</header>
			${!this.items.length
				? html`<div class="empty">${this.busy ? "加载中…" : "无待决策项,一切顺利"}</div>`
				: html`<div class="list">
						${this.items.map((it) => {
							const k = this.key(it);
							const open = this.openKey === k;
							const refs = it.refs as Array<Record<string, unknown>>;
							return html`
								<div class="item">
									<div class="row" @click=${() => (this.openKey = open ? null : k)}>
										<span class="badge ${it.status === "待审" ? "warn" : "danger"}">${it.status}</span>
										<span class="t">${it.requirementTitle}</span>
										<span class="s">${it.stage}</span>
									</div>
									${open
										? html`<div class="detail">
												${it.status === "打回" && it.feedback
													? html`<div class="fb">上次打回意见:${it.feedback}</div>`
													: null}
												${refs.length
													? html`<div class="refs">
															${refs.map(
																(r) => html`<div class="r">${r.title ?? r.name ?? r.type}</div>`,
															)}
														</div>`
													: null}
												<div class="actions">
													<button class="btn primary" @click=${() => (this.consent = it)}>
														通过(consent)
													</button>
													<textarea
														placeholder="打回意见(必填)"
														.value=${this.feedback}
														@input=${(e: Event) =>
															(this.feedback = (e.target as HTMLTextAreaElement).value)}
													></textarea>
													<button class="btn" @click=${() => this.reject(it)}>打回</button>
												</div>
											</div>`
										: null}
								</div>
							`;
						})}
					</div>`}
			<baize-consent-modal
				.open=${this.consent != null}
				.title=${this.consent ? `通过「${this.consent.stage}」?` : ""}
				.summary=${this.consent ? this.consentSummary(this.consent) : ""}
				@baize-consent-confirm=${() => this.consent && this.approve(this.consent)}
				@baize-consent-cancel=${() => (this.consent = null)}
			></baize-consent-modal>
		`;
	}
}

customElements.define("baize-decisions", BaizeDecisions);
