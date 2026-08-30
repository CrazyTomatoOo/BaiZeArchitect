/**
 * projection-read-model.ts — the read-only projection of governance state.
 *
 * Owns every read-only SQL query extracted from WorkflowStore per ADR-011
 * (ticket #89): the read model takes the better-sqlite3 Database handle
 * directly and runs its own prepared statements — no delegation back to
 * WorkflowStore. Shares the same connection and therefore the same
 * transaction boundaries as the write path; no new connection, no new
 * transactions for reads.
 *
 * Implements three narrow interfaces (projection-read-interfaces.ts):
 * - WorkflowProjectionReader: projection + detail + list queries (HTTP read routes)
 * - EventStreamReader: event replay + watermark + subscribe (SSE streams)
 * - PlanningContextReader: search + feedback + evidence (headless-runtime orchestration)
 *
 * Event notification: WorkflowStore's write methods (appendEvent /
 * appendRunEvent) call notifyWorkflowEventAppended / notifyRunEventAppended
 * after committing; the read model batches the pending keys and fans out to
 * SSE subscribers on setImmediate. Rollback-safe: events that vanished in a
 * rolled-back transaction are never notified.
 *
 * Search-backfill: `searchWorkspaceContent` and `getFeedbackAssetReferences`
 * call `ensureSearchBackfilled`, an insert-only FTS index refresh. This is
 * an idempotent materialized-view refresh, not a governance write. The
 * read model documents this as an explicit read-time refresh.
 */
import type Database from "better-sqlite3";
import { parseJson } from "./json.js";
import type { WorkflowProjectionReader, EventStreamReader, PlanningContextReader } from "./projection-read-interfaces.js";
import type { RequirementBaseline } from "../workflow/requirement.js";
import type { ModelRolesOverride } from "../workflow/model-driver.js";
import type { AssetReference, ContextManifest, FindingSeverity } from "../workflow/role-result.js";
import type { PlanProposal } from "../workflow/plan-types.js";
import type { WorkflowCommandType } from "../workflow/command-types.js";
import type {
	WorkflowProjection,
	BoundedWorkflowProjection,
	CommandReceipt,
	CommandReceiptDetail,
	CommandOutcome,
	PolicyBundleDocument,
	RequirementSummaryRecord,
	RequirementDetailRecord,
	ArtifactRevisionDetailRecord,
	PlanRevisionDetail,
	TaskDetailRecord,
	AttemptSummaryRecord,
	AttemptDetailRecord,
	RunDetailRecord,
	ApprovalPacketDetailRecord,
	DesignPackageRecord,
	LegacyImportRecord,
	EvidenceSnapshotResult,
	TraceLinkResult,
	FindingRecord,
	FindingThreadRecord,
	DecisionRecord,
	ReadinessCheckResult,
	ReadinessReport,
	ApprovalPacketRecord,
	HumanGateRecord,
	ApprovalRecordEntry,
	HumanDirectiveRecord,
	DiagnosticRunRecord,
	WorkflowEventEnvelope,
	RunEventEnvelope,
	SearchHit,
	SearchHitRow,
} from "./workflow-store.js";

// Re-export all record types so callers can import from one place
export type {
	WorkflowProjection,
	BoundedWorkflowProjection,
	CommandReceipt,
	CommandReceiptDetail,
	RequirementSummaryRecord,
	RequirementDetailRecord,
	ArtifactRevisionDetailRecord,
	PlanRevisionDetail,
	TaskDetailRecord,
	AttemptSummaryRecord,
	AttemptDetailRecord,
	RunDetailRecord,
	ApprovalPacketDetailRecord,
	DesignPackageRecord,
	LegacyImportRecord,
	EvidenceSnapshotResult,
	TraceLinkResult,
	FindingRecord,
	FindingThreadRecord,
	DecisionRecord,
	ReadinessCheckResult,
	ReadinessReport,
	ApprovalPacketRecord,
	HumanGateRecord,
	ApprovalRecordEntry,
	HumanDirectiveRecord,
	DiagnosticRunRecord,
	WorkflowEventEnvelope,
	RunEventEnvelope,
	SearchHit,
	SearchHitRow,
	SearchCorpus,
} from "./workflow-store.js";

/** 模板固定必需产物集（#12 决议：废除 Impact Profile 派生，模板 8 生产 kinds 即必需集）。 */
const TEMPLATE_REQUIRED_KINDS: readonly string[] = [
	"requirement", "analysis", "scenario", "usecase", "function", "design", "architecture", "data", "api",
];

export interface ProjectionReadModelOptions {
	/** 时间源（FTS 回填 indexed_at 与快照写入复用同一时钟）。 */
	clock: { now(): Date };
	/** 证据/计划上下文摘要与 approval packet 摘要计算。 */
	hashProvider: { digest(value: unknown): string };
	/** 产物 schema 校验（readiness 的一致性检查;可选）。 */
	artifactValidator?: { check(value: unknown): boolean };
}

/**
 * ProjectionReadModel — the read-only projection of governance state.
 *
 * Takes the shared better-sqlite3 Database handle and owns every read SQL
 * statement directly (ADR-011 #89: no Middle Man delegation to WorkflowStore).
 * Writes stay on WorkflowStore; reads live here.
 */
export class ProjectionReadModel implements WorkflowProjectionReader, EventStreamReader, PlanningContextReader {
	private readonly database: Database.Database;
	private readonly options: ProjectionReadModelOptions;

	private readonly workflowEventListeners = new Set<(event: WorkflowEventEnvelope) => void>();
	private readonly runEventListeners = new Set<(event: RunEventEnvelope) => void>();
	private pendingWorkflowEventKeys: string[] = [];
	private pendingRunEventKeys: string[] = [];
	private eventNotificationScheduled = false;

	constructor(database: Database.Database, options: ProjectionReadModelOptions) {
		this.database = database;
		this.options = options;
	}

	// --- WorkflowProjectionReader ---

	getWorkflowProjection(workflowId: number): WorkflowProjection | undefined {
		const row = this.database
			.prepare(
				`select
				w.id as workflow_id, w.state, w.version as workflow_version, w.last_event_seq,
				w.current_plan_revision_id, w.current_approval_packet_id, w.current_failure_code, w.model_roles,
				r.id as requirement_id, r.workspace_id, r.title, r.version as requirement_version,
				a.id as artifact_id, ar.id as revision_id, ar.revision_no, ar.status, ar.schema_ref,
				ar.content_document_id, ar.content_digest, content.content as baseline_content,
				ds.id as design_session_id, ds.status as design_session_status, ds.session_file, ds.session_id,
				policy.id as policy_document_id, policy.schema_ref as policy_schema_ref,
				policy.digest as policy_digest, policy.content as policy_content
				from workflows w
				join requirements r on r.id = w.requirement_id
				join artifact_revisions ar on ar.id = r.current_revision_id
				join artifacts a on a.id = ar.artifact_id and a.requirement_id = r.id and a.kind = 'requirement'
				join snapshot_documents content on content.id = ar.content_document_id
				join design_sessions ds on ds.requirement_id = r.id
				join snapshot_documents policy on policy.id = w.policy_bundle_document_id
				where w.id = ?`,
			)
			.get(workflowId) as Record<string, unknown> | undefined;
		if (!row) return undefined;
		const events = this.database
			.prepare("select * from workflow_events where workflow_id = ? order by seq")
			.all(workflowId) as Array<Record<string, unknown>>;
		return {
			requirement: {
				id: row.requirement_id as number,
				workspaceId: row.workspace_id as number,
				title: row.title as string,
				version: row.requirement_version as number,
				currentRevision: {
					artifactId: row.artifact_id as number,
					id: row.revision_id as number,
					revisionNo: row.revision_no as number,
					status: row.status as string,
					schemaRef: row.schema_ref as string,
					contentDocumentId: row.content_document_id as number,
					contentDigest: row.content_digest as string,
					content: parseJson<RequirementBaseline>(row.baseline_content as string),
				},
			},
			designSession: {
				id: row.design_session_id as number,
				status: row.design_session_status as string,
				sessionFile: row.session_file as string,
				sessionId: row.session_id as string,
			},
			workflow: {
				id: row.workflow_id as number,
				state: row.state as string,
				version: row.workflow_version as number,
				lastEventSeq: row.last_event_seq as number,
				currentPlanRevisionId: row.current_plan_revision_id as number | null,
				currentApprovalPacketId: row.current_approval_packet_id as number | null,
				currentFailureCode: row.current_failure_code as string | null,
				modelRoles: row.model_roles === null ? undefined : parseJson<ModelRolesOverride>(row.model_roles as string),
				policyBundle: {
					documentId: row.policy_document_id as number,
					id: row.policy_document_id as number,
					schemaRef: row.policy_schema_ref as string,
					digest: row.policy_digest as string,
					content: parseJson<PolicyBundleDocument>(row.policy_content as string),
				},
			},
			events: events.map((event) => ({
				workflowId: event.workflow_id as number,
				seq: event.seq as number,
				type: event.type as string,
				typeVersion: event.type_version as number,
				schemaVersion: event.schema_version as string,
				workflowVersion: event.workflow_version as number,
				entity: {
					type: event.entity_type as string,
					id: event.entity_id as number,
					version: event.entity_version as number,
				},
				payload: parseJson<Record<string, unknown>>(event.payload as string),
				createdAt: event.created_at as string,
			})),
		};
	}

	getBoundedProjection(workflowId: number): BoundedWorkflowProjection | undefined {
		const workflow = this.database
			.prepare("select w.id, w.state, w.version, w.last_event_seq, w.current_plan_revision_id, w.current_approval_packet_id, w.current_failure_code, w.policy_bundle_document_id, w.requirement_id, w.model_roles from workflows w where w.id = ?")
			.get(workflowId) as { id: number; state: string; version: number; last_event_seq: number; current_plan_revision_id: number | null; current_approval_packet_id: number | null; current_failure_code: string | null; policy_bundle_document_id: number; requirement_id: number; model_roles: string | null } | undefined;
		if (!workflow) return undefined;
		const policyBundle = this.database.prepare("select id, digest from snapshot_documents where id = ?").get(workflow.policy_bundle_document_id) as { id: number; digest: string };
		const requirement = this.database
			.prepare("select r.id, r.workspace_id, r.title, r.version from requirements r where r.id = ?")
			.get(workflow.requirement_id) as { id: number; workspace_id: number; title: string; version: number };
		const requirementRevision = this.database
			.prepare("select ar.id, ar.revision_no, ar.status, ar.content_digest, ar.schema_ref from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.requirement_id = ? and a.kind = 'requirement' order by ar.id desc limit 1")
			.get(workflow.requirement_id) as { id: number; revision_no: number; status: string; content_digest: string; schema_ref: string };
		const designSession = this.database
			.prepare("select id, status, session_id from design_sessions where requirement_id = ?")
			.get(workflow.requirement_id) as { id: number; status: string; session_id: string };
		let currentPlan: BoundedWorkflowProjection["currentPlan"] = null;
		let tasks: BoundedWorkflowProjection["tasks"] = [];
		if (workflow.current_plan_revision_id !== null) {
			const plan = this.database
				.prepare("select id, revision_no, status, proposal_digest, created_at from plan_revisions where id = ?")
				.get(workflow.current_plan_revision_id) as { id: number; revision_no: number; status: string; proposal_digest: string; created_at: string };
			currentPlan = { id: plan.id, revisionNo: plan.revision_no, status: plan.status, proposalDigest: plan.proposal_digest, createdAt: plan.created_at };
			const taskRows = this.database
				.prepare("select id, key, kind, role, status, max_attempts, created_at from tasks where plan_revision_id = ? order by id")
				.all(plan.id) as Array<{ id: number; key: string; kind: string; role: string; status: string; max_attempts: number; created_at: string }>;
			const latestAttempt = this.database.prepare("select id, attempt_no, status from task_attempts where task_id = ? order by attempt_no desc limit 1");
			tasks = taskRows.map((task) => {
				const attempt = latestAttempt.get(task.id) as { id: number; attempt_no: number; status: string } | undefined;
				return {
					id: task.id,
					key: task.key,
					kind: task.kind,
					role: task.role,
					status: task.status,
					maxAttempts: task.max_attempts,
					latestAttempt: attempt ? { id: attempt.id, attemptNo: attempt.attempt_no, status: attempt.status } : null,
				};
			});
		}
		const claim = this.database
			.prepare("select id, attempt_id, created_at from governance_claims where workflow_id = ? and status = 'active' order by id desc limit 1")
			.get(workflowId) as { id: number; attempt_id: number; created_at: string } | undefined;
		const claimAttempt = claim
			? this.database.prepare("select task_id from task_attempts where id = ?").get(claim.attempt_id) as { task_id: number }
			: undefined;
		const activeRun = claim
			? this.database.prepare("select id, status, mode, role, created_at from runs where attempt_id = ? order by id desc limit 1").get(claim.attempt_id) as { id: number; status: string; mode: string; role: string | null; created_at: string } | undefined
			: undefined;
		const openGates = this.getHumanGates(workflowId).filter((gate) => gate.status === "open");
		const decisions = this.getDecisions(workflowId);
		const findings = this.getFindings(workflowId);
		const threads = this.getFindingThreads(workflowId);
		const packet = workflow.current_approval_packet_id === null
			? null
			: this.database.prepare("select id, digest, status, created_at from approval_packets where id = ?").get(workflow.current_approval_packet_id) as { id: number; digest: string; status: string; created_at: string } | undefined;
		const incident = this.database
			.prepare("select id, incident_type, failure_code, status, created_at from workflow_incidents where workflow_id = ? and status = 'open' order by id desc limit 1")
			.get(workflowId) as { id: number; incident_type: string; failure_code: string; status: string; created_at: string } | undefined;
		return {
			workflow: {
				id: workflow.id,
				state: workflow.state,
				version: workflow.version,
				lastEventSeq: workflow.last_event_seq,
				currentFailureCode: workflow.current_failure_code,
				policyBundle: { documentId: policyBundle.id, digest: policyBundle.digest },
				modelRoles: workflow.model_roles === null ? undefined : parseJson<ModelRolesOverride>(workflow.model_roles),
			},
			requirement: {
				id: requirement.id,
				workspaceId: requirement.workspace_id,
				title: requirement.title,
				version: requirement.version,
				currentRevision: { id: requirementRevision.id, revisionNo: requirementRevision.revision_no, status: requirementRevision.status, digest: requirementRevision.content_digest, schemaRef: requirementRevision.schema_ref },
			},
			designSession: { id: designSession.id, status: designSession.status, sessionId: designSession.session_id },
			currentPlan,
			tasks,
			activeClaim: claim && claimAttempt && activeRun ? { id: claim.id, taskId: claimAttempt.task_id, attemptId: claim.attempt_id, runId: activeRun.id, acquiredAt: claim.created_at } : null,
			activeRun: activeRun ? { id: activeRun.id, status: activeRun.status, mode: activeRun.mode, role: activeRun.role, startedAt: activeRun.created_at } : null,
			openGates: openGates.map((gate) => ({ id: gate.id, gateType: gate.gateType, subjectType: gate.subjectType, subjectId: gate.subjectId, openedAt: gate.openedAt })),
			decisions: decisions.map((decision) => ({ id: decision.id, severity: decision.severity, status: decision.status, summary: decision.summary })),
			findings: findings.map((finding) => ({ id: finding.id, threadId: finding.threadId, severity: finding.severity, status: finding.status, summary: finding.summary, targetRevisionId: finding.targetRevisionId })),
			findingThreads: threads.map((thread) => ({ id: thread.id, fingerprint: thread.fingerprint, status: thread.status, reworkCount: thread.reworkCount })),
			readiness: this.checkReadiness(workflowId),
			currentPacket: packet ? { id: packet.id, digest: packet.digest, status: packet.status, createdAt: packet.created_at } : null,
			currentIncident: incident ? { id: incident.id, incidentType: incident.incident_type, failureCode: incident.failure_code, status: incident.status, createdAt: incident.created_at } : null,
		};
	}

	getCommandReceipt(workflowId: number, commandId: string): CommandReceipt | undefined {
		const row = this.database
			.prepare("select command_id, workflow_id, command_type, outcome, http_status, workflow_version, last_event_seq, created_at from command_receipts where command_id = ? and workflow_id = ?")
			.get(commandId, workflowId) as Record<string, unknown> | undefined;
		if (!row) return undefined;
		return {
			commandId: row.command_id as string,
			workflowId: row.workflow_id as number,
			commandType: row.command_type as WorkflowCommandType,
			outcome: row.outcome as CommandOutcome,
			httpStatus: row.http_status as number,
			workflowVersion: row.workflow_version as number,
			lastEventSeq: row.last_event_seq as number,
			createdAt: row.created_at as string,
		};
	}

	getCommandReceiptDetail(workflowId: number, commandId: string): CommandReceiptDetail | undefined {
		const row = this.database
			.prepare("select r.command_id, r.workflow_id, r.command_type, r.outcome, r.http_status, r.workflow_version, r.last_event_seq, r.created_at, d.content as actor_content from command_receipts r join snapshot_documents d on d.id = r.actor_snapshot_document_id where r.command_id = ? and r.workflow_id = ?")
			.get(commandId, workflowId) as Record<string, unknown> | undefined;
		if (!row) return undefined;
		const actor = parseJson<{ actorRef: string; capabilities: readonly string[] }>(row.actor_content as string);
		return {
			commandId: row.command_id as string,
			workflowId: row.workflow_id as number,
			commandType: row.command_type as WorkflowCommandType,
			outcome: row.outcome as CommandOutcome,
			httpStatus: row.http_status as number,
			workflowVersion: row.workflow_version as number,
			lastEventSeq: row.last_event_seq as number,
			createdAt: row.created_at as string,
			actorRef: actor.actorRef,
			capabilities: actor.capabilities,
		};
	}

	listRequirements(workspaceId: number): Array<{ requirementId: number; workflowId: number }> {
		return this.database
			.prepare(
				"select r.id as requirementId, w.id as workflowId from requirements r join workflows w on w.requirement_id = r.id where r.workspace_id = ? order by r.id",
			)
			.all(workspaceId) as Array<{ requirementId: number; workflowId: number }>;
	}

	listRequirementSummaries(workspaceId: number): readonly RequirementSummaryRecord[] {
		const rows = this.database
			.prepare("select r.id, r.title, r.version, w.id as workflow_id, w.state, w.version as workflow_version, w.last_event_seq from requirements r join workflows w on w.requirement_id = r.id where r.workspace_id = ? order by r.id")
			.all(workspaceId) as Array<{ id: number; title: string; version: number; workflow_id: number; state: string; workflow_version: number; last_event_seq: number }>;
		return rows.map((row) => ({
			requirementId: row.id,
			title: row.title,
			requirementVersion: row.version,
			workflow: { id: row.workflow_id, state: row.state, version: row.workflow_version, lastEventSeq: row.last_event_seq },
		}));
	}

	getRequirementDetail(requirementId: number): RequirementDetailRecord | undefined {
		const row = this.database
			.prepare("select r.id, r.workspace_id, r.title, r.version, w.id as workflow_id, w.model_roles, (select dp.id from design_packages dp where dp.requirement_id = r.id) as design_package_id from requirements r join workflows w on w.requirement_id = r.id where r.id = ?")
			.get(requirementId) as { id: number; workspace_id: number; title: string; version: number; workflow_id: number; design_package_id: number | null; model_roles: string | null } | undefined;
		if (!row) return undefined;
		const revision = this.database
			.prepare("select ar.id, ar.artifact_id, ar.revision_no, ar.status, ar.schema_ref, ar.content_document_id, ar.content_digest, d.content from artifact_revisions ar join artifacts a on a.id = ar.artifact_id join snapshot_documents d on d.id = ar.content_document_id where a.requirement_id = ? and a.kind = 'requirement' order by ar.id desc limit 1")
			.get(requirementId) as { id: number; artifact_id: number; revision_no: number; status: string; schema_ref: string; content_document_id: number; content_digest: string; content: string } | undefined;
		if (!revision) return undefined;
		return {
			id: row.id,
			workspaceId: row.workspace_id,
			title: row.title,
			version: row.version,
			workflowId: row.workflow_id,
			designPackageId: row.design_package_id,
			modelRoles: row.model_roles === null ? undefined : parseJson<ModelRolesOverride>(row.model_roles),
			currentRevision: {
				id: revision.id,
				artifactId: revision.artifact_id,
				revisionNo: revision.revision_no,
				status: revision.status,
				schemaRef: revision.schema_ref,
				contentDocumentId: revision.content_document_id,
				contentDigest: revision.content_digest,
				content: parseJson<RequirementBaseline>(revision.content),
			},
		};
	}

	/** 当前产物 revision 的只读详情（含内容快照），供 SPA 产物内容查看器消费。 */
	getArtifactRevisionDetail(requirementId: number, kind: string): ArtifactRevisionDetailRecord | undefined {
		const revision = this.database
			.prepare("select ar.id, ar.artifact_id, ar.revision_no, ar.status, ar.schema_ref, ar.content_document_id, ar.content_digest, d.content from artifact_revisions ar join artifacts a on a.id = ar.artifact_id join snapshot_documents d on d.id = ar.content_document_id where a.requirement_id = ? and a.kind = ? order by ar.id desc limit 1")
			.get(requirementId, kind) as { id: number; artifact_id: number; revision_no: number; status: string; schema_ref: string; content_document_id: number; content_digest: string; content: string } | undefined;
		if (!revision) return undefined;
		return {
			revisionId: revision.id,
			artifactId: revision.artifact_id,
			revisionNo: revision.revision_no,
			status: revision.status,
			schemaRef: revision.schema_ref,
			contentDigest: revision.content_digest,
			content: parseJson<unknown>(revision.content),
		};
	}

	getPlanRevisionDetail(planRevisionId: number): PlanRevisionDetail | undefined {
		const row = this.database
			.prepare("select id, workflow_id, revision_no, proposal_document_id, proposal_digest, base_plan_revision_id, planning_context_digest, status, created_at from plan_revisions where id = ?")
			.get(planRevisionId) as { id: number; workflow_id: number; revision_no: number; proposal_document_id: number; proposal_digest: string; base_plan_revision_id: number | null; planning_context_digest: string; status: string; created_at: string } | undefined;
		if (!row) return undefined;
		const proposal = this.database.prepare("select content from snapshot_documents where id = ?").get(row.proposal_document_id) as { content: string };
		const planningAttempt = this.database
			.prepare("select id from task_attempts where workflow_id = ? and planning_context_digest = ? order by id desc limit 1")
			.get(row.workflow_id, row.planning_context_digest) as { id: number } | undefined;
		return {
			id: row.id,
			workflowId: row.workflow_id,
			revisionNo: row.revision_no,
			status: row.status,
			proposalDocumentId: row.proposal_document_id,
			proposalDigest: row.proposal_digest,
			basePlanRevisionId: row.base_plan_revision_id,
			planningContextDigest: row.planning_context_digest,
			planningAttemptId: planningAttempt?.id ?? null,
			proposal: parseJson<PlanProposal>(proposal.content),
			createdAt: row.created_at,
		};
	}

	getTaskDetail(taskId: number): TaskDetailRecord | undefined {
		const row = this.database
			.prepare("select id, workflow_id, plan_revision_id, key, kind, role, objective, depends_on_json, inputs_json, expected_artifact_effects_json, completion_policy_ref, max_attempts, status, created_at from tasks where id = ?")
			.get(taskId) as { id: number; workflow_id: number; plan_revision_id: number | null; key: string; kind: string; role: string; objective: string; depends_on_json: string; inputs_json: string; expected_artifact_effects_json: string; completion_policy_ref: string | null; max_attempts: number; status: string; created_at: string } | undefined;
		if (!row) return undefined;
		return {
			id: row.id,
			workflowId: row.workflow_id,
			planRevisionId: row.plan_revision_id,
			key: row.key,
			kind: row.kind,
			role: row.role,
			objective: row.objective,
			dependsOn: parseJson<readonly string[]>(row.depends_on_json),
			inputs: parseJson<readonly unknown[]>(row.inputs_json),
			expectedArtifactEffects: parseJson<readonly unknown[]>(row.expected_artifact_effects_json),
			completionPolicyRef: row.completion_policy_ref,
			maxAttempts: row.max_attempts,
			status: row.status,
			createdAt: row.created_at,
		};
	}

	listTaskAttempts(taskId: number): readonly AttemptSummaryRecord[] {
		const rows = this.database
			.prepare("select id, attempt_no, status, result_outcome, created_at, completed_at from task_attempts where task_id = ? order by attempt_no")
			.all(taskId) as Array<{ id: number; attempt_no: number; status: string; result_outcome: string | null; created_at: string; completed_at: string | null }>;
		return rows.map((row) => ({ id: row.id, attemptNo: row.attempt_no, status: row.status, resultOutcome: row.result_outcome, createdAt: row.created_at, completedAt: row.completed_at }));
	}

	getAttemptDetail(attemptId: number): AttemptDetailRecord | undefined {
		const row = this.database
			.prepare("select id, task_id, workflow_id, attempt_no, status, planning_context_digest, base_workflow_version, context_manifest_document_id, role_contract_document_id, result_outcome, created_at, completed_at from task_attempts where id = ?")
			.get(attemptId) as { id: number; task_id: number; workflow_id: number; attempt_no: number; status: string; planning_context_digest: string | null; base_workflow_version: number | null; context_manifest_document_id: number | null; role_contract_document_id: number | null; result_outcome: string | null; created_at: string; completed_at: string | null } | undefined;
		if (!row) return undefined;
		const manifest = row.context_manifest_document_id === null ? null : this.database.prepare("select digest from snapshot_documents where id = ?").get(row.context_manifest_document_id) as { digest: string };
		const roleContract = row.role_contract_document_id === null ? null : this.database.prepare("select digest from snapshot_documents where id = ?").get(row.role_contract_document_id) as { digest: string };
		const run = this.database
			.prepare("select id, status, mode, role, result_document_id from runs where attempt_id = ? order by id desc limit 1")
			.get(attemptId) as { id: number; status: string; mode: string; role: string | null; result_document_id: number | null } | undefined;
		const effects = this.database
			.prepare("select id, artifact_kind, effect_type, logical_key, state, published_artifact_revision_id from attempt_effects where attempt_id = ? order by id")
			.all(attemptId) as Array<{ id: number; artifact_kind: string; effect_type: string; logical_key: string; state: string; published_artifact_revision_id: number | null }>;
		return {
			id: row.id,
			taskId: row.task_id,
			workflowId: row.workflow_id,
			attemptNo: row.attempt_no,
			status: row.status,
			resultOutcome: row.result_outcome,
			baseWorkflowVersion: row.base_workflow_version,
			contextManifest: manifest === null ? null : { documentId: row.context_manifest_document_id as number, digest: manifest.digest },
			roleContract: roleContract === null ? null : { documentId: row.role_contract_document_id as number, digest: roleContract.digest },
			run: run ? { id: run.id, status: run.status, mode: run.mode, role: run.role, resultDocumentId: run.result_document_id } : null,
			effects: effects.map((effect) => ({ id: effect.id, artifactKind: effect.artifact_kind, effectType: effect.effect_type, logicalKey: effect.logical_key, state: effect.state, publishedArtifactRevisionId: effect.published_artifact_revision_id })),
			createdAt: row.created_at,
			completedAt: row.completed_at,
		};
	}

	getRunDetail(runId: number): RunDetailRecord | undefined {
		const row = this.database
			.prepare("select id, attempt_id, workflow_id, session_file, session_id, status, model_ref, result_document_id, mode, role, created_at, completed_at from runs where id = ?")
			.get(runId) as { id: number; attempt_id: number; workflow_id: number; session_file: string; session_id: string; status: string; model_ref: string | null; result_document_id: number | null; mode: string; role: string | null; created_at: string; completed_at: string | null } | undefined;
		if (!row) return undefined;
		return {
			id: row.id,
			attemptId: row.attempt_id,
			workflowId: row.workflow_id,
			sessionFile: row.session_file,
			sessionId: row.session_id,
			status: row.status,
			modelRef: row.model_ref,
			resultDocumentId: row.result_document_id,
			mode: row.mode,
			role: row.role,
			createdAt: row.created_at,
			completedAt: row.completed_at,
		};
	}

	getApprovalPacketDetail(packetId: number): ApprovalPacketDetailRecord | undefined {
		const row = this.database
			.prepare("select id, workflow_id, digest, content_json, status, created_at from approval_packets where id = ?")
			.get(packetId) as { id: number; workflow_id: number; digest: string; content_json: string; status: string; created_at: string } | undefined;
		if (!row) return undefined;
		const workflow = this.database.prepare("select current_approval_packet_id from workflows where id = ?").get(row.workflow_id) as { current_approval_packet_id: number | null };
		return {
			id: row.id,
			workflowId: row.workflow_id,
			digest: row.digest,
			status: row.status,
			valid: row.status === "current" && workflow.current_approval_packet_id === row.id,
			content: parseJson<Record<string, unknown>>(row.content_json),
			createdAt: row.created_at,
		};
	}

	getDesignPackage(designPackageId: number): DesignPackageRecord | undefined {
		const row = this.database
			.prepare("select id, requirement_id, workspace_id, document_id, digest, approval_packet_id, approval_id, migration_attestation_document_id, archive_class, archived_at from design_packages where id = ?")
			.get(designPackageId) as { id: number; requirement_id: number; workspace_id: number; document_id: number; digest: string; approval_packet_id: number | null; approval_id: number | null; migration_attestation_document_id: number | null; archive_class: string; archived_at: string } | undefined;
		if (!row) return undefined;
		return {
			id: row.id,
			requirementId: row.requirement_id,
			workspaceId: row.workspace_id,
			documentId: row.document_id,
			digest: row.digest,
			approvalPacketId: row.approval_packet_id,
			approvalId: row.approval_id,
			migrationAttestationDocumentId: row.migration_attestation_document_id,
			archiveClass: row.archive_class as DesignPackageRecord["archiveClass"],
			archivedAt: row.archived_at,
		};
	}

	getLegacyImport(requirementId: number): LegacyImportRecord | undefined {
		const row = this.database
			.prepare("select requirement_id, workflow_id, import_class, bundle_document_id, attestation_document_id, anomaly_count, created_at from legacy_imports where requirement_id = ?")
			.get(requirementId) as { requirement_id: number; workflow_id: number; import_class: string; bundle_document_id: number; attestation_document_id: number; anomaly_count: number; created_at: string } | undefined;
		if (!row) return undefined;
		return {
			requirementId: row.requirement_id,
			workflowId: row.workflow_id,
			importClass: row.import_class as LegacyImportRecord["importClass"],
			bundleDocumentId: row.bundle_document_id,
			attestationDocumentId: row.attestation_document_id,
			anomalySummary: { count: row.anomaly_count },
			createdAt: row.created_at,
		};
	}

	getEvidenceSnapshots(workflowId: number): readonly EvidenceSnapshotResult[] {
		return this.database
			.prepare("select id, workflow_id, repo_digest, created_at from evidence_snapshots where workflow_id = ? order by id")
			.all(workflowId) as EvidenceSnapshotResult[];
	}

	getTraceLinks(artifactRevisionId: number): readonly TraceLinkResult[] {
		const rows = this.database
			.prepare("select id, artifact_revision_id, evidence_snapshot_id, source_ref_json, created_at from trace_links where artifact_revision_id = ? order by id")
			.all(artifactRevisionId) as Array<{ id: number; artifact_revision_id: number; evidence_snapshot_id: number; source_ref_json: string; created_at: string }>;
		return rows.map((row) => ({ id: row.id, artifactRevisionId: row.artifact_revision_id, evidenceSnapshotId: row.evidence_snapshot_id, sourceRef: parseJson<unknown>(row.source_ref_json), createdAt: row.created_at }));
	}

	getFindings(workflowId: number): readonly FindingRecord[] {
		const rows = this.database
			.prepare("select id, workflow_id, task_attempt_id, thread_id, fingerprint, severity, status, summary, target_revision_id, target_artifact_kind, source_ref, created_at, resolved_at, risk_accepted_by, risk_acceptance_reason from findings where workflow_id = ? order by id")
			.all(workflowId) as Array<{ id: number; workflow_id: number; task_attempt_id: number; thread_id: number; fingerprint: string; severity: string; status: string; summary: string; target_revision_id: number; target_artifact_kind: string; source_ref: string; created_at: string; resolved_at: string | null; risk_accepted_by: string | null; risk_acceptance_reason: string | null }>;
		return rows.map((row) => ({
			id: row.id, workflowId: row.workflow_id, attemptId: row.task_attempt_id, threadId: row.thread_id,
			fingerprint: row.fingerprint, severity: row.severity as FindingSeverity, status: row.status,
			summary: row.summary, targetRevisionId: row.target_revision_id, targetArtifactKind: row.target_artifact_kind,
			sourceRef: row.source_ref, createdAt: row.created_at, resolvedAt: row.resolved_at,
			riskAcceptedBy: row.risk_accepted_by, riskAcceptanceReason: row.risk_acceptance_reason,
		}));
	}

	getFindingThreads(workflowId: number): readonly FindingThreadRecord[] {
		const rows = this.database
			.prepare("select id, workflow_id, fingerprint, rework_count, status, created_at, updated_at from finding_threads where workflow_id = ? order by id")
			.all(workflowId) as Array<{ id: number; workflow_id: number; fingerprint: string; rework_count: number; status: string; created_at: string; updated_at: string }>;
		return rows.map((row) => ({
			id: row.id, workflowId: row.workflow_id, fingerprint: row.fingerprint,
			reworkCount: row.rework_count, status: row.status, createdAt: row.created_at, updatedAt: row.updated_at,
		}));
	}

	isFindingRiskAcceptanceStale(workflowId: number, findingId: number): boolean {
		const finding = this.database
			.prepare("select target_revision_id, target_artifact_kind, status, risk_accepted_by from findings where id = ? and workflow_id = ?")
			.get(findingId, workflowId) as { target_revision_id: number; target_artifact_kind: string; status: string; risk_accepted_by: string | null } | undefined;
		if (!finding || !finding.risk_accepted_by) return false;
		const requirementId = (this.database
			.prepare("select a.requirement_id from artifacts a join artifact_revisions ar on ar.artifact_id = a.id where ar.id = ?")
			.get(finding.target_revision_id) as { requirement_id: number }).requirement_id;
		const currentRevision = this.database
			.prepare("select ar.id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.requirement_id = ? and a.kind = ? order by ar.id desc limit 1")
			.get(requirementId, finding.target_artifact_kind) as { id: number } | undefined;
		return !currentRevision || currentRevision.id !== finding.target_revision_id;
	}

	getDecisions(workflowId: number): readonly DecisionRecord[] {
		const rows = this.database
			.prepare("select id, workflow_id, task_attempt_id, severity, summary, status, reason, owner, follow_up_target, created_at, disposed_at from decisions where workflow_id = ? order by id")
			.all(workflowId) as Array<{ id: number; workflow_id: number; task_attempt_id: number; severity: string; summary: string; status: string; reason: string | null; owner: string | null; follow_up_target: string | null; created_at: string; disposed_at: string | null }>;
		return rows.map((row) => ({
			id: row.id,
			workflowId: row.workflow_id,
			attemptId: row.task_attempt_id,
			severity: row.severity as DecisionRecord["severity"],
			summary: row.summary,
			status: row.status as DecisionRecord["status"],
			reason: row.reason,
			owner: row.owner,
			followUpTarget: row.follow_up_target,
			createdAt: row.created_at,
			disposedAt: row.disposed_at,
		}));
	}

	getHumanGates(workflowId: number): readonly HumanGateRecord[] {
		const rows = this.database
			.prepare("select id, workflow_id, gate_type, subject_type, subject_id, status, resolution_json, opened_at, resolved_at from human_gates where workflow_id = ? order by id")
			.all(workflowId) as Array<{ id: number; workflow_id: number; gate_type: string; subject_type: string; subject_id: number; status: string; resolution_json: string | null; opened_at: string; resolved_at: string | null }>;
		return rows.map((row) => ({
			id: row.id,
			workflowId: row.workflow_id,
			gateType: row.gate_type as HumanGateRecord["gateType"],
			subjectType: row.subject_type,
			subjectId: row.subject_id,
			status: row.status as HumanGateRecord["status"],
			resolution: row.resolution_json === null ? null : parseJson<unknown>(row.resolution_json),
			openedAt: row.opened_at,
			resolvedAt: row.resolved_at,
		}));
	}

	getApprovalRecords(workflowId: number): readonly ApprovalRecordEntry[] {
		const rows = this.database
			.prepare("select id, workflow_id, record_type, subject_type, subject_id, subject_digest, reason, targets_json, actor_snapshot_document_id, command_id, created_at from approval_records where workflow_id = ? order by id")
			.all(workflowId) as Array<{ id: number; workflow_id: number; record_type: string; subject_type: string; subject_id: number; subject_digest: string | null; reason: string | null; targets_json: string | null; actor_snapshot_document_id: number; command_id: string; created_at: string }>;
		return rows.map((row) => ({
			id: row.id,
			workflowId: row.workflow_id,
			recordType: row.record_type as ApprovalRecordEntry["recordType"],
			subjectType: row.subject_type,
			subjectId: row.subject_id,
			subjectDigest: row.subject_digest,
			reason: row.reason,
			targets: row.targets_json === null ? null : parseJson<unknown>(row.targets_json),
			actorSnapshotDocumentId: row.actor_snapshot_document_id,
			commandId: row.command_id,
			createdAt: row.created_at,
		}));
	}

	getHumanDirectives(workflowId: number): readonly HumanDirectiveRecord[] {
		const rows = this.database
			.prepare("select id, workflow_id, directive_text, actor_snapshot_document_id, command_id, created_at from human_directives where workflow_id = ? order by id")
			.all(workflowId) as Array<{ id: number; workflow_id: number; directive_text: string; actor_snapshot_document_id: number; command_id: string; created_at: string }>;
		return rows.map((row) => ({ id: row.id, workflowId: row.workflow_id, directiveText: row.directive_text, actorSnapshotDocumentId: row.actor_snapshot_document_id, commandId: row.command_id, createdAt: row.created_at }));
	}

	getDiagnosticRuns(workflowId: number): readonly DiagnosticRunRecord[] {
		const rows = this.database
			.prepare("select id, workflow_id, purpose, status, actor_snapshot_document_id, command_id, created_at from diagnostic_runs where workflow_id = ? order by id")
			.all(workflowId) as Array<{ id: number; workflow_id: number; purpose: string; status: string; actor_snapshot_document_id: number; command_id: string; created_at: string }>;
		return rows.map((row) => ({ id: row.id, workflowId: row.workflow_id, purpose: row.purpose, status: row.status, actorSnapshotDocumentId: row.actor_snapshot_document_id, commandId: row.command_id, createdAt: row.created_at }));
	}

	/** 查找 pending 产物中有 critic coverage 且无 open major/critical 的:可自动批准。 */
	listPendingReviewedArtifacts(workflowId: number): readonly { artifactId: number; revisionId: number; kind: string }[] {
		return this.database
			.prepare(`select a.id as artifactId, ar.id as revisionId, a.kind
				from artifact_revisions ar
				join artifacts a on a.id = ar.artifact_id
				join workflows w on w.requirement_id = a.requirement_id
				where w.id = ? and ar.status = 'pending'
				and exists (
					select 1 from critic_coverage_targets cct
					join task_attempts ta on ta.id = cct.task_attempt_id
					join tasks t on t.id = ta.task_id
					where cct.workflow_id = ? and cct.revision_id = ar.id
					and t.kind = 'review' and t.role = 'critic' and t.status = 'completed' and ta.status = 'succeeded'
				)
				and not exists (
					select 1 from findings f
					where f.workflow_id = ? and f.target_revision_id = ar.id
					and f.status = 'open' and f.severity in ('critical', 'major')
				)`)
			.all(workflowId, workflowId, workflowId) as Array<{ artifactId: number; revisionId: number; kind: string }>;
	}

	checkReadiness(workflowId: number): ReadinessReport {
		const projection = this.getWorkflowProjection(workflowId);
		if (!projection) throw new Error("Workflow not found");
		const requirementId = projection.requirement.id;
		const checks: ReadinessCheckResult[] = [];
		const warnings: string[] = [];
		const push = (name: string, passed: boolean, detail: string) => checks.push({ name, passed, detail });

		// 1. Terminal current work: no active claim/attempt/run, no non-terminal task in the active plan
		const activeClaims = (this.database.prepare("select count(*) as count from governance_claims where workflow_id = ? and status = 'active'").get(workflowId) as { count: number }).count;
		const activeAttempts = (this.database.prepare("select count(*) as count from task_attempts where workflow_id = ? and status in ('pending','running')").get(workflowId) as { count: number }).count;
		const activeRuns = (this.database.prepare("select count(*) as count from runs where workflow_id = ? and status in ('queued','running')").get(workflowId) as { count: number }).count;
		const nonTerminalTasks = (this.database
			.prepare("select count(*) as count from tasks where workflow_id = ? and status in ('pending','in_progress','blocked','replan_requested') and plan_revision_id = (select current_plan_revision_id from workflows where id = ?)")
			.get(workflowId, workflowId) as { count: number }).count;
		push("terminal_current_work", activeClaims === 0 && activeAttempts === 0 && activeRuns === 0 && nonTerminalTasks === 0, `activeClaims=${activeClaims} activeAttempts=${activeAttempts} activeRuns=${activeRuns} nonTerminalTasks=${nonTerminalTasks}`);

		// 2. No gate: no Finding Thread escalated to a human gate and no open Human Gate
		const humanGateThreads = (this.database.prepare("select count(*) as count from finding_threads where workflow_id = ? and status = 'human_gate'").get(workflowId) as { count: number }).count;
		const openHumanGates = (this.database.prepare("select count(*) as count from human_gates where workflow_id = ? and status = 'open'").get(workflowId) as { count: number }).count;
		push("no_gate", humanGateThreads === 0 && openHumanGates === 0, `humanGateThreads=${humanGateThreads} openHumanGates=${openHumanGates}`);

		// 3. Complete required Artifacts（模板必需集：#12 决议废除 Impact Profile 派生）
		const artifactStatuses = this.getTemplateArtifactStatuses(requirementId);
		const missingKinds = artifactStatuses.filter((status) => !status.hasCurrentRevision).map((status) => status.kind);
		push("complete_required_artifacts", missingKinds.length === 0, `missing=${missingKinds.join(",")}`);

		// 4. No unpublished effects
		const stagedEffects = (this.database.prepare("select count(*) as count from attempt_effects where workflow_id = ? and state = 'staged'").get(workflowId) as { count: number }).count;
		push("no_unpublished_effects", stagedEffects === 0, `stagedEffects=${stagedEffects}`);

		// 5. Evidence coverage: 模板 code 类产物 current revision 须有 TraceLinks
		const codeKinds = ["analysis", "design", "architecture", "data", "api"];
		const uncoveredKinds = artifactStatuses.filter((status) => codeKinds.includes(status.kind) && status.hasCurrentRevision && !status.hasTraceLinks).map((status) => status.kind);
		push("evidence_coverage", uncoveredKinds.length === 0, `uncovered=${uncoveredKinds.join(",")}`);

		// 7. Disposed Decisions: no open Decision of any severity
		const openDecisions = (this.database.prepare("select count(*) as count from decisions where workflow_id = ? and status = 'open'").get(workflowId) as { count: number }).count;
		push("disposed_decisions", openDecisions === 0, `openDecisions=${openDecisions}`);

		// 8. Disposed Findings: critical resolved; major resolved or non-stale risk acceptance; minor/info disclosed
		const openCritical = (this.database.prepare("select count(*) as count from findings where workflow_id = ? and severity = 'critical' and status != 'resolved'").get(workflowId) as { count: number }).count;
		const majorRows = this.database
			.prepare("select id, status from findings where workflow_id = ? and severity = 'major'")
			.all(workflowId) as Array<{ id: number; status: string }>;
		const undisposedMajor = majorRows.filter((row) => {
			if (row.status === "resolved") return false;
			if (row.status === "risk_accepted") return this.isFindingRiskAcceptanceStale(workflowId, row.id);
			return true;
		}).length;
		push("disposed_findings", openCritical === 0 && undisposedMajor === 0, `openCritical=${openCritical} undisposedMajor=${undisposedMajor}`);

		// 8. Current Critic coverage: 模板每个 current revision 有 coverage target
		const uncoveredRevisions: string[] = [];
		for (const status of artifactStatuses) {
			if (!status.hasCurrentRevision) continue;
			const revision = this.currentRevisionForKind(requirementId, status.kind);
			if (!revision) continue;
			const covered = this.database
				.prepare("select count(*) as count from critic_coverage_targets where workflow_id = ? and revision_id = ?")
				.get(workflowId, revision.id) as { count: number };
			if (covered.count === 0) uncoveredRevisions.push(`${status.kind}#${revision.id}`);
		}
		push("current_critic_coverage", uncoveredRevisions.length === 0, `uncovered=${uncoveredRevisions.join(",")}`);

		// 9. No consistency error (schema validation of current revisions); warnings are disclosed
		const consistencyErrors: string[] = [];
		if (this.options.artifactValidator) {
			for (const status of artifactStatuses) {
				if (!status.hasCurrentRevision) continue;
				const revision = this.currentRevisionForKind(requirementId, status.kind);
				if (!revision) continue;
				const document = this.database.prepare("select content from snapshot_documents where id = (select content_document_id from artifact_revisions where id = ?)").get(revision.id) as { content: string } | undefined;
				if (!document || !this.options.artifactValidator.check(parseJson<unknown>(document.content))) {
					consistencyErrors.push(`${status.kind}#${revision.id}`);
				}
			}
		}
		const duplicateKinds = this.database
			.prepare("select a.kind as kind, count(*) as count from artifacts a join workflows w on w.requirement_id = a.requirement_id where w.id = ? group by a.kind having count(*) > 1")
			.all(workflowId) as Array<{ kind: string; count: number }>;
		for (const duplicate of duplicateKinds) {
			consistencyErrors.push(`duplicate artifact for kind ${duplicate.kind}`);
		}
		const orphanEvidence = (this.database
			.prepare("select count(*) as count from evidence_snapshots es where es.workflow_id = ? and not exists (select 1 from trace_links tl where tl.evidence_snapshot_id = es.id)")
			.get(workflowId) as { count: number }).count;
		if (orphanEvidence > 0) warnings.push(`${orphanEvidence} evidence snapshot(s) are not referenced by any TraceLink`);
		push("no_consistency_error", consistencyErrors.length === 0, `errors=${consistencyErrors.join(",")}`);

		// 11. Buildable ApprovalPacket: governed content can be assembled and digested
		let buildable = false;
		try {
			const content = this.assembleApprovalPacketContent(workflowId);
			this.options.hashProvider.digest(content);
			buildable = true;
		} catch {
			buildable = false;
		}
		push("buildable_approval_packet", buildable, buildable ? "ok" : "packet assembly failed");

		return { workflowId, ready: checks.every((check) => check.passed), checks, warnings };
	}

	getApprovalPacket(workflowId: number): ApprovalPacketRecord | undefined {
		const workflow = this.database.prepare("select current_approval_packet_id from workflows where id = ?").get(workflowId) as { current_approval_packet_id: number | null } | undefined;
		if (!workflow || workflow.current_approval_packet_id === null) return undefined;
		const row = this.database
			.prepare("select id, workflow_id, digest, content_json, created_at from approval_packets where id = ?")
			.get(workflow.current_approval_packet_id) as { id: number; workflow_id: number; digest: string; content_json: string; created_at: string } | undefined;
		if (!row) return undefined;
		return { id: row.id, workflowId: row.workflow_id, digest: row.digest, content: parseJson<Record<string, unknown>>(row.content_json), createdAt: row.created_at };
	}

	getMigrationAttestation(): { attestationDocumentId: number; reportDigest: string } | null {
		const row = this.database
			.prepare(
				`select d.id as document_id, d.content as content
				 from snapshot_documents d
				 where d.kind = 'migration_attestation'
				 order by d.id desc limit 1`,
			)
			.get() as { document_id: number; content: string } | undefined;
		if (!row) return null;
		const parsed = parseJson<{ reportDigest: string }>(row.content);
		return { attestationDocumentId: row.document_id, reportDigest: parsed.reportDigest };
	}

	// --- EventStreamReader ---

	getWorkflowEvents(workflowId: number, after: number, limit: number): readonly WorkflowEventEnvelope[] {
		const rows = this.database
			.prepare("select workflow_id, seq, type, type_version, schema_version, workflow_version, entity_type, entity_id, entity_version, command_id, payload, created_at from workflow_events where workflow_id = ? and seq > ? order by seq limit ?")
			.all(workflowId, after, limit) as Array<{ workflow_id: number; seq: number; type: string; type_version: number; schema_version: string; workflow_version: number; entity_type: string; entity_id: number; entity_version: number; command_id: string | null; payload: string; created_at: string }>;
		return rows.map((row) => ({
			schemaVersion: row.schema_version,
			workflowId: row.workflow_id,
			seq: row.seq,
			type: row.type,
			typeVersion: row.type_version,
			workflowVersion: row.workflow_version,
			entity: { type: row.entity_type, id: row.entity_id, version: row.entity_version },
			...(row.command_id !== null ? { commandId: row.command_id } : {}),
			payload: parseJson<Record<string, unknown>>(row.payload),
			createdAt: row.created_at,
		}));
	}

	getRunEvents(runId: number, after: number, limit: number): readonly RunEventEnvelope[] {
		const rows = this.database
			.prepare("select run_id, seq, type, schema_version, payload, created_at from run_events where run_id = ? and seq > ? order by seq limit ?")
			.all(runId, after, limit) as Array<{ run_id: number; seq: number; type: string; schema_version: string; payload: string; created_at: string }>;
		return rows.map((row) => ({
			schemaVersion: row.schema_version,
			runId: row.run_id,
			seq: row.seq,
			type: row.type,
			payload: parseJson<Record<string, unknown>>(row.payload),
			createdAt: row.created_at,
		}));
	}

	getWorkflowEventWatermark(workflowId: number): number {
		return Number(
			(this.database
				.prepare("select coalesce(max(seq), 0) as watermark from workflow_events where workflow_id = ?")
				.get(workflowId) as { watermark: number }).watermark,
		);
	}

	getRunEventWatermark(runId: number): number {
		return Number(
			(this.database
				.prepare("select coalesce(max(seq), 0) as watermark from run_events where run_id = ?")
				.get(runId) as { watermark: number }).watermark,
		);
	}

	runExists(runId: number): boolean {
		return this.database.prepare("select 1 from runs where id = ?").get(runId) !== undefined;
	}

	subscribeWorkflowEvents(listener: (event: WorkflowEventEnvelope) => void): () => void {
		this.workflowEventListeners.add(listener);
		return () => {
			this.workflowEventListeners.delete(listener);
		};
	}

	subscribeRunEvents(listener: (event: RunEventEnvelope) => void): () => void {
		this.runEventListeners.add(listener);
		return () => {
			this.runEventListeners.delete(listener);
		};
	}

	// --- PlanningContextReader ---

	/** #23 FTS5 检索（#23）：增量回填 + workspace 限定 trigram 检索（公开面 excerpt-only，泄漏原始内容到 API 属过度暴露）。 */
	searchWorkspaceContent(workspaceId: number, query: string): SearchHit[] {
		return this.searchWorkspaceContentRows(workspaceId, query).map(({ content: _content, ...hit }) => hit);
	}

	/** #24 回授注入：按检索相关性取 top-N 历史资产引用（排除本需求 promote 的资产），预算内截断。 */
	getFeedbackAssetReferences(workflowId: number, query: string, budget: number): readonly AssetReference[] {
		const projection = this.getWorkflowProjection(workflowId);
		if (!projection) throw new Error("Workflow not found");
		const workspaceId = projection.requirement.workspaceId;
		const requirementId = projection.requirement.id;
		// 标题级滑窗 OR（trigram 短语要求字面连续，完整标题在历史资产中往往不存在；
		// 3 字符重叠窗口覆盖子串信号，bm25 排序保相关性）
		const windows = this.feedbackQueryWindows(query);
		const hits = this.searchWorkspaceContentRows(workspaceId, this.feedbackQueryText(windows));
		// 仅注入资产语料（历史沉淀）；本需求 promote 的资产自噬排除
		const ownAssetIds = new Set(
			(this.database.prepare("select id from reusable_assets where origin_requirement_id = ?").all(requirementId) as Array<{ id: number }>).map((r) => r.id),
		);
		const references: AssetReference[] = [];
		for (const hit of hits) {
			if (references.length >= budget) break;
			if (hit.corpus !== "reusable_asset") continue;
			if (ownAssetIds.has(hit.sourceId)) continue;
			references.push({ assetId: hit.sourceId, kind: hit.kind, title: hit.title, excerpt: this.windowedExcerpt(hit.content, windows) });
		}
		return references;
	}

	isEvidenceStale(workflowId: number, currentRepoDigest: string): boolean {
		const row = this.database
			.prepare("select repo_digest from evidence_snapshots where workflow_id = ? order by id desc limit 1")
			.get(workflowId) as { repo_digest: string } | undefined;
		if (!row) return true;
		return row.repo_digest !== currentRepoDigest;
	}

	/** 读 attempt 的 contextManifest + requirement baseline 内容,供 executor 拼接 prompt。 */
	getAttemptContext(attemptId: number): { role: string; objective: string; requirementBaseline: RequirementBaseline; inputs: readonly unknown[]; expectedArtifactKind: string; expectedArtifactKinds: readonly string[] } | undefined {
		const attempt = this.database
			.prepare("select context_manifest_document_id from task_attempts where id = ?")
			.get(attemptId) as { context_manifest_document_id: number | null } | undefined;
		if (!attempt?.context_manifest_document_id) return undefined;
		const manifestRow = this.database
			.prepare("select content from snapshot_documents where id = ?")
			.get(attempt.context_manifest_document_id) as { content: string } | undefined;
		if (!manifestRow) return undefined;
	const manifest = parseJson<ContextManifest>(manifestRow.content);
	const baselineRow = this.database
		.prepare("select d.content from artifact_revisions ar join snapshot_documents d on d.id = ar.content_document_id where ar.id = ?")
		.get(manifest.requirement.revisionId) as { content: string } | undefined;
	if (!baselineRow) return undefined;
	const baseline = parseJson<RequirementBaseline>(baselineRow.content);
	// 读取 task 的 expectedArtifactEffects 取首个 kind(模型需知产物 kind)
	const taskRow = this.database
		.prepare("select expected_artifact_effects_json from tasks where id = ?")
		.get(manifest.task.id) as { expected_artifact_effects_json: string } | undefined;
	const expectedEffects = taskRow ? parseJson<Array<{ kind?: string }>>(taskRow.expected_artifact_effects_json) : [];
	const expectedArtifactKind = expectedEffects[0]?.kind ?? "";
	const expectedArtifactKinds = expectedEffects.map((e) => e.kind ?? "").filter(Boolean);
	return { role: manifest.task.role, objective: manifest.task.objective, requirementBaseline: baseline, inputs: manifest.inputs, expectedArtifactKind, expectedArtifactKinds };
	}

	getAttemptBaseVersion(workflowId: number, attemptId: number): number | null {
		const row = this.database
			.prepare("select base_workflow_version from task_attempts where id = ? and workflow_id = ?")
			.get(attemptId, workflowId) as { base_workflow_version: number | null } | undefined;
		return row?.base_workflow_version ?? null;
	}

	getPlanningContextDigest(workflowId: number): string {
		return this.computePlanningContextDigest(workflowId);
	}

	isPlanningContextStale(workflowId: number, attemptId: number): boolean {
		const attempt = this.database
			.prepare("select planning_context_digest from task_attempts where id = ?")
			.get(attemptId) as { planning_context_digest: string } | undefined;
		if (!attempt?.planning_context_digest) return false;
		return attempt.planning_context_digest !== this.computePlanningContextDigest(workflowId);
	}

	// --- Event notification (WorkflowStore appendEvent/appendRunEvent call these after commit) ---

	notifyWorkflowEventAppended(workflowId: number, seq: number): void {
		this.pendingWorkflowEventKeys.push(`${workflowId}:${seq}`);
		this.scheduleEventNotification();
	}

	notifyRunEventAppended(runId: number, seq: number): void {
		this.pendingRunEventKeys.push(`${runId}:${seq}`);
		this.scheduleEventNotification();
	}

	// --- Private helpers ---

	private scheduleEventNotification(): void {
		if (this.eventNotificationScheduled) return;
		this.eventNotificationScheduled = true;
		setImmediate(() => {
			this.eventNotificationScheduled = false;
			if (!this.database.open) return;
			const workflowKeys = this.pendingWorkflowEventKeys.splice(0);
			for (const key of workflowKeys) {
				const separator = key.lastIndexOf(":");
				const workflowId = Number(key.slice(0, separator));
				const seq = Number(key.slice(separator + 1));
				const events = this.getWorkflowEvents(workflowId, seq - 1, 1);
				if (events.length === 0) continue; // rolled back; never notify phantom events
				for (const listener of this.workflowEventListeners) listener(events[0]);
			}
			const runKeys = this.pendingRunEventKeys.splice(0);
			for (const key of runKeys) {
				const separator = key.lastIndexOf(":");
				const runId = Number(key.slice(0, separator));
				const seq = Number(key.slice(separator + 1));
				const events = this.getRunEvents(runId, seq - 1, 1);
				if (events.length === 0) continue;
				for (const listener of this.runEventListeners) listener(events[0]);
			}
		});
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

	private currentRevisionForKind(requirementId: number, kind: string): { id: number; status: string; content_digest: string; revision_no: number; artifact_id: number } | undefined {
		return this.database
			.prepare("select ar.id, ar.status, ar.content_digest, ar.revision_no, ar.artifact_id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.requirement_id = ? and a.kind = ? order by ar.id desc limit 1")
			.get(requirementId, kind) as { id: number; status: string; content_digest: string; revision_no: number; artifact_id: number } | undefined;
	}

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
		const projection = this.getWorkflowProjection(workflowId);
		if (!projection) throw new Error("Workflow not found");
		const requirementId = projection.requirement.id;
		const artifactRows = this.getTemplateArtifactStatuses(requirementId)
			.filter((status) => status.hasCurrentRevision)
			.map((status) => {
				const revision = this.currentRevisionForKind(requirementId, status.kind)!;
				return { artifactId: revision.artifact_id, revisionId: revision.id, kind: status.kind, revisionNo: revision.revision_no, status: revision.status, contentDigest: revision.content_digest };
			})
			.sort((left, right) => left.kind.localeCompare(right.kind));
		const decisions = this.getDecisions(workflowId).map((decision) => ({
			id: decision.id,
			severity: decision.severity,
			status: decision.status,
			summary: decision.summary,
			reason: decision.reason,
			owner: decision.owner,
			followUpTarget: decision.followUpTarget,
		}));
		const findings = this.getFindings(workflowId).map((finding) => ({
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

	/** 内部检索行（带 content）：#24 注入按命中窗口重算摘要。 */
	private searchWorkspaceContentRows(workspaceId: number, query: string): SearchHitRow[] {
		this.ensureSearchBackfilled();
		const tokens = Array.from(query.trim());
		if (tokens.length === 0) return [];
		// trigram 边界：<3 unicode 字符无法构成 trigram，零命中（API 契约文档记录）
		if (tokens.length < 3) return [];
		// 用户关键词按字面短语匹配（双引号转义），保证 excerpt 窗口可按索引定位；
		// 已含引号的查询（#24 滑窗 OR 注入查询）按原样传递
		const trimmedQuery = query.trim();
		const phrase = trimmedQuery.includes('"') ? trimmedQuery : `"${trimmedQuery.replaceAll('"', '""')}"`;
		const hits: SearchHitRow[] = [];
		const assetRows = this.database
			.prepare(`select f.asset_id as sourceId, f.kind, f.title, f.content
				from reusable_asset_search f
				join reusable_assets ra on ra.id = f.asset_id
				where ra.workspace_id = ? and f.workspace_id = ?
					and f.snapshot_id = (select rar.content_document_id from reusable_asset_revisions rar where rar.id = ra.current_revision_id)
					and reusable_asset_search match ?
				order by bm25(reusable_asset_search)`)
			.all(workspaceId, workspaceId, phrase) as Array<{ sourceId: number; kind: string; title: string; content: string }>;
		for (const row of assetRows) {
			hits.push({ corpus: "reusable_asset", sourceId: row.sourceId, kind: row.kind, title: row.title, excerpt: this.excerptWindow(row.content, query.trim()), content: row.content });
		}
		const artifactRows = this.database
			.prepare(`select f.artifact_id as sourceId, f.kind, f.title, f.content
				from artifact_search f
				join artifacts a on a.id = f.artifact_id
				join requirements r on r.id = a.requirement_id
				where r.workspace_id = ? and f.workspace_id = ?
					and f.snapshot_id = (select ar.content_document_id from artifact_revisions ar where ar.id = a.current_revision_id and ar.status = 'approved')
					and artifact_search match ?
				order by bm25(artifact_search)`)
			.all(workspaceId, workspaceId, phrase) as Array<{ sourceId: number; kind: string; title: string; content: string }>;
		for (const row of artifactRows) {
			hits.push({ corpus: "artifact", sourceId: row.sourceId, kind: row.kind, title: row.title, excerpt: this.excerptWindow(row.content, query.trim()), content: row.content });
		}
		return hits;
	}

	/** FTS 增量回填（insert-only）：账本驱动，只插 (doc, source) 未记录的达标对；同一事务原子。 */
	private ensureSearchBackfilled(): void {
		const transaction = this.database.transaction(() => {
			// 资产语料：被资产 current_revision 引用的 reusable_asset_content 快照（账本去重）
			this.database
				.prepare(`insert into reusable_asset_search(snapshot_id, workspace_id, asset_id, kind, title, content)
					select d.id, ra.workspace_id, ra.id, ra.kind, ra.title, d.content
					from snapshot_documents d
					join reusable_asset_revisions rar on rar.content_document_id = d.id
					join reusable_assets ra on ra.id = rar.reusable_asset_id and ra.current_revision_id = rar.id
					left join asset_search_index idx on idx.doc_id = d.id and idx.asset_id = ra.id
					where d.kind = 'reusable_asset_content' and idx.doc_id is null`)
				.run();
			this.database
				.prepare(`insert into asset_search_index(doc_id, asset_id, indexed_at)
					select d.id, ra.id, ?
					from snapshot_documents d
					join reusable_asset_revisions rar on rar.content_document_id = d.id
					join reusable_assets ra on ra.id = rar.reusable_asset_id and ra.current_revision_id = rar.id
					left join asset_search_index idx on idx.doc_id = d.id and idx.asset_id = ra.id
					where d.kind = 'reusable_asset_content' and idx.doc_id is null`)
				.run(this.options.clock.now().toISOString());
			// 产物语料：被 artifact 已批准 + current revision 引用的 artifact_content 快照
			this.database
				.prepare(`insert into artifact_search(snapshot_id, workspace_id, requirement_id, artifact_id, kind, title, content)
					select d.id, r.workspace_id, r.id, a.id, a.kind, a.title, d.content
					from snapshot_documents d
					join artifact_revisions ar on ar.content_document_id = d.id and ar.status = 'approved'
					join artifacts a on a.id = ar.artifact_id and a.current_revision_id = ar.id
					join requirements r on r.id = a.requirement_id
					left join artifact_search_index idx on idx.doc_id = d.id and idx.artifact_id = a.id
					where d.kind = 'artifact_content' and idx.doc_id is null`)
				.run();
			this.database
				.prepare(`insert into artifact_search_index(doc_id, artifact_id, indexed_at)
					select d.id, a.id, ?
					from snapshot_documents d
					join artifact_revisions ar on ar.content_document_id = d.id and ar.status = 'approved'
					join artifacts a on a.id = ar.artifact_id and a.current_revision_id = ar.id
					join requirements r on r.id = a.requirement_id
					left join artifact_search_index idx on idx.doc_id = d.id and idx.artifact_id = a.id
					where d.kind = 'artifact_content' and idx.doc_id is null`)
				.run(this.options.clock.now().toISOString());
		}).immediate;
		transaction();
	}

	/** 命中摘要窗口：查词首现位置前后截断（trigram 不支持 snippet()；slice 按 UTF-16 码元截断，BMP 外字符边界近似）。 */
	private excerptWindow(content: string, query: string): string {
		const idx = content.indexOf(query);
		if (idx < 0) return content.slice(0, 120);
		const start = Math.max(0, idx - 30);
		return content.slice(start, start + 120);
	}

	/** #24 注入检索 query 的 3 字符重叠窗口（trigram 短语字面连续约束的放宽）。 */
	private feedbackQueryWindows(query: string): readonly string[] {
		const chars = Array.from(query.trim());
		if (chars.length < 3) return [query.trim()];
		const windows = new Set<string>();
		for (let i = 0; i + 3 <= chars.length; i += 1) {
			windows.add(chars.slice(i, i + 3).join(""));
		}
		return [...windows];
	}

	/** 窗口列表 → OR 短语查询文本（引号转义）。 */
	private feedbackQueryText(windows: readonly string[]): string {
		return windows.map((w) => `"${w.replaceAll('"', '""')}"`).join(" OR ");
	}

	/** 按首个命中的 3 字符窗口定位摘要（OR 查询无法整串定位）。 */
	private windowedExcerpt(content: string, windows: readonly string[]): string {
		for (const window of windows) {
			const idx = content.indexOf(window);
			if (idx < 0) continue;
			const start = Math.max(0, idx - 30);
			return content.slice(start, start + 120);
		}
		return content.slice(0, 120);
	}
}
