import type { ReusableAssetKind } from "../persistence/reusable-asset-kind.js";
import type { CrashInjector, FixtureClock, FixtureOperator, FixtureOutboxTransport, HashProvider } from "../testing/deterministic-fixtures.js";
import { WorkflowStore, type BeginPlanningResult, type CommandReceipt, type CompletePlanningResult, type ExecuteCommandInput, type ReconciliationReport, type WorkflowProjection, type EvidenceSnapshotResult, type RequiredArtifactSetResult, type TraceLinkResult, type FindingRecord, type FindingThreadRecord, type DecisionRecord, type ReadinessReport, type BuildApprovalPacketResult, type ApprovalPacketRecord, type HumanGateRecord, type ApprovalRecordEntry, type HumanDirectiveRecord, type DiagnosticRunRecord, type CommandReceiptDetail, type RequirementSummaryRecord, type RequirementDetailRecord, type BoundedWorkflowProjection, type PlanRevisionDetail, type TaskDetailRecord, type AttemptSummaryRecord, type AttemptDetailRecord, type RunDetailRecord, type ApprovalPacketDetailRecord, type DesignPackageRecord, type LegacyImportRecord, type ReusableAssetSummary, type ReusableAssetDetail, type WorkflowEventEnvelope, type WorkspaceSummary, type RunEventEnvelope } from "../persistence/workflow-store.js";
import type { BeginAttemptResult, CompleteAttemptResult, ExecuteTaskResult, RoleResult, TraceLinkProposal, CriticReport } from "./role-result.js";
import { WORKFLOW_COMMAND_TYPES, type WorkflowCommandType } from "./command-types.js";
import { loadWorkflowContracts } from "./contracts/loader.js";
import { compileWorkflowSchema, type WorkflowSchemaValidator } from "./contracts/schema.js";
import type { DoctorReport } from "./workflow-doctor.js";
import type { ModelDriver } from "./model-driver.js";
import { validatePlanProposal, type PlanValidationContext } from "./plan-validator.js";
import type { TaskRole } from "./plan-types.js";
import type { PlanProposal } from "./plan-types.js";
import type { RequirementBaseline } from "./requirement.js";
import type { ImpactProfile } from "./impact-profile.js";

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
	createRequirement(input: { workspaceId: number; baseline: RequirementBaseline }): {
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
	planWorkflow(workflowId: number, modelDriver: ModelDriver): Promise<PlanWorkflowResult>;
	getPlanningContextDigest(workflowId: number): string;
	beginAttempt(workflowId: number): BeginAttemptResult;
	completeAttempt(workflowId: number, attemptId: number, structuredResult: unknown): CompleteAttemptResult;
	executeTask(workflowId: number, modelDriver: ModelDriver): Promise<ExecuteTaskResult>;
	reconcile(): ReconciliationReport;
	processOutbox(): { delivered: number; exhausted: number; incidentsCreated: number };
	diagnose(): DoctorReport;
	bindEvidenceSnapshot(workflowId: number, repoDigest: string, files: unknown): EvidenceSnapshotResult;
	storeImpactProfile(workflowId: number, profile: ImpactProfile): unknown;
	getRequiredArtifactSet(workflowId: number): RequiredArtifactSetResult | undefined;
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
	getBoundedProjection(workflowId: number): BoundedWorkflowProjection | undefined;
	getPlanRevisionDetail(planRevisionId: number): PlanRevisionDetail | undefined;
	getTaskDetail(taskId: number): TaskDetailRecord | undefined;
	listTaskAttempts(taskId: number): readonly AttemptSummaryRecord[];
	getAttemptDetail(attemptId: number): AttemptDetailRecord | undefined;
	getRunDetail(runId: number): RunDetailRecord | undefined;
	getApprovalPacketDetail(packetId: number): ApprovalPacketDetailRecord | undefined;
	getDesignPackage(designPackageId: number): DesignPackageRecord | undefined;
	getLegacyImport(requirementId: number): LegacyImportRecord | undefined;
	createReusableAsset(input: { workspaceId: number; kind: ReusableAssetKind; title: string; content: unknown }): { assetId: number; revisionId: number; revisionNo: number };
	updateActorReusableAsset(assetId: number, patch: unknown): { revisionId: number; revisionNo: number } | undefined;
	listReusableAssets(workspaceId: number): readonly ReusableAssetSummary[];
	getReusableAsset(assetId: number): ReusableAssetDetail | undefined;
	deleteReusableAsset(assetId: number): boolean;
	exportReusableAssets(workspaceId: number): readonly ReusableAssetDetail[];
	importReusableAssets(workspaceId: number, assets: readonly { kind: ReusableAssetKind; title: string; content: unknown }[]): readonly number[];
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

	function completePlanningInternal(workflowId: number, attemptId: number, structuredResult: unknown): CompletePlanningResult {
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
		const validation = validatePlanProposal(structuredResult, context, planValidator);
		if (validation.valid) {
			return store.adoptPlan(workflowId, attemptId, structuredResult as PlanProposal);
		}
		return store.failPlanningAttempt(workflowId, attemptId, validation.ruleViolations);
	}

	function completeAttemptInternal(workflowId: number, attemptId: number, structuredResult: unknown): CompleteAttemptResult {
		return store.publishAttemptResult(workflowId, attemptId, structuredResult);
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
		async planWorkflow(workflowId, modelDriver) {
			for (let iteration = 0; iteration < 10; iteration += 1) {
				const begin = store.beginPlanning(workflowId);
				if (begin.taskId === 0) {
					return { outcome: "plan_budget_exhausted", planRevisionId: null, workflowVersion: begin.workflowVersion, lastEventSeq: begin.lastEventSeq };
				}
			store.appendRunEvent(begin.runId, "model_call_started", { role: "orchestrator", contextDigest: begin.planningContextDigest });
			let result;
			try {
				result = await modelDriver.execute(
					{ role: "orchestrator", contextDigest: begin.planningContextDigest, instruction: "Produce a complete PlanProposal DAG for the requirement." },
					[],
				);
			} catch (error) {
				store.appendRunEvent(begin.runId, "model_call_failed", { role: "orchestrator", error: error instanceof Error ? error.message : String(error) });
				throw error;
			}
			store.appendRunEvent(begin.runId, "model_tokens", { role: "orchestrator", inputTokens: result.modelUsage.inputTokens, outputTokens: result.modelUsage.outputTokens });
			store.appendRunEvent(begin.runId, "model_result", { role: "orchestrator", produced: "plan-proposal/v1" });
			const complete = completePlanningInternal(workflowId, begin.attemptId, result.structuredResult);
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
			for (let iteration = 0; iteration < 10; iteration += 1) {
				const begin = store.beginAttempt(workflowId);
				if (begin.taskId === 0) {
					return { outcome: "no_ready_task", workflowVersion: begin.workflowVersion, lastEventSeq: begin.lastEventSeq };
				}
			store.appendRunEvent(begin.runId, "model_call_started", { role: begin.taskRole, contextDigest: begin.contextDigest });
			let result;
			try {
				result = await modelDriver.execute(
					{ role: begin.taskRole as TaskRole, contextDigest: begin.contextDigest, instruction: "Produce the required output." },
					[],
				);
			} catch (error) {
				store.appendRunEvent(begin.runId, "model_call_failed", { role: begin.taskRole, error: error instanceof Error ? error.message : String(error) });
				throw error;
			}
			store.appendRunEvent(begin.runId, "model_tokens", { role: begin.taskRole, inputTokens: result.modelUsage.inputTokens, outputTokens: result.modelUsage.outputTokens });
			store.appendRunEvent(begin.runId, "model_result", { role: begin.taskRole, produced: "role-result/v1" });
			const complete = completeAttemptInternal(workflowId, begin.attemptId, result.structuredResult);
				if (complete.outcome === "published") {
					return { outcome: "published", workflowVersion: complete.workflowVersion, lastEventSeq: complete.lastEventSeq };
				}
				if (complete.outcome === "task_exhausted") {
					return { outcome: "task_exhausted", workflowVersion: complete.workflowVersion, lastEventSeq: complete.lastEventSeq };
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
		storeImpactProfile(workflowId, profile) {
			return store.storeImpactProfile(workflowId, profile);
		},
		getRequiredArtifactSet(workflowId) {
			return store.getRequiredArtifactSet(workflowId);
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
	updateActorReusableAsset(assetId, patch) {
		return store.updateActorReusableAsset(assetId, patch);
	},
	listReusableAssets(workspaceId) {
		return store.listReusableAssets(workspaceId);
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
	importReusableAssets(workspaceId, assets) {
		return store.importReusableAssets(workspaceId, assets);
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
