import type { ReusableAssetKind } from "../persistence/reusable-asset-kind.js";
import type { CrashInjector, FixtureClock, FixtureOperator, FixtureOutboxTransport, HashProvider } from "../testing/deterministic-fixtures.js";
import { WorkflowStore, type BeginPlanningResult, type CommandReceipt, type CompletePlanningResult, type ExecuteCommandInput, type ReconciliationReport, type WorkflowProjection, type EvidenceSnapshotResult, type TraceLinkResult, type FindingRecord, type FindingThreadRecord, type DecisionRecord, type ReadinessReport, type BuildApprovalPacketResult, type ApprovalPacketRecord, type HumanGateRecord, type ApprovalRecordEntry, type HumanDirectiveRecord, type DiagnosticRunRecord, type CommandReceiptDetail, type RequirementSummaryRecord, type RequirementDetailRecord, type ArtifactRevisionDetailRecord, type BoundedWorkflowProjection, type PlanRevisionDetail, type TaskDetailRecord, type AttemptSummaryRecord, type AttemptDetailRecord, type RunDetailRecord, type ApprovalPacketDetailRecord, type DesignPackageRecord, type LegacyImportRecord, type ReusableAssetSummary, type ReusableAssetDetail, type ReusableAssetListQuery, type ReusableAssetPage,
	type SearchHit, type WorkflowEventEnvelope, type WorkspaceSummary, type RunEventEnvelope } from "../persistence/workflow-store.js";
import type { BeginAttemptResult, CompleteAttemptResult, ExecuteTaskResult, RoleResult, TraceLinkProposal, CriticReport, AssetReference } from "./role-result.js";
import { WORKFLOW_COMMAND_TYPES, type WorkflowCommandType } from "./command-types.js";
import { loadWorkflowContracts } from "./contracts/loader.js";
import { compileWorkflowSchema, type WorkflowSchemaValidator } from "./contracts/schema.js";
import type { DoctorReport } from "./workflow-doctor.js";
import type { ModelDriver, ModelRoles, ModelRolesOverride } from "./model-driver.js";
import { validatePlanProposal, type PlanValidationContext } from "./plan-validator.js";
import { FEEDBACK_REFERENCE_BUDGET } from "../persistence/workflow-store.js";
import { instantiatePlanTemplate } from "./plan-template.js";
import type { TaskRole } from "./plan-types.js";
import type { PlanProposal } from "./plan-types.js";
import type { AssetGraph, AssetRelationExport, AssetRelationInput, AssetRelationRecord, ReusableAssetExportBundle } from "../persistence/workflow-store.js";
import type { RequirementBaseline } from "./requirement.js";

export type { RequirementBaseline } from "./requirement.js";
export type { CommandReceipt, ReconciliationReport, BeginPlanningResult, CompletePlanningResult, FindingRecord, FindingThreadRecord, WorkspaceSummary } from "../persistence/workflow-store.js";
export type { WorkflowCommandType } from "./command-types.js";
export type { BeginAttemptResult, CompleteAttemptResult, ExecuteTaskResult, RoleResult, CriticReport } from "./role-result.js";
export type { DoctorReport } from "./workflow-doctor.js";

export interface HeadlessWorkflowRuntimeOptions {
	databasePath: string;
	clock: FixtureClock;
	hashProvider: HashProvider;
	crashInjector: CrashInjector;
	outboxTransport: FixtureOutboxTransport;
}

export interface ExecuteCommandRequest {
	workflowId: number;
	commandId: string;
	expectedWorkflowVersion: number;
	type: WorkflowCommandType;
	payload?: Record<string, unknown>;
	reason?: string;
	operator: FixtureOperator;
	schemaVersion?: string;
}

export interface PlanWorkflowResult {
	outcome: CompletePlanningResult["outcome"];
	planRevisionId: number | null;
	workflowVersion: number;
	lastEventSeq: number;
}

export interface HeadlessWorkflowRuntime {
	createWorkspace(input: { repoPath: string; name: string }): number;
	workspaceExists(workspaceId: number): boolean;
	listWorkspaces(): readonly WorkspaceSummary[];
	deleteWorkspace(workspaceId: number): boolean;
	createRequirement(input: { workspaceId: number; baseline: RequirementBaseline; modelRoles?: ModelRolesOverride }): {
		requirementId: number;
		workflowId: number;
		workflowState: "pending";
		workflowVersion: 0;
		lastEventSeq: 1;
	};
	listRequirements(workspaceId: number): Array<{ requirementId: number; workflowId: number }>;
	getWorkflowProjection(workflowId: number): WorkflowProjection | undefined;
	executeCommand(input: ExecuteCommandRequest): CommandReceipt;
	getCommandReceipt(workflowId: number, commandId: string): CommandReceipt | undefined;
	getCommandReceiptDetail(workflowId: number, commandId: string): CommandReceiptDetail | undefined;
	beginPlanning(workflowId: number): BeginPlanningResult;
	completePlanning(workflowId: number, attemptId: number, structuredResult: unknown): CompletePlanningResult;
	planWorkflow(workflowId: number, modelDriver: ModelDriver | null): Promise<PlanWorkflowResult>;
	getPlanningContextDigest(workflowId: number): string;
	beginAttempt(workflowId: number): BeginAttemptResult;
	completeAttempt(workflowId: number, attemptId: number, structuredResult: unknown): CompleteAttemptResult;
	executeTask(workflowId: number, modelDriver: ModelDriver): Promise<ExecuteTaskResult>;
	reconcile(): ReconciliationReport;
	processOutbox(): { delivered: number; exhausted: number; incidentsCreated: number };
	diagnose(): DoctorReport;
	bindEvidenceSnapshot(workflowId: number, repoDigest: string, files: unknown): EvidenceSnapshotResult;
	getTraceLinks(artifactRevisionId: number): readonly TraceLinkResult[];
	isEvidenceStale(workflowId: number, currentRepoDigest: string): boolean;
	getEvidenceSnapshots(workflowId: number): readonly EvidenceSnapshotResult[];
	getFindings(workflowId: number): readonly FindingRecord[];
	getFindingThreads(workflowId: number): readonly FindingThreadRecord[];
	acceptFindingRisk(workflowId: number, findingId: number, operator: string, reason: string): void;
	isFindingRiskAcceptanceStale(workflowId: number, findingId: number): boolean;
	getDecisions(workflowId: number): readonly DecisionRecord[];
	checkReadiness(workflowId: number): ReadinessReport;
	buildApprovalPacket(workflowId: number): BuildApprovalPacketResult;
	getApprovalPacket(workflowId: number): ApprovalPacketRecord | undefined;
	getHumanGates(workflowId: number): readonly HumanGateRecord[];
	getApprovalRecords(workflowId: number): readonly ApprovalRecordEntry[];
	getHumanDirectives(workflowId: number): readonly HumanDirectiveRecord[];
	getDiagnosticRuns(workflowId: number): readonly DiagnosticRunRecord[];
	listRequirementSummaries(workspaceId: number): readonly RequirementSummaryRecord[];
	getRequirementDetail(requirementId: number): RequirementDetailRecord | undefined;
	getArtifactRevisionDetail(requirementId: number, kind: string): ArtifactRevisionDetailRecord | undefined;
	getBoundedProjection(workflowId: number): BoundedWorkflowProjection | undefined;
	getPlanRevisionDetail(planRevisionId: number): PlanRevisionDetail | undefined;
	getTaskDetail(taskId: number): TaskDetailRecord | undefined;
	listTaskAttempts(taskId: number): readonly AttemptSummaryRecord[];
	getAttemptDetail(attemptId: number): AttemptDetailRecord | undefined;
	getAttemptContext(attemptId: number): { role: string; objective: string; requirementBaseline: RequirementBaseline; inputs: readonly unknown[]; expectedArtifactKind: string; expectedArtifactKinds: readonly string[] } | undefined;
	listPendingReviewedArtifacts(workflowId: number): readonly { artifactId: number; revisionId: number; kind: string }[];
	getRunDetail(runId: number): RunDetailRecord | undefined;
	getApprovalPacketDetail(packetId: number): ApprovalPacketDetailRecord | undefined;
	getDesignPackage(designPackageId: number): DesignPackageRecord | undefined;
	getLegacyImport(requirementId: number): LegacyImportRecord | undefined;
	createReusableAsset(input: { workspaceId: number; kind: ReusableAssetKind; title: string; content: unknown; source?: "manual" | "import" | "migration" | "workflow"; strict?: boolean }): { assetId: number; revisionId: number; revisionNo: number };
	writeRelations(input: { workspaceId: number; fromAssetId: number; fromRevisionId: number; relations: readonly AssetRelationInput[] }): readonly AssetRelationRecord[];
	readRelations(assetId: number): readonly AssetRelationRecord[];
	getWorkspaceAssetGraph(workspaceId: number): AssetGraph;
	assetExistsByOriginArtifactId(workspaceId: number, artifactId: number): boolean;
	updateReusableAsset(input: { workspaceId: number; assetId: number; expectedRevisionId: number; title: string; content: unknown; relations: readonly AssetRelationInput[] }): { assetId: number; revisionId: number; revisionNo: number } | undefined;
	listReusableAssets(workspaceId: number): readonly ReusableAssetSummary[];
	listReusableAssetPage(workspaceId: number, query?: ReusableAssetListQuery): ReusableAssetPage;
	getReusableAsset(assetId: number): ReusableAssetDetail | undefined;
	deleteReusableAsset(assetId: number): boolean;
	exportReusableAssets(workspaceId: number): readonly ReusableAssetDetail[];
	importReusableAssets(workspaceId: number, assets: readonly { kind: ReusableAssetKind; title: string; content: unknown }[]): readonly number[];
	exportReusableAssetBundle(workspaceId: number): ReusableAssetExportBundle;
	importReusableAssetBundle(workspaceId: number, assets: readonly { kind: ReusableAssetKind; title: string; content: unknown }[], relations?: readonly AssetRelationExport[], strict?: boolean): readonly number[];
	searchWorkspaceContent(workspaceId: number, query: string): readonly SearchHit[];
	getFeedbackAssetReferences(workflowId: number, query: string, budget: number): readonly AssetReference[];
	promoteRequirementArtifacts(workflowId: number, kinds: readonly string[]): Record<string, number>;
	appendRunEvent(runId: number, type: string, payload: Record<string, unknown>): number;
	runExists(runId: number): boolean;
	getRunEventWatermark(runId: number): number;
	getRunEvents(runId: number, after: number, limit: number): readonly RunEventEnvelope[];
	getWorkflowEventWatermark(workflowId: number): number;
	getWorkflowEvents(workflowId: number, after: number, limit: number): readonly WorkflowEventEnvelope[];
	subscribeWorkflowEvents(listener: (event: WorkflowEventEnvelope) => void): () => void;
	subscribeRunEvents(listener: (event: RunEventEnvelope) => void): () => void;
	close(): void;
}

export async function openHeadlessWorkflowRuntime(
	options: HeadlessWorkflowRuntimeOptions,
): Promise<HeadlessWorkflowRuntime> {
	const contracts = await loadWorkflowContracts();
	const artifactValidator = compileWorkflowSchema(contracts, "artifact-content/v1");
	const planValidator = compileWorkflowSchema(contracts, "plan-proposal/v1");
	const policyBundle = {
		schemaVersion: "policy-bundle/v1" as const,
		contracts: contracts.assets
			.map((asset) => ({
				identity: asset.identity,
				digest: options.hashProvider.digest(asset.content),
				content: asset.content,
			}))
			.sort((left, right) => left.identity.localeCompare(right.identity)),
	};
	const store = new WorkflowStore({ ...options, policyBundle, artifactValidator, planValidator });

	function completePlanningInternal(workflowId: number, attemptId: number, structuredResult: unknown, templateMode = false): CompletePlanningResult {
		if (store.isPlanningContextStale(workflowId, attemptId)) {
			return store.supersedePlanningAttempt(workflowId, attemptId, "planning_context_changed");
		}
		const projection = store.getWorkflowProjection(workflowId);
		if (!projection) throw new Error("Workflow not found");
		const baseVersion = store.getAttemptBaseVersion(workflowId, attemptId);
		const context: PlanValidationContext = {
			workflowId,
			workflowVersion: baseVersion ?? projection.workflow.version,
			planningContextDigest: store.getPlanningContextDigest(workflowId),
			basePlanRevisionId: projection.workflow.currentPlanRevisionId,
		};
		const validation = validatePlanProposal(structuredResult, context, planValidator, { templateMode });
		if (validation.valid) {
			return store.adoptPlan(workflowId, attemptId, structuredResult as PlanProposal);
		}
		return store.failPlanningAttempt(workflowId, attemptId, validation.ruleViolations);
	}

	function completeAttemptInternal(workflowId: number, attemptId: number, structuredResult: unknown): CompleteAttemptResult {
		return store.publishAttemptResult(workflowId, attemptId, structuredResult);
	}

/** 各产物 kind 的 schema 字段提示(禁止额外字段)。从 artifact-content-v1.schema.json 提取。 */
const ARTIFACT_SCHEMA_HINTS: Record<string, string> = {
	analysis: "schemaVersion:\"artifact/analysis/v1\",artifactKind:\"analysis\",summary(string),sourceRefs:[{type:\"requirement_revision\",revisionId:1}],goals:[string](至少1项),nonGoals:[string],constraints:[string],acceptanceCriteria:[string](至少1项),impactProfile:{process/actors/behavior/architecture/data/api各{status:\"yes\"或\"no\"或\"unknown\",rationale:string}},openQuestions:[string]",
	scenario: "schemaVersion:\"artifact/scenario/v1\",artifactKind:\"scenario\",summary(string),sourceRefs:[{type:\"requirement_revision\",revisionId:1}],scenarios:[{id:string,title:string,actors:[string],preconditions:[string],trigger:string,mainFlow:[string],alternateFlows:[string],expectedOutcome:string}]",
	usecase: "schemaVersion:\"artifact/usecase/v1\",artifactKind:\"usecase\",summary(string),sourceRefs:[{type:\"requirement_revision\",revisionId:1}],useCases:[{id:string,actor:string,goal:string,preconditions:[string],mainFlow:[string],alternativeFlows:[string],postconditions:[string]}]",
	function: "schemaVersion:\"artifact/function/v1\",artifactKind:\"function\",summary(string),sourceRefs:[{type:\"requirement_revision\",revisionId:1}],functions:[{id:string,name:string,responsibility:string,inputs:[string],outputs:[string],businessRules:[string],acceptanceCriteria:[string]}]",
	design: "schemaVersion:\"artifact/design/v1\",artifactKind:\"design\",summary(string),sourceRefs:[{type:\"requirement_revision\",revisionId:1}],changeUnits:[{id:string,area:string,change:string,rationale:string,sourceRefs:[{type:\"requirement_revision\",revisionId:1}]}],alternatives:[string],failureHandling:[string],testStrategy:[string],implementationOrder:[string],rolloutStrategy:string,rollbackStrategy:string",
	architecture: "schemaVersion:\"artifact/architecture/v1\",artifactKind:\"architecture\",summary(string),sourceRefs:[{type:\"requirement_revision\",revisionId:1}],components:[{id:string,name:string,responsibility:string}],relationships:[{from:string,to:string,interaction:string}],constraints:[string],nonFunctionalRequirements:[string],decisions:[number]",
	data: "schemaVersion:\"artifact/data/v1\",artifactKind:\"data\",summary(string),sourceRefs:[{type:\"requirement_revision\",revisionId:1}],entities:[{name:string,purpose:string,fields:[string],lifecycle:string}],relationships:[string],migrationPlan:string,rollbackPlan:string,privacyAndRetention:[string]",
	api: "schemaVersion:\"artifact/api/v1\",artifactKind:\"api\",summary(string),sourceRefs:[{type:\"requirement_revision\",revisionId:1}],interfaces:[{id:string,kind:\"http\"或\"event\"或\"message\"或\"rpc\"或\"function\",name:string,contract:string,errors:[string],compatibility:string}],security:[string],versioning:string,testStrategy:[string]",
};
/** 把 contextManifest 的任务上下文拼成模型可理解的 instruction。 */
function buildTaskInstruction(role: string, objective: string, baseline: RequirementBaseline, workflowId: number, attemptId: number, evidenceSnapshotId: number, reviewRevisionId: number, reviewArtifactKind: string, expectedArtifactKinds: readonly string[], reviewTargets: ReadonlyArray<{ resolvedRevisionId?: number; artifactKind?: string }>): string {
	const base = [
		`你是 BaiZe Architect 的 ${role} 角色。`,
		`任务目标:${objective}`,
		"",
		"需求基线:",
		`标题:${baseline.title}`,
		`摘要:${baseline.summary}`,
		`描述:${baseline.description}`,
	];
	if (baseline.goals?.length) base.push(`目标:${baseline.goals.join("; ")}`);
	if (baseline.nonGoals?.length) base.push(`非目标:${baseline.nonGoals.join("; ")}`);
	if (baseline.constraints?.length) base.push(`约束:${baseline.constraints.join("; ")}`);
	if (role === "critic") {
		const targets = reviewTargets.length > 0 ? reviewTargets : [{ resolvedRevisionId: reviewRevisionId, artifactKind: reviewArtifactKind }];
		const targetsJson = targets.map((t) => `{revisionId:${t.resolvedRevisionId ?? 0},artifactKind:"${t.artifactKind ?? ""}"}`).join(",");
		base.push(
			"",
			"你是评审者,负责审查产物的完整性与质量,不产出产物。",
			"输出纯 JSON 格式的 RoleResult,不要 Markdown 代码块或解释。",
			`RoleResult 结构:{schemaVersion:"role-result/v1",workflowId:${workflowId},attemptId:${attemptId},effects:[],criticReport:{schemaVersion:"critic-report/v1",workflowId:${workflowId},attemptId:${attemptId},coverageAttestation:{reviewTargets:[${targetsJson}],complete:true},findings:[]}}`,
			"effects 必须为空数组(critic 不产出产物)。",
			"criticReport.coverageAttestation.complete 必须为 true。",
			`reviewTargets 必须包含全部以下目标:${targetsJson}`,
			"findings 为空数组表示无问题;如有问题,每条含 fingerprint、severity、summary、targetRevisionId、targetArtifactKind、sourceRef。",
			"保持简洁,直接以 { 开头输出完整闭合的 JSON。",
		);
	} else {
		// 构造 effects 数组:每个 expectedArtifactKind 一个 effect
		const kinds = expectedArtifactKinds.length > 0 ? expectedArtifactKinds : ["analysis"];
		const effectsArr = kinds.map((k) => {
			const schema = ARTIFACT_SCHEMA_HINTS[k] ?? ARTIFACT_SCHEMA_HINTS["analysis"];
			return `{effectType:"artifact_revision",artifactKind:"${k}",logicalKey:"${k}",content:{${schema}},baseRevisionId:null,traceLinks:[{evidenceSnapshotId:${evidenceSnapshotId},sourceRef:{type:"requirement_revision",revisionId:1}}]}`;
		});
		base.push(
			"",
			"请基于以上需求,完成本角色的设计任务。",
			"输出纯 JSON 格式的 RoleResult,不要 Markdown 代码块或解释。",
			`RoleResult 结构:{schemaVersion:"role-result/v1",workflowId:${workflowId},attemptId:${attemptId},effects:[${effectsArr.join(",")}]}`,
			"每个 effect 的 content 必须严格只含 schema 声明的字段(禁止额外字段)。",
			"保持简洁,直接以 { 开头输出完整闭合的 JSON。",
		);
	}
	return base.join("\n");
}
	return {
		createWorkspace(input) {
			return store.createWorkspace(input);
		},
		workspaceExists(workspaceId) {
			return store.workspaceExists(workspaceId);
		},
		listWorkspaces() {
			return store.listWorkspaces();
		},
		deleteWorkspace(workspaceId) {
			return store.deleteWorkspace(workspaceId);
		},
		createRequirement(input) {
			if (!artifactValidator.check(input.baseline)) {
				throw new Error("Requirement baseline does not match artifact/requirement/v1");
			}
			return store.createRequirement(input);
		},
		listRequirements(workspaceId) {
			return store.listRequirements(workspaceId);
		},
		getWorkflowProjection(workflowId) {
			return store.getWorkflowProjection(workflowId);
		},
		executeCommand(input) {
			if (input.schemaVersion !== undefined && input.schemaVersion !== "workflow-command/v1") {
				throw new Error("Command envelope schema is invalid");
			}
			if (!WORKFLOW_COMMAND_TYPES.includes(input.type)) {
				throw new Error("Command envelope schema is invalid");
			}
			if (!store.getWorkflowProjection(input.workflowId)) {
				throw new Error("Command envelope schema is invalid");
			}
			const { schemaVersion: _omitted, ...envelope } = input;
			void _omitted;
			return store.executeCommand(envelope as ExecuteCommandInput);
		},
		getCommandReceipt(workflowId, commandId) {
			return store.getCommandReceipt(workflowId, commandId);
		},
		getCommandReceiptDetail(workflowId, commandId) {
			return store.getCommandReceiptDetail(workflowId, commandId);
		},
		beginPlanning(workflowId) {
			return store.beginPlanning(workflowId);
		},
		completePlanning(workflowId, attemptId, structuredResult) {
			return completePlanningInternal(workflowId, attemptId, structuredResult);
		},
		async planWorkflow(workflowId, _modelDriver: ModelDriver | null) {
			// #12 决议：Engine 直生成。plan-template/v1 确定性实例化模板计划，无 Orchestrator 模型调用；
			// beginPlanning 持久化骨架（plan Task/attempt/run）保留，adoptPlan 校验器复用（templateMode 免限额）。
			for (let iteration = 0; iteration < 10; iteration += 1) {
				const begin = store.beginPlanning(workflowId);
				if (begin.taskId === 0) {
					return { outcome: "plan_budget_exhausted", planRevisionId: null, workflowVersion: begin.workflowVersion, lastEventSeq: begin.lastEventSeq };
				}
				store.appendRunEvent(begin.runId, "plan_template_instantiated", { role: "engine", contextDigest: begin.planningContextDigest });
				const baseVersion = store.getAttemptBaseVersion(workflowId, begin.attemptId);
				const proposal = instantiatePlanTemplate(contracts, {
					workflowId,
					workflowVersion: baseVersion ?? begin.workflowVersion,
					planningContextDigest: begin.planningContextDigest,
					basePlanRevisionId: store.getWorkflowProjection(workflowId)?.workflow.currentPlanRevisionId ?? null,
				});
				// #24 规划期注入：需求标题检索历史资产引用（预算内），冻结进 plan revision
				{
					const projection = store.getWorkflowProjection(workflowId);
					if (projection) {
						const references = store.getFeedbackAssetReferences(workflowId, projection.requirement.title, FEEDBACK_REFERENCE_BUDGET);
						if (references.length > 0) proposal.assetReferences = references;
					}
				}
				const complete = completePlanningInternal(workflowId, begin.attemptId, proposal, true);
				if (complete.outcome === "adopted") {
					return { outcome: "adopted", planRevisionId: complete.planRevisionId, workflowVersion: complete.workflowVersion, lastEventSeq: complete.lastEventSeq };
				}
				if (complete.outcome === "planning_exhausted" || complete.outcome === "plan_budget_exhausted") {
					return { outcome: complete.outcome, planRevisionId: null, workflowVersion: complete.workflowVersion, lastEventSeq: complete.lastEventSeq };
				}
			}
			throw new Error("Planning loop exceeded maximum iterations");
		},
		getPlanningContextDigest(workflowId) {
			return store.getPlanningContextDigest(workflowId);
		},
		beginAttempt(workflowId) {
			return store.beginAttempt(workflowId);
		},
		completeAttempt(workflowId, attemptId, structuredResult) {
			return completeAttemptInternal(workflowId, attemptId, structuredResult);
		},
		async executeTask(workflowId, modelDriver) {
			const projection = store.getWorkflowProjection(workflowId);
			const modelRoles = projection?.workflow.modelRoles;
			for (let iteration = 0; iteration < 10; iteration += 1) {
				const begin = store.beginAttempt(workflowId);
				if (begin.taskId === 0) {
					return { outcome: "no_ready_task", workflowVersion: begin.workflowVersion, lastEventSeq: begin.lastEventSeq };
				}
			store.appendRunEvent(begin.runId, "model_call_started", { role: begin.taskRole, contextDigest: begin.contextDigest });
			let result;
		try {
			// 从 contextManifest 读取任务上下文,拼出有意义的 instruction(角色、需求、任务目标、输出格式)
		const ctx = store.getAttemptContext(begin.attemptId);
		const evidenceSnapshots = store.getEvidenceSnapshots(workflowId);
		const evidenceSnapshotId = evidenceSnapshots[0]?.id ?? 0;
	const reviewTargets = ctx?.inputs?.filter((i) => (i as { type?: string }).type === "task_output") as Array<{ resolvedRevisionId?: number; artifactKind?: string }> | undefined;
	const firstReviewTarget = reviewTargets?.[0];
	const instruction = ctx
		? buildTaskInstruction(ctx.role, ctx.objective, ctx.requirementBaseline, workflowId, begin.attemptId, evidenceSnapshotId, firstReviewTarget?.resolvedRevisionId ?? 0, firstReviewTarget?.artifactKind ?? "", ctx.expectedArtifactKinds, reviewTargets ?? [])
		: "Produce the required output.";
			result = await modelDriver.execute(
				{ role: begin.taskRole as TaskRole, contextDigest: begin.contextDigest, instruction, modelRoles },
				[],
			);
			store.appendRunEvent(begin.runId, "token", { role: begin.taskRole, provider: result.modelUsage.provider, modelId: result.modelUsage.modelId, inputTokens: result.modelUsage.inputTokens, outputTokens: result.modelUsage.outputTokens });
			store.appendRunEvent(begin.runId, "model_result", { role: begin.taskRole, produced: "role-result/v1" });
			const complete = completeAttemptInternal(workflowId, begin.attemptId, result.structuredResult);
				if (complete.outcome === "published") {
					return { outcome: "published", workflowVersion: complete.workflowVersion, lastEventSeq: complete.lastEventSeq };
				}
				if (complete.outcome === "task_exhausted") {
					return { outcome: "task_exhausted", workflowVersion: complete.workflowVersion, lastEventSeq: complete.lastEventSeq };
				}
		} catch (error) {
			store.appendRunEvent(begin.runId, "model_call_failed", { role: begin.taskRole, error: error instanceof Error ? error.message : String(error) });
			// 驱动或发布抛错都必须走 failAttempt:释放 claim、计入失败/重试/耗尽,否则 dangling claim 阻塞后续命令与引擎推进。
			const failed = store.failAttempt(workflowId, begin.attemptId, "model_call_error", error instanceof Error ? error.message : String(error));
			return { outcome: failed.outcome === "task_exhausted" ? "task_exhausted" : "failed", workflowVersion: failed.workflowVersion, lastEventSeq: failed.lastEventSeq };
		}
		}
		throw new Error("Task execution loop exceeded maximum iterations");
		},
		reconcile() {
			return store.reconcile();
		},
		processOutbox() {
			return store.processOutbox();
		},
		diagnose() {
			return store.diagnose();
		},
		bindEvidenceSnapshot(workflowId, repoDigest, files) {
			return store.bindEvidenceSnapshot(workflowId, repoDigest, files);
		},

		getTraceLinks(artifactRevisionId) {
			return store.getTraceLinks(artifactRevisionId);
		},
		isEvidenceStale(workflowId, currentRepoDigest) {
			return store.isEvidenceStale(workflowId, currentRepoDigest);
		},
	getEvidenceSnapshots(workflowId) {
		return store.getEvidenceSnapshots(workflowId);
	},
	getFindings(workflowId) {
		return store.getFindings(workflowId);
	},
	getFindingThreads(workflowId) {
		return store.getFindingThreads(workflowId);
	},
	acceptFindingRisk(workflowId, findingId, operator, reason) {
		return store.acceptFindingRisk(workflowId, findingId, operator, reason);
	},
	isFindingRiskAcceptanceStale(workflowId, findingId) {
		return store.isFindingRiskAcceptanceStale(workflowId, findingId);
	},
	getDecisions(workflowId) {
		return store.getDecisions(workflowId);
	},
	checkReadiness(workflowId) {
		return store.checkReadiness(workflowId);
	},
	buildApprovalPacket(workflowId) {
		return store.buildApprovalPacket(workflowId);
	},
	getApprovalPacket(workflowId) {
		return store.getApprovalPacket(workflowId);
	},
	getHumanGates(workflowId) {
		return store.getHumanGates(workflowId);
	},
	getApprovalRecords(workflowId) {
		return store.getApprovalRecords(workflowId);
	},
	getHumanDirectives(workflowId) {
		return store.getHumanDirectives(workflowId);
	},
	getDiagnosticRuns(workflowId) {
		return store.getDiagnosticRuns(workflowId);
	},
	listRequirementSummaries(workspaceId) {
		return store.listRequirementSummaries(workspaceId);
	},
	getRequirementDetail(requirementId) {
		return store.getRequirementDetail(requirementId);
	},
	getArtifactRevisionDetail(requirementId, kind) {
		return store.getArtifactRevisionDetail(requirementId, kind);
	},
	getBoundedProjection(workflowId) {
		return store.getBoundedProjection(workflowId);
	},
	getPlanRevisionDetail(planRevisionId) {
		return store.getPlanRevisionDetail(planRevisionId);
	},
	getTaskDetail(taskId) {
		return store.getTaskDetail(taskId);
	},
	listTaskAttempts(taskId) {
		return store.listTaskAttempts(taskId);
	},
	getAttemptDetail(attemptId) {
		return store.getAttemptDetail(attemptId);
	},
	getAttemptContext(attemptId) {
		return store.getAttemptContext(attemptId);
	},
	listPendingReviewedArtifacts(workflowId) {
		return store.listPendingReviewedArtifacts(workflowId);
	},
	getRunDetail(runId) {
		return store.getRunDetail(runId);
	},
	getApprovalPacketDetail(packetId) {
		return store.getApprovalPacketDetail(packetId);
	},
	getDesignPackage(designPackageId) {
		return store.getDesignPackage(designPackageId);
	},
	getLegacyImport(requirementId) {
		return store.getLegacyImport(requirementId);
	},
	createReusableAsset(input) {
		return store.createReusableAsset(input);
	},
	writeRelations(input) {
		return store.writeRelations(input);
	},
	readRelations(assetId) {
		return store.readRelations(assetId);
	},
	getWorkspaceAssetGraph(workspaceId) {
		return store.getWorkspaceAssetGraph(workspaceId);
	},
	assetExistsByOriginArtifactId(workspaceId, artifactId) {
		return store.assetExistsByOriginArtifactId(workspaceId, artifactId);
	},
	updateReusableAsset(input) {
		return store.updateReusableAsset(input);
	},
	listReusableAssets(workspaceId) {
		return store.listReusableAssets(workspaceId);
	},
	listReusableAssetPage(workspaceId, query) {
		return store.listReusableAssetPage(workspaceId, query);
	},
	getReusableAsset(assetId) {
		return store.getReusableAsset(assetId);
	},
	deleteReusableAsset(assetId) {
		return store.deleteReusableAsset(assetId);
	},
	exportReusableAssets(workspaceId) {
		return store.exportReusableAssets(workspaceId);
	},
	exportReusableAssetBundle(workspaceId) {
		return store.exportReusableAssetBundle(workspaceId);
	},
	importReusableAssetBundle(workspaceId, assets, relations, strict) {
		return store.importReusableAssetBundle(workspaceId, assets, relations, strict);
	},
	importReusableAssets(workspaceId, assets) {
		return store.importReusableAssets(workspaceId, assets);
	},
		searchWorkspaceContent(workspaceId, query) {
			return store.searchWorkspaceContent(workspaceId, query);
		},
		getFeedbackAssetReferences(workflowId, query, budget) {
			return store.getFeedbackAssetReferences(workflowId, query, budget);
		},
	promoteRequirementArtifacts(workflowId, kinds) {
		return store.promoteRequirementArtifacts(workflowId, kinds);
	},
		appendRunEvent(runId, type, payload) {
			return store.appendRunEvent(runId, type, payload);
		},
		runExists(runId) {
			return store.runExists(runId);
		},
		getRunEventWatermark(runId) {
			return store.getRunEventWatermark(runId);
		},
		getRunEvents(runId, after, limit) {
			return store.getRunEvents(runId, after, limit);
		},
		getWorkflowEventWatermark(workflowId) {
			return store.getWorkflowEventWatermark(workflowId);
		},
		getWorkflowEvents(workflowId, after, limit) {
			return store.getWorkflowEvents(workflowId, after, limit);
		},
		subscribeWorkflowEvents(listener) {
			return store.subscribeWorkflowEvents(listener);
		},
		subscribeRunEvents(listener) {
			return store.subscribeRunEvents(listener);
		},
		close() {
			store.close();
		},
	};
}
