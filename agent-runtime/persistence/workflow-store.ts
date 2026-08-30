import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { CrashInjector, FixtureClock, FixtureOutboxTransport, HashProvider } from "../testing/deterministic-fixtures.js";
import { WorkflowDoctor, type DoctorReport } from "../workflow/workflow-doctor.js";
import { PLAN_TASK_LIMITS, type ArtifactKind, type PlanProposal, type TaskProposal, type WritableArtifactKind } from "../workflow/plan-types.js";
import type { RequirementBaseline } from "../workflow/requirement.js";
import { GovernanceKernelImpl } from "./governance-kernel.js";
import type { GovernanceKernel } from "./governance-kernel.js";
import type { CutoverReport, RequirementClassification } from "../cutover/cutover-types.js";
import type { CutoverApplyResult } from "../cutover/cutover-applier.js";

import { WORKFLOW_GOVERNANCE_MIGRATION } from "./migrations/0001-workflow-governance.js";
import { COMMAND_GOVERNANCE_MIGRATION } from "./migrations/0002-command-governance.js";
import { RECOVERY_GOVERNANCE_MIGRATION } from "./migrations/0003-recovery-governance.js";
import { PLANNING_GOVERNANCE_MIGRATION } from "./migrations/0004-planning-governance.js";
import { ATTEMPT_EXECUTION_MIGRATION } from "./migrations/0005-attempt-execution-governance.js";
import { DEPENDENT_TASK_SAFETY_MIGRATION } from "./migrations/0006-dependent-task-safety.js";
import { REQUIRED_ARTIFACTS_AND_EVIDENCE_MIGRATION } from "./migrations/0007-required-artifacts-and-evidence.js";
import { CRITIC_GOVERNANCE_MIGRATION } from "./migrations/0008-critic-governance.js";
import { DECISIONS_AND_READINESS_MIGRATION } from "./migrations/0009-decisions-and-readiness.js";
import { HUMAN_GOVERNANCE_MIGRATION } from "./migrations/0010-human-governance.js";
import { READ_MODEL_GOVERNANCE_MIGRATION } from "./migrations/0011-read-model-governance.js";
import { RUN_EVENT_STREAM_MIGRATION } from "./migrations/0012-run-event-stream.js";
import { STAKEHOLDER_KIND_MIGRATION } from "./migrations/0013-stakeholder-kind.js";
import { MODEL_ROLES_MIGRATION } from "./migrations/0014-model-roles.js";
import { PRODUCTION_ROLE_KIND_MIGRATION } from "./migrations/0015-production-role-kind.js";
import { REUSABLE_ASSET_WORKFLOW_MIGRATION } from "./migrations/0016-reusable-asset-workflow.js";
import { FINALIZE_ROLE_SET_MIGRATION } from "./migrations/0017-finalize-role-set.js";
import { FTS_ASSET_SEARCH_MIGRATION } from "./migrations/0018-fts-asset-search.js";
import { ASSET_RELATIONS_MIGRATION } from "./migrations/0019-asset-relations.js";
import { ASSET_KIND_EXPANSION_MIGRATION } from "./migrations/0020-asset-kind-expansion.js";
import type { ReusableAssetKind } from "./reusable-asset-kind.js";
import { parseJson } from "./json.js";
import { AssetStore } from "./asset-store.js";
import { ProjectionReadModel } from "./projection-read-model.js";
import type { WorkflowProjectionReader, EventStreamReader, PlanningContextReader } from "./projection-read-interfaces.js";
export type { WorkflowProjectionReader, EventStreamReader, PlanningContextReader } from "./projection-read-interfaces.js";
import type { AssetGraph, AssetRelationExport, AssetRelationInput, AssetRelationRecord, ReusableAssetExportBundle } from "./asset-relations.js";
import type { ReusableAssetDetail, ReusableAssetListQuery, ReusableAssetPage, ReusableAssetSummary, SubtreeNode } from "./asset-store.js";
import { SnapshotStore } from "./snapshot-store.js";
import type { SnapshotDocument } from "./snapshot-store.js";
import { WorkspaceStore } from "./workspace-store.js";
import type { WorkspaceSummary } from "./workspace-store.js";

// Store（存储域）面的人名/类型经此处再导出：headless-runtime 与 operator-server
// 继续从 workflow-store 引用，保持既有导入路径稳定（ADR-006 门面形态）。
export { BusyWorkspaceError } from "./workspace-store.js";
export type { WorkspaceSummary } from "./workspace-store.js";
export { ReusableAssetMalformedBodyError, ReusableAssetNameConflictError, ReusableAssetReferencedError, ReusableAssetVersionConflictError, ImportDigestConflictError } from "./asset-store.js";
export { AssetRelationValidationError } from "./asset-relations.js";
export type { AssetGraph, AssetRelationExport, AssetRelationInput, AssetRelationRecord, ReusableAssetExportBundle } from "./asset-relations.js";
export type { ReusableAssetDetail, ReusableAssetListQuery, ReusableAssetPage, ReusableAssetSummary, HierarchyNode, SubtreeNode, ImportPreview } from "./asset-store.js";
import { type WorkflowCommandType } from "../workflow/command-types.js";
import type { ModelRolesOverride } from "../workflow/model-driver.js";
import type { BeginAttemptResult, CompleteAttemptResult, TraceLinkProposal } from "../workflow/role-result.js";
import type { AssetReference } from "../workflow/role-result.js";
import type { FindingSeverity } from "../workflow/role-result.js";
const MIGRATIONS = [WORKFLOW_GOVERNANCE_MIGRATION, COMMAND_GOVERNANCE_MIGRATION, RECOVERY_GOVERNANCE_MIGRATION, PLANNING_GOVERNANCE_MIGRATION, ATTEMPT_EXECUTION_MIGRATION, DEPENDENT_TASK_SAFETY_MIGRATION, REQUIRED_ARTIFACTS_AND_EVIDENCE_MIGRATION, CRITIC_GOVERNANCE_MIGRATION, DECISIONS_AND_READINESS_MIGRATION, HUMAN_GOVERNANCE_MIGRATION, READ_MODEL_GOVERNANCE_MIGRATION, RUN_EVENT_STREAM_MIGRATION, STAKEHOLDER_KIND_MIGRATION, MODEL_ROLES_MIGRATION, PRODUCTION_ROLE_KIND_MIGRATION, REUSABLE_ASSET_WORKFLOW_MIGRATION, FINALIZE_ROLE_SET_MIGRATION, FTS_ASSET_SEARCH_MIGRATION, ASSET_RELATIONS_MIGRATION, ASSET_KIND_EXPANSION_MIGRATION] as const;
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
	modelRoles?: ModelRolesOverride;
}

export interface CreationResult {
	requirementId: number;
	workflowId: number;
	workflowState: "pending";
	workflowVersion: 0;
	lastEventSeq: 1;
}

export interface WorkflowStoreOptions {
	databasePath: string;
	clock: FixtureClock;
	hashProvider: HashProvider;
	crashInjector: CrashInjector;
	outboxTransport: FixtureOutboxTransport;
	policyBundle: PolicyBundleDocument;
	artifactValidator?: { check(value: unknown): boolean };
	planValidator?: { check(value: unknown): boolean; errors(value: unknown): readonly unknown[] };
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
		modelRoles?: ModelRolesOverride;
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



export class WorkflowStore {
	private readonly database: Database.Database;
	private readonly snapshotStore: SnapshotStore;
	private readonly workspaceStore: WorkspaceStore;
	private readonly assetStore: AssetStore;
	private readonly readModel: ProjectionReadModel;
	private readonly kernel: GovernanceKernelImpl;
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
		this.snapshotStore = new SnapshotStore(this.database, this.options.hashProvider);
		this.workspaceStore = new WorkspaceStore(this.database, this.options.clock);
	this.assetStore = new AssetStore(this.database, this.options.clock, this.snapshotStore, this.options.artifactValidator, this.options.hashProvider);
			this.readModel = new ProjectionReadModel(this.database, { clock: this.options.clock, artifactValidator: this.options.artifactValidator, hashProvider: this.options.hashProvider });
		this.kernel = new GovernanceKernelImpl(this.database, this.options, this.snapshotStore, this.readModel, this.assetStore);
		this.createRequirementTransaction = this.database.transaction((input) =>
			this.createRequirementRows(input),
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
		// 表重建迁移（0006/0010/0013/0015）需要 DROP 有 FK 子表引用的旧表；
		// foreign_keys 是 connection 级 pragma，须在事务外关闭（事务内设置是 no-op），迁移事务后恢复。
		// 迁移 SQL 内部声明的 REFERENCES 仍是 DDL 契约；关闭仅跳过重建期间的约束检查。
		const fkWasOn = this.database.pragma("foreign_keys", { simple: true }) as boolean;
		if (fkWasOn) {
			this.database.pragma("foreign_keys = OFF");
		}
		try {
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
		} finally {
			if (fkWasOn) {
				this.database.pragma("foreign_keys = ON");
			}
		}
	}

createWorkspace(input: { repoPath: string; name: string }): number {
		return this.workspaceStore.createWorkspace(input);
	}

	workspaceExists(workspaceId: number): boolean {
		return this.workspaceStore.workspaceExists(workspaceId);
	}

	/** ADR-011: read-only projection accessor. Returns the ProjectionReadModel for consumers that need the three narrow read interfaces. */
	getReadModel(): ProjectionReadModel {
		return this.readModel;
	}

	getKernel(): GovernanceKernel {
		return this.kernel;
	}

	/** ADR-011: AssetStore accessor for HeadlessWorkflowRuntime `assets` getter. */
	getAssetStore(): AssetStore {
		return this.assetStore;
	}

	listWorkspaces(): readonly WorkspaceSummary[] {
		return this.workspaceStore.listWorkspaces();
	}

deleteWorkspace(workspaceId: number): boolean {
		return this.workspaceStore.deleteWorkspace(workspaceId);
	}

	createRequirement(input: CreateRequirementInput): CreationResult {
		return this.createRequirementTransaction(input);
	}

	private createRequirementRows(input: CreateRequirementInput): CreationResult {
		const timestamp = this.options.clock.now().toISOString();
		const baseline = this.snapshotStore.insertSnapshot(
			"artifact_content",
			"artifact/requirement/v1",
			input.baseline,
			timestamp,
		);
		const policy = this.snapshotStore.insertSnapshot(
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
		const modelRolesJson = input.modelRoles === undefined ? null : JSON.stringify(input.modelRoles);
		const workflowId = Number(
			this.database
				.prepare(
					"insert into workflows(requirement_id, state, version, last_event_seq, policy_bundle_document_id, model_roles, created_at, updated_at) values (?, 'pending', 0, 0, ?, ?, ?, ?)",
				)
				.run(requirementId, policy.id, modelRolesJson, timestamp, timestamp).lastInsertRowid,
		);
		const payload: Record<string, unknown> = {
			requirementId,
			requirementRevisionId: revisionId,
			designSessionId,
			policyBundleDocumentId: policy.id,
			policyBundleDigest: policy.digest,
		};
		if (input.modelRoles !== undefined) {
			payload.modelRoles = input.modelRoles;
		}
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

	listRequirements(workspaceId: number): Array<{ requirementId: number; workflowId: number }> {
		return this.readModel.listRequirements(workspaceId);
	}

	getWorkflowProjection(workflowId: number): WorkflowProjection | undefined {
		return this.readModel.getWorkflowProjection(workflowId);
	}


	executeCommand(input: ExecuteCommandInput): CommandReceipt {
		return this.kernel.executeCommand(input);
	}

	getCommandReceipt(workflowId: number, commandId: string): CommandReceipt | undefined {
		return this.readModel.getCommandReceipt(workflowId, commandId);
	}

	getCommandReceiptDetail(workflowId: number, commandId: string): CommandReceiptDetail | undefined {
		return this.readModel.getCommandReceiptDetail(workflowId, commandId);
	}

	reconcile(): ReconciliationReport {
		return this.kernel.reconcile();
	}

	processOutbox(): OutboxDrainResult {
		return this.kernel.processOutbox();
	}

	diagnose(): DoctorReport {
		return new WorkflowDoctor(this.database).diagnose();
	}


	beginPlanning(workflowId: number): BeginPlanningResult {
		return this.kernel.beginPlanning(workflowId);
	}


	getAttemptBaseVersion(workflowId: number, attemptId: number): number | null {
		return this.readModel.getAttemptBaseVersion(workflowId, attemptId);
	}

	isPlanningContextStale(workflowId: number, attemptId: number): boolean {
		return this.readModel.isPlanningContextStale(workflowId, attemptId);
	}

	getPlanningContextDigest(workflowId: number): string {
		return this.readModel.getPlanningContextDigest(workflowId);
	}


	adoptPlan(workflowId: number, attemptId: number, proposal: PlanProposal): CompletePlanningResult {
		return this.kernel.adoptPlan(workflowId, attemptId, proposal);
	}

	/** #21 引擎自动返工：reject 后生成新 PlanRevision（rework Task 同 kind + 环节尾 review Task），旧计划 supersede 留档。 */
	adoptReworkPlan(workflowId: number, tasks: readonly TaskProposal[]): number | null {
		return this.kernel.adoptReworkPlan(workflowId, tasks);
	}


	/** #21 返工闭环：产物 revision 来自 rework 计划且已批准 → 将 base（原模板）计划恢复为 active，rework 计划 supersede。 */

	/** #21 rework 角色映射：生产 kind → 对应生产角色（#15 决议 8 角色）。 */

	/** #21 返工预算 + 计划生成：同 kind 累计 reject≥2 升 finding_disposition 人工门禁（不再自动返工）；否则生成 rework+review 新计划。 */


	failPlanningAttempt(workflowId: number, attemptId: number, violations: unknown): CompletePlanningResult {
		return this.kernel.failPlanningAttempt(workflowId, attemptId, violations);
	}


	supersedePlanningAttempt(workflowId: number, attemptId: number, reason: string): CompletePlanningResult {
		return this.kernel.supersedePlanningAttempt(workflowId, attemptId, reason);
	}


	beginAttempt(workflowId: number): BeginAttemptResult {
		return this.kernel.beginAttempt(workflowId);
	}






	publishAttemptResult(workflowId: number, attemptId: number, structuredResult: unknown): CompleteAttemptResult {
		return this.kernel.publishAttemptResult(workflowId, attemptId, structuredResult);
	}


	failAttempt(workflowId: number, attemptId: number, failureCode: string, failureDetail: string): CompleteAttemptResult {
		return this.kernel.failAttempt(workflowId, attemptId, failureCode, failureDetail);
	}





	close(): void {
		this.database.close();
	}
	bindEvidenceSnapshot(workflowId: number, repoDigest: string, files: unknown): EvidenceSnapshotResult {
		const timestamp = this.options.clock.now().toISOString();
		const filesSnapshot = this.snapshotStore.insertSnapshot("repository_manifest", "repository-snapshot/v1", files, timestamp);
		this.database
			.prepare("insert into evidence_snapshots(workflow_id, repo_digest, files_document_id, created_at) values (?, ?, ?, ?) on conflict(workflow_id, repo_digest) do nothing")
			.run(workflowId, repoDigest, filesSnapshot.id, timestamp);
		const row = this.database
			.prepare("select id, workflow_id, repo_digest, created_at from evidence_snapshots where workflow_id = ? and repo_digest = ?")
			.get(workflowId, repoDigest) as { id: number; workflow_id: number; repo_digest: string; created_at: string };
		return { id: row.id, workflowId: row.workflow_id, repoDigest: row.repo_digest, createdAt: row.created_at };
	}

	getEvidenceSnapshots(workflowId: number): readonly EvidenceSnapshotResult[] {
		return this.readModel.getEvidenceSnapshots(workflowId);
	}

	isEvidenceStale(workflowId: number, currentRepoDigest: string): boolean {
		return this.readModel.isEvidenceStale(workflowId, currentRepoDigest);
	}

	getTraceLinks(artifactRevisionId: number): readonly TraceLinkResult[] {
		return this.readModel.getTraceLinks(artifactRevisionId);
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
		return this.readModel.getFindings(workflowId);
	}

	getFindingThreads(workflowId: number): readonly FindingThreadRecord[] {
		return this.readModel.getFindingThreads(workflowId);
	}

	acceptFindingRisk(workflowId: number, findingId: number, operator: string, reason: string): void {
		this.kernel.acceptFindingRisk(workflowId, findingId, operator, reason);
	}

	isFindingRiskAcceptanceStale(workflowId: number, findingId: number): boolean {
		return this.readModel.isFindingRiskAcceptanceStale(workflowId, findingId);
	}


	getDecisions(workflowId: number): readonly DecisionRecord[] {
		return this.readModel.getDecisions(workflowId);
	}


	/** 模板固定必需产物集（#12 决议：废除 Impact Profile 派生，模板 8 生产 kinds 即必需集）。 */

	/** 模板产物状态（当前 revision 存在性 + trace link 覆盖），供 readiness 与 approval packet 组装使用。 */

	checkReadiness(workflowId: number): ReadinessReport {
		return this.readModel.checkReadiness(workflowId);
	}


	buildApprovalPacket(workflowId: number): BuildApprovalPacketResult {
		return this.kernel.buildApprovalPacket(workflowId);
	}


	getApprovalPacket(workflowId: number): ApprovalPacketRecord | undefined {
		return this.readModel.getApprovalPacket(workflowId);
	}

	getHumanGates(workflowId: number): readonly HumanGateRecord[] {
		return this.readModel.getHumanGates(workflowId);
	}

	getApprovalRecords(workflowId: number): readonly ApprovalRecordEntry[] {
		return this.readModel.getApprovalRecords(workflowId);
	}

	getHumanDirectives(workflowId: number): readonly HumanDirectiveRecord[] {
		return this.readModel.getHumanDirectives(workflowId);
	}

	getDiagnosticRuns(workflowId: number): readonly DiagnosticRunRecord[] {
		return this.readModel.getDiagnosticRuns(workflowId);
	}

	listRequirementSummaries(workspaceId: number): readonly RequirementSummaryRecord[] {
		return this.readModel.listRequirementSummaries(workspaceId);
	}


	/** #23 FTS5 检索（#23）：增量回填 + workspace 限定 trigram 检索（公开面 excerpt-only，泄漏原始内容到 API 属过度暴露）。 */
	searchWorkspaceContent(workspaceId: number, query: string): SearchHit[] {
		return this.readModel.searchWorkspaceContent(workspaceId, query);
	}



	/** #24 回授注入：按检索相关性取 top-N 历史资产引用（排除本需求 promote 的资产），预算内截断。 */
	getFeedbackAssetReferences(workflowId: number, query: string, budget: number): readonly AssetReference[] {
		return this.readModel.getFeedbackAssetReferences(workflowId, query, budget);
	}











	getRequirementDetail(requirementId: number): RequirementDetailRecord | undefined {
		return this.readModel.getRequirementDetail(requirementId);
	}

	/** 当前产物 revision 的只读详情（含内容快照），供 SPA 产物内容查看器消费。 */
	getArtifactRevisionDetail(requirementId: number, kind: string): ArtifactRevisionDetailRecord | undefined {
		return this.readModel.getArtifactRevisionDetail(requirementId, kind);
	}

	getBoundedProjection(workflowId: number): BoundedWorkflowProjection | undefined {
		return this.readModel.getBoundedProjection(workflowId);
	}

	getPlanRevisionDetail(planRevisionId: number): PlanRevisionDetail | undefined {
		return this.readModel.getPlanRevisionDetail(planRevisionId);
	}

	getTaskDetail(taskId: number): TaskDetailRecord | undefined {
		return this.readModel.getTaskDetail(taskId);
	}

	listTaskAttempts(taskId: number): readonly AttemptSummaryRecord[] {
		return this.readModel.listTaskAttempts(taskId);
	}

	getAttemptDetail(attemptId: number): AttemptDetailRecord | undefined {
		return this.readModel.getAttemptDetail(attemptId);
	}
	/** 读 attempt 的 contextManifest + requirement baseline 内容,供 executor 拼接 prompt。 */
	getAttemptContext(attemptId: number): { role: string; objective: string; requirementBaseline: RequirementBaseline; inputs: readonly unknown[]; expectedArtifactKind: string; expectedArtifactKinds: readonly string[] } | undefined {
		return this.readModel.getAttemptContext(attemptId);
	}


	/** 查找 pending 产物中有 critic coverage 且无 open major/critical 的:可自动批准。 */
	listPendingReviewedArtifacts(workflowId: number): readonly { artifactId: number; revisionId: number; kind: string }[] {
		return this.readModel.listPendingReviewedArtifacts(workflowId);
	}
	getRunDetail(runId: number): RunDetailRecord | undefined {
		return this.readModel.getRunDetail(runId);
	}

	getApprovalPacketDetail(packetId: number): ApprovalPacketDetailRecord | undefined {
		return this.readModel.getApprovalPacketDetail(packetId);
	}

	getDesignPackage(designPackageId: number): DesignPackageRecord | undefined {
		return this.readModel.getDesignPackage(designPackageId);
	}

	getLegacyImport(requirementId: number): LegacyImportRecord | undefined {
		return this.readModel.getLegacyImport(requirementId);
	}

	createReusableAsset(input: { workspaceId: number; kind: ReusableAssetKind; title: string; content: unknown; source?: "manual" | "import" | "migration" | "workflow"; strict?: boolean; legacyOriginRequirementId?: number | null; actorSnapshotDocumentId?: number | null; migrationAttestationDocumentId?: number | null }): { assetId: number; revisionId: number; revisionNo: number } {

		// workspace 存在性前置归门面（ADR-006）：AssetStore 不依赖 WorkspaceStore。
		if (!this.workspaceStore.workspaceExists(input.workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.createReusableAsset(input);
	}
	writeRelations(input: { workspaceId: number; fromAssetId: number; fromRevisionId: number; relations: readonly AssetRelationInput[] }): readonly AssetRelationRecord[] {
		if (!this.workspaceStore.workspaceExists(input.workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.writeRelations(input);
	}

	readRelations(assetId: number): readonly AssetRelationRecord[] {
		return this.assetStore.readRelations(assetId);
	}
	getWorkspaceAssetGraph(workspaceId: number): AssetGraph {
		if (!this.workspaceStore.workspaceExists(workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.getWorkspaceAssetGraph(workspaceId);
	}

	assetExistsByOriginArtifactId(workspaceId: number, artifactId: number): boolean {
		return this.assetStore.assetExistsByOriginArtifactId(workspaceId, artifactId);
	}

	getHierarchyRoots(workspaceId: number, rootKind: string, query: { page: number; pageSize: number; q?: string }) {
		if (!this.workspaceStore.workspaceExists(workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.getHierarchyRoots(workspaceId, rootKind, query);
	}
	getHierarchyChildren(parentAssetId: number) {
		return this.assetStore.getChildren(parentAssetId);
	}
	searchHierarchyNodes(workspaceId: number, q: string) {
		if (!this.workspaceStore.workspaceExists(workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.searchNodes(workspaceId, q);
	}
	createHierarchySubtree(workspaceId: number, tree: SubtreeNode, parentId: number | null) {
		if (!this.workspaceStore.workspaceExists(workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.createSubtree(workspaceId, tree, parentId);
	}
	moveHierarchySubtree(workspaceId: number, assetId: number, expectedRevisionId: number, newParentAssetId: number | null) {
		if (!this.workspaceStore.workspaceExists(workspaceId)) throw new Error("Workspace not found");
		this.assetStore.moveSubtree(workspaceId, assetId, expectedRevisionId, newParentAssetId);
	}
	previewSubtreeDeletion(assetId: number) {
		return this.assetStore.previewSubtreeDeletion(assetId);
	}
	deleteSubtree(assetId: number) {
		return this.assetStore.deleteSubtree(assetId);
	}
	hasChildren(assetId: number) {
		return this.assetStore.hasChildren(assetId);
	}
	hasIncomingCrossAssetRelations(assetId: number) {
		return this.assetStore.hasIncomingCrossAssetRelations(assetId);
	}

	previewImportBundle(workspaceId: number, assets: readonly { kind: ReusableAssetKind; title: string; content: unknown }[], relations?: readonly AssetRelationExport[]) {
		if (!this.workspaceStore.workspaceExists(workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.previewImportBundle(workspaceId, assets, relations);
	}
	commitImportBundle(workspaceId: number, assets: readonly { kind: ReusableAssetKind; title: string; content: unknown }[], relations: readonly AssetRelationExport[], previewDigest: string) {
		if (!this.workspaceStore.workspaceExists(workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.commitImportBundle(workspaceId, assets, relations, previewDigest);
	}

	/** #22 promote：按 kind 条目拆细入库（幂等、可批选）。返回每 kind 入资产条数。 */
	promoteRequirementArtifacts(
		workflowId: number,
		kinds: readonly string[],
		options?: { skipAlreadyPromoted?: boolean; originApprovalId?: number | null },
	): Record<string, number> {
		return this.kernel.promoteRequirementArtifacts(workflowId, kinds, options);
	}

	updateReusableAsset(input: { workspaceId: number; assetId: number; expectedRevisionId: number; title: string; content: unknown; relations: readonly AssetRelationInput[] }): { assetId: number; revisionId: number; revisionNo: number } | undefined {
		if (!this.workspaceStore.workspaceExists(input.workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.updateReusableAsset(input);
	}

	listReusableAssets(workspaceId: number): readonly ReusableAssetSummary[] {
		return this.assetStore.listReusableAssets(workspaceId);
	}
	listReusableAssetPage(workspaceId: number, query: ReusableAssetListQuery = {}): ReusableAssetPage {
		if (!this.workspaceStore.workspaceExists(workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.listReusableAssetPage(workspaceId, query);
	}

	getReusableAsset(assetId: number): ReusableAssetDetail | undefined {
		return this.assetStore.getReusableAsset(assetId);
	}

	deleteReusableAsset(assetId: number): boolean {
		return this.assetStore.deleteReusableAsset(assetId);
	}

	exportReusableAssets(workspaceId: number): readonly ReusableAssetDetail[] {
		return this.assetStore.exportReusableAssets(workspaceId);
	}
	exportReusableAssetBundle(workspaceId: number): ReusableAssetExportBundle {
		if (!this.workspaceStore.workspaceExists(workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.exportReusableAssetBundle(workspaceId);
	}

	importReusableAssetBundle(
		workspaceId: number,
		assets: readonly { kind: ReusableAssetKind; title: string; content: unknown }[],
		relations?: readonly AssetRelationExport[],
		strict = false,
	): readonly number[] {
		if (!this.workspaceStore.workspaceExists(workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.importReusableAssetBundle(workspaceId, assets, relations, strict);
	}

	importReusableAssets(workspaceId: number, assets: readonly { kind: ReusableAssetKind; title: string; content: unknown; provenanceDigest?: string }[]): readonly number[] {
		if (!this.workspaceStore.workspaceExists(workspaceId)) throw new Error("Workspace not found");
		return this.assetStore.importReusableAssets(workspaceId, assets);
	}

	appendRunEvent(runId: number, type: string, payload: Record<string, unknown>): number {
		return this.kernel.appendRunEvent(runId, type, payload);
	}

	runExists(runId: number): boolean {
		return this.readModel.runExists(runId);
	}

	getRunEventWatermark(runId: number): number {
		return this.readModel.getRunEventWatermark(runId);
	}

	getRunEvents(runId: number, after: number, limit: number): readonly RunEventEnvelope[] {
		return this.readModel.getRunEvents(runId, after, limit);
	}

	getWorkflowEventWatermark(workflowId: number): number {
		return this.readModel.getWorkflowEventWatermark(workflowId);
	}

	getWorkflowEvents(workflowId: number, after: number, limit: number): readonly WorkflowEventEnvelope[] {
		return this.readModel.getWorkflowEvents(workflowId, after, limit);
	}

	subscribeWorkflowEvents(listener: (event: WorkflowEventEnvelope) => void): () => void {
		return this.readModel.subscribeWorkflowEvents(listener);
	}

	subscribeRunEvents(listener: (event: RunEventEnvelope) => void): () => void {
		return this.readModel.subscribeRunEvents(listener);
	}


	getMigrationAttestation(): { attestationDocumentId: number; reportDigest: string } | null {
		return this.readModel.getMigrationAttestation();
	}

	applyCutover(
		legacyDb: Database.Database,
		report: CutoverReport,
		crashInjector: { reach(point: string): void },
	): CutoverApplyResult {
		const timestamp = this.options.clock.now().toISOString();
		const tx = this.database.transaction(() => {
			return this.applyCutoverRows(legacyDb, report, timestamp, crashInjector);
		}).immediate;
		return tx();
	}

	private applyCutoverRows(
		legacyDb: Database.Database,
		report: CutoverReport,
		timestamp: string,
		crashInjector: { reach(point: string): void },
	): CutoverApplyResult {
		const reportDoc = this.snapshotStore.insertSnapshot("cutover_report", "cutover-report/v1", report, timestamp);
		const attestationContent = {
			schemaVersion: "migration-attestation/v1",
			reportDigest: report.reportDigest,
			inputFingerprints: report.inputFingerprints,
			policyVersion: report.policyVersion,
			classificationCount: report.classifications.length,
			anomalyCount: report.anomalies.length,
			appliedAt: timestamp,
		};
		const attestationDoc = this.snapshotStore.insertSnapshot(
			"migration_attestation",
			"migration-attestation/v1",
			attestationContent,
			timestamp,
		);

		const workspaceId = this.ensureWorkspace(legacyDb);

		let archivedWorkflows = 0;
		let pendingWorkflows = 0;
		let reusableAssetsImported = 0;

		for (const classification of report.classifications) {
			const legacyReq = this.readLegacyRequirement(legacyDb, classification.requirementId);
			if (!legacyReq) continue;

			if (classification.classification === "manual_asset_source") {
				reusableAssetsImported += this.importManualAssets(
					legacyDb,
					classification,
					workspaceId,
					attestationDoc.id,
					timestamp,
				);
				continue;
			}

		const baseline: RequirementBaseline = {
				schemaVersion: "artifact/requirement/v1",
				artifactKind: "requirement",
				summary: legacyReq.title,
				title: legacyReq.title,
				description: legacyReq.description ?? "",
				sourceRefs: [],
			};
			const bundleDoc = this.snapshotStore.insertSnapshot(
				"legacy_requirement_bundle",
				"legacy-requirement-bundle/v1",
				{
					schemaVersion: "legacy-requirement-bundle/v1",
					legacyRequirementId: legacyReq.id,
					title: legacyReq.title,
					description: legacyReq.description,
					source: legacyReq.source,
					archived: classification.classification === "legacy_archived",
				},
				timestamp,
			);
			const anomalyCount = report.anomalies.filter(
				(a) => a.requirementId === legacyReq.id,
			).length;

			if (classification.classification === "legacy_archived") {
				this.createLegacyArchivedWorkflowRows({
					workspaceId,
					baseline,
					legacyOriginRequirementId: legacyReq.id,
					attestationDocumentId: attestationDoc.id,
					bundleDocumentId: bundleDoc.id,
					anomalyCount,
					timestamp,
				});
				archivedWorkflows += 1;
			} else {
				this.createLegacyPendingWorkflowRows({
					workspaceId,
					baseline,
					legacyOriginRequirementId: legacyReq.id,
					attestationDocumentId: attestationDoc.id,
					bundleDocumentId: bundleDoc.id,
					anomalyCount,
					timestamp,
				});
				pendingWorkflows += 1;
			}
		}

		crashInjector.reach("cutover_apply.before_commit");

		return {
			attestationDocumentId: attestationDoc.id,
			reportDigest: report.reportDigest,
			importedRequirements: archivedWorkflows + pendingWorkflows,
			archivedWorkflows,
			pendingWorkflows,
			reusableAssetsImported,
		};
	}

	private ensureWorkspace(legacyDb: Database.Database): number {
		const row = legacyDb
			.prepare("select id, repo_path, name from workspaces order by id limit 1")
			.get() as { id: number; repo_path: string; name: string } | undefined;
		if (row) {
			const existing = this.database
				.prepare("select id from workspaces where repo_path = ? and name = ?")
				.get(row.repo_path, row.name) as { id: number } | undefined;
			if (existing) return existing.id;
			return this.createWorkspace({ repoPath: row.repo_path, name: row.name });
		}
		return this.createWorkspace({ repoPath: "/legacy", name: "legacy-cutover" });
	}

	private readLegacyRequirement(
		legacyDb: Database.Database,
		requirementId: number,
): { id: number; title: string; description: string; source: string } | undefined {
		return legacyDb
			.prepare("select id, title, description, source from requirements where id = ?")
			.get(requirementId) as { id: number; title: string; description: string; source: string } | undefined;
	}

	private importManualAssets(
		legacyDb: Database.Database,
		classification: RequirementClassification,
		workspaceId: number,
		attestationDocumentId: number,
		timestamp: string,
	): number {
		const artifacts = legacyDb
			.prepare(
				`select a.id, a.kind, a.title, ar.content
				 from artifacts a
				 join artifact_revisions ar on ar.artifact_id = a.id
				 where a.requirement_id = ?
				 order by a.id, ar.id`,
			)
			.all(classification.requirementId) as Array<{
				id: number;
				kind: string;
				title: string;
				content: string;
			}>;
		let count = 0;
		for (const artifact of artifacts) {
			const kind = this.mapLegacyArtifactKind(artifact.kind);
			if (!kind) continue;
			let content: unknown;
			try {
				content = JSON.parse(artifact.content);
			} catch {
				content = { title: artifact.title, raw: artifact.content };
			}
			const created = this.createReusableAsset({
				workspaceId,
				kind,
				title: artifact.title || `legacy-${artifact.kind}`,
				content,
				source: "migration",
				legacyOriginRequirementId: classification.requirementId,
				migrationAttestationDocumentId: attestationDocumentId,
			});
			count += 1;
			void created;
		}
		return count;
	}

	private mapLegacyArtifactKind(
		kind: string,
	): ReusableAssetKind | null {
		if (kind === "scenario") return "scenario-variant";
		if (kind === "usecase") return "usecase";
		if (kind === "function") return "function-point";
		return null;
	}

	private createLegacyArchivedWorkflowRows(input: {
		workspaceId: number;
		baseline: RequirementBaseline;
		legacyOriginRequirementId: number;
		attestationDocumentId: number;
		bundleDocumentId: number;
		anomalyCount: number;
		timestamp: string;
	}): { requirementId: number; workflowId: number } {
		const baselineDoc = this.snapshotStore.insertSnapshot(
			"artifact_content",
			"artifact/requirement/v1",
			input.baseline,
			input.timestamp,
		);
		const policyDoc = this.snapshotStore.insertSnapshot(
			"policy_bundle",
			"policy-bundle/v1",
			this.options.policyBundle,
			input.timestamp,
		);
		const requirementId = Number(
			this.database
				.prepare(
					"insert into requirements(workspace_id, title, version, created_at, updated_at) values (?, ?, 1, ?, ?)",
				)
				.run(input.workspaceId, input.baseline.title, input.timestamp, input.timestamp)
				.lastInsertRowid,
		);
		const artifactId = Number(
			this.database
				.prepare(
					"insert into artifacts(requirement_id, kind, title, created_at) values (?, 'requirement', ?, ?)",
				)
				.run(requirementId, input.baseline.title, input.timestamp).lastInsertRowid,
		);
		const revisionId = Number(
			this.database
				.prepare(
					"insert into artifact_revisions(artifact_id, revision_no, content_document_id, content_digest, schema_ref, status, created_at) values (?, 1, ?, ?, 'artifact/requirement/v1', 'approved', ?)",
				)
				.run(artifactId, baselineDoc.id, baselineDoc.digest, input.timestamp)
				.lastInsertRowid,
		);
		this.database
			.prepare("update artifacts set current_revision_id = ? where id = ?")
			.run(revisionId, artifactId);
		this.database
			.prepare("update requirements set current_revision_id = ? where id = ?")
			.run(revisionId, requirementId);
		const designSessionId = Number(
			this.database
				.prepare(
					"insert into design_sessions(requirement_id, session_file, session_id, status, created_at, updated_at) values (?, ?, ?, 'archived', ?, ?)",
				)
				.run(
					requirementId,
					`workflow-sessions/requirement-${requirementId}.jsonl`,
					`design-session:${requirementId}`,
					input.timestamp,
					input.timestamp,
				).lastInsertRowid,
		);
		const workflowId = Number(
			this.database
				.prepare(
					"insert into workflows(requirement_id, state, version, last_event_seq, policy_bundle_document_id, created_at, updated_at, archived_at) values (?, 'archived', 0, 0, ?, ?, ?, ?)",
				)
				.run(requirementId, policyDoc.id, input.timestamp, input.timestamp, input.timestamp)
				.lastInsertRowid,
		);
		const createdPayload = {
			requirementId,
			requirementRevisionId: revisionId,
			designSessionId,
			policyBundleDocumentId: policyDoc.id,
			policyBundleDigest: policyDoc.digest,
		};
		this.database
			.prepare(
				"insert into workflow_events(workflow_id, seq, type, type_version, schema_version, workflow_version, entity_type, entity_id, entity_version, payload, created_at) values (?, 1, 'workflow_created', 1, 'workflow-event/v1', 0, 'workflow', ?, 0, ?, ?)",
			)
			.run(workflowId, workflowId, JSON.stringify(createdPayload), input.timestamp);
		const archivedPayload = {
			archiveClass: "legacy_pre_policy",
			attestationDocumentId: input.attestationDocumentId,
			legacyRequirementId: input.legacyOriginRequirementId,
		};
		this.database
			.prepare(
				"insert into workflow_events(workflow_id, seq, type, type_version, schema_version, workflow_version, entity_type, entity_id, entity_version, payload, created_at) values (?, 2, 'legacy_data_imported', 1, 'workflow-event/v1', 0, 'legacy_import', ?, 0, ?, ?)",
			)
			.run(workflowId, requirementId, JSON.stringify(archivedPayload), input.timestamp);
		this.database
			.prepare(
				"insert into design_packages(requirement_id, workspace_id, document_id, digest, approval_packet_id, approval_id, migration_attestation_document_id, archive_class, archived_at) values (?, ?, ?, ?, null, null, ?, 'legacy_pre_policy', ?)",
			)
			.run(
				requirementId,
				input.workspaceId,
				baselineDoc.id,
				baselineDoc.digest,
				input.attestationDocumentId,
				input.timestamp,
			);
		this.database
			.prepare(
				"insert into legacy_imports(requirement_id, workflow_id, import_class, bundle_document_id, attestation_document_id, anomaly_count, created_at) values (?, ?, 'legacy_archived', ?, ?, ?, ?)",
			)
			.run(
				requirementId,
				workflowId,
				input.bundleDocumentId,
				input.attestationDocumentId,
				input.anomalyCount,
				input.timestamp,
			);
		return { requirementId, workflowId };
	}

	private createLegacyPendingWorkflowRows(input: {
		workspaceId: number;
		baseline: RequirementBaseline;
		legacyOriginRequirementId: number;
		attestationDocumentId: number;
		bundleDocumentId: number;
		anomalyCount: number;
		timestamp: string;
	}): { requirementId: number; workflowId: number } {
		const baselineDoc = this.snapshotStore.insertSnapshot(
			"artifact_content",
			"artifact/requirement/v1",
			input.baseline,
			input.timestamp,
		);
		const policyDoc = this.snapshotStore.insertSnapshot(
			"policy_bundle",
			"policy-bundle/v1",
			this.options.policyBundle,
			input.timestamp,
		);
		const requirementId = Number(
			this.database
				.prepare(
					"insert into requirements(workspace_id, title, version, created_at, updated_at) values (?, ?, 1, ?, ?)",
				)
				.run(input.workspaceId, input.baseline.title, input.timestamp, input.timestamp)
				.lastInsertRowid,
		);
		const artifactId = Number(
			this.database
				.prepare(
					"insert into artifacts(requirement_id, kind, title, created_at) values (?, 'requirement', ?, ?)",
				)
				.run(requirementId, input.baseline.title, input.timestamp).lastInsertRowid,
		);
		const revisionId = Number(
			this.database
				.prepare(
					"insert into artifact_revisions(artifact_id, revision_no, content_document_id, content_digest, schema_ref, status, created_at) values (?, 1, ?, ?, 'artifact/requirement/v1', 'pending', ?)",
				)
				.run(artifactId, baselineDoc.id, baselineDoc.digest, input.timestamp)
				.lastInsertRowid,
		);
		this.database
			.prepare("update artifacts set current_revision_id = ? where id = ?")
			.run(revisionId, artifactId);
		this.database
			.prepare("update requirements set current_revision_id = ? where id = ?")
			.run(revisionId, requirementId);
		const designSessionId = Number(
			this.database
				.prepare(
					"insert into design_sessions(requirement_id, session_file, session_id, status, created_at, updated_at) values (?, ?, ?, 'active', ?, ?)",
				)
				.run(
					requirementId,
					`workflow-sessions/requirement-${requirementId}.jsonl`,
					`design-session:${requirementId}`,
					input.timestamp,
					input.timestamp,
				).lastInsertRowid,
		);
		const workflowId = Number(
			this.database
				.prepare(
					"insert into workflows(requirement_id, state, version, last_event_seq, policy_bundle_document_id, created_at, updated_at) values (?, 'pending', 0, 0, ?, ?, ?)",
				)
				.run(requirementId, policyDoc.id, input.timestamp, input.timestamp)
				.lastInsertRowid,
		);
		const createdPayload = {
			requirementId,
			requirementRevisionId: revisionId,
			designSessionId,
			policyBundleDocumentId: policyDoc.id,
			policyBundleDigest: policyDoc.digest,
			legacyRequirementId: input.legacyOriginRequirementId,
		};
		this.database
			.prepare(
				"insert into workflow_events(workflow_id, seq, type, type_version, schema_version, workflow_version, entity_type, entity_id, entity_version, payload, created_at) values (?, 1, 'workflow_created', 1, 'workflow-event/v1', 0, 'workflow', ?, 0, ?, ?)",
			)
			.run(workflowId, workflowId, JSON.stringify(createdPayload), input.timestamp);
		this.database
			.prepare(
				"insert into legacy_imports(requirement_id, workflow_id, import_class, bundle_document_id, attestation_document_id, anomaly_count, created_at) values (?, ?, 'pending_reentry', ?, ?, ?, ?)",
			)
			.run(
				requirementId,
				workflowId,
				input.bundleDocumentId,
				input.attestationDocumentId,
				input.anomalyCount,
				input.timestamp,
			);
		return { requirementId, workflowId };
	}

}

/** #24 回授注入预算：单次注入最多引用条数（检索按 bm25 相关性截断）。 */
export const FEEDBACK_REFERENCE_BUDGET = 3;

export type SearchCorpus = "reusable_asset" | "artifact";

export interface SearchHit {
	corpus: SearchCorpus;
	sourceId: number;
	kind: string;
	title: string;
	excerpt: string;
}

/** 内部检索行：带原始内容供 #24 注入按窗口重算摘要（不出现在公开 API 面）。 */
export type SearchHitRow = SearchHit & { content: string };

export interface CommandReceiptDetail extends CommandReceipt {
	actorRef: string;
	capabilities: readonly string[];
}

export interface RequirementSummaryRecord {
	requirementId: number;
	title: string;
	requirementVersion: number;
	workflow: { id: number; state: string; version: number; lastEventSeq: number };
}

export interface RequirementDetailRecord {
	id: number;
	workspaceId: number;
	title: string;
	version: number;
	workflowId: number;
	designPackageId: number | null;
	modelRoles?: ModelRolesOverride;
	currentRevision: {
		id: number;
		artifactId: number;
		revisionNo: number;
		status: string;
		schemaRef: string;
		contentDocumentId: number;
		contentDigest: string;
		content: RequirementBaseline;
	};
}

export interface ArtifactRevisionDetailRecord {
	revisionId: number;
	artifactId: number;
	revisionNo: number;
	status: string;
	schemaRef: string;
	contentDigest: string;
	content: unknown;
}

export interface BoundedWorkflowProjection {
	workflow: {
		id: number;
		state: string;
		version: number;
		lastEventSeq: number;
		currentFailureCode: string | null;
		policyBundle: { documentId: number; digest: string };
		modelRoles?: ModelRolesOverride;
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
	tasks: readonly {
		id: number;
		key: string;
		kind: string;
		role: string;
		status: string;
		maxAttempts: number;
		latestAttempt: { id: number; attemptNo: number; status: string } | null;
	}[];
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

export interface PlanRevisionDetail {
	id: number;
	workflowId: number;
	revisionNo: number;
	status: string;
	proposalDocumentId: number;
	proposalDigest: string;
	basePlanRevisionId: number | null;
	planningContextDigest: string;
	planningAttemptId: number | null;
	proposal: PlanProposal;
	createdAt: string;
}

export interface TaskDetailRecord {
	id: number;
	workflowId: number;
	planRevisionId: number | null;
	key: string;
	kind: string;
	role: string;
	objective: string;
	dependsOn: readonly string[];
	inputs: readonly unknown[];
	expectedArtifactEffects: readonly unknown[];
	completionPolicyRef: string | null;
	maxAttempts: number;
	status: string;
	createdAt: string;
}

export interface AttemptSummaryRecord {
	id: number;
	attemptNo: number;
	status: string;
	resultOutcome: string | null;
	createdAt: string;
	completedAt: string | null;
}

export interface AttemptDetailRecord {
	id: number;
	taskId: number;
	workflowId: number;
	attemptNo: number;
	status: string;
	resultOutcome: string | null;
	baseWorkflowVersion: number | null;
	contextManifest: { documentId: number; digest: string } | null;
	roleContract: { documentId: number; digest: string } | null;
	run: { id: number; status: string; mode: string; role: string | null; resultDocumentId: number | null } | null;
	effects: readonly { id: number; artifactKind: string; effectType: string; logicalKey: string; state: string; publishedArtifactRevisionId: number | null }[];
	createdAt: string;
	completedAt: string | null;
}

export interface RunDetailRecord {
	id: number;
	attemptId: number;
	workflowId: number;
	sessionFile: string;
	sessionId: string;
	status: string;
	modelRef: string | null;
	resultDocumentId: number | null;
	mode: string;
	role: string | null;
	createdAt: string;
	completedAt: string | null;
}

export interface ApprovalPacketDetailRecord {
	id: number;
	workflowId: number;
	digest: string;
	status: string;
	valid: boolean;
	content: Record<string, unknown>;
	createdAt: string;
}

export interface DesignPackageRecord {
	id: number;
	requirementId: number;
	workspaceId: number;
	documentId: number;
	digest: string;
	approvalPacketId: number | null;
	approvalId: number | null;
	migrationAttestationDocumentId: number | null;
	archiveClass: "governed" | "legacy_pre_policy";
	archivedAt: string;
}

export interface LegacyImportRecord {
	requirementId: number;
	workflowId: number;
	importClass: "legacy_archived" | "pending_reentry";
	bundleDocumentId: number;
	attestationDocumentId: number;
	anomalySummary: { count: number };
	createdAt: string;
}

export interface EvidenceSnapshotResult {
	id: number;
	workflowId: number;
	repoDigest: string;
	createdAt: string;
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

export interface HumanGateRecord {
	id: number;
	workflowId: number;
	gateType: "human_input" | "finding_disposition";
	subjectType: string;
	subjectId: number;
	status: "open" | "resolved";
	resolution: unknown;
	openedAt: string;
	resolvedAt: string | null;
}

export interface ApprovalRecordEntry {
	id: number;
	workflowId: number;
	recordType: "artifact_approval" | "artifact_rejection" | "finding_risk_acceptance" | "packet_approval" | "packet_rejection" | "approval_revocation";
	subjectType: string;
	subjectId: number;
	subjectDigest: string | null;
	reason: string | null;
	targets: unknown;
	actorSnapshotDocumentId: number;
	commandId: string;
	createdAt: string;
}

export interface HumanDirectiveRecord {
	id: number;
	workflowId: number;
	directiveText: string;
	actorSnapshotDocumentId: number;
	commandId: string;
	createdAt: string;
}

export interface DiagnosticRunRecord {
	id: number;
	workflowId: number;
	purpose: string;
	status: string;
	actorSnapshotDocumentId: number;
	commandId: string;
	createdAt: string;
}

export interface WorkflowEventEnvelope {
	schemaVersion: string;
	workflowId: number;
	seq: number;
	type: string;
	typeVersion: number;
	workflowVersion: number;
	entity: { type: string; id: number; version: number };
	commandId?: string;
	payload: Record<string, unknown>;
	createdAt: string;
}

export interface RunEventEnvelope {
	schemaVersion: string;
	runId: number;
	seq: number;
	type: string;
	payload: Record<string, unknown>;
	createdAt: string;
}
export type { GovernanceKernel } from "./governance-kernel.js";

