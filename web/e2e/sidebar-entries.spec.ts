import { expect, test, type Page, type Route } from "@playwright/test";
import { modelConfigFixture } from "./model-config-fixture";

/**
 * T2 侧栏条目化 E2E —
 * 图二:侧栏直渲当前视图条目(需求卡片/资产条目/层级树),不再有 sub-tab 与 kind 导航。
 */

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

const fullKindCounts = {
	"scenario-domain": 1, "scenario": 1, "scenario-variant": 1,
	"function-domain": 1, "function-item": 1, "function-point": 1,
	"usecase": 1, "design": 1, "architecture": 1, "data": 1, "api": 1, "stakeholder": 1,
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
	await page.route("**/api/model-config", (route) => fulfillJson(route, modelConfigFixture()));
	await page.route("**/api/requirements?workspaceId=1", (route) =>
		fulfillJson(route, {
			requirements: [
				{ requirementId: 1, title: "示例需求", requirementVersion: 1, workflow: { id: 7, state: "running", version: 1, lastEventSeq: 1 } },
			],
		}),
	);
	await page.route("**/api/workflows/7", (route) => fulfillJson(route, { id: 7, state: "running", version: 1, lastEventSeq: 1 }));
	await page.route("**/api/assets/graph*", (route) => fulfillJson(route, { nodes: [], edges: [] }));
	await page.route("**/api/assets/hierarchy*", (route) => {
		const url = new URL(route.request().url());
		const root = url.searchParams.get("root") ?? "scenario-domain";
		const roots = root === "scenario-domain"
			? [{ id: 10, workspaceId: 1, kind: "scenario-domain", title: "电商履约域", childCount: 2, legacyOriginRequirementId: null, createdAt: "2026-08-26T10:00:00.000Z" }]
			: [{ id: 20, workspaceId: 1, kind: "function-domain", title: "需求治理域", childCount: 1, legacyOriginRequirementId: null, createdAt: "2026-08-26T10:00:00.000Z" }];
		return fulfillJson(route, { roots, total: roots.length, page: 1, pageSize: 12, kindCounts: fullKindCounts });
	});
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
				revisions: [],
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
			title: `${kind}条目`,
			currentRevision: { id: 11, revisionNo: 1, digest: digest("a"), source: "workflow" },
			legacyOriginRequirementId: null,
			createdAt: "2026-08-26T10:00:00.000Z",
		}];
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

test.describe("T2 侧栏条目化", () => {
	test("侧栏无 sub-tab 与 kind 导航,直渲当前视图条目", async ({ page }) => {
		await installMocks(page);
		await page.goto("/");

		// 需求视图:无 sub-tab,直渲需求列表
		await expect(page.locator("baize-side-bar .sub-tab")).toHaveCount(0);
		await expect(page.locator("baize-side-bar .nav-list")).toHaveCount(0);
		await expect(page.getByRole("heading", { name: "需求" })).toBeVisible();
		await expect(page.locator("baize-side-bar baize-requirements")).toBeVisible();

		// 切到设计库:无 kind 导航,直渲资产条目(narrow 视口先关抽屉)
		if (await page.getByRole("button", { name: "关闭导航" }).isVisible()) {
			await page.getByRole("button", { name: "关闭导航" }).click();
		}
		await page.locator("baize-activity-bar button[title=\"设计库\"]").click();
		await expect(page).toHaveURL(/\/assets\/design/);
		await openDrawerIfNarrow(page);
		await expect(page.locator("baize-side-bar .nav-list")).toHaveCount(0);
		await expect(page.locator("baize-side-bar .lib-head")).toContainText("设计库");
		await expect(page.locator("baize-side-bar baize-asset-entries")).toBeVisible();
	});

	test("资产条目选中入 URL,刷新恢复", async ({ page }) => {
		await installMocks(page);
		await page.goto("/assets/design");
		await openDrawerIfNarrow(page);

		// 点击条目 → URL 携带 asset 参数
		await page.locator("baize-asset-entries .entry-card").first().click();
		await expect(page).toHaveURL(/\/assets\/design\?asset=1/);

		// 刷新 → 选中态恢复
		await page.reload();
		await openDrawerIfNarrow(page);
		await expect(page.locator("baize-asset-entries .entry-card.selected")).toBeVisible();
	});

	test("场景库/功能库侧栏渲染层级树", async ({ page }) => {
		await installMocks(page);
		await page.goto("/assets/scenario");
		await openDrawerIfNarrow(page);

		// 场景库:层级树
		await expect(page.locator("baize-side-bar .lib-head")).toContainText("场景库");
		await expect(page.locator("baize-side-bar baize-hierarchy-tree")).toBeVisible();

		// 功能库:层级树(narrow 视口先关抽屉)
		if (await page.getByRole("button", { name: "关闭导航" }).isVisible()) {
			await page.getByRole("button", { name: "关闭导航" }).click();
		}
		await page.locator("baize-activity-bar button[title=\"功能库\"]").click();
		await expect(page).toHaveURL(/\/assets\/function/);
		await openDrawerIfNarrow(page);
		await expect(page.locator("baize-side-bar baize-hierarchy-tree")).toBeVisible();
	});
});
