/**
 * projection-read-interfaces.ts — three narrow read interfaces per ADR-011.
 *
 * Each consumer of the Projection Read Model sees only the surface it needs:
 * - WorkflowProjectionReader: HTTP read routes (projection, detail, list)
 * - EventStreamReader: SSE event streams (replay, watermark, subscribe)
 * - PlanningContextReader: headless-runtime orchestration (search, feedback, context)
 */
import type { AssetReference } from "../workflow/role-result.js";
import type { RequirementBaseline } from "../workflow/requirement.js";
import type { ModelRolesOverride } from "../workflow/model-driver.js";

// Re-export the record types that the interfaces reference (defined in projection-read-model.ts)
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
} from "./projection-read-model.js";

import type {
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
	ReadinessReport,
	ApprovalPacketRecord,
	HumanGateRecord,
	ApprovalRecordEntry,
	HumanDirectiveRecord,
	DiagnosticRunRecord,
	WorkflowEventEnvelope,
	RunEventEnvelope,
	SearchHit,
} from "./projection-read-model.js";

/** Read surface for OperatorServer projection/detail/list routes. */
export interface WorkflowProjectionReader {
	getWorkflowProjection(workflowId: number): WorkflowProjection | undefined;
	getBoundedProjection(workflowId: number): BoundedWorkflowProjection | undefined;
	getCommandReceiptDetail(workflowId: number, commandId: string): CommandReceiptDetail | undefined;
	getCommandReceipt(workflowId: number, commandId: string): CommandReceipt | undefined;
	listRequirements(workspaceId: number): Array<{ requirementId: number; workflowId: number }>;
	listRequirementSummaries(workspaceId: number): readonly RequirementSummaryRecord[];
	getRequirementDetail(requirementId: number): RequirementDetailRecord | undefined;
	getArtifactRevisionDetail(requirementId: number, kind: string): ArtifactRevisionDetailRecord | undefined;
	getPlanRevisionDetail(planRevisionId: number): PlanRevisionDetail | undefined;
	getTaskDetail(taskId: number): TaskDetailRecord | undefined;
	listTaskAttempts(taskId: number): readonly AttemptSummaryRecord[];
	getAttemptDetail(attemptId: number): AttemptDetailRecord | undefined;
	getRunDetail(runId: number): RunDetailRecord | undefined;
	getApprovalPacketDetail(packetId: number): ApprovalPacketDetailRecord | undefined;
	getDesignPackage(designPackageId: number): DesignPackageRecord | undefined;
	getLegacyImport(requirementId: number): LegacyImportRecord | undefined;
	getEvidenceSnapshots(workflowId: number): readonly EvidenceSnapshotResult[];
	getTraceLinks(artifactRevisionId: number): readonly TraceLinkResult[];
	getFindings(workflowId: number): readonly FindingRecord[];
	getFindingThreads(workflowId: number): readonly FindingThreadRecord[];
	isFindingRiskAcceptanceStale(workflowId: number, findingId: number): boolean;
	getDecisions(workflowId: number): readonly DecisionRecord[];
	getHumanGates(workflowId: number): readonly HumanGateRecord[];
	getApprovalRecords(workflowId: number): readonly ApprovalRecordEntry[];
	getHumanDirectives(workflowId: number): readonly HumanDirectiveRecord[];
	getDiagnosticRuns(workflowId: number): readonly DiagnosticRunRecord[];
	listPendingReviewedArtifacts(workflowId: number): readonly { artifactId: number; revisionId: number; kind: string }[];
	checkReadiness(workflowId: number): ReadinessReport;
	getApprovalPacket(workflowId: number): ApprovalPacketRecord | undefined;
	getMigrationAttestation(): { attestationDocumentId: number; reportDigest: string } | null;
}

/** Read surface for SSE event streams. */
export interface EventStreamReader {
	getWorkflowEvents(workflowId: number, after: number, limit: number): readonly WorkflowEventEnvelope[];
	getRunEvents(runId: number, after: number, limit: number): readonly RunEventEnvelope[];
	getWorkflowEventWatermark(workflowId: number): number;
	getRunEventWatermark(runId: number): number;
	runExists(runId: number): boolean;
	subscribeWorkflowEvents(listener: (event: WorkflowEventEnvelope) => void): () => void;
	subscribeRunEvents(listener: (event: RunEventEnvelope) => void): () => void;
}

/** Read surface for headless-runtime orchestration (search, feedback, attempt context). */
export interface PlanningContextReader {
	searchWorkspaceContent(workspaceId: number, query: string): readonly SearchHit[];
	getFeedbackAssetReferences(workflowId: number, query: string, budget: number): readonly AssetReference[];
	isEvidenceStale(workflowId: number, currentRepoDigest: string): boolean;
	getAttemptContext(attemptId: number): { role: string; objective: string; requirementBaseline: RequirementBaseline; inputs: readonly unknown[]; expectedArtifactKind: string; expectedArtifactKinds: readonly string[] } | undefined;
	getAttemptBaseVersion(workflowId: number, attemptId: number): number | null;
	getPlanningContextDigest(workflowId: number): string;
	isPlanningContextStale(workflowId: number, attemptId: number): boolean;
}
