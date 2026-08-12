import type { CrashInjector, FixtureClock, FixtureOperator, FixtureOutboxTransport, HashProvider } from "../testing/deterministic-fixtures.js";
import { WorkflowStore, type BeginPlanningResult, type CommandReceipt, type CompletePlanningResult, type ExecuteCommandInput, type ReconciliationReport, type WorkflowCommandType, type WorkflowProjection } from "../persistence/workflow-store.js";
import { loadWorkflowContracts } from "./contracts/loader.js";
import { compileWorkflowSchema, type WorkflowSchemaValidator } from "./contracts/schema.js";
import type { DoctorReport } from "./workflow-doctor.js";
import type { ModelDriver } from "./model-driver.js";
import { validatePlanProposal, type PlanValidationContext } from "./plan-validator.js";
import type { PlanProposal } from "./plan-types.js";
import type { RequirementBaseline } from "./requirement.js";

export type { RequirementBaseline } from "./requirement.js";
export type { CommandReceipt, ReconciliationReport, WorkflowCommandType, BeginPlanningResult, CompletePlanningResult } from "../persistence/workflow-store.js";
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
	beginPlanning(workflowId: number): BeginPlanningResult;
	completePlanning(workflowId: number, attemptId: number, structuredResult: unknown): CompletePlanningResult;
	planWorkflow(workflowId: number, modelDriver: ModelDriver): Promise<PlanWorkflowResult>;
	getPlanningContextDigest(workflowId: number): string;
	reconcile(): ReconciliationReport;
	processOutbox(): { delivered: number; exhausted: number; incidentsCreated: number };
	diagnose(): DoctorReport;
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
	const store = new WorkflowStore({ ...options, policyBundle });

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

	return {
		createWorkspace(input) {
			return store.createWorkspace(input);
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
			const validTypes: readonly WorkflowCommandType[] = ["start", "pause", "resume", "retry-recovery"];
			if (!validTypes.includes(input.type)) {
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
				const result = await modelDriver.execute(
					{ role: "orchestrator", contextDigest: begin.planningContextDigest, instruction: "Produce a complete PlanProposal DAG for the requirement." },
					[],
				);
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
		reconcile() {
			return store.reconcile();
		},
		processOutbox() {
			return store.processOutbox();
		},
		diagnose() {
			return store.diagnose();
		},
		close() {
			store.close();
		},
	};
}
