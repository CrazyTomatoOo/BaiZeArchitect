import { LitElement, html, css } from "lit";
import { sharedStyles } from "./baize-styles.js";
import type { PanelEntry } from "./baize-shell.js";

/**
 * baize-panel — 底部可折叠面板内容。
 *
 * 接收 PanelEntry[]（FIFO，外部负责截断至最近 50 条）。
 * 自身负责渲染可滚动条目列表；折叠/展开动画由父级 baize-shell 的
 * .panel-slot 处理。
 */
class BaizePanel extends LitElement {
	static properties = {
		entries: { state: true },
	};
	declare entries: PanelEntry[];

	static styles = [sharedStyles, css`
		:host {
			display: flex;
			flex-direction: column;
			height: 100%;
			min-height: 0;
		}

		.list {
			flex: 1;
			overflow-y: auto;
			padding: var(--gap-dense) 0;
		}

		.entry {
			display: flex;
			align-items: baseline;
			gap: var(--gap);
			padding: var(--gap-dense) var(--pad);
			font-size: var(--text-xs);
			color: var(--text-muted);
		}
		.entry:hover { background: var(--surface-hover); }

		.time {
			font-family: var(--font-mono);
			font-variant-numeric: tabular-nums;
			color: var(--text-subtle);
			white-space: nowrap;
		}

		.text {
			flex: 1;
			min-width: 0;
		}

		.command { color: var(--text); }

		.status {
			font-family: var(--font-mono);
			font-variant-numeric: tabular-nums;
		}
		.status.ok { color: var(--ok); }
		.status.bad { color: var(--danger); }

		.empty {
			padding: var(--pad);
			color: var(--text-muted);
			font-size: var(--text-sm);
		}
	`];

	render() {
		const entries = this.entries ?? [];
		if (entries.length === 0) {
			return html`<div class="empty">暂无公告或回执。</div>`;
		}

		return html`
			<div class="list">
				${entries.map(
					(entry) => html`
						<div class="entry">
							<span class="time">${new Date(entry.timestamp).toLocaleTimeString([], { hour12: false })}</span>
							${entry.kind === "announce"
								? html`<span class="text">${entry.text}</span>`
								: html`
									<span class="text">
										<span class="command">${entry.commandType}</span>
										→ ${entry.outcome}
										<span class="status ${entry.httpStatus >= 200 && entry.httpStatus < 300 ? "ok" : "bad"}">${entry.httpStatus}</span>
									</span>
								`}
						</div>
					`,
				)}
			</div>
		`;
	}
}

customElements.define("baize-panel", BaizePanel);
