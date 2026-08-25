import { expect, test, type Page, type Route } from "@playwright/test";

import { installMockEventSource } from "./mock-event-source";
import { modelConfigFixture } from "./model-config-fixture";

/**
 * 票15 guided workflow e2e — 只 mock 新契约路由(projection/detail/command/SSE),
 * 验证 running summary→details、pending start、archived package navigation。
 */

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

function requirementDetail(designPackageId: number | null = null) {
	return {
		id: 1,
		workspaceId: 2,
		title: "自动编排示例需求",
		version: 1,
		workflowId: 7,
		designPackageId,
		currentRevision: {
			id: 11,
			artifactId: 3,
			revisionNo: 1,
			status: "approved",
			schemaRef: "artifact/requirement/v1",
			contentDocumentId: 21,
			contentDigest: digest("b"),
			content: { title: "自动编排示例需求", summary: "s", description: "d", sourceRefs: [] },
		},
	};
}

function projection(state: string, version: number, lastEventSeq: number, extra: Record<string, unknown> = {}, workflowExtra: Record<string, unknown> = {}) {
	return {
		workflow: { id: 7, state, version, lastEventSeq, currentFailureCode: null, policyBundle: { documentId: 5, digest: digest("a") }, ...workflowExtra },
		requirement: {
			id: 1,
			workspaceId: 2,
			title: "自动编排示例需求",
			version: 1,
			currentRevision: { id: 11, revisionNo: 1, status: "approved", digest: digest("b"), schemaRef: "artifact/requirement/v1" },
		},
		designSession: { id: 4, status: "active", sessionId: "design-session:1" },
		currentPlan: { id: 3, revisionNo: 1, status: "active", proposalDigest: digest("c"), createdAt: "2026-08-12T10:00:00.000Z" },
		tasks: [
			{ id: 1, key: "plan-1", kind: "plan", role: "orchestrator", status: "completed", maxAttempts: 2, latestAttempt: { id: 1, attemptNo: 1, status: "succeeded" } },
			{ id: 2, key: "analyze-1", kind: "analyze", role: "analyst", status: "in_progress", maxAttempts: 3, latestAttempt: { id: 2, attemptNo: 1, status: "running" } },
			{ id: 3, key: "design-1", kind: "design", role: "architect", status: "pending", maxAttempts: 3, latestAttempt: null },
			{ id: 4, key: "review-1", kind: "review", role: "critic", status: "pending", maxAttempts: 3, latestAttempt: null },
		],
		activeClaim: { id: 8, taskId: 2, attemptId: 2, runId: 12, acquiredAt: "2026-08-12T10:01:00.000Z" },
		activeRun: { id: 12, status: "running", mode: "attempt", role: "analyst", startedAt: "2026-08-12T10:01:00.000Z" },
		openGates: [],
		decisions: [],
		findings: [],
		findingThreads: [],
		readiness: {
			workflowId: 7,
			ready: false,
			checks: [
				{ name: "terminal_current_work", passed: false, detail: "存在未终结 Task" },
				{ name: "complete_required_artifacts", passed: false, detail: "1/3 kinds 已有当前 revision" },
			],
			warnings: [],
		},
		currentPacket: null,
		currentIncident: null,
		...extra,
	};
}

async function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
	await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

interface MockOptions {
	initialState: string;
	designPackageId?: number | null;
	modelRoles?: Record<string, unknown>;
	onCommand?: (envelope: Record<string, unknown>) => void;
}

function parseBody(raw: string | null): Record<string, unknown> {
	try {
		return JSON.parse(raw ?? "{}") as Record<string, unknown>;
	} catch {
		return {};
	}
}

async function mockApi(page: Page, options: MockOptions): Promise<{ commands: Record<string, unknown>[] }> {
	await installMockEventSource(page);
	await page.route("**/api/session", (route) => fulfillJson(route, { actorRef: "operator", capabilities: ["workflow:operate", "workflow:approve"] }));
	let state = options.initialState;
	let version = 0;
	let lastEventSeq = 1;
	const commands: Record<string, unknown>[] = [];

	await page.route("**/api/requirements/1", (route) => fulfillJson(route, requirementDetail(options.designPackageId ?? null)));
	await page.route("**/api/workflows/7/events/stream**", (route) =>
		route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }),
	);
	await page.route("**/api/workflows/7/commands/*", async (route) => {
		const envelope = parseBody(route.request().postData());
		commands.push(envelope);
		options.onCommand?.(envelope);
		version += 1;
		lastEventSeq += 1;
		if (envelope.type === "start") state = "running";
		if (envelope.type === "resume") state = "running";
		await fulfillJson(route, {
			commandId: "cmd-1",
			workflowId: 7,
			commandType: envelope.type,
			outcome: "accepted",
			httpStatus: 201,
			workflowVersion: version,
			lastEventSeq,
			createdAt: "2026-08-12T10:02:00.000Z",
		}, 201);
	});
	await page.route("**/api/model-config", (route) => fulfillJson(route, modelConfigFixture()));
	await page.route("**/api/workflows/7", (route) =>
		fulfillJson(route, projection(state, version, lastEventSeq, {}, options.modelRoles ? { modelRoles: options.modelRoles } : {})),
	);
	await page.route("**/api/design-packages/9", (route) =>
		fulfillJson(route, {
			id: 9,
			requirementId: 1,
			workspaceId: 2,
			documentId: 31,
			digest: digest("d"),
			approvalPacketId: 6,
			approvalId: 5,
			migrationAttestationDocumentId: null,
			archiveClass: "governed",
			archivedAt: "2026-08-12T11:00:00.000Z",
		}),
	);
	return { commands };
}

async function openFixture(page: Page): Promise<void> {
	await page.goto("/e2e/guided-workflow.html?requirementId=1");
	await expect(page.getByTestId("hero")).toBeVisible();
}

test.describe("guided workflow page", () => {
	test("running: 概览主动作只展开同页详情,不发送治理命令", async ({ page }) => {
		const { commands } = await mockApi(page, { initialState: "running" });
		await openFixture(page);

		await expect(page.getByTestId("hero")).toHaveAttribute("data-state", "running");
		await expect(page.getByTestId("primary-action")).toHaveText("查看进度");
		await expect(page.getByTestId("stages")).toBeVisible();
		await expect(page.getByTestId("stage-analyze")).toHaveAttribute("data-status", "active");

		await page.getByTestId("primary-action").click();
		await expect(page.getByTestId("details")).toBeVisible();
		await expect(page.getByTestId("task-table")).toContainText("analyze-1");
		await expect(page.getByTestId("active-work")).toContainText("运行 #12");
		expect(commands).toEqual([]);
	});

	test("pending: 主动作发送 start 命令,receipt 单独呈现后 Projection 刷新", async ({ page }) => {
		const { commands } = await mockApi(page, { initialState: "pending" });
		await openFixture(page);

		await expect(page.getByTestId("hero")).toHaveAttribute("data-state", "pending");
		await page.getByTestId("primary-action").click();

		await expect(page.getByTestId("command-receipt")).toBeVisible();
		await expect(page.getByTestId("command-receipt")).toContainText("启动");
		await expect(page.getByTestId("command-receipt")).toContainText("已接受");
		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({ schemaVersion: "workflow-command/v1", type: "start", expectedWorkflowVersion: 0 });
		await expect(page.getByTestId("hero")).toHaveAttribute("data-state", "running");
	});

	test("archived: 主动作导航到不可变 Design Package 视图", async ({ page }) => {
		await mockApi(page, { initialState: "archived", designPackageId: 9 });
		await openFixture(page);

		await expect(page.getByTestId("hero")).toHaveAttribute("data-state", "archived");
		await expect(page.getByTestId("primary-action")).toHaveText("查看设计包");
		await page.getByTestId("primary-action").click();

		await expect(page.getByTestId("design-package")).toBeVisible();
		await expect(page.getByTestId("design-package")).toContainText("设计包 #9");
		await expect(page.getByTestId("design-package")).toContainText(digest("d"));
		await expect(page.getByTestId("design-package")).toContainText("governed");
	});

	test("paused: 主动作发送 resume 命令并呈现 receipt", async ({ page }) => {
		const { commands } = await mockApi(page, { initialState: "paused" });
		await openFixture(page);

		await expect(page.getByTestId("primary-action")).toHaveText("继续");
		await page.getByTestId("primary-action").click();
		await expect(page.getByTestId("command-receipt")).toContainText("继续");
		expect(commands[0]).toMatchObject({ type: "resume" });
	});
	test("模型档只读卡:需求级标记、部署默认标记与目录名解析", async ({ page }) => {
		await mockApi(page, {
			initialState: "running",
			modelRoles: { "analysis-analyst": { provider: "glm", modelId: "glm-5.2" } },
		});
		await openFixture(page);

		// 只读卡渲染,计数按持久化值 vs 部署默认算出 1/9
		await expect(page.getByTestId("model-profile-card")).toBeVisible();
		await expect(page.getByTestId("model-profile-count")).toHaveText("1/9 需求级自定义 · 缺省 = 部署默认档");

		// 需求级行:标记 + 提供方/模型显示目录名
		await expect(page.getByTestId("profile-row-analysis-analyst")).toHaveAttribute("data-custom", "true");
		await expect(page.getByTestId("profile-row-analysis-analyst")).toContainText("需求级");
		await expect(page.getByTestId("profile-row-analysis-analyst")).toContainText("智谱 GLM");
		await expect(page.getByTestId("profile-row-analysis-analyst")).toContainText("GLM-5.2");

		// 未自定义角色回落部署默认(critic = 智谱 GLM / GLM-4.2)
		await expect(page.getByTestId("profile-row-critic")).toHaveAttribute("data-custom", "false");
		await expect(page.getByTestId("profile-row-critic")).toContainText("部署默认");
		await expect(page.getByTestId("profile-row-critic")).toContainText("GLM-4.2");
	});

	test("模型档只读卡:无需求级自定义时全默认计数 0", async ({ page }) => {
		await mockApi(page, { initialState: "running" });
		await openFixture(page);

		await expect(page.getByTestId("model-profile-card")).toBeVisible();
		await expect(page.getByTestId("model-profile-count")).toHaveText("0/9 需求级自定义 · 缺省 = 部署默认档");
		await expect(page.getByTestId("profile-row-analysis-analyst")).toHaveAttribute("data-custom", "false");
	});
});
