import type { WritableArtifactKind } from "./plan-types.js";

export interface ArtifactEffectProposal {
	effectType: "artifact_revision";
	artifactKind: WritableArtifactKind;
	logicalKey: string;
	content: unknown;
	baseRevisionId: number | null;
}

export interface RoleResult {
	schemaVersion: "role-result/v1";
	workflowId: number;
	attemptId: number;
	effects: readonly ArtifactEffectProposal[];
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
}

export interface RoleContract {
	schemaVersion: "role-contract/v1";
	role: string;
	writableArtifactKinds: readonly WritableArtifactKind[];
	allowedEffectTypes: readonly string[];
}

export interface BeginAttemptResult {
	taskId: number;
	attemptId: number;
	runId: number;
	contextDigest: string;
	workflowVersion: number;
	lastEventSeq: number;
}

export type CompleteAttemptOutcome = "published" | "failed" | "task_exhausted";

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
