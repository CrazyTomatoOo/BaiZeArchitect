/**
 * 生产角色（8）: 每生产环节一角色。写权按家族分域（-analyst 系写分析类、-architect 系写架构类），
 * 角色细分只影响模型选择（#15 决议：写权不分家，仅模型分）。
 */
export type ProductionRole =
	| "analysis-analyst"
	| "scenario-analyst"
	| "usecase-analyst"
	| "function-analyst"
	| "design-architect"
	| "architecture-architect"
	| "data-architect"
	| "api-architect";

/**
 * 模型解析角色闭集：8 生产角色 + critic。
 * 过渡保留（expand 阶段，#25 移除）：orchestrator（规划调用面在 #19 拆除前仍需）、analyst/architect（旧契约/测试面）。
 */
export type WorkflowAgentRole =
	| ProductionRole
	| "critic"
	| "orchestrator"
	| "analyst"
	| "architect";

export interface ModelRef {
	provider: string;
	modelId: string;
}

/**
 * 角色 → (provider, modelId) 映射。部署默认档全键；per-workflow override 可任意子集（#15 决议：部分覆盖回落默认）。
 */
export interface ModelRoles {
	["analysis-analyst"]: ModelRef;
	["scenario-analyst"]: ModelRef;
	["usecase-analyst"]: ModelRef;
	["function-analyst"]: ModelRef;
	["design-architect"]: ModelRef;
	["architecture-architect"]: ModelRef;
	["data-architect"]: ModelRef;
	["api-architect"]: ModelRef;
	critic: ModelRef;
	orchestrator: ModelRef;
	analyst: ModelRef;
	architect: ModelRef;
}

/** per-requirement 部分覆盖：任意角色子集（#15 决议），未传回落部署默认档。 */
export type ModelRolesOverride = Partial<ModelRoles>;

export interface ModelDriverInput {
	role: WorkflowAgentRole;
	contextDigest: string;
	instruction: string;
	modelRoles?: ModelRolesOverride;
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
