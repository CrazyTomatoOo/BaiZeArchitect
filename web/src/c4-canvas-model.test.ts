import { describe, expect, it } from "vitest";

import {
	pngExportSize,
	projectionToElk,
	visibleGraphToSvgDocument,
	type CanvasLayout,
	type VisibleGraph,
} from "./c4-canvas-model";

const graph: VisibleGraph = {
	snapshotId: "c4-demo",
	repositoryId: "demo",
	headSha: "a1b2c3d4",
	layer: "container",
	visibleGraphHash: "graph-hash",
	cap: { maxNodes: 500, atomicNodeCount: 2, applied: false },
	nodes: [
		{ id: "container:web", kind: "container", name: "Web", description: "Lit UI", evidence: ["web/package.json"] },
		{ id: "container:api", kind: "container", name: "API", description: "Gateway", evidence: ["agent-runtime/package.json"] },
	],
	edges: [{ id: "edge:web-api", source: "container:web", target: "container:api", kind: "dependsOn", confidence: 1, evidence: ["web/package.json"] }],
};

const layout: CanvasLayout = {
	width: 640,
	height: 360,
	nodes: new Map([
		["container:web", { x: 20, y: 80, width: 160, height: 52 }],
		["container:api", { x: 360, y: 80, width: 160, height: 52 }],
	]),
	edges: new Map([["edge:web-api", "M 180 106 L 360 106"]]),
};

describe("C4 canvas model", () => {
	it("maps the current Visible Graph into deterministic ELK input", () => {
		const elk = projectionToElk(graph);
		expect(elk.layoutOptions?.["elk.algorithm"]).toBe("layered");
		expect(elk.children?.map((node) => node.id)).toEqual(["container:api", "container:web"]);
		expect(elk.edges).toEqual([{ id: "edge:web-api", sources: ["container:web"], targets: ["container:api"] }]);
	});

	it("creates a standalone provenance-bearing SVG from the full Visible Graph", () => {
		const svg = visibleGraphToSvgDocument(graph, layout, { filters: ["kind: container"], focused: false, generatedAt: "2026-08-09T00:00:00.000Z" });
		expect(svg).toContain("demo · a1b2c3d4 · Container");
		expect(svg).toContain("kind: container");
		expect(svg).toContain("<path");
		expect(svg).not.toMatch(/(?:href|src)=["']https?:/);
	});

	it("refuses 2× PNG dimensions above the 8192px limit", () => {
		expect(pngExportSize({ width: 4096, height: 200 })).toEqual({ width: 8192, height: 400 });
		expect(pngExportSize({ width: 4097, height: 200 })).toBeNull();
	});
});
