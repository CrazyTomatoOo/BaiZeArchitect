import type { Page, Route } from "@playwright/test";

type Layer = "context" | "container" | "component" | "code";

const roots: Record<Layer, string[]> = {
	context: ["context:system"],
	container: ["context:system"],
	component: ["container:web"],
	code: ["component:browser"],
};

function snapshot() {
	return {
		id: "c4-benchmark",
		repositoryId: "fixture-repo",
		headSha: "0123456789abcdef",
		projectionVersion: "v1",
		contentHash: "c4-benchmark-hash",
		roots,
	};
}

function visibleGraph(query: string | null) {
	const allNodes = Array.from({ length: 500 }, (_, index) => ({
		id: index === 0 ? "context:system" : `context:fixture-${index}`,
		kind: "context" as const,
		name: index === 0 ? "Fixture System" : `Fixture node ${index}`,
		description: "A deterministic 500-node C4 benchmark fixture.",
		evidence: ["fixture/benchmark"],
	}));
	const normalizedQuery = query?.trim().toLowerCase() ?? "";
	const nodes = normalizedQuery ? allNodes.filter((node) => node.name.toLowerCase().includes(normalizedQuery)) : allNodes;
	const nodeIds = new Set(nodes.map((node) => node.id));
	const edges = allNodes.slice(1).flatMap((node, index) => {
		const source = allNodes[index];
		return source && nodeIds.has(source.id) && nodeIds.has(node.id)
			? [{ id: `benchmark-edge-${index}`, source: source.id, target: node.id, kind: "dependsOn", confidence: 1, evidence: ["fixture/benchmark-edge"] }]
			: [];
	});
	return {
		snapshotId: "c4-benchmark",
		repositoryId: "fixture-repo",
		headSha: "0123456789abcdef",
		layer: "context" as const,
		visibleGraphHash: `c4-benchmark-${normalizedQuery || "all"}`,
		cap: { maxNodes: 500, atomicNodeCount: 500, applied: false },
		nodes,
		edges,
	};
}

async function fulfillJson(route: Route, value: unknown): Promise<void> {
	await route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
}

export async function benchmarkFixtureApi(page: Page): Promise<void> {
	await page.route("**/api/**", async (route) => {
		let url: URL;
		try {
			url = new URL(route.request().url());
		} catch {
			await route.abort();
			return;
		}
		if (url.pathname.endsWith("/tree")) return fulfillJson(route, { tree: [{ name: "web", path: "web", kind: "directory", children: [] }] });
		if (url.pathname.endsWith("/snapshots/resolve")) return fulfillJson(route, snapshot());
		if (/\/snapshots\/c4-benchmark$/.test(url.pathname)) return fulfillJson(route, snapshot());
		if (/\/snapshots\/c4-benchmark\/visible$/.test(url.pathname)) return fulfillJson(route, visibleGraph(url.searchParams.get("query")));
		throw new Error(`Unexpected architecture API request: ${route.request().method()} ${url.pathname}`);
	});
}
