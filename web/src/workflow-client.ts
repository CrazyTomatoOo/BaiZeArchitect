/**
 * workflow-client — 自动优先 Workflow 操作界面的类型化 API 客户端与纯视图模型。
 * 只使用票11-14 的新契约:projection / detail / 统一 Command / 双 SSE。
 * 不引用任何旧 Run 列表/创建/steer/cancel/direct-archive endpoint。
 */

export type WorkflowState =
	| "pending"
	| "running"
	| "waiting_for_human"
	| "paused"
	| "failed"
	| "ready_to_archive"
	| "archived";

export type ModelRoleKey =
	| "analysis-analyst"
	| "scenario-analyst"
	| "usecase-analyst"
	| "function-analyst"
	| "design-architect"
	| "architecture-architect"
	| "data-architect"
	| "api-architect"
	| "critic";

export interface ModelProfile {
	provider: string;
	modelId: string;
}

export interface ModelInfo {
	id: string;
	name: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
}

export interface ProviderCatalog {
	id: string;
	name: string;
	models: ModelInfo[];
}

export interface ModelConfig {
	defaultRoles: Record<ModelRoleKey, ModelProfile>;
	providers: ProviderCatalog[];
}

export interface WorkflowProjection {
	workflow: {
		id: number;
		state: WorkflowState;
		version: number;
		lastEventSeq: number;
		currentFailureCode: string | null;
		modelRoles?: Partial<Record<ModelRoleKey, ModelProfile>>;
		policyBundle: { documentId: number; digest: string };
	};
	requirement: {
		id: number;
		workspaceId: number;
		title: string;
		version: number;
		currentRevision: { id: number; revisionNo: number; status: string; digest: string; schemaRef: string };
	};
	designSession: { id: number; status: string; sessionId: string };
	currentPlan: { id: number; revisionNo: number; status: string; proposalDigest: string; createdAt: string } | null;
	tasks: readonly ProjectionTask[];
	activeClaim: { id: number; taskId: number; attemptId: number; runId: number; acquiredAt: string } | null;
	activeRun: { id: number; status: string; mode: string; role: string | null; startedAt: string } | null;
	openGates: readonly { id: number; gateType: string; subjectType: string; subjectId: number; openedAt: string }[];
	decisions: readonly { id: number; severity: string; status: string; summary: string }[];
	findings: readonly { id: number; threadId: number; severity: string; status: string; summary: string; targetRevisionId: number }[];
	findingThreads: readonly { id: number; fingerprint: string; status: string; reworkCount: number }[];
	readiness: ReadinessReport;
	currentPacket: { id: number; digest: string; status: string; createdAt: string } | null;
	currentIncident: { id: number; incidentType: string; failureCode: string; status: string; createdAt: string } | null;
}

export interface ProjectionTask {
	id: number;
	key: string;
	kind: string;
	role: string;
	status: string;
	maxAttempts: number;
	latestAttempt: { id: number; attemptNo: number; status: string } | null;
}

export interface ReadinessReport {
	workflowId: number;
	ready: boolean;
	checks: readonly { name: string; passed: boolean; detail: string }[];
	warnings: readonly string[];
}

export type ClientArtifactKind =
	| "analysis"
	| "scenario"
	| "usecase"
	| "function"
	| "design"
	| "architecture"
	| "data"
	| "api";

export interface ArtifactRevisionDetail {
	revisionId: number;
	artifactId: number;
	revisionNo: number;
	status: string;
	schemaRef: string;
	contentDigest: string;
	content: unknown;
}

export interface RequirementDetail {
	id: number;
	workspaceId: number;
	title: string;
	version: number;
	workflowId: number;
	designPackageId: number | null;
	modelRoles?: Partial<Record<ModelRoleKey, ModelProfile>>;
	currentRevision: {
		id: number;
		artifactId: number;
		revisionNo: number;
		status: string;
		schemaRef: string;
		contentDocumentId: number;
		contentDigest: string;
		content: { title?: string; summary?: string; description?: string };
	};
}

export interface CommandReceipt {
	commandId: string;
	workflowId: number;
	commandType: string;
	outcome: string;
	httpStatus: number;
	workflowVersion: number;
	lastEventSeq: number;
	createdAt: string;
}

export interface DesignPackageDetail {
	id: number;
	requirementId: number;
	workspaceId: number;
	documentId: number;
	digest: string;
	approvalPacketId: number | null;
	approvalId: number | null;
	archiveClass: string;
	archivedAt: string;
}

export interface CommandResult {
	httpStatus: number;
	receipt: CommandReceipt;
}

export interface OperatorSession {
	actorRef: string;
	capabilities: string[];
}

export interface RequirementSummary {
	requirementId: number;
	title: string;
	requirementVersion: number;
	workflow: { id: number; state: string; version: number; lastEventSeq: number };
}

export interface CreatedRequirement {
	requirementId: number;
	workflowId: number;
	workflowState: string;
	workflowVersion: number;
	lastEventSeq: number;
}

export async function checkSession(apiBase: string): Promise<OperatorSession> {
	const response = await fetch(`${apiBase}/api/session`, { credentials: "same-origin" });
	if (!response.ok) throw new Error(`session check failed: ${response.status}`);
	return (await response.json()) as OperatorSession;
}

export async function bootstrapSession(apiBase: string, token: string): Promise<OperatorSession> {
	const response = await fetch(`${apiBase}/api/session`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		credentials: "same-origin",
	});
	if (!response.ok) throw new Error(`login failed: ${response.status}`);
	return (await response.json()) as OperatorSession;
}

export async function listRequirements(apiBase: string, workspaceId: number): Promise<readonly RequirementSummary[]> {
	const response = await fetch(`${apiBase}/api/requirements?workspaceId=${workspaceId}`, { credentials: "same-origin" });
	if (!response.ok) throw new Error(`list failed: ${response.status}`);
	const body = (await response.json()) as { requirements: RequirementSummary[] };
	return body.requirements;
}

export interface CreateRequirementBaseline {
	schemaVersion: "artifact/requirement/v1";
	artifactKind: "requirement";
	title: string;
	summary: string;
	description: string;
	sourceRefs: readonly unknown[];
	goals?: string[];
	nonGoals?: string[];
	constraints?: string[];
}

export interface CreateRequirementInput {
	title: string;
	summary: string;
	description: string;
	goals?: string[];
	nonGoals?: string[];
	constraints?: string[];
	modelRoles?: Record<ModelRoleKey, ModelProfile>;
}

export async function createRequirement(
	apiBase: string,
	workspaceId: number,
	input: CreateRequirementInput,
): Promise<CreatedRequirement> {
	const baseline: CreateRequirementBaseline = {
		schemaVersion: "artifact/requirement/v1",
		artifactKind: "requirement",
		title: input.title,
		summary: input.summary,
		description: input.description,
		sourceRefs: [] as unknown[],
		...(input.goals ? { goals: input.goals } : {}),
		...(input.nonGoals ? { nonGoals: input.nonGoals } : {}),
		...(input.constraints ? { constraints: input.constraints } : {}),
	};
	const body: { baseline: CreateRequirementBaseline; modelRoles?: Record<ModelRoleKey, ModelProfile> } = { baseline };
	if (input.modelRoles) body.modelRoles = input.modelRoles;
	const response = await fetch(`${apiBase}/api/workspaces/${workspaceId}/requirements`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		credentials: "same-origin",
	});
	if (!response.ok) {
		const responseBody = await response.json().catch(() => null) as { error?: string; detail?: Array<{ role: string; provider: string; modelId: string; reason: string }> } | null;
		if (response.status === 400 && responseBody?.error === "invalid_model_roles" && Array.isArray(responseBody.detail)) {
			const details = responseBody.detail.map((entry) => `${entry.role}:${entry.reason}(${entry.provider}/${entry.modelId})`).join("; ");
			throw new Error(`模型角色配置无效: ${details}`);
		}
		throw new Error(`create failed: ${response.status} ${responseBody?.error ?? ""}`.trim());
	}
	return (await response.json()) as CreatedRequirement;
}

async function fetchJson<T>(apiBase: string, path: string): Promise<T> {
	const response = await fetch(`${apiBase}${path}`, { credentials: "same-origin" });
	if (!response.ok) throw new Error(`request failed: ${response.status} ${path}`);
	return (await response.json()) as T;
}

export function getModelConfig(apiBase: string): Promise<ModelConfig> {
	return fetchJson(apiBase, "/api/model-config");
}

export function getRequirement(apiBase: string, requirementId: number): Promise<RequirementDetail> {
	return fetchJson(apiBase, `/api/requirements/${requirementId}`);
}

export async function getArtifactRevision(apiBase: string, requirementId: number, kind: ClientArtifactKind): Promise<ArtifactRevisionDetail | null> {
	const path = `/api/requirements/${requirementId}/artifacts?kind=${encodeURIComponent(kind)}`;
	const response = await fetch(`${apiBase}${path}`, { credentials: "same-origin" });
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`request failed: ${response.status} ${path}`);
	return (await response.json()) as ArtifactRevisionDetail;
}

export function getWorkflowProjection(apiBase: string, workflowId: number): Promise<WorkflowProjection> {
	return fetchJson(apiBase, `/api/workflows/${workflowId}`);
}

export function getDesignPackage(apiBase: string, designPackageId: number): Promise<DesignPackageDetail> {
	return fetchJson(apiBase, `/api/design-packages/${designPackageId}`);
}

export async function sendWorkflowCommand(
	apiBase: string,
	workflowId: number,
	commandId: string,
	envelope: {
		schemaVersion: "workflow-command/v1";
		type: string;
		expectedWorkflowVersion: number;
		payload?: Record<string, unknown>;
		reason?: string;
	},
): Promise<CommandResult> {
	const response = await fetch(`${apiBase}/api/workflows/${workflowId}/commands/${commandId}`, {
		method: "PUT",
		credentials: "same-origin",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(envelope),
	});
	const receipt = (await response.json()) as CommandReceipt;
	return { httpStatus: response.status, receipt };
}

/** 订阅 Workflow SSE;返回取消函数。EventSource 不可用(测试环境)时返回 no-op。 */
/** 订阅 Workflow SSE;返回取消函数。EventSource 不可用(测试环境)时返回 no-op。onState 报告连接/断线。 */
export function subscribeWorkflowEvents(
	apiBase: string,
	workflowId: number,
	after: number,
	onEvent: () => void,
	onState?: (connected: boolean) => void,
): () => void {
	if (typeof EventSource === "undefined") return () => undefined;
	const source = new EventSource(`${apiBase}/api/workflows/${workflowId}/events/stream?after=${after}`);
	source.onopen = () => { onState?.(true); onEvent(); };
	source.onerror = () => onState?.(false);
	source.onmessage = () => onEvent();
	source.addEventListener("workflow-event", () => onEvent());
	return () => source.close();
}

// ---------------------------------------------------------------------------
// 视图模型(纯函数,可单测)
// ---------------------------------------------------------------------------

export interface HeroAction {
	label: string;
	kind: "command" | "expand" | "package";
	commandType?: "start" | "resume";
}

export interface HeroModel {
	title: string;
	description: string;
	action: HeroAction;
}

/** 每个治理状态恰好一个主动作。 */
export function stateHero(state: WorkflowState): HeroModel {
	switch (state) {
		case "pending":
			return { title: "待开始", description: "需求已就绪。开始后系统将自动规划、分析、设计并评审。", action: { label: "开始", kind: "command", commandType: "start" } };
		case "running":
			return { title: "进行中", description: "工作流正在自动执行:规划、分析、设计、评审。你可以随时查看进度。", action: { label: "查看进度", kind: "expand" } };
		case "waiting_for_human":
			return { title: "等待人工处理", description: "有需要你判断的事项,处理后才能继续。", action: { label: "处理待办", kind: "expand" } };
		case "paused":
			return { title: "已暂停", description: "工作流已暂停,新的调度已停止。", action: { label: "继续", kind: "command", commandType: "resume" } };
		case "failed":
			return { title: "失败", description: "工作流遇到失败。查看诊断并选择恢复方式。", action: { label: "查看诊断", kind: "expand" } };
		case "ready_to_archive":
			return { title: "待批准", description: "设计包已就绪,等待你的最终批准。", action: { label: "查看批准包", kind: "expand" } };
		case "archived":
			return { title: "已归档", description: "设计已完成并归档为不可变的设计包。", action: { label: "查看设计包", kind: "package" } };
	}
}

export type StageKey = "plan" | "analyze" | "design" | "review" | "approve";
export type StageStatus = "done" | "active" | "pending";

export interface DesignStage {
	key: StageKey;
	label: string;
	status: StageStatus;
}

const TERMINAL_TASK = new Set(["completed", "succeeded", "skipped_satisfied", "superseded", "failed"]);

function stageStatus(tasks: readonly ProjectionTask[], kinds: readonly string[]): StageStatus {
	const mine = tasks.filter((task) => kinds.includes(task.kind));
	if (mine.length === 0) return "pending";
	if (mine.every((task) => task.status === "pending")) return "pending";
	if (mine.some((task) => task.status === "in_progress")) return "active";
	if (mine.every((task) => TERMINAL_TASK.has(task.status))) return mine.some((task) => task.status === "completed") ? "done" : "pending";
	return "active";
}

/** 五段设计进程:计划 → 分析 → 设计 → 评审 → 批准。 */
export function designStages(projection: WorkflowProjection): readonly DesignStage[] {
	const tasks = projection.tasks;
	const approve: StageStatus =
		projection.workflow.state === "archived" ? "done" : projection.workflow.state === "ready_to_archive" ? "active" : "pending";
	return [
		{ key: "plan", label: "计划", status: projection.currentPlan ? "done" : stageStatus(tasks, ["plan"]) },
		{ key: "analyze", label: "分析", status: stageStatus(tasks, ["analyze"]) },
		{ key: "design", label: "设计", status: stageStatus(tasks, ["design"]) },
		{ key: "review", label: "评审", status: stageStatus(tasks, ["review", "rework", "verify"]) },
		{ key: "approve", label: "批准", status: approve },
	];
}

export interface PendingCounts {
	gates: number;
	decisions: number;
	findings: number;
}

/** 待处理数量:打开的门禁、未处置 Decision、未关闭 Finding。 */
export function pendingCounts(projection: WorkflowProjection): PendingCounts {
	return {
		gates: projection.openGates.length,
		decisions: projection.decisions.filter((decision) => decision.status === "open").length,
		findings: projection.findings.filter((finding) => finding.status === "open").length,
	};
}

/** Artifact 完成摘要来自 readiness 的 complete_required_artifacts 检查。 */
export function artifactSummary(projection: WorkflowProjection): string {
	const check = projection.readiness.checks.find((entry) => entry.name === "complete_required_artifacts");
	return check ? check.detail : "尚无 Impact Profile";
}

// ---------------------------------------------------------------------------
// 票16:Gate Queue / 恢复动作 / 连接状态视图模型
// ---------------------------------------------------------------------------

export type GateCategory = "critical_decision" | "human_input" | "finding_disposition" | "recovery";

export interface GateQueueItem {
	/** 稳定队列键:`decision:<id>` / `gate:<id>` / `incident:<id>`。 */
	key: string;
	category: GateCategory;
	/** 1-based 队列位置。 */
	position: number;
	subjectType: string;
	subjectId: number;
	title: string;
	/** 处置该 subject 的唯一命令类型。 */
	commandType: "dispose-decision" | "provide-human-input" | "accept-finding-risk" | "retry-recovery";
	/** provide-human-input 预填:gate 行 id。 */
	gateId?: number;
	/** accept-finding-risk 预填:同 thread 当前 open Finding。 */
	findingId?: number;
	targetRevisionId?: number;
	/** retry-recovery 预填。 */
	incidentId?: number;
}

const GATE_CATEGORY_ORDER: Record<GateCategory, number> = {
	critical_decision: 0,
	human_input: 1,
	finding_disposition: 2,
	recovery: 3,
};

/**
 * Gate Queue:critical Decision → required Human Input → major Finding 处置 → Incident 恢复。
 * 同级按 subject 行 id 升序(插入序与 openedEventSeq 单调一致)。
 */
export function gateQueue(projection: WorkflowProjection): readonly GateQueueItem[] {
	const items: (GateQueueItem & { sortId: number })[] = [];
	for (const decision of projection.decisions) {
		if (decision.status !== "open" || decision.severity !== "critical") continue;
		items.push({
			key: `decision:${decision.id}`,
			category: "critical_decision",
			position: 0,
			subjectType: "decision",
			subjectId: decision.id,
			title: decision.summary,
			commandType: "dispose-decision",
			sortId: decision.id,
		});
	}
	for (const gate of projection.openGates) {
		if (gate.gateType === "human_input") {
			items.push({
				key: `gate:${gate.id}`,
				category: "human_input",
				position: 0,
				subjectType: gate.subjectType,
				subjectId: gate.subjectId,
				title: `需要人工输入(${gate.subjectType} #${gate.subjectId})`,
				commandType: "provide-human-input",
				gateId: gate.id,
				sortId: gate.id,
			});
			continue;
		}
		if (gate.gateType === "finding_disposition") {
			const finding = projection.findings.find((entry) => entry.threadId === gate.subjectId && entry.status === "open");
			items.push({
				key: `gate:${gate.id}`,
				category: "finding_disposition",
				position: 0,
				subjectType: gate.subjectType,
				subjectId: gate.subjectId,
				title: finding?.summary ?? `评审发现线索 #${gate.subjectId}`,
				commandType: "accept-finding-risk",
				gateId: gate.id,
				findingId: finding?.id,
				targetRevisionId: finding?.targetRevisionId,
				sortId: gate.id,
			});
		}
	}
	const incident = projection.currentIncident;
	if (incident && incident.status === "open") {
		items.push({
			key: `incident:${incident.id}`,
			category: "recovery",
			position: 0,
			subjectType: "workflow_incident",
			subjectId: incident.id,
			title: `${incident.incidentType} / ${incident.failureCode}`,
			commandType: "retry-recovery",
			incidentId: incident.id,
			sortId: incident.id,
		});
	}
	items.sort((a, b) => GATE_CATEGORY_ORDER[a.category] - GATE_CATEGORY_ORDER[b.category] || a.sortId - b.sortId);
	return items.map(({ sortId: _sortId, ...item }, index) => ({ ...item, position: index + 1 }));
}

export interface RecoveryAction {
	commandType: "retry-task" | "retry-planning" | "retry-recovery" | "diagnostic-run";
	label: string;
	payload?: Record<string, unknown>;
}

/**
 * 失败恢复组合:execution(retry-task)、planning(retry-planning)、Engine/Outbox(retry-recovery)
 * 各自只显示合法动作。
 */
export function recoveryActions(projection: WorkflowProjection): readonly RecoveryAction[] {
	const incident = projection.currentIncident;
	if (incident && incident.status === "open") {
		return [
			{ commandType: "retry-recovery", label: "重试恢复", payload: { incidentId: incident.id } },
			{ commandType: "diagnostic-run", label: "诊断运行" },
		];
	}
	if (projection.workflow.state !== "failed") return [];
	const failureCode = projection.workflow.currentFailureCode;
	if (failureCode === "task_budget_exhausted") {
		const failedTask = projection.tasks.find((task) => task.status === "failed");
		return [
			...(failedTask ? [{ commandType: "retry-task" as const, label: "重试失败任务", payload: { taskId: failedTask.id } }] : []),
			{ commandType: "diagnostic-run" as const, label: "诊断运行" },
		];
	}
	if (failureCode === "planning_exhausted" || failureCode === "plan_budget_exhausted") {
		return [
			{ commandType: "retry-planning", label: "重试规划" },
			{ commandType: "diagnostic-run", label: "诊断运行" },
		];
	}
	return failureCode ? [{ commandType: "diagnostic-run", label: "诊断运行" }] : [];
}

/** 订阅 Run SSE;语义与 Workflow 流一致。 */
export function subscribeRunEvents(
	apiBase: string,
	runId: number,
	after: number,
	onEvent: () => void,
	onState?: (connected: boolean) => void,
): () => void {
	if (typeof EventSource === "undefined") return () => undefined;
	const source = new EventSource(`${apiBase}/api/runs/${runId}/events/stream?after=${after}`);
	source.onopen = () => { onState?.(true); onEvent(); };
	source.onerror = () => onState?.(false);
	source.addEventListener("run-event", () => onEvent());
	return () => source.close();
}

// ---------------------------------------------------------------------------
// 票17:专注 Approval 审阅
// ---------------------------------------------------------------------------

export interface ApprovalPacketArtifact {
	artifactId: number;
	revisionId: number;
	kind: string;
	revisionNo: number;
	status: string;
	contentDigest: string;
}

export interface ApprovalPacketDecision {
	id: number;
	severity: string;
	status: string;
	summary: string;
	reason: string | null;
	owner: string | null;
	followUpTarget: string | null;
}

export interface ApprovalPacketFinding {
	id: number;
	fingerprint: string;
	severity: string;
	status: string;
	summary: string;
	targetRevisionId: number;
	riskAcceptedBy: string | null;
	riskAcceptanceReason: string | null;
}

export interface ApprovalPacketContent {
	schemaVersion: "approval-packet/v1";
	workflowId: number;
	requirementRevisionId: number;
	artifacts: readonly ApprovalPacketArtifact[];
	decisions: readonly ApprovalPacketDecision[];
	findings: readonly ApprovalPacketFinding[];
	disclosedFindingIds: readonly number[];
	criticCoverage: { coveredRevisionIds: readonly number[] };
	warnings: readonly string[];
	policyBundleDigest: string;
	requiredArtifactKinds: readonly string[];
}

export interface ApprovalPacketDetail {
	id: number;
	workflowId: number;
	digest: string;
	status: string;
	valid: boolean;
	content: ApprovalPacketContent;
	createdAt: string;
}

export function getApprovalPacket(apiBase: string, packetId: number): Promise<ApprovalPacketDetail> {
	return fetchJson(apiBase, `/api/approval-packets/${packetId}`);
}

/** 专注审阅打开时固定的 Packet 绑定上下文。 */
export interface PacketReviewContext {
	packetId: number;
	digest: string;
	workflowVersion: number;
}

export interface PacketDrift {
	expectedPacketId: number;
	actualPacketId: number | null;
	expectedDigest: string;
	actualDigest: string | null;
	expectedWorkflowVersion: number;
	actualWorkflowVersion: number;
}

/**
 * Packet stale 判定:currentPacket 身份/digest 改变,或 Workflow version 前进
 * (approve 同时绑定 expectedWorkflowVersion 与 packetDigest)。
 * 任何 drift 都必须锁定审阅并要求显式 reload —— 绝不把旧批准意图应用到新 digest。
 */
export function packetReviewDrift(projection: WorkflowProjection, context: PacketReviewContext): PacketDrift | null {
	const current = projection.currentPacket;
	if (
		projection.workflow.state === "ready_to_archive"
		&& current !== null
		&& current.id === context.packetId
		&& current.digest === context.digest
		&& projection.workflow.version === context.workflowVersion
	) {
		return null;
	}
	return {
		expectedPacketId: context.packetId,
		actualPacketId: current?.id ?? null,
		expectedDigest: context.digest,
		actualDigest: current?.digest ?? null,
		expectedWorkflowVersion: context.workflowVersion,
		actualWorkflowVersion: projection.workflow.version,
	};
}

// ---------------------------------------------------------------------------
// 中文标签与旅程视图模型(全站唯一文案真源)
// ---------------------------------------------------------------------------

/** 工作流状态中文标签。 */
export function stateLabel(state: WorkflowState): string {
	switch (state) {
		case "pending": return "待开始";
		case "running": return "运行中";
		case "waiting_for_human": return "待人工处理";
		case "paused": return "已暂停";
		case "failed": return "失败";
		case "ready_to_archive": return "待批准";
		case "archived": return "已归档";
	}
}

/** 任务/运行/Attempt 状态中文标签;未知值原样返回(数据位诚实显示)。 */
export function statusLabel(status: string): string {
	const map: Record<string, string> = {
		pending: "等待中",
		queued: "排队中",
		in_progress: "进行中",
		running: "运行中",
		completed: "已完成",
		succeeded: "成功",
		failed: "失败",
		skipped_satisfied: "已跳过",
		superseded: "已取代",
		open: "待处理",
		closed: "已关闭",
		resolved: "已解决",
		approved: "已通过",
		accepted: "已接受",
		rejected: "已拒绝",
		current: "当前",
		withdrawn: "已撤回",
		active: "生效中",
		archived: "已归档",
	};
	return map[status] ?? status;
}

/** 命令类型中文标签;未知值原样返回。 */
export function commandLabel(type: string): string {
	const map: Record<string, string> = {
		start: "启动",
		resume: "继续",
		pause: "暂停",
		"cancel-run": "取消运行",
		steer: "人工指令",
		"diagnostic-run": "诊断运行",
		"replace-plan": "替换计划",
		"dispose-decision": "处置决策",
		"provide-human-input": "提供人工输入",
		"accept-finding-risk": "接受风险",
		"retry-task": "重试任务",
		"retry-planning": "重试规划",
		"retry-recovery": "重试恢复",
		"approve-packet": "批准归档",
		"reject-packet": "打回返工",
	};
	return map[type] ?? type;
}

/** 严重度中文标签。 */
export function severityLabel(severity: string): string {
	const map: Record<string, string> = { critical: "严重", major: "重要", minor: "次要", info: "提示" };
	return map[severity] ?? severity;
}

/** 待办类别中文标签。 */
export function gateCategoryLabel(category: GateCategory): string {
	switch (category) {
		case "critical_decision": return "关键决策";
		case "human_input": return "人工输入";
		case "finding_disposition": return "发现处置";
		case "recovery": return "事故恢复";
	}
}

/** 资产类别中文标签。 */
export function assetKindLabel(kind: string): string {
	const map: Record<string, string> = {
		"scenario-domain": "场景域",
		"scenario": "场景",
		"scenario-variant": "场景变体",
		"function-domain": "功能域",
		"function-item": "功能项",
		"function-point": "功能点",
		"design": "设计",
		"architecture": "架构",
		"data": "数据",
		"api": "接口",
		"usecase": "用例",
		"stakeholder": "干系人",
	};
	return map[kind] ?? kind;
}

export interface JourneyStep {
	key: string;
	label: string;
	status: StageStatus;
}

/** 需求设计旅程六步:规划 → 分析 → 设计 → 评审 → 批准 → 归档。 */
export function journeySteps(projection: WorkflowProjection): readonly JourneyStep[] {
	const stages = designStages(projection);
	return [
		...stages.map((stage) => ({ key: stage.key, label: stage.label === "计划" ? "规划" : stage.label, status: stage.status })),
		{ key: "archive", label: "归档", status: projection.workflow.state === "archived" ? "done" as const : "pending" as const },
	];
}

export const ASSET_KINDS = ["scenario-domain", "scenario", "scenario-variant", "function-domain", "function-item", "function-point", "usecase", "design", "architecture", "data", "api", "stakeholder"] as const;
// 资产库 API（Workspace Reusable Asset 列表、详情、关系和操作）
// ---------------------------------------------------------------------------

export type AssetKind = (typeof ASSET_KINDS)[number];

export interface AssetListQuery {
	page?: number;
	pageSize?: number;
	kind?: AssetKind;
	q?: string;
}

export interface AssetPage {
	assets: readonly AssetSummary[];
	total: number;
	page: number;
	pageSize: number;
	kindCounts: Readonly<Record<AssetKind, number>>;
}

export interface AssetSummary {
	id: number;
	workspaceId: number;
	kind: AssetKind;
	title: string;
	currentRevision: { id: number; revisionNo: number; digest: string; source: "manual" | "import" | "migration" | "workflow" } | null;
	legacyOriginRequirementId: number | null;
	createdAt: string;
}

export interface AssetRelationExport {
	fromTitle: string;
	fromKind: AssetKind;
	toTitle: string;
	toKind: AssetKind;
	type: "contains" | "involves";
	position?: number;
}

export interface AssetResolvedRelation {
	assetId: number;
	revisionId: number;
	type: "contains" | "involves";
	title: string;
	kind: AssetKind;
}

export interface AssetDetail {
	id: number;
	workspaceId: number;
	kind: AssetKind;
	title: string;
	currentRevisionId: number | null;
	legacyOriginRequirementId: number | null;
	originRequirementId: number | null;
	originArtifactId: number | null;
	originApprovalId: number | null;
	createdAt: string;
	resolvedGraph: { incoming: readonly AssetResolvedRelation[]; outgoing: readonly AssetResolvedRelation[] };
	revisions: readonly {
		id: number;
		revisionNo: number;
		contentDocumentId: number;
		digest: string;
		source: "manual" | "import" | "migration" | "workflow";
		content: unknown;
		createdAt: string;
	}[];
}

export async function listAssets(apiBase: string, workspaceId: number, query: AssetListQuery = {}): Promise<AssetPage> {
	const params = new URLSearchParams({ workspaceId: String(workspaceId) });
	if (query.page !== undefined) params.set("page", String(query.page));
	if (query.pageSize !== undefined) params.set("pageSize", String(query.pageSize));
	if (query.kind !== undefined) params.set("kind", query.kind);
	if (query.q !== undefined && query.q.length > 0) params.set("q", query.q);
	return fetchJson<AssetPage>(apiBase, `/api/assets?${params.toString()}`);
}

export function getAsset(apiBase: string, assetId: number): Promise<AssetDetail> {
	return fetchJson(apiBase, `/api/assets/${assetId}`);
}

async function throwAssetMutationError(response: Response, operation: string): Promise<never> {
	const body: unknown = await response.json().catch(() => null);
	if (typeof body === "object" && body !== null && !Array.isArray(body)) {
		const record = body as Record<string, unknown>;
		if (record.error === "invalid_relations" && Array.isArray(record.invalidRelations)) {
			const details = record.invalidRelations.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("；");
			throw new Error(`${operation} 关系校验失败：${details}`);
		}
		if (typeof record.error === "string") throw new Error(`${operation} asset failed: ${record.error}`);
	}
	throw new Error(`${operation} asset failed: ${response.status}`);
}

export async function createAsset(
	apiBase: string,
	workspaceId: number,
	input: { kind: AssetKind; title: string; content: unknown; relations?: readonly { toAssetId: number; type: "contains" | "involves"; position?: number }[] },
): Promise<{ assetId: number; revisionId: number; revisionNo: number }> {
	const response = await fetch(`${apiBase}/api/assets`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({ workspaceId, kind: input.kind, title: input.title, content: input.content, ...(input.relations === undefined ? {} : { relations: input.relations }) }),
	});
	if (!response.ok) await throwAssetMutationError(response, "create");
	return (await response.json()) as { assetId: number; revisionId: number; revisionNo: number };
}
export async function updateAsset(
	apiBase: string,
	assetId: number,
	input: { expectedRevisionId: number; title: string; content: unknown; relations: readonly { toAssetId: number; type: "contains" | "involves"; position?: number }[] },
): Promise<{ assetId: number; revisionId: number; revisionNo: number }> {
	const response = await fetch(`${apiBase}/api/assets/${assetId}`, {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify(input),
	});
	if (!response.ok) await throwAssetMutationError(response, "update");
	return (await response.json()) as { assetId: number; revisionId: number; revisionNo: number };
}

export async function deleteAsset(apiBase: string, assetId: number): Promise<void> {
	const response = await fetch(`${apiBase}/api/assets/${assetId}`, { method: "DELETE", credentials: "same-origin" });
	if (!response.ok) {
		const body: unknown = await response.json().catch(() => null);
		if (typeof body === "object" && body !== null && !Array.isArray(body)) {
			const record = body as Record<string, unknown>;
			if (record.error === "asset_referenced" && Array.isArray(record.refs)) {
				const details = record.refs.map((ref) => typeof ref === "object" && ref !== null && !Array.isArray(ref)
					? JSON.stringify(ref)
					: String(ref)).join("；");
				throw new Error(`资产仍被以下资产引用：${details}`);
			}
		}
		throw new Error(`delete asset failed: ${response.status}`);
	}
}

export interface AssetGraph {
	nodes: readonly { assetId: number; kind: AssetKind; title: string }[];
	edges: readonly { fromAssetId: number; toAssetId: number; type: "contains" | "involves" }[];
}

export function getAssetGraph(apiBase: string, workspaceId: number): Promise<AssetGraph> {
	return fetchJson(apiBase, `/api/assets/graph?workspaceId=${workspaceId}`);
}

export async function exportAssets(apiBase: string, workspaceId: number): Promise<{ assets: readonly AssetDetail[]; relations: readonly AssetRelationExport[] }> {
	const body = await fetchJson<{ assets: AssetDetail[]; relations: AssetRelationExport[] }>(apiBase, `/api/assets/export?workspaceId=${workspaceId}`);
	return body;
}

export async function importAssets(apiBase: string, workspaceId: number, assets: readonly { kind: AssetKind; title: string; content: unknown }[], relations?: readonly AssetRelationExport[]): Promise<readonly number[]> {
	const response = await fetch(`${apiBase}/api/assets/import`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify({ workspaceId, assets, ...(relations === undefined ? {} : { relations }) }),
	});
	if (!response.ok) {
		const body: unknown = await response.json().catch(() => null);
		if (typeof body === "object" && body !== null && !Array.isArray(body)) {
			const record = body as Record<string, unknown>;
			if (record.error === "invalid_relations" && Array.isArray(record.invalidRelations)) {
				const details = record.invalidRelations.map((item) => typeof item === "string" ? item : JSON.stringify(item)).join("；");
				throw new Error(`导入关系校验失败：${details}`);
			}
		}
		throw new Error(`import assets failed: ${response.status}`);
	}
	const body = (await response.json()) as { assetIds: number[] };
	return body.assetIds;
}

// ---------------------------------------------------------------------------
// 工作区管理 API(契约 workflow-api/v1 workspaces 段 + 管理页行内文案真源)
// ---------------------------------------------------------------------------

export interface WorkspaceSummary {
	id: number;
	name: string;
	repoPath: string;
	createdAt: string;
}

/** 工作区注册表 API 错误:保留 HTTP 状态码与服务端 error code,供管理页行内文案映射。 */
export class WorkspaceApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
	) {
		super(message);
	}
}

export async function listWorkspaces(apiBase: string): Promise<readonly WorkspaceSummary[]> {
	const body = await fetchJson<{ workspaces: WorkspaceSummary[] }>(apiBase, "/api/workspaces");
	return body.workspaces;
}

export async function createWorkspace(apiBase: string, input: { name: string; repoPath: string }): Promise<number> {
	const response = await fetch(`${apiBase}/api/workspaces`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify(input),
	});
	const body = (await response.json().catch(() => null)) as { workspaceId?: number; error?: string } | null;
	if (!response.ok) {
		throw new WorkspaceApiError(response.status, body?.error ?? "unknown", `创建工作区失败(${response.status})`);
	}
	return body?.workspaceId as number;
}

export async function deleteWorkspace(apiBase: string, workspaceId: number): Promise<void> {
	const response = await fetch(`${apiBase}/api/workspaces/${workspaceId}`, {
		method: "DELETE",
		credentials: "same-origin",
	});
	const body = (await response.json().catch(() => null)) as { error?: string } | null;
	if (!response.ok) {
		throw new WorkspaceApiError(response.status, body?.error ?? "unknown", `删除工作区失败(${response.status})`);
	}
}

/** 创建工作区输入归一:trim 后任一为空返回 null(服务端同语义 400)。 */
export function normalizeWorkspaceInput(name: string, repoPath: string): { name: string; repoPath: string } | null {
	const trimmedName = name.trim();
	const trimmedRepoPath = repoPath.trim();
	if (trimmedName === "" || trimmedRepoPath === "") return null;
	return { name: trimmedName, repoPath: trimmedRepoPath };
}

/** 400/409 → 行内文案;未知错误回退通用文案。 */
export function createWorkspaceErrorCopy(error: unknown): string {
	if (error instanceof WorkspaceApiError) {
		if (error.code === "malformed_workspace") return "名称与仓库路径必填,且不能为空白";
		if (error.code === "duplicate_repo_path") return "该仓库路径已在其他工作区使用";
	}
	return error instanceof Error ? error.message : String(error);
}

/** 409 workspace_busy / 404 → 行内文案;未知错误回退通用文案。 */
export function deleteWorkspaceErrorCopy(error: unknown): string {
	if (error instanceof WorkspaceApiError) {
		if (error.code === "workspace_busy") return "有运行或认领在飞,暂时无法删除,稍后再试";
		if (error.code === "unknown_workspace") return "该工作区已不存在,请刷新列表";
	}
	return error instanceof Error ? error.message : String(error);
}

/**
 * 选中态解析(决议 09):已存键值在工作区列表内 → 直达;无键 → 管理页(不清键);
 * 键值已失效(工作区被级联删除)→ 管理页并清键;列表不可用(网络失败)→ 管理页但不销毁选择。
 */
export function resolveStoredWorkspace(
	stored: string | null,
	workspaces: readonly WorkspaceSummary[] | null,
): { workspaceId: number | null; clearKey: boolean } {
	if (stored === null) return { workspaceId: null, clearKey: false };
	if (workspaces === null) return { workspaceId: null, clearKey: false };
	const id = Number(stored);
	if (Number.isInteger(id) && id > 0 && workspaces.some((workspace) => workspace.id === id)) {
		return { workspaceId: id, clearKey: false };
	}
	return { workspaceId: null, clearKey: true };
}
