import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCrashInjector, createFixtureClock, createHashProvider, createOutboxTransport } from "./testing/deterministic-fixtures.js";
import { openHeadlessWorkflowRuntime, type HeadlessWorkflowRuntime } from "./workflow/headless-runtime.js";
import { ImportDigestConflictError } from "./persistence/workflow-store.js";

async function withRuntime(work: (fixture: { databasePath: string; runtime: HeadlessWorkflowRuntime }) => Promise<void> | void): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-import-"));
	const databasePath = path.join(directory, "workflow.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock("2026-08-28T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector([]),
		outboxTransport: createOutboxTransport(),
	});
	try {
		await work({ databasePath, runtime });
	} finally {
		runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
}

const validScenarioVariant = { nodeId: "v1", title: "Checkout", actors: ["Customer"], preconditions: [], trigger: "Cart", mainFlow: ["Pay"], alternateFlows: [], expectedOutcome: "Done" };
const validScenarioDomain = { nodeId: "sd1", title: "Payment Domain" };

test("previewImportBundle returns summary with createCount and previewDigest", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
		const preview = runtime.previewImportBundle(ws, [
		{ kind: "scenario-variant" as const, title: "Checkout", content: validScenarioVariant },
		]);
		assert.equal(preview.summary.createCount, 1);
		assert.equal(preview.summary.reuseCount, 0);
		assert.ok(preview.previewDigest.length > 0);
	});
});

test("commitImportBundle with matching digest creates assets", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
	const assets = [{ kind: "scenario-variant" as const, title: "Checkout", content: validScenarioVariant }];
		const preview = runtime.previewImportBundle(ws, assets);
		const ids = runtime.commitImportBundle(ws, assets, [], preview.previewDigest);
		assert.equal(ids.length, 1);
	});
});

test("commitImportBundle with wrong digest throws ImportDigestConflictError", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
	const assets = [{ kind: "scenario-variant" as const, title: "Checkout", content: validScenarioVariant }];
		assert.throws(
			() => runtime.commitImportBundle(ws, assets, [], "wrong-digest"),
			(error: unknown) => error instanceof ImportDigestConflictError,
		);
	});
});

test("preview detects reuse by nodeId path matching", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
	const assets = [{ kind: "scenario-domain" as const, title: "Payment", content: validScenarioDomain }];
		const preview1 = runtime.previewImportBundle(ws, assets);
		runtime.commitImportBundle(ws, assets, [], preview1.previewDigest);
		const preview2 = runtime.previewImportBundle(ws, assets);
		assert.equal(preview2.summary.createCount, 0);
		assert.equal(preview2.summary.reuseCount, 1);
	});
});

test("pure OpenAPI document import auto-supplements BaiZe fields", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
		const openapiDoc = { openapi: "3.1.0", info: { title: "Payment API", version: "1" }, paths: { "/pay": { summary: "Pay", post: { summary: "Process payment", responses: { "200": { description: "OK" } } } } } };
	const assets = [{ kind: "api" as const, title: "Payment API", content: openapiDoc }];
		const preview = runtime.previewImportBundle(ws, assets);
		assert.equal(preview.summary.createCount, 1);
		assert.equal(preview.summary.validationErrors.length, 0);
	});
});
