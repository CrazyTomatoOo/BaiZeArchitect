import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createDomainTools, type DomainToolContext } from "./domain-tools.js";
import { openStore } from "./store.js";

type ToolResult = { isError?: boolean; details?: unknown };

type InvokableTool = {
	name: string;
	execute: (
		id: string,
		params: unknown,
		signal?: AbortSignal,
		onUpdate?: unknown,
		context?: unknown,
	) => Promise<ToolResult>;
};

async function invoke(
	tools: ReturnType<typeof createDomainTools>,
	name: string,
	params: Record<string, unknown>,
): Promise<ToolResult> {
	const tool = tools.find((candidate) => candidate.name === name) as unknown as
		| InvokableTool
		| undefined;
	assert.ok(tool, `missing domain tool: ${name}`);
	return tool.execute("test-tool-call", params);
}

async function setup(): Promise<{
	store: ReturnType<typeof openStore>;
	context: DomainToolContext;
	repoPath: string;
}> {
	const repoPath = await mkdtemp(join(tmpdir(), "baize-domain-tools-"));
	await mkdir(join(repoPath, "src"));
	await writeFile(join(repoPath, "README.md"), "repository overview\n");
	await writeFile(
		join(repoPath, "src", "checkout.ts"),
		"export function submitOrder() { return true; }\n",
	);
	const store = openStore(":memory:");
	const workspaceId = store.addWorkspace(repoPath, "Tools workspace");
	const requirementId = store.addRequirement(workspaceId, "Design checkout");
	const session = store.createDesignSession(
		requirementId,
		join(repoPath, "session.jsonl"),
		"tool-session",
	);
	const run = store.createRun(requirementId, session.id, "stage", "分析");
	store.setRunStatus(run.id, "running");
	return {
		store,
		repoPath,
		context: { store, requirementId, runId: run.id, workspaceId, repoPath },
	};
}

test("audits successful and failed restricted repository tools", async () => {
	const { store, context, repoPath } = await setup();
	try {
		const tools = createDomainTools(context);
		assert.deepEqual(
			tools.map((tool) => tool.name),
			[
				"inspect_repository",
				"search_code",
				"get_architecture",
				"search_prior_designs",
				"get_artifact",
				"patch_artifact",
				"raise_decision",
				"record_finding",
				"run_consistency_check",
				"request_human_input",
			],
		);
		const inspected = await invoke(tools, "inspect_repository", { path: "." });
		assert.equal(inspected.isError, undefined);
		assert.ok(
			(inspected.details as { files: string[] }).files.includes(
				"src/checkout.ts",
			),
		);
		const searched = await invoke(tools, "search_code", {
			query: "submitOrder",
		});
		assert.equal(searched.isError, undefined);
		const failed = await invoke(tools, "search_code", {
			query: "x",
			path: "../outside",
		});
		assert.equal(failed.isError, true);
		assert.deepEqual(
			store
				.listToolCalls(context.runId)
				.map((call) => [call.name, call.status]),
			[
				["inspect_repository", "completed"],
				["search_code", "completed"],
				["search_code", "failed"],
			],
		);
		assert.equal(
			store.listToolCalls(context.runId)[2]?.error,
			"path must stay inside the repository",
		);
	} finally {
		store.close();
		await rm(repoPath, { recursive: true, force: true });
	}
});

test("patches artifact revisions and records decisions, findings, and consistency", async () => {
	const { store, context, repoPath } = await setup();
	try {
		const artifact = store.createArtifact(
			context.requirementId,
			"design",
			"Checkout",
		);
		const first = store.createArtifactRevision(artifact.id, context.runId, {
			version: 1,
		});
		const tools = createDomainTools(context);
		const patched = await invoke(tools, "patch_artifact", {
			artifactId: artifact.id,
			content: { version: 2 },
		});
		assert.equal(patched.isError, undefined);
		const revisions = store.listArtifactRevisions(artifact.id);
		assert.equal(revisions.length, 2);
		assert.equal(revisions[1]?.fork_from_revision_id, first.id);

		const decision = await invoke(tools, "raise_decision", {
			title: "Checkout mode",
			question: "Which mode should be used?",
			options: [{ title: "Inline" }],
		});
		assert.equal(decision.isError, undefined);
		const finding = await invoke(tools, "record_finding", {
			severity: "medium",
			title: "Missing retry path",
			content: { file: "src/checkout.ts", line: 1 },
		});
		assert.equal(finding.isError, undefined);
		const human = await invoke(tools, "request_human_input", {
			question: "Need product owner input",
		});
		assert.equal(human.isError, undefined);
		assert.equal(
			(human.details as { status: string }).status,
			"waiting_for_human",
		);
		const consistency = await invoke(tools, "run_consistency_check", {});
		assert.equal(consistency.isError, undefined);
		assert.deepEqual((consistency.details as { ok: boolean }).ok, true);
		assert.deepEqual(
			store.listToolCalls(context.runId).map((call) => call.name),
			[
				"patch_artifact",
				"raise_decision",
				"record_finding",
				"request_human_input",
				"run_consistency_check",
			],
		);
	} finally {
		store.close();
		await rm(repoPath, { recursive: true, force: true });
	}
});
