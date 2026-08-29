import { LitElement, html, css, nothing } from "lit";
import { sharedStyles } from "./baize-styles.js";
import "./baize-workflow-hero.js";
import "./baize-tab-bar.js";
import "./baize-gate-queue.js";
import "./baize-approval-review.js";
import "./baize-tasks-tab.js";
import "./baize-artifacts-tab.js";
import "./baize-governance-tab.js";

import { type StatusSnapshot } from "./baize-shell.js";

import {
	checkSession,
	gateQueue,
	getApprovalPacket,
	getDesignPackage,
	getModelConfig,
	getRequirement,
	getWorkflowProjection,
	packetReviewDrift,
	pendingCounts,
	recoveryActions,
	sendWorkflowCommand,
	stateHero,
	commandLabel,
	statusLabel,
	subscribeRunEvents,
	subscribeWorkflowEvents,
	type ApprovalPacketDetail,
	type CommandReceipt,
	type ModelConfig,
	type DesignPackageDetail,
	type GateQueueItem,
	type OperatorSession,
	type PacketReviewContext,
	type RequirementDetail,
	type WorkflowProjection,
} from "./workflow-client.js";
import { MODEL_ROLE_GROUPS, MODEL_ROLE_KEYS, ROLE_LABELS, customizedRoleCount, findModel, isRoleCustomized, providerLabel } from "./model-profiles.js";
/**
 * baize-workflow — 自动优先的引导式 Requirement 工作流页面容器(票15+票16+#81+#83)。
 * 页面结构:主区(hero/模型档/回执/三 tab)+ 右栏(gate 队列/恢复/批准审阅)。
 * hero/tab-bar/gate 队列/批准审阅已拆分为子组件;三 tab 亦拆分为
 * baize-tasks-tab / baize-artifacts-tab / baize-governance-tab,本组件
 * 持有数据与命令路径,经 baize-status-update / baize-panel-announce /
 * baize-panel-receipt 事件向上供给 shell 的 Status Bar 与 Panel。
 * 票16:确定性 Gate Queue(一次一个 exact subject)、按 Incident 类型的恢复组合、
 * stale 表单冻结(保留 draft、显示 expected/actual、显式 reload)、双流断线禁用命令。
 * 只调用新 Projection / detail / Command / SSE 契约;不做乐观状态变更。
 * 登录与会话管理在 baize-shell;本组件由 shell 在 /workflow/:id 路由挂载。
 */

class BaizeWorkflow extends LitElement {
	static properties = {
		requirementId: { type: Number, attribute: "requirement-id" },
		workspaceId: { type: Number, attribute: "workspace-id" },
		apiBase: { type: String, attribute: "api-base" },
		session: { state: true },
		requirement: { state: true },
		projection: { state: true },
		modelConfig: { state: true },
		receipt: { state: true },
		detailsOpen: { state: true },
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

		pendingGate: { type: String, attribute: "pending-gate" },
		pendingApproval: { type: Boolean, attribute: "pending-approval" },
		activeTab: { state: true },
	};

	declare requirementId: number;
	declare workspaceId: number;
	declare apiBase: string;
	declare session: OperatorSession | null;
	declare requirement: RequirementDetail | null;
	declare projection: WorkflowProjection | null;
	declare modelConfig: ModelConfig | null;
	declare receipt: CommandReceipt | null;
	declare detailsOpen: boolean;
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
	declare pendingGate: string | null;
	declare pendingApproval: boolean;
	declare activeTab: string;

	/** 打开的 gate 表单上下文:commandId 在表单生命周期内固定(重复提交幂等),reload 才换新。 */
	private formContext: { key: string; commandId: string; workflowVersion: number } | null = null;
	private unsubscribeEvents: (() => void) | null = null;
	private unsubscribeRunEvents: (() => void) | null = null;
	private runStreamId: number | null = null;
	/** 专注审阅绑定上下文 + 每个意图一个固定 commandId(approve/reject 各自幂等)。 */
	private approvalContext: (PacketReviewContext & { approveCommandId: string; rejectCommandId: string }) | null = null;
	constructor() {
		super();
		this.requirementId = 0;
		this.workspaceId = 1;
		this.apiBase = "";
		this.session = null;
		this.requirement = null;
		this.projection = null;
		this.modelConfig = null;
		this.receipt = null;
		this.detailsOpen = false;
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
		this.pendingGate = null;
		this.pendingApproval = false;
		this.activeTab = "tasks";
}

	static styles = [sharedStyles, css`
		/* Hallmark · genre: atmospheric · macrostructure: Workbench · design-system: DESIGN.md · designed-as-app */
		:host { display: block; height: 100%; background: var(--bg); color: var(--text); font-family: var(--font-ui); font-size: var(--text-base); line-height: 1.55; }

		/* — 工作流页面容器:主区 + 右栏内部分栏 — */
		.workflow-page { min-height: 100%; }
		.workflow-content { display: flex; gap: var(--gap); padding: var(--pad) calc(var(--pad) * 1.2); min-height: 0; align-items: flex-start; }
		.main-area { flex: 1 1 0; min-width: 0; }
		.rail-area { flex: 0 0 var(--rail-w); border-left: 1px solid var(--border); background: var(--surface); padding-left: var(--gap); }

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

		/* — 详情折叠 — */
		.details { margin-top: 16px; border: 1px solid var(--border); border-radius: var(--radius); padding: var(--pad); background: var(--surface); }
		.details h3 { margin: 12px 0 6px; font-size: var(--text-sm); color: var(--text-muted); letter-spacing: 0.06em; }
		.details h3:first-child { margin-top: 0; }
		.fact-block { font-size: var(--text-xs); color: var(--text-muted); line-height: 1.7; word-break: break-all; }
		/* — 只读模型档 — */
		.profile-meta { margin: 6px 0 4px; font-size: var(--text-xs); color: var(--text-muted); }
		.profile-group { margin-top: 8px; }
		.profile-group-label { font-size: var(--text-xs); color: var(--text-subtle); letter-spacing: 0.06em; }
		.profile-row { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 5px 0; font-size: var(--text-sm); border-bottom: 1px solid var(--border); }
		.profile-role { flex: 0 0 100px; font-weight: 500; }
		.profile-marker { font-size: var(--text-xs); color: var(--text-subtle); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 1px 8px; }
		.profile-marker[data-tone="custom"] { border-color: var(--accent); color: var(--accent); }
		.profile-provider { color: var(--text-muted); }
		.profile-model { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

		.command-row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }

		/* — 横幅 — */
		.banner { margin-top: 12px; border-radius: var(--radius); padding: 10px 14px; font-size: var(--text-sm); }
		.banner[data-tone="warn"] { border: 1px solid var(--warn-line); background: var(--warn-soft); color: var(--warn); }
		.banner[data-tone="bad"] { border: 1px solid var(--danger); background: var(--warn-soft); color: var(--danger); }
		.error { margin-top: 12px; color: var(--danger); }

		/* — 设计包 — */
		.package { margin-top: 16px; border: 1px solid var(--ok); background: var(--ok-soft); border-radius: var(--radius); padding: var(--pad); }

		.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

		/* — 标签页内容(tab-bar 自身样式在 baize-tab-bar 组件内) — */
		.tab-content { margin-top: 0; }

		/* — <900px:右栏坍缩回主区纵排(DESIGN.md 响应式) — */
		@media (max-width: 899.98px) {
			.workflow-content { flex-direction: column; }
			.rail-area { flex: 0 0 auto; border-left: none; border-top: 1px solid var(--border); padding-left: 0; padding-top: var(--gap); width: 100%; }
		}
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
		super.disconnectedCallback();
	}

	/** 双流任一断开即视为断线:禁用治理命令。 */
	private get connected(): boolean {
		return this.workflowConnected && this.runConnected !== false;
	}

	private announce(message: string): void {
		this.liveMessage = message;
		this.dispatchEvent(new CustomEvent("baize-panel-announce", { detail: { text: message, timestamp: Date.now() }, bubbles: true, composed: true }));
	}

	/** 从当前 Projection 构造 Status Bar 快照并向上 emit(shell 接管展示)。 */
	private emitStatusUpdate(): void {
		const projection = this.projection;
		const counts = projection ? pendingCounts(projection) : { gates: 0, decisions: 0, findings: 0 };
		const snapshot: StatusSnapshot = {
			connected: this.connected,
			workflowState: projection?.workflow.state ?? "unknown",
			workflowVersion: projection?.workflow.version ?? 0,
			lastEventSeq: projection?.workflow.lastEventSeq ?? 0,
			pendingGates: counts.gates,
			pendingDecisions: counts.decisions,
			pendingFindings: counts.findings,
			hasActiveRun: projection?.activeRun != null,
			runRole: projection?.activeRun?.role ?? null,
		};
		this.dispatchEvent(new CustomEvent("baize-status-update", { detail: snapshot, bubbles: true, composed: true }));
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
		}
	}

	private async load(): Promise<void> {
		try {
			this.requirement = await getRequirement(this.apiBase, this.requirementId);
			void this.loadModelConfig();
			await this.refreshProjection();
			this.connectEvents();
		} catch (error) {
			this.loadError = error instanceof Error ? error.message : String(error);
		}
	}
	private async loadModelConfig(): Promise<void> {
		if (this.modelConfig) return;
		this.modelConfig = await getModelConfig(this.apiBase).catch(() => null);
	}

	private async refreshProjection(): Promise<void> {
		if (!this.requirement) return;
		this.projection = await getWorkflowProjection(this.apiBase, this.requirement.workflowId);
		this.emitStatusUpdate();
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
				this.emitStatusUpdate();
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
				this.emitStatusUpdate();
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
			this.dispatchEvent(new CustomEvent("baize-panel-receipt", { detail: { commandType: type, outcome: result.receipt.outcome, httpStatus: result.httpStatus, timestamp: Date.now() }, bubbles: true, composed: true }));
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

	private renderReceipt() {
		if (!this.receipt) return nothing;
		return html`
			<aside class="receipt" data-testid="command-receipt" data-outcome=${this.receipt.outcome}>
				命令回执:<strong>${commandLabel(this.receipt.commandType)}</strong> → ${statusLabel(this.receipt.outcome)}
				(HTTP ${this.receipt.httpStatus}, 版本 ${this.receipt.workflowVersion}, 事件 ${this.receipt.lastEventSeq})
			</aside>
		`;
	}
	/** 只读模型档:需求级 vs 部署默认;目录未加载时不渲染,避免错误的空表。 */
	private renderModelProfile() {
		const projection = this.projection;
		if (!projection || !this.modelConfig) return nothing;
		const modelRoles = projection.workflow.modelRoles;
		const defaults = this.modelConfig.defaultRoles;
		const count = customizedRoleCount(modelRoles, defaults);
		return html`
			<section class="details model-profile" data-testid="model-profile-card">
				<h3>模型档</h3>
				<div class="profile-meta" data-testid="model-profile-count">${count}/${MODEL_ROLE_KEYS.length} 需求级自定义 · 缺省 = 部署默认档</div>
				${MODEL_ROLE_GROUPS.map(
					(group) => html`<div class="profile-group">
						<div class="profile-group-label">${group.label}</div>
						${group.roles.map((role) => {
							const custom = isRoleCustomized(role, modelRoles, defaults);
							// 生效档:需求级覆盖优先,缺省回落部署默认档
							const profile = modelRoles?.[role] ?? defaults[role];
							return html`<div class="profile-row" data-testid="profile-row-${role}" data-custom=${custom}>
								<span class="profile-role">${ROLE_LABELS[role]}</span>
								<span class="profile-marker" data-tone=${custom ? "custom" : "default"}>${custom ? "需求级" : "部署默认"}</span>
								<span class="profile-provider">${providerLabel(this.modelConfig, profile)}</span>
								<span class="profile-model">${findModel(this.modelConfig, profile)?.name ?? profile?.modelId ?? "—"}</span>
							</div>`;
						})}
					</div>`,
				)}
			</section>
		`;
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
			this.dispatchEvent(new CustomEvent("baize-panel-receipt", { detail: { commandType: "approve-packet", outcome: result.receipt.outcome, httpStatus: result.httpStatus, timestamp: Date.now() }, bubbles: true, composed: true }));
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

	private async submitRejection(detail: { reason: string; targets: string[] }): Promise<void> {
		const context = this.approvalContext;
		if (!this.projection || !context || this.busy || !this.connected || this.approvalStale) return;
		const { reason, targets } = detail;
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
			this.dispatchEvent(new CustomEvent("baize-panel-receipt", { detail: { commandType: "reject-packet", outcome: result.receipt.outcome, httpStatus: result.httpStatus, timestamp: Date.now() }, bubbles: true, composed: true }));
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
	}

	private closeGateForm(): void {
		this.gateFormKey = null;
		this.formContext = null;
		this.formReceipt = null;
		this.formStale = false;
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

	private async submitGateForm(item: GateQueueItem, formData: FormData): Promise<void> {
		if (!this.projection || !this.formContext || this.busy || !this.connected || this.formStale) return;
		const payload = this.gateFormPayload(item, formData);
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
			this.dispatchEvent(new CustomEvent("baize-panel-receipt", { detail: { commandType: item.commandType, outcome: result.receipt.outcome, httpStatus: result.httpStatus, timestamp: Date.now() }, bubbles: true, composed: true }));
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

	private renderPackage() {
		if (!this.packageDetail) return nothing;
		return html`
			<section class="package" data-testid="design-package">
				<h3>设计包 #${this.packageDetail.id}</h3>
				<div class="fact-block">
					归档类别:${this.packageDetail.archiveClass}<br />
					摘要:${this.packageDetail.digest}<br />
					批准包:${this.packageDetail.approvalPacketId ?? "—"} · 批准记录:${this.packageDetail.approvalId ?? "—"}<br />
					归档时间:${this.packageDetail.archivedAt}
				</div>
			</section>
		`;
	}

	render() {
		return html`
			<div class="workflow-page">
				${this.loadError ? html`<div class="error" data-testid="load-error">${this.loadError}</div>` : nothing}
				${this.renderWorkflowView()}
			</div>`;
	}

	private switchTab(tab: string): void {
		this.activeTab = tab;
	}

	private renderWorkflowView() {
		if (!this.projection) return html`<div data-testid="loading">加载中…</div>`;
		const showRail = gateQueue(this.projection).length > 0 || this.approvalOpen || recoveryActions(this.projection).length > 0;
		return html`
			<div class="workflow-content">
				<div class="main-area">
					${this.renderConnectionBanner()}
					<baize-workflow-hero
						.projection=${this.projection}
						.requirement=${this.requirement}
						.busy=${this.busy}
						.connected=${this.connected}
						@baize-primary-action=${() => void this.onPrimaryAction()}
						@baize-open-package=${() => void this.openDesignPackage()}
					></baize-workflow-hero>
					${this.renderModelProfile()}
					${this.renderReceipt()}
					<baize-tab-bar .activeTab=${this.activeTab} @baize-tab-change=${(e: Event) => this.switchTab((e as CustomEvent<{ tab: string }>).detail.tab)}></baize-tab-bar>
					<div class="tab-content">
						${this.activeTab === "tasks" ? html`<baize-tasks-tab
							.projection=${this.projection}
							.busy=${this.busy}
							.connected=${this.connected}
							@baize-run-command=${(e: CustomEvent<{ type: string; payload?: Record<string, unknown> }>) => void this.runCommand(e.detail.type, e.detail.payload)}
						></baize-tasks-tab>` : nothing}
						${this.activeTab === "artifacts" ? html`<baize-artifacts-tab
							.projection=${this.projection}
							.requirementId=${this.requirementId}
							.apiBase=${this.apiBase}
						></baize-artifacts-tab>` : nothing}
						${this.activeTab === "governance" ? html`<baize-governance-tab
							.projection=${this.projection}
							.busy=${this.busy}
							.connected=${this.connected}
							@baize-open-approval=${() => void this.openApprovalReview()}
						></baize-governance-tab>` : nothing}
					</div>
					${this.renderPackage()}
				</div>
				${showRail ? html`
					<div class="rail-area">
						<baize-gate-queue
							.projection=${this.projection}
							.gateFormKey=${this.gateFormKey}
							.formContext=${this.formContext}
							.formStale=${this.formStale}
							.formReceipt=${this.formReceipt}
							.busy=${this.busy}
							.connected=${this.connected}
							@baize-open-gate=${(e: CustomEvent<{ key: string }>) => {
								const item = gateQueue(this.projection!).find((entry) => entry.key === e.detail.key);
								if (item) this.openGateForm(item);
							}}
							@baize-submit-gate=${(e: CustomEvent<{ key: string; formData: FormData }>) => {
								const item = gateQueue(this.projection!).find((entry) => entry.key === e.detail.key);
								if (item) void this.submitGateForm(item, e.detail.formData);
							}}
							@baize-close-gate=${() => this.closeGateForm()}
							@baize-reload-gate=${() => this.reloadGateForm()}
						></baize-gate-queue>
						${this.renderRecovery()}
						${this.approvalOpen ? html`
							<baize-approval-review
								.projection=${this.projection}
								.approvalPacket=${this.approvalPacket}
								.approvalContext=${this.approvalContext}
								.approvalStale=${this.approvalStale}
								.approvalReceipt=${this.approvalReceipt}
								.busy=${this.busy}
								.connected=${this.connected}
								@baize-approve=${() => void this.submitApproval()}
								@baize-reject=${(e: CustomEvent<{ reason: string; targets: string[] }>) => void this.submitRejection(e.detail)}
								@baize-close-approval=${() => this.closeApprovalReview()}
								@baize-reload-approval=${() => void this.reloadApprovalReview()}
							></baize-approval-review>
						` : nothing}
					</div>
				` : nothing}
			</div>
			<div class="sr-only" aria-live="polite" data-testid="live-region">${this.liveMessage}</div>
		`;
	}
}

customElements.define("baize-workflow", BaizeWorkflow);
