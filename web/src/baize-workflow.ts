import { LitElement, html, css, nothing } from "lit";
import mermaid from "mermaid";
import { sharedStyles } from "./baize-styles.js";

import {
	artifactSummary,
	bootstrapSession,
	checkSession,
	createRequirement,
	designStages,
	gateQueue,
	getApprovalPacket,
	getArtifactRevision,
	getDesignPackage,
	getModelConfig,
	getRequirement,
	getWorkflowProjection,
	listRequirements,
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
	type ArtifactRevisionDetail,
	type ClientArtifactKind,
	type CommandReceipt,
	type ModelConfig,
	type DesignPackageDetail,
	type GateQueueItem,
	type OperatorSession,
	type PacketReviewContext,
	type RequirementDetail,
	type RequirementSummary,
	type WorkflowProjection,
} from "./workflow-client.js";
import { graphToMermaid, isGraphDiagram, type GraphDiagram } from "./diagram-render.js";
import { MODEL_ROLE_GROUPS, MODEL_ROLE_KEYS, ROLE_LABELS, customizedRoleCount, findModel, isRoleCustomized, providerLabel } from "./model-profiles.js";
import { renderArtifactFields } from "./artifact-content.js";
import { ARTIFACT_KIND_LABELS, ARTIFACT_VIEW_KINDS, schemaRefLabel } from "./artifact-labels.js";
import { readinessCheckLabel, readinessCheckDetail } from "./readiness-labels.js";
/**
 * baize-workflow — 自动优先的引导式 Requirement 页面(票15+票16)。
 * 状态 hero(每态一个主动作)+ 概览 + 同页详情 + 高级接管。
 * 票16:确定性 Gate Queue(一次一个 exact subject)、按 Incident 类型的恢复组合、
 * stale 表单冻结(保留 draft、显示 expected/actual、显式 reload)、双流断线禁用命令。
 * 只调用新 Projection / detail / Command / SSE 契约;不做乐观状态变更。
 * 仅在测试装配中挂载,生产 shell 在 S7 前不引用本组件。
 */

/** 从产物内容提取可选 diagrams（#11 决议：内容内嵌结构化图 JSON）。 */
function extractDiagrams(content: unknown): readonly unknown[] {
	if (typeof content !== "object" || content === null) return [];
	if (!("diagrams" in content)) return [];
	const diagrams = content.diagrams;
	return Array.isArray(diagrams) ? diagrams : [];
}

interface ArtifactViewState {
	kind: ClientArtifactKind;
	detail: ArtifactRevisionDetail | null;
	error: string | null;
	loading: boolean;
}

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
		navOpen: { state: true },
		pendingGate: { type: String, attribute: "pending-gate" },
		pendingApproval: { type: Boolean, attribute: "pending-approval" },
		artifactView: { state: true },
		activeTab: { state: true },
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
	declare navOpen: boolean;
	declare pendingGate: string | null;
	declare pendingApproval: boolean;
	declare artifactView: ArtifactViewState | null;
	declare activeTab: string;

	/** 打开的 gate 表单上下文:commandId 在表单生命周期内固定(重复提交幂等),reload 才换新。 */
	private formContext: { key: string; commandId: string; workflowVersion: number } | null = null;
	/** 产物内容查看器拉取/渲染序列号：切 kind 即递增，过期响应与渲染作废。 */
	private artifactRequestSeq: number | undefined = undefined;
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
		this.loginToken = "";
		this.loginError = null;
		this.requirements = [];
		this.createTitle = "";
		this.createSummary = "";
		this.createDescription = "";
		this.creating = false;
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
		this.navOpen = false;
		this.pendingGate = null;
		this.pendingApproval = false;
	this.artifactView = null;
	this.activeTab = "tasks";
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

		/* — 产物内容查看器 — */
		.artifact-kind-row { display: flex; flex-wrap: wrap; gap: var(--space-2xs); margin-bottom: var(--space-sm); }
		.chip {
			background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-pill);
			color: var(--text-muted); font-size: var(--text-xs); padding: 4px 12px; cursor: pointer;
			font-family: var(--font-mono);
		}
		.chip:hover { border-color: var(--border-strong); color: var(--text); }
		.chip.active { border-color: var(--accent); color: var(--accent); }
		.fact-block-line { margin-bottom: var(--space-2xs); }
		.diagram-host { display: flex; flex-direction: column; gap: var(--space-sm); margin-top: var(--space-2xs); }
		.diagram-holder { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-card); padding: var(--space-sm); overflow-x: auto; }
		.diagram-holder svg { display: block; margin: 0 auto; max-width: 100%; }
		.artifact-json { font-size: var(--text-xs); overflow-x: auto; max-height: 360px; }
		/* — 产物结构化渲染 — */
		.artifact-view { display: flex; flex-direction: column; gap: var(--gap); }
		.artifact-summary { font-size: var(--text-sm); color: var(--text-muted); line-height: 1.6; margin-bottom: 4px; }
		.artifact-fields { display: flex; flex-direction: column; gap: var(--gap); }
		.field-row { display: flex; flex-direction: column; gap: 4px; }
		.field-label { font-size: var(--text-xs); color: var(--text-subtle); letter-spacing: 0.06em; font-weight: 500; }
		.field-list { margin: 0; padding-left: 20px; }
		.field-list li { font-size: var(--text-sm); line-height: 1.6; margin-bottom: 2px; }
		.field-cards { display: flex; flex-direction: column; gap: 8px; }
		.field-card { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 10px 12px; background: var(--surface-2); }
		.field-card .field-row { margin-bottom: 6px; }
		.field-card .field-row:last-child { margin-bottom: 0; }
		.field-inline { font-size: var(--text-sm); color: var(--text); }
		.field-sub-object { display: flex; flex-direction: column; gap: 6px; }
		.impact-table { width: 100%; font-size: var(--text-sm); border-collapse: collapse; }
		.impact-table th { font-size: var(--text-xs); color: var(--text-subtle); text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border); }
		.impact-table td { padding: 4px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
		.impact-table .badge { font-size: var(--text-xs); }
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

		/* — 标签页 — */
		.tab-bar { display: flex; gap: 0; margin-top: 16px; border-bottom: 1px solid var(--border); }
		.tab { background: none; border: none; padding: 8px 16px; cursor: pointer; font-size: var(--text-sm); color: var(--text-muted); border-bottom: 2px solid transparent; margin-bottom: -1px; }
		.tab:hover { color: var(--text); }
		.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
		.tab-content { margin-top: 0; }
		.tab-content .details { margin-top: var(--gap); }

		/* — 产物进度 — */
		.artifact-progress { display: flex; flex-wrap: wrap; gap: 8px; }
		.artifact-progress .chip { cursor: pointer; }
		.artifact-progress .chip.done { border-color: var(--ok); color: var(--ok); }
		.artifact-progress .chip.missing { border-color: var(--danger); color: var(--danger); }

		/* — 就绪检查 — */
		.readiness-list { display: flex; flex-direction: column; gap: 4px; }
		.readiness-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--border); font-size: var(--text-sm); }
		.readiness-label { font-weight: 500; min-width: 120px; }
		.readiness-detail { color: var(--text-muted); font-size: var(--text-xs); }
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
	// 票17 渲染:专注 Approval 审阅
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


	private async openArtifactView(kind: ClientArtifactKind): Promise<void> {
		if (!this.requirement) return;
		// 快速切换 kind 时作废进行中的拉取与渲染（Spec review #18：过期响应不得覆盖新选择）
		const requestSeq = (this.artifactRequestSeq ?? 0) + 1;
		this.artifactRequestSeq = requestSeq;
		this.artifactView = { kind, detail: null, error: null, loading: true };
		try {
			const detail = await getArtifactRevision(this.apiBase, this.requirement.id, kind);
			if (this.artifactRequestSeq !== requestSeq) return;
			this.artifactView = { kind, detail, error: null, loading: false };
			await this.renderArtifactDiagrams();
		} catch (error) {
			if (this.artifactRequestSeq !== requestSeq) return;
			this.artifactView = { kind, detail: null, error: error instanceof Error ? error.message : String(error), loading: false };
		}
	}

	/** 内容面板：summary 引言 + 图(diagrams) + 结构化卡片。 */
	private renderArtifactContent() {
		if (!this.artifactView) return nothing;
		const view = this.artifactView;
		if (view.loading) return html`<div class="fact-block" data-testid="artifact-loading">加载中…</div>`;
		if (view.error) return html`<div class="error" data-testid="artifact-error">${view.error}</div>`;
		if (!view.detail) return html`<div class="fact-block" data-testid="artifact-empty">该产物尚无当前版本:对应设计任务产出并完成后,此处可查看内容。</div>`;
		const diagrams = extractDiagrams(view.detail.content);
		return html`
			<div class="artifact-view" data-testid="artifact-content">
				<div class="fact-block-line">r${view.detail.revisionNo} · ${statusLabel(view.detail.status)} · ${schemaRefLabel(view.detail.schemaRef)}</div>
				${diagrams.length > 0
					? html`<div class="diagram-host" data-testid="artifact-diagrams">${diagrams.map((_, index) => html`<div data-diagram-id=${index} class="diagram-holder"></div>`)}</div>`
					: nothing}
				${renderArtifactFields(view.detail.content, view.kind)}
			</div>
		`;
	}

	/** mermaid 异步渲染：图源由 graphToMermaid 生成后渲染进宿主 div。渲染受 artifactRequestSeq 保护，切 kind 即作废。 */
	private async renderArtifactDiagrams(): Promise<void> {
		const view = this.artifactView;
		if (!view?.detail || view.loading || view.error) return;
		const diagrams = extractDiagrams(view.detail.content);
		if (diagrams.length === 0) return;
		const requestSeq = this.artifactRequestSeq ?? 0;
		await this.updateComplete;
		try {
			for (const [index, diagram] of diagrams.entries()) {
				if (this.artifactRequestSeq !== requestSeq) return;
				if (!isGraphDiagram(diagram)) continue;
				const source = graphToMermaid(view.kind, diagram);
				if (source === null) continue;
				const holder = this.renderRoot.querySelector(`[data-diagram-id="${index}"]`);
				if (!holder) continue;
				holder.textContent = "渲染中…";
				mermaid.initialize({ startOnLoad: false, theme: "dark", securityLevel: "strict" });
				const { svg } = await mermaid.render(`mermaid-${view.kind}-${index}-${requestSeq}`, source);
				if (this.artifactRequestSeq !== requestSeq) return;
				holder.innerHTML = svg;
			}
		} catch {
			// 渲染失败不阻塞内容查看器——保留宿主内错误占位
		}
	}

	override updated(changed: Map<string, unknown>): void {
		super.updated(changed);
		if (changed.has("artifactView")) {
			void this.renderArtifactDiagrams();
		}
	}

	private switchTab(tab: string): void {
		this.activeTab = tab;
		this.dispatchEvent(new CustomEvent("baize-tab-change", { detail: { tab }, bubbles: true, composed: true }));
	}

	private renderTabBar(): ReturnType<typeof html> {
		const tabs = [
			{ id: "tasks", label: "任务" },
			{ id: "artifacts", label: "产物" },
			{ id: "governance", label: "治理" },
		];
		return html`<div class="tab-bar" data-testid="tab-bar">
			${tabs.map((t) => html`<button class="tab ${this.activeTab === t.id ? "active" : ""}" data-testid="tab-${t.id}" @click=${() => this.switchTab(t.id)}>${t.label}</button>`)}
		</div>`;
	}

	private renderWorkflowView() {
		if (!this.projection) return html`<div data-testid="loading">加载中…</div>`;
		return html`
			${this.renderConnectionBanner()}
			${this.renderHero()}
			${this.renderModelProfile()}
			${this.renderReceipt()}
			${this.renderGateQueue()}
			${this.renderRecovery()}
			${this.renderTabBar()}
			<div class="tab-content">
				${this.activeTab === "tasks" ? this.renderTasksTab() : nothing}
				${this.activeTab === "artifacts" ? this.renderArtifactsTab() : nothing}
				${this.activeTab === "governance" ? this.renderGovernanceTab() : nothing}
			</div>
			${this.renderApprovalReview()}
			${this.renderPackage()}
			<div class="sr-only" aria-live="polite" data-testid="live-region">${this.liveMessage}</div>
		`;
	}

	// — Tab: 任务 —
	private renderTasksTab(): ReturnType<typeof html> {
		const projection = this.projection!;
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
				? html`<div class="command-row"><button data-testid="pause-command" ?disabled=${this.busy || !this.connected} @click=${() => void this.runCommand("pause")}>暂停</button></div>`
				: nothing}
			${projection.activeRun && projection.workflow.state === "running"
				? html`<div class="command-row"><button class="danger" data-testid="cancel-command" ?disabled=${this.busy || !this.connected} @click=${() => void this.runCommand("cancel-run", { runId: projection.activeRun!.id })}>取消当前运行</button></div>`
				: nothing}
		</section>`;
	}

	// — Tab: 产物 —
	private renderArtifactsTab(): ReturnType<typeof html> {
		const projection = this.projection!;
		const check = projection.readiness.checks.find((c) => c.name === "complete_required_artifacts");
		const missingKinds = check?.detail?.replace("missing=", "").split(",").filter(Boolean) ?? [];
		return html`<section class="details" data-testid="details">
			<h3>产物进度</h3>
			<div class="artifact-progress" data-testid="artifact-progress">
				${ARTIFACT_VIEW_KINDS.map((kind) => {
					const done = !missingKinds.includes(kind);
					return html`<span class="chip ${done ? "done" : "missing"}" data-testid="progress-${kind}" @click=${() => { this.switchTab("artifacts"); this.openArtifactView(kind); }}>${ARTIFACT_KIND_LABELS[kind] ?? kind} ${done ? "✓" : "✗"}</span>`;
				})}
			</div>

			<h3>就绪检查</h3>
			<div class="readiness-list" data-testid="readiness-list">
				${projection.readiness.checks.map(
					(check) => html`<div class="readiness-row ${check.passed ? "passed" : "failed"}" data-testid="readiness-${check.name}">
						<span class="badge" data-tone=${check.passed ? "ok" : "bad"}>${check.passed ? "✓" : "✗"}</span>
						<span class="readiness-label">${readinessCheckLabel(check.name)}</span>
						<span class="readiness-detail">${readinessCheckDetail(check.name, check.detail)}</span>
					</div>`,
				)}
			</div>

			<h3>产物内容</h3>
			<div data-testid="artifact-viewer">
				<div class="artifact-kind-row">
					${ARTIFACT_VIEW_KINDS.map(
					(kind) => html`<button class="${kind === this.artifactView?.kind ? "chip active" : "chip"}" @click=${() => this.openArtifactView(kind)}>${ARTIFACT_KIND_LABELS[kind] ?? kind}</button>`,
					)}
				</div>
				${this.renderArtifactContent()}
			</div>
		</section>`;
	}

	// — Tab: 治理 —
	private renderGovernanceTab(): ReturnType<typeof html> {
		const projection = this.projection!;
		return html`<section class="details" data-testid="details">
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
		</section>`;
	}
}

customElements.define("baize-workflow", BaizeWorkflow);
