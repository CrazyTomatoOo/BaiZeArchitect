import { css } from "lit";

/**
 * baize-styles — 页面级共享样式(按钮/卡片/徽章/表单/空态/步骤条)。
 * 仅引用 DESIGN.md token,不引入裸值。各 Lit 组件 shadow DOM 内组合使用。
 */
export const sharedStyles = css`
	/* — 页头 — */
	.page-head h1 {
		margin: 0;
		font-size: var(--text-xl);
		font-family: var(--font-display);
		font-weight: 600;
	}
	.page-head .sub {
		margin: 4px 0 0;
		color: var(--text-muted);
		font-size: var(--text-base);
	}

	/* — 按钮(DESIGN.md CTA voice) — */
	button {
		font: inherit;
		border-radius: var(--radius);
		border: 1px solid var(--border-strong);
		background: transparent;
		color: var(--text);
		padding: 8px 14px;
		cursor: pointer;
		white-space: nowrap;
		transition: background var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
	}
	button:hover { background: var(--surface-hover); }
	button.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-fg);
		font-weight: 600;
	}
	button.primary:hover { background: var(--accent-hi); }
	button.danger { border-color: var(--danger); color: var(--danger); }
	button.danger:hover { background: var(--warn-soft); border-color: var(--danger); }
	button:disabled { opacity: 0.4; cursor: not-allowed; }
	button:disabled:hover { background: transparent; border-color: var(--border-strong); }
	button.primary:disabled:hover { background: var(--accent); border-color: var(--accent); }

	/* — 卡片(accent 左条) — */
	.card {
		border: 1px solid var(--border);
		border-left: 3px solid var(--accent);
		border-radius: var(--radius);
		padding: var(--pad);
		background: var(--surface);
		min-width: 0;
	}
	.card h3 {
		margin: 0 0 8px;
		font-size: var(--text-sm);
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	/* — 徽章 — */
	.badge {
		display: inline-block;
		font-size: var(--text-xs);
		padding: 1px 7px;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-muted);
		white-space: nowrap;
	}
	.badge[data-tone="warn"] { background: var(--warn-soft); color: var(--warn); }
	.badge[data-tone="bad"] { background: var(--warn-soft); color: var(--danger); }
	.badge[data-tone="ok"] { background: var(--ok-soft); color: var(--ok); }
	.badge[data-tone="accent"] { background: var(--accent-glow); color: var(--accent); }

	/* — 表单 — */
	input, textarea, select {
		font: inherit;
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface-2);
		color: var(--text);
		box-sizing: border-box;
	}
	input:focus, textarea:focus, select:focus { outline: var(--focus-ring); outline-offset: 1px; }
	textarea { resize: vertical; }

	/* — 空态(自适应高度,一行说明 + 可选动作) — */
	.empty {
		padding: var(--pad);
		color: var(--text-muted);
		font-size: var(--text-base);
	}

	/* — 旅程步骤条 — */
	.journey {
		display: flex;
		align-items: center;
		gap: 0;
		flex-wrap: wrap;
		row-gap: 8px;
	}
	.step {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.step .dot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 999px;
		border: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-subtle);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		flex: 0 0 24px;
	}
	.step .name {
		font-size: var(--text-sm);
		color: var(--text-muted);
		white-space: nowrap;
	}
	.step[data-status="done"] .dot { border-color: var(--ok); background: var(--ok-soft); color: var(--ok); }
	.step[data-status="done"] .name { color: var(--text); }
	.step[data-status="active"] .dot { border-color: var(--accent); background: var(--accent-glow); color: var(--accent); }
	.step[data-status="active"] .name { color: var(--accent); font-weight: 600; }
	.step-link {
		width: 28px;
		height: 1px;
		background: var(--border);
		margin: 0 8px;
		flex: 0 0 28px;
	}
	.step-link.done { background: var(--ok); }

	/* — 表格 — */
	table { border-collapse: collapse; width: 100%; font-size: var(--text-sm); }
	th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--border); }
	th { color: var(--text-muted); font-weight: 600; }

	/* — 运行状态点 — */
	.live { color: var(--text-subtle); }
	.live.on { color: var(--ok); }

	.mono { font-family: var(--font-mono); font-size: var(--text-xs); word-break: break-all; }

	@media (max-width: 480px) {
		.step-link { width: 14px; flex-basis: 14px; margin: 0 5px; }
	}
`;
