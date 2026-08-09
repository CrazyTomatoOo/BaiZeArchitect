import { LitElement, html, css, nothing } from "lit";

interface Decision {
	id: number;
	title: string;
	question: string;
	severity: string;
	status: string;
	created_at: string;
}

interface DecisionItem {
	requirementId: number;
	requirementTitle: string;
	decision: Decision;
	options: Array<{ id: number; title: string; description: string }>;
}

class BaizeDecisions extends LitElement {
	static properties = {
		ws: { state: true },
		items: { state: true },
		openKey: { state: true },
		busy: { state: true },
	};

	declare ws: number;
	declare items: DecisionItem[];
	declare openKey: number | null;
	declare busy: string;

	static styles = css`
		:host { display: block; }
		.page-head h1 { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 1.4rem; }
		.page-head .sub { margin: 4px 0 24px; color: var(--text-muted); font-size: .88rem; }
		.list { display: flex; flex-direction: column; gap: var(--gap); max-width: 780px; }
		.item { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
		.row { display: flex; align-items: center; gap: 12px; padding: 14px 16px; cursor: pointer; }
		.row:hover { background: var(--surface-2); }
		.badge { padding: 2px 9px; border-radius: 99px; color: var(--warn); background: var(--warn-soft); font-size: 11px; font-weight: 600; }
		.row .title { font-weight: 600; }
		.row .severity { margin-left: auto; color: var(--text-muted); font: .78rem var(--font-mono); }
		.detail { padding: 16px; border-top: 1px solid var(--border); background: var(--surface-2); }
		.detail h3 { margin: 0 0 8px; }
		.detail p { white-space: pre-wrap; }
		.option { padding: 8px 10px; margin: 6px 0; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg); }
		.option small { display: block; margin-top: 3px; color: var(--text-muted); }
		.empty { max-width: 780px; padding: 48px 24px; color: var(--text-muted); text-align: center; background: var(--surface); border: 1px dashed var(--border-strong); border-radius: var(--radius); }
		.btn { margin-top: 12px; padding: 8px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: transparent; color: var(--text); cursor: pointer; font: inherit; }
		.btn:hover { border-color: var(--accent); }
	`;

	constructor() {
		super();
		this.ws = Number(localStorage.getItem("baize.ui.v1.workspace") ?? "0");
		this.items = [];
		this.openKey = null;
		this.busy = "";
	}

	connectedCallback(): void {
		super.connectedCallback();
		window.addEventListener(
			"baize-workspace-change",
			this.onWs as EventListener,
		);
		if (this.ws) void this.load();
	}

	disconnectedCallback(): void {
		super.disconnectedCallback();
		window.removeEventListener(
			"baize-workspace-change",
			this.onWs as EventListener,
		);
	}

	private onWs = (event: CustomEvent<{ id: number }>) => {
		this.ws = event.detail.id;
		void this.load();
	};

	private async load(): Promise<void> {
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

	private openRequirement(requirementId: number): void {
		this.dispatchEvent(
			new CustomEvent("baize-goto", {
				detail: { tab: "requirement", requirementId },
				bubbles: true,
				composed: true,
			}),
		);
	}

	render() {
		return html`<header class="page-head"><h1>待决策</h1><p class="sub">跨需求聚合的开放 Decision。选择需求后在通用 Run 中继续处理。</p></header>
			${
				!this.items.length
					? html`<div class="empty">${this.busy ? "加载中…" : "暂无开放 Decision"}</div>`
					: html`<div class="list">${this.items.map((item) => {
							const open = this.openKey === item.decision.id;
							return html`<article class="item"><div class="row" @click=${() => (this.openKey = open ? null : item.decision.id)}><span class="badge">${item.decision.status}</span><span class="title">${item.requirementTitle} · ${item.decision.title}</span><span class="severity">${item.decision.severity}</span></div>${open ? html`<div class="detail"><h3>${item.decision.question}</h3>${item.options.length ? item.options.map((option) => html`<div class="option"><b>${option.title}</b>${option.description ? html`<small>${option.description}</small>` : nothing}</div>`) : html`<p>该 Decision 尚未提供选项。</p>`}<button class="btn" @click=${() => this.openRequirement(item.requirementId)}>打开需求 Run</button></div>` : nothing}</article>`;
						})}</div>`
			}`;
	}
}

customElements.define("baize-decisions", BaizeDecisions);
