import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";

import {
	artifactSummary,
	bootstrapSession,
	checkSession,
	createRequirement,
	designStages,
	gateQueue,
	getApprovalPacket,
	getDesignPackage,
	getRequirement,
	getWorkflowProjection,
	listCommandReceipts,
	listRequirements,
	listRunEvents,
	listWorkflowEvents,
	listWorkflowIncidents,
	packetReviewDrift,
	pendingCounts,
	recoveryActions,
	sendWorkflowCommand,
	stateHero,
	journeySteps,
	stateLabel,
	commandLabel,
	statusLabel,
	severityLabel,
	gateCategoryLabel,
	subscribeRunEvents,
	subscribeWorkflowEvents,
	type ApprovalPacketDetail,
	type CommandReceipt,
	type CommandReceiptListItem,
	type DesignPackageDetail,
	type GateQueueItem,
	type OperatorSession,
	type PacketReviewContext,
	type RequirementDetail,
	type RequirementSummary,
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
		workspaceId: { type: Number, attribute: "workspace-id" },
		apiBase: { type: String, attribute: "api-base" },
		session: { state: true },
		loginToken: { state: true },
		loginError: { state: true },
		requirements: { state: true },
		createTitle: { state: true },
		createSummary: { state: true },
		createDescription: { state: true },
		creating: { state: true },
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
		navOpen: { state: true },
		pendingGate: { type: String, attribute: "pending-gate" },
		pendingApproval: { type: Boolean, attribute: "pending-approval" },
	};

	declare requirementId: number;
	declare workspaceId: number;
	declare apiBase: string;
	declare session: OperatorSession | null;
	declare loginToken: string;
	declare loginError: string | null;
	declare requirements: readonly RequirementSummary[];
	declare createTitle: string;
	declare createSummary: string;
	declare createDescription: string;
	declare creating: boolean;
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
	declare navOpen: boolean;
	declare pendingGate: string | null;
	declare pendingApproval: boolean;

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
		this.workspaceId = 1;
		this.apiBase = "";
		this.session = null;
		this.loginToken = "";
		this.loginError = null;
		this.requirements = [];
		this.createTitle = "";
		this.createSummary = "";
		this.createDescription = "";
		this.creating = false;
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
		this.navOpen = false;
		this.pendingGate = null;
		this.pendingApproval = false;
	}

	static styles = [sharedStyles, css`
		/* Hallmark · genre: atmospheric · macrostructure: Workbench · design-system: DESIGN.md · designed-as-app */
		:host { display: block; min-height: 100vh; background: var(--bg); color: var(--text); font-family: var(--font-ui); font-size: var(--text-base); line-height: 1.55; }
		.page { max-width: var(--content-max); margin: 0 auto; padding: var(--pad) calc(var(--pad) * 1.4) 3rem; }

		/* — 返回链接 — */
		.back {
			display: inline-flex; align-items: center; gap: 6px;
			background: none; border: none; padding: 4px 0;
			color: var(--text-muted); font-size: var(--text-sm); cursor: pointer;
			margin-bottom: var(--gap);
		}
		.back:hover { color: var(--accent); background: none; }

		/* — 状态卡 — */
		.hero {
			border: 1px solid var(--border);
			border-left: 3px solid var(--accent);
			border-radius: var(--radius);
			padding: calc(var(--pad) + 6px);
			background: var(--surface);
			margin-top: var(--gap);
		}
		.hero .state {
			display: inline-block;
			font-size: var(--text-xs);
			letter-spacing: 0.08em;
			color: var(--accent);
			margin-bottom: 6px;
			font-family: var(--font-mono);
		}
		.hero h2 { margin: 0 0 4px; font-size: var(--text-xl); font-family: var(--font-display); font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
		.hero p { margin: 4px 0 12px; color: var(--text-muted); }
		.hero .journey { margin-bottom: 14px; }

		/* — 回执 — */
		.receipt {
			margin-top: 12px;
			border: 1px solid var(--ok);
			background: var(--ok-soft);
			border-radius: var(--radius);
			padding: 10px 14px;
			font-size: var(--text-sm);
		}
		.receipt:not([data-outcome="accepted"]) { border-color: var(--danger); background: var(--warn-soft); color: var(--danger); }

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

		.stale-box { margin: 8px 0; border: 1px solid var(--danger); background: var(--warn-soft); border-radius: var(--radius-sm); padding: 8px 10px; font-size: var(--text-sm); color: var(--danger); }
		.context-receipt { margin-top: 8px; font-size: var(--text-sm); border-radius: var(--radius-sm); padding: 8px 10px; }
		.context-receipt[data-outcome="accepted"] { border: 1px solid var(--ok); background: var(--ok-soft); }
		.context-receipt:not([data-outcome="accepted"]) { border: 1px solid var(--danger); background: var(--warn-soft); color: var(--danger); }

		/* — 详情折叠 — */
		.details { margin-top: 16px; border: 1px solid var(--border); border-radius: var(--radius); padding: var(--pad); background: var(--surface); }
		.details h3 { margin: 12px 0 6px; font-size: var(--text-sm); color: var(--text-muted); letter-spacing: 0.06em; }
		.details h3:first-child { margin-top: 0; }
		.audit { font-size: var(--text-xs); color: var(--text-muted); line-height: 1.7; word-break: break-all; }

		/* — 接管 — */
		.takeover { margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px; }
		.takeover form { display: flex; gap: 8px; margin: 8px 0; align-items: center; flex-wrap: wrap; }
		.takeover input, .takeover textarea { min-width: 220px; }
		details.disclosure { margin-top: 10px; }
		details.disclosure summary { cursor: pointer; color: var(--accent); font-size: var(--text-sm); }
		.command-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }

		/* — 横幅 — */
		.banner { margin-top: 12px; border-radius: var(--radius); padding: 10px 14px; font-size: var(--text-sm); }
		.banner[data-tone="warn"] { border: 1px solid var(--warn-line); background: var(--warn-soft); color: var(--warn); }
		.banner[data-tone="bad"] { border: 1px solid var(--danger); background: var(--warn-soft); color: var(--danger); }
		.error { margin-top: 12px; color: var(--danger); }

		/* — 批准 — */
		.approval { margin-top: 16px; border: 2px solid var(--accent); border-radius: var(--radius); background: var(--surface); }
		.approval .approval-body { padding: var(--pad); max-height: 60vh; overflow-y: auto; }
		.approval h3 { margin: 12px 0 6px; font-size: var(--text-sm); color: var(--text-muted); letter-spacing: 0.06em; }
		.approval h3:first-child { margin-top: 0; }
		.approval-bar { position: sticky; bottom: 0; display: flex; gap: 10px; align-items: center; padding: 12px 16px; background: var(--surface-2); border-top: 1px solid var(--border); border-radius: 0 0 var(--radius-sm) var(--radius-sm); }
		.approval-bar .spacer { flex: 1; }
		.approval .digest-line { font-family: var(--font-mono); font-size: var(--text-xs); word-break: break-all; }
		.reject-form { margin-top: 10px; border: 1px solid var(--danger); border-radius: var(--radius); padding: 10px 12px; background: var(--warn-soft); }
		.reject-form label { display: inline-flex; gap: 4px; align-items: center; margin-right: 10px; font-size: var(--text-sm); }

		/* — 审计 — */
		.audit-view { margin-top: 16px; border: 1px solid var(--border); border-radius: var(--radius); padding: var(--pad); background: var(--surface); }
		.audit-view h3 { margin: 12px 0 6px; font-size: var(--text-sm); color: var(--text-muted); letter-spacing: 0.06em; }
		.audit-view h3:first-child { margin-top: 0; }
		.audit-view table td:first-child { font-variant-numeric: tabular-nums; color: var(--text-muted); }

		/* — 设计包 — */
		.package { margin-top: 16px; border: 1px solid var(--ok); background: var(--ok-soft); border-radius: var(--radius); padding: var(--pad); }

		/* — 登录 — */
		.login-wrap { min-height: 100vh; display: grid; place-items: center; padding: var(--pad); box-sizing: border-box; }
		.login-form { width: min(420px, 100%); box-sizing: border-box; }
		.login-brand { font-size: var(--text-xl); margin-bottom: 6px; font-family: var(--font-display); font-weight: 600; }
		.login-brand .dot { color: var(--accent); }
		.login-form p { margin: 4px 0 14px; color: var(--text-muted); }
		.login-form input { width: 100%; }
		.login-form button { margin-top: 10px; width: 100%; }

		.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	`];

	connectedCallback(): void {
		super.connectedCallback();
		void this.checkAndLoad();
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

	private async checkAndLoad(): Promise<void> {
		try {
			this.session = await checkSession(this.apiBase);
		} catch {
			this.session = null;
			return;
		}
		if (this.requirementId > 0) {
			void this.load();
		} else {
			void this.loadRequirements();
		}
	}

	private async handleLogin(event: Event): Promise<void> {
		event.preventDefault();
		try {
			this.session = await bootstrapSession(this.apiBase, this.loginToken);
			this.loginError = null;
			void this.loadRequirements();
		} catch (error) {
			this.loginError = error instanceof Error ? error.message : String(error);
		}
	}

	private async loadRequirements(): Promise<void> {
		try {
			this.requirements = await listRequirements(this.apiBase, this.workspaceId);
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
		}
	}

	private async handleCreateRequirement(event: Event): Promise<void> {
		event.preventDefault();
		this.creating = true;
		try {
			const created = await createRequirement(this.apiBase, this.workspaceId, {
				title: this.createTitle,
				summary: this.createSummary,
				description: this.createDescription,
			});
			this.requirementId = created.requirementId;
			void this.loadRequirements();
			this.createTitle = "";
			this.createSummary = "";
			this.createDescription = "";
			void this.load();
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
		} finally {
			this.creating = false;
		}
	}

	private selectRequirement(id: number): void {
		this.requirementId = id;
		this.navOpen = false;
		void this.load();
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
		this.consumeIntent();
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
		const steps = journeySteps(projection);
		return html`
			<section class="hero" data-testid="hero" data-state=${projection.workflow.state}>
				<span class="state">${stateLabel(projection.workflow.state)}</span>
				<h2>${this.requirement?.title ?? ""}</h2>
				<div class="journey" data-testid="stages" aria-label="设计旅程">
					${steps.map(
						(step, i) => html`${i > 0 ? html`<span class="step-link ${steps[i - 1]!.status === "done" ? "done" : ""}"></span>` : nothing}
						<span class="step" data-testid="stage-${step.key}" data-status=${step.status}>
							<span class="dot">${step.status === "done" ? "✓" : i + 1}</span>
							<span class="name">${step.label}</span>
						</span>`,
					)}
				</div>
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
				命令回执:<strong>${commandLabel(this.receipt.commandType)}</strong> → ${statusLabel(this.receipt.outcome)}
				(HTTP ${this.receipt.httpStatus}, 版本 ${this.receipt.workflowVersion}, 事件 ${this.receipt.lastEventSeq})
			</aside>
		`;
	}


	private renderAuditSummary() {
		const projection = this.projection;
		if (!projection) return nothing;
		const counts = pendingCounts(projection);
		return html`
			<div class="details" style="margin-top:16px">
				<h3>待处理与审计</h3>
				<div class="audit" data-testid="audit-summary">
					待处理:<span data-testid="pending-counts">门禁 ${counts.gates} · 决策 ${counts.decisions} · 发现 ${counts.findings}</span><br />
					版本 ${projection.workflow.version} · 事件 ${projection.workflow.lastEventSeq} ·
					计划 ${projection.currentPlan ? `r${projection.currentPlan.revisionNo}` : "—"} ·
					策略 ${projection.workflow.policyBundle.digest.slice(0, 19)}…<br />
					<button data-testid="open-audit" @click=${() => void this.openAuditView()}>打开审计视图</button>
				</div>
			</div>
		`;
	}

	private renderDetails() {
		const projection = this.projection;
		if (!projection || !this.detailsOpen) return nothing;
		const counts = pendingCounts(projection);
		return html`
			<section class="details" data-testid="details">
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

				<h3>产物与证据</h3>
				<div class="audit" data-testid="revision-facts">
					需求 r${projection.requirement.currentRevision.revisionNo}
					(${statusLabel(projection.requirement.currentRevision.status)}, ${projection.requirement.currentRevision.digest.slice(0, 19)}…)<br />
					产物完成:<span data-testid="artifact-summary">${artifactSummary(projection)}</span><br />
					${projection.readiness.checks.map(
						(check) => html`<div>${check.passed ? "✓" : "✗"} ${check.name} — ${check.detail}</div>`,
					)}
				</div>

				<h3>决策与发现</h3>
				<div data-testid="governance-facts">
					${projection.decisions.length === 0 && projection.findings.length === 0 ? html`暂无决策与发现` : nothing}
					${projection.decisions.map(
						(decision) => html`<div><span class="badge">${severityLabel(decision.severity)}</span> ${decision.summary} — ${statusLabel(decision.status)}</div>`,
					)}
					${projection.findings.map(
						(finding) => html`<div><span class="badge" data-tone=${finding.severity === "critical" ? "bad" : finding.severity === "major" ? "warn" : ""}>${severityLabel(finding.severity)}</span> ${finding.summary} — ${statusLabel(finding.status)}</div>`,
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
						<div data-testid="incident">${projection.currentIncident.incidentType} / ${projection.currentIncident.failureCode} — ${statusLabel(projection.currentIncident.status)}</div>`
					: nothing}

				${projection.currentPacket
					? html`<h3>批准包</h3>
						<div data-testid="packet">摘要 ${projection.currentPacket.digest.slice(0, 27)}… — ${statusLabel(projection.currentPacket.status)}</div>
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
						? html`<button class="danger" data-testid="cancel-command" ?disabled=${this.busy || !this.connected} @click=${() => void this.runCommand("cancel-run", { runId: projection.activeRun!.id })}>取消当前运行</button>`
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
				<summary>高级接管(人工指令 / 替换计划 / 诊断运行)</summary>
				${this.takeoverOpen
					? html`
						<form data-testid="steer-form" @submit=${(event: SubmitEvent) => { event.preventDefault; void this.submitTakeover("steer"); }}>
							<input name="text" placeholder="人工指令内容" required />
							<button type="submit" ?disabled=${this.busy || !this.connected}>人工指令</button>
						</form>
						<form data-testid="diagnostic-form" @submit=${(event: SubmitEvent) => { event.preventDefault(); void this.submitTakeover("diagnostic-run"); }}>
							<input name="purpose" placeholder="诊断目的" required />
							<button type="submit" ?disabled=${this.busy || !this.connected}>诊断运行</button>
						</form>
						<form data-testid="replace-plan-form" @submit=${(event: SubmitEvent) => { event.preventDefault(); void this.submitTakeover("replace-plan"); }}>
							<textarea name="proposal" placeholder="完整计划提案 JSON(plan-proposal/v1)" required rows="3"></textarea>
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
	/** 消费来自 shell 的跳转意图(去处理门禁 / 去批准),一次性。 */
	private consumeIntent(): void {
		const projection = this.projection;
		if (!projection) return;
		if (this.pendingApproval) {
			this.pendingApproval = false;
			this.dispatchEvent(new CustomEvent("baize-intent-consumed", { bubbles: true, composed: true }));
			if (projection.workflow.state === "ready_to_archive") void this.openApprovalReview();
			return;
		}
		if (this.pendingGate) {
			const key = this.pendingGate;
			this.pendingGate = null;
			this.dispatchEvent(new CustomEvent("baize-intent-consumed", { bubbles: true, composed: true }));
			const item = gateQueue(projection).find((entry) => entry.key === key);
			if (item) this.openGateForm(item);
		}
	}

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
			if (result.receipt.outcome === "accepted") {
				// 回执原地呈现(队列区):只关表单,保留 formReceipt;下次打开表单时清除。
				this.gateFormKey = null;
				this.formContext = null;
				this.formStale = false;
			}
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
			case "critical_decision": return "关键决策";
			case "human_input": return "人工输入";
			case "finding_disposition": return "发现处置";
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
									@click=${() => this.openGateForm(item)}
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
						回执:${commandLabel(this.formReceipt.commandType)} → ${statusLabel(this.formReceipt.outcome)}(HTTP ${this.formReceipt.httpStatus})
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
								@click=${() => void this.runCommand("diagnostic-run", { purpose: `恢复诊断:${projection.workflow.currentFailureCode ?? projection.currentIncident?.incidentType ?? ""}` })}>诊断运行</button>`;
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

					<h3>必需产物修订</h3>
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

					<h3>决策处置</h3>
					<div data-testid="packet-decisions">
						${content.decisions.length === 0 ? html`无 Decision` : nothing}
						${content.decisions.map(
							(decision) => html`<div><span class="badge">${decision.severity}</span> ${decision.summary} — ${decision.status}${decision.reason ? html`(${decision.reason})` : nothing}</div>`,
						)}
					</div>

					<h3>发现 / 风险</h3>
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

					<h3>评审覆盖</h3>
					<div data-testid="packet-coverage">覆盖 revisions:${content.criticCoverage.coveredRevisionIds.join(", ") || "—"}</div>

					<h3>一致性警告</h3>
					<div data-testid="packet-warnings">
						${content.warnings.length === 0 ? html`无警告` : content.warnings.map((warning) => html`<div class="banner" data-tone="warn">${warning}</div>`)}
					</div>

					<h3>就绪检查</h3>
					<div data-testid="packet-readiness">
						${this.projection.readiness.checks.map(
							(check) => html`<div>${check.passed ? "✓" : "✗"} ${check.name} — ${check.detail}</div>`,
						)}
					</div>

					<h3>来源与溯源</h3>
					<div data-testid="packet-provenance">
						事件溯源与记录见<button data-testid="approval-open-audit" @click=${() => void this.openAuditView()}>审计视图</button>
					</div>

					${this.approvalReceipt
						? html`<div class="context-receipt" data-testid="approval-receipt" data-outcome=${this.approvalReceipt.outcome}>
							回执:${commandLabel(this.approvalReceipt.commandType)} → ${statusLabel(this.approvalReceipt.outcome)}(HTTP ${this.approvalReceipt.httpStatus})
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
					<button class="danger" data-testid="reject-toggle" ?disabled=${this.busy || !this.connected || stale}
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

				<h3>工作流事件(不含运行 token/工具事件)</h3>
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

				<h3>运行事件(独立时间线)</h3>
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

				<h3>命令回执</h3>
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

				<h3>事故 / 恢复</h3>
				<div data-testid="audit-incidents">
					${this.auditIncidents.length === 0 ? html`无 Incident` : nothing}
					${this.auditIncidents.map(
						(incident) => html`<div>
							<span class="badge" data-tone=${incident.status === "open" ? "bad" : "ok"}>${incident.status}</span>
							${incident.incidentType} / ${incident.failureCode} — ${incident.subjectType} #${incident.subjectId ?? "—"} · ${incident.createdAt}
						</div>`,
					)}
				</div>

				<h3>版本与摘要</h3>
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
				<h3>设计包 #${this.packageDetail.id}</h3>
				<div class="audit">
					归档类别:${this.packageDetail.archiveClass}<br />
					摘要:${this.packageDetail.digest}<br />
					批准包:${this.packageDetail.approvalPacketId ?? "—"} · 批准记录:${this.packageDetail.approvalId ?? "—"}<br />
					归档时间:${this.packageDetail.archivedAt}
				</div>
			</section>
		`;
	}

	render() {
		if (!this.session) {
			return html`<div class="login-wrap">
				<form class="hero login-form" @submit=${(e: Event) => this.handleLogin(e)}>
					<div class="brand login-brand"><span class="dot">◇</span> BaiZe Architect</div>
					<p>输入 Operator Token 建立会话。</p>
					<input
						type="password"
						placeholder="Operator Token"
						aria-label="Operator Token"
						.value=${this.loginToken}
						@input=${(e: Event) => (this.loginToken = (e.target as HTMLInputElement).value)}
						autocomplete="off"
					/>
					<button class="primary" type="submit">登录</button>
					${this.loginError ? html`<div class="error">${this.loginError}</div>` : nothing}
				</form>
			</div>`;
		}
		// — 已登录:详情页(由 shell 提供导航) —
		return html`
		<div class="page">
			<button class="back" @click=${() => this.dispatchEvent(new CustomEvent("baize-goto", { detail: { tab: "requirements" }, bubbles: true, composed: true }))}>← 返回需求列表</button>
			${this.loadError ? html`<div class="error" data-testid="load-error">${this.loadError}</div>` : nothing}
			${this.renderWorkflowView()}
		</div>`;
	}


	private renderWorkflowView() {
		if (!this.projection) return html`<div data-testid="loading">加载中…</div>`;
		return html`
			${this.renderConnectionBanner()}
			${this.renderHero()}
			${this.renderReceipt()}
			${this.renderGateQueue()}
			${this.renderRecovery()}
			${this.renderAuditSummary()}
			${this.renderDetails()}
			${this.renderApprovalReview()}
			${this.renderAuditView()}
			${this.renderPackage()}
			<div class="sr-only" aria-live="polite" data-testid="live-region">${this.liveMessage}</div>
		`;
	}
}

customElements.define("baize-workflow", BaizeWorkflow);
