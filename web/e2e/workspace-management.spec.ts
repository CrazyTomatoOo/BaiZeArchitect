import { expect, test, type Page, type Route } from "@playwright/test";

import { installMockEventSource } from "./mock-event-source";

/**
 * 工作区管理 e2e(票 06)— route-level 全 mock,验证:
 * 登录→管理页(列表/创建/零态/删除两步确认/409 busy)/进入→需求列表→详情→返回;
 * localStorage 记住最近与失效回落;删当前工作区清键;匿名负向;三视口全绿。
 */

const TIMESTAMP = "2026-08-12T10:00:00.000Z";
const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

interface Workspace {
	id: number;
	name: string;
	repoPath: string;
	requirementCount: number;
	assetCount: number;
}

function requirementSummary(workspaceId: number) {
	return {
		requirementId: 100 + workspaceId,
		title: `需求 ${100 + workspaceId}`,
		requirementVersion: 1,
		workflow: { id: 700 + workspaceId, state: "pending", version: 0, lastEventSeq: 1 },
	};
}

function requirementDetail(requirementId: number, workspaceId: number) {
	return {
		id: requirementId,
		workspaceId,
		title: `需求 ${requirementId}`,
		version: 1,
		workflowId: 700 + workspaceId,
		designPackageId: null,
		currentRevision: {
			id: 1100 + requirementId,
			artifactId: 3,
			revisionNo: 1,
			status: "approved",
			schemaRef: "artifact/requirement/v1",
			contentDocumentId: 21,
			contentDigest: digest("b"),
			content: { title: `需求 ${requirementId}`, summary: "s", description: "d", sourceRefs: [] },
		},
	};
}

function projection(state = "pending", workspaceId = 1) {
	return {
		workflow: { id: 700 + workspaceId, state, version: 0, lastEventSeq: 1, currentFailureCode: null, policyBundle: { documentId: 5, digest: digest("a") } },
		requirement: {
			id: 100 + workspaceId,
			workspaceId,
			title: `需求 ${100 + workspaceId}`,
			version: 1,
			currentRevision: { id: 11, revisionNo: 1, status: "approved", digest: digest("b"), schemaRef: "artifact/requirement/v1" },
		},
		designSession: { id: 4, status: "active", sessionId: "design-session:1" },
		currentPlan: null,
		tasks: [],
		activeClaim: null,
		activeRun: null,
		openGates: [],
		decisions: [],
		findings: [],
		findingThreads: [],
		readiness: { workflowId: 700 + workspaceId, ready: false, checks: [], warnings: [] },
		currentPacket: null,
		currentIncident: null,
	};
}

async function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
	await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

interface MockOptions {
	/** initial GET /api/session behavior; anonymous → login form. */
	session: "anonymous" | "operator";
	workspaces: Workspace[];
	/** DELETE /api/workspaces/:id returns 409 workspace_busy until flipped. */
	deleteBusy?: () => boolean;
}

function modelConfig() {
	return {
		defaultRoles: {
			"analysis-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-plus" },
			"scenario-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-plus" },
			"usecase-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-plus" },
			"function-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-plus" },
			"design-architect": { provider: "glm", modelId: "glm-5.2" },
			"architecture-architect": { provider: "glm", modelId: "glm-5.2" },
			"data-architect": { provider: "glm", modelId: "glm-5.2" },
			"api-architect": { provider: "glm", modelId: "glm-5.2" },
			critic: { provider: "glm", modelId: "glm-4.2" },
		},
		providers: [
			{
				id: "qwen-token-plan-cn",
				name: "通义千问",
				models: [
					{ id: "qwen-max", name: "Qwen Max", contextWindow: 1_048_576, maxTokens: 16_384, reasoning: true },
					{ id: "qwen-plus", name: "Qwen Plus", contextWindow: 1_048_576, maxTokens: 8_192, reasoning: false },
				],
			},
			{
				id: "glm",
				name: "智谱 GLM",
				models: [
					{ id: "glm-5.2", name: "GLM-5.2", contextWindow: 128_000, maxTokens: 8_192, reasoning: false },
					{ id: "glm-4.2", name: "GLM-4.2", contextWindow: 128_000, maxTokens: 4_096, reasoning: false },
				],
			},
		],
	};
}

async function mockWorkspaceApi(page: Page, options: MockOptions): Promise<void> {
	await installMockEventSource(page);
	const workspaces: Workspace[] = [...options.workspaces];
	let nextId = workspaces.length + 1;

	await page.route("**/api/session", async (route) => {
		const request = route.request();
		if (request.method() === "POST") {
			await fulfillJson(route, { actorRef: "operator", capabilities: ["workflow:operate", "workflow:approve"] }, 201);
			return;
		}
		if (options.session === "anonymous") {
			await fulfillJson(route, { error: "unauthenticated" }, 401);
			return;
		}
		await fulfillJson(route, { actorRef: "operator", capabilities: ["workflow:operate", "workflow:approve"] });
	});

	await page.route("**/api/model-config", (route) => fulfillJson(route, modelConfig()));

	await page.route("**/api/workspaces/*/requirements", async (route) => {
		const request = route.request();
		if (request.method() !== "POST") {
			await route.fallback();
			return;
		}
		await fulfillJson(route, { requirementId: 42, workflowId: 742, workflowState: "pending" }, 201);
	});

	await page.route("**/api/workspaces/*", async (route) => {
		const request = route.request();
		if (request.method() !== "DELETE") {
			await route.fallback();
			return;
		}
		const id = Number(request.url().split("/").at(-1));
		if (options.deleteBusy?.()) {
			await fulfillJson(route, { error: "workspace_busy", activeRuns: 1, activeClaims: 0 }, 409);
			return;
		}
		const index = workspaces.findIndex((workspace) => workspace.id === id);
		if (index < 0) {
			await fulfillJson(route, { error: "unknown_workspace" }, 404);
			return;
		}
		workspaces.splice(index, 1);
		await fulfillJson(route, { deleted: true });
	});

	await page.route("**/api/workspaces", async (route) => {
		const request = route.request();
		if (request.method() === "POST") {
			const body = JSON.parse(request.postData() ?? "{}") as { name?: string; repoPath?: string };
		const workspace: Workspace = { id: nextId, name: (body.name ?? "").trim(), repoPath: (body.repoPath ?? "").trim(), requirementCount: 0, assetCount: 0 };
			nextId += 1;
			workspaces.push(workspace);
			await fulfillJson(route, { workspaceId: workspace.id }, 201);
			return;
		}
		await fulfillJson(route, {
			workspaces: workspaces.map((workspace) => ({ ...workspace, createdAt: TIMESTAMP })),
		});
	});

	await page.route("**/api/requirements/*", (route) => {
		const requirementId = Number(route.request().url().split("/").at(-1));
		return fulfillJson(route, requirementDetail(requirementId, requirementId - 100));
	});

	await page.route("**/api/requirements?workspaceId=*", (route) => {
		const workspaceId = Number(new URL(route.request().url()).searchParams.get("workspaceId"));
		return fulfillJson(route, { requirements: workspaces.some((workspace) => workspace.id === workspaceId) ? [requirementSummary(workspaceId)] : [] });
	});

	await page.route("**/api/workflows/*/events/stream**", (route) =>
		route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }),
	);
	await page.route("**/api/runs/*/events/stream**", (route) =>
		route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }),
	);
	await page.route("**/api/workflows/*", (route) => {
		const id = Number(route.request().url().split("/").at(-1));
		return fulfillJson(route, projection("pending", id - 700));
	});
}

async function openApp(page: Page): Promise<void> {
	await page.goto("/");
}

test.describe("workspace management", () => {
	test("匿名访问:只呈现登录表单,无管理面泄漏", async ({ page }) => {
		await mockWorkspaceApi(page, { session: "anonymous", workspaces: [{ id: 1, name: "North", repoPath: "/north", requirementCount: 1, assetCount: 0 }] });
		await openApp(page);

		await expect(page.getByLabel("Operator Token")).toBeVisible();
		await expect(page.getByRole("button", { name: "登录" })).toBeVisible();
		await expect(page.getByRole("heading", { name: "选择工作空间" })).toHaveCount(0);
		await expect(page.getByRole("button", { name: "退出" })).toHaveCount(0);
	});

	test("登录后首屏 = 选择器,列出全部工作区且未写选中键", async ({ page }) => {
		await mockWorkspaceApi(page, { session: "anonymous", workspaces: [
			{ id: 1, name: "North", repoPath: "/north", requirementCount: 1, assetCount: 0 },
			{ id: 2, name: "South", repoPath: "/south", requirementCount: 1, assetCount: 0 },
		] });
		await openApp(page);
		await page.getByLabel("Operator Token").fill("token-admin");
		await page.getByRole("button", { name: "登录" }).click();

		await expect(page.getByRole("main").getByRole("heading", { name: "选择工作空间" })).toBeVisible();
		await expect(page.getByText("/north")).toBeVisible();
		await expect(page.getByText("/south")).toBeVisible();
		await expect(page.getByRole("button", { name: "进入" })).toHaveCount(2);
		const stored = await page.evaluate(() => localStorage.getItem("baize.workspaceId"));
		expect(stored).toBeNull();
	});

	test("选择器卡片显示需求数和资产数", async ({ page }) => {
		await mockWorkspaceApi(page, { session: "anonymous", workspaces: [
			{ id: 1, name: "North", repoPath: "/north", requirementCount: 3, assetCount: 5 },
		] });
		await openApp(page);
		await page.getByLabel("Operator Token").fill("token-admin");
		await page.getByRole("button", { name: "登录" }).click();

		await expect(page.getByText("3 需求")).toBeVisible();
		await expect(page.getByText("5 资产")).toBeVisible();
	});

	test("零态:选择器空态显示创建引导", async ({ page }) => {
		await mockWorkspaceApi(page, { session: "operator", workspaces: [] });
		await openApp(page);

		await expect(page.getByRole("main").getByRole("heading", { name: "选择工作空间" })).toHaveCount(0);
		await expect(page.getByText(/还没有工作空间/)).toBeVisible();
		await expect(page.getByRole("button", { name: "新建工作空间" })).toBeVisible();
	});

	test("创建:从选择器空态跳管理页 → 创建并进入 → 写键", async ({ page }) => {
		await mockWorkspaceApi(page, { session: "operator", workspaces: [] });
		await openApp(page);
		await page.getByRole("button", { name: "新建工作空间" }).click();
		await expect(page.getByRole("main").getByRole("heading", { name: "工作空间" })).toBeVisible();
		await page.getByRole("button", { name: "＋ 新建工作空间" }).click();
		await page.getByPlaceholder("名称").fill("Alpha");
		await page.getByPlaceholder("仓库路径,如 /path/to/repo").fill("/alpha");
		await page.getByRole("button", { name: "创建并进入" }).click();

		await expect(page.getByRole("heading", { name: "需求" })).toBeVisible();
		await expect(page.getByText("需求 101")).toBeVisible();
		const stored = await page.evaluate(() => localStorage.getItem("baize.workspaceId"));
		expect(stored).toBe("1");
	});

	test("进入既有工作区 → 需求列表 → 详情 → 返回;管理页无进入按钮", async ({ page }) => {
		await mockWorkspaceApi(page, { session: "operator", workspaces: [{ id: 1, name: "North", repoPath: "/north", requirementCount: 1, assetCount: 0 }] });
		await openApp(page);

		await page.getByRole("button", { name: "进入" }).click();
		await expect(page.getByRole("heading", { name: "需求" })).toBeVisible();
		await expect(page.getByText("需求 101")).toBeVisible();

		// 进入即写键(决议 09 写入时机);reload 后直读键回同工作区需求列表
		const stored = await page.evaluate(() => localStorage.getItem("baize.workspaceId"));
		expect(stored).toBe("1");
		await page.reload();
		await expect(page.getByRole("heading", { name: "需求" })).toBeVisible();
		await expect(page.getByText("需求 101")).toBeVisible();
		await expect(page.getByRole("heading", { name: "选择工作空间" })).toHaveCount(0);


		// 小屏坍缩态:Side Bar 为抽屉,需先打开才能点击需求
		const menuBtn = page.getByRole("button", { name: "打开工作台导航" });
		if (await menuBtn.isVisible()) await menuBtn.click();
		await page.getByText("需求 101").click();
		await expect(page.getByText(/需求 101/).first()).toBeVisible();
		await expect(page.getByTestId("primary-action")).toHaveText("开始"); // pending 状态主动作

		// 返回需求列表
		await page.goto("/");
		await expect(page.getByRole("heading", { name: "需求" })).toBeVisible();

		// 管理页无「进入」按钮(概念分离)
		await page.goto("/manage");
		await expect(page.getByRole("main").getByRole("heading", { name: "工作空间" })).toBeVisible();
		await expect(page.getByRole("button", { name: "进入" })).toHaveCount(0);
	});

	test("无工作区时最小 chrome:Activity Bar/Side Bar/Panel/切换器隐藏", async ({ page }) => {
		await mockWorkspaceApi(page, { session: "anonymous", workspaces: [
			{ id: 1, name: "North", repoPath: "/north", requirementCount: 1, assetCount: 0 },
		] });
		await openApp(page);
		await page.getByLabel("Operator Token").fill("token-admin");
		await page.getByRole("button", { name: "登录" }).click();

		// 选择器首屏:无 Activity Bar / Side Bar / Panel / 切换器
		await expect(page.locator(".activity-bar-slot")).toHaveCount(0);
		await expect(page.locator(".side-bar-slot")).toHaveCount(0);
		await expect(page.locator(".panel-slot")).toHaveCount(0);
		await expect(page.locator(".switcher-btn")).toHaveCount(0);

		// 进入工作区后 chrome 恢复
		await page.getByRole("button", { name: "进入" }).click();
		await expect(page.locator(".activity-bar-slot")).toBeVisible();
		await expect(page.locator(".side-bar-slot")).toBeVisible();
		await expect(page.locator(".switcher-btn")).toBeVisible();
	});

	test("记住最近:刷新直达;键失效 → 选择器并清键", async ({ page }) => {
		await mockWorkspaceApi(page, { session: "operator", workspaces: [
			{ id: 1, name: "North", repoPath: "/north", requirementCount: 1, assetCount: 0 },
			{ id: 2, name: "South", repoPath: "/south", requirementCount: 1, assetCount: 0 },
		] });
		// 仅首次加载写键:reload 后不得覆盖测试中途设置的失效键
		await page.addInitScript(() => {
			if (localStorage.getItem("baize.workspaceId") === null) localStorage.setItem("baize.workspaceId", "1");
		});
		await openApp(page);

		// 合法已存键 → 直达该工作区需求列表,不经选择器
		await expect(page.getByRole("heading", { name: "需求" })).toBeVisible();
		await expect(page.getByText("需求 101")).toBeVisible();
		await expect(page.getByRole("heading", { name: "选择工作空间" })).toHaveCount(0);

		// 键失效(工作区 99 已删)→ 选择器并清键
		await page.evaluate(() => localStorage.setItem("baize.workspaceId", "99"));
		await page.reload();
		await expect(page.getByRole("main").getByRole("heading", { name: "选择工作空间" })).toBeVisible();
		const stored = await page.evaluate(() => localStorage.getItem("baize.workspaceId"));
		expect(stored).toBeNull();
	});

	test("删除流:取消 / 409 busy 内行错误 / 成功移除;删当前回选择器", async ({ page }) => {
		let busy = true;
		await mockWorkspaceApi(page, {
			session: "operator",
			workspaces: [{ id: 1, name: "North", repoPath: "/north", requirementCount: 1, assetCount: 0 }],
			deleteBusy: () => busy,
		});
		await page.addInitScript(() => {
			if (localStorage.getItem("baize.workspaceId") === null) localStorage.setItem("baize.workspaceId", "1");
		});
		await openApp(page);

		// 直达需求列表后回管理页(North 即当前工作区)
		await expect(page.getByRole("heading", { name: "需求" })).toBeVisible();
		await page.goto("/manage");
		await expect(page.getByRole("main").getByRole("heading", { name: "工作空间" })).toBeVisible();

		// 第一步:取消
		await page.getByRole("button", { name: "删除", exact: true }).click();
		const confirm = page.getByRole("dialog");
		await expect(confirm).toContainText("删除工作区「North」");
		await expect(confirm).toContainText("级联删除其下所有需求与资产（含设计历史、审批记录）");
		await expect(confirm).toContainText("不可恢复");
		await page.getByRole("button", { name: "取消" }).click();
		await expect(confirm).toHaveCount(0);

		// 第二步:409 busy → 行内错误保留弹层
		await page.getByRole("button", { name: "删除", exact: true }).click();
		await page.getByRole("button", { name: "确认删除" }).click();
		await expect(confirm).toContainText(/运行或认领在飞/);
		await expect(confirm).toContainText("级联删除其下所有需求与资产（含设计历史、审批记录）");

		// 放行 → 成功移除,回选择器并清键
		busy = false;
		await page.getByRole("button", { name: "确认删除" }).click();
		await expect(page.getByText(/还没有工作空间/)).toBeVisible();
		const stored = await page.evaluate(() => localStorage.getItem("baize.workspaceId"));
		expect(stored).toBeNull();
	});
});