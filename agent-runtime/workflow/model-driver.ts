export type WorkflowAgentRole =
	| "orchestrator"
	| "analyst"
	| "architect"
	| "critic";

export interface ModelRef {
	provider: string;
	modelId: string;
}

export interface ModelRoles {
	orchestrator: ModelRef;
	analyst: ModelRef;
	architect: ModelRef;
	critic: ModelRef;
}

export interface ModelDriverInput {
	role: WorkflowAgentRole;
	contextDigest: string;
	instruction: string;
	modelRoles?: ModelRoles;
}

export interface ModelTool {
	name: string;
	execute(argumentsValue: unknown): Promise<unknown>;
}

export interface ModelUsage {
	provider: string;
	modelId: string;
	inputTokens: number;
	outputTokens: number;
}

export interface ModelDriverResult {
	structuredResult: unknown;
	modelUsage: ModelUsage;
}

export interface ModelDriver {
	execute(
		input: ModelDriverInput,
		tools: readonly ModelTool[],
	): Promise<ModelDriverResult>;
}

export type PiModelExecutor = (
	input: ModelDriverInput,
	tools: readonly ModelTool[],
) => Promise<ModelDriverResult>;
