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
				title: `人工输入(${gate.subjectType} #${gate.subjectId})`,
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
				title: finding?.summary ?? `Finding thread #${gate.subjectId}`,
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
	commandType: "retry-task" | "retry-planning" | "retry-recovery" | "replace-plan" | "diagnostic-run";
	label: string;
	payload?: Record<string, unknown>;
}

/**
 * 失败恢复组合:execution(retry-task)、planning(retry-planning)、Engine/Outbox(retry-recovery)
 * 各自只显示合法动作;replace-plan 仅对 Task/Planning 类失败可用。
 */
export function recoveryActions(projection: WorkflowProjection): readonly RecoveryAction[] {
	const incident = projection.currentIncident;
	if (incident && incident.status === "open") {
		return [
			{ commandType: "retry-recovery", label: "重试恢复", payload: { incidentId: incident.id } },
			{ commandType: "diagnostic-run", label: "诊断 Run" },
		];
	}
	if (projection.workflow.state !== "failed") return [];
	const failureCode = projection.workflow.currentFailureCode;
	if (failureCode === "task_budget_exhausted") {
		const failedTask = projection.tasks.find((task) => task.status === "failed");
		return [
			...(failedTask ? [{ commandType: "retry-task" as const, label: "重试失败任务", payload: { taskId: failedTask.id } }] : []),
			{ commandType: "replace-plan" as const, label: "替换计划" },
			{ commandType: "diagnostic-run" as const, label: "诊断 Run" },
		];
	}
	if (failureCode === "planning_exhausted" || failureCode === "plan_budget_exhausted") {
		return [
			{ commandType: "retry-planning", label: "重试规划" },
			{ commandType: "replace-plan", label: "替换计划" },
			{ commandType: "diagnostic-run", label: "诊断 Run" },
		];
	}
	return failureCode ? [{ commandType: "diagnostic-run", label: "诊断 Run" }] : [];
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
