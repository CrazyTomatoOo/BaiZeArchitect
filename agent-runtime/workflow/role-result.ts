import type { TaskRole, WritableArtifactKind } from "./plan-types.js";

export interface TraceLinkProposal {
	evidenceSnapshotId: number;
	sourceRef: unknown;
}

export interface ArtifactEffectProposal {
	effectType: "artifact_revision";
	artifactKind: WritableArtifactKind;
	logicalKey: string;
	content: unknown;
	baseRevisionId: number | null;
	traceLinks?: readonly TraceLinkProposal[];
}

export type DecisionSeverity = "critical" | "major" | "minor";

export interface DecisionProposal {
	severity: DecisionSeverity;
	summary: string;
}

export interface RoleResult {
	schemaVersion: "role-result/v1";
	workflowId: number;
	attemptId: number;
	effects: readonly ArtifactEffectProposal[];
	criticReport?: CriticReport;
	decisionProposals?: readonly DecisionProposal[];
}

/** #24 回授注入引用：检索命中的历史资产引用 + 摘要（预算内 top-N 截断）。 */
export interface AssetReference {
	assetId: number;
	kind: string;
	title: string;
	excerpt: string;
}

export interface ContextManifest {
	schemaVersion: "context-manifest/v1";
	workflowId: number;
	workflowVersion: number;
	requirement: { revisionId: number; digest: string };
	planRevisionId: number;
	task: { id: number; key: string; kind: string; role: string; objective: string };
	roleContract: { documentId: number; identity: string; digest: string };
	policyBundleDigest: string;
	inputs: readonly unknown[];
	inputDigest: string;
	/** #24 历史资产引用（critic 不注入；缺失 = 无注入）。 */
	relevantAssets?: readonly AssetReference[];
}

export interface RoleContract {
	schemaVersion: "role-contract/v1";
	role: string;
	writableArtifactKinds: readonly WritableArtifactKind[];
	allowedEffectTypes: readonly string[];
}

export interface BeginAttemptResult {
	taskId: number;
	taskKey: string;
	taskRole: string;
	attemptId: number;
	runId: number;
	contextDigest: string;
	workflowVersion: number;
	lastEventSeq: number;
}

export type CompleteAttemptOutcome = "published" | "failed" | "task_exhausted" | "blocked" | "replan_requested" | "late_result_audit";

export interface CompleteAttemptResult {
	outcome: CompleteAttemptOutcome;
	failureCode: string | null;
	workflowVersion: number;
	lastEventSeq: number;
}

export interface ExecuteTaskResult {
	outcome: "published" | "task_exhausted" | "no_ready_task";
	workflowVersion: number;
	lastEventSeq: number;
}

export type FindingSeverity = "critical" | "major" | "minor" | "info";

export interface FindingProposal {
	fingerprint: string;
	severity: FindingSeverity;
	summary: string;
	targetRevisionId: number;
	targetArtifactKind: WritableArtifactKind;
	sourceRef: string;
	evidence?: unknown;
	resolved?: boolean;
}

export interface CoverageTarget {
	revisionId: number;
	artifactKind: string;
}

export interface CoverageAttestation {
	reviewTargets: readonly CoverageTarget[];
	complete: boolean;
}

export interface CriticReport {
	schemaVersion: "critic-report/v1";
	workflowId: number;
	attemptId: number;
	coverageAttestation: CoverageAttestation;
	findings: readonly FindingProposal[];
}
