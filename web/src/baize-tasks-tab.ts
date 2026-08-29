import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import {
	pendingCounts,
	statusLabel,
	type WorkflowProjection,
} from "./workflow-client.js";

/**
 * baize-tasks-tab — 任务 Tab:待处理计数 + 版本摘要 + 任务顺序表 +
 * 当前运行 + 暂停/取消命令按钮。纯展示组件,命令通过 baize-run-command
 * 事件上抛,由宿主 baize-workflow 执行。
 */
class BaizeTasksTab extends LitElement {
	static properties = {
		projection: { type: Object },
		busy: { type: Boolean },
		connected: { type: Boolean },
	};

	declare projection: WorkflowProjection | null;
	declare busy: boolean;
	declare connected: boolean;

	constructor() {
		super();
		this.projection = null;
		this.busy = false;
		this.connected = false;
	}

	static styles = [sharedStyles, css`
		:host { display: block; }

		.details { margin-top: var(--gap); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--pad); background: var(--surface); }
		.details h3 { margin: 12px 0 6px; font-size: var(--text-sm); color: var(--text-muted); letter-spacing: 0.06em; }
		.details h3:first-child { margin-top: 0; }
		.fact-block { font-size: var(--text-xs); color: var(--text-muted); line-height: 1.7; word-break: break-all; }
		.command-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
	`];

	private dispatchRunCommand(type: string, payload?: Record<string, unknown>): void {
		this.dispatchEvent(new CustomEvent("baize-run-command", {
			bubbles: true,
			composed: true,
			detail: payload === undefined ? { type } : { type, payload },
		}));
	}

	render() {
		const projection = this.projection;
		if (!projection) return nothing;
		const counts = pendingCounts(projection);
		return html`<section class="details" data-testid="details">
			<h3>待处理与版本</h3>
			<div class="fact-block" data-testid="status-summary">
				待处理:<span data-testid="pending-counts">门禁 ${counts.gates} · 决策 ${counts.decisions} · 发现 ${counts.findings}</span><br />
				版本 ${projection.workflow.version} · 事件 ${projection.workflow.lastEventSeq} ·
				计划 ${projection.currentPlan ? `r${projection.currentPlan.revisionNo}` : "—"}
			</div>

			<h3>任务顺序</h3>
			<table data-testid="task-table">
				<thead><tr><th>#</th><th>键</th><th>类型</th><th>角色</th><th>状态</th><th>最近尝试</th></tr></thead>
				<tbody>
					${projection.tasks.map(
						(task, index) => html`<tr data-task-key=${task.key}>
							<td>${index + 1}</td>
							<td>${task.key}</td>
							<td>${task.kind}</td>
							<td>${task.role}</td>
							<td><span class="badge" data-tone=${task.status === "completed" ? "ok" : task.status === "failed" ? "bad" : task.status === "in_progress" ? "warn" : ""}>${statusLabel(task.status)}</span></td>
							<td>${task.latestAttempt ? `#${task.latestAttempt.id} ${statusLabel(task.latestAttempt.status)}` : "—"}</td>
						</tr>`,
					)}
				</tbody>
			</table>

			<h3>当前运行</h3>
			<div data-testid="active-work">
				${projection.activeRun
					? html`运行 #${projection.activeRun.id}(${projection.activeRun.role ?? "—"}, ${statusLabel(projection.activeRun.status)})
						${projection.activeClaim ? html` · 尝试 #${projection.activeClaim.attemptId}` : nothing}`
					: html`当前没有活动的运行`}
			</div>

			${["running", "waiting_for_human", "ready_to_archive"].includes(projection.workflow.state)
				? html`<div class="command-row"><button data-testid="pause-command" ?disabled=${this.busy || !this.connected} @click=${() => this.dispatchRunCommand("pause")}>暂停</button></div>`
				: nothing}
			${projection.activeRun && projection.workflow.state === "running"
				? html`<div class="command-row"><button class="danger" data-testid="cancel-command" ?disabled=${this.busy || !this.connected} @click=${() => this.dispatchRunCommand("cancel-run", { runId: projection.activeRun!.id })}>取消当前运行</button></div>`
				: nothing}
		</section>`;
	}
}

customElements.define("baize-tasks-tab", BaizeTasksTab);
