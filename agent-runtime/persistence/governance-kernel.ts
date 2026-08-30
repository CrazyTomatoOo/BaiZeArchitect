import Database from "better-sqlite3";
import { PLAN_TASK_LIMITS, type ArtifactKind, type PlanProposal, type TaskProposal, type WritableArtifactKind, ARTIFACT_OWNERSHIP, type InputBinding, type TaskOutputInput } from "../workflow/plan-types.js";
import { validatePlanProposal } from "../workflow/plan-validator.js";
import type { RequirementBaseline } from "../workflow/requirement.js";
import type { WorkflowCommandType } from "../workflow/command-types.js";
import type { RoleResult, ContextManifest, RoleContract, BeginAttemptResult, CompleteAttemptResult, TraceLinkProposal, CriticReport, FindingProposal, FindingSeverity, AssetReference } from "../workflow/role-result.js";
import type { ModelRolesOverride } from "../workflow/model-driver.js";
import type { ReusableAssetKind } from "./reusable-asset-kind.js";
import { parseJson } from "./json.js";
import { AssetStore } from "./asset-store.js";
import { ProjectionReadModel } from "./projection-read-model.js";
import { SnapshotStore } from "./snapshot-store.js";
import type { SnapshotDocument } from "./snapshot-store.js";
import type { AssetRelationInput } from "./asset-relations.js";
import type {
	WorkflowStoreOptions,
	CommandOutcome,
	ReconciliationReport,
	OutboxDrainResult,
	BeginPlanningResult,
	CompletePlanningResult,
	CompletePlanningOutcome,
	CommandReceipt,
	ExecuteCommandInput,
	BuildApprovalPacketResult,
	WorkflowProjection,
	EvidenceSnapshotResult,
	TraceLinkResult,
	FindingRecord,
	FindingThreadRecord,
	DecisionRecord,
	ReadinessReport,
	ApprovalPacketRecord,
	HumanGateRecord,
	ApprovalRecordEntry,
	HumanDirectiveRecord,
	DiagnosticRunRecord,
	RunEventEnvelope,
	WorkflowEventEnvelope,
} from "./workflow-store.js";

const ALL_PROMOTABLE_ASSET_KINDS = ["design", "architecture", "data", "api", "scenario", "usecase", "function"] as const;

const MAX_DELIVERY_FAILURES = 5;
const BACKOFF_SECONDS = [1, 2, 5, 15, 30] as const;
const RECOVERABLE_INCIDENT_TYPES = ["outbox_exhausted", "recoverable_reconciliation_failure"] as const;

interface CommandTransition {
	readonly from: string;
	readonly to: string;
	readonly eventType: string;
}

const COMMAND_TRANSITIONS: Record<WorkflowCommandType, readonly CommandTransition[]> = {
	start: [{ from: "pending", to: "running", eventType: "workflow_started" }],
	pause: [
		{ from: "running", to: "paused", eventType: "workflow_paused" },
		{ from: "waiting_for_human", to: "paused", eventType: "workflow_paused" },
		{ from: "ready_to_archive", to: "paused", eventType: "workflow_paused" },
	],
	resume: [{ from: "paused", to: "running", eventType: "workflow_resumed" }],
	"retry-recovery": [{ from: "failed", to: "running", eventType: "recovery_retried" }],
	"cancel-run": [{ from: "running", to: "paused", eventType: "workflow_cancel_run" }],
	"dispose-decision": [
		{ from: "running", to: "running", eventType: "decision_disposed" },
		{ from: "waiting_for_human", to: "running", eventType: "decision_disposed" },
	],
	steer: [
		{ from: "running", to: "running", eventType: "human_directive_recorded" },
		{ from: "paused", to: "paused", eventType: "human_directive_recorded" },
		{ from: "waiting_for_human", to: "waiting_for_human", eventType: "human_directive_recorded" },
	],
	"retry-task": [{ from: "failed", to: "running", eventType: "task_retried" }],
	"retry-planning": [{ from: "failed", to: "running", eventType: "planning_retried" }],
	"replace-plan": [
		{ from: "running", to: "running", eventType: "plan_replaced" },
		{ from: "waiting_for_human", to: "waiting_for_human", eventType: "plan_replaced" },
	],
	"diagnostic-run": [
		{ from: "running", to: "running", eventType: "diagnostic_run_completed" },
		{ from: "paused", to: "paused", eventType: "diagnostic_run_completed" },
		{ from: "waiting_for_human", to: "waiting_for_human", eventType: "diagnostic_run_completed" },
		{ from: "failed", to: "failed", eventType: "diagnostic_run_completed" },
	],
	"provide-human-input": [
		{ from: "waiting_for_human", to: "running", eventType: "human_input_provided" },
	],
	"revise-requirement": [
		{ from: "running", to: "running", eventType: "requirement_revised" },
		{ from: "paused", to: "paused", eventType: "requirement_revised" },
		{ from: "waiting_for_human", to: "waiting_for_human", eventType: "requirement_revised" },
	],
	"approve-artifact": [
		{ from: "running", to: "running", eventType: "artifact_revision_approved" },
		{ from: "waiting_for_human", to: "waiting_for_human", eventType: "artifact_revision_approved" },
		{ from: "paused", to: "paused", eventType: "artifact_revision_approved" },
	],
	"reject-artifact": [
		{ from: "running", to: "running", eventType: "artifact_revision_rejected" },
		{ from: "waiting_for_human", to: "waiting_for_human", eventType: "artifact_revision_rejected" },
		{ from: "paused", to: "paused", eventType: "artifact_revision_rejected" },
	],
	"accept-finding-risk": [
		{ from: "waiting_for_human", to: "running", eventType: "finding_risk_accepted" },
		{ from: "running", to: "running", eventType: "finding_risk_accepted" },
	],
	"revoke-approval": [
		{ from: "running", to: "running", eventType: "approval_revoked" },
		{ from: "waiting_for_human", to: "waiting_for_human", eventType: "approval_revoked" },
		{ from: "paused", to: "paused", eventType: "approval_revoked" },
		{ from: "archived", to: "archived", eventType: "approval_revoked" },
	],
	"approve-packet": [{ from: "ready_to_archive", to: "archived", eventType: "workflow_archived" }],
	"reject-packet": [{ from: "ready_to_archive", to: "running", eventType: "packet_rejected" }],
};

const COMMAND_CAPABILITIES: Record<WorkflowCommandType, string> = {
	start: "workflow:operate",
	pause: "workflow:operate",
	resume: "workflow:operate",
	"retry-recovery": "workflow:operate",
	"cancel-run": "workflow:operate",
	steer: "workflow:operate",
	"retry-task": "workflow:operate",
	"retry-planning": "workflow:operate",
	"replace-plan": "workflow:operate",
	"diagnostic-run": "workflow:operate",
	"provide-human-input": "workflow:operate",
	"revise-requirement": "workflow:operate",
	"dispose-decision": "workflow:approve",
	"approve-artifact": "workflow:approve",
	"reject-artifact": "workflow:approve",
	"accept-finding-risk": "workflow:approve",
	"revoke-approval": "workflow:approve",
	"approve-packet": "workflow:approve",
	"reject-packet": "workflow:approve",
};

export interface GovernanceKernel {
	executeCommand(input: ExecuteCommandInput): CommandReceipt;
	beginPlanning(workflowId: number): BeginPlanningResult;
	adoptPlan(workflowId: number, attemptId: number, proposal: PlanProposal): CompletePlanningResult;
	adoptReworkPlan(workflowId: number, tasks: readonly TaskProposal[]): number | null;
	failPlanningAttempt(workflowId: number, attemptId: number, violations: unknown): CompletePlanningResult;
	supersedePlanningAttempt(workflowId: number, attemptId: number, reason: string): CompletePlanningResult;
	beginAttempt(workflowId: number): BeginAttemptResult;
	publishAttemptResult(workflowId: number, attemptId: number, structuredResult: unknown): CompleteAttemptResult;
	failAttempt(workflowId: number, attemptId: number, failureCode: string, failureDetail: string): CompleteAttemptResult;
	acceptFindingRisk(workflowId: number, findingId: number, operator: string, reason: string): void;
	buildApprovalPacket(workflowId: number): BuildApprovalPacketResult;
	appendRunEvent(runId: number, type: string, payload: Record<string, unknown>): number;
	drainOutbox(): OutboxDrainResult;
	processOutbox(): OutboxDrainResult;
	reconcile(): ReconciliationReport;
	promoteRequirementArtifacts(
		workflowId: number,
		kinds: readonly string[],
		options?: { skipAlreadyPromoted?: boolean; originApprovalId?: number | null },
	): Record<string, number>;
}


const REWORK_ROLE_BY_KIND: Readonly<Record<string, string>> = {
	analysis: "analysis-analyst",
	scenario: "scenario-analyst",
	usecase: "usecase-analyst",
	function: "function-analyst",
	design: "design-architect",
	architecture: "architecture-architect",
	data: "data-architect",
	api: "api-architect",
};

const TEMPLATE_REQUIRED_KINDS: readonly string[] = [
	"requirement", "analysis", "scenario", "usecase", "function", "design", "architecture", "data", "api",
];

/** #24 回授注入预算：单次注入最多引用条数（检索按 bm25 相关性截断）。 */
export const FEEDBACK_REFERENCE_BUDGET = 3;

export class GovernanceKernelImpl implements GovernanceKernel {
	private readonly database: Database.Database;
	private readonly snapshotStore: SnapshotStore;
	private readonly assetStore: AssetStore;
	private readonly readModel: ProjectionReadModel;
	private readonly options: WorkflowStoreOptions;
	private readonly executeCommandTransaction: (input: ExecuteCommandInput) => CommandReceipt;

	constructor(
		database: Database.Database,
		options: WorkflowStoreOptions,
		snapshotStore: SnapshotStore,
		readModel: ProjectionReadModel,
		assetStore: AssetStore,
	) {
		this.database = database;
		this.options = options;
		this.snapshotStore = snapshotStore;
		this.readModel = readModel;
		this.assetStore = assetStore;
		this.executeCommandTransaction = this.database.transaction((input) =>
			this.executeCommandRows(input),
		).immediate;
	}

	executeCommand(input: ExecuteCommandInput): CommandReceipt {
		const receipt = this.executeCommandTransaction(input);
		this.options.crashInjector.reach("drain_outbox.before");
		this.drainOutbox();
		return receipt;
}

	private executeCommandRows(input: ExecuteCommandInput): CommandReceipt {
		const timestamp = this.options.clock.now().toISOString();
		const requestDigest = this.options.hashProvider.digest({
			schemaVersion: "workflow-command/v1",
			expectedWorkflowVersion: input.expectedWorkflowVersion,
			type: input.type,
			payload: input.payload ?? {},
			...(input.reason !== undefined ? { reason: input.reason } : {}),
		});
		const existing = this.database
			.prepare("select request_digest, outcome, http_status, workflow_version, last_event_seq, created_at from command_receipts where command_id = ?")
			.get(input.commandId) as { request_digest: string; outcome: string; http_status: number; workflow_version: number; last_event_seq: number; created_at: string } | undefined;
		if (existing) {
			if (existing.request_digest === requestDigest) {
				return {
					commandId: input.commandId,
					workflowId: input.workflowId,
					commandType: input.type,
					outcome: existing.outcome as CommandOutcome,
					httpStatus: existing.http_status,
					workflowVersion: existing.workflow_version,
					lastEventSeq: existing.last_event_seq,
					createdAt: existing.created_at,
				};
			}
		const conflictVersion = this.currentWorkflowVersion(input.workflowId);
		const seq = this.appendEvent(input.workflowId, "command_idempotency_conflict", conflictVersion, "workflow_command", input.workflowId, 0, { conflictingDigest: requestDigest }, timestamp, undefined, input.commandId);
			this.options.crashInjector.reach("execute_command.before_commit");
			return {
				commandId: input.commandId,
				workflowId: input.workflowId,
				commandType: input.type,
				outcome: "idempotency_conflict",
				httpStatus: 409,
				workflowVersion: this.currentWorkflowVersion(input.workflowId),
				lastEventSeq: seq,
				createdAt: timestamp,
			};
		}
		const workflow = this.database
			.prepare("select state, version, last_event_seq, current_failure_code, current_plan_revision_id, current_approval_packet_id, requirement_id from workflows where id = ?")
			.get(input.workflowId) as { state: string; version: number; last_event_seq: number; current_failure_code: string | null; current_plan_revision_id: number | null; current_approval_packet_id: number | null; requirement_id: number };
		let archiveApprovalId: number | null = null;
		const actorSnapshot = this.snapshotStore.insertSnapshot(
			"actor_snapshot",
			"actor/v1",
			{ actorRef: input.operator.actorRef, capabilities: input.operator.capabilities },
			timestamp,
		);
		const capability = COMMAND_CAPABILITIES[input.type];
		if (!input.operator.capabilities.includes(capability)) {
			return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "capability_denied", 403);
		}
		if (workflow.version !== input.expectedWorkflowVersion) {
			return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "version_conflict", 409);
		}
		const transitions = COMMAND_TRANSITIONS[input.type];
		const transition = transitions.find((t) => t.from === workflow.state);
		if (!transition) {
			return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "state_conflict", 409);
		}
		let toState = transition.to;
		if (input.type === "retry-recovery") {
			const incidentId = input.payload?.incidentId;
			if (typeof incidentId !== "number") {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const incident = this.database
				.prepare("select incident_type, status, subject_id from workflow_incidents where id = ? and workflow_id = ?")
				.get(incidentId, input.workflowId) as { incident_type: string; status: string; subject_id: number } | undefined;
			if (
				!incident
				|| !RECOVERABLE_INCIDENT_TYPES.includes(incident.incident_type as (typeof RECOVERABLE_INCIDENT_TYPES)[number])
				|| incident.status !== "open"
			) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			this.database
				.prepare("update outbox_jobs set delivery_failures = 0, next_attempt_at = null where id = ? and workflow_id = ?")
				.run(incident.subject_id, input.workflowId);
			this.database
				.prepare("update workflow_incidents set status = 'resolved', resolved_at = ? where id = ?")
				.run(timestamp, incidentId);
		}
		if (input.type === "cancel-run") {
			const activeClaim = this.database
				.prepare("select attempt_id from governance_claims where workflow_id = ? and status = 'active'")
				.get(input.workflowId) as { attempt_id: number } | undefined;
			if (activeClaim) {
				const runId = (this.database.prepare("select id from runs where attempt_id = ? order by id desc limit 1").get(activeClaim.attempt_id) as { id: number }).id;
				this.database.prepare("update task_attempts set status = 'cancelled', completed_at = ? where id = ?").run(timestamp, activeClaim.attempt_id);
				this.database.prepare("update runs set status = 'cancelled', completed_at = ? where id = ?").run(timestamp, runId);
				this.database.prepare("update governance_claims set status = 'released', released_at = ? where attempt_id = ? and status = 'active'").run(timestamp, activeClaim.attempt_id);
				this.appendEvent(input.workflowId, "attempt_cancelled", workflow.version, "task_attempt", activeClaim.attempt_id, 0, { attemptId: activeClaim.attempt_id }, timestamp, actorSnapshot.id, input.commandId);
				this.appendEvent(input.workflowId, "run_cancelled", workflow.version, "run", runId, 0, { attemptId: activeClaim.attempt_id }, timestamp, actorSnapshot.id, input.commandId);
			}
		}
		if (input.type === "dispose-decision") {
			const decisionId = input.payload?.decisionId;
			const disposition = input.payload?.status;
			if (typeof decisionId !== "number" || typeof disposition !== "string") {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const decision = this.database
				.prepare("select id, severity, status, summary from decisions where id = ? and workflow_id = ?")
				.get(decisionId, input.workflowId) as { id: number; severity: string; status: string; summary: string } | undefined;
			if (!decision || decision.status !== "open") {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const validDispositions = ["accepted", "rejected", "deferred"];
			if (!validDispositions.includes(disposition)) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			if ((decision.severity === "critical" || decision.severity === "major") && disposition === "deferred") {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			if (disposition === "deferred") {
				const reason = input.payload?.reason;
				const owner = input.payload?.owner;
				const followUpTarget = input.payload?.followUpTarget;
				if (typeof reason !== "string" || typeof owner !== "string" || typeof followUpTarget !== "string") {
					return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
				}
				this.database
					.prepare("update decisions set status = 'deferred', reason = ?, owner = ?, follow_up_target = ?, disposed_at = ? where id = ?")
					.run(reason, owner, followUpTarget, timestamp, decisionId);
			} else {
				this.database
					.prepare("update decisions set status = ?, disposed_at = ? where id = ?")
					.run(disposition, timestamp, decisionId);
			}
		}
		if (input.type === "steer") {
			const directive = input.payload?.directive;
			if (typeof directive !== "string" || directive.length === 0) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			this.database
				.prepare("insert into human_directives(workflow_id, directive_text, actor_snapshot_document_id, command_id, created_at) values (?, ?, ?, ?, ?)")
				.run(input.workflowId, directive, actorSnapshot.id, input.commandId, timestamp);
		}
		if (input.type === "retry-task") {
			const taskId = input.payload?.taskId;
			if (typeof taskId !== "number" || workflow.current_failure_code !== "task_budget_exhausted") {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const task = this.database
				.prepare("select id, status, kind from tasks where id = ? and workflow_id = ?")
				.get(taskId, input.workflowId) as { id: number; status: string; kind: string } | undefined;
			if (!task || task.kind === "plan" || task.status !== "failed") {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			this.database.prepare("update tasks set status = 'pending' where id = ?").run(taskId);
			this.database.prepare("update workflows set current_failure_code = null where id = ?").run(input.workflowId);
		}
		if (input.type === "retry-planning") {
			if (workflow.current_failure_code !== "planning_exhausted" && workflow.current_failure_code !== "plan_budget_exhausted") {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			this.database.prepare("update workflows set current_failure_code = null where id = ?").run(input.workflowId);
		}
		if (input.type === "replace-plan") {
			const proposal = input.payload?.proposal;
			if (!this.options.planValidator || !this.options.planValidator.check(proposal)) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const validation = validatePlanProposal(proposal, {
				workflowId: input.workflowId,
				workflowVersion: workflow.version,
				planningContextDigest: this.computePlanningContextDigest(input.workflowId),
				basePlanRevisionId: workflow.current_plan_revision_id,
			}, this.options.planValidator);
			if (!validation.valid) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			this.adoptReplacementPlanRows(input.workflowId, workflow, proposal as PlanProposal, timestamp);
		}
		if (input.type === "diagnostic-run") {
			const purpose = input.payload?.purpose;
			if (typeof purpose !== "string" || purpose.length === 0) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			this.database
				.prepare("insert into diagnostic_runs(workflow_id, purpose, status, actor_snapshot_document_id, command_id, created_at) values (?, ?, 'completed', ?, ?, ?)")
				.run(input.workflowId, purpose, actorSnapshot.id, input.commandId, timestamp);
		}
		if (input.type === "provide-human-input") {
			const gateId = input.payload?.gateId;
			const humanInput = input.payload?.input;
			if (typeof gateId !== "number" || humanInput === undefined) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const gate = this.database
				.prepare("select id, gate_type, subject_id, status from human_gates where id = ? and workflow_id = ?")
				.get(gateId, input.workflowId) as { id: number; gate_type: string; subject_id: number; status: string } | undefined;
			if (!gate || gate.status !== "open") {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			this.database
				.prepare("update human_gates set status = 'resolved', resolution_json = ?, resolved_at = ? where id = ?")
				.run(JSON.stringify({ input: humanInput }), timestamp, gateId);
			if (gate.gate_type === "human_input") {
				this.database
					.prepare("update tasks set status = 'pending' where id = (select task_id from task_attempts where id = ?) and status = 'blocked'")
					.run(gate.subject_id);
			}
			if (this.openGateCount(input.workflowId) > 0) {
				toState = "waiting_for_human";
			}
		}
		if (input.type === "revise-requirement") {
			const baseline = input.payload?.baseline;
			if (!this.options.artifactValidator || !this.options.artifactValidator.check(baseline)) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			this.reviseRequirementRows(input.workflowId, workflow.requirement_id, baseline as RequirementBaseline, actorSnapshot.id, input.commandId, timestamp);
		}
		if (input.type === "approve-artifact" || input.type === "reject-artifact") {
			const artifactId = input.payload?.artifactId;
			const revisionId = input.payload?.revisionId;
			const reason = input.payload?.reason;
			if (typeof artifactId !== "number" || typeof revisionId !== "number") {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			if (input.type === "reject-artifact" && (typeof reason !== "string" || reason.length === 0)) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const artifact = this.database
				.prepare("select id, current_revision_id from artifacts where id = ? and requirement_id = ?")
				.get(artifactId, workflow.requirement_id) as { id: number; current_revision_id: number | null } | undefined;
			const revision = artifact
				? this.database
						.prepare("select id, status, content_digest from artifact_revisions where id = ? and artifact_id = ?")
						.get(revisionId, artifactId) as { id: number; status: string; content_digest: string } | undefined
				: undefined;
			const latest = artifact
				? this.database
						.prepare("select id from artifact_revisions where artifact_id = ? order by id desc limit 1")
						.get(artifactId) as { id: number } | undefined
				: undefined;
			if (!artifact || !revision || revision.status !== "pending" || !latest || latest.id !== revisionId) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			if (input.type === "approve-artifact") {
				// 双闸前置校验（#13 决议）：环节尾 review 已完成（coverage 覆盖该 revision）且无 open critical/major finding
				// coverage 必须来自已完成的本环节尾 review Task（kind=review role=critic）；verify 等其他 critic 任务不顶替
				const covered = this.database
					.prepare(`select count(*) as count from critic_coverage_targets target
						join task_attempts attempt on attempt.id = target.task_attempt_id
						join tasks task on task.id = attempt.task_id
						where target.workflow_id = ? and target.revision_id = ?
						and task.kind = 'review' and task.role = 'critic' and task.status = 'completed' and attempt.status = 'succeeded'`)
					.get(input.workflowId, revisionId) as { count: number };
				const openFindings = this.database
					.prepare("select count(*) as count from findings where workflow_id = ? and target_revision_id = ? and status = 'open' and severity in ('critical','major')")
					.get(input.workflowId, revisionId) as { count: number };
				if (covered.count === 0 || openFindings.count > 0) {
					return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
				}
			}
			const newStatus = input.type === "approve-artifact" ? "approved" : "rejected";
			this.database.prepare("update artifact_revisions set status = ? where id = ?").run(newStatus, revisionId);
			if (input.type === "approve-artifact") {
				this.database.prepare("update artifacts set current_revision_id = ? where id = ?").run(revisionId, artifactId);
			}
			this.database
				.prepare("insert into approval_records(workflow_id, record_type, subject_type, subject_id, subject_digest, reason, targets_json, actor_snapshot_document_id, command_id, created_at) values (?, ?, 'artifact_revision', ?, ?, ?, null, ?, ?, ?)")
				.run(input.workflowId, input.type === "approve-artifact" ? "artifact_approval" : "artifact_rejection", revisionId, revision.content_digest, typeof reason === "string" ? reason : null, actorSnapshot.id, input.commandId, timestamp);
			// #21 返工闭环：批准的返工产物若来自 rework 计划，恢复 base（原模板）计划活性
			if (input.type === "approve-artifact") {
				this.restoreBasePlanAfterRework(input.workflowId, revisionId);
			}
			// #21 引擎自动返工：reject 后生成新 PlanRevision（rework Task 同 kind + 环节尾 review Task）；预算耗尽升门禁
			if (input.type === "reject-artifact") {
				const kind = (this.database.prepare("select kind from artifacts where id = ?").get(artifactId) as { kind: string }).kind;
				const escalated = this.scheduleRework(input.workflowId, kind, artifactId, revisionId, typeof reason === "string" ? reason : "", actorSnapshot.id, input.commandId, timestamp);
				if (escalated) toState = "waiting_for_human";
			}
		}
		if (input.type === "accept-finding-risk") {
			const findingId = input.payload?.findingId;
			const targetRevisionId = input.payload?.targetRevisionId;
			const impact = input.payload?.impact;
			const reason = input.payload?.reason;
			if (typeof findingId !== "number" || typeof targetRevisionId !== "number" || typeof impact !== "string" || impact.length === 0 || typeof reason !== "string" || reason.length === 0) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const finding = this.database
				.prepare("select id, severity, status, thread_id, target_revision_id, fingerprint from findings where id = ? and workflow_id = ?")
				.get(findingId, input.workflowId) as { id: number; severity: string; status: string; thread_id: number; target_revision_id: number; fingerprint: string } | undefined;
			if (!finding || finding.status !== "open" || finding.severity !== "major" || finding.target_revision_id !== targetRevisionId) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			this.database
				.prepare("update findings set status = 'risk_accepted', risk_accepted_by = ?, risk_acceptance_reason = ?, resolved_at = ? where id = ?")
				.run(input.operator.actorRef, reason, timestamp, findingId);
			this.database.prepare("update finding_threads set status = 'risk_accepted', updated_at = ? where id = ?").run(timestamp, finding.thread_id);
			this.database
				.prepare("update human_gates set status = 'resolved', resolution_json = ?, resolved_at = ? where workflow_id = ? and gate_type = 'finding_disposition' and subject_id = ? and status = 'open'")
				.run(JSON.stringify({ findingId, impact, reason }), timestamp, input.workflowId, finding.thread_id);
			this.database
				.prepare("insert into approval_records(workflow_id, record_type, subject_type, subject_id, subject_digest, reason, targets_json, actor_snapshot_document_id, command_id, created_at) values (?, 'finding_risk_acceptance', 'finding', ?, ?, ?, ?, ?, ?, ?)")
				.run(input.workflowId, findingId, finding.fingerprint, reason, JSON.stringify({ impact, targetRevisionId }), actorSnapshot.id, input.commandId, timestamp);
			if (workflow.state === "waiting_for_human" && this.openGateCount(input.workflowId) > 0) {
				toState = "waiting_for_human";
			}
		}
		if (input.type === "revoke-approval") {
			const approvalRecordId = input.payload?.approvalRecordId;
			if (typeof approvalRecordId !== "number") {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const record = this.database
				.prepare("select id, record_type, subject_id, subject_type from approval_records where id = ? and workflow_id = ?")
				.get(approvalRecordId, input.workflowId) as { id: number; record_type: string; subject_id: number; subject_type: string } | undefined;
			if (!record || (record.record_type !== "packet_approval" && record.record_type !== "artifact_approval")) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			// 撤销 artifact_approval：产物 revision 回 pending（返工路径 #21）。幂等：重复撤销不再 reject；
			// 防 stale：仅当该 revision 当前处于 approved 且本次撤销的正是当前 active approval 才回退——
			// 若 revision 已被重新批准（新 approval record），旧 record revocation 只留痕不动状态。
			if (record.record_type === "artifact_approval" && record.subject_type === "artifact_revision") {
				const current = this.database
					.prepare("select ar.status as status, (select max(relevant.id) from approval_records relevant where relevant.workflow_id = ? and relevant.subject_type = 'artifact_revision' and relevant.subject_id = ar.id and relevant.record_type = 'artifact_approval') as latest_approval_id from artifact_revisions ar where ar.id = ?")
					.get(input.workflowId, record.subject_id) as { status: string; latest_approval_id: number | null } | undefined;
				if (current && current.status === "approved" && current.latest_approval_id === approvalRecordId) {
					this.database.prepare("update artifact_revisions set status = 'pending' where id = ?").run(record.subject_id);
				}
			}
			const reason = typeof input.payload?.reason === "string" ? input.payload.reason : null;
			this.database
				.prepare("insert into approval_records(workflow_id, record_type, subject_type, subject_id, subject_digest, reason, targets_json, actor_snapshot_document_id, command_id, created_at) values (?, 'approval_revocation', 'approval_record', ?, null, ?, null, ?, ?, ?)")
				.run(input.workflowId, approvalRecordId, reason, actorSnapshot.id, input.commandId, timestamp);
		}
		if (input.type === "approve-packet") {
			const packetDigest = input.payload?.packetDigest;
			if (typeof packetDigest !== "string" || workflow.current_approval_packet_id === null) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const packet = this.database
				.prepare("select id, digest, content_json, status from approval_packets where id = ? and workflow_id = ?")
				.get(workflow.current_approval_packet_id, input.workflowId) as { id: number; digest: string; content_json: string; status: string } | undefined;
			if (!packet || packet.status !== "current" || packet.digest !== packetDigest) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const readiness = this.readModel.checkReadiness(input.workflowId);
			if (!readiness.ready) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const content = parseJson<{ artifacts?: ReadonlyArray<{ revisionId: number; status: string }> }>(packet.content_json);
			for (const artifact of content.artifacts ?? []) {
				if (artifact.status !== "pending") continue;
				// 逐环节门禁不可绕过：曾被撤销的 artifact_approval 不能经包审批重新批准
				const revoked = this.database
					.prepare("select count(*) as count from approval_records revocation where revocation.workflow_id = ? and revocation.record_type = 'approval_revocation' and revocation.subject_type = 'approval_record' and exists (select 1 from approval_records original where original.id = revocation.subject_id and original.record_type = 'artifact_approval' and original.subject_id = ?)")
					.get(input.workflowId, artifact.revisionId) as { count: number };
				if (revoked.count > 0) {
					return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
				}
				this.database.prepare("update artifact_revisions set status = 'approved' where id = ?").run(artifact.revisionId);
			}
			this.database
				.prepare("update design_sessions set status = 'archived', archived_at = ?, updated_at = ? where requirement_id = ?")
				.run(timestamp, timestamp, workflow.requirement_id);
			const packetSnapshot = this.snapshotStore.insertSnapshot("approval_packet", "approval-packet/v1", parseJson<unknown>(packet.content_json), timestamp);
			const approvalRecordId = Number(this.database
				.prepare("insert into approval_records(workflow_id, record_type, subject_type, subject_id, subject_digest, reason, targets_json, actor_snapshot_document_id, command_id, created_at) values (?, 'packet_approval', 'approval_packet', ?, ?, null, null, ?, ?, ?)")
				.run(input.workflowId, packet.id, packet.digest, actorSnapshot.id, input.commandId, timestamp).lastInsertRowid);
			archiveApprovalId = approvalRecordId;
			this.database
				.prepare("insert into design_packages(requirement_id, workspace_id, document_id, digest, approval_packet_id, approval_id, migration_attestation_document_id, archive_class, archived_at) values (?, ?, ?, ?, ?, ?, null, 'governed', ?)")
				.run(workflow.requirement_id, (this.database.prepare("select workspace_id from requirements where id = ?").get(workflow.requirement_id) as { workspace_id: number }).workspace_id, packetSnapshot.id, packet.digest, packet.id, approvalRecordId, timestamp);
			this.appendEvent(input.workflowId, "packet_approved", workflow.version + 1, "approval_packet", packet.id, 0, { digest: packet.digest }, timestamp, actorSnapshot.id, input.commandId);
		}
		if (input.type === "reject-packet") {
			const reason = input.payload?.reason;
			const targets = input.payload?.targets;
			if (typeof reason !== "string" || reason.length === 0 || !Array.isArray(targets) || targets.length === 0) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			if (workflow.current_approval_packet_id === null) {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			const packet = this.database
				.prepare("select id, digest, status from approval_packets where id = ? and workflow_id = ?")
				.get(workflow.current_approval_packet_id, input.workflowId) as { id: number; digest: string; status: string } | undefined;
			if (!packet || packet.status !== "current") {
				return this.persistRejection(input, timestamp, requestDigest, workflow, actorSnapshot.id, "business_rule_rejected", 422);
			}
			this.database.prepare("update approval_packets set status = 'rejected' where id = ?").run(packet.id);
			this.database.prepare("update workflows set current_approval_packet_id = null where id = ?").run(input.workflowId);
			this.database
				.prepare("insert into approval_records(workflow_id, record_type, subject_type, subject_id, subject_digest, reason, targets_json, actor_snapshot_document_id, command_id, created_at) values (?, 'packet_rejection', 'approval_packet', ?, ?, ?, ?, ?, ?, ?)")
				.run(input.workflowId, packet.id, packet.digest, reason, JSON.stringify(targets), actorSnapshot.id, input.commandId, timestamp);
		}
		const newVersion = workflow.version + 1;
	this.database
		.prepare("update workflows set state = ?, version = ?, consecutive_plan_revisions = 0, updated_at = ? where id = ?")
		.run(toState, newVersion, timestamp, input.workflowId);
		if (input.type === "approve-packet") {
			this.promoteRequirementArtifacts(input.workflowId, ALL_PROMOTABLE_ASSET_KINDS, {
				skipAlreadyPromoted: true,
				originApprovalId: archiveApprovalId,
			});
		}
		const eventPayload = input.type === "revoke-approval" && typeof input.payload?.approvalRecordId === "number"
		? (() => {
				const revoked = this.database
					.prepare("select subject_type, subject_id from approval_records where id = ? and workflow_id = ?")
					.get(input.payload.approvalRecordId as number, input.workflowId) as { subject_type: string; subject_id: number } | undefined;
				return { ...(input.payload ?? {}), revokedSubjectType: revoked?.subject_type ?? null, revokedSubjectId: revoked?.subject_id ?? null };
			})()
		: (input.payload ?? {});
	const seq = this.appendEvent(input.workflowId, transition.eventType, newVersion, "workflow", input.workflowId, newVersion, eventPayload, timestamp, actorSnapshot.id, input.commandId);
		if (input.type !== "retry-recovery") {
			this.database
				.prepare("insert into outbox_jobs(workflow_id, event_seq, delivery_type, payload, created_at) values (?, ?, 'workflow_event', ?, ?)")
				.run(input.workflowId, seq, transition.eventType, timestamp);
		}
		const receipt: CommandReceipt = {
			commandId: input.commandId,
			workflowId: input.workflowId,
			commandType: input.type,
			outcome: "accepted",
			httpStatus: 201,
			workflowVersion: newVersion,
			lastEventSeq: seq,
			createdAt: timestamp,
		};
		this.database
			.prepare("insert into command_receipts(command_id, workflow_id, request_digest, command_type, expected_workflow_version, actor_snapshot_document_id, outcome, http_status, workflow_version, last_event_seq, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.run(receipt.commandId, receipt.workflowId, requestDigest, receipt.commandType, input.expectedWorkflowVersion, actorSnapshot.id, receipt.outcome, receipt.httpStatus, receipt.workflowVersion, receipt.lastEventSeq, receipt.createdAt);
		this.options.crashInjector.reach("execute_command.before_commit");
		return receipt;
	}

	private openGateCount(workflowId: number): number {
		const gates = (this.database.prepare("select count(*) as count from human_gates where workflow_id = ? and status = 'open'").get(workflowId) as { count: number }).count;
		const findingThreads = (this.database.prepare("select count(*) as count from finding_threads where workflow_id = ? and status = 'human_gate'").get(workflowId) as { count: number }).count;
		return gates + findingThreads;
	}

	private reviseRequirementRows(workflowId: number, requirementId: number, baseline: RequirementBaseline, actorSnapshotId: number, commandId: string, timestamp: string): void {
		const requirement = this.database
			.prepare("select id, version from requirements where id = ?")
			.get(requirementId) as { id: number; version: number };
		const artifact = this.database
			.prepare("select id from artifacts where requirement_id = ? and kind = 'requirement'")
			.get(requirementId) as { id: number };
		const snapshot = this.snapshotStore.insertSnapshot("artifact_content", "artifact/requirement/v1", baseline, timestamp);
		const revisionNo = (this.database.prepare("select coalesce(max(revision_no), 0) + 1 as next from artifact_revisions where artifact_id = ?").get(artifact.id) as { next: number }).next;
		const revisionId = Number(
			this.database
				.prepare("insert into artifact_revisions(artifact_id, revision_no, content_document_id, content_digest, schema_ref, status, source_command_id, created_at) values (?, ?, ?, ?, 'artifact/requirement/v1', 'approved', ?, ?)")
				.run(artifact.id, revisionNo, snapshot.id, snapshot.digest, commandId, timestamp).lastInsertRowid,
		);
		this.database.prepare("update artifacts set current_revision_id = ? where id = ?").run(revisionId, artifact.id);
		this.database
			.prepare("update requirements set current_revision_id = ?, version = ?, title = ?, updated_at = ? where id = ?")
			.run(revisionId, requirement.version + 1, baseline.title, timestamp, requirementId);
		this.appendEvent(workflowId, "requirement_revision_created", this.currentWorkflowVersion(workflowId), "artifact_revision", revisionId, revisionNo, { requirementId, revisionNo, contentDigest: snapshot.digest }, timestamp, actorSnapshotId, commandId);
	}

	private adoptReplacementPlanRows(workflowId: number, workflow: { version: number; current_plan_revision_id: number | null }, proposal: PlanProposal, timestamp: string): number {
		const proposalSnapshot = this.snapshotStore.insertSnapshot("plan_proposal", "plan-proposal/v1", proposal, timestamp);
		const revisionNo = (this.database.prepare("select coalesce(max(revision_no), 0) + 1 as next from plan_revisions where workflow_id = ?").get(workflowId) as { next: number }).next;
		const newVersion = workflow.version + 1;

		if (workflow.current_plan_revision_id !== null) {
			this.database.prepare("update plan_revisions set status = 'superseded' where id = ?").run(workflow.current_plan_revision_id);
		}
		const nonTerminalTasks = this.database
			.prepare("select id from tasks where workflow_id = ? and kind != 'plan' and status in ('pending', 'in_progress', 'blocked', 'replan_requested')")
			.all(workflowId) as Array<{ id: number }>;
		for (const task of nonTerminalTasks) {
			this.database.prepare("update tasks set status = 'superseded' where id = ?").run(task.id);
		}
		const runningAttempts = this.database
			.prepare("select id from task_attempts where workflow_id = ? and status = 'running'")
			.all(workflowId) as Array<{ id: number }>;
		for (const attempt of runningAttempts) {
			this.database.prepare("update task_attempts set status = 'superseded', completed_at = ? where id = ?").run(timestamp, attempt.id);
			this.database.prepare("update runs set status = 'cancelled', completed_at = ? where attempt_id = ? and status in ('queued', 'running')").run(timestamp, attempt.id);
			this.database.prepare("update governance_claims set status = 'released', released_at = ? where attempt_id = ? and status = 'active'").run(timestamp, attempt.id);
		}

		const planRevisionId = Number(
			this.database
				.prepare("insert into plan_revisions(workflow_id, revision_no, proposal_document_id, proposal_digest, base_plan_revision_id, planning_context_digest, status, created_at) values (?, ?, ?, ?, ?, ?, 'active', ?)")
				.run(workflowId, revisionNo, proposalSnapshot.id, proposalSnapshot.digest, workflow.current_plan_revision_id, this.computePlanningContextDigest(workflowId), timestamp).lastInsertRowid,
		);
		for (const task of proposal.tasks) {
			const taskId = Number(
				this.database
					.prepare("insert into tasks(workflow_id, plan_revision_id, key, kind, role, objective, depends_on_json, inputs_json, expected_artifact_effects_json, completion_policy_ref, max_attempts, status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
					.run(workflowId, planRevisionId, task.key, task.kind, task.role, task.objective, JSON.stringify(task.dependsOn), JSON.stringify(task.inputs), JSON.stringify(task.expectedArtifactEffects), task.completionPolicyRef, task.maxAttempts, timestamp).lastInsertRowid,
			);
			this.appendEvent(workflowId, "task_created", newVersion, "task", taskId, 0, { planRevisionId, key: task.key, kind: task.kind, role: task.role }, timestamp);
		}
		this.database.prepare("update workflows set current_plan_revision_id = ? where id = ?").run(planRevisionId, workflowId);
		this.appendEvent(workflowId, "plan_adopted", newVersion, "plan_revision", planRevisionId, revisionNo, { proposalDigest: proposalSnapshot.digest, revisionNo, basePlanRevisionId: workflow.current_plan_revision_id, source: "replace-plan" }, timestamp);
		return planRevisionId;
	}

	private persistRejection(
		input: ExecuteCommandInput,
		timestamp: string,
		requestDigest: string,
		workflow: { state: string; version: number; last_event_seq: number },
		actorSnapshotId: number,
		outcome: CommandOutcome,
		httpStatus: number,
	): CommandReceipt {
		const receipt: CommandReceipt = {
			commandId: input.commandId,
			workflowId: input.workflowId,
			commandType: input.type,
			outcome,
			httpStatus,
			workflowVersion: workflow.version,
			lastEventSeq: workflow.last_event_seq,
			createdAt: timestamp,
		};
		this.database
			.prepare("insert into command_receipts(command_id, workflow_id, request_digest, command_type, expected_workflow_version, actor_snapshot_document_id, outcome, http_status, workflow_version, last_event_seq, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
			.run(receipt.commandId, receipt.workflowId, requestDigest, receipt.commandType, input.expectedWorkflowVersion, actorSnapshotId, receipt.outcome, receipt.httpStatus, receipt.workflowVersion, receipt.lastEventSeq, receipt.createdAt);
		this.options.crashInjector.reach("execute_command.before_commit");
		return receipt;
	}

	private appendEvent(
		workflowId: number,
		type: string,
		workflowVersion: number,
		entityType: string,
		entityId: number,
		entityVersion: number,
		payload: Record<string, unknown>,
		createdAt: string,
		actorSnapshotId?: number,
		commandId?: string,
	): number {
		const seq = Number(
			(this.database
				.prepare("select coalesce(max(seq), 0) + 1 as next_seq from workflow_events where workflow_id = ?")
				.get(workflowId) as { next_seq: number }).next_seq,
		);
		this.database
			.prepare("insert into workflow_events(workflow_id, seq, type, type_version, schema_version, workflow_version, entity_type, entity_id, entity_version, command_id, actor_snapshot_document_id, payload, created_at) values (?, ?, ?, 1, 'workflow-event/v1', ?, ?, ?, ?, ?, ?, ?, ?)")
			.run(workflowId, seq, type, workflowVersion, entityType, entityId, entityVersion, commandId ?? null, actorSnapshotId ?? null, JSON.stringify(payload), createdAt);
		this.readModel.notifyWorkflowEventAppended(workflowId, seq);
		return seq;
	}

	private currentWorkflowVersion(workflowId: number): number {
		return (this.database.prepare("select version from workflows where id = ?").get(workflowId) as { version: number }).version;
	}



	reconcile(): ReconciliationReport {
		const resetCount = this.database
			.prepare("update outbox_jobs set next_attempt_at = null where delivered_at is null and next_attempt_at is not null")
			.run().changes;
		const quickCheck = this.database.pragma("quick_check", { simple: true }) as string;
		if (quickCheck !== "ok") {
			throw new Error(`Database integrity check failed: ${quickCheck}`);
		}
		const fkErrors = this.database.pragma("foreign_key_check") as unknown[];
		if (fkErrors.length > 0) {
			throw new Error(`Foreign key check failed: ${JSON.stringify(fkErrors)}`);
		}
		const workflowCount = (
			this.database.prepare("select count(*) as count from workflows").get() as { count: number }
		).count;
		const drainResult = this.drainOutbox();
		return {
			databaseIntact: true,
			foreignKeysValid: true,
			workflowsChecked: workflowCount,
			outboxReset: resetCount,
			outboxDelivered: drainResult.delivered,
			outboxExhausted: drainResult.exhausted,
			incidentsCreated: drainResult.incidentsCreated,
		};
	}

	processOutbox(): OutboxDrainResult {
		return this.drainOutbox();
	}


	drainOutbox(): OutboxDrainResult {
		const now = this.options.clock.now().toISOString();
		const jobs = this.database
			.prepare(
				"select id, workflow_id, event_seq, delivery_type, payload, delivery_failures from outbox_jobs where delivered_at is null and delivery_failures < ? and (next_attempt_at is null or next_attempt_at <= ?) order by id",
			)
			.all(MAX_DELIVERY_FAILURES, now) as Array<{
				id: number;
				workflow_id: number;
				event_seq: number;
				delivery_type: string;
				payload: string;
				delivery_failures: number;
			}>;
		let delivered = 0;
		let exhausted = 0;
		let incidentsCreated = 0;
		for (const job of jobs) {
			try {
				this.options.outboxTransport.deliver({
					id: `outbox-${job.id}`,
					type: job.delivery_type,
					payload: job.payload,
				});
				this.database
					.prepare("update outbox_jobs set delivered_at = ? where id = ?")
					.run(now, job.id);
				delivered += 1;
			} catch {
				const failures = job.delivery_failures + 1;
				if (failures >= MAX_DELIVERY_FAILURES) {
					this.database
						.prepare("update outbox_jobs set delivery_failures = ? where id = ?")
						.run(failures, job.id);
					this.failWorkflowWithOutboxIncident(job.workflow_id, job.id, now);
					exhausted += 1;
					incidentsCreated += 1;
				} else {
					const backoffMs = (BACKOFF_SECONDS[failures - 1] ?? 30) * 1000;
					const nextAttempt = new Date(new Date(now).getTime() + backoffMs).toISOString();
					this.database
						.prepare("update outbox_jobs set delivery_failures = ?, next_attempt_at = ? where id = ?")
						.run(failures, nextAttempt, job.id);
				}
			}
		}
		return { delivered, exhausted, incidentsCreated };
	}

	private failWorkflowWithOutboxIncident(
		workflowId: number,
		outboxJobId: number,
		timestamp: string,
	): void {
		const tx = this.database
			.transaction(() => {
				const { version } = this.database
					.prepare("select version from workflows where id = ?")
					.get(workflowId) as { version: number };
				const newVersion = version + 1;
				this.database
					.prepare(
						"update workflows set state = 'failed', version = ?, current_failure_code = 'outbox_exhausted', current_failure_subject_id = ?, updated_at = ? where id = ?",
					)
					.run(newVersion, outboxJobId, timestamp, workflowId);
				this.appendEvent(
					workflowId,
					"outbox_delivery_exhausted",
					newVersion,
					"outbox_job",
					outboxJobId,
					0,
					{ outboxJobId },
					timestamp,
				);
				this.database
					.prepare(
						"insert into workflow_incidents(workflow_id, incident_type, failure_code, subject_type, subject_id, subject_version, status, created_at) values (?, 'outbox_exhausted', 'outbox_exhausted', 'outbox_job', ?, 0, 'open', ?)",
					)
					.run(workflowId, outboxJobId, timestamp);
			})
			.immediate;
		tx();
	}
	beginPlanning(workflowId: number): BeginPlanningResult {
		const tx = this.database.transaction(() => this.beginPlanningRows(workflowId)).immediate;
		return tx();
	}

	private beginPlanningRows(workflowId: number): BeginPlanningResult {
		const timestamp = this.options.clock.now().toISOString();
		const workflow = this.database
			.prepare("select state, version, consecutive_plan_revisions from workflows where id = ?")
			.get(workflowId) as { state: string; version: number; consecutive_plan_revisions: number };

		if (workflow.state !== "running") {
			throw new Error(`Cannot begin planning on workflow in state ${workflow.state}`);
		}

		if (workflow.consecutive_plan_revisions >= PLAN_TASK_LIMITS.maxConsecutivePlanRevisions) {
			const newVersion = workflow.version + 1;
			this.database
				.prepare("update workflows set state = 'failed', version = ?, current_failure_code = 'plan_budget_exhausted', updated_at = ? where id = ?")
				.run(newVersion, timestamp, workflowId);
			this.appendEvent(workflowId, "workflow_failed", newVersion, "workflow", workflowId, newVersion, { failureCode: "plan_budget_exhausted" }, timestamp);
			this.options.crashInjector.reach("begin_planning.before_commit");
			return { taskId: 0, attemptId: 0, runId: 0, planningContextDigest: "", workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
		}

		const planningContextDigest = this.computePlanningContextDigest(workflowId);
		const newVersion = workflow.version + 1;

		let planningTask = this.database
			.prepare("select id, status from tasks where workflow_id = ? and kind = 'plan' and status in ('pending', 'in_progress') order by id desc limit 1")
			.get(workflowId) as { id: number; status: string } | undefined;
	if (!planningTask) {
		planningTask = {
			id: Number(this.database
				.prepare("insert into tasks(workflow_id, plan_revision_id, key, kind, role, objective, max_attempts, status, created_at) values (?, null, 'plan', 'plan', 'orchestrator', 'Produce a complete PlanProposal DAG', ?, 'in_progress', ?)")
				.run(workflowId, PLAN_TASK_LIMITS.maxPlanningAttempts, timestamp).lastInsertRowid),
			status: "in_progress",
		};
	}

		const attemptNo = (this.database.prepare("select coalesce(max(attempt_no), 0) + 1 as next from task_attempts where task_id = ?").get(planningTask.id) as { next: number }).next;
		const attemptId = Number(this.database
			.prepare("insert into task_attempts(task_id, workflow_id, attempt_no, status, planning_context_digest, base_workflow_version, created_at) values (?, ?, ?, 'running', ?, ?, ?)")
			.run(planningTask.id, workflowId, attemptNo, planningContextDigest, workflow.version, timestamp).lastInsertRowid);
		const runId = Number(this.database
			.prepare("insert into runs(attempt_id, workflow_id, session_file, session_id, status, created_at) values (?, ?, ?, ?, 'queued', ?)")
			.run(attemptId, workflowId, `workflow-sessions/run-${attemptId}.jsonl`, `run:${attemptId}`, timestamp).lastInsertRowid);
		this.database.prepare("update runs set status = 'running' where id = ?").run(runId);
		this.database.prepare("insert into governance_claims(workflow_id, attempt_id, status, created_at) values (?, ?, 'active', ?)").run(workflowId, attemptId, timestamp);

		this.appendEvent(workflowId, "planning_requested", newVersion, "task", planningTask.id, 0, { planningContextDigest }, timestamp);
		this.appendEvent(workflowId, "attempt_created", newVersion, "task_attempt", attemptId, 0, { taskId: planningTask.id, attemptNo }, timestamp);
		this.appendEvent(workflowId, "run_queued", newVersion, "run", runId, 0, { attemptId }, timestamp);
		this.appendEvent(workflowId, "run_running", newVersion, "run", runId, 0, { attemptId }, timestamp);
		this.appendEvent(workflowId, "workflow_attempt_claim_acquired", newVersion, "task_attempt", attemptId, 0, { attemptId }, timestamp);

		this.database.prepare("update workflows set version = ?, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);
		this.options.crashInjector.reach("begin_planning.before_commit");
		return { taskId: planningTask.id, attemptId, runId, planningContextDigest, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
	}




	private computePlanningContextDigest(workflowId: number): string {
		const row = this.database
			.prepare(`select w.current_plan_revision_id, ar.content_digest as requirement_digest, policy.digest as policy_digest from workflows w join requirements r on r.id = w.requirement_id join artifact_revisions ar on ar.id = r.current_revision_id join snapshot_documents policy on policy.id = w.policy_bundle_document_id where w.id = ?`)
			.get(workflowId) as { current_plan_revision_id: number | null; requirement_digest: string; policy_digest: string };
		const latestDirective = (this.database.prepare("select coalesce(max(id), 0) as latest from human_directives where workflow_id = ?").get(workflowId) as { latest: number }).latest;
		return this.options.hashProvider.digest({
			requirementRevisionDigest: row.requirement_digest,
			policyBundleDigest: row.policy_digest,
			basePlanRevisionId: row.current_plan_revision_id,
			latestDirectiveId: latestDirective,
		});
	}

	adoptPlan(workflowId: number, attemptId: number, proposal: PlanProposal): CompletePlanningResult {
		const tx = this.database.transaction(() => this.adoptPlanRows(workflowId, attemptId, proposal)).immediate;
		const result = tx();
		this.options.crashInjector.reach("drain_outbox.before");
		this.drainOutbox();
		return result;
	}

	/** #21 引擎自动返工：reject 后生成新 PlanRevision（rework Task 同 kind + 环节尾 review Task），旧计划 supersede 留档。 */
	adoptReworkPlan(workflowId: number, tasks: readonly TaskProposal[]): number | null {
		const tx = this.database.transaction(() => this.adoptReworkPlanRows(workflowId, tasks)).immediate;
		return tx();
	}

	private adoptReworkPlanRows(workflowId: number, tasks: readonly TaskProposal[]): number | null {
		const timestamp = this.options.clock.now().toISOString();
		const workflow = this.database
			.prepare("select version, current_plan_revision_id from workflows where id = ?")
			.get(workflowId) as { version: number; current_plan_revision_id: number | null };
		if (workflow.current_plan_revision_id === null) return null;
		const planningContext = this.computePlanningContextDigest(workflowId);
		const proposalSnapshot = this.snapshotStore.insertSnapshot("plan_proposal", "plan-proposal/v1", {
			schemaVersion: "plan-proposal/v1",
			base: {
				workflowId,
				workflowVersion: workflow.version,
				planningContextDigest: planningContext,
				basePlanRevisionId: workflow.current_plan_revision_id,
			},
			objective: "Rework rejected artifact",
			tasks: [...tasks],
			rationale: "engine-instantiated rework plan",
		}, timestamp);
		const revisionNo = (this.database.prepare("select coalesce(max(revision_no), 0) + 1 as next from plan_revisions where workflow_id = ?").get(workflowId) as { next: number }).next;
		const newVersion = workflow.version + 1;
		this.database.prepare("update plan_revisions set status = 'superseded' where id = ?").run(workflow.current_plan_revision_id);
		const planRevisionId = Number(this.database
			.prepare("insert into plan_revisions(workflow_id, revision_no, proposal_document_id, proposal_digest, base_plan_revision_id, planning_context_digest, status, created_at) values (?, ?, ?, ?, ?, ?, 'active', ?)")
			.run(workflowId, revisionNo, proposalSnapshot.id, proposalSnapshot.digest, workflow.current_plan_revision_id, planningContext, timestamp).lastInsertRowid);
		for (const task of tasks) {
			const taskId = Number(this.database
				.prepare("insert into tasks(workflow_id, plan_revision_id, key, kind, role, objective, depends_on_json, inputs_json, expected_artifact_effects_json, completion_policy_ref, max_attempts, status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
				.run(workflowId, planRevisionId, task.key, task.kind, task.role, task.objective, JSON.stringify(task.dependsOn), JSON.stringify(task.inputs), JSON.stringify(task.expectedArtifactEffects), task.completionPolicyRef, task.maxAttempts, timestamp).lastInsertRowid);
			this.appendEvent(workflowId, "task_created", newVersion, "task", taskId, 0, { planRevisionId, key: task.key, kind: task.kind, role: task.role }, timestamp);
		}
		this.database.prepare("update workflows set version = ?, current_plan_revision_id = ?, updated_at = ? where id = ?").run(newVersion, planRevisionId, timestamp, workflowId);
		this.appendEvent(workflowId, "rework_plan_adopted", newVersion, "plan_revision", planRevisionId, revisionNo, { proposalDigest: proposalSnapshot.digest, revisionNo, basePlanRevisionId: workflow.current_plan_revision_id, reworkTaskKey: tasks[0]?.key ?? null }, timestamp);
		this.options.crashInjector.reach("adopt_rework_plan.before_commit");
		return planRevisionId;
	}

	/** #21 返工闭环：产物 revision 来自 rework 计划且已批准 → 将 base（原模板）计划恢复为 active，rework 计划 supersede。 */
	private restoreBasePlanAfterRework(workflowId: number, revisionId: number): void {
		// 找到该 revision 的 source task 及其所在 plan
		const row = this.database
			.prepare(`select plan.id as rework_plan_id, plan.base_plan_revision_id as base_plan_id, revision.source_attempt_id as source_attempt_id
				from artifact_revisions revision
				left join task_attempts attempt on attempt.id = revision.source_attempt_id
				left join tasks task on task.id = attempt.task_id
				left join plan_revisions plan on plan.id = task.plan_revision_id
				where revision.id = ? and revision.artifact_id is not null`)
			.get(revisionId) as { rework_plan_id: number | null; base_plan_id: number | null; source_attempt_id: number | null } | undefined;
		if (!row || row.base_plan_id === null || row.rework_plan_id === null) return;
		const now = this.options.clock.now().toISOString();
		const workflow = this.database.prepare("select version, current_plan_revision_id from workflows where id = ?").get(workflowId) as { version: number; current_plan_revision_id: number | null };
		if (workflow.current_plan_revision_id !== row.rework_plan_id) return;
		this.database.prepare("update plan_revisions set status = 'superseded' where id = ?").run(row.rework_plan_id);
		this.database.prepare("update plan_revisions set status = 'active' where id = ?").run(row.base_plan_id);
		this.database.prepare("update workflows set current_plan_revision_id = ?, version = ? where id = ?").run(row.base_plan_id, workflow.version + 1, workflowId);
		this.appendEvent(workflowId, "rework_plan_completed", workflow.version + 1, "plan_revision", row.rework_plan_id, 0, { basePlanRevisionId: row.base_plan_id, revisionId }, now);
	}

	/** #21 rework 角色映射：生产 kind → 对应生产角色（#15 决议 8 角色）。 */

	/** #21 返工预算 + 计划生成：同 kind 累计 reject≥2 升 finding_disposition 人工门禁（不再自动返工）；否则生成 rework+review 新计划。 */
	private scheduleRework(workflowId: number, kind: string, artifactId: number, rejectedRevisionId: number, reason: string, actorSnapshotDocumentId: number, commandId: string, timestamp: string): boolean {
		const fingerprint = `reject:${kind}:${artifactId}`;
		const thread = this.database
			.prepare("select id, rework_count from finding_threads where workflow_id = ? and fingerprint = ?")
			.get(workflowId, fingerprint) as { id: number; rework_count: number } | undefined;
		const newCount = (thread?.rework_count ?? 0) + 1;
		if (thread) {
			this.database.prepare("update finding_threads set rework_count = ?, updated_at = ? where id = ?").run(newCount, timestamp, thread.id);
		} else {
			this.database
				.prepare("insert into finding_threads(workflow_id, fingerprint, rework_count, status, created_at, updated_at) values (?, ?, 1, 'open', ?, ?)")
				.run(workflowId, fingerprint, timestamp, timestamp);
		}
		const newVersion = (this.database.prepare("select version from workflows where id = ?").get(workflowId) as { version: number }).version + 1;
		if (newCount >= 2) {
			// 预算耗尽：升 finding_disposition 门禁，人工接管（不自动返工）。创建 major Finding 供 accept-finding-risk 解析。
			const id = (this.database.prepare("select id from finding_threads where workflow_id = ? and fingerprint = ?").get(workflowId, fingerprint) as { id: number }).id;
			this.database.prepare("update finding_threads set status = 'human_gate', updated_at = ? where id = ?").run(timestamp, id);
			const sourceAttempt = (this.database.prepare("select source_attempt_id from artifact_revisions where id = ?").get(rejectedRevisionId) as { source_attempt_id: number | null }).source_attempt_id;
			// 兜底：取本 workflow 内任一 attempt（必须是本 workflow 的合法 FK）；无则拒绝升级（避免跨 workflow 魔数）
			let attemptIdForFinding = sourceAttempt;
			if (attemptIdForFinding === null) {
				const anyAttempt = this.database
					.prepare("select id from task_attempts where workflow_id = ? order by id desc limit 1")
					.get(workflowId) as { id: number } | undefined;
				if (!anyAttempt) {
					return false;
				}
				attemptIdForFinding = anyAttempt.id;
			}
			const findingId = Number(this.database
				.prepare("insert into findings(workflow_id, task_attempt_id, thread_id, fingerprint, severity, status, summary, target_revision_id, target_artifact_kind, source_ref, evidence_json, created_at) values (?, ?, ?, ?, 'major', 'open', ?, ?, ?, 'reject-rework', null, ?)")
				.run(workflowId, attemptIdForFinding, id, fingerprint, `Rework budget exhausted after repeated rejection of ${kind}: ${reason}`, rejectedRevisionId, kind, timestamp).lastInsertRowid);
			this.database.prepare("update workflows set state = 'waiting_for_human', version = ?, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);
			this.database
				.prepare("insert into human_gates(workflow_id, gate_type, subject_type, subject_id, status, opened_at) values (?, 'finding_disposition', 'finding_thread', ?, 'open', ?)")
				.run(workflowId, id, timestamp);
			this.appendEvent(workflowId, "finding_thread_escalated", newVersion, "finding_thread", id, 0, { fingerprint, reworkCount: newCount, reason }, timestamp, actorSnapshotDocumentId, commandId);
			return true;
		}
		// 预算内：生成 rework + review 新计划
		const role = REWORK_ROLE_BY_KIND[kind];
		if (!role) {
			return true; // 未知 kind 不自动返工，交由人工处置
		}
		const completionPolicy = `${kind}/v1`;
		const reworkTask: TaskProposal = {
			key: `rework-${kind}`,
			kind: "rework",
			role: role as TaskProposal["role"],
			objective: `Rework rejected ${kind} artifact`,
			dependsOn: [],
			inputs: [{ type: "artifact_revision", artifactId, revisionId: rejectedRevisionId, artifactKind: kind as ArtifactKind, purpose: "rejected base" }],
			expectedArtifactEffects: [{ kind: kind as TaskProposal["expectedArtifactEffects"][number]["kind"], operation: "create_or_revise" }],
			completionPolicyRef: completionPolicy,
			maxAttempts: 3,
		};
		const reviewTask: TaskProposal = {
			key: `review-${kind}-rework`,
			kind: "review",
			role: "critic",
			objective: `Review reworked ${kind} artifact`,
			dependsOn: [reworkTask.key],
			inputs: [{ type: "task_output", taskKey: reworkTask.key, artifactKind: kind as WritableArtifactKind, purpose: "review rework" }],
			expectedArtifactEffects: [],
			completionPolicyRef: "critic-review/v1",
			maxAttempts: 3,
		};
		this.adoptReworkPlan(workflowId, [reworkTask, reviewTask]);
		return false;
	}

	private adoptPlanRows(workflowId: number, attemptId: number, proposal: PlanProposal): CompletePlanningResult {
		const timestamp = this.options.clock.now().toISOString();
		const workflow = this.database
			.prepare("select version, current_plan_revision_id, consecutive_plan_revisions from workflows where id = ?")
			.get(workflowId) as { version: number; current_plan_revision_id: number | null; consecutive_plan_revisions: number };
		const attempt = this.database
			.prepare("select task_id, planning_context_digest from task_attempts where id = ?")
			.get(attemptId) as { task_id: number; planning_context_digest: string };
		const planTask = this.database.prepare("select id, key from tasks where id = ?").get(attempt.task_id) as { id: number; key: string };
		const currentContext = this.computePlanningContextDigest(workflowId);
		if (attempt.planning_context_digest !== currentContext) {
			return this.supersedePlanningRows(workflowId, attemptId, "planning_context_changed");
		}

		const proposalSnapshot = this.snapshotStore.insertSnapshot("plan_proposal", "plan-proposal/v1", proposal, timestamp);
		const revisionNo = (this.database.prepare("select coalesce(max(revision_no), 0) + 1 as next from plan_revisions where workflow_id = ?").get(workflowId) as { next: number }).next;
		const newVersion = workflow.version + 1;

		if (workflow.current_plan_revision_id !== null) {
			this.database.prepare("update plan_revisions set status = 'superseded' where id = ?").run(workflow.current_plan_revision_id);
		}

		const planRevisionId = Number(this.database
			.prepare("insert into plan_revisions(workflow_id, revision_no, proposal_document_id, proposal_digest, base_plan_revision_id, planning_context_digest, status, created_at) values (?, ?, ?, ?, ?, ?, 'active', ?)")
			.run(workflowId, revisionNo, proposalSnapshot.id, proposalSnapshot.digest, workflow.current_plan_revision_id, attempt.planning_context_digest, timestamp).lastInsertRowid);

		for (const task of proposal.tasks) {
			const taskId = Number(this.database
				.prepare("insert into tasks(workflow_id, plan_revision_id, key, kind, role, objective, depends_on_json, inputs_json, expected_artifact_effects_json, completion_policy_ref, max_attempts, status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
				.run(workflowId, planRevisionId, task.key, task.kind, task.role, task.objective, JSON.stringify(task.dependsOn), JSON.stringify(task.inputs), JSON.stringify(task.expectedArtifactEffects), task.completionPolicyRef, task.maxAttempts, timestamp).lastInsertRowid);
			this.appendEvent(workflowId, "task_created", newVersion, "task", taskId, 0, { planRevisionId, key: task.key, kind: task.kind, role: task.role }, timestamp);
		}

		this.database.prepare("update task_attempts set status = 'succeeded', completed_at = ? where id = ?").run(timestamp, attemptId);
		const runId = (this.database.prepare("select id from runs where attempt_id = ? order by id desc limit 1").get(attemptId) as { id: number }).id;
		this.database.prepare("update runs set status = 'completed', completed_at = ? where id = ?").run(timestamp, runId);
		this.database.prepare("update tasks set status = 'completed' where id = ?").run(planTask.id);
		this.database.prepare("update governance_claims set status = 'released', released_at = ? where attempt_id = ? and status = 'active'").run(timestamp, attemptId);
		this.database.prepare("update workflows set version = ?, current_plan_revision_id = ?, consecutive_plan_revisions = ?, updated_at = ? where id = ?")
			.run(newVersion, planRevisionId, workflow.consecutive_plan_revisions + 1, timestamp, workflowId);

		this.appendEvent(workflowId, "plan_adopted", newVersion, "plan_revision", planRevisionId, revisionNo, { proposalDigest: proposalSnapshot.digest, revisionNo, basePlanRevisionId: workflow.current_plan_revision_id }, timestamp);
		this.appendEvent(workflowId, "attempt_succeeded", newVersion, "task_attempt", attemptId, 0, { taskId: attempt.task_id }, timestamp);
		this.appendEvent(workflowId, "run_completed", newVersion, "run", runId, 0, { attemptId }, timestamp);
		this.appendEvent(workflowId, "task_completed", newVersion, "task", planTask.id, 0, { taskKey: planTask.key }, timestamp);
		this.appendEvent(workflowId, "workflow_attempt_claim_released", newVersion, "task_attempt", attemptId, 0, { attemptId }, timestamp);

		this.options.crashInjector.reach("adopt_plan.before_commit");
		return { outcome: "adopted", planRevisionId, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
	}

	failPlanningAttempt(workflowId: number, attemptId: number, violations: unknown): CompletePlanningResult {
		const tx = this.database.transaction(() => this.failPlanningAttemptRows(workflowId, attemptId, violations)).immediate;
		const result = tx();
		this.options.crashInjector.reach("drain_outbox.before");
		this.drainOutbox();
		return result;
	}

	private failPlanningAttemptRows(workflowId: number, attemptId: number, violations: unknown): CompletePlanningResult {
		const timestamp = this.options.clock.now().toISOString();
		const workflow = this.database.prepare("select version from workflows where id = ?").get(workflowId) as { version: number };
		const attempt = this.database.prepare("select task_id, attempt_no from task_attempts where id = ?").get(attemptId) as { task_id: number; attempt_no: number };
		const newVersion = workflow.version + 1;

		this.database.prepare("update task_attempts set status = 'failed', completed_at = ? where id = ?").run(timestamp, attemptId);
		const runId = (this.database.prepare("select id from runs where attempt_id = ? order by id desc limit 1").get(attemptId) as { id: number }).id;
		this.database.prepare("update runs set status = 'failed', completed_at = ? where id = ?").run(timestamp, runId);
		this.database.prepare("update governance_claims set status = 'released', released_at = ? where attempt_id = ? and status = 'active'").run(timestamp, attemptId);

		this.appendEvent(workflowId, "plan_validation_failed", newVersion, "task_attempt", attemptId, 0, { violations }, timestamp);
		this.appendEvent(workflowId, "attempt_failed", newVersion, "task_attempt", attemptId, 0, { taskId: attempt.task_id, attemptNo: attempt.attempt_no }, timestamp);
		this.appendEvent(workflowId, "run_failed", newVersion, "run", runId, 0, { attemptId }, timestamp);
		this.appendEvent(workflowId, "workflow_attempt_claim_released", newVersion, "task_attempt", attemptId, 0, { attemptId }, timestamp);

		const failedCount = (this.database.prepare("select count(*) as count from task_attempts where task_id = ? and status = 'failed'").get(attempt.task_id) as { count: number }).count;

		let outcome: CompletePlanningOutcome = "validation_failed";
		if (failedCount >= PLAN_TASK_LIMITS.maxPlanningAttempts) {
			this.database.prepare("update tasks set status = 'failed' where id = ?").run(attempt.task_id);
			this.database.prepare("update workflows set state = 'failed', version = ?, current_failure_code = 'planning_exhausted', updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);
			this.appendEvent(workflowId, "workflow_failed", newVersion, "workflow", workflowId, newVersion, { failureCode: "planning_exhausted" }, timestamp);
			outcome = "planning_exhausted";
		} else {
			this.database.prepare("update workflows set version = ?, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);
		}

		this.options.crashInjector.reach("fail_planning.before_commit");
		return { outcome, planRevisionId: null, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
	}

	supersedePlanningAttempt(workflowId: number, attemptId: number, reason: string): CompletePlanningResult {
		const tx = this.database.transaction(() => this.supersedePlanningRows(workflowId, attemptId, reason)).immediate;
		const result = tx();
		this.options.crashInjector.reach("drain_outbox.before");
		this.drainOutbox();
		return result;
	}

	private supersedePlanningRows(workflowId: number, attemptId: number, reason: string): CompletePlanningResult {
		const timestamp = this.options.clock.now().toISOString();
		const workflow = this.database.prepare("select version from workflows where id = ?").get(workflowId) as { version: number };
		const attempt = this.database.prepare("select task_id from task_attempts where id = ?").get(attemptId) as { task_id: number };
		const newVersion = workflow.version + 1;

		const runId = (this.database.prepare("select id from runs where attempt_id = ? order by id desc limit 1").get(attemptId) as { id: number }).id;
		this.database.prepare("update runs set status = 'completed', completed_at = ? where id = ?").run(timestamp, runId);
		this.database.prepare("update task_attempts set status = 'superseded', completed_at = ? where id = ?").run(timestamp, attemptId);
		this.database.prepare("update tasks set status = 'superseded' where id = ?").run(attempt.task_id);
		this.database.prepare("update governance_claims set status = 'released', released_at = ? where attempt_id = ? and status = 'active'").run(timestamp, attemptId);
		this.database.prepare("update workflows set version = ?, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);

		this.appendEvent(workflowId, "run_completed", newVersion, "run", runId, 0, { attemptId }, timestamp);
		this.appendEvent(workflowId, "attempt_superseded", newVersion, "task_attempt", attemptId, 0, { taskId: attempt.task_id, reason }, timestamp);
		this.appendEvent(workflowId, "task_superseded", newVersion, "task", attempt.task_id, 0, { reason }, timestamp);
		this.appendEvent(workflowId, "workflow_attempt_claim_released", newVersion, "task_attempt", attemptId, 0, { attemptId }, timestamp);

		this.options.crashInjector.reach("supersede_planning.before_commit");
		return { outcome: "stale_context", planRevisionId: null, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
	}

	beginAttempt(workflowId: number): BeginAttemptResult {
		const tx = this.database.transaction(() => this.beginAttemptRows(workflowId)).immediate;
		return tx();
	}

	private beginAttemptRows(workflowId: number): BeginAttemptResult {
		const timestamp = this.options.clock.now().toISOString();
		const workflow = this.database
			.prepare("select state, version from workflows where id = ?")
			.get(workflowId) as { state: string; version: number };
		if (workflow.state !== "running") {
			throw new Error(`Cannot begin attempt on workflow in state ${workflow.state}`);
		}

		const activeClaim = this.database
			.prepare("select attempt_id from governance_claims where workflow_id = ? and status = 'active'")
			.get(workflowId) as { attempt_id: number } | undefined;
		if (activeClaim) {
			throw new Error("Only one active governance claim per workflow");
		}

		const task = this.getReadyExecutionTask(workflowId);
		if (!task) {
		return { taskId: 0, taskKey: "", taskRole: "", attemptId: 0, runId: 0, contextDigest: "", workflowVersion: workflow.version, lastEventSeq: this.currentLastEventSeq(workflowId) };
		}

		const resolvedInputs = this.resolveTaskOutputInputs(workflowId, task, task.role);
		if (!resolvedInputs) {
		return { taskId: 0, taskKey: "", taskRole: "", attemptId: 0, runId: 0, contextDigest: "", workflowVersion: workflow.version, lastEventSeq: this.currentLastEventSeq(workflowId) };
		}

		const roleContract = this.getOrCreateRoleContract(task.role, timestamp);
		const manifest = this.buildContextManifest(workflowId, workflow.version, task, resolvedInputs, roleContract, timestamp);
		const contextSnapshot = this.snapshotStore.insertSnapshot("context_manifest", "context-manifest/v1", manifest, timestamp);

		const attemptNo = (this.database.prepare("select coalesce(max(attempt_no), 0) + 1 as next from task_attempts where task_id = ?").get(task.id) as { next: number }).next;
		const attemptId = Number(this.database
			.prepare("insert into task_attempts(task_id, workflow_id, attempt_no, status, base_workflow_version, context_manifest_document_id, role_contract_document_id, created_at) values (?, ?, ?, 'running', ?, ?, ?, ?)")
			.run(task.id, workflowId, attemptNo, workflow.version, contextSnapshot.id, roleContract.documentId, timestamp).lastInsertRowid);
		const runId = Number(this.database
			.prepare("insert into runs(attempt_id, workflow_id, session_file, session_id, status, mode, role, created_at) values (?, ?, ?, ?, 'running', 'governance', ?, ?)")
			.run(attemptId, workflowId, `workflow-sessions/run-${attemptId}.jsonl`, `run:${attemptId}`, task.role, timestamp).lastInsertRowid);
		this.database.prepare("insert into governance_claims(workflow_id, attempt_id, status, created_at) values (?, ?, 'active', ?)").run(workflowId, attemptId, timestamp);
		this.database.prepare("update tasks set status = 'in_progress' where id = ?").run(task.id);

		const newVersion = workflow.version + 1;
		this.appendEvent(workflowId, "task_started", newVersion, "task", task.id, 0, { taskKey: task.key, role: task.role }, timestamp);
		this.appendEvent(workflowId, "attempt_created", newVersion, "task_attempt", attemptId, 0, { taskId: task.id, attemptNo }, timestamp);
		this.appendEvent(workflowId, "attempt_started", newVersion, "task_attempt", attemptId, 0, { taskId: task.id }, timestamp);
		this.appendEvent(workflowId, "run_queued", newVersion, "run", runId, 0, { attemptId }, timestamp);
		this.appendEvent(workflowId, "run_running", newVersion, "run", runId, 0, { attemptId }, timestamp);
		this.appendEvent(workflowId, "workflow_attempt_claim_acquired", newVersion, "task_attempt", attemptId, 0, { attemptId }, timestamp);
		this.database.prepare("update workflows set version = ?, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);

		this.options.crashInjector.reach("begin_attempt.before_commit");
	return { taskId: task.id, taskKey: task.key, taskRole: task.role, attemptId, runId, contextDigest: contextSnapshot.digest, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
	}

	private getReadyExecutionTask(workflowId: number): { id: number; key: string; kind: string; role: string; objective: string; plan_revision_id: number; depends_on_json: string; inputs_json: string; expected_artifact_effects_json: string; completion_policy_ref: string | null; max_attempts: number } | null {
		const tasks = this.database
			.prepare(`select t.id, t.key, t.kind, t.role, t.objective, t.plan_revision_id, t.depends_on_json, t.inputs_json, t.expected_artifact_effects_json, t.completion_policy_ref, t.max_attempts, t.status,
				(select count(*) from task_attempts ta where ta.task_id = t.id and ta.status = 'failed') as failed_attempt_count
				from tasks t
				where t.workflow_id = ? and t.kind != 'plan' and t.status = 'pending'
				and t.plan_revision_id = (select current_plan_revision_id from workflows where id = ?)
				order by failed_attempt_count desc, t.id`)
			.all(workflowId, workflowId) as Array<{ id: number; key: string; kind: string; role: string; objective: string; plan_revision_id: number; depends_on_json: string; inputs_json: string; expected_artifact_effects_json: string; completion_policy_ref: string | null; max_attempts: number; status: string; failed_attempt_count: number }>;
		for (const task of tasks) {
			const deps = parseJson<string[]>(task.depends_on_json);
			if (deps.length === 0) return task;
			const allDone = deps.every((depKey) => {
				const dep = this.database
					.prepare("select status from tasks where workflow_id = ? and key = ? and plan_revision_id = ?")
					.get(workflowId, depKey, task.plan_revision_id) as { status: string } | undefined;
				return dep?.status === "completed" || dep?.status === "skipped_satisfied";
			});
			if (allDone) return task;
		}
		return null;
	}

	private resolveTaskOutputInputs(workflowId: number, task: { id: number; key: string; kind: string; role: string; inputs_json: string; plan_revision_id: number }, role: string): Array<Record<string, unknown>> | null {
		const inputs = parseJson<InputBinding[]>(task.inputs_json);
		const resolved: Array<Record<string, unknown>> = [];
		for (const input of inputs) {
			if (input.type === "task_output") {
				const taskOutput = input as TaskOutputInput;
				const ancestorTask = this.database
					.prepare("select id from tasks where workflow_id = ? and key = ? and plan_revision_id = ?")
					.get(workflowId, taskOutput.taskKey, task.plan_revision_id) as { id: number } | undefined;
				if (!ancestorTask) return null;
			const isCritic = role === "critic";
			// critic 用 pending;生产用 approved(双闸:#20 绑定反转——未批准产物不可被下游引用)
			const latest = this.database
				.prepare(`select ar.id from artifact_revisions ar
					join attempt_effects ae on ae.published_artifact_revision_id = ar.id
					where ae.workflow_id = ? and ae.artifact_kind = ?
					and ${isCritic
						? "ar.status = 'pending'"
						: `ar.status = 'approved' and exists (select 1 from approval_records approval where approval.subject_type = 'artifact_revision' and approval.subject_id = ar.id and approval.record_type = 'artifact_approval')
							and not exists (select 1 from findings open_finding where open_finding.workflow_id = ae.workflow_id and open_finding.target_revision_id = ar.id and open_finding.status = 'open' and open_finding.severity in ('critical','major'))`}
					order by ar.id desc limit 1`)
				.get(workflowId, taskOutput.artifactKind) as { id: number } | undefined;
				const revisionList: Array<{ id: number }> = latest ? [latest] : [];
				if (revisionList.length !== 1) return null;
				resolved.push({ ...taskOutput, resolvedRevisionId: revisionList[0]!.id });
			} else {
				resolved.push(input as unknown as Record<string, unknown>);
			}
		}
		return resolved;
	}

	private getOrCreateRoleContract(role: string, timestamp: string): { documentId: number; identity: string; digest: string } & RoleContract {
		const contract: RoleContract = {
			schemaVersion: "role-contract/v1",
			role,
			writableArtifactKinds: ARTIFACT_OWNERSHIP[role as keyof typeof ARTIFACT_OWNERSHIP] ?? [],
			allowedEffectTypes: ["artifact_revision"],
		};
		const snapshot = this.snapshotStore.insertSnapshot("role_contract", "role-contract/v1", contract, timestamp);
		const identity = `role-contract/${role}/v1`;
		return { ...contract, documentId: snapshot.id, identity, digest: snapshot.digest };
	}

	private buildContextManifest(workflowId: number, workflowVersion: number, task: { id: number; key: string; kind: string; role: string; objective: string; plan_revision_id: number }, resolvedInputs: Array<Record<string, unknown>>, roleContract: { documentId: number; identity: string; digest: string }, timestamp: string): ContextManifest {
		const projection = this.readModel.getWorkflowProjection(workflowId);
		if (!projection) throw new Error("Workflow not found");
		const policyBundleDigest = projection.workflow.policyBundle.digest;
		const inputDigest = this.options.hashProvider.digest(resolvedInputs);
		const manifest: ContextManifest = {
			schemaVersion: "context-manifest/v1",
			workflowId,
			workflowVersion,
			requirement: { revisionId: projection.requirement.currentRevision.id, digest: projection.requirement.currentRevision.contentDigest },
			planRevisionId: task.plan_revision_id,
			task: { id: task.id, key: task.key, kind: task.kind, role: task.role, objective: task.objective },
			roleContract: { documentId: roleContract.documentId, identity: roleContract.identity, digest: roleContract.digest },
			policyBundleDigest,
			inputs: resolvedInputs,
			inputDigest,
		};
		// #24 生产角色注入：critic 不收历史资产（复核输入边界干净）；注入 query = 需求标题（高信号借鉴键）。
		if (task.role !== "critic") {
			manifest.relevantAssets = this.readModel.getFeedbackAssetReferences(workflowId, projection.requirement.title, FEEDBACK_REFERENCE_BUDGET);
		}
		return manifest;
	}

	publishAttemptResult(workflowId: number, attemptId: number, structuredResult: unknown): CompleteAttemptResult {
		const tx = this.database.transaction(() => this.publishAttemptResultRows(workflowId, attemptId, structuredResult)).immediate;
		return tx();
	}

	private publishAttemptResultRows(workflowId: number, attemptId: number, structuredResult: unknown): CompleteAttemptResult {
		const timestamp = this.options.clock.now().toISOString();
		const workflow = this.database.prepare("select version from workflows where id = ?").get(workflowId) as { version: number };
		const attempt = this.database.prepare("select task_id, attempt_no, status from task_attempts where id = ?").get(attemptId) as { task_id: number; attempt_no: number; status: string };
	const task = this.database.prepare("select id, key, kind, role, expected_artifact_effects_json, max_attempts, plan_revision_id from tasks where id = ?").get(attempt.task_id) as { id: number; key: string; kind: string; role: string; expected_artifact_effects_json: string; max_attempts: number; plan_revision_id: number };

		if (attempt.status === "cancelled" || attempt.status === "superseded" || attempt.status === "failed") {
			const resultSnapshot = this.snapshotStore.insertSnapshot("artifact_content", "role-result/v1", structuredResult, timestamp);
			this.appendEvent(workflowId, "late_result_audit", workflow.version, "task_attempt", attemptId, 0, { attemptId, terminalStatus: attempt.status, resultDigest: resultSnapshot.digest }, timestamp);
			return { outcome: "late_result_audit", failureCode: null, workflowVersion: workflow.version, lastEventSeq: this.currentLastEventSeq(workflowId) };
		}

		const result = structuredResult as RoleResult & { outcome?: string; blockReason?: string; replanReason?: string };
		if (result.outcome === "blocked") {
			return this.blockAttemptRows(workflowId, attemptId, result.blockReason ?? "No reason provided", timestamp);
		}
		if (result.outcome === "replan_requested") {
			return this.replanRequestedRows(workflowId, attemptId, result.replanReason ?? "No reason provided", timestamp);
		}

		if (!result || result.schemaVersion !== "role-result/v1" || typeof result.workflowId !== "number" || typeof result.attemptId !== "number" || !Array.isArray(result.effects)) {
			return this.failAttemptRows(workflowId, attemptId, "invalid_role_result_schema", "RoleResult schema validation failed");
		}
		if (result.workflowId !== workflowId || result.attemptId !== attemptId) {
			return this.failAttemptRows(workflowId, attemptId, "role_result_mismatch", "RoleResult workflow or attempt mismatch");
		}

		if (result.decisionProposals) {
			for (const proposal of result.decisionProposals) {
				const keys = Object.keys(proposal as unknown as Record<string, unknown>).sort();
				if (keys.join(",") !== "severity,summary" || !["critical", "major", "minor"].includes(proposal.severity) || typeof proposal.summary !== "string" || proposal.summary.length === 0) {
					return this.failAttemptRows(workflowId, attemptId, "invalid_decision_proposal", "DecisionProposal schema validation failed");
				}
			}
		}

	if (task.role === "critic") {
		return this.publishCriticReportRows(workflowId, attemptId, result, task, workflow, timestamp);
	}
		const expectedEffects = parseJson<TaskProposal["expectedArtifactEffects"]>(task.expected_artifact_effects_json);
		const allowedKinds = ARTIFACT_OWNERSHIP[task.role as keyof typeof ARTIFACT_OWNERSHIP] ?? [];
		for (const effect of result.effects) {
			if (effect.effectType !== "artifact_revision") {
				return this.failAttemptRows(workflowId, attemptId, "tool_ownership_violation", `Effect type ${effect.effectType} is not allowed for role ${task.role}`);
			}
			if (!allowedKinds.includes(effect.artifactKind)) {
				return this.failAttemptRows(workflowId, attemptId, "tool_ownership_violation", `Role ${task.role} cannot write artifact kind ${effect.artifactKind}`);
			}
			if (effect.logicalKey !== effect.artifactKind) {
				return this.failAttemptRows(workflowId, attemptId, "effect_key_mismatch", `Effect logical key ${effect.logicalKey} must match artifact kind ${effect.artifactKind}`);
			}
		}
		if (this.options.artifactValidator) {
			for (const effect of result.effects) {
				if (!this.options.artifactValidator.check(effect.content)) {
					return this.failAttemptRows(workflowId, attemptId, "artifact_schema_invalid", `Artifact content for kind ${effect.artifactKind} does not match schema`);
				}
			}
		}
		const traceLinkRequired = ["analysis", "design", "architecture", "data", "api"];
		for (const effect of result.effects) {
			if (traceLinkRequired.includes(effect.artifactKind) && (!effect.traceLinks || (effect.traceLinks as unknown[]).length === 0)) {
				return this.failAttemptRows(workflowId, attemptId, "missing_trace_link", `Artifact kind ${effect.artifactKind} requires at least one TraceLink`);
			}
		}
		for (const expected of expectedEffects) {
			const found = result.effects.find((e) => e.artifactKind === expected.kind);
			if (!found) {
				return this.failAttemptRows(workflowId, attemptId, "completion_policy_failed", `Missing required effect for kind ${expected.kind}`);
			}
		}

		const projection = this.readModel.getWorkflowProjection(workflowId);
		if (!projection) throw new Error("Workflow not found");
		const newVersion = workflow.version + 1;
		const runId = (this.database.prepare("select id from runs where attempt_id = ? order by id desc limit 1").get(attemptId) as { id: number }).id;

		for (const effect of result.effects) {
			const contentSnapshot = this.snapshotStore.insertSnapshot("artifact_content", `artifact/${effect.artifactKind}/v1`, effect.content, timestamp);
			let artifactId = (this.database.prepare("select id from artifacts where requirement_id = ? and kind = ?").get(projection.requirement.id, effect.artifactKind) as { id: number } | undefined)?.id;
			if (!artifactId) {
				artifactId = Number(this.database
					.prepare("insert into artifacts(requirement_id, kind, title, created_at) values (?, ?, ?, ?)")
					.run(projection.requirement.id, effect.artifactKind, `${effect.artifactKind} for ${projection.requirement.title}`, timestamp).lastInsertRowid);
			}
			const baseRevisionId = effect.baseRevisionId;
			const revisionNo = baseRevisionId
				? ((this.database.prepare("select revision_no from artifact_revisions where id = ?").get(baseRevisionId) as { revision_no: number }).revision_no + 1)
				: 1;
			const revisionId = Number(this.database
				.prepare("insert into artifact_revisions(artifact_id, revision_no, content_document_id, content_digest, schema_ref, status, source_attempt_id, base_revision_id, created_at) values (?, ?, ?, ?, ?, 'pending', ?, ?, ?)")
				.run(artifactId, revisionNo, contentSnapshot.id, contentSnapshot.digest, `artifact/${effect.artifactKind}/v1`, attemptId, baseRevisionId, timestamp).lastInsertRowid);
			this.database
				.prepare("insert into attempt_effects(workflow_id, task_id, attempt_id, effect_type, logical_key, artifact_kind, effect_version, payload_document_id, payload_digest, state, published_artifact_revision_id, created_at) values (?, ?, ?, 'artifact_revision', ?, ?, ?, ?, ?, 'published', ?, ?)")
				.run(workflowId, attempt.task_id, attemptId, effect.logicalKey, effect.artifactKind, 1, contentSnapshot.id, contentSnapshot.digest, revisionId, timestamp);
		this.appendEvent(workflowId, "artifact_revision_published", newVersion, "artifact_revision", revisionId, 1, { artifactKind: effect.artifactKind, artifactId, revisionNo, contentDigest: contentSnapshot.digest, sourceAttemptId: attemptId }, timestamp);
		if (effect.traceLinks) {
			for (const link of effect.traceLinks) {
				this.database
					.prepare("insert into trace_links(artifact_revision_id, evidence_snapshot_id, source_ref_json, created_at) values (?, ?, ?, ?)")
					.run(revisionId, link.evidenceSnapshotId, this.options.hashProvider.canonicalize(link.sourceRef), timestamp);
			}
		}
		}
		if (result.decisionProposals) {
			for (const proposal of result.decisionProposals) {
				const decisionId = Number(this.database
					.prepare("insert into decisions(workflow_id, task_attempt_id, severity, summary, status, created_at) values (?, ?, ?, ?, 'open', ?)")
					.run(workflowId, attemptId, proposal.severity, proposal.summary, timestamp).lastInsertRowid);
				this.appendEvent(workflowId, "decision_raised", newVersion, "decision", decisionId, 0, { severity: proposal.severity, summary: proposal.summary }, timestamp);
			}
		}
		this.database.prepare("update task_attempts set status = 'succeeded', completed_at = ? where id = ?").run(timestamp, attemptId);
		this.database.prepare("update runs set status = 'completed', completed_at = ? where id = ?").run(timestamp, runId);
		this.database.prepare("update tasks set status = 'completed' where id = ?").run(attempt.task_id);
		this.database.prepare("update governance_claims set status = 'released', released_at = ? where attempt_id = ? and status = 'active'").run(timestamp, attemptId);
		this.database.prepare("update workflows set version = ?, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);

		this.appendEvent(workflowId, "attempt_succeeded", newVersion, "task_attempt", attemptId, 0, { taskId: attempt.task_id, attemptNo: attempt.attempt_no }, timestamp);
		this.appendEvent(workflowId, "run_completed", newVersion, "run", runId, 0, { attemptId }, timestamp);
		this.appendEvent(workflowId, "task_completed", newVersion, "task", attempt.task_id, 0, { taskKey: task.key }, timestamp);
		this.appendEvent(workflowId, "workflow_attempt_claim_released", newVersion, "task_attempt", attemptId, 0, { attemptId }, timestamp);

		this.options.crashInjector.reach("publish_attempt.before_commit");
		return { outcome: "published", failureCode: null, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
	}

	failAttempt(workflowId: number, attemptId: number, failureCode: string, failureDetail: string): CompleteAttemptResult {
		const tx = this.database.transaction(() => this.failAttemptRows(workflowId, attemptId, failureCode, failureDetail)).immediate;
		return tx();
	}

	private failAttemptRows(workflowId: number, attemptId: number, failureCode: string, failureDetail: string): CompleteAttemptResult {
		const timestamp = this.options.clock.now().toISOString();
		const workflow = this.database.prepare("select version from workflows where id = ?").get(workflowId) as { version: number };
		const attempt = this.database.prepare("select task_id, attempt_no from task_attempts where id = ?").get(attemptId) as { task_id: number; attempt_no: number };
		const task = this.database.prepare("select id, key, max_attempts from tasks where id = ?").get(attempt.task_id) as { id: number; key: string; max_attempts: number };
		const newVersion = workflow.version + 1;
		const runId = (this.database.prepare("select id from runs where attempt_id = ? order by id desc limit 1").get(attemptId) as { id: number }).id;

		this.database.prepare("update task_attempts set status = 'failed', completed_at = ? where id = ?").run(timestamp, attemptId);
		this.database.prepare("update runs set status = 'failed', completed_at = ? where id = ?").run(timestamp, runId);
		this.database.prepare("update governance_claims set status = 'released', released_at = ? where attempt_id = ? and status = 'active'").run(timestamp, attemptId);

		this.appendEvent(workflowId, "attempt_failed", newVersion, "task_attempt", attemptId, 0, { taskId: attempt.task_id, attemptNo: attempt.attempt_no, failureCode, failureDetail }, timestamp);
		this.appendEvent(workflowId, "run_failed", newVersion, "run", runId, 0, { attemptId, failureCode }, timestamp);
		this.appendEvent(workflowId, "workflow_attempt_claim_released", newVersion, "task_attempt", attemptId, 0, { attemptId }, timestamp);

		const failedCount = (this.database.prepare("select count(*) as count from task_attempts where task_id = ? and status = 'failed'").get(attempt.task_id) as { count: number }).count;
		let outcome: CompleteAttemptResult["outcome"] = "failed";
		if (failedCount >= task.max_attempts) {
			this.database.prepare("update tasks set status = 'failed' where id = ?").run(attempt.task_id);
			this.database.prepare("update workflows set state = 'failed', version = ?, current_failure_code = 'task_budget_exhausted', updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);
			this.appendEvent(workflowId, "task_failed", newVersion, "task", attempt.task_id, 0, { taskKey: task.key, failureCode }, timestamp);
			this.appendEvent(workflowId, "workflow_failed", newVersion, "workflow", workflowId, newVersion, { failureCode: "task_budget_exhausted" }, timestamp);
			outcome = "task_exhausted";
		} else {
			this.database.prepare("update tasks set status = 'pending' where id = ?").run(attempt.task_id);
			this.database.prepare("update workflows set version = ?, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);
		}

		this.options.crashInjector.reach("fail_attempt.before_commit");
		return { outcome, failureCode, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
	}

	private blockAttemptRows(workflowId: number, attemptId: number, blockReason: string, timestamp: string): CompleteAttemptResult {
		const workflow = this.database.prepare("select version from workflows where id = ?").get(workflowId) as { version: number };
		const attempt = this.database.prepare("select task_id, attempt_no from task_attempts where id = ?").get(attemptId) as { task_id: number; attempt_no: number };
		const task = this.database.prepare("select key from tasks where id = ?").get(attempt.task_id) as { key: string };
		const newVersion = workflow.version + 1;
		const runId = (this.database.prepare("select id from runs where attempt_id = ? order by id desc limit 1").get(attemptId) as { id: number }).id;

		this.database.prepare("update task_attempts set status = 'blocked', result_outcome = 'blocked', completed_at = ? where id = ?").run(timestamp, attemptId);
		this.database.prepare("update runs set status = 'completed', completed_at = ? where id = ?").run(timestamp, runId);
		this.database.prepare("update tasks set status = 'blocked' where id = ?").run(attempt.task_id);
		this.database.prepare("update governance_claims set status = 'released', released_at = ? where attempt_id = ? and status = 'active'").run(timestamp, attemptId);
		this.database.prepare("update workflows set state = 'waiting_for_human', version = ?, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);
		this.database
			.prepare("insert into human_gates(workflow_id, gate_type, subject_type, subject_id, status, opened_at) values (?, 'human_input', 'task_attempt', ?, 'open', ?)")
			.run(workflowId, attemptId, timestamp);

		this.appendEvent(workflowId, "task_blocked", newVersion, "task", attempt.task_id, 0, { taskKey: task.key, blockReason }, timestamp);
		this.appendEvent(workflowId, "attempt_blocked", newVersion, "task_attempt", attemptId, 0, { taskId: attempt.task_id, blockReason }, timestamp);
		this.appendEvent(workflowId, "run_completed", newVersion, "run", runId, 0, { attemptId }, timestamp);
		this.appendEvent(workflowId, "workflow_attempt_claim_released", newVersion, "task_attempt", attemptId, 0, { attemptId }, timestamp);

		this.options.crashInjector.reach("block_attempt.before_commit");
		return { outcome: "blocked", failureCode: null, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
	}

	private replanRequestedRows(workflowId: number, attemptId: number, replanReason: string, timestamp: string): CompleteAttemptResult {
		const workflow = this.database.prepare("select version from workflows where id = ?").get(workflowId) as { version: number };
		const attempt = this.database.prepare("select task_id, attempt_no from task_attempts where id = ?").get(attemptId) as { task_id: number; attempt_no: number };
		const task = this.database.prepare("select key from tasks where id = ?").get(attempt.task_id) as { key: string };
		const newVersion = workflow.version + 1;
		const runId = (this.database.prepare("select id from runs where attempt_id = ? order by id desc limit 1").get(attemptId) as { id: number }).id;

		this.database.prepare("update task_attempts set status = 'replan_requested', result_outcome = 'replan_requested', completed_at = ? where id = ?").run(timestamp, attemptId);
		this.database.prepare("update runs set status = 'completed', completed_at = ? where id = ?").run(timestamp, runId);
		this.database.prepare("update tasks set status = 'replan_requested' where id = ?").run(attempt.task_id);
		this.database.prepare("update governance_claims set status = 'released', released_at = ? where attempt_id = ? and status = 'active'").run(timestamp, attemptId);
		this.database.prepare("update workflows set version = ?, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);

		this.appendEvent(workflowId, "replan_requested", newVersion, "task", attempt.task_id, 0, { taskKey: task.key, replanReason }, timestamp);
		this.appendEvent(workflowId, "attempt_replan_requested", newVersion, "task_attempt", attemptId, 0, { taskId: attempt.task_id, replanReason }, timestamp);
		this.appendEvent(workflowId, "run_completed", newVersion, "run", runId, 0, { attemptId }, timestamp);
		this.appendEvent(workflowId, "workflow_attempt_claim_released", newVersion, "task_attempt", attemptId, 0, { attemptId }, timestamp);

		this.options.crashInjector.reach("replan_requested.before_commit");
		return { outcome: "replan_requested", failureCode: null, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
	}

	private currentLastEventSeq(workflowId: number): number {
		return (this.database.prepare("select last_event_seq from workflows where id = ?").get(workflowId) as { last_event_seq: number }).last_event_seq;
	}








	acceptFindingRisk(workflowId: number, findingId: number, operator: string, reason: string): void {
		const tx = this.database.transaction(() => {
			const timestamp = this.options.clock.now().toISOString();
			const finding = this.database
				.prepare("select severity, status, thread_id from findings where id = ? and workflow_id = ?")
				.get(findingId, workflowId) as { severity: string; status: string; thread_id: number } | undefined;
			if (!finding) throw new Error("Finding not found");
			if (finding.severity === "critical") throw new Error("Critical findings cannot be risk accepted");
			if (finding.status === "resolved") throw new Error("Resolved findings cannot be risk accepted");
			this.database
				.prepare("update findings set status = 'risk_accepted', risk_accepted_by = ?, risk_acceptance_reason = ?, resolved_at = ? where id = ?")
				.run(operator, reason, timestamp, findingId);
			this.database
				.prepare("update finding_threads set status = 'risk_accepted', updated_at = ? where id = ?")
				.run(timestamp, finding.thread_id);
			const newVersion = (this.database.prepare("select version from workflows where id = ?").get(workflowId) as { version: number }).version + 1;
			this.appendEvent(workflowId, "finding_risk_accepted", newVersion, "finding", findingId, 0, { findingId, operator, reason }, timestamp);
			this.database.prepare("update workflows set version = ?, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);
		}).immediate;
		tx();
	}


	private publishCriticReportRows(
		workflowId: number,
		attemptId: number,
		result: RoleResult,
		task: { id: number; key: string; kind: string; role: string; expected_artifact_effects_json: string; max_attempts: number; plan_revision_id: number },
		workflow: { version: number },
		timestamp: string,
	): CompleteAttemptResult {
		if (result.effects.length > 0) {
			return this.failAttemptRows(workflowId, attemptId, "critic_effect_violation", "Critic cannot produce artifact effects");
		}
		const report = result.criticReport;
		if (!report || report.schemaVersion !== "critic-report/v1" || typeof report.workflowId !== "number" || typeof report.attemptId !== "number" || !report.coverageAttestation || !Array.isArray(report.findings)) {
			return this.failAttemptRows(workflowId, attemptId, "invalid_critic_report", "CriticReport schema validation failed");
		}
		if (report.workflowId !== workflowId || report.attemptId !== attemptId) {
			return this.failAttemptRows(workflowId, attemptId, "critic_report_mismatch", "CriticReport workflow or attempt mismatch");
		}
		if (!report.coverageAttestation.complete) {
			return this.failAttemptRows(workflowId, attemptId, "incomplete_coverage", "Coverage attestation is not complete");
		}
		if (report.findings.length === 0 && !report.coverageAttestation.complete) {
			return this.failAttemptRows(workflowId, attemptId, "incomplete_coverage", "Zero findings require complete coverage attestation");
		}
		const newVersion = workflow.version + 1;
		const runId = (this.database.prepare("select id from runs where attempt_id = ? order by id desc limit 1").get(attemptId) as { id: number }).id;
		const isVerify = task.kind === "verify";

		for (const target of report.coverageAttestation.reviewTargets) {
			// 校验 coverage 目标属于本 workflow 的产物 revision（防止 critic 加持无关 revision 使 approve 门禁通过）
			const owned = this.database
				.prepare("select ar.id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id join requirements r on r.id = a.requirement_id join workflows w on w.requirement_id = r.id where w.id = ? and ar.id = ? and a.kind = ?")
				.get(workflowId, target.revisionId, target.artifactKind) as { id: number } | undefined;
			if (!owned) {
				return this.failAttemptRows(workflowId, attemptId, "coverage_target_not_owned", `Coverage target ${target.revisionId} (${target.artifactKind}) does not belong to this workflow`);
			}
			this.database
				.prepare("insert into critic_coverage_targets(workflow_id, task_attempt_id, revision_id, artifact_kind, created_at) values (?, ?, ?, ?, ?)")
				.run(workflowId, attemptId, target.revisionId, target.artifactKind, timestamp);
		}

		if (isVerify) {
			const taskRow = this.database.prepare("select inputs_json from tasks where id = ?").get(task.id) as { inputs_json: string };
			const inputs = parseJson<readonly InputBinding[]>(taskRow.inputs_json);
			const targetedFindingIds = inputs.filter((i): i is { type: "finding"; findingId: number; targetRevisionId: number; purpose: string } => i.type === "finding").map((i) => i.findingId);
			const targetedFingerprints = new Set(
				targetedFindingIds.map((fid) => (this.database.prepare("select fingerprint from findings where id = ?").get(fid) as { fingerprint: string } | undefined)?.fingerprint).filter(Boolean),
			);
			for (const proposal of report.findings) {
				if (!targetedFingerprints.has(proposal.fingerprint)) {
					return this.failAttemptRows(workflowId, attemptId, "finding_not_in_attempt", `Finding fingerprint ${proposal.fingerprint} does not match any targeted Finding`);
				}
			}
			for (const proposal of report.findings) {
				const thread = this.database
					.prepare("select id, rework_count from finding_threads where workflow_id = ? and fingerprint = ?")
					.get(workflowId, proposal.fingerprint) as { id: number; rework_count: number } | undefined;
				if (!thread) {
					return this.failAttemptRows(workflowId, attemptId, "finding_thread_not_found", `No Finding Thread for fingerprint ${proposal.fingerprint}`);
				}
				const finding = this.database
					.prepare("select id, severity from findings where workflow_id = ? and fingerprint = ? and status = 'open' order by id desc limit 1")
					.get(workflowId, proposal.fingerprint) as { id: number; severity: string } | undefined;
				if (!finding) {
					return this.failAttemptRows(workflowId, attemptId, "open_finding_not_found", `No open Finding for fingerprint ${proposal.fingerprint}`);
				}
				if (proposal.resolved === true) {
					this.database.prepare("update findings set status = 'resolved', resolved_at = ? where id = ?").run(timestamp, finding.id);
					this.database.prepare("update finding_threads set status = 'resolved', updated_at = ? where id = ?").run(timestamp, thread.id);
					this.appendEvent(workflowId, "finding_resolved", newVersion, "finding", finding.id, 0, { fingerprint: proposal.fingerprint }, timestamp);
				} else {
					const newCount = thread.rework_count + 1;
					if (newCount >= 2) {
						this.database.prepare("update finding_threads set rework_count = ?, status = 'human_gate', updated_at = ? where id = ?").run(newCount, timestamp, thread.id);
						this.database.prepare("update workflows set state = 'waiting_for_human', version = ?, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);
						this.database
							.prepare("insert into human_gates(workflow_id, gate_type, subject_type, subject_id, status, opened_at) values (?, 'finding_disposition', 'finding_thread', ?, 'open', ?)")
							.run(workflowId, thread.id, timestamp);
						this.appendEvent(workflowId, "finding_thread_escalated", newVersion, "finding_thread", thread.id, 0, { fingerprint: proposal.fingerprint, reworkCount: newCount }, timestamp);
					} else {
						this.database.prepare("update finding_threads set rework_count = ?, updated_at = ? where id = ?").run(newCount, timestamp, thread.id);
						this.appendEvent(workflowId, "finding_not_resolved", newVersion, "finding_thread", thread.id, 0, { fingerprint: proposal.fingerprint, reworkCount: newCount }, timestamp);
					}
				}
			}
		} else {
			for (const proposal of report.findings) {
				const severity = proposal.severity as FindingSeverity;
				let thread = this.database
					.prepare("select id from finding_threads where workflow_id = ? and fingerprint = ?")
					.get(workflowId, proposal.fingerprint) as { id: number } | undefined;
				if (!thread) {
					const threadId = Number(this.database
						.prepare("insert into finding_threads(workflow_id, fingerprint, status, created_at, updated_at) values (?, ?, 'open', ?, ?)")
						.run(workflowId, proposal.fingerprint, timestamp, timestamp).lastInsertRowid);
					thread = { id: threadId };
				}
				const findingId = Number(this.database
					.prepare("insert into findings(workflow_id, task_attempt_id, thread_id, fingerprint, severity, status, summary, target_revision_id, target_artifact_kind, source_ref, evidence_json, created_at) values (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)")
					.run(workflowId, attemptId, thread.id, proposal.fingerprint, severity, proposal.summary, proposal.targetRevisionId, proposal.targetArtifactKind, proposal.sourceRef, proposal.evidence !== undefined ? JSON.stringify(proposal.evidence) : null, timestamp).lastInsertRowid);
				this.appendEvent(workflowId, "finding_recorded", newVersion, "finding", findingId, 0, { fingerprint: proposal.fingerprint, severity, targetRevisionId: proposal.targetRevisionId, targetArtifactKind: proposal.targetArtifactKind }, timestamp);
			}
		}

		this.database.prepare("update task_attempts set status = 'succeeded', completed_at = ? where id = ?").run(timestamp, attemptId);
		this.database.prepare("update runs set status = 'completed', completed_at = ? where id = ?").run(timestamp, runId);
		this.database.prepare("update tasks set status = 'completed' where id = ?").run(task.id);
		this.database.prepare("update governance_claims set status = 'released', released_at = ? where attempt_id = ? and status = 'active'").run(timestamp, attemptId);
		if (!isVerify || report.findings.every((f) => f.resolved === true) || report.findings.length === 0) {
			this.database.prepare("update workflows set version = ?, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);
		}
		this.appendEvent(workflowId, "attempt_succeeded", newVersion, "task_attempt", attemptId, 0, { taskId: task.id, attemptNo: (this.database.prepare("select attempt_no from task_attempts where id = ?").get(attemptId) as { attempt_no: number }).attempt_no }, timestamp);
		this.appendEvent(workflowId, "run_completed", newVersion, "run", runId, 0, { attemptId }, timestamp);
		this.appendEvent(workflowId, "task_completed", newVersion, "task", task.id, 0, { taskKey: task.key }, timestamp);
		this.appendEvent(workflowId, "workflow_attempt_claim_released", newVersion, "task_attempt", attemptId, 0, { attemptId }, timestamp);
		this.options.crashInjector.reach("publish_attempt.before_commit");
		return { outcome: "published", failureCode: null, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
	}


	private currentRevisionForKind(requirementId: number, kind: string): { id: number; status: string; content_digest: string; revision_no: number; artifact_id: number } | undefined {
		return this.database
			.prepare("select ar.id, ar.status, ar.content_digest, ar.revision_no, ar.artifact_id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.requirement_id = ? and a.kind = ? order by ar.id desc limit 1")
			.get(requirementId, kind) as { id: number; status: string; content_digest: string; revision_no: number; artifact_id: number } | undefined;
	}

	/** 模板固定必需产物集（#12 决议：废除 Impact Profile 派生，模板 8 生产 kinds 即必需集）。 */

	/** 模板产物状态（当前 revision 存在性 + trace link 覆盖），供 readiness 与 approval packet 组装使用。 */
	private getTemplateArtifactStatuses(requirementId: number): Array<{ kind: string; hasCurrentRevision: boolean; hasTraceLinks: boolean }> {
		return TEMPLATE_REQUIRED_KINDS
			.filter((kind) => kind !== "requirement")
			.map((kind) => {
				const revision = this.currentRevisionForKind(requirementId, kind);
				if (!revision) return { kind, hasCurrentRevision: false, hasTraceLinks: false };
				const traceCount = this.database
					.prepare("select count(*) as count from trace_links where artifact_revision_id = ?")
					.get(revision.id) as { count: number };
				return { kind, hasCurrentRevision: true, hasTraceLinks: traceCount.count > 0 };
			});
	}


	private assembleApprovalPacketContent(workflowId: number): Record<string, unknown> {
		const projection = this.readModel.getWorkflowProjection(workflowId);
		if (!projection) throw new Error("Workflow not found");
		const requirementId = projection.requirement.id;
		const artifactRows = this.getTemplateArtifactStatuses(requirementId)
			.filter((status) => status.hasCurrentRevision)
			.map((status) => {
				const revision = this.currentRevisionForKind(requirementId, status.kind)!;
				return { artifactId: revision.artifact_id, revisionId: revision.id, kind: status.kind, revisionNo: revision.revision_no, status: revision.status, contentDigest: revision.content_digest };
			})
			.sort((left, right) => left.kind.localeCompare(right.kind));
		const decisions = this.readModel.getDecisions(workflowId).map((decision) => ({
			id: decision.id,
			severity: decision.severity,
			status: decision.status,
			summary: decision.summary,
			reason: decision.reason,
			owner: decision.owner,
			followUpTarget: decision.followUpTarget,
		}));
		const findings = this.readModel.getFindings(workflowId).map((finding) => ({
			id: finding.id,
			fingerprint: finding.fingerprint,
			severity: finding.severity,
			status: finding.status,
			summary: finding.summary,
			targetRevisionId: finding.targetRevisionId,
			riskAcceptedBy: finding.riskAcceptedBy,
			riskAcceptanceReason: finding.riskAcceptanceReason,
		}));
		const disclosedFindingIds = findings.filter((finding) => (finding.severity === "minor" || finding.severity === "info") && finding.status === "open").map((finding) => finding.id).sort((a, b) => a - b);
		const coveredRevisionIds = (this.database
			.prepare("select distinct revision_id from critic_coverage_targets where workflow_id = ? order by revision_id")
			.all(workflowId) as Array<{ revision_id: number }>).map((row) => row.revision_id);
		const orphanEvidence = (this.database
			.prepare("select count(*) as count from evidence_snapshots es where es.workflow_id = ? and not exists (select 1 from trace_links tl where tl.evidence_snapshot_id = es.id)")
			.get(workflowId) as { count: number }).count;
		const packetWarnings: string[] = [];
		if (orphanEvidence > 0) packetWarnings.push(`${orphanEvidence} evidence snapshot(s) are not referenced by any TraceLink`);
		return {
			schemaVersion: "approval-packet/v1",
			workflowId,
			requirementRevisionId: projection.requirement.currentRevision.id,
			artifacts: artifactRows,
			decisions,
			findings,
			disclosedFindingIds,
			criticCoverage: { coveredRevisionIds },
			warnings: packetWarnings,
			policyBundleDigest: projection.workflow.policyBundle.digest,
			requiredArtifactKinds: [...TEMPLATE_REQUIRED_KINDS].sort(),
		};
	}

	buildApprovalPacket(workflowId: number): BuildApprovalPacketResult {
		const tx = this.database.transaction(() => this.buildApprovalPacketRows(workflowId)).immediate;
		return tx();
	}

	private buildApprovalPacketRows(workflowId: number): BuildApprovalPacketResult {
		const timestamp = this.options.clock.now().toISOString();
		const report = this.readModel.checkReadiness(workflowId);
		const workflow = this.database.prepare("select state, version from workflows where id = ?").get(workflowId) as { state: string; version: number };
		if (!report.ready) {
			if (workflow.state === "ready_to_archive") {
				const newVersion = workflow.version + 1;
				this.database.prepare("update workflows set state = 'running', version = ?, current_approval_packet_id = null, updated_at = ? where id = ?").run(newVersion, timestamp, workflowId);
				this.appendEvent(workflowId, "readiness_withdrawn", newVersion, "workflow", workflowId, newVersion, { failedChecks: report.checks.filter((check) => !check.passed).map((check) => check.name) }, timestamp);
				return { ready: false, packetId: null, digest: null, checks: report.checks, warnings: report.warnings, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
			}
			return { ready: false, packetId: null, digest: null, checks: report.checks, warnings: report.warnings, workflowVersion: workflow.version, lastEventSeq: this.currentLastEventSeq(workflowId) };
		}
		const content = this.assembleApprovalPacketContent(workflowId);
		const digest = this.options.hashProvider.digest(content);
		const existingPacket = this.database.prepare("select id, status from approval_packets where workflow_id = ? and digest = ?").get(workflowId, digest) as { id: number; status: string } | undefined;
		if (existingPacket && existingPacket.status === "rejected") {
			const checks = [...report.checks, { name: "packet_not_previously_rejected", passed: false, detail: "ApprovalPacket with the same digest was rejected; governed inputs must change before resubmission" }];
			return { ready: false, packetId: null, digest: null, checks, warnings: report.warnings, workflowVersion: workflow.version, lastEventSeq: this.currentLastEventSeq(workflowId) };
		}
		let packetId = existingPacket?.id;
		if (packetId === undefined) {
			packetId = Number(this.database
				.prepare("insert into approval_packets(workflow_id, digest, content_json, created_at) values (?, ?, ?, ?)")
				.run(workflowId, digest, this.options.hashProvider.canonicalize(content), timestamp).lastInsertRowid);
		}
		if (workflow.state === "ready_to_archive") {
			this.database.prepare("update workflows set current_approval_packet_id = ?, updated_at = ? where id = ?").run(packetId, timestamp, workflowId);
			return { ready: true, packetId, digest, checks: report.checks, warnings: report.warnings, workflowVersion: workflow.version, lastEventSeq: this.currentLastEventSeq(workflowId) };
		}
		const newVersion = workflow.version + 1;
		this.database.prepare("update workflows set state = 'ready_to_archive', version = ?, current_approval_packet_id = ?, updated_at = ? where id = ?").run(newVersion, packetId, timestamp, workflowId);
		this.appendEvent(workflowId, "workflow_ready_to_archive", newVersion, "workflow", workflowId, newVersion, { approvalPacketId: packetId, digest }, timestamp);
		return { ready: true, packetId, digest, checks: report.checks, warnings: report.warnings, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
	}








	/** #23 FTS5 检索（#23）：增量回填 + workspace 限定 trigram 检索（公开面 excerpt-only，泄漏原始内容到 API 属过度暴露）。 */



	/** #24 回授注入：按检索相关性取 top-N 历史资产引用（排除本需求 promote 的资产），预算内截断。 */












	/** 当前产物 revision 的只读详情（含内容快照），供 SPA 产物内容查看器消费。 */





	/** 读 attempt 的 contextManifest + requirement baseline 内容,供 executor 拼接 prompt。 */


	/** 查找 pending 产物中有 critic coverage 且无 open major/critical 的:可自动批准。 */









	/** #22 promote：按 kind 条目拆细入库（幂等、可批选）。返回每 kind 入资产条数。 */
	promoteRequirementArtifacts(
		workflowId: number,
		kinds: readonly string[],
		options?: { skipAlreadyPromoted?: boolean; originApprovalId?: number | null },
	): Record<string, number> {
		const projection = this.readModel.getWorkflowProjection(workflowId);
		if (!projection) throw new Error("Workflow not found");
		const requirementId = projection.requirement.id;
		const workspaceId = projection.requirement.workspaceId;
		const counts: Record<string, number> = {};
		for (const kind of kinds) {
			const artifact = this.database
				.prepare("select id from artifacts where requirement_id = ? and kind = ?")
				.get(requirementId, kind) as { id: number } | undefined;
			if (!artifact) {
				counts[kind] = 0;
				continue;
			}
			if (options?.skipAlreadyPromoted && this.assetStore.assetExistsByOriginArtifactId(workspaceId, artifact.id)) {
				counts[kind] = 0;
				continue;
			}
			const revision = typeof options?.originApprovalId === "number"
				? this.database
					.prepare(`select ar.id, ar.content_digest, d.content from artifact_revisions ar
						join snapshot_documents d on d.id = ar.content_document_id
						where ar.artifact_id = ? and ar.status = 'approved'
						order by ar.id desc limit 1`)
					.get(artifact.id) as { id: number; content_digest: string; content: string } | undefined
				: this.database
					.prepare(`select ar.id, ar.content_digest, d.content from artifact_revisions ar
						join snapshot_documents d on d.id = ar.content_document_id
						where ar.artifact_id = ? and ar.status = 'approved'
						and exists (select 1 from approval_records approval where approval.workflow_id = ? and approval.record_type = 'artifact_approval' and approval.subject_type = 'artifact_revision' and approval.subject_id = ar.id)
						order by ar.id desc limit 1`)
					.get(artifact.id, workflowId) as { id: number; content_digest: string; content: string } | undefined;
			if (!revision) {
				counts[kind] = 0;
				continue;
			}
			const approval = this.database
				.prepare("select id from approval_records where workflow_id = ? and record_type = 'artifact_approval' and subject_type = 'artifact_revision' and subject_id = ? order by id desc limit 1")
				.get(workflowId, revision.id) as { id: number } | undefined;
		if (kind === "scenario" || kind === "function") {
			const nodes = this.extractHierarchyNodes(kind, revision.content);
			const assetIdByNodeId = new Map<string, number>();
			for (const node of nodes) {
				const promoted = this.assetStore.upsertReusableAssetByTitle({
					workspaceId,
					kind: node.assetKind as ReusableAssetKind,
					title: node.title,
					content: node.content,
					originRequirementId: requirementId,
					originArtifactId: artifact.id,
					originApprovalId: options?.originApprovalId ?? approval?.id ?? null,
				});
				this.buildStakeholderInvolvementRelations(workspaceId, node.assetKind, promoted.assetId, promoted.revisionId, node.content);
				assetIdByNodeId.set(node.nodeId, promoted.assetId);
				if (node.parentNodeId) {
					const parentId = assetIdByNodeId.get(node.parentNodeId);
					if (parentId) {
					this.assetStore.writeRelations({ workspaceId, fromAssetId: parentId, fromRevisionId: this.assetStore.getReusableAsset(parentId)!.currentRevisionId!, relations: [{ toAssetId: promoted.assetId, type: "contains", position: node.position }] });
					}
				}
			}
			counts[kind] = nodes.length;
		} else {
			const items = this.extractAssetItems(kind, revision.content);
			for (const item of items) {
				const promoted = this.assetStore.upsertReusableAssetByTitle({
					workspaceId,
					kind: item.assetKind as ReusableAssetKind,
					title: item.title,
					content: item.content,
					originRequirementId: requirementId,
					originArtifactId: artifact.id,
					originApprovalId: options?.originApprovalId ?? approval?.id ?? null,
				});
				this.buildStakeholderInvolvementRelations(workspaceId, item.assetKind, promoted.assetId, promoted.revisionId, item.content);
			}
			counts[kind] = items.length;
	}
	}
		return counts;
	}

	private buildStakeholderInvolvementRelations(
		workspaceId: number,
		kind: string,
		fromAssetId: number,
		fromRevisionId: number,
		content: unknown,
	): void {
		if (kind !== "scenario-variant" && kind !== "usecase") return;
		this.assetStore.deleteOutgoingRelations(fromAssetId, "involves");
		const actorNames: string[] = [];
		if (typeof content !== "object" || content === null || Array.isArray(content)) return;
		const record = content as { actors?: unknown; actor?: unknown };
		if (kind === "scenario-variant" && Array.isArray(record.actors)) {
			for (const actor of record.actors) if (typeof actor === "string") actorNames.push(actor);
		}
		if (kind === "usecase" && typeof record.actor === "string") actorNames.push(record.actor);
		const relations: AssetRelationInput[] = [];
		for (const actorName of actorNames) {
			const stakeholder = this.assetStore.findStakeholderByName(workspaceId, actorName);
			if (stakeholder) relations.push({ toAssetId: stakeholder.assetId, type: "involves" });
		}
		if (relations.length > 0) this.assetStore.writeRelations({ workspaceId, fromAssetId, fromRevisionId, relations });
	}

	/** 条目级拆解（#14 决议）：按 kind 结构抽条目（标题 + 内容对象）。 */
	private extractAssetItems(kind: string, contentJson: string): Array<{ title: string; content: unknown; assetKind: string }> {
		const content = parseJson<Record<string, unknown>>(contentJson);
		const items: Array<{ title: string; content: unknown; assetKind: string }> = [];
		switch (kind) {
			case "scenario": {
				const domains = content.domains as ReadonlyArray<{ scenarios?: ReadonlyArray<{ variants?: ReadonlyArray<{ title?: unknown; nodeId?: unknown }> }> }> | undefined;
				for (const domain of domains ?? []) {
					for (const scenario of domain.scenarios ?? []) {
						for (const variant of scenario.variants ?? []) {
							if (typeof variant.title !== "string" || variant.title.length === 0) continue;
						items.push({ title: variant.title, content: { ...variant, nodeId: variant.nodeId ?? variant.title }, assetKind: "scenario-variant" });
						}
					}
				}
				break;
			}
			case "usecase": {
				const useCases = content.useCases as ReadonlyArray<{ goal?: unknown }> | undefined;
				for (const useCase of useCases ?? []) {
					if (typeof useCase.goal !== "string" || useCase.goal.length === 0) continue;
				items.push({ title: useCase.goal, content: useCase, assetKind: "usecase" });
				}
				break;
			}
			case "function": {
				const domains = content.domains as ReadonlyArray<{ items?: ReadonlyArray<{ points?: ReadonlyArray<{ name?: unknown; nodeId?: unknown }> }> }> | undefined;
				for (const domain of domains ?? []) {
					for (const item of domain.items ?? []) {
						for (const point of item.points ?? []) {
							if (typeof point.name !== "string" || point.name.length === 0) continue;
						items.push({ title: point.name, content: { ...point, nodeId: point.nodeId ?? point.name }, assetKind: "function-point" });
						}
					}
				}
				break;
			}
			case "design": {
				const units = content.changeUnits as ReadonlyArray<{ area?: unknown; change?: unknown }> | undefined;
				for (const unit of units ?? []) {
					const area = typeof unit.area === "string" ? unit.area : "";
					const change = typeof unit.change === "string" ? unit.change : "";
					if (area.length === 0 && change.length === 0) continue;
				items.push({ title: `${area}${change ? `: ${change}` : ""}`, content: unit, assetKind: "design" });
				}
				break;
			}
			case "architecture": {
				const components = content.components as ReadonlyArray<{ name?: unknown }> | undefined;
				for (const component of components ?? []) {
					if (typeof component.name !== "string" || component.name.length === 0) continue;
				items.push({ title: component.name, content: component, assetKind: "architecture" });
				}
				break;
			}
			case "data": {
				const entities = content.entities as ReadonlyArray<{ name?: unknown }> | undefined;
				for (const entity of entities ?? []) {
					if (typeof entity.name !== "string" || entity.name.length === 0) continue;
				items.push({ title: entity.name, content: entity, assetKind: "data" });
				}
				break;
			}
			case "api": {
				const paths = content.paths as Record<string, unknown> | undefined;
				if (paths && typeof paths === "object") {
					for (const [path, item] of Object.entries(paths)) {
						if (typeof item !== "object" || item === null) continue;
						const record = item as Record<string, unknown>;
						const summary = typeof record.summary === "string" ? record.summary : path;
					items.push({ title: summary, content: { path, ...record }, assetKind: "api" });
					}
				}
				break;
			}
			default:
				break;
		}
		return items;
	}

	private extractHierarchyNodes(kind: string, contentJson: string): Array<{ title: string; content: unknown; assetKind: string; nodeId: string; parentNodeId: string | undefined; position: number }> {
		const content = parseJson<Record<string, unknown>>(contentJson);
		const nodes: Array<{ title: string; content: unknown; assetKind: string; nodeId: string; parentNodeId: string | undefined; position: number }> = [];
		if (kind === "scenario") {
			const domains = content.domains as ReadonlyArray<{ nodeId?: string; title?: string; scenarios?: ReadonlyArray<{ nodeId?: string; title?: string; variants?: ReadonlyArray<Record<string, unknown>> }> }> | undefined;
			for (let di = 0; di < (domains ?? []).length; di++) {
				const domain = domains![di]!;
				const dNodeId = domain.nodeId ?? `d${di}`;
			nodes.push({ title: domain.title ?? dNodeId, content: { schemaVersion: "asset/scenario-domain/v1", nodeId: dNodeId, title: domain.title ?? dNodeId }, assetKind: "scenario-domain", nodeId: dNodeId, parentNodeId: undefined, position: di });
				for (let si = 0; si < (domain.scenarios ?? []).length; si++) {
					const scenario = domain.scenarios![si]!;
					const sNodeId = scenario.nodeId ?? `s${di}-${si}`;
				nodes.push({ title: scenario.title ?? sNodeId, content: { schemaVersion: "asset/scenario/v1", nodeId: sNodeId, title: scenario.title ?? sNodeId }, assetKind: "scenario", nodeId: sNodeId, parentNodeId: dNodeId, position: si });
					for (let vi = 0; vi < (scenario.variants ?? []).length; vi++) {
						const variant = scenario.variants![vi]!;
						const vNodeId = typeof variant.nodeId === "string" ? variant.nodeId : `v${di}-${si}-${vi}`;
						const vTitle = typeof variant.title === "string" ? variant.title : vNodeId;
						nodes.push({ title: vTitle, content: { ...variant, nodeId: vNodeId }, assetKind: "scenario-variant", nodeId: vNodeId, parentNodeId: sNodeId, position: vi });
					}
				}
			}
		} else if (kind === "function") {
			const domains = content.domains as ReadonlyArray<{ nodeId?: string; title?: string; items?: ReadonlyArray<{ nodeId?: string; title?: string; points?: ReadonlyArray<Record<string, unknown>> }> }> | undefined;
			for (let di = 0; di < (domains ?? []).length; di++) {
				const domain = domains![di]!;
				const dNodeId = domain.nodeId ?? `fd${di}`;
			nodes.push({ title: domain.title ?? dNodeId, content: { schemaVersion: "asset/function-domain/v1", nodeId: dNodeId, title: domain.title ?? dNodeId }, assetKind: "function-domain", nodeId: dNodeId, parentNodeId: undefined, position: di });
				for (let ii = 0; ii < (domain.items ?? []).length; ii++) {
					const item = domain.items![ii]!;
					const iNodeId = item.nodeId ?? `fi${di}-${ii}`;
				nodes.push({ title: item.title ?? iNodeId, content: { schemaVersion: "asset/function-item/v1", nodeId: iNodeId, title: item.title ?? iNodeId }, assetKind: "function-item", nodeId: iNodeId, parentNodeId: dNodeId, position: ii });
					for (let pi = 0; pi < (item.points ?? []).length; pi++) {
						const point = item.points![pi]!;
						const pNodeId = typeof point.nodeId === "string" ? point.nodeId : `fp${di}-${ii}-${pi}`;
						const pName = typeof point.name === "string" ? point.name : pNodeId;
						nodes.push({ title: pName, content: { ...point, nodeId: pNodeId }, assetKind: "function-point", nodeId: pNodeId, parentNodeId: iNodeId, position: pi });
					}
				}
			}
		}
		return nodes;
	}








	appendRunEvent(runId: number, type: string, payload: Record<string, unknown>): number {
		const timestamp = this.options.clock.now().toISOString();
		const transaction = this.database.transaction(() => {
			const seq = Number(
				(this.database
					.prepare("select coalesce(max(seq), 0) + 1 as next_seq from run_events where run_id = ?")
					.get(runId) as { next_seq: number }).next_seq,
			);
			this.database
				.prepare("insert into run_events(run_id, seq, type, schema_version, payload, created_at) values (?, ?, ?, 'run-event/v1', ?, ?)")
				.run(runId, seq, type, JSON.stringify(payload), timestamp);
			return seq;
		}).immediate;
		const seq = transaction();
		this.readModel.notifyRunEventAppended(runId, seq);
		return seq;
	}


















}
