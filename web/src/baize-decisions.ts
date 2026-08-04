import { LitElement, html, css, type TemplateResult } from "lit";

/**
 * baize-decisions — 待决策页(T03 治理区):跨需求聚合 pending 阶段(待审/打回),
 * 列表+展开;通过走 consent gate(复用 baize-consent-modal),打回带意见。
 * GET /api/decisions?workspace=;POST 复用 /api/requirements/:id/stage/:en/approve|reject。
 * 派发 baize-decisions-count {count} 供 sidebar 显琥珀 chip。
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
		h2 {
			margin: 0 0 var(--gap);
			font-size: 1rem;
		}
		.list {
			display: flex;
			flex-direction: column;
			gap: var(--gap);
		}
		.item {
			background: var(--surface);
			border: 1px solid var(--border);
			border-radius: var(--radius);
			overflow: hidden;
		}
		.row {
			display: flex;
			align-items: center;
			gap: 10px;
			padding: 10px var(--pad);
			cursor: pointer;
		}
		.row:hover {
			background: var(--surface-hover);
		}
		.badge {
			font-size: 11px;
			padding: 1px 8px;
			border-radius: 99px;
			font-weight: 600;
		}
		.badge.warn {
			background: rgba(245, 158, 11, 0.15);
			color: var(--warn);
		}
		.badge.danger {
			background: rgba(251, 113, 133, 0.15);
			color: var(--danger);
		}
		.row .t {
			font-size: 0.88rem;
		}
		.row .s {
			margin-left: auto;
			color: var(--text-muted);
			font-size: 0.8rem;
			font-family: var(--font-mono);
		}
		.detail {
			padding: var(--pad);
			border-top: 1px solid var(--border);
		}
		.fb {
			color: var(--danger);
			font-size: 0.8rem;
			margin-bottom: 8px;
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
			background: var(--surface-2);
			border: 1px solid var(--border);
			color: var(--text);
			border-radius: var(--radius-sm);
			padding: 6px 8px;
			font: inherit;
			font-size: 0.82rem;
			resize: vertical;
		}
		.btn {
			padding: 7px 14px;
			border-radius: var(--radius-sm);
			border: 1px solid var(--border-strong);
			background: var(--surface-2);
			color: var(--text);
			cursor: pointer;
			font: inherit;
			font-size: 0.82rem;
		}
		.btn.primary {
			background: var(--ok);
			color: #06120c;
			border-color: transparent;
			font-weight: 600;
		}
		.empty {
			color: var(--text-subtle);
			font-size: 0.85rem;
			padding: var(--pad);
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

	async connectedCallback(): Promise<void> {
		super.connectedCallback();
		window.addEventListener("baize-workspace-change", this.onWs as EventListener);
		if (this.ws) await this.load();
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener(
			"baize-workspace-change",
			this.onWs as EventListener,
		);
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
			alert("审批失败");
			return;
		}
		await this.load();
	}

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
			alert("打回失败");
			return;
		}
		this.feedback = "";
		await this.load();
	}

	private consentSummary(it: DecisionItem): TemplateResult {
		const refs = it.refs as Array<Record<string, unknown>>;
		return html`<p>
				${it.requirementTitle} ·「${it.stage}」(${it.status})。本阶段产物
				${refs.length} 项:
			</p>
			${
				refs.length
					? html`<ul>
						${refs.map((r) => html`<li>${r.title ?? r.name ?? r.type}</li>`)}
					</ul>`
					: html`<p style="color:var(--text-subtle)">(无结构化产物)</p>`
			}`;
	}

	render() {
		return html`
			<h2>待决策</h2>
			${
				!this.items.length
					? html`<div class="empty">
						${this.busy ? "加载中…" : "无待决策项"}
					</div>`
					: html`<div class="list">
						${this.items.map((it) => {
							const k = this.key(it);
							const open = this.openKey === k;
							return html`
								<div class="item">
									<div
										class="row"
										@click=${() => (this.openKey = open ? null : k)}
									>
										<span
											class="badge ${it.status === "待审" ? "warn" : "danger"}"
											>${it.status}</span
										>
										<span class="t">${it.requirementTitle}</span>
										<span class="s">${it.stage}</span>
									</div>
									${
										open
											? html`<div class="detail">
												${
													it.status === "打回" && it.feedback
														? html`<div class="fb">
															上次打回意见:${it.feedback}
														</div>`
														: null
												}
												<div class="actions">
													<button
														class="btn primary"
														@click=${() => (this.consent = it)}
													>
														通过(consent)
													</button>
													<textarea
														rows="2"
														placeholder="打回意见(必填)"
														.value=${this.feedback}
														@input=${(e: Event) =>
															(this.feedback = (
																e.target as HTMLTextAreaElement
															).value)}
													></textarea>
													<button
														class="btn"
														@click=${() => this.reject(it)}
													>
														打回
													</button>
												</div>
											</div>`
											: null
									}
								</div>
							`;
						})}
					</div>`
			}
			<baize-consent-modal
				.open=${this.consent != null}
				.title=${this.consent ? `通过「${this.consent.stage}」?` : ""}
				.summary=${this.consent ? this.consentSummary(this.consent) : ""}
				@baize-consent-confirm=${() =>
					this.consent && this.approve(this.consent)}
				@baize-consent-cancel=${() => (this.consent = null)}
			></baize-consent-modal>
		`;
	}
}

customElements.define("baize-decisions", BaizeDecisions);
