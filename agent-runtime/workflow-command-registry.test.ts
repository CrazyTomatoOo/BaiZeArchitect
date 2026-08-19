import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WORKFLOW_COMMAND_TYPES } from "./workflow/command-types.ts";

interface WorkflowApiV1 {
	commands: Record<string, unknown>;
}

test("contract catalog commands enum matches the command registry (no drift)", async () => {
	const raw = await readFile(
		new URL("./contracts/workflow-api-v1.json", import.meta.url),
		"utf8",
	);
	const catalog = JSON.parse(raw) as WorkflowApiV1;
	const catalogNames = Object.keys(catalog.commands).sort();
	const registryNames = [...WORKFLOW_COMMAND_TYPES].sort();
	assert.deepEqual(
		catalogNames,
		registryNames,
		"workflow-api-v1.json commands enum drifted from WORKFLOW_COMMAND_TYPES",
	);
});