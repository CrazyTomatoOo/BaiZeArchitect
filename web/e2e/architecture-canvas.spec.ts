import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

type Layer = "context" | "container" | "component" | "code";

const roots: Record<Layer, string[]> = {
	context: ["context:system"],
	container: ["context:system"],
	component: ["container:web"],
	code: ["component:browser"],
};

const snapshot = (id: string, headSha: string) => ({
	id,
	repositoryId: "fixture-repo",
	headSha,
	projectionVersion: "v1",
	contentHash: `${id}-hash`,
	roots,
});

const visibleGraph = (layer: Layer, snapshotId = "c4-fixture", headSha = "0123456789abcdef") => {
	const nodesByLayer = {
		context: [
			{ id: "context:system", kind: "context", name: "Fixture System", description: "A deterministic C4 test system.", evidence: ["fixture/system"] },
			{ id: "context:external", kind: "context", name: "External Provider", description: "An evidence-backed external dependency.", evidence: ["fixture/external"] },
		],
		container: [
			{ id: "container:web", kind: "container", name: "Web UI", description: "The Lit architecture explorer.", evidence: ["web/src"] },
			{ id: "container:gateway", kind: "container", name: "Gateway", description: "The projection HTTP API.", evidence: ["agent-runtime"] },
		],
		component: [{ id: "component:browser", kind: "component", name: "Architecture Browser", description: "Coordinates visible graph state.", evidence: ["web/src/baize-architecture-browser.ts"] }],
		code: [{ id: "code:canvas", kind: "code", name: "C4 Canvas", description: "Renders the evidence graph.", evidence: ["web/src/baize-c4-canvas.ts"] }],
	} as const;
	const nodes = nodesByLayer[layer];
	const source = nodes[0];
	const target = nodes[1];
	return {
		snapshotId,
		repositoryId: "fixture-repo",
		headSha,
		layer,
		visibleGraphHash: `${snapshotId}-${layer}`,
		cap: { maxNodes: 500, atomicNodeCount: nodes.length, applied: false },
		nodes,
		edges: source && target ? [{ id: `${layer}:edge`, source: source.id, target: target.id, kind: "dependsOn", confidence: 1, evidence: ["fixture/edge"] }] : [],
	};
};

async function fulfillJson(route: Route, value: unknown): Promise<void> {
	await route.fulfill({ contentType: "application/json", body: JSON.stringify(value) });
}

async function fixtureApi(page: Page, options: { empty?: boolean; failingSnapshot?: boolean } = {}): Promise<void> {
	let resolveCount = 0;
	await page.route("**/api/**", async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname.endsWith("/tree")) return fulfillJson(route, { tree: [{ name: "web", path: "web", kind: "directory", children: [{ name: "src", path: "web/src", kind: "directory" }] }] });
		if (url.pathname.endsWith("/snapshots/resolve")) {
			if (options.failingSnapshot) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Fixture snapshot failure" }) });
			resolveCount += 1;
			return fulfillJson(route, snapshot(resolveCount === 1 ? "c4-fixture" : "c4-latest", resolveCount === 1 ? "0123456789abcdef" : "fedcba9876543210"));
		}
		const snapshotMatch = url.pathname.match(/\/snapshots\/([^/]+)$/);
		if (snapshotMatch) return fulfillJson(route, snapshot(snapshotMatch[1], snapshotMatch[1] === "c4-latest" ? "fedcba9876543210" : "0123456789abcdef"));
		const visibleMatch = url.pathname.match(/\/snapshots\/([^/]+)\/visible$/);
		if (visibleMatch) {
			const layer = (url.searchParams.get("layer") ?? "context") as Layer;
			const graph = visibleGraph(layer, visibleMatch[1], visibleMatch[1] === "c4-latest" ? "fedcba9876543210" : "0123456789abcdef");
			return fulfillJson(route, options.empty ? { ...graph, nodes: [], edges: [] } : graph);
		}
		throw new Error(`Unexpected architecture API request: ${route.request().method()} ${url.pathname}`);
	});
}

async function openFixture(page: Page, options: { empty?: boolean } = {}): Promise<void> {
	await fixtureApi(page, options);
	await page.goto("/e2e/architecture-canvas.html");
	await expect(page.getByRole("heading", { name: "架构浏览" })).toBeVisible();
	await expect(page.locator("baize-c4-canvas")).toBeVisible();
	if (!options.empty) await expect(page.locator("baize-c4-canvas").locator(".node").filter({ hasText: "Fixture System" })).toBeVisible();
}

test.describe("interactive architecture canvas", () => {
	test("explores a snapshot, drills down, filters, focuses, and exports SVG", async ({ page }) => {
		await openFixture(page);
		const canvas = page.locator("baize-c4-canvas");
		await canvas.locator(".node").filter({ hasText: "Fixture System" }).click();
		await expect(canvas.getByRole("heading", { name: "Fixture System" })).toBeVisible();
		await expect(canvas.locator("[aria-live=polite]")).toContainText("Fixture System selected.");
		await canvas.getByRole("button", { name: "View internal" }).click();
		await expect(canvas.locator(".node").filter({ hasText: "Web UI" })).toBeVisible();
		await canvas.locator(".node").filter({ hasText: "Web UI" }).click();
		await page.getByRole("button", { name: "聚焦邻居" }).click();
		await expect(page).toHaveURL(/c4Focus=container%3Aweb/);
		await page.getByLabel("Search architecture nodes").fill("web");
		await page.getByRole("button", { name: "筛选" }).click();
		await expect(page).toHaveURL(/c4Query=web/);
		await expect(canvas.getByRole("button", { name: "Export SVG" })).toBeEnabled({ timeout: 15_000 });
		const download = page.waitForEvent("download");
		await canvas.getByRole("button", { name: "Export SVG" }).click();
		expect((await download).suggestedFilename()).toMatch(/^fixture-repo-01234567-container-context_system-.*\.svg$/);
		const pngDownload = page.waitForEvent("download");
		await canvas.getByRole("button", { name: "Export PNG" }).click();
		expect((await pngDownload).suggestedFilename()).toMatch(/^fixture-repo-01234567-container-context_system-.*\.png$/);
	});

	test("announces a semantic graph alternative and updates the immutable snapshot", async ({ page }) => {
		await openFixture(page);
		const canvas = page.locator("baize-c4-canvas");
		await expect(canvas.getByRole("list", { name: "Architecture nodes" })).toBeVisible();
		await expect(canvas.locator("[aria-live=polite]")).toContainText("nodes and");
		const firstNode = canvas.locator(".node").filter({ hasText: "Fixture System" });
		await firstNode.focus();
		await firstNode.press("ArrowDown");
		await expect(canvas.getByRole("heading", { name: "External Provider" })).toBeVisible();
		await page.getByRole("button", { name: "更新到最新提交" }).click();
		await expect(page.locator(".snapshot")).toContainText("fedcba98");
		await expect(page).toHaveURL(/c4Snapshot=c4-latest/);
	});

	test("passes automated accessibility checks", async ({ page }) => {
		await openFixture(page);
		const results = await new AxeBuilder({ page }).analyze();
		expect(results.violations).toEqual([]);
	});

	test("communicates empty and failed snapshot states", async ({ page }) => {
		await openFixture(page, { empty: true });
		await expect(page.locator("baize-c4-canvas")).toContainText("No architecture nodes match this view.");
		await page.unroute("**/api/**");
		await fixtureApi(page, { failingSnapshot: true });
		await page.goto("/e2e/architecture-canvas.html");
		await expect(page.getByRole("alert")).toContainText("Architecture request failed (200/500)");
	});

	test("matches the selected explorer visual baseline", async ({ page }) => {
		await openFixture(page);
		const canvas = page.locator("baize-c4-canvas");
		await canvas.locator(".node").filter({ hasText: "Fixture System" }).click();
		await expect(canvas.getByRole("heading", { name: "Fixture System" })).toBeVisible();
		await expect(page).toHaveScreenshot("architecture-canvas-selected.png", { fullPage: true, animations: "disabled", maxDiffPixels: 1_000 });
	});
});
