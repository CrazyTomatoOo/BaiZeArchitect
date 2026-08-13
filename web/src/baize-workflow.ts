import { LitElement, html, css, nothing } from "lit";

import {
	artifactSummary,
	designStages,
	gateQueue,
	getDesignPackage,
	getRequirement,
	getWorkflowProjection,
	pendingCounts,
	recoveryActions,
	sendWorkflowCommand,
	stateHero,
	subscribeRunEvents,
	subscribeWorkflowEvents,
	type CommandReceipt,
	type DesignPackageDetail,
	type GateQueueItem,
	type RequirementDetail,
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

	/** 打开的 gate 表单上下文:commandId 在表单生命周期内固定(重复提交幂等),reload 才换新。 */
	private formContext: { key: string; commandId: string; workflowVersion: number } | null = null;
	private unsubscribeEvents: (() => void) | null = null;
	private unsubscribeRunEvents: (() => void) | null = null;
	private runStreamId: number | null = null;

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
								<button data-testid="approve-packet" ?disabled=${this.busy || !this.connected} @click=${() => void this.runCommand("approve-packet", { packetId: projection.currentPacket!.id })}>批准归档</button>
								<button data-testid="reject-packet" ?disabled=${this.busy || !this.connected} @click=${() => void this.runCommand("reject-packet", { packetId: projection.currentPacket!.id, reason: "不满足要求", targets: ["design"] }, "从详情驳回")}>驳回</button>
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
			${this.renderPackage()}
			<div class="sr-only" aria-live="polite" data-testid="live-region">${this.liveMessage}</div>
		`;
	}
}

customElements.define("baize-workflow", BaizeWorkflow);
