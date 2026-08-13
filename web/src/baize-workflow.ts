import { LitElement, html, css, nothing } from "lit";

import {
	artifactSummary,
	designStages,
	getDesignPackage,
	getRequirement,
	getWorkflowProjection,
	pendingCounts,
	sendWorkflowCommand,
	stateHero,
	subscribeWorkflowEvents,
	type CommandReceipt,
	type DesignPackageDetail,
	type RequirementDetail,
	type WorkflowProjection,
} from "./workflow-client.js";

/**
 * baize-workflow — 自动优先的引导式 Requirement 页面(票15)。
 * 状态 hero(每态一个主动作)+ 概览 + 同页详情 + 高级接管。
 * 只调用新 Projection / detail / Command / SSE 契约;不做乐观状态变更。
 * 仅在测试装配中挂载,生产 shell 在 S7 前不引用本组件。
 */
class BaizeWorkflow extends LitElement {
	static properties = {
		requirementId: { type: Number, attribute: "requirement-id" },
		apiBase: { type: String, attribute: "api-base" },
		requirement: { state: true },
		projection: { state: true },
		receipt: { state: true },
		detailsOpen: { state: true },
		takeoverOpen: { state: true },
		packageDetail: { state: true },
		loadError: { state: true },
		busy: { state: true },
	};

	declare requirementId: number;
	declare apiBase: string;
	declare requirement: RequirementDetail | null;
	declare projection: WorkflowProjection | null;
	declare receipt: CommandReceipt | null;
	declare detailsOpen: boolean;
	declare takeoverOpen: boolean;
	declare packageDetail: DesignPackageDetail | null;
	declare loadError: string | null;
	declare busy: boolean;

	private unsubscribeEvents: (() => void) | null = null;

	constructor() {
		super();
		this.requirementId = 0;
		this.apiBase = "";
		this.requirement = null;
		this.projection = null;
		this.receipt = null;
		this.detailsOpen = false;
		this.takeoverOpen = false;
		this.packageDetail = null;
		this.loadError = null;
		this.busy = false;
	}

	static styles = css`
		:host { display: block; font-family: system-ui, sans-serif; color: #17203a; }
		.hero { border: 1px solid #d4dcee; border-radius: 10px; padding: 20px; background: #f7f9ff; }
		.hero h2 { margin: 0 0 4px; font-size: 20px; }
		.hero .state { display: inline-block; font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: #4d5f8f; margin-bottom: 6px; }
		.hero p { margin: 4px 0 12px; color: #4a5672; }
		button { font: inherit; border-radius: 8px; border: 1px solid #b9c6e4; background: #fff; padding: 8px 14px; cursor: pointer; }
		button.primary { background: #2f4fdd; border-color: #2f4fdd; color: #fff; font-weight: 600; }
		button:disabled { opacity: 0.5; cursor: default; }
		.receipt { margin-top: 12px; border: 1px solid #d9e2c8; background: #f6fbec; border-radius: 8px; padding: 10px 14px; font-size: 13px; }
		.receipt[data-outcome="accepted"] { border-color: #b7d9a8; }
		.receipt:not([data-outcome="accepted"]) { border-color: #e5b8b8; background: #fdf1f1; }
		.overview { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-top: 16px; }
		.card { border: 1px solid #e0e6f2; border-radius: 10px; padding: 12px 14px; background: #fff; }
		.card h3 { margin: 0 0 8px; font-size: 13px; color: #4d5f8f; text-transform: uppercase; letter-spacing: 0.06em; }
		.stages { display: flex; gap: 6px; }
		.stage { flex: 1; text-align: center; font-size: 12px; padding: 6px 4px; border-radius: 6px; background: #eef1f9; color: #6b7794; }
		.stage[data-status="done"] { background: #dff0d8; color: #2f6b2f; }
		.stage[data-status="active"] { background: #dbe4ff; color: #2f4fdd; font-weight: 600; }
		.counts { display: flex; gap: 14px; font-size: 14px; }
		.counts strong { font-size: 18px; display: block; }
		.audit { font-size: 12px; color: #66738f; line-height: 1.7; word-break: break-all; }
		.details { margin-top: 16px; border: 1px solid #e0e6f2; border-radius: 10px; padding: 14px 16px; background: #fff; }
		.details h3 { margin: 12px 0 6px; font-size: 13px; color: #4d5f8f; text-transform: uppercase; letter-spacing: 0.06em; }
		table { border-collapse: collapse; width: 100%; font-size: 13px; }
		th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #edf0f7; }
		th { color: #66738f; font-weight: 600; }
		.badge { display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 999px; background: #eef1f9; color: #44507a; }
		.badge[data-tone="warn"] { background: #fdf1d7; color: #8a6116; }
		.badge[data-tone="bad"] { background: #fbdddd; color: #9c2b2b; }
		.badge[data-tone="ok"] { background: #dff0d8; color: #2f6b2f; }
		.takeover { margin-top: 12px; border-top: 1px dashed #d4dcee; padding-top: 10px; }
		.takeover form { display: flex; gap: 8px; margin: 8px 0; align-items: center; flex-wrap: wrap; }
		.takeover input, .takeover textarea { font: inherit; padding: 6px 8px; border: 1px solid #c9d3e8; border-radius: 6px; min-width: 220px; }
		.error { margin-top: 12px; color: #9c2b2b; }
		.package { margin-top: 16px; border: 1px solid #cfe3c8; background: #f4faef; border-radius: 10px; padding: 14px 16px; }
		details.disclosure { margin-top: 10px; }
		details.disclosure summary { cursor: pointer; color: #2f4fdd; font-size: 13px; }
		.command-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
	`;

	connectedCallback(): void {
		super.connectedCallback();
		void this.load();
	}

	disconnectedCallback(): void {
		this.unsubscribeEvents?.();
		this.unsubscribeEvents = null;
		super.disconnectedCallback();
	}

	private async load(): Promise<void> {
		try {
			this.requirement = await getRequirement(this.apiBase, this.requirementId);
			await this.refreshProjection();
			this.connectEvents();
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
		}
	}

	private async refreshProjection(): Promise<void> {
		if (!this.requirement) return;
		this.projection = await getWorkflowProjection(this.apiBase, this.requirement.workflowId);
	}

	private connectEvents(): void {
		if (!this.requirement || !this.projection) return;
		this.unsubscribeEvents?.();
		this.unsubscribeEvents = subscribeWorkflowEvents(
			this.apiBase,
			this.requirement.workflowId,
			this.projection.workflow.lastEventSeq,
			() => void this.refreshProjection(),
		);
	}

	/** 统一命令入口:持久化 receipt 单独呈现,再刷新最终 Projection — 不做乐观变更。 */
	private async runCommand(type: string, payload?: Record<string, unknown>, reason?: string): Promise<void> {
		if (!this.projection || this.busy) return;
		this.busy = true;
		try {
			const commandId = crypto.randomUUID();
			const result = await sendWorkflowCommand(this.apiBase, this.projection.workflow.id, commandId, {
				schemaVersion: "workflow-command/v1",
				type,
				expectedWorkflowVersion: this.projection.workflow.version,
				...(payload ? { payload } : {}),
				...(reason ? { reason } : {}),
			});
			this.receipt = result.receipt;
			await this.refreshProjection();
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
		} finally {
			this.busy = false;
		}
	}

	private async onPrimaryAction(): Promise<void> {
		if (!this.projection) return;
		const hero = stateHero(this.projection.workflow.state);
		if (hero.action.kind === "command" && hero.action.commandType) {
			await this.runCommand(hero.action.commandType);
			return;
		}
		if (hero.action.kind === "package") {
			await this.openDesignPackage();
			return;
		}
		this.detailsOpen = true;
	}

	private async openDesignPackage(): Promise<void> {
		if (!this.requirement || this.requirement.designPackageId === null) return;
		this.packageDetail = await getDesignPackage(this.apiBase, this.requirement.designPackageId);
	}

	private renderHero() {
		const projection = this.projection;
		if (!projection) return nothing;
		const hero = stateHero(projection.workflow.state);
		return html`
			<section class="hero" data-testid="hero" data-state=${projection.workflow.state}>
				<span class="state">${projection.workflow.state}</span>
				<h2>${this.requirement?.title ?? ""}</h2>
				<p>${hero.description}</p>
				<button class="primary" data-testid="primary-action" ?disabled=${this.busy} @click=${() => void this.onPrimaryAction()}>
					${hero.action.label}
				</button>
			</section>
		`;
	}

	private renderReceipt() {
		if (!this.receipt) return nothing;
		return html`
			<aside class="receipt" data-testid="command-receipt" data-outcome=${this.receipt.outcome}>
				命令回执:<strong>${this.receipt.commandType}</strong> → ${this.receipt.outcome}
				(HTTP ${this.receipt.httpStatus}, 版本 ${this.receipt.workflowVersion}, 事件 ${this.receipt.lastEventSeq})
			</aside>
		`;
	}

	private renderOverview() {
		const projection = this.projection;
		if (!projection) return nothing;
		const counts = pendingCounts(projection);
		return html`
			<section class="overview" data-testid="overview">
				<div class="card">
					<h3>设计进程</h3>
					<div class="stages" data-testid="stages">
						${designStages(projection).map(
							(stage) => html`<span class="stage" data-testid="stage-${stage.key}" data-status=${stage.status}>${stage.label}</span>`,
						)}
					</div>
				</div>
				<div class="card">
					<h3>Artifact 完成</h3>
					<div data-testid="artifact-summary">${artifactSummary(projection)}</div>
				</div>
				<div class="card">
					<h3>待处理</h3>
					<div class="counts" data-testid="pending-counts">
						<span><strong>${counts.gates}</strong>门禁</span>
						<span><strong>${counts.decisions}</strong>Decision</span>
						<span><strong>${counts.findings}</strong>Finding</span>
					</div>
				</div>
				<div class="card">
					<h3>审计摘要</h3>
					<div class="audit" data-testid="audit-summary">
						版本 ${projection.workflow.version} · 事件 ${projection.workflow.lastEventSeq}<br />
						Plan ${projection.currentPlan ? `r${projection.currentPlan.revisionNo}` : "—"} ·
						Policy ${projection.workflow.policyBundle.digest.slice(0, 19)}…
					</div>
				</div>
			</section>
		`;
	}

	private renderDetails() {
		const projection = this.projection;
		if (!projection || !this.detailsOpen) return nothing;
		return html`
			<section class="details" data-testid="details">
				<h3>Task 顺序</h3>
				<table data-testid="task-table">
					<thead><tr><th>#</th><th>Key</th><th>Kind</th><th>Role</th><th>状态</th><th>最近 Attempt</th></tr></thead>
					<tbody>
						${projection.tasks.map(
							(task, index) => html`<tr data-task-key=${task.key}>
								<td>${index + 1}</td>
								<td>${task.key}</td>
								<td>${task.kind}</td>
								<td>${task.role}</td>
								<td><span class="badge" data-tone=${task.status === "completed" ? "ok" : task.status === "failed" ? "bad" : task.status === "in_progress" ? "warn" : ""}>${task.status}</span></td>
								<td>${task.latestAttempt ? `#${task.latestAttempt.id} ${task.latestAttempt.status}` : "—"}</td>
							</tr>`,
						)}
					</tbody>
				</table>

				<h3>当前 Attempt / Run</h3>
				<div data-testid="active-work">
					${projection.activeRun
						? html`Run #${projection.activeRun.id}(${projection.activeRun.role ?? "—"}, ${projection.activeRun.status})
							${projection.activeClaim ? html` · Attempt #${projection.activeClaim.attemptId}` : nothing}`
						: html`当前没有活动 Attempt / Run`}
				</div>

				<h3>Artifact 与证据</h3>
				<div class="audit" data-testid="revision-facts">
					Requirement r${projection.requirement.currentRevision.revisionNo}
					(${projection.requirement.currentRevision.status}, ${projection.requirement.currentRevision.digest.slice(0, 19)}…)<br />
					${projection.readiness.checks.map(
						(check) => html`<div>${check.passed ? "✓" : "✗"} ${check.name} — ${check.detail}</div>`,
					)}
				</div>

				<h3>Decision / Finding</h3>
				<div data-testid="governance-facts">
					${projection.decisions.length === 0 && projection.findings.length === 0 ? html`暂无 Decision / Finding` : nothing}
					${projection.decisions.map(
						(decision) => html`<div><span class="badge">${decision.severity}</span> ${decision.summary} — ${decision.status}</div>`,
					)}
					${projection.findings.map(
						(finding) => html`<div><span class="badge" data-tone=${finding.severity === "critical" ? "bad" : finding.severity === "major" ? "warn" : ""}>${finding.severity}</span> ${finding.summary} — ${finding.status}</div>`,
					)}
				</div>

				${projection.openGates.length > 0
					? html`<h3>打开的门禁</h3>
						<div data-testid="open-gates">
							${projection.openGates.map((gate) => html`<div><span class="badge" data-tone="warn">${gate.gateType}</span> ${gate.subjectType} #${gate.subjectId}</div>`)}
						</div>`
					: nothing}

				${projection.currentIncident
					? html`<h3>事故</h3>
						<div data-testid="incident">${projection.currentIncident.incidentType} / ${projection.currentIncident.failureCode} — ${projection.currentIncident.status}</div>`
					: nothing}

				${projection.currentPacket
					? html`<h3>批准包</h3>
						<div data-testid="packet">digest ${projection.currentPacket.digest.slice(0, 27)}… — ${projection.currentPacket.status}</div>
						${projection.workflow.state === "ready_to_archive"
							? html`<div class="command-row">
								<button data-testid="approve-packet" ?disabled=${this.busy} @click=${() => void this.runCommand("approve-packet", { packetId: projection.currentPacket!.id })}>批准归档</button>
								<button data-testid="reject-packet" ?disabled=${this.busy} @click=${() => void this.runCommand("reject-packet", { packetId: projection.currentPacket!.id, reason: "不满足要求", targets: ["design"] }, "从详情驳回")}>驳回</button>
							</div>`
							: nothing}`
					: nothing}

				<h3>操作</h3>
				<div class="command-row" data-testid="detail-commands">
					${["running", "waiting_for_human", "ready_to_archive"].includes(projection.workflow.state)
						? html`<button data-testid="pause-command" ?disabled=${this.busy} @click=${() => void this.runCommand("pause")}>暂停</button>`
						: nothing}
					${projection.activeRun && projection.workflow.state === "running"
						? html`<button data-testid="cancel-command" ?disabled=${this.busy} @click=${() => void this.runCommand("cancel-run", { runId: projection.activeRun!.id })}>取消当前 Run</button>`
						: nothing}
				</div>

				${this.renderTakeover()}
			</section>
		`;
	}

	private renderTakeover() {
		const projection = this.projection;
		if (!projection) return nothing;
		return html`
			<details class="disclosure" data-testid="takeover" @toggle=${(event: Event) => { this.takeoverOpen = (event.target as HTMLDetailsElement).open; }}>
				<summary>高级接管(steer / replace-plan / diagnostic-run)</summary>
				${this.takeoverOpen
					? html`
						<form data-testid="steer-form" @submit=${(event: SubmitEvent) => { event.preventDefault; void this.submitTakeover("steer"); }}>
							<input name="text" placeholder="Human Directive 内容" required />
							<button type="submit" ?disabled=${this.busy}>Steer</button>
						</form>
						<form data-testid="diagnostic-form" @submit=${(event: SubmitEvent) => { event.preventDefault(); void this.submitTakeover("diagnostic-run"); }}>
							<input name="purpose" placeholder="诊断目的" required />
							<button type="submit" ?disabled=${this.busy}>诊断 Run</button>
						</form>
						<form data-testid="replace-plan-form" @submit=${(event: SubmitEvent) => { event.preventDefault(); void this.submitTakeover("replace-plan"); }}>
							<textarea name="proposal" placeholder="完整 PlanProposal JSON(plan-proposal/v1)" required rows="3"></textarea>
							<input name="reason" placeholder="替换原因" required />
							<button type="submit" ?disabled=${this.busy}>替换计划</button>
						</form>`
					: nothing}
			</details>
		`;
	}

	private async submitTakeover(kind: "steer" | "diagnostic-run" | "replace-plan"): Promise<void> {
		const form = this.shadowRoot?.querySelector<HTMLFormElement>(`form[data-testid='${kind}-form']`);
		if (!form) return;
		const data = new FormData(form);
		if (kind === "steer") {
			const text = String(data.get("text") ?? "");
			if (text.length === 0) return;
			await this.runCommand("steer", { text });
			return;
		}
		if (kind === "diagnostic-run") {
			const purpose = String(data.get("purpose") ?? "");
			if (purpose.length === 0) return;
			await this.runCommand("diagnostic-run", { purpose });
			return;
		}
		const raw = String(data.get("proposal") ?? "");
		const reason = String(data.get("reason") ?? "");
		try {
			const proposal = JSON.parse(raw) as Record<string, unknown>;
			await this.runCommand("replace-plan", { proposal }, reason || undefined);
		} catch {
			this.loadError = "PlanProposal JSON 无法解析";
		}
	}

	private renderPackage() {
		if (!this.packageDetail) return nothing;
		return html`
			<section class="package" data-testid="design-package">
				<h3>Design Package #${this.packageDetail.id}</h3>
				<div class="audit">
					archive class: ${this.packageDetail.archiveClass}<br />
					digest: ${this.packageDetail.digest}<br />
					approval packet: ${this.packageDetail.approvalPacketId ?? "—"} · approval: ${this.packageDetail.approvalId ?? "—"}<br />
					archived at: ${this.packageDetail.archivedAt}
				</div>
			</section>
		`;
	}

	render() {
		if (this.loadError) return html`<div class="error" data-testid="load-error">${this.loadError}</div>`;
		if (!this.projection) return html`<div data-testid="loading">加载中…</div>`;
		return html`
			${this.renderHero()}
			${this.renderReceipt()}
			${this.renderOverview()}
			${this.renderDetails()}
			${this.renderPackage()}
		`;
	}
}

customElements.define("baize-workflow", BaizeWorkflow);
