export type TaskKind = "analyze" | "design" | "review" | "rework" | "verify";

/** 生产角色（8，#15 决议：每生产环节一角色）+ critic。旧 analyst/architect 过渡保留（expand，#25 移除）。 */
export type TaskRole =
	| ProductionRole
	| "critic"
	| "analyst"
	| "architect";

export type ProductionRole =
	| "analysis-analyst"
	| "scenario-analyst"
	| "usecase-analyst"
	| "function-analyst"
	| "design-architect"
	| "architecture-architect"
	| "data-architect"
	| "api-architect";

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

/** 写权按家族分域（#15 决议：写权不分家，仅模型分）。-analyst 系写分析类、-architect 系写架构类。旧角色过渡保留映射。 */
export const ARTIFACT_OWNERSHIP: Readonly<Record<TaskRole, readonly WritableArtifactKind[]>> = {
	// 分析系（8 个生产角色中 4 个 analysis/scenario/usecase/function-analyst）
	"analysis-analyst": ["analysis", "scenario", "usecase", "function"],
	"scenario-analyst": ["analysis", "scenario", "usecase", "function"],
	"usecase-analyst": ["analysis", "scenario", "usecase", "function"],
	"function-analyst": ["analysis", "scenario", "usecase", "function"],
	// 架构系（design/architecture/data/api-architect）
	"design-architect": ["design", "architecture", "data", "api"],
	"architecture-architect": ["design", "architecture", "data", "api"],
	"data-architect": ["design", "architecture", "data", "api"],
	"api-architect": ["design", "architecture", "data", "api"],
	// critic 与旧角色（过渡保留）
	critic: [],
	analyst: ["analysis", "scenario", "usecase", "function"],
	architect: ["design", "architecture", "data", "api"],
};

export const PLAN_TASK_LIMITS = {
	maxTasks: 12,
	maxDepth: 6,
	maxAttemptsPerTask: 3,
	maxPlanningAttempts: 2,
	maxConsecutivePlanRevisions: 5,
} as const;
