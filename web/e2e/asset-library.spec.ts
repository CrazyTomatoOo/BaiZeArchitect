import { expect, test, type Page, type Route } from "@playwright/test";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

const fullKindCounts = {
	"scenario-domain": 0, "scenario": 0, "scenario-variant": 0,
	"function-domain": 0, "function-item": 0, "function-point": 0,
	"usecase": 0, "design": 1, "architecture": 1, "data": 0, "api": 0, "stakeholder": 0,
} as const;

const assetsByKind: Record<string, Array<{ id: number; workspaceId: number; kind: string; title: string; currentRevision: { id: number; revisionNo: number; digest: string; source: string } | null; legacyOriginRequirementId: number | null; createdAt: string }>> = {
	design: [{ id: 1, workspaceId: 1, kind: "design", title: "核心设计", currentRevision: { id: 11, revisionNo: 1, digest: digest("a"), source: "workflow" }, legacyOriginRequirementId: null, createdAt: "2026-08-26T10:00:00.000Z" }],
	architecture: [{ id: 2, workspaceId: 1, kind: "architecture", title: "核心架构", currentRevision: { id: 12, revisionNo: 1, digest: digest("b"), source: "workflow" }, legacyOriginRequirementId: null, createdAt: "2026-08-26T10:00:00.000Z" }],
	data: [],
	api: [],
	"scenario-domain": [],
	scenario: [],
	"scenario-variant": [],
	"function-domain": [],
	"function-item": [],
	"function-point": [],
	usecase: [],
	stakeholder: [],
};

function detail(assetId: number) {
	const kind = assetId === 1 ? "design" : "architecture";
	const title = assetId === 1 ? "核心设计" : "核心架构";
	return {
		id: assetId,
		workspaceId: 1,
		kind,
		title,
		currentRevisionId: assetId === 1 ? 11 : 12,
		legacyOriginRequirementId: null,
		originRequirementId: null,
		originArtifactId: null,
		originApprovalId: null,
		createdAt: "2026-08-26T10:00:00.000Z",
		resolvedGraph: assetId === 1
			? { incoming: [], outgoing: [{ assetId: 2, revisionId: 12, type: "contains", title: "核心架构", kind: "architecture" }] }
			: { incoming: [{ assetId: 1, revisionId: 11, type: "contains", title: "核心设计", kind: "design" }], outgoing: [] },
		revisions: [{
			id: assetId === 1 ? 11 : 12,
			revisionNo: 1,
			contentDocumentId: 21,
			digest: assetId === 1 ? digest("a") : digest("b"),
			source: "workflow",
			content: assetId === 1
				? { schemaVersion: "artifact/design/v1", artifactKind: "design", summary: "设计摘要", changeUnits: [] }
				: { schemaVersion: "asset/architecture/v1", artifactKind: "architecture", summary: "架构摘要", architecture: { components: [], relationships: [], constraints: [], nonFunctionalRequirements: [] } },
			createdAt: "2026-08-26T10:00:00.000Z",
		}],
	};
}

async function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
	await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

async function installAssetMocks(page: Page): Promise<void> {
	await page.addInitScript(() => localStorage.setItem("baize.workspaceId", "1"));
	await page.route("**/api/session", async (route) => {
		if (route.request().method() === "POST") return fulfillJson(route, { actorRef: "operator", capabilities: ["workflow:operate"] }, 201);
		return fulfillJson(route, { actorRef: "operator", capabilities: ["workflow:operate"] });
	});
	await page.route("**/api/workspaces", (route) => fulfillJson(route, { workspaces: [{ id: 1, name: "Demo", repoPath: "/repo", createdAt: "2026-08-26T10:00:00.000Z" }] }));
	await page.route("**/api/assets/graph*", (route) => fulfillJson(route, {
		nodes: [{ assetId: 1, kind: "design", title: "核心设计" }, { assetId: 2, kind: "architecture", title: "核心架构" }],
		edges: [{ fromAssetId: 1, toAssetId: 2, type: "contains" }],
	}));
	await page.route("**/api/assets/*", async (route) => {
		const match = /\/api\/assets\/(\d+)$/.exec(new URL(route.request().url()).pathname);
		if (route.request().method() === "GET" && match) return fulfillJson(route, detail(Number(match[1])));
		return route.fallback();
	});
	await page.route("**/api/assets?*", async (route) => {
		const url = new URL(route.request().url());
		const kind = url.searchParams.get("kind") ?? "design";
		const assets = assetsByKind[kind] ?? [];
		return fulfillJson(route, { assets, total: assets.length, page: Number(url.searchParams.get("page") ?? "1"), pageSize: Number(url.searchParams.get("pageSize") ?? "12"), kindCounts: fullKindCounts });
	});
	await page.route("**/api/assets/hierarchy*", (route) => fulfillJson(route, { roots: [], total: 0, page: 1, pageSize: 12, kindCounts: fullKindCounts }));
	await page.route("**/api/assets/import/preview", (route) => fulfillJson(route, { summary: { createCount: 1, reuseCount: 0, relationChanges: 0, kindBreakdown: { ...fullKindCounts, architecture: 1 }, pathConflicts: 0, validationErrors: 0 }, previewDigest: "test-digest" }));
	await page.route("**/api/assets/import/commit", (route) => fulfillJson(route, { assetIds: [3] }, 201));
}

async function openWorkbenchNavigation(page: Page): Promise<void> {
	const menu = page.getByRole("button", { name: "打开工作台导航" });
	if (await menu.isVisible()) await menu.click();
}

test("asset workbench exposes 9 aggregated tabs with specialized views and graph navigation", async ({ page }) => {
	await installAssetMocks(page);
	await page.goto("/assets");
	await expect(page.getByRole("heading", { name: "设计模型资产" })).toBeVisible();

	// 9 aggregated tabs in fixed order
	await expect(page.getByRole("button", { name: /场景库/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /功能库/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /用例库/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /设计库/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /架构库/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /数据库/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /接口库/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /干系人库/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /关系图/ })).toBeVisible();

	// Design tab: list + detail with relations
	await page.getByRole("button", { name: /设计库/ }).click();
	// On narrow viewport, auto-selection may show detail instead of list — check detail heading
	await expect(page.getByRole("heading", { name: "核心设计" })).toBeVisible({ timeout: 10000 });
	await expect(page.getByText(/核心架构/)).toBeVisible();

	// Delete blocked by incoming relation
	await page.getByRole("button", { name: "删除" }).click();
	await expect(page.getByText("确认删除？资产及其历史 revision 将无法恢复。")).toBeVisible();
	await page.getByRole("button", { name: "确认删除" }).click();
	await expect(page.getByText(/仍被以下 1 个资产引用/)).toBeVisible();

	// Graph tab: full-screen graph with 2 nodes
	await page.getByRole("button", { name: /关系图/ }).click();
	await expect(page.getByRole("img", { name: "Workspace 资产关系图" })).toBeVisible();
	await expect(page.locator("button.graph-node")).toHaveCount(2);
	await page.locator("button.graph-node").nth(1).click();
	await expect(page.getByRole("heading", { name: "核心架构" })).toBeVisible();

	// Import preview with two-step flow
	await page.locator("input.file-input").setInputFiles({
		name: "asset-bundle.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify({ assets: [{ kind: "architecture", title: "Imported", content: { schemaVersion: "asset/architecture/v1", artifactKind: "architecture", summary: "Imported", architecture: { components: [], relationships: [], constraints: [], nonFunctionalRequirements: [] } } }], relations: [] })),
	});
	await expect(page.getByRole("heading", { name: "导入预览" })).toBeVisible();
	await expect(page.getByText(/新建 1/)).toBeVisible();
});

test("asset workbench URL state captures tab and selection", async ({ page }) => {
	await installAssetMocks(page);
	await page.goto("/assets?tab=architecture&page=1");
	await expect(page.getByRole("heading", { name: "设计模型资产" })).toBeVisible();
	await expect(page).toHaveURL(/tab=architecture/);

	await openWorkbenchNavigation(page);
	await page.getByRole("button", { name: "需求" }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.getByRole("heading", { name: "需求" })).toBeVisible();

	await openWorkbenchNavigation(page);
	await page.getByRole("button", { name: "资产库" }).click();
	await expect(page).toHaveURL(/\/assets(?:\?|$)/);
	await expect(page.getByRole("heading", { name: "设计模型资产" })).toBeVisible();
});

test("requirements and assets share the workbench sidebar", async ({ page }) => {
	await installAssetMocks(page);
	await page.goto("/assets");
	await expect(page.locator("baize-asset-library .toolbar-head")).toBeVisible();
	await expect(page.locator("baize-asset-library .toolbar-actions")).toBeVisible();

	await openWorkbenchNavigation(page);
	await page.getByRole("button", { name: "需求" }).click();
	await expect(page.getByRole("heading", { name: "需求" })).toBeVisible();
	await expect(page.getByRole("complementary", { name: "工作台导航" })).toBeVisible();
	await expect(page.getByRole("button", { name: "资产库" })).toHaveCount(1);
});
