import { isDeepStrictEqual } from "node:util";
import type {
	ModelDriver,
	ModelDriverInput,
	ModelDriverResult,
	ModelTool,
	ModelUsage,
	WorkflowAgentRole,
} from "../workflow/model-driver.js";
import type { CrashInjector } from "./deterministic-fixtures.js";

export interface ScriptedToolCall {
	name: string;
	arguments: unknown;
}

export interface ScriptedModelInvocation {
	role: WorkflowAgentRole;
	contextDigest: string;
	input: ModelDriverInput;
	tools: readonly {
		name: string;
		call: (argumentsValue: unknown) => Promise<unknown>;
	}[];
}

export interface ScriptedModelStep {
	role: WorkflowAgentRole;
	contextDigest: string;
	orderedToolCalls: readonly ScriptedToolCall[];
	structuredResult: unknown;
	modelUsage: ModelUsage;
	crashPoint?: string;
	invoke?: (invocation: ScriptedModelInvocation) => Promise<void>;
}

export type ScriptMismatchCode =
	| "unexpected_execution"
	| "role_mismatch"
	| "context_digest_mismatch"
	| "tool_mismatch"
	| "tool_arguments_mismatch"
	| "unused_script";

export class ScriptMismatchError extends Error {
	constructor(
		public readonly code: ScriptMismatchCode,
		message: string,
	) {
		super(message);
		this.name = "ScriptMismatchError";
	}
}

function clone<T>(value: T): T {
	return structuredClone(value);
}

function uniqueTool(tools: readonly ModelTool[], name: string): ModelTool {
	const matches = tools.filter((tool) => tool.name === name);
	if (matches.length !== 1) {
		throw new ScriptMismatchError(
			"tool_mismatch",
			`expected exactly one tool ${name}; available: ${tools.map((tool) => tool.name).join(", ")}`,
		);
	}
	return matches[0];
}

export class ScriptedModelDriver implements ModelDriver {
	private index = 0;

	constructor(
		private readonly script: readonly ScriptedModelStep[],
		private readonly crashInjector?: CrashInjector,
	) {}

	async execute(
		input: ModelDriverInput,
		tools: readonly ModelTool[],
	): Promise<ModelDriverResult> {
		const step = this.script[this.index];
		if (!step) {
			throw new ScriptMismatchError(
				"unexpected_execution",
				`no scripted execution remains for ${input.role}`,
			);
		}
		if (step.role !== input.role) {
			throw new ScriptMismatchError(
				"role_mismatch",
				`expected role ${step.role}; received ${input.role}`,
			);
		}
		if (step.contextDigest !== input.contextDigest) {
			throw new ScriptMismatchError(
				"context_digest_mismatch",
				`expected context ${step.contextDigest}; received ${input.contextDigest}`,
			);
		}

		if (step.crashPoint) this.crashInjector?.reach(step.crashPoint);
		let callIndex = 0;
		const instrumentedTools = tools.map((tool) => ({
			name: tool.name,
			call: async (argumentsValue: unknown) => {
				const expected = step.orderedToolCalls[callIndex];
				if (!expected || expected.name !== tool.name) {
					throw new ScriptMismatchError(
						"tool_mismatch",
						`expected tool ${expected?.name ?? "<none>"} at call ${callIndex + 1}; received ${tool.name}`,
					);
				}
				if (!isDeepStrictEqual(argumentsValue, expected.arguments)) {
					throw new ScriptMismatchError(
						"tool_arguments_mismatch",
						`tool ${tool.name} arguments do not match scripted call ${callIndex + 1}`,
					);
				}
				callIndex += 1;
				return tool.execute(clone(argumentsValue));
			},
		}));
		for (const expected of step.orderedToolCalls) uniqueTool(tools, expected.name);
		if (step.invoke) {
			await step.invoke({ role: input.role, contextDigest: input.contextDigest, input, tools: instrumentedTools });
		} else {
			for (const expected of step.orderedToolCalls) {
				const tool = instrumentedTools.find(({ name }) => name === expected.name);
				if (!tool) throw new ScriptMismatchError("tool_mismatch", `missing tool ${expected.name}`);
				await tool.call(clone(expected.arguments));
			}
		}
		if (callIndex !== step.orderedToolCalls.length) {
			throw new ScriptMismatchError(
				"tool_mismatch",
				`expected ${step.orderedToolCalls.length} tool calls; received ${callIndex}`,
			);
		}
		this.index += 1;
		return clone({
			structuredResult: step.structuredResult,
			modelUsage: step.modelUsage,
		});
	}

	assertExhausted(): void {
		if (this.index !== this.script.length) {
			throw new ScriptMismatchError(
				"unused_script",
				`${this.script.length - this.index} scripted execution(s) were not used`,
			);
		}
	}
}
