import { expect, test, type Page, type Route } from "@playwright/test";

import { emitWorkflowEvent, failAllStreams, installMockEventSource, reopenAllStreams } from "./mock-event-source";

/**
 * 票16 gate/recovery/stale/reconnect e2e — mock 新契约路由与可控 SSE。
 * 覆盖:waiting Gate→Receipt、failed 恢复组合、stale 表单冻结、断线重连。
 */

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

function requirementDetail() {
	return {
		id: 1,
		workspaceId: 2,
		title: "门禁恢复示例需求",
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
			content: { title: "门禁恢复示例需求", summary: "s", description: "d", sourceRefs: [] },
		},
	};
}

interface ProjectionState {
	state: string;
	version: number;
	lastEventSeq: number;
	currentFailureCode: string | null;
	decisions: unknown[];
	openGates: unknown[];
	findings: unknown[];
	tasks: unknown[];
	currentIncident: unknown | null;
}

function projectionFrom(state: ProjectionState) {
	return {
		workflow: {
			id: 7,
			state: state.state,
			version: state.version,
			lastEventSeq: state.lastEventSeq,
			currentFailureCode: state.currentFailureCode,
			policyBundle: { documentId: 5, digest: digest("a") },
		},
		requirement: {
			id: 1,
			workspaceId: 2,
			title: "门禁恢复示例需求",
			version: 1,
			currentRevision: { id: 11, revisionNo: 1, status: "approved", digest: digest("b"), schemaRef: "artifact/requirement/v1" },
		},
		designSession: { id: 4, status: "active", sessionId: "design-session:1" },
		currentPlan: { id: 3, revisionNo: 1, status: "active", proposalDigest: digest("c"), createdAt: "2026-08-12T10:00:00.000Z" },
		tasks: state.tasks,
		activeClaim: null,
		activeRun: null,
		openGates: state.openGates,
		decisions: state.decisions,
		findings: state.findings,
		findingThreads: [],
		readiness: {
			workflowId: 7,
			ready: false,
			checks: [{ name: "terminal_current_work", passed: false, detail: "存在未终结 Task" }],
			warnings: [],
		},
		currentPacket: null,
		currentIncident: state.currentIncident,
	};
}

function waitingState(): ProjectionState {
	return {
		state: "waiting_for_human",
		version: 3,
		lastEventSeq: 9,
		currentFailureCode: null,
		decisions: [{ id: 2, severity: "critical", status: "open", summary: "数据库选型" }],
		openGates: [
			{ id: 4, gateType: "human_input", subjectType: "task_attempt", subjectId: 8, openedAt: "2026-08-12T10:01:00.000Z" },
			{ id: 9, gateType: "finding_disposition", subjectType: "finding_thread", subjectId: 3, openedAt: "2026-08-12T10:02:00.000Z" },
		],
		findings: [{ id: 21, threadId: 3, severity: "major", status: "open", summary: "重大缺陷:缺少回滚", targetRevisionId: 55 }],
		tasks: [
			{ id: 1, key: "plan-1", kind: "plan", role: "orchestrator", status: "completed", maxAttempts: 2, latestAttempt: null },
			{ id: 2, key: "analyze-1", kind: "analyze", role: "analyst", status: "blocked", maxAttempts: 3, latestAttempt: { id: 8, attemptNo: 1, status: "blocked" } },
		],
		currentIncident: null,
	};
}

function failedState(): ProjectionState {
	return {
		state: "failed",
		version: 5,
		lastEventSeq: 12,
		currentFailureCode: "task_budget_exhausted",
		decisions: [],
		openGates: [],
		findings: [],
		tasks: [
			{ id: 1, key: "plan-1", kind: "plan", role: "orchestrator", status: "completed", maxAttempts: 2, latestAttempt: null },
			{ id: 31, key: "analyze-1", kind: "analyze", role: "analyst", status: "failed", maxAttempts: 3, latestAttempt: { id: 9, attemptNo: 3, status: "failed" } },
		],
		currentIncident: null,
	};
}

async function fulfillJson(route: Route, value: unknown, status = 200): Promise<void> {
	await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
}

function parseBody(raw: string | null): Record<string, unknown> {
	try {
		return JSON.parse(raw ?? "{}") as Record<string, unknown>;
	} catch {
		return {};
	}
}

async function mockApi(page: Page, state: ProjectionState): Promise<{ commands: Record<string, unknown>[]; bump: () => void }> {
	await installMockEventSource(page);
	const commands: Record<string, unknown>[] = [];
	const bump = (): void => {
		state.version += 1;
		state.lastEventSeq += 1;
	};
	await page.route("**/api/requirements/1", (route) => fulfillJson(route, requirementDetail()));
	await page.route("**/api/workflows/7/commands/*", async (route) => {
		const envelope = parseBody(route.request().postData());
		commands.push(envelope);
		bump();
		if (envelope.type === "dispose-decision") {
			const payload = envelope.payload as { decisionId: number };
			state.decisions = state.decisions.filter((d) => (d as { id: number }).id !== payload.decisionId);
			if (state.decisions.length === 0 && state.openGates.length === 0) state.state = "running";
		}
		if (envelope.type === "provide-human-input") {
			const payload = envelope.payload as { gateId: number };
			state.openGates = state.openGates.filter((g) => (g as { id: number }).id !== payload.gateId);
		}
		await fulfillJson(route, {
			commandId: "cmd-x",
			workflowId: 7,
			commandType: envelope.type,
			outcome: "accepted",
			httpStatus: 201,
			workflowVersion: state.version,
			lastEventSeq: state.lastEventSeq,
			createdAt: "2026-08-12T10:03:00.000Z",
		}, 201);
	});
	await page.route("**/api/workflows/7", (route) => fulfillJson(route, projectionFrom(state)));
	return { commands, bump };
}

async function openFixture(page: Page): Promise<void> {
	await page.goto("/e2e/gate-recovery.html?requirementId=1");
	await expect(page.getByTestId("hero")).toBeVisible();
}

test.describe("gate queue 与恢复体验", () => {
	test("waiting: Gate Queue 排序、一次一项处置、回执原地呈现并推进队列", async ({ page }) => {
		const { commands } = await mockApi(page, waitingState());
		await openFixture(page);

		// 队列:critical Decision → human input → finding 处置(只读列出全部)
		const items = page.getByTestId("gate-item");
		await expect(items).toHaveCount(3);
		await expect(items.nth(0)).toHaveAttribute("data-key", "decision:2");
		await expect(items.nth(1)).toHaveAttribute("data-key", "gate:4");
		await expect(items.nth(2)).toHaveAttribute("data-key", "gate:9");
		await expect(items.nth(0)).toContainText("1/3");

		// 打开第一项(critical Decision)表单,其余处理按钮禁用(一次只处理一项)
		await page.getByTestId("gate-open-decision:2").click();
		await expect(page.getByTestId("gate-form")).toBeVisible();
		await expect(page.getByTestId("gate-open-gate:4")).toBeDisabled();

		// 提交 dispose-decision → 回执在表单上下文呈现,队列推进
		await page.getByTestId("gate-form-fields").locator("input[name='reason']").fill("采用 PostgreSQL");
		await page.getByTestId("gate-submit").click();
		await expect(page.getByTestId("gate-receipt")).toContainText("accepted");
		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({ type: "dispose-decision", expectedWorkflowVersion: 3 });
		expect((commands[0].payload as Record<string, unknown>).decisionId).toBe(2);
		await expect(page.getByTestId("gate-item")).toHaveCount(2);
	});

	test("failed: 只显示该 Incident 类型的合法恢复组合", async ({ page }) => {
		const { commands } = await mockApi(page, failedState());
		await openFixture(page);

		await expect(page.getByTestId("recovery-panel")).toBeVisible();
		await expect(page.getByTestId("recovery-retry-task")).toBeVisible();
		await expect(page.getByTestId("recovery-replace-plan")).toBeVisible();
		await expect(page.getByTestId("recovery-diagnostic")).toBeVisible();
		await expect(page.getByTestId("recovery-retry-planning")).toHaveCount(0);
		await expect(page.getByTestId("recovery-retry-recovery")).toHaveCount(0);

		await page.getByTestId("recovery-retry-task").click();
		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({ type: "retry-task" });
		expect((commands[0].payload as Record<string, unknown>).taskId).toBe(31);
	});

	test("stale: SSE 推进后表单冻结、保留草稿、显示版本差异,显式 reload 后新 commandId", async ({ page }) => {
		const { commands, bump } = await mockApi(page, waitingState());
		await openFixture(page);

		await page.getByTestId("gate-open-gate:4").click();
		const draft = page.getByTestId("gate-form-fields").locator("textarea[name='input']");
		await draft.fill("这是尚未提交的草稿");

		// 服务端版本前进(模拟他人操作)+ SSE 事件 → 表单 stale
		bump();
		await emitWorkflowEvent(page);

		await expect(page.getByTestId("stale-notice")).toBeVisible();
		await expect(page.getByTestId("stale-notice")).toContainText("期望版本 3");
		await expect(page.getByTestId("stale-notice")).toContainText("当前版本 4");
		await expect(page.getByTestId("gate-submit")).toBeDisabled();
		await expect(draft).toHaveValue("这是尚未提交的草稿");
		await expect(page.getByTestId("live-region")).toContainText("过期");
		expect(commands).toEqual([]);

		// 显式 reload:解冻并保留草稿;提交使用新 commandId 与当前版本
		await page.getByTestId("stale-reload").click();
		await expect(page.getByTestId("stale-notice")).toHaveCount(0);
		await expect(page.getByTestId("gate-submit")).toBeEnabled();
		await expect(draft).toHaveValue("这是尚未提交的草稿");
		await page.getByTestId("gate-submit").click();
		expect(commands).toHaveLength(1);
		expect(commands[0]).toMatchObject({ type: "provide-human-input", expectedWorkflowVersion: 4 });
	});

	test("断线:任一 SSE 断开禁用治理命令并显示 reconnecting;恢复后重新读取 Projection", async ({ page }) => {
		await mockApi(page, waitingState());
		await openFixture(page);

		await failAllStreams(page);
		await expect(page.getByTestId("reconnecting")).toBeVisible();
		await expect(page.getByTestId("gate-open-decision:2")).toBeDisabled();
		await expect(page.getByTestId("live-region")).toContainText("断开");

		await reopenAllStreams(page);
		await expect(page.getByTestId("reconnecting")).toHaveCount(0);
		await expect(page.getByTestId("gate-open-decision:2")).toBeEnabled();
	});
});
