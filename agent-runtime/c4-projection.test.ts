import assert from "node:assert/strict";
import test from "node:test";

import {
	createC4ProjectionSnapshot,
	deriveVisibleGraph,
	type C4ProjectionInput,
} from "./c4-projection";

const input: C4ProjectionInput = {
	repositoryId: "demo",
	headSha: "a1b2c3d4",
	projectionVersion: "v1",
	system: { name: "Demo", description: "A demonstration system" },
	externalDependencies: [{ name: "postgres", description: "database" }],
	containers: [
		{ id: "web", name: "Web", description: "Lit UI", technology: "TypeScript" },
		{ id: "api", name: "API", description: "Gateway", technology: "TypeScript" },
	],
	components: [
		{ id: "ui", name: "UI", description: "View layer", parentId: "web", members: ["web/src/main.ts"] },
		{ id: "routes", name: "Routes", description: "HTTP routes", parentId: "api", members: ["agent-runtime/gateway.ts"] },
	],
	code: [
		{ id: "gateway", name: "gateway.ts", description: "HTTP gateway", parentId: "routes", sourcePath: "agent-runtime/gateway.ts" },
	],
	relationships: [
		{ source: "web", target: "api", kind: "dependsOn", evidence: ["web/package.json"] },
		{ source: "api", target: "external:postgres", kind: "externalDependency", evidence: ["package.json"] },
	],
};

test("creates a stable evidence-backed snapshot and a context visible graph", () => {
	const snapshot = createC4ProjectionSnapshot(input);
	const context = deriveVisibleGraph(snapshot, { layer: "context" });

	assert.equal(snapshot.repositoryId, "demo");
	assert.equal(snapshot.headSha, "a1b2c3d4");
	assert.match(snapshot.id, /^c4-/);
	assert.equal(snapshot.nodes.every((node) => node.evidence.length > 0), true);
	assert.deepEqual(context.nodes.map((node) => node.id), ["external:postgres", "system:demo"]);
	assert.equal(context.edges.length, 1);
	assert.equal(context.edges[0]?.kind, "externalDependency");
	assert.equal(context.visibleGraphHash.length, 64);
});

test("derives bounded component graphs with semantic aggregate nodes", () => {
	const snapshot = createC4ProjectionSnapshot(input);
	const component = deriveVisibleGraph(snapshot, { layer: "component", maxNodes: 1 });

	assert.equal(component.nodes.length, 1);
	assert.equal(component.nodes[0]?.kind, "aggregate");
	assert.deepEqual(component.nodes[0]?.memberIds, ["component:routes", "component:ui"]);
	assert.equal(component.cap.applied, true);
	assert.equal(component.cap.atomicNodeCount, 2);
});

test("rejects a root outside the requested C4 layer", () => {
	const snapshot = createC4ProjectionSnapshot(input);
	assert.throws(
		() => deriveVisibleGraph(snapshot, { layer: "code", root: "external:postgres" }),
		/does not belong to code/,
	);
});
