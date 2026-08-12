import type {
	ModelDriver,
	ModelDriverInput,
	ModelDriverResult,
	ModelTool,
	PiModelExecutor,
} from "./model-driver.js";

export class PiModelDriver implements ModelDriver {
	constructor(private readonly executor: PiModelExecutor) {}

	execute(
		input: ModelDriverInput,
		tools: readonly ModelTool[],
	): Promise<ModelDriverResult> {
		return this.executor(input, tools);
	}
}

export function createProductionModelDriver(
	executor: PiModelExecutor,
): ModelDriver {
	return new PiModelDriver(executor);
}
