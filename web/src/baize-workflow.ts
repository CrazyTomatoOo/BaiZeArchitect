import { LitElement, html, css, nothing } from "lit";

import {
	artifactSummary,
	designStages,
	gateQueue,
	getApprovalPacket,
	getDesignPackage,
	getRequirement,
	getWorkflowProjection,
	listCommandReceipts,
	listRunEvents,
	listWorkflowEvents,
	listWorkflowIncidents,
	packetReviewDrift,
	pendingCounts,
	recoveryActions,
	sendWorkflowCommand,
	stateHero,
	subscribeRunEvents,
	subscribeWorkflowEvents,
	type ApprovalPacketDetail,
	type CommandReceipt,
	type CommandReceiptListItem,
	type DesignPackageDetail,
	type GateQueueItem,
	type PacketReviewContext,
	type RequirementDetail,
	type RunEventEnvelope,
	type WorkflowEventEnvelope,
	type WorkflowIncidentRecord,
	type WorkflowProjection,
} from "./workflow-client.js";

/**
 * baize-workflow — 自动优先的引导式 Requirement 页面(票15+票16)。
 * 状态 hero(每态一个主动作)+ 概览 + 同页详情 + 高级接管。
 * 票16:确定性 Gate Queue(一次一个 exact subject)、按 Incident 类型的恢复组合、
 * stale 表单冻结(保留 draft、显示 expected/actual、显式 reload)、双流断线禁用命令。
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
		gateFormKey: { state: true },
		formReceipt: { state: true },
		formStale: { state: true },
		liveMessage: { state: true },
		workflowConnected: { state: true },
		runConnected: { state: true },
		approvalOpen: { state: true },
		approvalPacket: { state: true },
		approvalStale: { state: true },
		approvalReceipt: { state: true },
		rejectOpen: { state: true },
		auditOpen: { state: true },
		auditEvents: { state: true },
		auditReceipts: { state: true },
		auditIncidents: { state: true },
		auditRunEvents: { state: true },
		auditRunId: { state: true },
		auditLive: { state: true },
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
	declare gateFormKey: string | null;
	declare formReceipt: CommandReceipt | null;
	declare formStale: boolean;
	declare liveMessage: string;
	declare workflowConnected: boolean;
	declare runConnected: boolean | null;
	declare approvalOpen: boolean;
	declare approvalPacket: ApprovalPacketDetail | null;
	declare approvalStale: boolean;
	declare approvalReceipt: CommandReceipt | null;
	declare rejectOpen: boolean;
	declare auditOpen: boolean;
	declare auditEvents: readonly WorkflowEventEnvelope[];
	declare auditReceipts: readonly CommandReceiptListItem[];
	declare auditIncidents: readonly WorkflowIncidentRecord[];
	declare auditRunEvents: readonly RunEventEnvelope[];
	declare auditRunId: number | null;
	declare auditLive: boolean;

	/** 打开的 gate 表单上下文:commandId 在表单生命周期内固定(重复提交幂等),reload 才换新。 */
	private formContext: { key: string; commandId: string; workflowVersion: number } | null = null;
	private unsubscribeEvents: (() => void) | null = null;
	private unsubscribeRunEvents: (() => void) | null = null;
	private runStreamId: number | null = null;
	/** 专注审阅绑定上下文 + 每个意图一个固定 commandId(approve/reject 各自幂等)。 */
	private approvalContext: (PacketReviewContext & { approveCommandId: string; rejectCommandId: string }) | null = null;
	private unsubscribeAudit: (() => void) | null = null;
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
		this.gateFormKey = null;
		this.formReceipt = null;
		this.formStale = false;
		this.liveMessage = "";
		this.workflowConnected = true;
		this.runConnected = null;
		this.approvalOpen = false;
		this.approvalPacket = null;
		this.approvalStale = false;
		this.approvalReceipt = null;
		this.rejectOpen = false;
		this.auditOpen = false;
		this.auditEvents = [];
		this.auditReceipts = [];
		this.auditIncidents = [];
		this.auditRunEvents = [];
		this.auditRunId = null;
		this.auditLive = false;
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
		.banner { margin-top: 12px; border-radius: 8px; padding: 10px 14px; font-size: 13px; }
		.banner[data-tone="warn"] { border: 1px solid #ecd9a8; background: #fdf7e7; color: #8a6116; }
		.banner[data-tone="bad"] { border: 1px solid #e5b8b8; background: #fdf1f1; color: #9c2b2b; }
		.gates { margin-top: 16px; border: 1px solid #e7dfc8; border-radius: 10px; padding: 14px 16px; background: #fffdf4; }
		.gates h3 { margin: 0 0 8px; font-size: 13px; color: #8a6116; text-transform: uppercase; letter-spacing: 0.06em; }
		.gates ol { margin: 0; padding-left: 0; list-style: none; }
		.gates li { display: flex; gap: 8px; align-items: center; padding: 6px 0; border-bottom: 1px solid #f2ecd8; font-size: 13px; flex-wrap: wrap; }
		.gates .pos { color: #8a6116; font-variant-numeric: tabular-nums; min-width: 34px; }
		.gate-form { margin-top: 10px; border: 1px solid #d4dcee; border-radius: 8px; padding: 12px 14px; background: #fff; }
		.gate-form h4 { margin: 0 0 8px; font-size: 13px; }
		.gate-form form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
		.gate-form input, .gate-form textarea, .gate-form select { font: inherit; padding: 6px 8px; border: 1px solid #c9d3e8; border-radius: 6px; min-width: 200px; }
		.stale-box { margin: 8px 0; border: 1px solid #e5b8b8; background: #fdf1f1; border-radius: 6px; padding: 8px 10px; font-size: 13px; color: #9c2b2b; }
		.context-receipt { margin-top: 8px; font-size: 13px; border-radius: 6px; padding: 8px 10px; }
		.context-receipt[data-outcome="accepted"] { border: 1px solid #b7d9a8; background: #f6fbec; }
		.context-receipt:not([data-outcome="accepted"]) { border: 1px solid #e5b8b8; background: #fdf1f1; color: #9c2b2b; }
		.approval { margin-top: 16px; border: 2px solid #2f4fdd; border-radius: 10px; background: #fff; }
		.approval .approval-body { padding: 14px 16px; max-height: 60vh; overflow-y: auto; }
		.approval h3 { margin: 12px 0 6px; font-size: 13px; color: #4d5f8f; text-transform: uppercase; letter-spacing: 0.06em; }
		.approval h3:first-child { margin-top: 0; }
		.approval-bar { position: sticky; bottom: 0; display: flex; gap: 10px; align-items: center; padding: 12px 16px; background: #f7f9ff; border-top: 1px solid #d4dcee; border-radius: 0 0 8px 8px; }
		.approval-bar .spacer { flex: 1; }
		.approval .digest-line { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }
		.reject-form { margin-top: 10px; border: 1px solid #e5b8b8; border-radius: 8px; padding: 10px 12px; background: #fffafa; }
		.reject-form label { display: inline-flex; gap: 4px; align-items: center; margin-right: 10px; font-size: 13px; }
		.audit-view { margin-top: 16px; border: 1px solid #d4dcee; border-radius: 10px; padding: 14px 16px; background: #fff; }
		.audit-view h3 { margin: 12px 0 6px; font-size: 13px; color: #4d5f8f; text-transform: uppercase; letter-spacing: 0.06em; }
		.audit-view h3:first-child { margin-top: 0; }
		.audit-view .mono { font-family: ui-monospace, monospace; font-size: 12px; word-break: break-all; }
		.audit-view table td:first-child { font-variant-numeric: tabular-nums; color: #66738f; }
		.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	`;

	connectedCallback(): void {
		super.connectedCallback();
		void this.load();
	}

	disconnectedCallback(): void {
		this.unsubscribeEvents?.();
		this.unsubscribeEvents = null;
		this.unsubscribeRunEvents?.();
		this.unsubscribeRunEvents = null;
		this.runStreamId = null;
		this.unsubscribeAudit?.();
		this.unsubscribeAudit = null;
		super.disconnectedCallback();
	}

	/** 双流任一断开即视为断线:禁用治理命令。 */
	private get connected(): boolean {
		return this.workflowConnected && this.runConnected !== false;
	}

	private announce(message: string): void {
		this.liveMessage = message;
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
		this.connectRunStream();
		this.detectStaleForm();
		this.detectApprovalStale();
	}
	/** SSE 使 Projection 前进后,打开的表单冻结:保留 draft、提示 expected/actual、要求显式 reload。 */
	private detectStaleForm(): void {
		if (!this.formContext || !this.projection) return;
		if (!this.formStale && this.projection.workflow.version !== this.formContext.workflowVersion) {
			this.formStale = true;
			this.announce(`表单已过期:期望版本 ${this.formContext.workflowVersion},当前版本 ${this.projection.workflow.version}`);
		}
	}

	private connectEvents(): void {
		if (!this.requirement || !this.projection) return;
		this.unsubscribeEvents?.();
		this.unsubscribeEvents = subscribeWorkflowEvents(
			this.apiBase,
			this.requirement.workflowId,
			this.projection.workflow.lastEventSeq,
			() => void this.refreshProjection(),
			(connected) => {
				this.workflowConnected = connected;
				if (connected) {
					this.announce("Workflow 事件流已连接");
					void this.refreshProjection();
				} else {
					this.announce("连接断开,正在重连;治理命令已禁用");
				}
			},
		);
		this.connectRunStream();
	}

	/** 活动 Run 存在时订阅第二条(Run)SSE;任一断线都禁用命令。 */
	private connectRunStream(): void {
		const runId = this.projection?.activeRun?.id ?? null;
		if (runId === this.runStreamId) return;
		this.unsubscribeRunEvents?.();
		this.unsubscribeRunEvents = null;
		this.runStreamId = runId;
		if (runId === null) {
			this.runConnected = null;
			return;
		}
		this.runConnected = false;
		this.unsubscribeRunEvents = subscribeRunEvents(
			this.apiBase,
			runId,
			0,
			() => void this.refreshProjection(),
			(connected) => {
				this.runConnected = connected;
				this.announce(connected ? "Run 事件流已连接" : "连接断开,正在重连;治理命令已禁用");
			},
		);
	}

	/** 统一命令入口:持久化 receipt 单独呈现,再刷新最终 Projection — 不做乐观变更。 */
	private async runCommand(type: string, payload?: Record<string, unknown>, reason?: string): Promise<void> {
		if (!this.projection || this.busy || !this.connected) return;
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
			this.announce(`命令 ${type} 回执:${result.receipt.outcome}`);
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
		if (this.projection.workflow.state === "ready_to_archive") {
			await this.openApprovalReview();
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
				<button class="primary" data-testid="primary-action" ?disabled=${this.busy || !this.connected} @click=${() => void this.onPrimaryAction()}>
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
						Policy ${projection.workflow.policyBundle.digest.slice(0, 19)}…<br />
						<button data-testid="open-audit" @click=${() => void this.openAuditView()}>打开审计视图</button>
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
								<button data-testid="open-approval" ?disabled=${this.busy || !this.connected} @click=${() => void this.openApprovalReview()}>打开批准审阅</button>
							</div>`
							: nothing}`
					: nothing}

				<h3>操作</h3>
				<div class="command-row" data-testid="detail-commands">
					${["running", "waiting_for_human", "ready_to_archive"].includes(projection.workflow.state)
						? html`<button data-testid="pause-command" ?disabled=${this.busy || !this.connected} @click=${() => void this.runCommand("pause")}>暂停</button>`
						: nothing}
					${projection.activeRun && projection.workflow.state === "running"
						? html`<button data-testid="cancel-command" ?disabled=${this.busy || !this.connected} @click=${() => void this.runCommand("cancel-run", { runId: projection.activeRun!.id })}>取消当前 Run</button>`
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
							<button type="submit" ?disabled=${this.busy || !this.connected}>Steer</button>
						</form>
						<form data-testid="diagnostic-form" @submit=${(event: SubmitEvent) => { event.preventDefault(); void this.submitTakeover("diagnostic-run"); }}>
							<input name="purpose" placeholder="诊断目的" required />
							<button type="submit" ?disabled=${this.busy || !this.connected}>诊断 Run</button>
						</form>
						<form data-testid="replace-plan-form" @submit=${(event: SubmitEvent) => { event.preventDefault(); void this.submitTakeover("replace-plan"); }}>
							<textarea name="proposal" placeholder="完整 PlanProposal JSON(plan-proposal/v1)" required rows="3"></textarea>
							<input name="reason" placeholder="替换原因" required />
							<button type="submit" ?disabled=${this.busy || !this.connected}>替换计划</button>
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

	// ------------------------------------------------------------------
	// 票17:专注 Approval 审阅(精确绑定 current Packet,stale 锁定)
	// ------------------------------------------------------------------

	private async openApprovalReview(): Promise<void> {
		const projection = this.projection;
		if (!projection || projection.workflow.state !== "ready_to_archive" || !projection.currentPacket) return;
		const packet = await getApprovalPacket(this.apiBase, projection.currentPacket.id);
		this.approvalPacket = packet;
		this.approvalContext = {
			packetId: packet.id,
			digest: packet.digest,
			workflowVersion: projection.workflow.version,
			approveCommandId: crypto.randomUUID(),
			rejectCommandId: crypto.randomUUID(),
		};
		this.approvalStale = false;
		this.approvalReceipt = null;
		this.rejectOpen = false;
		this.approvalOpen = true;
		this.announce(`批准包审阅已打开,digest ${packet.digest.slice(0, 27)}…`);
		void this.updateComplete.then(() => {
			this.shadowRoot?.querySelector<HTMLElement>("[data-testid='approval-heading']")?.focus();
		});
	}

	private closeApprovalReview(): void {
		if (!this.approvalOpen) return;
		this.approvalOpen = false;
		this.approvalPacket = null;
		this.approvalContext = null;
		this.approvalStale = false;
		this.approvalReceipt = null;
		this.rejectOpen = false;
		void this.updateComplete.then(() => {
			this.shadowRoot?.querySelector<HTMLElement>("[data-testid='primary-action']")?.focus();
		});
	}

	/** SSE 推进后:Packet 身份/digest 或 Workflow 版本变化 → 锁定审阅,禁用批准,保留阅读位置。 */
	private detectApprovalStale(): void {
		if (!this.approvalOpen || !this.approvalContext || !this.projection) return;
		const drift = packetReviewDrift(this.projection, this.approvalContext);
		if (!drift) return;
		if (!this.approvalStale) {
			this.approvalStale = true;
			this.announce(
				`批准包已变化:期望 digest ${drift.expectedDigest.slice(0, 19)}… / 当前 ${drift.actualDigest ? `${drift.actualDigest.slice(0, 19)}…` : "已撤回"}。批准已禁用,请重新加载。`,
			);
		}
	}

	/** 显式 reload:重新获取 Packet 并重置绑定上下文与两个 commandId;旧意图绝不复用。 */
	private async reloadApprovalReview(): Promise<void> {
		if (!this.projection || !this.approvalContext) return;
		const current = this.projection.currentPacket;
		if (!current || this.projection.workflow.state !== "ready_to_archive") {
			this.closeApprovalReview();
			return;
		}
		const packet = await getApprovalPacket(this.apiBase, current.id);
		this.approvalPacket = packet;
		this.approvalContext = {
			packetId: packet.id,
			digest: packet.digest,
			workflowVersion: this.projection.workflow.version,
			approveCommandId: crypto.randomUUID(),
			rejectCommandId: crypto.randomUUID(),
		};
		this.approvalStale = false;
		this.approvalReceipt = null;
		this.announce("批准包已重新加载到当前 digest,请重新审阅后再决定");
	}

	private async submitApproval(): Promise<void> {
		const context = this.approvalContext;
		if (!this.projection || !context || this.busy || !this.connected || this.approvalStale) return;
		this.busy = true;
		try {
			const result = await sendWorkflowCommand(this.apiBase, this.projection.workflow.id, context.approveCommandId, {
				schemaVersion: "workflow-command/v1",
				type: "approve-packet",
				expectedWorkflowVersion: context.workflowVersion,
				payload: { packetDigest: context.digest },
			});
			this.approvalReceipt = result.receipt;
			this.announce(`批准回执:${result.receipt.outcome}`);
			await this.refreshProjection();
			if (result.receipt.outcome === "accepted") {
				this.receipt = result.receipt;
				this.closeApprovalReview();
			}
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
		} finally {
			this.busy = false;
		}
	}

	private async submitRejection(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const context = this.approvalContext;
		if (!this.projection || !context || this.busy || !this.connected || this.approvalStale) return;
		const data = new FormData(event.target as HTMLFormElement);
		const reason = String(data.get("reason") ?? "");
		const targets = data.getAll("targets").map((value) => String(value));
		if (!reason || targets.length === 0) return;
		this.busy = true;
		try {
			const result = await sendWorkflowCommand(this.apiBase, this.projection.workflow.id, context.rejectCommandId, {
				schemaVersion: "workflow-command/v1",
				type: "reject-packet",
				expectedWorkflowVersion: context.workflowVersion,
				payload: { reason, targets },
			});
			this.approvalReceipt = result.receipt;
			this.announce(`打回回执:${result.receipt.outcome}`);
			await this.refreshProjection();
			if (result.receipt.outcome === "accepted") {
				this.receipt = result.receipt;
				this.announce("批准包已打回,Workflow 返回运行中,系统将按实际状态重新规划或等待恢复");
				this.closeApprovalReview();
			}
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
		} finally {
			this.busy = false;
		}
	}

	// ------------------------------------------------------------------
	// 票17:独立审计视图(Workflow/Run 双流分离,SSE replay/重连)
	// ------------------------------------------------------------------

	private async openAuditView(): Promise<void> {
		const projection = this.projection;
		if (!projection) return;
		const workflowId = projection.workflow.id;
		const [eventsPage, receipts, incidents] = await Promise.all([
			listWorkflowEvents(this.apiBase, workflowId, 0),
			listCommandReceipts(this.apiBase, workflowId),
			listWorkflowIncidents(this.apiBase, workflowId),
		]);
		this.auditEvents = eventsPage.events;
		this.auditReceipts = receipts;
		this.auditIncidents = incidents;
		this.auditRunEvents = [];
		this.auditRunId = projection.activeRun?.id ?? null;
		if (this.auditRunId !== null) {
			const runPage = await listRunEvents(this.apiBase, this.auditRunId, 0);
			this.auditRunEvents = runPage.events;
		}
		this.auditOpen = true;
		this.announce("审计视图已打开");
		void this.updateComplete.then(() => {
			this.shadowRoot?.querySelector<HTMLElement>("[data-testid='audit-heading']")?.focus();
		});
	}

	private closeAuditView(): void {
		this.auditOpen = false;
		this.auditLive = false;
		this.unsubscribeAudit?.();
		this.unsubscribeAudit = null;
		void this.updateComplete.then(() => {
			this.shadowRoot?.querySelector<HTMLElement>("[data-testid='open-audit']")?.focus();
		});
	}

	private async selectAuditRun(runId: number): Promise<void> {
		this.auditRunId = runId;
		const page = await listRunEvents(this.apiBase, runId, 0);
		this.auditRunEvents = page.events;
	}

	private async loadMoreAuditEvents(): Promise<void> {
		if (!this.projection || this.auditEvents.length === 0) return;
		const last = this.auditEvents[this.auditEvents.length - 1]!.seq;
		const page = await listWorkflowEvents(this.apiBase, this.projection.workflow.id, last);
		const known = new Set(this.auditEvents.map((event) => event.seq));
		this.auditEvents = [...this.auditEvents, ...page.events.filter((event) => !known.has(event.seq))];
	}

	/** 实时跟随:从已加载 watermark 之后 replay,新事件按 seq 去重追加;断线自动重连(EventSource)。 */
	private toggleAuditLive(checked: boolean): void {
		this.auditLive = checked;
		this.unsubscribeAudit?.();
		this.unsubscribeAudit = null;
		if (!checked || !this.projection) return;
		const workflowId = this.projection.workflow.id;
		this.unsubscribeAudit = subscribeWorkflowEvents(
			this.apiBase,
			workflowId,
			this.auditEvents[this.auditEvents.length - 1]?.seq ?? 0,
			() => void this.tailAuditEvents(workflowId),
		);
	}

	private async tailAuditEvents(workflowId: number): Promise<void> {
		if (!this.auditLive) return;
		const last = this.auditEvents[this.auditEvents.length - 1]?.seq ?? 0;
		const page = await listWorkflowEvents(this.apiBase, workflowId, last);
		const known = new Set(this.auditEvents.map((event) => event.seq));
		const fresh = page.events.filter((event) => !known.has(event.seq));
		if (fresh.length > 0) {
			this.auditEvents = [...this.auditEvents, ...fresh];
			this.announce(`审计事件流追加 ${fresh.length} 条新事件`);
		}
	}

	/** 审计视图中的 Run id 选项:来自 Workflow 事件中的 run entity(保持两条时间线分离)。 */
	private auditRunIds(): readonly number[] {
		const ids = new Set<number>();
		for (const event of this.auditEvents) {
			if (event.entity?.type === "run") ids.add(event.entity.id);
		}
		if (this.auditRunId !== null) ids.add(this.auditRunId);
		return [...ids].sort((a, b) => a - b);
	}

	// ------------------------------------------------------------------
	// 票16:Gate Queue 表单(一次一个 exact subject,stale 冻结)
	// ------------------------------------------------------------------
	private openGateForm(item: GateQueueItem): void {
		if (!this.projection) return;
		this.gateFormKey = item.key;
		this.formReceipt = null;
		this.formStale = false;
		this.formContext = { key: item.key, commandId: crypto.randomUUID(), workflowVersion: this.projection.workflow.version };
		void this.updateComplete.then(() => {
			this.shadowRoot?.querySelector<HTMLElement>("[data-testid='gate-form'] input, [data-testid='gate-form'] textarea, [data-testid='gate-form'] select")?.focus();
		});
	}

	private closeGateForm(): void {
		const key = this.gateFormKey;
		this.gateFormKey = null;
		this.formContext = null;
		this.formReceipt = null;
		this.formStale = false;
		if (key) {
			void this.updateComplete.then(() => {
				this.shadowRoot?.querySelector<HTMLElement>(`[data-testid='gate-open-${key}']`)?.focus();
			});
		}
	}

	/** 显式 reload:用户重读当前 subject 后,新意图使用新 commandId 与当前版本。 */
	private reloadGateForm(): void {
		if (!this.projection || !this.formContext) return;
		this.formContext = { key: this.formContext.key, commandId: crypto.randomUUID(), workflowVersion: this.projection.workflow.version };
		this.formStale = false;
		this.formReceipt = null;
		this.announce("表单已重新加载到当前版本,请确认后重新提交");
	}

	private gateFormPayload(item: GateQueueItem, data: FormData): Record<string, unknown> | null {
		if (item.commandType === "dispose-decision") {
			const status = String(data.get("status") ?? "");
			const reason = String(data.get("reason") ?? "");
			if (!status || !reason) return null;
			return { decisionId: item.subjectId, status, reason };
		}
		if (item.commandType === "provide-human-input") {
			const input = String(data.get("input") ?? "");
			if (!input || item.gateId === undefined) return null;
			return { gateId: item.gateId, input };
		}
		if (item.commandType === "accept-finding-risk") {
			const impact = String(data.get("impact") ?? "");
			const reason = String(data.get("reason") ?? "");
			if (!impact || !reason || item.findingId === undefined || item.targetRevisionId === undefined) return null;
			return { findingId: item.findingId, targetRevisionId: item.targetRevisionId, impact, reason };
		}
		return null;
	}

	private async submitGateForm(item: GateQueueItem, event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (!this.projection || !this.formContext || this.busy || !this.connected || this.formStale) return;
		const data = new FormData(event.target as HTMLFormElement);
		const payload = this.gateFormPayload(item, data);
		if (!payload) return;
		this.busy = true;
		try {
			// 重复提交沿用表单打开时的 commandId(request digest 相同→幂等);
			// expectedWorkflowVersion 绑定表单打开时的版本——过期即 409,绝不自动 rebase。
			const result = await sendWorkflowCommand(this.apiBase, this.projection.workflow.id, this.formContext.commandId, {
				schemaVersion: "workflow-command/v1",
				type: item.commandType,
				expectedWorkflowVersion: this.formContext.workflowVersion,
				payload,
			});
			this.formReceipt = result.receipt;
			this.announce(`门禁处置回执:${result.receipt.outcome}`);
			await this.refreshProjection();
			if (result.receipt.outcome === "accepted") this.closeGateForm();
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
		} finally {
			this.busy = false;
		}
	}


	// ------------------------------------------------------------------
	// 票16 渲染:Gate Queue / 恢复组合 / stale / 断线
	// ------------------------------------------------------------------

	private gateCategoryLabel(category: GateQueueItem["category"]): string {
		switch (category) {
			case "critical_decision": return "关键 Decision";
			case "human_input": return "人工输入";
			case "finding_disposition": return "Finding 处置";
			case "recovery": return "事故恢复";
		}
	}

	private renderGateQueue() {
		const projection = this.projection;
		if (!projection) return nothing;
		const queue = gateQueue(projection);
		if (queue.length === 0) return nothing;
		const openItem = queue.find((item) => item.key === this.gateFormKey) ?? null;
		return html`
			<section class="gates" data-testid="gate-queue" aria-label="门禁队列">
				<h3>门禁队列(${queue.length})— 一次处理一项</h3>
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
									@click=${() => this.openGateForm(item)}
								>处理</button>
							</li>`,
					)}
				</ol>
				${openItem ? this.renderGateForm(openItem) : nothing}
			</section>
		`;
	}

	private renderGateForm(item: GateQueueItem) {
		const stale = this.formStale;
		return html`
			<div class="gate-form" data-testid="gate-form" role="dialog" aria-label=${`处置 ${this.gateCategoryLabel(item.category)}`}>
				<h4>${this.gateCategoryLabel(item.category)}:${item.title}(队列第 ${item.position} 位)</h4>
				${stale && this.formContext && this.projection
					? html`<div class="stale-box" data-testid="stale-notice">
						Workflow 已更新:期望版本 ${this.formContext.workflowVersion} / 当前版本 ${this.projection.workflow.version}。
						你的草稿已保留;请检查后显式重新加载。
						<button data-testid="stale-reload" @click=${() => this.reloadGateForm()}>重新加载</button>
					</div>`
					: nothing}
				<form data-testid="gate-form-fields" @submit=${(event: SubmitEvent) => void this.submitGateForm(item, event)}>
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
					<button type="button" data-testid="gate-close" @click=${() => this.closeGateForm()}>关闭</button>
				</form>
				${this.formReceipt
					? html`<div class="context-receipt" data-testid="gate-receipt" data-outcome=${this.formReceipt.outcome}>
						回执:${this.formReceipt.commandType} → ${this.formReceipt.outcome}(HTTP ${this.formReceipt.httpStatus})
					</div>`
					: nothing}
			</div>
		`;
	}

	private renderRecovery() {
		const projection = this.projection;
		if (!projection) return nothing;
		const actions = recoveryActions(projection);
		if (actions.length === 0) return nothing;
		return html`
			<section class="details" data-testid="recovery-panel" aria-label="恢复选项">
				<h3>恢复选项(${projection.currentIncident ? projection.currentIncident.incidentType : projection.workflow.currentFailureCode})</h3>
				<div class="command-row">
					${actions.map((action) => {
						if (action.commandType === "replace-plan") {
							return html`<button data-testid="recovery-replace-plan" ?disabled=${this.busy || !this.connected}
								@click=${() => { this.takeoverOpen = true; }}>替换计划(在高级接管中提交)</button>`;
						}
						if (action.commandType === "diagnostic-run") {
							return html`<button data-testid="recovery-diagnostic" ?disabled=${this.busy || !this.connected}
								@click=${() => void this.runCommand("diagnostic-run", { purpose: `恢复诊断:${projection.workflow.currentFailureCode ?? projection.currentIncident?.incidentType ?? ""}` })}>诊断 Run</button>`;
						}
						return html`<button data-testid="recovery-${action.commandType}" ?disabled=${this.busy || !this.connected}
							@click=${() => void this.runCommand(action.commandType, action.payload)}>${action.label}</button>`;
					})}
				</div>
			</section>
		`;
	}

	private renderConnectionBanner() {
		if (this.connected) return nothing;
		return html`<div class="banner" data-tone="bad" data-testid="reconnecting" role="status">连接断开,正在重连…治理命令已暂时禁用。</div>`;
	}

	// ------------------------------------------------------------------
	// 票17 渲染:专注 Approval 审阅 / 独立审计视图
	// ------------------------------------------------------------------

	private renderApprovalReview() {
		if (!this.approvalOpen || !this.approvalPacket || !this.approvalContext || !this.projection) return nothing;
		const packet = this.approvalPacket;
		const content = packet.content;
		const stale = this.approvalStale;
		const drift = stale ? packetReviewDrift(this.projection, this.approvalContext) : null;
		const approvedProjection = this.projection.workflow.state === "archived";
		return html`
			<section class="approval" data-testid="approval-review" role="dialog" aria-label="批准包审阅"
				@keydown=${(event: KeyboardEvent) => { if (event.key === "Escape") this.closeApprovalReview(); }}>
				<div class="approval-body">
					<h3 data-testid="approval-heading" tabindex="-1">批准包审阅 — Packet #${packet.id}</h3>
					<div class="digest-line" data-testid="packet-digest">digest: ${packet.digest}</div>
					<div class="digest-line">schema: ${content.schemaVersion} · policy: ${content.policyBundleDigest.slice(0, 27)}… · requirement revision: #${content.requirementRevisionId}</div>

					${stale && drift
						? html`<div class="stale-box" data-testid="approval-stale" role="alert">
							批准包已更新:期望 digest ${drift.expectedDigest.slice(0, 27)}… / 当前 ${drift.actualDigest ? `${drift.actualDigest.slice(0, 27)}…` : "已撤回"}
							(版本 ${drift.expectedWorkflowVersion} → ${drift.actualWorkflowVersion})。
							审阅已锁定,批准与打回已禁用;阅读位置已保留,请检查差异后显式重新加载。
							<button data-testid="approval-reload" @click=${() => void this.reloadApprovalReview()}>重新加载</button>
						</div>`
						: nothing}

					<h3>必需 Artifact Revisions</h3>
					<table data-testid="packet-artifacts">
						<thead><tr><th>Kind</th><th>Revision</th><th>状态</th><th>Content Digest</th></tr></thead>
						<tbody>
							${content.artifacts.map(
								(artifact) => html`<tr data-kind=${artifact.kind}>
									<td>${artifact.kind}</td>
									<td>r${artifact.revisionNo} (#${artifact.revisionId})</td>
									<td><span class="badge" data-tone=${artifact.status === "approved" ? "ok" : "warn"}>${artifact.status}</span></td>
									<td class="digest-line">${artifact.contentDigest.slice(0, 27)}…</td>
								</tr>`,
							)}
						</tbody>
					</table>

					<h3>Decision 处置</h3>
					<div data-testid="packet-decisions">
						${content.decisions.length === 0 ? html`无 Decision` : nothing}
						${content.decisions.map(
							(decision) => html`<div><span class="badge">${decision.severity}</span> ${decision.summary} — ${decision.status}${decision.reason ? html`(${decision.reason})` : nothing}</div>`,
						)}
					</div>

					<h3>Finding / 风险</h3>
					<div data-testid="packet-findings">
						${content.findings.length === 0 ? html`无 Finding(零 Finding 报告含完整 coverage 声明)` : nothing}
						${content.findings.map(
							(finding) => html`<div>
								<span class="badge" data-tone=${finding.severity === "critical" ? "bad" : finding.severity === "major" ? "warn" : ""}>${finding.severity}</span>
								${finding.summary} — ${finding.status}
								${finding.riskAcceptedBy ? html`(风险接受:${finding.riskAcceptedBy} — ${finding.riskAcceptanceReason})` : nothing}
							</div>`,
						)}
						${content.disclosedFindingIds.length > 0 ? html`<div>披露 Finding ids:${content.disclosedFindingIds.join(", ")}</div>` : nothing}
					</div>

					<h3>Critic Coverage</h3>
					<div data-testid="packet-coverage">覆盖 revisions:${content.criticCoverage.coveredRevisionIds.join(", ") || "—"}</div>

					<h3>Consistency 警告</h3>
					<div data-testid="packet-warnings">
						${content.warnings.length === 0 ? html`无警告` : content.warnings.map((warning) => html`<div class="banner" data-tone="warn">${warning}</div>`)}
					</div>

					<h3>Readiness 检查</h3>
					<div data-testid="packet-readiness">
						${this.projection.readiness.checks.map(
							(check) => html`<div>${check.passed ? "✓" : "✗"} ${check.name} — ${check.detail}</div>`,
						)}
					</div>

					<h3>Provenance</h3>
					<div data-testid="packet-provenance">
						事件溯源与 transcript 见<button data-testid="approval-open-audit" @click=${() => void this.openAuditView()}>审计视图</button>
					</div>

					${this.approvalReceipt
						? html`<div class="context-receipt" data-testid="approval-receipt" data-outcome=${this.approvalReceipt.outcome}>
							回执:${this.approvalReceipt.commandType} → ${this.approvalReceipt.outcome}(HTTP ${this.approvalReceipt.httpStatus})
							${this.approvalReceipt.outcome === "accepted" && !approvedProjection ? html`— 已接受,等待归档 Projection 确认…` : nothing}
						</div>`
						: nothing}

					${this.rejectOpen
						? html`<form class="reject-form" data-testid="reject-form" @submit=${(event: SubmitEvent) => void this.submitRejection(event)}>
							<h3>打回(需要理由与结构化目标)</h3>
							<input name="reason" placeholder="打回理由" required aria-label="打回理由" />
							<fieldset>
								<legend>返工目标</legend>
								${content.requiredArtifactKinds.map(
									(kind) => html`<label><input type="checkbox" name="targets" value=${kind} /> ${kind}</label>`,
								)}
								<label><input type="checkbox" name="targets" value="plan" /> plan</label>
							</fieldset>
							<button type="submit" class="primary" data-testid="reject-submit" ?disabled=${this.busy || !this.connected || stale}>确认打回</button>
						</form>`
						: nothing}
				</div>
				<div class="approval-bar" data-testid="approval-bar">
					<button class="primary" data-testid="approve-submit" ?disabled=${this.busy || !this.connected || stale || !packet.valid}
						@click=${() => void this.submitApproval()}>批准归档</button>
					<button data-testid="reject-toggle" ?disabled=${this.busy || !this.connected || stale}
						@click=${() => { this.rejectOpen = !this.rejectOpen; }}>打回…</button>
					<span class="spacer"></span>
					<button data-testid="approval-close" @click=${() => this.closeApprovalReview()}>关闭(Esc)</button>
				</div>
			</section>
		`;
	}

	private renderAuditView() {
		if (!this.auditOpen || !this.projection) return nothing;
		return html`
			<section class="audit-view" data-testid="audit-view" aria-label="审计视图"
				@keydown=${(event: KeyboardEvent) => { if (event.key === "Escape") this.closeAuditView(); }}>
				<h3 data-testid="audit-heading" tabindex="-1">审计视图 — Workflow #${this.projection.workflow.id}</h3>
				<div class="command-row">
					<button data-testid="audit-close" @click=${() => this.closeAuditView()}>关闭(Esc)</button>
					<button data-testid="audit-more" @click=${() => void this.loadMoreAuditEvents()}>加载更多事件</button>
					<label><input type="checkbox" data-testid="audit-live" .checked=${this.auditLive}
						@change=${(event: Event) => this.toggleAuditLive((event.target as HTMLInputElement).checked)} /> 实时跟随</label>
				</div>

				<h3>Workflow 事件(不含 Run token/工具事件)</h3>
				<table data-testid="audit-workflow-events">
					<thead><tr><th>seq</th><th>type</th><th>workflow 版本</th><th>entity</th><th>command</th></tr></thead>
					<tbody>
						${this.auditEvents.map(
							(event) => html`<tr data-seq=${event.seq} data-type=${event.type}>
								<td>${event.seq}</td>
								<td>${event.type}</td>
								<td>${event.workflowVersion}</td>
								<td>${event.entity ? `${event.entity.type}#${event.entity.id}` : "—"}</td>
								<td class="mono">${event.commandId ?? "—"}</td>
							</tr>`,
						)}
					</tbody>
				</table>

				<h3>Run 事件(独立时间线)</h3>
				<div class="command-row" data-testid="audit-run-picker">
					${this.auditRunIds().map(
						(runId) => html`<button data-testid="audit-run-${runId}" ?disabled=${runId === this.auditRunId}
							@click=${() => void this.selectAuditRun(runId)}>Run #${runId}</button>`,
					)}
					${this.auditRunIds().length === 0 ? html`尚无 Run` : nothing}
				</div>
				<table data-testid="audit-run-events">
					<thead><tr><th>seq</th><th>type</th><th>payload</th></tr></thead>
					<tbody>
						${this.auditRunEvents.map(
							(event) => html`<tr data-seq=${event.seq} data-type=${event.type}>
								<td>${event.seq}</td>
								<td>${event.type}</td>
								<td class="mono">${JSON.stringify(event.payload)}</td>
							</tr>`,
						)}
					</tbody>
				</table>

				<h3>Command Receipts</h3>
				<table data-testid="audit-receipts">
					<thead><tr><th>commandId</th><th>type</th><th>outcome</th><th>HTTP</th><th>版本</th><th>actor</th><th>request digest</th></tr></thead>
					<tbody>
						${this.auditReceipts.map(
							(receipt) => html`<tr data-command-id=${receipt.commandId}>
								<td class="mono">${receipt.commandId}</td>
								<td>${receipt.commandType}</td>
								<td>${receipt.outcome}</td>
								<td>${receipt.httpStatus}</td>
								<td>${receipt.workflowVersion}</td>
								<td>${receipt.actorRef ?? "—"}</td>
								<td class="mono">${receipt.requestDigest.slice(0, 27)}…</td>
							</tr>`,
						)}
					</tbody>
				</table>

				<h3>Incidents / 恢复</h3>
				<div data-testid="audit-incidents">
					${this.auditIncidents.length === 0 ? html`无 Incident` : nothing}
					${this.auditIncidents.map(
						(incident) => html`<div>
							<span class="badge" data-tone=${incident.status === "open" ? "bad" : "ok"}>${incident.status}</span>
							${incident.incidentType} / ${incident.failureCode} — ${incident.subjectType} #${incident.subjectId ?? "—"} · ${incident.createdAt}
						</div>`,
					)}
				</div>

				<h3>版本与 Digest</h3>
				<div class="mono" data-testid="audit-versions">
					workflow version ${this.projection.workflow.version} · last event seq ${this.projection.workflow.lastEventSeq}<br />
					policy bundle ${this.projection.workflow.policyBundle.digest}<br />
					requirement revision digest ${this.projection.requirement.currentRevision.digest}<br />
					${this.projection.currentPacket ? html`packet ${this.projection.currentPacket.digest}(${this.projection.currentPacket.status})` : "尚无批准包"}
				</div>
			</section>
		`;
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
			${this.renderConnectionBanner()}
			${this.renderHero()}
			${this.renderReceipt()}
			${this.renderOverview()}
			${this.renderGateQueue()}
			${this.renderRecovery()}
			${this.renderDetails()}
			${this.renderApprovalReview()}
			${this.renderAuditView()}
			${this.renderPackage()}
			<div class="sr-only" aria-live="polite" data-testid="live-region">${this.liveMessage}</div>
		`;
	}
}

customElements.define("baize-workflow", BaizeWorkflow);
