/**
 * projection-read-model.ts — the read-only projection of governance state.
 *
 * All read-only query methods extracted from WorkflowStore per ADR-011.
 * Shares the same better-sqlite3 Database handle as the Governance Kernel
 * and WorkflowStore orchestrator — no new connection, no new transaction
 * boundaries for reads.
 *
 * Implements three narrow interfaces (projection-read-interfaces.ts):
 * - WorkflowProjectionReader: projection + detail + list queries (HTTP read routes)
 * - EventStreamReader: event replay + watermark + subscribe (SSE streams)
 * - PlanningContextReader: search + feedback + evidence (headless-runtime orchestration)
 *
 * Search-backfill: `searchWorkspaceContent` and `getFeedbackAssetReferences`
 * call `ensureSearchBackfilled`, an insert-only FTS index refresh. This is
 * an idempotent materialized-view refresh, not a governance write. The
 * read model documents this as an explicit read-time refresh.
 *
 * Expand step (ticket #87): this class delegates to WorkflowStore's existing
 * read methods. The SQL implementations stay on WorkflowStore where they are
 * already tested. Ticket #2 (#88) moves the write methods to GovernanceKernel;
 * ticket #3 (#89) physically moves the read implementations here and eliminates
 * the delegation.
 */
import type { WorkflowProjectionReader, EventStreamReader, PlanningContextReader } from "./projection-read-interfaces.js";

// Re-export all record types so callers can import from one place
export type {
	WorkflowProjection,
	BoundedWorkflowProjection,
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

/**
 * Delegate interface — matches the read method surface of WorkflowStore.
 * During the expand step, WorkflowStore passes itself as the delegate.
 */
interface ReadModelDelegate {
	getWorkflowProjection(workflowId: number): unknown;
	getBoundedProjection(workflowId: number): unknown;
	getCommandReceiptDetail(workflowId: number, commandId: string): unknown;
	listRequirements(workspaceId: number): Array<{ requirementId: number; workflowId: number }>;
	listRequirementSummaries(workspaceId: number): readonly unknown[];
	getRequirementDetail(requirementId: number): unknown;
	getArtifactRevisionDetail(requirementId: number, kind: string): unknown;
	getPlanRevisionDetail(planRevisionId: number): unknown;
	getTaskDetail(taskId: number): unknown;
	listTaskAttempts(taskId: number): readonly unknown[];
	getAttemptDetail(attemptId: number): unknown;
	getRunDetail(runId: number): unknown;
	getApprovalPacketDetail(packetId: number): unknown;
	getDesignPackage(designPackageId: number): unknown;
	getLegacyImport(requirementId: number): unknown;
	getEvidenceSnapshots(workflowId: number): readonly unknown[];
	getTraceLinks(artifactRevisionId: number): readonly unknown[];
	getFindings(workflowId: number): readonly unknown[];
	getFindingThreads(workflowId: number): readonly unknown[];
	isFindingRiskAcceptanceStale(workflowId: number, findingId: number): boolean;
	getDecisions(workflowId: number): readonly unknown[];
	getHumanGates(workflowId: number): readonly unknown[];
	getApprovalRecords(workflowId: number): readonly unknown[];
	getHumanDirectives(workflowId: number): readonly unknown[];
	getDiagnosticRuns(workflowId: number): readonly unknown[];
	listPendingReviewedArtifacts(workflowId: number): readonly { artifactId: number; revisionId: number; kind: string }[];
	checkReadiness(workflowId: number): unknown;
	getApprovalPacket(workflowId: number): unknown;
	getMigrationAttestation(): { attestationDocumentId: number; reportDigest: string } | null;
	getWorkflowEvents(workflowId: number, after: number, limit: number): readonly unknown[];
	getRunEvents(runId: number, after: number, limit: number): readonly unknown[];
	getWorkflowEventWatermark(workflowId: number): number;
	getRunEventWatermark(runId: number): number;
	runExists(runId: number): boolean;
	subscribeWorkflowEvents(listener: (event: unknown) => void): () => void;
	subscribeRunEvents(listener: (event: unknown) => void): () => void;
	searchWorkspaceContent(workspaceId: number, query: string): readonly unknown[];
	getFeedbackAssetReferences(workflowId: number, query: string, budget: number): readonly unknown[];
	isEvidenceStale(workflowId: number, currentRepoDigest: string): boolean;
	getAttemptContext(attemptId: number): unknown;
	getAttemptBaseVersion(workflowId: number, attemptId: number): number | null;
	getPlanningContextDigest(workflowId: number): string;
	isPlanningContextStale(workflowId: number, attemptId: number): boolean;
}

/**
 * ProjectionReadModel — the read-only projection of governance state.
 *
 * Implements all three narrow read interfaces. During the expand step,
 * delegates to the WorkflowStore's existing read methods (which are already
 * tested). The delegate pattern lets us introduce the class and the three
 * interfaces without rewriting ~25 SQL query implementations.
 */
export class ProjectionReadModel implements WorkflowProjectionReader, EventStreamReader, PlanningContextReader {
	private readonly delegate: ReadModelDelegate;

	constructor(delegate: ReadModelDelegate) {
		this.delegate = delegate;
	}

	// --- WorkflowProjectionReader ---

	getWorkflowProjection(workflowId: number) {
		return this.delegate.getWorkflowProjection(workflowId) as ReturnType<WorkflowProjectionReader["getWorkflowProjection"]>;
	}
	getBoundedProjection(workflowId: number) {
		return this.delegate.getBoundedProjection(workflowId) as ReturnType<WorkflowProjectionReader["getBoundedProjection"]>;
	}
	getCommandReceiptDetail(workflowId: number, commandId: string) {
		return this.delegate.getCommandReceiptDetail(workflowId, commandId) as ReturnType<WorkflowProjectionReader["getCommandReceiptDetail"]>;
	}
	listRequirements(workspaceId: number) {
		return this.delegate.listRequirements(workspaceId);
	}
	listRequirementSummaries(workspaceId: number) {
		return this.delegate.listRequirementSummaries(workspaceId) as ReturnType<WorkflowProjectionReader["listRequirementSummaries"]>;
	}
	getRequirementDetail(requirementId: number) {
		return this.delegate.getRequirementDetail(requirementId) as ReturnType<WorkflowProjectionReader["getRequirementDetail"]>;
	}
	getArtifactRevisionDetail(requirementId: number, kind: string) {
		return this.delegate.getArtifactRevisionDetail(requirementId, kind) as ReturnType<WorkflowProjectionReader["getArtifactRevisionDetail"]>;
	}
	getPlanRevisionDetail(planRevisionId: number) {
		return this.delegate.getPlanRevisionDetail(planRevisionId) as ReturnType<WorkflowProjectionReader["getPlanRevisionDetail"]>;
	}
	getTaskDetail(taskId: number) {
		return this.delegate.getTaskDetail(taskId) as ReturnType<WorkflowProjectionReader["getTaskDetail"]>;
	}
	listTaskAttempts(taskId: number) {
		return this.delegate.listTaskAttempts(taskId) as ReturnType<WorkflowProjectionReader["listTaskAttempts"]>;
	}
	getAttemptDetail(attemptId: number) {
		return this.delegate.getAttemptDetail(attemptId) as ReturnType<WorkflowProjectionReader["getAttemptDetail"]>;
	}
	getRunDetail(runId: number) {
		return this.delegate.getRunDetail(runId) as ReturnType<WorkflowProjectionReader["getRunDetail"]>;
	}
	getApprovalPacketDetail(packetId: number) {
		return this.delegate.getApprovalPacketDetail(packetId) as ReturnType<WorkflowProjectionReader["getApprovalPacketDetail"]>;
	}
	getDesignPackage(designPackageId: number) {
		return this.delegate.getDesignPackage(designPackageId) as ReturnType<WorkflowProjectionReader["getDesignPackage"]>;
	}
	getLegacyImport(requirementId: number) {
		return this.delegate.getLegacyImport(requirementId) as ReturnType<WorkflowProjectionReader["getLegacyImport"]>;
	}
	getEvidenceSnapshots(workflowId: number) {
		return this.delegate.getEvidenceSnapshots(workflowId) as ReturnType<WorkflowProjectionReader["getEvidenceSnapshots"]>;
	}
	getTraceLinks(artifactRevisionId: number) {
		return this.delegate.getTraceLinks(artifactRevisionId) as ReturnType<WorkflowProjectionReader["getTraceLinks"]>;
	}
	getFindings(workflowId: number) {
		return this.delegate.getFindings(workflowId) as ReturnType<WorkflowProjectionReader["getFindings"]>;
	}
	getFindingThreads(workflowId: number) {
		return this.delegate.getFindingThreads(workflowId) as ReturnType<WorkflowProjectionReader["getFindingThreads"]>;
	}
	isFindingRiskAcceptanceStale(workflowId: number, findingId: number) {
		return this.delegate.isFindingRiskAcceptanceStale(workflowId, findingId);
	}
	getDecisions(workflowId: number) {
		return this.delegate.getDecisions(workflowId) as ReturnType<WorkflowProjectionReader["getDecisions"]>;
	}
	getHumanGates(workflowId: number) {
		return this.delegate.getHumanGates(workflowId) as ReturnType<WorkflowProjectionReader["getHumanGates"]>;
	}
	getApprovalRecords(workflowId: number) {
		return this.delegate.getApprovalRecords(workflowId) as ReturnType<WorkflowProjectionReader["getApprovalRecords"]>;
	}
	getHumanDirectives(workflowId: number) {
		return this.delegate.getHumanDirectives(workflowId) as ReturnType<WorkflowProjectionReader["getHumanDirectives"]>;
	}
	getDiagnosticRuns(workflowId: number) {
		return this.delegate.getDiagnosticRuns(workflowId) as ReturnType<WorkflowProjectionReader["getDiagnosticRuns"]>;
	}
	listPendingReviewedArtifacts(workflowId: number) {
		return this.delegate.listPendingReviewedArtifacts(workflowId);
	}
	checkReadiness(workflowId: number) {
		return this.delegate.checkReadiness(workflowId) as ReturnType<WorkflowProjectionReader["checkReadiness"]>;
	}
	getApprovalPacket(workflowId: number) {
		return this.delegate.getApprovalPacket(workflowId) as ReturnType<WorkflowProjectionReader["getApprovalPacket"]>;
	}
	getMigrationAttestation() {
		return this.delegate.getMigrationAttestation();
	}

	// --- EventStreamReader ---

	getWorkflowEvents(workflowId: number, after: number, limit: number) {
		return this.delegate.getWorkflowEvents(workflowId, after, limit) as ReturnType<EventStreamReader["getWorkflowEvents"]>;
	}
	getRunEvents(runId: number, after: number, limit: number) {
		return this.delegate.getRunEvents(runId, after, limit) as ReturnType<EventStreamReader["getRunEvents"]>;
	}
	getWorkflowEventWatermark(workflowId: number) {
		return this.delegate.getWorkflowEventWatermark(workflowId);
	}
	getRunEventWatermark(runId: number) {
		return this.delegate.getRunEventWatermark(runId);
	}
	runExists(runId: number) {
		return this.delegate.runExists(runId);
	}
	subscribeWorkflowEvents(listener: (event: ReturnType<EventStreamReader["getWorkflowEvents"]>[number]) => void) {
		return this.delegate.subscribeWorkflowEvents(listener as (event: unknown) => void) as () => void;
	}
	subscribeRunEvents(listener: (event: ReturnType<EventStreamReader["getRunEvents"]>[number]) => void) {
		return this.delegate.subscribeRunEvents(listener as (event: unknown) => void) as () => void;
	}

	// --- PlanningContextReader ---

	searchWorkspaceContent(workspaceId: number, query: string) {
		return this.delegate.searchWorkspaceContent(workspaceId, query) as ReturnType<PlanningContextReader["searchWorkspaceContent"]>;
	}
	getFeedbackAssetReferences(workflowId: number, query: string, budget: number) {
		return this.delegate.getFeedbackAssetReferences(workflowId, query, budget) as ReturnType<PlanningContextReader["getFeedbackAssetReferences"]>;
	}
	isEvidenceStale(workflowId: number, currentRepoDigest: string) {
		return this.delegate.isEvidenceStale(workflowId, currentRepoDigest);
	}
	getAttemptContext(attemptId: number) {
		return this.delegate.getAttemptContext(attemptId) as ReturnType<PlanningContextReader["getAttemptContext"]>;
	}
	getAttemptBaseVersion(workflowId: number, attemptId: number) {
		return this.delegate.getAttemptBaseVersion(workflowId, attemptId);
	}
	getPlanningContextDigest(workflowId: number) {
		return this.delegate.getPlanningContextDigest(workflowId);
	}
	isPlanningContextStale(workflowId: number, attemptId: number) {
		return this.delegate.isPlanningContextStale(workflowId, attemptId);
	}
}
