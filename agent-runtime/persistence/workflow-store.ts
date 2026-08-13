import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { CrashInjector, FixtureClock, FixtureOutboxTransport, HashProvider } from "../testing/deterministic-fixtures.js";
import { WorkflowDoctor, type DoctorReport } from "../workflow/workflow-doctor.js";
import { PLAN_TASK_LIMITS, type PlanProposal, type TaskProposal } from "../workflow/plan-types.js";
import type { RequirementBaseline } from "../workflow/requirement.js";

import { WORKFLOW_GOVERNANCE_MIGRATION } from "./migrations/0001-workflow-governance.js";
import { COMMAND_GOVERNANCE_MIGRATION } from "./migrations/0002-command-governance.js";
import { RECOVERY_GOVERNANCE_MIGRATION } from "./migrations/0003-recovery-governance.js";
import { PLANNING_GOVERNANCE_MIGRATION } from "./migrations/0004-planning-governance.js";
import { ATTEMPT_EXECUTION_MIGRATION } from "./migrations/0005-attempt-execution-governance.js";
import { DEPENDENT_TASK_SAFETY_MIGRATION } from "./migrations/0006-dependent-task-safety.js";
import { REQUIRED_ARTIFACTS_AND_EVIDENCE_MIGRATION } from "./migrations/0007-required-artifacts-and-evidence.js";
import { CRITIC_GOVERNANCE_MIGRATION } from "./migrations/0008-critic-governance.js";
import { DECISIONS_AND_READINESS_MIGRATION } from "./migrations/0009-decisions-and-readiness.js";
import { ARTIFACT_OWNERSHIP, type InputBinding, type TaskOutputInput } from "../workflow/plan-types.js";
import type { RoleResult, ContextManifest, RoleContract, BeginAttemptResult, CompleteAttemptResult, TraceLinkProposal, CriticReport, FindingProposal, FindingSeverity } from "../workflow/role-result.js";
import { deriveRequiredArtifactSet, type ImpactProfile, type RequiredArtifactSet } from "../workflow/impact-profile.js";

const MIGRATIONS = [WORKFLOW_GOVERNANCE_MIGRATION, COMMAND_GOVERNANCE_MIGRATION, RECOVERY_GOVERNANCE_MIGRATION, PLANNING_GOVERNANCE_MIGRATION, ATTEMPT_EXECUTION_MIGRATION, DEPENDENT_TASK_SAFETY_MIGRATION, REQUIRED_ARTIFACTS_AND_EVIDENCE_MIGRATION, CRITIC_GOVERNANCE_MIGRATION, DECISIONS_AND_READINESS_MIGRATION] as const;
export type WorkflowCommandType = "start" | "pause" | "resume" | "retry-recovery" | "cancel-run" | "dispose-decision";

export type CommandOutcome =
	| "accepted"
	| "capability_denied"
	| "version_conflict"
	| "state_conflict"
	| "business_rule_rejected"
	| "idempotency_conflict";

export interface ReconciliationReport {
	databaseIntact: boolean;
	foreignKeysValid: boolean;
	workflowsChecked: number;
	outboxReset: number;
	outboxDelivered: number;
	outboxExhausted: number;
	incidentsCreated: number;
}

export interface OutboxDrainResult {
	delivered: number;
	exhausted: number;
	incidentsCreated: number;
}

export interface BeginPlanningResult {
	taskId: number;
	attemptId: number;
	runId: number;
	planningContextDigest: string;
	workflowVersion: number;
	lastEventSeq: number;
}

export type CompletePlanningOutcome =
	| "adopted"
	| "validation_failed"
	| "stale_context"
	| "planning_exhausted"
	| "plan_budget_exhausted";

export interface CompletePlanningResult {
	outcome: CompletePlanningOutcome;
	planRevisionId: number | null;
	workflowVersion: number;
	lastEventSeq: number;
}

const MAX_DELIVERY_FAILURES = 5;
const BACKOFF_SECONDS = [1, 2, 5, 15, 30] as const;
const RECOVERABLE_INCIDENT_TYPES = ["outbox_exhausted", "recoverable_reconciliation_failure"] as const;

export interface CommandReceipt {
	commandId: string;
	workflowId: number;
	commandType: WorkflowCommandType;
	outcome: CommandOutcome;
	httpStatus: number;
	workflowVersion: number;
	lastEventSeq: number;
	createdAt: string;
}

export interface ExecuteCommandInput {
	workflowId: number;
	commandId: string;
	expectedWorkflowVersion: number;
	type: WorkflowCommandType;
	payload?: Record<string, unknown>;
	reason?: string;
	operator: { actorRef: string; capabilities: readonly string[] };
}

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
};
export interface PolicyBundleDocument {
	schemaVersion: "policy-bundle/v1";
	contracts: readonly {
		identity: string;
		digest: string;
		content: Readonly<Record<string, unknown>>;
	}[];
}

export interface CreateRequirementInput {
	workspaceId: number;
	baseline: RequirementBaseline;
}

export interface CreationResult {
	requirementId: number;
	workflowId: number;
	workflowState: "pending";
	workflowVersion: 0;
	lastEventSeq: 1;
}

interface WorkflowStoreOptions {
	databasePath: string;
	clock: FixtureClock;
	hashProvider: HashProvider;
	crashInjector: CrashInjector;
	outboxTransport: FixtureOutboxTransport;
	policyBundle: PolicyBundleDocument;
	artifactValidator?: { check(value: unknown): boolean };
}

interface SnapshotDocument {
	id: number;
	digest: string;
	schemaRef: string;
	content: unknown;
}

export interface WorkflowProjection {
	requirement: {
		id: number;
		workspaceId: number;
		title: string;
		version: number;
		currentRevision: {
			artifactId: number;
			id: number;
			revisionNo: number;
			status: string;
			schemaRef: string;
			contentDocumentId: number;
			contentDigest: string;
			content: RequirementBaseline;
		};
	};
	designSession: {
		id: number;
		status: string;
		sessionFile: string;
		sessionId: string;
	};
	workflow: {
		id: number;
		state: string;
		version: number;
		lastEventSeq: number;
		currentPlanRevisionId: number | null;
		currentApprovalPacketId: number | null;
		currentFailureCode: string | null;
		policyBundle: SnapshotDocument & { content: PolicyBundleDocument; documentId: number };
	};
	events: Array<{
		workflowId: number;
		seq: number;
		type: string;
		typeVersion: number;
		schemaVersion: string;
		workflowVersion: number;
		entity: { type: string; id: number; version: number };
		payload: Record<string, unknown>;
		createdAt: string;
	}>;
}

function parseJson<T>(value: string): T {
	try {
		return JSON.parse(value) as T;
	} catch (error) {
		throw new Error("Persisted Workflow JSON is invalid", { cause: error });
	}
}

export class WorkflowStore {
	private readonly database: Database.Database;
	private readonly createRequirementTransaction: (
		input: CreateRequirementInput,
	) => CreationResult;

	constructor(private readonly options: WorkflowStoreOptions) {
		if (options.databasePath !== ":memory:") {
			mkdirSync(path.dirname(options.databasePath), { recursive: true });
		}
		this.database = new Database(options.databasePath);
		try {
			this.database.pragma("foreign_keys = ON");
			this.database.pragma("journal_mode = WAL");
			this.database.pragma("synchronous = FULL");
			this.database.pragma("busy_timeout = 5000");
			this.applyMigrations();
		this.createRequirementTransaction = this.database.transaction((input) =>
			this.createRequirementRows(input),
		).immediate;
		this.executeCommandTransaction = this.database.transaction((input: ExecuteCommandInput) =>
			this.executeCommandRows(input),
		).immediate;
		} catch (error) {
			this.database.close();
			throw error;
		}
	}

	private applyMigrations(): void {
		const existing = this.database
			.prepare("select name from sqlite_master where type = 'table' and name = 'schema_migrations'")
			.get();
		if (!existing) {
			const apply = this.database.transaction(() => {
				for (const migration of MIGRATIONS) {
					this.database.exec(migration.sql);
					const digest = this.options.hashProvider.digest(migration.sql);
					this.database
						.prepare("insert into schema_migrations(version, name, checksum, applied_at) values (?, ?, ?, ?)")
						.run(migration.version, migration.name, digest, this.options.clock.now().toISOString());
				}
			}).immediate;
			apply();
			return;
		}
		const applied = this.database
			.prepare("select version, name, checksum from schema_migrations order by version")
			.all() as Array<{ version: number; name: string; checksum: string }>;
		const maxKnown = MIGRATIONS[MIGRATIONS.length - 1].version;
		const newer = applied.find((item) => item.version > maxKnown);
		if (newer) {
			throw new Error(
				`Workflow database migration ${newer.version} is newer than supported version ${maxKnown}`,
			);
		}
		for (const migration of MIGRATIONS) {
			const row = applied.find((item) => item.version === migration.version);
			const checksum = this.options.hashProvider.digest(migration.sql);
			if (!row || row.name !== migration.name || row.checksum !== checksum) {
				throw new Error(`Workflow migration ${migration.version} is missing or has a checksum mismatch`);
			}
		}
	}

	createWorkspace(input: { repoPath: string; name: string }): number {
		const timestamp = this.options.clock.now().toISOString();
		return Number(
			this.database
				.prepare("insert into workspaces(repo_path, name, created_at) values (?, ?, ?)")
				.run(input.repoPath, input.name, timestamp).lastInsertRowid,
		);
	}

	workspaceExists(workspaceId: number): boolean {
		return this.database
			.prepare("select 1 from workspaces where id = ?")
			.get(workspaceId) !== undefined;
	}

	createRequirement(input: CreateRequirementInput): CreationResult {
		return this.createRequirementTransaction(input);
	}

	private createRequirementRows(input: CreateRequirementInput): CreationResult {
		const timestamp = this.options.clock.now().toISOString();
		const baseline = this.insertSnapshot(
			"artifact_content",
			"artifact/requirement/v1",
			input.baseline,
			timestamp,
		);
		const policy = this.insertSnapshot(
			"policy_bundle",
			"policy-bundle/v1",
			this.options.policyBundle,
			timestamp,
		);
		const requirementId = Number(
			this.database
				.prepare(
					"insert into requirements(workspace_id, title, version, created_at, updated_at) values (?, ?, 1, ?, ?)",
				)
				.run(input.workspaceId, input.baseline.title, timestamp, timestamp).lastInsertRowid,
		);
		const artifactId = Number(
			this.database
				.prepare(
					"insert into artifacts(requirement_id, kind, title, created_at) values (?, 'requirement', ?, ?)",
				)
				.run(requirementId, input.baseline.title, timestamp).lastInsertRowid,
		);
		const revisionId = Number(
			this.database
				.prepare(
					"insert into artifact_revisions(artifact_id, revision_no, content_document_id, content_digest, schema_ref, status, created_at) values (?, 1, ?, ?, 'artifact/requirement/v1', 'pending', ?)",
				)
				.run(artifactId, baseline.id, baseline.digest, timestamp).lastInsertRowid,
		);
		this.database.prepare("update artifacts set current_revision_id = ? where id = ?").run(
			revisionId,
			artifactId,
		);
		this.database.prepare("update requirements set current_revision_id = ? where id = ?").run(
			revisionId,
			requirementId,
		);
		const designSessionId = Number(
			this.database
				.prepare(
					"insert into design_sessions(requirement_id, session_file, session_id, status, created_at, updated_at) values (?, ?, ?, 'active', ?, ?)",
				)
				.run(
					requirementId,
					`workflow-sessions/requirement-${requirementId}.jsonl`,
					`design-session:${requirementId}`,
					timestamp,
					timestamp,
				).lastInsertRowid,
		);
		const workflowId = Number(
			this.database
				.prepare(
					"insert into workflows(requirement_id, state, version, last_event_seq, policy_bundle_document_id, created_at, updated_at) values (?, 'pending', 0, 0, ?, ?, ?)",
				)
				.run(requirementId, policy.id, timestamp, timestamp).lastInsertRowid,
		);
		const payload = {
			requirementId,
			requirementRevisionId: revisionId,
			designSessionId,
			policyBundleDocumentId: policy.id,
			policyBundleDigest: policy.digest,
		};
		this.database
			.prepare(
				"insert into workflow_events(workflow_id, seq, type, type_version, schema_version, workflow_version, entity_type, entity_id, entity_version, payload, created_at) values (?, 1, 'workflow_created', 1, 'workflow-event/v1', 0, 'workflow', ?, 0, ?, ?)",
			)
			.run(workflowId, workflowId, JSON.stringify(payload), timestamp);
		this.options.crashInjector.reach("create_requirement.before_commit");
		if (!this.getWorkflowProjection(workflowId)) {
			throw new Error("Initial Workflow projection is incomplete");
		}
		return {
			requirementId,
			workflowId,
			workflowState: "pending",
			workflowVersion: 0,
			lastEventSeq: 1,
		};
	}

	private insertSnapshot(
		kind: string,
		schemaRef: string,
		content: unknown,
		createdAt: string,
	): SnapshotDocument {
		const digest = this.options.hashProvider.digest(content);
		const encoded = this.options.hashProvider.canonicalize(content);
		this.database
			.prepare(
				"insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values (?, ?, 'application/json', ?, ?, ?) on conflict(kind, digest) do nothing",
			)
			.run(kind, schemaRef, encoded, digest, createdAt);
		const row = this.database
			.prepare(
				"select id, digest, schema_ref, content, media_type from snapshot_documents where kind = ? and digest = ?",
			)
			.get(kind, digest) as {
			id: number;
			digest: string;
			schema_ref: string;
			content: string;
			media_type: string;
		};
		if (row.schema_ref !== schemaRef || row.media_type !== "application/json" || row.content !== encoded) {
			throw new Error(`Snapshot digest collision for ${kind}/${digest}`);
		}
		return { id: row.id, digest: row.digest, schemaRef: row.schema_ref, content };
	}

	listRequirements(workspaceId: number): Array<{ requirementId: number; workflowId: number }> {
		return this.database
			.prepare(
				"select r.id as requirementId, w.id as workflowId from requirements r join workflows w on w.requirement_id = r.id where r.workspace_id = ? order by r.id",
			)
			.all(workspaceId) as Array<{ requirementId: number; workflowId: number }>;
	}

	getWorkflowProjection(workflowId: number): WorkflowProjection | undefined {
		const row = this.database
			.prepare(
				`select
				w.id as workflow_id, w.state, w.version as workflow_version, w.last_event_seq,
				w.current_plan_revision_id, w.current_approval_packet_id, w.current_failure_code,
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

	private readonly executeCommandTransaction: (input: ExecuteCommandInput) => CommandReceipt;

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
			.prepare("select state, version, last_event_seq from workflows where id = ?")
			.get(input.workflowId) as { state: string; version: number; last_event_seq: number };
		const actorSnapshot = this.insertSnapshot(
			"actor_snapshot",
			"actor/v1",
			{ actorRef: input.operator.actorRef, capabilities: input.operator.capabilities },
			timestamp,
		);
		const capability = `workflow:operate`;
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
		const newVersion = workflow.version + 1;
	this.database
		.prepare("update workflows set state = ?, version = ?, consecutive_plan_revisions = 0, updated_at = ? where id = ?")
		.run(transition.to, newVersion, timestamp, input.workflowId);
		const seq = this.appendEvent(input.workflowId, transition.eventType, newVersion, "workflow", input.workflowId, newVersion, input.payload ?? {}, timestamp, actorSnapshot.id, input.commandId);
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
		return seq;
	}

	private currentWorkflowVersion(workflowId: number): number {
		return (this.database.prepare("select version from workflows where id = ?").get(workflowId) as { version: number }).version;
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

	diagnose(): DoctorReport {
		return new WorkflowDoctor(this.database).diagnose();
	}

	private drainOutbox(): OutboxDrainResult {
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

	getAttemptBaseVersion(workflowId: number, attemptId: number): number | null {
		const row = this.database
			.prepare("select base_workflow_version from task_attempts where id = ? and workflow_id = ?")
			.get(attemptId, workflowId) as { base_workflow_version: number | null } | undefined;
		return row?.base_workflow_version ?? null;
	}

	isPlanningContextStale(workflowId: number, attemptId: number): boolean {
		const attempt = this.database
			.prepare("select planning_context_digest from task_attempts where id = ?")
			.get(attemptId) as { planning_context_digest: string } | undefined;
		if (!attempt?.planning_context_digest) return false;
		return attempt.planning_context_digest !== this.computePlanningContextDigest(workflowId);
	}

	getPlanningContextDigest(workflowId: number): string {
		return this.computePlanningContextDigest(workflowId);
	}

	private computePlanningContextDigest(workflowId: number): string {
		const row = this.database
			.prepare(`select w.current_plan_revision_id, ar.content_digest as requirement_digest, policy.digest as policy_digest from workflows w join requirements r on r.id = w.requirement_id join artifact_revisions ar on ar.id = r.current_revision_id join snapshot_documents policy on policy.id = w.policy_bundle_document_id where w.id = ?`)
			.get(workflowId) as { current_plan_revision_id: number | null; requirement_digest: string; policy_digest: string };
		return this.options.hashProvider.digest({
			requirementRevisionDigest: row.requirement_digest,
			policyBundleDigest: row.policy_digest,
			basePlanRevisionId: row.current_plan_revision_id,
		});
	}

	adoptPlan(workflowId: number, attemptId: number, proposal: PlanProposal): CompletePlanningResult {
		const tx = this.database.transaction(() => this.adoptPlanRows(workflowId, attemptId, proposal)).immediate;
		const result = tx();
		this.options.crashInjector.reach("drain_outbox.before");
		this.drainOutbox();
		return result;
	}

	private adoptPlanRows(workflowId: number, attemptId: number, proposal: PlanProposal): CompletePlanningResult {
		const timestamp = this.options.clock.now().toISOString();
		const workflow = this.database
			.prepare("select version, current_plan_revision_id, consecutive_plan_revisions from workflows where id = ?")
			.get(workflowId) as { version: number; current_plan_revision_id: number | null; consecutive_plan_revisions: number };
		const attempt = this.database
			.prepare("select task_id, planning_context_digest from task_attempts where id = ?")
			.get(attemptId) as { task_id: number; planning_context_digest: string };
		const currentContext = this.computePlanningContextDigest(workflowId);
		if (attempt.planning_context_digest !== currentContext) {
			return this.supersedePlanningRows(workflowId, attemptId, "planning_context_changed");
		}

		const proposalSnapshot = this.insertSnapshot("plan_proposal", "plan-proposal/v1", proposal, timestamp);
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
		this.database.prepare("update governance_claims set status = 'released', released_at = ? where attempt_id = ? and status = 'active'").run(timestamp, attemptId);
		this.database.prepare("update workflows set version = ?, current_plan_revision_id = ?, consecutive_plan_revisions = ?, updated_at = ? where id = ?")
			.run(newVersion, planRevisionId, workflow.consecutive_plan_revisions + 1, timestamp, workflowId);

		this.appendEvent(workflowId, "plan_adopted", newVersion, "plan_revision", planRevisionId, revisionNo, { proposalDigest: proposalSnapshot.digest, revisionNo, basePlanRevisionId: workflow.current_plan_revision_id }, timestamp);
		this.appendEvent(workflowId, "attempt_succeeded", newVersion, "task_attempt", attemptId, 0, { taskId: attempt.task_id }, timestamp);
		this.appendEvent(workflowId, "run_completed", newVersion, "run", runId, 0, { attemptId }, timestamp);
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

		const resolvedInputs = this.resolveTaskOutputInputs(workflowId, task);
		if (!resolvedInputs) {
		return { taskId: 0, taskKey: "", taskRole: "", attemptId: 0, runId: 0, contextDigest: "", workflowVersion: workflow.version, lastEventSeq: this.currentLastEventSeq(workflowId) };
		}

		const roleContract = this.getOrCreateRoleContract(task.role, timestamp);
		const manifest = this.buildContextManifest(workflowId, workflow.version, task, resolvedInputs, roleContract, timestamp);
		const contextSnapshot = this.insertSnapshot("context_manifest", "context-manifest/v1", manifest, timestamp);

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
				order by failed_attempt_count desc, t.id`)
			.all(workflowId) as Array<{ id: number; key: string; kind: string; role: string; objective: string; plan_revision_id: number; depends_on_json: string; inputs_json: string; expected_artifact_effects_json: string; completion_policy_ref: string | null; max_attempts: number; status: string; failed_attempt_count: number }>;
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

	private resolveTaskOutputInputs(workflowId: number, task: { id: number; key: string; inputs_json: string; plan_revision_id: number }): Array<Record<string, unknown>> | null {
		const inputs = parseJson<InputBinding[]>(task.inputs_json);
		const resolved: Array<Record<string, unknown>> = [];
		for (const input of inputs) {
			if (input.type === "task_output") {
				const taskOutput = input as TaskOutputInput;
				const ancestorTask = this.database
					.prepare("select id from tasks where workflow_id = ? and key = ? and plan_revision_id = ?")
					.get(workflowId, taskOutput.taskKey, task.plan_revision_id) as { id: number } | undefined;
				if (!ancestorTask) return null;
				const revisions = this.database
					.prepare(`select ar.id from artifact_revisions ar
						join attempt_effects ae on ae.published_artifact_revision_id = ar.id
						join task_attempts ta on ta.id = ae.attempt_id
						where ae.workflow_id = ? and ae.artifact_kind = ? and ta.task_id = ? and ar.status = 'pending'
						order by ar.id desc`)
					.all(workflowId, taskOutput.artifactKind, ancestorTask.id) as Array<{ id: number }>;
				if (revisions.length !== 1) return null;
				resolved.push({ ...taskOutput, resolvedRevisionId: revisions[0].id });
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
		const snapshot = this.insertSnapshot("role_contract", "role-contract/v1", contract, timestamp);
		const identity = `role-contract/${role}/v1`;
		return { ...contract, documentId: snapshot.id, identity, digest: snapshot.digest };
	}

	private buildContextManifest(workflowId: number, workflowVersion: number, task: { id: number; key: string; kind: string; role: string; objective: string; plan_revision_id: number }, resolvedInputs: Array<Record<string, unknown>>, roleContract: { documentId: number; identity: string; digest: string }, timestamp: string): ContextManifest {
		const projection = this.getWorkflowProjection(workflowId);
		if (!projection) throw new Error("Workflow not found");
		const policyBundleDigest = projection.workflow.policyBundle.digest;
		const inputDigest = this.options.hashProvider.digest(resolvedInputs);
		return {
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
			const resultSnapshot = this.insertSnapshot("artifact_content", "role-result/v1", structuredResult, timestamp);
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
				if (!["critical", "major", "minor"].includes(proposal.severity) || typeof proposal.summary !== "string" || proposal.summary.length === 0) {
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

		const projection = this.getWorkflowProjection(workflowId);
		if (!projection) throw new Error("Workflow not found");
		const newVersion = workflow.version + 1;
		const runId = (this.database.prepare("select id from runs where attempt_id = ? order by id desc limit 1").get(attemptId) as { id: number }).id;

		for (const effect of result.effects) {
			const contentSnapshot = this.insertSnapshot("artifact_content", `artifact/${effect.artifactKind}/v1`, effect.content, timestamp);
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
		const analysisEffect = result.effects.find((e) => e.artifactKind === "analysis");
		if (analysisEffect && typeof analysisEffect.content === "object" && analysisEffect.content !== null) {
			const content = analysisEffect.content as { impactProfile?: ImpactProfile };
			if (content.impactProfile) {
				this.storeImpactProfile(workflowId, content.impactProfile);
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

	close(): void {
		this.database.close();
	}
	bindEvidenceSnapshot(workflowId: number, repoDigest: string, files: unknown): EvidenceSnapshotResult {
		const timestamp = this.options.clock.now().toISOString();
		const filesSnapshot = this.insertSnapshot("repository_manifest", "repository-snapshot/v1", files, timestamp);
		this.database
			.prepare("insert into evidence_snapshots(workflow_id, repo_digest, files_document_id, created_at) values (?, ?, ?, ?) on conflict(workflow_id, repo_digest) do nothing")
			.run(workflowId, repoDigest, filesSnapshot.id, timestamp);
		const row = this.database
			.prepare("select id, workflow_id, repo_digest, created_at from evidence_snapshots where workflow_id = ? and repo_digest = ?")
			.get(workflowId, repoDigest) as { id: number; workflow_id: number; repo_digest: string; created_at: string };
		return { id: row.id, workflowId: row.workflow_id, repoDigest: row.repo_digest, createdAt: row.created_at };
	}

	getEvidenceSnapshots(workflowId: number): readonly EvidenceSnapshotResult[] {
		return this.database
			.prepare("select id, workflow_id, repo_digest, created_at from evidence_snapshots where workflow_id = ? order by id")
			.all(workflowId) as EvidenceSnapshotResult[];
	}

	isEvidenceStale(workflowId: number, currentRepoDigest: string): boolean {
		const row = this.database
			.prepare("select repo_digest from evidence_snapshots where workflow_id = ? order by id desc limit 1")
			.get(workflowId) as { repo_digest: string } | undefined;
		if (!row) return true;
		return row.repo_digest !== currentRepoDigest;
	}

	storeImpactProfile(workflowId: number, profile: ImpactProfile): RequiredArtifactSet {
		const timestamp = this.options.clock.now().toISOString();
		const requiredSet = deriveRequiredArtifactSet(profile);
		this.database
			.prepare("insert into impact_profiles(workflow_id, profile_json, required_kinds_json, blocking_dimensions_json, complete, created_at) values (?, ?, ?, ?, ?, ?)")
			.run(workflowId, this.options.hashProvider.canonicalize(profile), JSON.stringify(requiredSet.requiredKinds), JSON.stringify(requiredSet.blockingDimensions), requiredSet.complete ? 1 : 0, timestamp);
		return requiredSet;
	}

	getRequiredArtifactSet(workflowId: number): RequiredArtifactSetResult | undefined {
		const row = this.database
			.prepare("select required_kinds_json, blocking_dimensions_json, complete from impact_profiles where workflow_id = ? order by id desc limit 1")
			.get(workflowId) as { required_kinds_json: string; blocking_dimensions_json: string; complete: number } | undefined;
		if (!row) return undefined;
		const requiredKinds = parseJson<string[]>(row.required_kinds_json);
		const blockingDimensions = parseJson<string[]>(row.blocking_dimensions_json);
		const projection = this.getWorkflowProjection(workflowId);
		const requirementId = projection?.requirement.id ?? null;
		const kindStatuses: RequiredArtifactKindStatus[] = requiredKinds.map((kind) => {
			const revisionRow = this.database
				.prepare("select ar.status from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.requirement_id = ? and a.kind = ? order by ar.id desc limit 1")
				.get(requirementId, kind) as { status: string } | undefined;
			const hasCurrent = revisionRow !== undefined;
			let hasTraceLinks = false;
			if (hasCurrent) {
				const revId = (this.database
					.prepare("select ar.id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.requirement_id = ? and a.kind = ? order by ar.id desc limit 1")
					.get(requirementId, kind) as { id: number }).id;
				const linkCount = (this.database
					.prepare("select count(*) as count from trace_links where artifact_revision_id = ?")
					.get(revId) as { count: number }).count;
				hasTraceLinks = linkCount > 0;
			}
			return { kind, hasCurrentRevision: hasCurrent, revisionStatus: revisionRow?.status ?? null, hasTraceLinks };
		});
		return { requiredKinds, blockingDimensions, complete: row.complete === 1, kindStatuses };
	}

	getTraceLinks(artifactRevisionId: number): readonly TraceLinkResult[] {
		const rows = this.database
			.prepare("select id, artifact_revision_id, evidence_snapshot_id, source_ref_json, created_at from trace_links where artifact_revision_id = ? order by id")
			.all(artifactRevisionId) as Array<{ id: number; artifact_revision_id: number; evidence_snapshot_id: number; source_ref_json: string; created_at: string }>;
		return rows.map((row) => ({ id: row.id, artifactRevisionId: row.artifact_revision_id, evidenceSnapshotId: row.evidence_snapshot_id, sourceRef: parseJson<unknown>(row.source_ref_json), createdAt: row.created_at }));
	}

	addTraceLinks(revisionId: number, links: readonly TraceLinkProposal[]): void {
		const timestamp = this.options.clock.now().toISOString();
		for (const link of links) {
			this.database
				.prepare("insert into trace_links(artifact_revision_id, evidence_snapshot_id, source_ref_json, created_at) values (?, ?, ?, ?)")
				.run(revisionId, link.evidenceSnapshotId, this.options.hashProvider.canonicalize(link.sourceRef), timestamp);
		}
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

	private currentRevisionForKind(requirementId: number, kind: string): { id: number; status: string; content_digest: string; revision_no: number; artifact_id: number } | undefined {
		return this.database
			.prepare("select ar.id, ar.status, ar.content_digest, ar.revision_no, ar.artifact_id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.requirement_id = ? and a.kind = ? order by ar.id desc limit 1")
			.get(requirementId, kind) as { id: number; status: string; content_digest: string; revision_no: number; artifact_id: number } | undefined;
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

		// 2. No gate: no Finding Thread escalated to a human gate
		const humanGateThreads = (this.database.prepare("select count(*) as count from finding_threads where workflow_id = ? and status = 'human_gate'").get(workflowId) as { count: number }).count;
		push("no_gate", humanGateThreads === 0, `humanGateThreads=${humanGateThreads}`);

		// 3. Complete Impact Profile
		const impactRow = this.database.prepare("select complete from impact_profiles where workflow_id = ? order by id desc limit 1").get(workflowId) as { complete: number } | undefined;
		push("complete_impact_profile", impactRow !== undefined && impactRow.complete === 1, impactRow === undefined ? "no impact profile" : `complete=${impactRow.complete}`);

		// 4. Complete required Artifacts
		const requiredSet = this.getRequiredArtifactSet(workflowId);
		const missingKinds = requiredSet ? requiredSet.kindStatuses.filter((s) => !s.hasCurrentRevision).map((s) => s.kind) : [];
		push("complete_required_artifacts", requiredSet !== undefined && missingKinds.length === 0, requiredSet === undefined ? "no required artifact set" : `missing=${missingKinds.join(",")}`);

		// 5. No unpublished effects
		const stagedEffects = (this.database.prepare("select count(*) as count from attempt_effects where workflow_id = ? and state = 'staged'").get(workflowId) as { count: number }).count;
		push("no_unpublished_effects", stagedEffects === 0, `stagedEffects=${stagedEffects}`);

		// 6. Evidence coverage: every required code-related kind with a current revision has TraceLinks
		const codeKinds = ["analysis", "design", "architecture", "data", "api"];
		const uncoveredKinds = requiredSet
			? requiredSet.kindStatuses.filter((s) => codeKinds.includes(s.kind) && s.hasCurrentRevision && !s.hasTraceLinks).map((s) => s.kind)
			: [];
		push("evidence_coverage", requiredSet !== undefined && uncoveredKinds.length === 0, `uncovered=${uncoveredKinds.join(",")}`);

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

		// 9. Current Critic coverage: every required kind's current revision has a coverage target
		const uncoveredRevisions: string[] = [];
		if (requiredSet) {
			for (const status of requiredSet.kindStatuses) {
				if (!status.hasCurrentRevision) continue;
				const revision = this.currentRevisionForKind(requirementId, status.kind);
				if (!revision) continue;
				const covered = this.database
					.prepare("select count(*) as count from critic_coverage_targets where workflow_id = ? and revision_id = ?")
					.get(workflowId, revision.id) as { count: number };
				if (covered.count === 0) uncoveredRevisions.push(`${status.kind}#${revision.id}`);
			}
		}
		push("current_critic_coverage", requiredSet !== undefined && uncoveredRevisions.length === 0, `uncovered=${uncoveredRevisions.join(",")}`);

		// 10. No consistency error (schema validation of current revisions); warnings are disclosed
		const consistencyErrors: string[] = [];
		if (this.options.artifactValidator && requiredSet) {
			for (const status of requiredSet.kindStatuses) {
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

	private assembleApprovalPacketContent(workflowId: number): Record<string, unknown> {
		const projection = this.getWorkflowProjection(workflowId);
		if (!projection) throw new Error("Workflow not found");
		const requirementId = projection.requirement.id;
		const requiredSet = this.getRequiredArtifactSet(workflowId);
		const artifactRows = requiredSet
			? requiredSet.kindStatuses
					.filter((status) => status.hasCurrentRevision)
					.map((status) => {
						const revision = this.currentRevisionForKind(requirementId, status.kind)!;
						return { artifactId: revision.artifact_id, revisionId: revision.id, kind: status.kind, revisionNo: revision.revision_no, status: revision.status, contentDigest: revision.content_digest };
					})
					.sort((left, right) => left.kind.localeCompare(right.kind))
			: [];
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
			requiredArtifactKinds: requiredSet ? [...requiredSet.requiredKinds].sort() : [],
		};
	}

	buildApprovalPacket(workflowId: number): BuildApprovalPacketResult {
		const tx = this.database.transaction(() => this.buildApprovalPacketRows(workflowId)).immediate;
		return tx();
	}

	private buildApprovalPacketRows(workflowId: number): BuildApprovalPacketResult {
		const timestamp = this.options.clock.now().toISOString();
		const report = this.checkReadiness(workflowId);
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
		let packetId = (this.database.prepare("select id from approval_packets where workflow_id = ? and digest = ?").get(workflowId, digest) as { id: number } | undefined)?.id;
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

	getApprovalPacket(workflowId: number): ApprovalPacketRecord | undefined {
		const workflow = this.database.prepare("select current_approval_packet_id from workflows where id = ?").get(workflowId) as { current_approval_packet_id: number | null } | undefined;
		if (!workflow || workflow.current_approval_packet_id === null) return undefined;
		const row = this.database
			.prepare("select id, workflow_id, digest, content_json, created_at from approval_packets where id = ?")
			.get(workflow.current_approval_packet_id) as { id: number; workflow_id: number; digest: string; content_json: string; created_at: string } | undefined;
		if (!row) return undefined;
		return { id: row.id, workflowId: row.workflow_id, digest: row.digest, content: parseJson<Record<string, unknown>>(row.content_json), createdAt: row.created_at };
	}
}

export interface EvidenceSnapshotResult {
	id: number;
	workflowId: number;
	repoDigest: string;
	createdAt: string;
}

export interface RequiredArtifactKindStatus {
	kind: string;
	hasCurrentRevision: boolean;
	revisionStatus: string | null;
	hasTraceLinks: boolean;
}

export interface RequiredArtifactSetResult {
	requiredKinds: readonly string[];
	blockingDimensions: readonly string[];
	complete: boolean;
	kindStatuses: readonly RequiredArtifactKindStatus[];
}

export interface TraceLinkResult {
	id: number;
	artifactRevisionId: number;
	evidenceSnapshotId: number;
	sourceRef: unknown;
	createdAt: string;
}

export interface FindingRecord {
	id: number;
	workflowId: number;
	attemptId: number;
	threadId: number;
	fingerprint: string;
	severity: FindingSeverity;
	status: string;
	summary: string;
	targetRevisionId: number;
	targetArtifactKind: string;
	sourceRef: string;
	createdAt: string;
	resolvedAt: string | null;
	riskAcceptedBy: string | null;
	riskAcceptanceReason: string | null;
}

export interface FindingThreadRecord {
	id: number;
	workflowId: number;
	fingerprint: string;
	reworkCount: number;
	status: string;
	createdAt: string;
	updatedAt: string;
}

export interface DecisionRecord {
	id: number;
	workflowId: number;
	attemptId: number;
	severity: "critical" | "major" | "minor";
	summary: string;
	status: "open" | "accepted" | "rejected" | "deferred";
	reason: string | null;
	owner: string | null;
	followUpTarget: string | null;
	createdAt: string;
	disposedAt: string | null;
}

export interface ReadinessCheckResult {
	name: string;
	passed: boolean;
	detail: string;
}

export interface ReadinessReport {
	workflowId: number;
	ready: boolean;
	checks: readonly ReadinessCheckResult[];
	warnings: readonly string[];
}

export interface BuildApprovalPacketResult {
	ready: boolean;
	packetId: number | null;
	digest: string | null;
	checks: readonly ReadinessCheckResult[];
	warnings: readonly string[];
	workflowVersion: number;
	lastEventSeq: number;
}

export interface ApprovalPacketRecord {
	id: number;
	workflowId: number;
	digest: string;
	content: Record<string, unknown>;
	createdAt: string;
}
