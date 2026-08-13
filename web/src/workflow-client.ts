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

export interface WorkflowProjection {
	workflow: {
		id: number;
		state: WorkflowState;
		version: number;
		lastEventSeq: number;
		currentFailureCode: string | null;
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

export interface RequirementDetail {
	id: number;
	workspaceId: number;
	title: string;
	version: number;
	workflowId: number;
	designPackageId: number | null;
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

async function fetchJson<T>(apiBase: string, path: string): Promise<T> {
	const response = await fetch(`${apiBase}${path}`, { credentials: "same-origin" });
	if (!response.ok) throw new Error(`request failed: ${response.status} ${path}`);
	return (await response.json()) as T;
}

export function getRequirement(apiBase: string, requirementId: number): Promise<RequirementDetail> {
	return fetchJson(apiBase, `/api/requirements/${requirementId}`);
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
export function subscribeWorkflowEvents(
	apiBase: string,
	workflowId: number,
	after: number,
	onEvent: () => void,
): () => void {
	if (typeof EventSource === "undefined") return () => undefined;
	const source = new EventSource(`${apiBase}/api/workflows/${workflowId}/events/stream?after=${after}`);
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
			return { title: "进行中", description: "Workflow 正在自动执行。你可以查看后台进度。", action: { label: "查看进度", kind: "expand" } };
		case "waiting_for_human":
			return { title: "等待人工处理", description: "有需要你判断的门禁事项。处理后才能继续。", action: { label: "处理门禁", kind: "expand" } };
		case "paused":
			return { title: "已暂停", description: "Workflow 已暂停,新的调度已停止。", action: { label: "继续", kind: "command", commandType: "resume" } };
		case "failed":
			return { title: "失败", description: "Workflow 遇到失败。查看诊断并选择恢复方式。", action: { label: "查看诊断", kind: "expand" } };
		case "ready_to_archive":
			return { title: "待批准", description: "设计包已就绪,等待你的最终批准。", action: { label: "查看批准包", kind: "expand" } };
		case "archived":
			return { title: "已归档", description: "设计已完成并归档为不可变的 Design Package。", action: { label: "查看设计包", kind: "package" } };
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
