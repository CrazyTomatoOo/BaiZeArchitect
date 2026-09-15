import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * T3 主区重组 E2E —
 * 主区 = 顶部工具条(导入/关系图) + 居中 880px 内容栏;新建入口已统一迁至侧栏头部 lib-head。
 * 删除 list-pane(条目已在侧栏);未选中资产时显示空态提示。
 */

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

const fullKindCounts = {
	"scenario-domain": 0, "scenario": 0, "scenario-variant": 0,
	"function-domain": 0, "function-item": 0, "function-point": 0,
	"usecase": 0, "design": 1, "architecture": 1, "data": 0, "api": 0, "stakeholder": 0,
} as const;

function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
	return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

async function installMocks(page: Page): Promise<void> {
	await page.addInitScript(() => localStorage.setItem("baize.workspaceId", "1"));
	await page.route("**/api/session", async (route) => {
		if (route.request().method() === "POST") return fulfillJson(route, { actorRef: "operator", capabilities: ["workflow:operate"] }, 201);
		return fulfillJson(route, { actorRef: "operator", capabilities: ["workflow:operate"] });
	});
	await page.route("**/api/workspaces", (route) =>
		fulfillJson(route, { workspaces: [{ id: 1, name: "Demo", repoPath: "/repo", createdAt: "2026-08-26T10:00:00.000Z" }] }),
	);
	await page.route("**/api/assets/graph*", (route) => fulfillJson(route, { nodes: [], edges: [] }));
	await page.route("**/api/assets/hierarchy*", (route) =>
		fulfillJson(route, { roots: [], total: 0, page: 1, pageSize: 12, kindCounts: fullKindCounts }),
	);
	await page.route("**/api/assets/*", async (route) => {
		const match = /\/api\/assets\/(\d+)$/.exec(new URL(route.request().url()).pathname);
		if (route.request().method() === "GET" && match) {
			const id = Number(match[1]);
			return fulfillJson(route, {
				id,
				workspaceId: 1,
				kind: "design",
				title: "核心设计",
				currentRevisionId: 11,
				legacyOriginRequirementId: null,
				originRequirementId: null,
				originArtifactId: null,
				originApprovalId: null,
				createdAt: "2026-08-26T10:00:00.000Z",
				resolvedGraph: { incoming: [], outgoing: [] },
				revisions: [{
					id: 11,
					revisionNo: 1,
					contentDocumentId: 21,
					digest: digest("a"),
					source: "workflow",
					content: { schemaVersion: "artifact/design/v1", artifactKind: "design", summary: "设计摘要", changeUnits: [] },
					createdAt: "2026-08-26T10:00:00.000Z",
				}],
			});
		}
		return route.fallback();
	});
	await page.route("**/api/assets?*", (route) => {
		const url = new URL(route.request().url());
		const kind = url.searchParams.get("kind") ?? "design";
		const assets = [{
			id: 1,
			workspaceId: 1,
			kind,
			title: "核心设计",
			currentRevision: { id: 11, revisionNo: 1, digest: digest("a"), source: "workflow" },
			legacyOriginRequirementId: null,
			createdAt: "2026-08-26T10:00:00.000Z",
		}];
		return fulfillJson(route, {
			assets,
			total: assets.length,
			page: 1,
			pageSize: 12,
			kindCounts: fullKindCounts,
		});
	});
}

async function openDrawerIfNarrow(page: Page): Promise<void> {
	const menu = page.getByRole("button", { name: "打开工作台导航" });
	if (await menu.isVisible()) await menu.click();
}

test.describe("T3 主区重组", () => {
	test("主区无列表 pane,居中 880px 内容栏", async ({ page }) => {
		await installMocks(page);
		await page.goto("/assets/design");

		// 主区不再有列表 pane(条目已在侧栏)
		await expect(page.locator("baize-asset-library .list-pane")).toHaveCount(0);
		// 主区有工具条和居中内容栏
		await expect(page.locator("baize-asset-library .mtoolbar")).toBeVisible();
		await expect(page.locator("baize-asset-library .mcol")).toBeVisible();
		// 未选中资产:空态提示
		await expect(page.locator("baize-asset-library .empty-hint")).toBeVisible();
	});

	test("/assets/:tab?asset=<id> 直达详情", async ({ page }) => {
		await installMocks(page);
		await page.goto("/assets/design?asset=1");

		// 主区显示资产详情(无列表 pane)
		await expect(page.locator("baize-asset-library .list-pane")).toHaveCount(0);
		await expect(page.locator("baize-asset-library baize-asset-detail")).toBeVisible();
		await expect(page.getByRole("heading", { name: "核心设计" })).toBeVisible();
	});

	test("新建/编辑/导入/关系图均可进出", async ({ page }) => {
		await installMocks(page);
		await page.goto("/assets/design");

		// 新建按钮(侧栏头部;narrow 视口先开抽屉)
		await openDrawerIfNarrow(page);
		await page.locator("baize-side-bar .lib-head button.primary").click();
		await expect(page.locator("baize-asset-library baize-asset-form")).toBeVisible();
		await page.getByRole("button", { name: "取消" }).click();

		// 导入按钮
		await page.getByRole("button", { name: /导入/ }).click();
		await expect(page.locator("baize-asset-library baize-asset-import")).toBeVisible();

		// 关系图按钮
		await page.getByRole("button", { name: /关系图/ }).click();
		await expect(page).toHaveURL(/\/assets\/graph/);
		await expect(page.locator("baize-asset-library baize-asset-graph")).toBeVisible();
	});

	test("关系图占主区全幅(不受 880px 约束)", async ({ page }) => {
		await installMocks(page);
		await page.goto("/assets/graph");

		// 关系图模式:无居中内容栏,主区全幅
		await expect(page.locator("baize-asset-library .mcol")).toHaveCount(0);
		await expect(page.locator("baize-asset-library baize-asset-graph")).toBeVisible();
	});
});
