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
		const scenario = runtime.createReusableAsset({ workspaceId, kind: "scenario-variant", title: "Checkout", content: { nodeId: "v1", title: "Checkout", actors: ["Customer"], preconditions: [], trigger: "Cart", mainFlow: ["Checkout"], alternateFlows: [], expectedOutcome: "Done" } });
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
			position: 0,
			createdAt: "2026-08-25T10:00:00.000Z",
		});
		assert.deepEqual(second, first);
		assert.deepEqual(runtime.readRelations(scenario.assetId), first);
	});
});

test("asset relations reject invalid kind pairs and block referenced asset deletion", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/repo", name: "repo" });
		const stakeholder = runtime.createReusableAsset({ workspaceId, kind: "stakeholder", title: "Customer", content: { name: "Customer", description: "Buys" } });
		const scenarioVariant = runtime.createReusableAsset({ workspaceId, kind: "scenario-variant", title: "Checkout", content: { nodeId: "v1", title: "Checkout", actors: ["Customer"], preconditions: [], trigger: "Cart", mainFlow: ["Checkout"], alternateFlows: [], expectedOutcome: "Done" } });
		const usecase = runtime.createReusableAsset({ workspaceId, kind: "usecase", title: "Buy", content: { summary: "Buy", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], useCases: [{ id: "u1", actor: "Customer", goal: "Buy", preconditions: [], mainFlow: ["Buy"], alternativeFlows: [], postconditions: ["Done"] }] } });

		assert.throws(
			() => runtime.writeRelations({ workspaceId, fromAssetId: stakeholder.assetId, fromRevisionId: stakeholder.revisionId, relations: [{ toAssetId: scenarioVariant.assetId, type: "involves" }] }),
			(error: unknown) => error instanceof AssetRelationValidationError && error.issues[0]?.reason === "invalid_kind_pair",
		);
		runtime.writeRelations({ workspaceId, fromAssetId: scenarioVariant.assetId, fromRevisionId: scenarioVariant.revisionId, relations: [{ toAssetId: usecase.assetId, type: "contains" }] });
		const database = new Database(databasePath);
		try {
			assert.equal((database.prepare("select count(*) as count from asset_relations").get() as { count: number }).count, 1);
		} finally {
			database.close();
		}
		assert.throws(
			() => runtime.deleteReusableAsset(usecase.assetId),
			(error: unknown) => error instanceof ReusableAssetReferencedError && error.refs[0]?.assetId === scenarioVariant.assetId,
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
		runtime.createReusableAsset({ workspaceId, kind: "scenario", title: "Checkout flow", content: { nodeId: "s1", title: "Checkout flow" } });
		runtime.createReusableAsset({ workspaceId, kind: "scenario", title: "Checkout recovery", content: { nodeId: "s2", title: "Checkout recovery" } });
		runtime.createReusableAsset({ workspaceId, kind: "usecase", title: "Pay", content: { summary: "Pay", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], useCases: [{ id: "u1", actor: "Customer", goal: "Pay", preconditions: [], mainFlow: ["Pay"], alternativeFlows: [], postconditions: ["Done"] }] } });

		const page = runtime.listReusableAssetPage(workspaceId, { page: 2, pageSize: 1, kind: "scenario", q: "CHECKOUT" });

		assert.equal(page.total, 2);
		assert.equal(page.page, 2);
		assert.equal(page.pageSize, 1);
		assert.deepEqual(page.assets.map((asset) => asset.title), ["Checkout flow"]);
		assert.deepEqual(page.kindCounts, {
			"scenario-domain": 0,
			scenario: 2,
			"scenario-variant": 0,
			"function-domain": 0,
			"function-item": 0,
			"function-point": 0,
			usecase: 1,
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
		const scenarioVariant = runtime.createReusableAsset({ workspaceId, kind: "scenario-variant", title: "Checkout", content: { nodeId: "v1", title: "Checkout", actors: ["Customer"], preconditions: [], trigger: "Start", mainFlow: ["Pay"], alternateFlows: [], expectedOutcome: "Done" } });
		const usecase = runtime.createReusableAsset({ workspaceId, kind: "usecase", title: "Pay", content: { summary: "Pay", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], useCases: [{ id: "u1", actor: "Customer", goal: "Pay", preconditions: [], mainFlow: ["Pay"], alternativeFlows: [], postconditions: ["Done"] }] } });
		runtime.writeRelations({
			workspaceId,
			fromAssetId: scenarioVariant.assetId,
			fromRevisionId: scenarioVariant.revisionId,
			relations: [{ toAssetId: usecase.assetId, type: "contains" }],
		});
		const newContent = {
			nodeId: "v2",
			title: "Checkout v2",
			actors: ["Customer"],
			preconditions: [],
			trigger: "Start",
			mainFlow: ["Pay"],
			alternateFlows: [],
			expectedOutcome: "Done v2",
		};
		const updated = runtime.updateReusableAsset({
			workspaceId,
		assetId: scenarioVariant.assetId,
		expectedRevisionId: scenarioVariant.revisionId,
			title: "Checkout v2",
			content: newContent,
			relations: [{ toAssetId: usecase.assetId, type: "contains" }],
		});
		assert.ok(updated);

		assert.equal(updated.revisionNo, 2);
		const detail = runtime.getReusableAsset(scenarioVariant.assetId);
		assert.equal(detail?.title, "Checkout v2");
		assert.deepEqual(detail?.revisions.map((revision) => revision.content), [{ nodeId: "v1", title: "Checkout", actors: ["Customer"], preconditions: [], trigger: "Start", mainFlow: ["Pay"], alternateFlows: [], expectedOutcome: "Done" }, newContent]);
		assert.equal(runtime.readRelations(scenarioVariant.assetId)[0]?.fromRevisionId, updated.revisionId);
		assert.throws(
			() => runtime.updateReusableAsset({
				workspaceId,
				assetId: scenarioVariant.assetId,
				expectedRevisionId: scenarioVariant.revisionId,
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
			content: { schemaVersion: "artifact/scenario/v1", artifactKind: "scenario", summary: "missing domains", sourceRefs: [] },
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
			domains: [{ nodeId: "d1", title: "Domain", scenarios: [{ nodeId: "s1", title: "Scenario", variants: [{ nodeId: "v1", title: "Checkout", actors: ["Customer"], preconditions: [], trigger: "Start", mainFlow: ["Pay"], alternateFlows: [], expectedOutcome: "Complete" }] }] }],
			},
		});
		assert.equal(valid.revisionNo, 1);
	});
});

test("asset relation origin lookup is workspace-scoped", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/repo", name: "repo" });
		const otherWorkspaceId = runtime.createWorkspace({ repoPath: "/other", name: "other" });
	const asset = runtime.createReusableAsset({ workspaceId, kind: "scenario", title: "Checkout", content: { nodeId: "s1", title: "Checkout" } });
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

test("all 12 reusable asset kinds are creatable with valid content", async () => {
	await withRuntime(async ({ runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/repo", name: "repo" });
		const kinds: Array<{ kind: string; title: string; content: unknown }> = [
			{ kind: "scenario-domain", title: "SD", content: { nodeId: "sd1", title: "Scenario Domain" } },
			{ kind: "scenario", title: "S", content: { nodeId: "s1", title: "Scenario" } },
			{ kind: "scenario-variant", title: "SV", content: { nodeId: "sv1", title: "Variant", actors: ["A"], preconditions: [], trigger: "T", mainFlow: ["M"], alternateFlows: [], expectedOutcome: "O" } },
			{ kind: "function-domain", title: "FD", content: { nodeId: "fd1", title: "Function Domain" } },
			{ kind: "function-item", title: "FI", content: { nodeId: "fi1", title: "Function Item" } },
			{ kind: "function-point", title: "FP", content: { nodeId: "fp1", name: "Point", responsibility: "R", inputs: [], outputs: [], businessRules: [], acceptanceCriteria: ["A"] } },
			{ kind: "usecase", title: "UC", content: { summary: "U", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], useCases: [{ id: "u1", actor: "A", goal: "G", preconditions: [], mainFlow: ["M"], alternativeFlows: [], postconditions: ["P"] }] } },
			{ kind: "design", title: "D", content: { schemaVersion: "artifact/design/v1", artifactKind: "design", summary: "D", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], changeUnits: [{ id: "c1", area: "A", change: "C", rationale: "R", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }] }], alternatives: ["a"], failureHandling: ["f"], testStrategy: ["t"], implementationOrder: ["i"], rolloutStrategy: "r", rollbackStrategy: "r" } },
			{ kind: "architecture", title: "Arch", content: { schemaVersion: "artifact/architecture/v1", artifactKind: "architecture", summary: "A", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], components: [{ componentId: "c1", name: "N", responsibility: "R" }], relationships: [], constraints: ["C"], nonFunctionalRequirements: ["N"] } },
			{ kind: "data", title: "Data", content: { schemaVersion: "artifact/data/v1", artifactKind: "data", summary: "D", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], entities: [{ entityId: "e1", name: "E", fields: [{ fieldId: "f1", name: "f", type: "string" }] }] } },
			{ kind: "api", title: "API", content: { schemaVersion: "artifact/api/v1", artifactKind: "api", summary: "A", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], openapi: "3.1.0", info: { title: "API", version: "1" }, paths: { "/test": { summary: "Test", get: { summary: "Get", responses: { "200": { description: "OK" } } } } } } },
			{ kind: "stakeholder", title: "SH", content: { name: "Actor", description: "Desc" } },
		];
		for (const { kind, title, content } of kinds) {
			const created = runtime.createReusableAsset({ workspaceId, kind: kind as never, title, content });
			assert.equal(created.revisionNo, 1, `${kind} should be creatable`);
		}
	});
});
