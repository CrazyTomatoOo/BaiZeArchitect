import { LitElement, html, css, type TemplateResult } from "lit";

/**
 * baize-consent-modal — 审批 consent gate(T05 交互模式)。
 * 「通过」前弹本阶段产物摘要 + 确认,防误点推进流水线。
 * open 由父组件控制;取消/确认派发 baize-consent-cancel / baize-consent-confirm(跨 shadow 边界)。
 * 键盘:Esc 取消,Enter 确认(输入框聚焦时不拦截)。
 */
class BaizeConsentModal extends LitElement {
	static properties = {
		open: { type: Boolean, reflect: true },
		title: { type: String },
		summary: { attribute: false },
	};

	declare open: boolean;
	declare title: string;
	declare summary: TemplateResult | string;

	static styles = css`
		:host {
			position: fixed;
			inset: 0;
			z-index: 100;
			display: none;
		}
		:host([open]) {
			display: block;
		}
		.backdrop {
			position: absolute;
			inset: 0;
			background: rgba(0, 0, 0, 0.5);
		}
		.panel {
			position: relative;
			margin: 14vh auto 0;
			width: min(480px, 90vw);
			background: var(--surface);
			border: 1px solid var(--border-strong);
			border-radius: var(--radius);
			box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
			overflow: hidden;
		}
		.head {
			padding: var(--pad);
			border-bottom: 1px solid var(--border);
			font-weight: 600;
			display: flex;
			align-items: center;
			gap: 8px;
		}
		.head .warn {
			color: var(--warn);
		}
		.body {
			padding: var(--pad);
			max-height: 50vh;
			overflow: auto;
			color: var(--text-muted);
			font-size: 0.88rem;
		}
		.body ul {
			margin: 0;
			padding-left: 1.2em;
		}
		.foot {
			padding: var(--pad);
			border-top: 1px solid var(--border);
			display: flex;
			gap: 10px;
			justify-content: flex-end;
		}
		.btn {
			padding: 7px 14px;
			border-radius: var(--radius-sm);
			border: 1px solid var(--border-strong);
			background: var(--surface-2);
			color: var(--text);
			cursor: pointer;
			font: inherit;
		}
		.btn.primary {
			background: var(--ok);
			color: #06120c;
			border-color: transparent;
			font-weight: 600;
		}
	`;

	constructor() {
		super();
		this.open = false;
		this.title = "";
		this.summary = "";
	}

	connectedCallback(): void {
		super.connectedCallback();
		addEventListener("keydown", this.onKey);
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		removeEventListener("keydown", this.onKey);
	}

	private onKey = (e: KeyboardEvent) => {
		if (!this.open) return;
		const t = e.target as HTMLElement | null;
		const typing =
			t &&
			(t.tagName === "INPUT" ||
				t.tagName === "TEXTAREA" ||
				t.isContentEditable);
		if (e.key === "Escape") {
			e.preventDefault();
			this.cancel();
		} else if (e.key === "Enter" && !typing) {
			e.preventDefault();
			this.confirm();
		}
	};

	private cancel() {
		this.dispatchEvent(
			new CustomEvent("baize-consent-cancel", {
				bubbles: true,
				composed: true,
			}),
		);
	}

	private confirm() {
		this.dispatchEvent(
			new CustomEvent("baize-consent-confirm", {
				bubbles: true,
				composed: true,
			}),
		);
	}

	render() {
		return html`
			<div class="backdrop" @click=${() => this.cancel()}></div>
			<div class="panel" role="dialog" aria-label="审批确认">
				<div class="head"><span class="warn">⚠</span> ${this.title}</div>
				<div class="body">${this.summary}</div>
				<div class="foot">
					<button class="btn" @click=${() => this.cancel()}>取消</button>
					<button class="btn primary" @click=${() => this.confirm()}>确认通过</button>
				</div>
			</div>
		`;
	}
}

customElements.define("baize-consent-modal", BaizeConsentModal);
