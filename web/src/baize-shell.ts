import { LitElement, html, css } from "lit";

/**
 * baize-shell — app shell:header + tab 导航(需求 / 工作区 / 总览)。
 * 旅程:新用户 工作区→需求;老用户直接进需求续做。默认落地「需求」。
 * 子视图保持挂载(hidden 切换)以保留状态;子视图可派发 baize-goto 切 tab。
 */
class BaizeShell extends LitElement {
	static properties = { tab: { state: true } };

	declare tab: string;

	static styles = css`
		:host {
			display: block;
			min-height: 100vh;
			background: var(--bg);
			color: var(--text);
			font-family: var(--font-ui);
		}
		header {
			display: flex;
			align-items: baseline;
			gap: .8rem;
			padding: 1.3rem 1.6rem .9rem;
			border-bottom: 1px solid var(--border);
		}
		h1 {
			margin: 0;
			font-size: 1.15rem;
			font-weight: 600;
			letter-spacing: .02em;
		}
		h1 .dot {
			color: var(--accent);
		}
		.sub {
			color: var(--text-muted);
			font-size: .8rem;
		}
		nav {
			display: flex;
			gap: .3rem;
			padding: .7rem 1.6rem 0;
		}
		nav button {
			background: transparent;
			border: 1px solid transparent;
			color: var(--text-muted);
			padding: .5rem 1rem;
			border-radius: var(--radius) var(--radius) 0 0;
			cursor: pointer;
			font: inherit;
			font-size: .85rem;
			transition: color .2s, background .2s, border-color .2s;
		}
		nav button:hover {
			color: var(--text);
		}
		nav button:focus-visible {
			outline: 2px solid var(--accent-2);
			outline-offset: 2px;
		}
		nav button.active {
			color: var(--accent);
			background: var(--surface);
			border-color: var(--border);
			border-bottom-color: var(--surface);
		}
		main {
			max-width: 1100px;
			margin: 0 auto;
			padding: 1.4rem 1.6rem 3rem;
		}
		[hidden] {
			display: none;
		}
	`;

	constructor() {
		super();
		this.tab = "requirement";
	}

	connectedCallback(): void {
		super.connectedCallback();
		this.addEventListener("baize-goto", ((e: CustomEvent<{ tab: string }>) => {
			this.tab = e.detail.tab;
		}) as EventListener);
	}

	render() {
		return html`
			<header>
				<h1><span class="dot">●</span> BaiZe Architect</h1>
				<span class="sub">需求设计流水线 · 场景→用例→功能→设计→归档</span>
			</header>
			<nav>
				<button
					class=${this.tab === "requirement" ? "active" : ""}
					@click=${() => (this.tab = "requirement")}
				>
					需求设计
				</button>
				<button
					class=${this.tab === "workspaces" ? "active" : ""}
					@click=${() => (this.tab = "workspaces")}
				>
					工作区
				</button>
				<button
					class=${this.tab === "overview" ? "active" : ""}
					@click=${() => (this.tab = "overview")}
				>
					总览
				</button>
			</nav>
			<main>
				<baize-requirement ?hidden=${this.tab !== "requirement"}></baize-requirement>
				<baize-workspaces ?hidden=${this.tab !== "workspaces"}></baize-workspaces>
				<div ?hidden=${this.tab !== "overview"}>
					<baize-overview></baize-overview>
					<baize-dashboard></baize-dashboard>
				</div>
			</main>
		`;
	}
}

customElements.define("baize-shell", BaizeShell);
