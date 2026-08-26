import { expect, test, type Page, type Route } from "@playwright/test";

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

const assetsByKind = {
	design: [{ id: 1, workspaceId: 1, kind: "design", title: "核心设计", currentRevision: { id: 11, revisionNo: 1, digest: digest("a") }, legacyOriginRequirementId: null, createdAt: "2026-08-26T10:00:00.000Z" }],
	architecture: [{ id: 2, workspaceId: 1, kind: "architecture", title: "核心架构", currentRevision: { id: 12, revisionNo: 1, digest: digest("b") }, legacyOriginRequirementId: null, createdAt: "2026-08-26T10:00:00.000Z" }],
	data: [],
	api: [],
	scenario: [],
	usecase: [],
	function: [],
	stakeholder: [],
} as const;

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
				: { schemaVersion: "artifact/architecture/v1", artifactKind: "architecture", summary: "架构摘要", components: [] },
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
		const kind = (url.searchParams.get("kind") ?? "design") as keyof typeof assetsByKind;
		const assets = assetsByKind[kind] ?? [];
		return fulfillJson(route, { assets, total: assets.length, page: Number(url.searchParams.get("page") ?? "1"), pageSize: Number(url.searchParams.get("pageSize") ?? "12"), kindCounts: { design: 1, architecture: 1, data: 0, api: 0, scenario: 0, usecase: 0, function: 0, stakeholder: 0 } });
	});
}

test("asset workbench exposes typed tabs, detail relations, forms, and graph navigation", async ({ page }) => {
	await installAssetMocks(page);
	await page.goto("/assets");
	await expect(page.getByRole("heading", { name: "设计模型资产" })).toBeVisible();
	await expect(page.getByRole("button", { name: /设计\s*1/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /关系图/ })).toBeVisible();
	await expect(page.getByRole("button", { name: /核心设计/ })).toBeVisible();
	await expect(page.getByRole("heading", { name: "核心设计" })).toBeVisible();
	await expect(page.getByRole("button", { name: /核心架构/ })).toBeVisible();
	await page.getByRole("button", { name: "删除" }).click();
	await expect(page.getByText("确认删除？资产及其历史 revision 将无法恢复。")).toBeVisible();
	await page.getByRole("button", { name: "确认删除" }).click();
	await expect(page.getByText(/仍被以下 1 个资产引用/)).toBeVisible();

	await page.getByRole("button", { name: /关系图/ }).click();
	await expect(page.getByRole("img", { name: "Workspace 资产关系图" })).toBeVisible();
	await expect(page.locator("button.graph-node")).toHaveCount(2);
	await page.locator("button.graph-node").nth(1).click();
	await expect(page.getByRole("heading", { name: "核心架构" })).toBeVisible();
	await page.getByRole("button", { name: "编辑" }).click();
	await expect(page.getByRole("heading", { name: "编辑架构资产" })).toBeVisible();
	await page.getByRole("button", { name: "取消" }).click();
	await expect(page).toHaveURL(/kind=architecture/);
	await expect(page).toHaveURL(/selectedAssetId=2/);

	await page.getByRole("button", { name: /新建架构/ }).click();
	await expect(page.getByRole("heading", { name: "新建架构资产" })).toBeVisible();
	await expect(page.getByLabel("摘要")).toBeVisible();
	await page.locator("input.file-input").setInputFiles({
		name: "asset-bundle.json",
		mimeType: "application/json",
		buffer: Buffer.from(JSON.stringify({ assets: [{ kind: "architecture", title: "Imported", content: {} }], relations: [] })),
	});
	await expect(page.getByRole("heading", { name: "导入预览" })).toBeVisible();
});
