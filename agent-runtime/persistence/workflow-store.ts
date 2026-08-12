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
import { ARTIFACT_OWNERSHIP, type InputBinding } from "../workflow/plan-types.js";
import type { RoleResult, ContextManifest, RoleContract, BeginAttemptResult, CompleteAttemptResult } from "../workflow/role-result.js";

const MIGRATIONS = [WORKFLOW_GOVERNANCE_MIGRATION, COMMAND_GOVERNANCE_MIGRATION, RECOVERY_GOVERNANCE_MIGRATION, PLANNING_GOVERNANCE_MIGRATION, ATTEMPT_EXECUTION_MIGRATION] as const;

export type WorkflowCommandType = "start" | "pause" | "resume" | "retry-recovery";

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
			return { taskId: 0, attemptId: 0, runId: 0, contextDigest: "", workflowVersion: workflow.version, lastEventSeq: this.currentLastEventSeq(workflowId) };
		}

		const roleContract = this.getOrCreateRoleContract(task.role, timestamp);
		const manifest = this.buildContextManifest(workflowId, workflow.version, task, roleContract, timestamp);
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
		return { taskId: task.id, attemptId, runId, contextDigest: contextSnapshot.digest, workflowVersion: newVersion, lastEventSeq: this.currentLastEventSeq(workflowId) };
	}

	private getReadyExecutionTask(workflowId: number): { id: number; key: string; kind: string; role: string; objective: string; plan_revision_id: number; depends_on_json: string; inputs_json: string; expected_artifact_effects_json: string; completion_policy_ref: string | null; max_attempts: number } | null {
		const tasks = this.database
			.prepare("select id, key, kind, role, objective, plan_revision_id, depends_on_json, inputs_json, expected_artifact_effects_json, completion_policy_ref, max_attempts, status from tasks where workflow_id = ? and kind != 'plan' and status = 'pending' order by id")
			.all(workflowId) as Array<{ id: number; key: string; kind: string; role: string; objective: string; plan_revision_id: number; depends_on_json: string; inputs_json: string; expected_artifact_effects_json: string; completion_policy_ref: string | null; max_attempts: number; status: string }>;
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

	private buildContextManifest(workflowId: number, workflowVersion: number, task: { id: number; key: string; kind: string; role: string; objective: string; inputs_json: string; plan_revision_id: number }, roleContract: { documentId: number; identity: string; digest: string }, timestamp: string): ContextManifest {
		const projection = this.getWorkflowProjection(workflowId);
		if (!projection) throw new Error("Workflow not found");
		const inputs = parseJson<InputBinding[]>(task.inputs_json);
		const policyBundleDigest = projection.workflow.policyBundle.digest;
		const inputDigest = this.options.hashProvider.digest(inputs);
		return {
			schemaVersion: "context-manifest/v1",
			workflowId,
			workflowVersion,
			requirement: { revisionId: projection.requirement.currentRevision.id, digest: projection.requirement.currentRevision.contentDigest },
			planRevisionId: task.plan_revision_id,
			task: { id: task.id, key: task.key, kind: task.kind, role: task.role, objective: task.objective },
			roleContract: { documentId: roleContract.documentId, identity: roleContract.identity, digest: roleContract.digest },
			policyBundleDigest,
			inputs,
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
		const attempt = this.database.prepare("select task_id, attempt_no from task_attempts where id = ?").get(attemptId) as { task_id: number; attempt_no: number };
		const task = this.database.prepare("select id, key, role, expected_artifact_effects_json, max_attempts, plan_revision_id from tasks where id = ?").get(attempt.task_id) as { id: number; key: string; role: string; expected_artifact_effects_json: string; max_attempts: number; plan_revision_id: number };

		const result = structuredResult as RoleResult;
		if (!result || result.schemaVersion !== "role-result/v1" || typeof result.workflowId !== "number" || typeof result.attemptId !== "number" || !Array.isArray(result.effects)) {
			return this.failAttemptRows(workflowId, attemptId, "invalid_role_result_schema", "RoleResult schema validation failed");
		}
		if (result.workflowId !== workflowId || result.attemptId !== attemptId) {
			return this.failAttemptRows(workflowId, attemptId, "role_result_mismatch", "RoleResult workflow or attempt mismatch");
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

	private currentLastEventSeq(workflowId: number): number {
		return (this.database.prepare("select last_event_seq from workflows where id = ?").get(workflowId) as { last_event_seq: number }).last_event_seq;
	}

	close(): void {
		this.database.close();
	}
}
