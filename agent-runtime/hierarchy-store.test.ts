import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createCrashInjector, createFixtureClock, createHashProvider, createOutboxTransport } from "./testing/deterministic-fixtures.js";
import { openHeadlessWorkflowRuntime, type HeadlessWorkflowRuntime } from "./workflow/headless-runtime.js";

async function withRuntime(work: (fixture: { databasePath: string; runtime: HeadlessWorkflowRuntime }) => Promise<void> | void): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-hierarchy-"));
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

test("createSubtree creates a 3-level scenario tree atomically", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
		const tree = {
			kind: "scenario-domain",
			title: "Payment Domain",
			content: { nodeId: "sd1", title: "Payment Domain" },
			children: [
				{
					kind: "scenario",
					title: "Checkout",
					content: { nodeId: "s1", title: "Checkout" },
					children: [
						{
							kind: "scenario-variant",
							title: "Happy Path",
							content: { nodeId: "v1", title: "Happy Path", actors: ["Customer"], preconditions: [], trigger: "Cart", mainFlow: ["Pay"], alternateFlows: [], expectedOutcome: "Done" },
						},
					],
				},
			],
		};
		const result = runtime.createHierarchySubtree(ws, tree, null);
		assert.equal(result.assets.length, 3);
		assert.equal(result.relations.length, 2);
		assert.equal(result.assets[0]!.title, "Payment Domain");
		assert.equal(result.assets[1]!.title, "Checkout");
		assert.equal(result.assets[2]!.title, "Happy Path");
		assert.equal(result.relations[0]!.type, "contains");
		assert.equal(result.relations[1]!.type, "contains");
	});
});

test("getHierarchyRoots returns paginated roots with childCount", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
		const tree = {
			kind: "scenario-domain",
			title: "Domain A",
			content: { nodeId: "da", title: "Domain A" },
			children: [{ kind: "scenario", title: "S1", content: { nodeId: "s1", title: "S1" } }],
		};
		runtime.createHierarchySubtree(ws, tree, null);
		const result = runtime.getHierarchyRoots(ws, "scenario-domain", { page: 1, pageSize: 10 });
		assert.equal(result.total, 1);
		assert.equal(result.roots.length, 1);
		assert.equal(result.roots[0]!.title, "Domain A");
		assert.equal(result.roots[0]!.childCount, 1);
	});
});

test("getHierarchyChildren returns children sorted by position", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
		const tree = {
			kind: "scenario-domain",
			title: "Domain",
			content: { nodeId: "d1", title: "Domain" },
			children: [
				{ kind: "scenario", title: "B", content: { nodeId: "s1", title: "B" } },
				{ kind: "scenario", title: "A", content: { nodeId: "s2", title: "A" } },
			],
		};
		const result = runtime.createHierarchySubtree(ws, tree, null);
		const children = runtime.getHierarchyChildren(result.assets[0]!.assetId);
		assert.equal(children.length, 2);
		assert.equal(children[0]!.title, "B");
		assert.equal(children[1]!.title, "A");
		assert.equal(children[0]!.position, 0);
	});
});

test("moveSubtree moves a node to a new parent", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
		const tree1 = {
			kind: "scenario-domain",
			title: "Domain1",
			content: { nodeId: "d1", title: "Domain1" },
			children: [{ kind: "scenario", title: "S1", content: { nodeId: "s1", title: "S1" } }],
		};
		const tree2 = {
			kind: "scenario-domain",
			title: "Domain2",
			content: { nodeId: "d2", title: "Domain2" },
		};
		const r1 = runtime.createHierarchySubtree(ws, tree1, null);
		const r2 = runtime.createHierarchySubtree(ws, tree2, null);
		runtime.moveHierarchySubtree(ws, r1.assets[1]!.assetId, r1.assets[1]!.revisionId, r2.assets[0]!.assetId);
		const children = runtime.getHierarchyChildren(r2.assets[0]!.assetId);
		assert.equal(children.length, 1);
		assert.equal(children[0]!.title, "S1");
		const oldChildren = runtime.getHierarchyChildren(r1.assets[0]!.assetId);
		assert.equal(oldChildren.length, 0);
	});
});

test("moveSubtree rejects cycle", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
		const tree = {
			kind: "scenario-domain",
			title: "D",
			content: { nodeId: "d", title: "D" },
			children: [{ kind: "scenario", title: "S", content: { nodeId: "s", title: "S" } }],
		};
		const result = runtime.createHierarchySubtree(ws, tree, null);
		assert.throws(
			() => runtime.moveHierarchySubtree(ws, result.assets[0]!.assetId, result.assets[0]!.revisionId, result.assets[1]!.assetId),
		(error: unknown) => error instanceof Error && (error.message.includes("Asset relation") || error.message.includes("cycle")),
		);
	});
});

test("deleteSubtree cascades children and returns affected list", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
		const tree = {
			kind: "scenario-domain",
			title: "D",
			content: { nodeId: "d", title: "D" },
			children: [{ kind: "scenario", title: "S", content: { nodeId: "s", title: "S" } }],
		};
		const result = runtime.createHierarchySubtree(ws, tree, null);
		const affected = runtime.deleteSubtree(result.assets[0]!.assetId);
		assert.equal(affected.length, 2);
		assert.equal(affected[0]!.title, "D");
		assert.equal(affected[1]!.title, "S");
		assert.equal(runtime.hasChildren(result.assets[0]!.assetId), false);
	});
});

test("previewSubtreeDeletion returns affected without deleting", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
		const tree = {
			kind: "scenario-domain",
			title: "D",
			content: { nodeId: "d", title: "D" },
			children: [{ kind: "scenario", title: "S", content: { nodeId: "s", title: "S" } }],
		};
		const result = runtime.createHierarchySubtree(ws, tree, null);
		const affected = runtime.previewSubtreeDeletion(result.assets[0]!.assetId);
		assert.equal(affected.length, 2);
		assert.equal(runtime.hasChildren(result.assets[0]!.assetId), true);
	});
});

test("hasChildren returns false for leaf node", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
		const tree = {
			kind: "scenario-domain",
			title: "D",
			content: { nodeId: "d", title: "D" },
		};
		const result = runtime.createHierarchySubtree(ws, tree, null);
		assert.equal(runtime.hasChildren(result.assets[0]!.assetId), false);
	});
});

test("searchHierarchyNodes returns matchedPath", async () => {
	await withRuntime(async ({ runtime }) => {
		const ws = runtime.createWorkspace({ repoPath: "/r", name: "r" });
		const tree = {
			kind: "scenario-domain",
			title: "Payment",
			content: { nodeId: "pd", title: "Payment" },
			children: [{
				kind: "scenario",
				title: "Checkout",
				content: { nodeId: "co", title: "Checkout" },
				children: [{
					kind: "scenario-variant",
					title: "Happy",
					content: { nodeId: "hp", title: "Happy", actors: ["Customer"], preconditions: [], trigger: "Cart", mainFlow: ["Pay"], alternateFlows: [], expectedOutcome: "Done" },
				}],
			}],
		};
		runtime.createHierarchySubtree(ws, tree, null);
		const hits = runtime.searchHierarchyNodes(ws, "Happy");
		assert.ok(hits.length >= 1);
		const hit = hits.find((h) => h.title === "Happy");
		assert.ok(hit, "should find Happy variant");
		assert.ok(hit!.matchedPath.length >= 1);
	});
});
