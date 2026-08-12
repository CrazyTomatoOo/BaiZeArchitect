export type TaskKind = "analyze" | "design" | "review" | "rework" | "verify";

export type TaskRole = "analyst" | "architect" | "critic";

export type ArtifactKind =
	| "requirement"
	| "analysis"
	| "scenario"
	| "usecase"
	| "function"
	| "design"
	| "architecture"
	| "data"
	| "api";

export type WritableArtifactKind = Exclude<ArtifactKind, "requirement">;

export interface ArtifactRevisionInput {
	type: "artifact_revision";
	artifactId: number;
	revisionId: number;
	artifactKind: ArtifactKind;
	purpose: string;
}

export interface TaskOutputInput {
	type: "task_output";
	taskKey: string;
	artifactKind: WritableArtifactKind;
	purpose: string;
}

export interface DecisionInput {
	type: "decision";
	decisionId: number;
	version: number;
	purpose: string;
}

export interface FindingInput {
	type: "finding";
	findingId: number;
	targetRevisionId: number;
	purpose: string;
}

export interface HumanDirectiveInput {
	type: "human_directive";
	directiveId: number;
	purpose: string;
}

export type InputBinding =
	| ArtifactRevisionInput
	| TaskOutputInput
	| DecisionInput
	| FindingInput
	| HumanDirectiveInput;

export interface ArtifactEffectExpectation {
	kind: WritableArtifactKind;
	operation: "create_or_revise";
}

export interface TaskProposal {
	key: string;
	kind: TaskKind;
	role: TaskRole;
	objective: string;
	dependsOn: readonly string[];
	inputs: readonly InputBinding[];
	expectedArtifactEffects: readonly ArtifactEffectExpectation[];
	completionPolicyRef: string;
	maxAttempts: number;
}

export interface PlanProposalBase {
	workflowId: number;
	workflowVersion: number;
	basePlanRevisionId: number | null;
	planningContextDigest: string;
}

export interface PlanProposal {
	schemaVersion: "plan-proposal/v1";
	base: PlanProposalBase;
	objective: string;
	tasks: readonly TaskProposal[];
	rationale: string;
}

export const ARTIFACT_OWNERSHIP: Readonly<Record<TaskRole, readonly WritableArtifactKind[]>> = {
	analyst: ["analysis", "scenario", "usecase", "function"],
	architect: ["design", "architecture", "data", "api"],
	critic: [],
};

export const PLAN_TASK_LIMITS = {
	maxTasks: 12,
	maxDepth: 6,
	maxAttemptsPerTask: 3,
	maxPlanningAttempts: 2,
	maxConsecutivePlanRevisions: 5,
} as const;
