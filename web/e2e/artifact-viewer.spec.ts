import { expect, test, type Page, type Route } from "@playwright/test";

import { installMockEventSource } from "./mock-event-source";

/**
 * #18 产物内容查看器 e2e — route mock：详情页 → 「产物内容」→ 点 kind → 内容 + mermaid 图渲染。
 */

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

function requirementDetail() {
	return {
		id: 1,
		workspaceId: 2,
		title: "自动编排示例需求",
		version: 1,
		workflowId: 7,
		designPackageId: null,
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

function projection() {
	return {
		workflow: { id: 7, state: "running", version: 3, lastEventSeq: 9, currentFailureCode: null, policyBundle: { documentId: 5, digest: digest("a") } },
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
			{ id: 2, key: "analyze-1", kind: "analyze", role: "analysis-analyst", status: "completed", maxAttempts: 3, latestAttempt: { id: 2, attemptNo: 1, status: "succeeded" } },
			{ id: 3, key: "design-1", kind: "design", role: "design-architect", status: "pending", maxAttempts: 3, latestAttempt: null },
			{ id: 4, key: "review-1", kind: "review", role: "critic", status: "pending", maxAttempts: 3, latestAttempt: null },
		],
		activeClaim: null,
		activeRun: null,
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
	};
}

async function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
	await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

async function mockApi(page: Page): Promise<void> {
	await installMockEventSource(page);
	await page.route("**/api/session", (route) => fulfillJson(route, { actorRef: "operator", capabilities: ["workflow:operate", "workflow:approve"] }));
	await page.route("**/api/requirements/1", (route) => fulfillJson(route, requirementDetail()));
	await page.route("**/api/workflows/7", (route) => fulfillJson(route, projection()));
	await page.route("**/api/workflows/7/events/stream**", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }));
	// 产物内容：scenario 带 diagrams，analysis 不带
	await page.route("**/api/requirements/1/artifacts*", (route) => {
		const kind = new URL(route.request().url()).searchParams.get("kind");
		if (kind === "scenario") {
			return fulfillJson(route, {
				revisionId: 12,
				artifactId: 4,
				revisionNo: 1,
				status: "pending",
				schemaRef: "artifact/scenario/v1",
				contentDigest: digest("s"),
				content: {
					schemaVersion: "artifact/scenario/v1",
					artifactKind: "scenario",
					summary: "积分到期自动过期",
					sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
					scenarios: [],
					diagrams: [
						{
							type: "graph",
							nodes: [
								{ id: "trigger", label: "到达有效期末日" },
								{ id: "s0", label: "扫描到期积分" },
								{ id: "final", label: "到期积分不可再使用" },
							],
							edges: [
								["trigger", "s0"],
								["s0", "final"],
							],
						},
					],
				},
			});
		}
		if (kind === "analysis") {
			return fulfillJson(route, {
				revisionId: 13,
				artifactId: 5,
				revisionNo: 1,
				status: "pending",
				schemaRef: "artifact/analysis/v1",
				contentDigest: digest("a"),
				content: { schemaVersion: "artifact/analysis/v1", artifactKind: "analysis", summary: "分析", sourceRefs: [], goals: ["g"], nonGoals: [], constraints: [], acceptanceCriteria: ["ok"], openQuestions: [] },
			});
		}
		return fulfillJson(route, { error: "unknown_artifact" }, 404);
	});
}

test.describe("产物内容查看器", () => {
	test("点击 scenario 渲染 mermaid 流程图,摘要区不出现 JSON 原文", async ({ page }) => {
		await mockApi(page);
		await page.goto("/e2e/guided-workflow.html?requirementId=1");
		await expect(page.getByTestId("hero")).toBeVisible();

		await page.getByTestId("primary-action").click();
		await expect(page.getByTestId("details")).toBeVisible();
		await expect(page.getByTestId("artifact-viewer")).toBeVisible();

		await page.getByTestId("artifact-viewer").getByText("scenario").click();
		await expect(page.getByTestId("artifact-content")).toBeVisible();
		await expect(page.getByTestId("artifact-diagrams")).toBeVisible();
		// mermaid 异步渲染出 SVG
		await expect(page.locator("[data-testid=artifact-diagrams] svg")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("artifact-json")).not.toBeVisible();
	});

	test("点击 analysis（无 diagrams）显示 JSON 摘要而非图", async ({ page }) => {
		await mockApi(page);
		await page.goto("/e2e/guided-workflow.html?requirementId=1");
		await expect(page.getByTestId("hero")).toBeVisible();

		await page.getByTestId("primary-action").click();
		await expect(page.getByTestId("details")).toBeVisible();

		await page.getByTestId("artifact-viewer").getByText("analysis").click();
		await expect(page.getByTestId("artifact-content")).toBeVisible();
		await expect(page.getByTestId("artifact-json")).toBeVisible();
		await expect(page.getByTestId("artifact-json")).toContainText("artifact/analysis/v1");
		await expect(page.locator("[data-testid=artifact-content] [data-testid=artifact-diagrams]")).not.toBeVisible();
	});
});