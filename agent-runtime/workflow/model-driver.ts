export type WorkflowAgentRole =
	| "orchestrator"
	| "analyst"
	| "architect"
	| "critic";

export interface ModelDriverInput {
	role: WorkflowAgentRole;
	contextDigest: string;
	instruction: string;
}

export interface ModelTool {
	name: string;
	execute(argumentsValue: unknown): Promise<unknown>;
}

export interface ModelUsage {
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
