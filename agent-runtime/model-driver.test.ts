import assert from "node:assert/strict";
import test from "node:test";
import type {
	ModelDriverInput,
	ModelTool,
	PiModelExecutor,
} from "./workflow/model-driver.ts";
import {
	PiModelDriver,
	createProductionModelDriver,
} from "./workflow/pi-model-driver.ts";
import {
	ScriptMismatchError,
	ScriptedModelDriver,
} from "./testing/scripted-model-driver.ts";
import { createCrashInjector } from "./testing/deterministic-fixtures.ts";

const input: ModelDriverInput = {
	role: "analyst",
	contextDigest: `sha256:${"a".repeat(64)}`,
	instruction: "Derive the impact profile.",
};

function tools(calls: Array<{ name: string; arguments: unknown }>): ModelTool[] {
	const tool = (name: string, result: unknown): ModelTool => ({
		name,
		execute: async (argumentsValue: unknown) => {
			calls.push({ name, arguments: argumentsValue });
			return result;
		},
	});
	return [
		tool("get_artifact", { revision: 3 }),
		tool("record_finding", { findingId: 9 }),
	];
}

const fixture = {
	role: "analyst" as const,
	contextDigest: input.contextDigest,
	orderedToolCalls: [
		{ name: "get_artifact", arguments: { artifactId: 7, revision: 3 } },
		{ name: "record_finding", arguments: { severity: "minor", summary: "Gap" } },
	],
	structuredResult: {
		role: "analyst",
		outcome: "completed",
		effectRefs: ["finding:9"],
	},
	modelUsage: { provider: "test", modelId: "test", inputTokens: 120, outputTokens: 45 },
};

test("ScriptedModelDriver executes the exact ordered tool transcript", async () => {
	const calls: Array<{ name: string; arguments: unknown }> = [];
	const driver = new ScriptedModelDriver([fixture]);

	const result = await driver.execute(input, tools(calls));

	assert.deepEqual(calls, fixture.orderedToolCalls);
	assert.deepEqual(result, {
		structuredResult: fixture.structuredResult,
		modelUsage: fixture.modelUsage,
	});
	driver.assertExhausted();
});

test("ScriptedModelDriver rejects role, digest, tool, argument, and extra execution mismatches", async (t) => {
	await t.test("role", async () => {
		const driver = new ScriptedModelDriver([fixture]);
		await assert.rejects(
			driver.execute({ ...input, role: "architect" }, tools([])),
			(error: unknown) => error instanceof ScriptMismatchError && error.code === "role_mismatch",
		);
	});
	await t.test("context digest", async () => {
		const driver = new ScriptedModelDriver([fixture]);
		await assert.rejects(
			driver.execute({ ...input, contextDigest: `sha256:${"b".repeat(64)}` }, tools([])),
			(error: unknown) => error instanceof ScriptMismatchError && error.code === "context_digest_mismatch",
		);
	});
	await t.test("missing tool", async () => {
		const driver = new ScriptedModelDriver([fixture]);
		await assert.rejects(
			driver.execute(input, tools([]).filter((tool) => tool.name !== "get_artifact")),
			(error: unknown) => error instanceof ScriptMismatchError && error.code === "tool_mismatch",
		);
	});
	await t.test("duplicate tool name", async () => {
		const available = tools([]);
		available.push(available[0]);
		const driver = new ScriptedModelDriver([fixture]);
		await assert.rejects(
			driver.execute(input, available),
			(error: unknown) => error instanceof ScriptMismatchError && error.code === "tool_mismatch",
		);
	});
	await t.test("tool arguments", async () => {
		const driver = new ScriptedModelDriver([
			{
				...fixture,
				invoke: async ({ tools: available }) => {
					const getArtifact = available.find(({ name }) => name === "get_artifact");
					await getArtifact?.call({ artifactId: 8, revision: 3 });
				},
			},
		]);
		await assert.rejects(
			driver.execute(input, tools([])),
			(error: unknown) =>
				error instanceof ScriptMismatchError && error.code === "tool_arguments_mismatch",
		);
	});
	await t.test("tool order", async () => {
		const driver = new ScriptedModelDriver([
			{
				...fixture,
				invoke: async ({ tools: available }) => {
					const recordFinding = available.find(({ name }) => name === "record_finding");
					await recordFinding?.call(fixture.orderedToolCalls[1].arguments);
				},
			},
		]);
		await assert.rejects(
			driver.execute(input, tools([])),
			(error: unknown) => error instanceof ScriptMismatchError && error.code === "tool_mismatch",
		);
	});
	await t.test("missing tool call", async () => {
		const driver = new ScriptedModelDriver([{ ...fixture, invoke: async () => undefined }]);
		await assert.rejects(
			driver.execute(input, tools([])),
			(error: unknown) => error instanceof ScriptMismatchError && error.code === "tool_mismatch",
		);
	});
	await t.test("extra tool call", async () => {
		const driver = new ScriptedModelDriver([
			{
				...fixture,
				invoke: async ({ tools: available }) => {
					const getArtifact = available.find(({ name }) => name === "get_artifact");
					const recordFinding = available.find(({ name }) => name === "record_finding");
					await getArtifact?.call(fixture.orderedToolCalls[0].arguments);
					await recordFinding?.call(fixture.orderedToolCalls[1].arguments);
					await getArtifact?.call(fixture.orderedToolCalls[0].arguments);
				},
			},
		]);
		await assert.rejects(
			driver.execute(input, tools([])),
			(error: unknown) => error instanceof ScriptMismatchError && error.code === "tool_mismatch",
		);
	});
	await t.test("extra execution", async () => {
		const driver = new ScriptedModelDriver([fixture]);
		await driver.execute(input, tools([]));
		await assert.rejects(
			driver.execute(input, tools([])),
			(error: unknown) => error instanceof ScriptMismatchError && error.code === "unexpected_execution",
		);
	});
});

test("ScriptedModelDriver output is byte-stable for the same fixture", async () => {
	const first = await new ScriptedModelDriver([fixture]).execute(input, tools([]));
	const second = await new ScriptedModelDriver([fixture]).execute(input, tools([]));
	assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("ScriptedModelDriver reaches an optional fixture Crash Point", async () => {
	const crashFixture = { ...fixture, orderedToolCalls: [], crashPoint: "before-result" };
	const driver = new ScriptedModelDriver(
		[crashFixture],
		createCrashInjector(["before-result"]),
	);
	await assert.rejects(driver.execute(input, []), /crash point reached: before-result/);
});

test("production ModelDriver construction always returns PiModelDriver", async () => {
	const executor: PiModelExecutor = async () => ({
		structuredResult: { ok: true },
		modelUsage: { provider: "test", modelId: "test", inputTokens: 1, outputTokens: 1 },
	});
	const driver = createProductionModelDriver(executor);
	assert.ok(driver instanceof PiModelDriver);
	assert.deepEqual(await driver.execute(input, []), {
		structuredResult: { ok: true },
		modelUsage: { provider: "test", modelId: "test", inputTokens: 1, outputTokens: 1 },
	});
});
