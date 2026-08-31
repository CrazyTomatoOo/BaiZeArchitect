import { expect, test, type Page, type Route } from "@playwright/test";
import { modelConfigFixture, widthAlignmentProjection } from "./model-config-fixture";

/**
 * 工作台侧栏布局回归 —
 * 图一:需求 sub-view 是 240px 侧栏内的紧凑导航(无 page-head/旅程条);
 * 图二:资产类型导航全应用唯一(只在侧栏),库内不再重复 tabs。
 */

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

const fullKindCounts = {
	"scenario-domain": 0, "scenario": 0, "scenario-variant": 0,
	"function-domain": 0, "function-item": 0, "function-point": 0,
	"usecase": 0, "design": 1, "architecture": 0, "data": 0, "api": 0, "stakeholder": 0,
} as const;

function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
	return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

export async function installMocks(page: Page): Promise<void> {
	await page.addInitScript(() => localStorage.setItem("baize.workspaceId", "1"));
	await page.route("**/api/session", async (route) => {
		if (route.request().method() === "POST") return fulfillJson(route, { actorRef: "operator", capabilities: ["workflow:operate"] }, 201);
		return fulfillJson(route, { actorRef: "operator", capabilities: ["workflow:operate"] });
	});
	await page.route("**/api/workspaces", (route) =>
		fulfillJson(route, { workspaces: [{ id: 1, name: "Demo", repoPath: "/repo", createdAt: "2026-08-26T10:00:00.000Z" }] }),
	);
	await page.route("**/api/model-config", (route) => fulfillJson(route, modelConfigFixture()));
	await page.route("**/api/requirements?workspaceId=1", (route) =>
		fulfillJson(route, {
			requirements: [
				{ requirementId: 1, title: "宽度对齐示例", requirementVersion: 1, workflow: { id: 7, state: "running", version: 1, lastEventSeq: 1 } },
			],
		}),
	);
	await page.route("**/api/workflows/7", (route) => fulfillJson(route, widthAlignmentProjection()));
	await page.route("**/api/assets/graph*", (route) => fulfillJson(route, { nodes: [], edges: [] }));
	await page.route("**/api/assets/*", async (route) => {
		const match = /\/api\/assets\/(\d+)$/.exec(new URL(route.request().url()).pathname);
		if (route.request().method() === "GET" && match) {
			return fulfillJson(route, {
				id: Number(match[1]),
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
				revisions: [],
			});
		}
		return route.fallback();
	});
	await page.route("**/api/assets/hierarchy*", (route) =>
		fulfillJson(route, { roots: [], total: 0, page: 1, pageSize: 12, kindCounts: fullKindCounts }),
	);
	await page.route("**/api/assets?*", (route) => {
		const url = new URL(route.request().url());
		const kind = url.searchParams.get("kind") ?? "design";
		const assets =
			kind === "design"
				? [{ id: 1, workspaceId: 1, kind: "design", title: "核心设计", currentRevision: { id: 11, revisionNo: 1, digest: digest("a"), source: "workflow" }, legacyOriginRequirementId: null, createdAt: "2026-08-26T10:00:00.000Z" }]
				: [];
		return fulfillJson(route, {
			assets,
			total: assets.length,
			page: Number(url.searchParams.get("page") ?? "1"),
			pageSize: Number(url.searchParams.get("pageSize") ?? "12"),
			kindCounts: fullKindCounts,
		});
	});
}

async function openDrawerIfNarrow(page: Page): Promise<void> {
	const menu = page.getByRole("button", { name: "打开工作台导航" });
	if (await menu.isVisible()) await menu.click();
}

test.describe("工作台侧栏布局", () => {
	test("需求 sub-view:侧栏为紧凑导航,无 page-head 与旅程条", async ({ page }) => {
		await installMocks(page);
		await page.goto("/");

		// 紧凑头:栏目名 + 新建入口(同侧栏宽,一行内)
		await expect(page.getByRole("heading", { name: "需求" })).toBeVisible();
		await expect(page.getByRole("button", { name: /新建需求/ })).toBeVisible();

		// 页面级编排不得出现在 240px 侧栏:无 page-head 块、无说明副文案
		await expect(page.locator("baize-side-bar .page-head")).toHaveCount(0);
		await expect(page.getByText("每个需求都会建立一条自动设计工作流。")).toHaveCount(0);

		// 需求行紧凑:无旅程步骤条(详情在需求页),保留状态徽标
		await expect(page.locator("baize-side-bar .journey")).toHaveCount(0);
		await expect(page.locator("baize-side-bar .card.item").first()).toBeVisible();
	});

	test("资产类型导航唯一:只在侧栏,点击即切换库内容", async ({ page }) => {
		await installMocks(page);
		await page.goto("/assets?tab=scenario");

		// 库内不再渲染重复的 tabs 行
		await expect(page.locator("baize-asset-library .tabs")).toHaveCount(0);
		// 全页面「场景库」按钮唯一(侧栏导航)
		await expect(page.locator("button").filter({ hasText: "场景库" })).toHaveCount(1);

		// 侧栏导航高亮当前类型
		await openDrawerIfNarrow(page);
		await expect(page.locator("baize-side-bar .nav-item.active")).toHaveText("场景库");

		// 点击侧栏「设计库」→ URL 与库内容同步切换
		await page.locator("baize-side-bar .nav-item", { hasText: "设计库" }).click();
		await expect(page).toHaveURL(/tab=design/);
		await expect(page.locator("baize-side-bar .nav-item.active")).toHaveText("设计库");
		await expect(page.locator("baize-asset-library .count")).toContainText("设计库");
		// narrow 视口自动选中首项后换到详情页——两处任一呈现「核心设计」即可
		await expect(page.locator("baize-asset-library").getByText("核心设计").first()).toBeVisible();
	});
});
