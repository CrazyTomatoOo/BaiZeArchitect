import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { createCrashInjector, createFixtureClock, createHashProvider, createOutboxTransport } from "./testing/deterministic-fixtures.ts";
import { AssetRelationValidationError } from "./persistence/asset-relations.ts";
import { ReusableAssetReferencedError } from "./persistence/workflow-store.ts";
import type { HeadlessWorkflowRuntime } from "./workflow/headless-runtime.ts";
import { openHeadlessWorkflowRuntime } from "./workflow/headless-runtime.ts";

async function withRuntime(work: (fixture: { databasePath: string; runtime: HeadlessWorkflowRuntime }) => Promise<void> | void): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-asset-relations-"));
	const databasePath = path.join(directory, "workflow.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock("2026-08-25T10:00:00.000Z"),
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

test("asset relations store revision-pinned edges and deduplicates identical writes", async () => {
	await withRuntime(async ({ runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/repo", name: "repo" });
		const scenario = runtime.createReusableAsset({ workspaceId, kind: "scenario", title: "Checkout", content: { title: "Checkout" } });
		const stakeholder = runtime.createReusableAsset({ workspaceId, kind: "stakeholder", title: "Customer", content: { name: "Customer", description: "Buys products" } });

		const first = runtime.writeRelations({
			workspaceId,
			fromAssetId: scenario.assetId,
			fromRevisionId: scenario.revisionId,
			relations: [{ toAssetId: stakeholder.assetId, type: "involves" }],
		});
		const second = runtime.writeRelations({
			workspaceId,
			fromAssetId: scenario.assetId,
			fromRevisionId: scenario.revisionId,
			relations: [{ toAssetId: stakeholder.assetId, type: "involves" }],
		});

		assert.equal(first.length, 1);
		assert.deepEqual(first[0], {
			id: first[0].id,
			fromAssetId: scenario.assetId,
			toAssetId: stakeholder.assetId,
			fromRevisionId: scenario.revisionId,
			toRevisionId: stakeholder.revisionId,
			type: "involves",
			createdAt: "2026-08-25T10:00:00.000Z",
		});
		assert.deepEqual(second, first);
		assert.deepEqual(runtime.readRelations(scenario.assetId), first);
	});
});

test("asset relations reject invalid kind pairs and block referenced asset deletion", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/repo", name: "repo" });
		const stakeholder = runtime.createReusableAsset({ workspaceId, kind: "stakeholder", title: "Customer", content: { name: "Customer" } });
		const scenario = runtime.createReusableAsset({ workspaceId, kind: "scenario", title: "Checkout", content: { title: "Checkout" } });
		const usecase = runtime.createReusableAsset({ workspaceId, kind: "usecase", title: "Buy", content: { title: "Buy" } });

		assert.throws(
			() => runtime.writeRelations({ workspaceId, fromAssetId: stakeholder.assetId, fromRevisionId: stakeholder.revisionId, relations: [{ toAssetId: scenario.assetId, type: "involves" }] }),
			(error: unknown) => error instanceof AssetRelationValidationError && error.issues[0]?.reason === "invalid_kind_pair",
		);
		runtime.writeRelations({ workspaceId, fromAssetId: scenario.assetId, fromRevisionId: scenario.revisionId, relations: [{ toAssetId: usecase.assetId, type: "contains" }] });
		const database = new Database(databasePath);
		try {
			assert.equal((database.prepare("select count(*) as count from asset_relations").get() as { count: number }).count, 1);
		} finally {
			database.close();
		}
		assert.throws(
			() => runtime.deleteReusableAsset(usecase.assetId),
			(error: unknown) => error instanceof ReusableAssetReferencedError && error.refs[0]?.assetId === scenario.assetId,
		);
		const reopened = new Database(databasePath);
		try {
			assert.equal((reopened.prepare("select count(*) as count from asset_relations").get() as { count: number }).count, 1);
		} finally {
			reopened.close();
		}
	});
});

test("asset list pages by kind and filters titles while reporting workspace kind counts", async () => {
	await withRuntime(async ({ runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/repo", name: "repo" });
		runtime.createReusableAsset({ workspaceId, kind: "scenario", title: "Checkout flow", content: { title: "Checkout flow" } });
		runtime.createReusableAsset({ workspaceId, kind: "scenario", title: "Checkout recovery", content: { title: "Checkout recovery" } });
		runtime.createReusableAsset({ workspaceId, kind: "usecase", title: "Pay", content: { title: "Pay" } });

		const page = runtime.listReusableAssetPage(workspaceId, { page: 2, pageSize: 1, kind: "scenario", q: "CHECKOUT" });

		assert.equal(page.total, 2);
		assert.equal(page.page, 2);
		assert.equal(page.pageSize, 1);
		assert.deepEqual(page.assets.map((asset) => asset.title), ["Checkout flow"]);
		assert.deepEqual(page.kindCounts, {
			scenario: 2,
			usecase: 1,
			function: 0,
			design: 0,
			architecture: 0,
			data: 0,
			api: 0,
			stakeholder: 0,
		});
	});
});

test("asset updates append a revision, replace outgoing relations atomically, and reject stale revisions", async () => {
	await withRuntime(async ({ runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/repo", name: "repo" });
		const scenario = runtime.createReusableAsset({ workspaceId, kind: "scenario", title: "Checkout", content: { steps: ["old"] } });
		const usecase = runtime.createReusableAsset({ workspaceId, kind: "usecase", title: "Pay", content: { steps: ["pay"] } });
		runtime.writeRelations({
			workspaceId,
			fromAssetId: scenario.assetId,
			fromRevisionId: scenario.revisionId,
			relations: [{ toAssetId: usecase.assetId, type: "contains" }],
		});
		const newContent = {
			schemaVersion: "artifact/scenario/v1",
			artifactKind: "scenario",
			summary: "Checkout v2",
			sourceRefs: [],
			scenarios: [{ id: "checkout-v2", title: "Checkout v2", actors: ["Customer"], preconditions: [], trigger: "Start", mainFlow: ["Pay"], alternateFlows: [], expectedOutcome: "Done" }],
		};
		const updated = runtime.updateReusableAsset({
			workspaceId,
			assetId: scenario.assetId,
			expectedRevisionId: scenario.revisionId,
			title: "Checkout v2",
			content: newContent,
			relations: [],
		});
		assert.ok(updated);

		assert.equal(updated.revisionNo, 2);
		const detail = runtime.getReusableAsset(scenario.assetId);
		assert.equal(detail?.title, "Checkout v2");
		assert.deepEqual(detail?.revisions.map((revision) => revision.content), [{ steps: ["old"] }, newContent]);
		assert.deepEqual(runtime.readRelations(scenario.assetId), []);
		assert.throws(
			() => runtime.updateReusableAsset({
				workspaceId,
				assetId: scenario.assetId,
				expectedRevisionId: scenario.revisionId,
				title: "stale",
				content: newContent,
				relations: [],
			}),
			(error: unknown) => error instanceof Error && error.name === "ReusableAssetVersionConflictError",
		);
	});
});

test("marked asset content is validated against the artifact v1 schema while legacy item content remains readable", async () => {
	await withRuntime(async ({ runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/repo", name: "repo" });
		assert.throws(
			() => runtime.createReusableAsset({
				workspaceId,
				kind: "scenario",
				title: "Invalid",
				content: { schemaVersion: "artifact/scenario/v1", artifactKind: "scenario", summary: "missing scenarios", sourceRefs: [] },
			}),
			(error: unknown) => error instanceof Error && error.message.includes("malformed"),
		);
		const valid = runtime.createReusableAsset({
			workspaceId,
			kind: "scenario",
			title: "Valid",
			content: {
				schemaVersion: "artifact/scenario/v1",
				artifactKind: "scenario",
				summary: "A valid scenario",
				sourceRefs: [],
				scenarios: [{ id: "s1", title: "Checkout", actors: ["Customer"], preconditions: [], trigger: "Start", mainFlow: ["Pay"], alternateFlows: [], expectedOutcome: "Complete" }],
			},
		});
		assert.equal(valid.revisionNo, 1);
	});
});

test("asset relation origin lookup is workspace-scoped", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/repo", name: "repo" });
		const otherWorkspaceId = runtime.createWorkspace({ repoPath: "/other", name: "other" });
		const asset = runtime.createReusableAsset({ workspaceId, kind: "scenario", title: "Checkout", content: { title: "Checkout" } });
		const database = new Database(databasePath);
		try {
			database.prepare("update reusable_assets set origin_artifact_id = ? where id = ?").run(42, asset.assetId);
		} finally {
			database.close();
		}
		assert.equal(runtime.assetExistsByOriginArtifactId(workspaceId, 42), true);
		assert.equal(runtime.assetExistsByOriginArtifactId(otherWorkspaceId, 42), false);
	});
});
