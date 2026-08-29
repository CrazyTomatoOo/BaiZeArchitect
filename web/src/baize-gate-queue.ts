import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import {
	gateQueue,
	commandLabel,
	statusLabel,
	type WorkflowProjection,
	type CommandReceipt,
	type GateQueueItem,
	type GateCategory,
} from "./workflow-client.js";

/**
 * baize-gate-queue — 门禁队列与处置表单(票 #82)。
 * 纯展示组件:由 baize-workflow 持有 gateFormKey / formContext / formStale /
 * formReceipt / busy / connected,通过属性传入;用户动作以上抛事件方式交回父组件处理。
 */
class BaizeGateQueue extends LitElement {
	static properties = {
		projection: { type: Object },
		gateFormKey: { type: String, attribute: "gate-form-key" },
		formContext: { type: Object, attribute: "form-context" },
		formStale: { type: Boolean, attribute: "form-stale" },
		formReceipt: { type: Object, attribute: "form-receipt" },
		busy: { type: Boolean },
		connected: { type: Boolean },
	};

	declare projection: WorkflowProjection | null;
	declare gateFormKey: string | null;
	declare formContext: { key: string; commandId: string; workflowVersion: number } | null;
	declare formStale: boolean;
	declare formReceipt: CommandReceipt | null;
	declare busy: boolean;
	declare connected: boolean;

	constructor() {
		super();
		this.projection = null;
		this.gateFormKey = null;
		this.formContext = null;
		this.formStale = false;
		this.formReceipt = null;
		this.busy = false;
		this.connected = false;
	}

	static styles = [sharedStyles, css`
		/* — 待处理区 — */
		.gates {
			margin-top: 16px;
			border: 1px solid var(--warn-line);
			border-radius: var(--radius);
			padding: var(--pad);
			background: var(--surface);
		}
		.gates h3 { margin: 0 0 8px; font-size: var(--text-sm); color: var(--warn); letter-spacing: 0.06em; }
		.gates ol { margin: 0; padding-left: 0; list-style: none; }
		.gates li { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--warn-line); font-size: var(--text-sm); flex-wrap: wrap; }
		.gates .pos { color: var(--warn); font-variant-numeric: tabular-nums; min-width: 34px; }

		/* — 门禁表单 — */
		.gate-form { margin-top: 10px; border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; background: var(--surface-2); }
		.gate-form h4 { margin: 0 0 8px; font-size: var(--text-sm); }
		.gate-form form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
		.gate-form input, .gate-form textarea, .gate-form select { min-width: 200px; }

	`];

	private gateCategoryLabel(category: GateCategory): string {
		switch (category) {
			case "critical_decision": return "关键决策";
			case "human_input": return "人工输入";
			case "finding_disposition": return "发现处置";
			case "recovery": return "事故恢复";
		}
	}

	private onOpen(item: GateQueueItem): void {
		this.dispatchEvent(new CustomEvent("baize-open-gate", { detail: { key: item.key }, bubbles: true, composed: true }));
	}

	private onSubmit(item: GateQueueItem, event: SubmitEvent): void {
		event.preventDefault();
		const formData = new FormData(event.target as HTMLFormElement);
		this.dispatchEvent(new CustomEvent("baize-submit-gate", { detail: { key: item.key, formData }, bubbles: true, composed: true }));
	}

	private onClose(): void {
		this.dispatchEvent(new CustomEvent("baize-close-gate", { bubbles: true, composed: true }));
	}

	private onReload(): void {
		this.dispatchEvent(new CustomEvent("baize-reload-gate", { bubbles: true, composed: true }));
	}

	private renderGateForm(item: GateQueueItem) {
		const stale = this.formStale;
		const projection = this.projection;
		return html`
			<div class="gate-form" data-testid="gate-form" role="dialog" aria-label=${`处置 ${this.gateCategoryLabel(item.category)}`}>
				<h4>${this.gateCategoryLabel(item.category)}:${item.title}(队列第 ${item.position} 位)</h4>
				${stale && this.formContext && projection
					? html`<div class="stale-box" data-testid="stale-notice">
						Workflow 已更新:期望版本 ${this.formContext.workflowVersion} / 当前版本 ${projection.workflow.version}。
						你的草稿已保留;请检查后显式重新加载。
						<button data-testid="stale-reload" @click=${this.onReload}>重新加载</button>
					</div>`
					: nothing}
				<form data-testid="gate-form-fields" @submit=${(event: SubmitEvent) => this.onSubmit(item, event)}>
					${item.commandType === "dispose-decision"
						? html`
							<select name="status" required aria-label="处置结果">
								<option value="accepted">接受</option>
								<option value="rejected">拒绝</option>
							</select>
							<input name="reason" placeholder="处置理由" required />`
						: nothing}
					${item.commandType === "provide-human-input"
						? html`<textarea name="input" placeholder="人工输入内容" required rows="2"></textarea>`
						: nothing}
					${item.commandType === "accept-finding-risk"
						? html`
							<input name="impact" placeholder="影响说明" required />
							<input name="reason" placeholder="风险接受理由" required />`
						: nothing}
					<button type="submit" class="primary" data-testid="gate-submit" ?disabled=${this.busy || !this.connected || stale}>提交</button>
					<button type="button" data-testid="gate-close" @click=${this.onClose}>关闭</button>
				</form>
				${this.formReceipt
					? html`<div class="context-receipt" data-testid="gate-receipt" data-outcome=${this.formReceipt.outcome}>
						回执:${commandLabel(this.formReceipt.commandType)} → ${statusLabel(this.formReceipt.outcome)}(HTTP ${this.formReceipt.httpStatus})
					</div>`
					: nothing}
			</div>
		`;
	}

	render() {
		const projection = this.projection;
		if (!projection) return nothing;
		const queue = gateQueue(projection);
		if (queue.length === 0) return nothing;
		const openItem = queue.find((item) => item.key === this.gateFormKey) ?? null;
		return html`
			<section class="gates" data-testid="gate-queue" aria-label="门禁队列">
				<h3>待处理队列(${queue.length})— 一次处理一项</h3>
				<ol>
					${queue.map(
						(item) => html`
							<li data-testid="gate-item" data-key=${item.key} data-category=${item.category}>
								<span class="pos">${item.position}/${queue.length}</span>
								<span class="badge" data-tone=${item.category === "critical_decision" ? "bad" : "warn"}>${this.gateCategoryLabel(item.category)}</span>
								<span>${item.title}</span>
								<button
									data-testid="gate-open-${item.key}"
									?disabled=${this.busy || !this.connected || (this.gateFormKey !== null && this.gateFormKey !== item.key)}
									@click=${() => this.onOpen(item)}
								>处理</button>
							</li>`,
						)}
				</ol>
				${openItem ? this.renderGateForm(openItem) : nothing}
				${!openItem && this.formReceipt
					? html`<div class="context-receipt" data-testid="gate-receipt" data-outcome=${this.formReceipt.outcome}>
						回执:${commandLabel(this.formReceipt.commandType)} → ${statusLabel(this.formReceipt.outcome)}(HTTP ${this.formReceipt.httpStatus})
					</div>`
					: nothing}
			</section>
		`;
	}

	/** 表单打开时聚焦首个输入;关闭时焦点回到该队列项的「处理」按钮。 */
	override updated(changed: Map<string, unknown>): void {
		super.updated(changed);
		if (!changed.has("gateFormKey")) return;
		const previous = changed.get("gateFormKey");
		if (this.gateFormKey !== null) {
			this.shadowRoot?.querySelector<HTMLElement>("[data-testid='gate-form'] input, [data-testid='gate-form'] textarea, [data-testid='gate-form'] select")?.focus();
		} else if (typeof previous === "string") {
			this.shadowRoot?.querySelector<HTMLElement>(`[data-testid='gate-open-${previous}']`)?.focus();
		}
	}
}

customElements.define("baize-gate-queue", BaizeGateQueue);
