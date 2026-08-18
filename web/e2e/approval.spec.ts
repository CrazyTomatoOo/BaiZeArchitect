import { expect, test, type Page, type Route } from "@playwright/test";

import { emitWorkflowEvent, installMockEventSource } from "./mock-event-source";

/**
 * 票17 focused approval e2e — 只 mock 新契约路由。
 * 验证:专注审阅(精确 digest 绑定)、sticky 批准/打回、packet stale 锁定与显式 reload、
 * 分阶段反馈(receipt → archived Projection)。
 */

const digest = (letter: string) => `sha256:${letter.repeat(64)}`;

interface MockState {
	state: string;
	version: number;
	lastEventSeq: number;
	packet: { id: number; digest: string } | null;
	designPackageId: number | null;
}

function requirementDetail(designPackageId: number | null) {
	return {
		id: 1,
		workspaceId: 2,
		title: "待批准需求",
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
			content: { title: "待批准需求", summary: "s", description: "d", sourceRefs: [] },
		},
	};
}

function projectionFrom(state: MockState) {
	return {
		workflow: { id: 7, state: state.state, version: state.version, lastEventSeq: state.lastEventSeq, currentFailureCode: null, policyBundle: { documentId: 5, digest: digest("a") } },
		requirement: {
			id: 1,
			workspaceId: 2,
			title: "待批准需求",
			version: 1,
			currentRevision: { id: 11, revisionNo: 1, status: "approved", digest: digest("b"), schemaRef: "artifact/requirement/v1" },
		},
		designSession: { id: 4, status: state.state === "archived" ? "archived" : "active", sessionId: "design-session:1" },
		currentPlan: { id: 3, revisionNo: 1, status: "active", proposalDigest: digest("c"), createdAt: "2026-08-12T10:00:00.000Z" },
		tasks: [
			{ id: 1, key: "plan-1", kind: "plan", role: "orchestrator", status: "completed", maxAttempts: 2, latestAttempt: { id: 1, attemptNo: 1, status: "succeeded" } },
			{ id: 2, key: "analyze-1", kind: "analyze", role: "analyst", status: "completed", maxAttempts: 3, latestAttempt: { id: 2, attemptNo: 1, status: "succeeded" } },
			{ id: 3, key: "design-1", kind: "design", role: "architect", status: "completed", maxAttempts: 3, latestAttempt: { id: 3, attemptNo: 1, status: "succeeded" } },
			{ id: 4, key: "review-1", kind: "review", role: "critic", status: "completed", maxAttempts: 3, latestAttempt: { id: 4, attemptNo: 1, status: "succeeded" } },
		],
		activeClaim: null,
		activeRun: { id: 12, status: "completed", mode: "attempt", role: "critic", startedAt: "2026-08-12T10:01:00.000Z" },
		openGates: [],
		decisions: [],
		findings: [],
		findingThreads: [],
		readiness: {
			workflowId: 7,
			ready: true,
			checks: [
				{ name: "terminal_current_work", passed: true, detail: "全部终结" },
				{ name: "complete_required_artifacts", passed: true, detail: "2/2 kinds 已有当前 revision" },
			],
			warnings: [],
		},
		currentPacket: state.packet ? { id: state.packet.id, digest: state.packet.digest, status: "current", createdAt: "2026-08-12T10:05:00.000Z" } : null,
		currentIncident: null,
	};
}

function packetDetail(id: number, packetDigest: string, valid = true) {
	return {
		id,
		workflowId: 7,
		digest: packetDigest,
		status: "current",
		valid,
		createdAt: "2026-08-12T10:05:00.000Z",
		content: {
			schemaVersion: "approval-packet/v1",
			workflowId: 7,
			requirementRevisionId: 11,
			artifacts: [
				{ artifactId: 3, revisionId: 21, kind: "analysis", revisionNo: 1, status: "pending", contentDigest: digest("e") },
				{ artifactId: 4, revisionId: 22, kind: "design", revisionNo: 1, status: "pending", contentDigest: digest("f") },
			],
			decisions: [
				{ id: 2, severity: "major", status: "accepted", summary: "选择事件溯源存储", reason: "可审计", owner: null, followUpTarget: null },
			],
			findings: [
				{ id: 5, fingerprint: "fp-1", severity: "major", status: "risk_accepted", summary: "边界条件未完全覆盖", targetRevisionId: 21, riskAcceptedBy: "operator:alice", riskAcceptanceReason: "影响可控" },
			],
			disclosedFindingIds: [],
			criticCoverage: { coveredRevisionIds: [21, 22] },
			warnings: ["1 evidence snapshot(s) are not referenced by any TraceLink"],
			policyBundleDigest: digest("a"),
			requiredArtifactKinds: ["analysis", "design"],
		},
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

async function mockApi(page: Page): Promise<{ commands: Record<string, unknown>[]; state: MockState; replacePacket: (id: number, letter: string) => void }> {
	await installMockEventSource(page);
	await page.route("**/api/session", (route) => fulfillJson(route, { actorRef: "operator", capabilities: ["workflow:operate", "workflow:approve"] }));
	const state: MockState = { state: "ready_to_archive", version: 8, lastEventSeq: 4, packet: { id: 9, digest: digest("p") }, designPackageId: null };
	const commands: Record<string, unknown>[] = [];

	await page.route("**/api/requirements/1", (route) => fulfillJson(route, requirementDetail(state.designPackageId)));
	await page.route("**/api/workflows/7/events/stream**", (route) =>
		route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }),
	);
	await page.route("**/api/runs/12/events/stream**", (route) =>
		route.fulfill({ status: 200, contentType: "text/event-stream", body: "" }),
	);
	await page.route("**/api/approval-packets/9", (route) => fulfillJson(route, packetDetail(9, digest("p"), state.packet?.id === 9)));
	await page.route("**/api/approval-packets/10", (route) => fulfillJson(route, packetDetail(10, digest("q"), state.packet?.id === 10)));
	await page.route("**/api/workflows/7/commands/*", async (route) => {
		const envelope = parseBody(route.request().postData());
		commands.push(envelope);
		const payload = (envelope.payload ?? {}) as Record<string, unknown>;
		let outcome = "accepted";
		if (envelope.type === "approve-packet") {
			if (payload.packetDigest !== state.packet?.digest || envelope.expectedWorkflowVersion !== state.version) {
				outcome = "version_conflict";
			} else {
				state.state = "archived";
				state.version += 1;
				state.lastEventSeq += 2;
				state.designPackageId = 9;
			}
		}
		if (envelope.type === "reject-packet") {
			state.state = "running";
			state.version += 1;
			state.lastEventSeq += 1;
			state.packet = null;
		}
		await fulfillJson(route, {
			commandId: "cmd-x",
			workflowId: 7,
			commandType: envelope.type,
			outcome,
			httpStatus: outcome === "accepted" ? 201 : 409,
			workflowVersion: state.version,
			lastEventSeq: state.lastEventSeq,
			createdAt: "2026-08-12T10:06:00.000Z",
		}, outcome === "accepted" ? 201 : 409);
	});
	await page.route("**/api/workflows/7", (route) => fulfillJson(route, projectionFrom(state)));
	await page.route("**/api/design-packages/9", (route) =>
		fulfillJson(route, {
			id: 9,
			requirementId: 1,
			workspaceId: 2,
			documentId: 31,
			digest: digest("d"),
			approvalPacketId: 9,
			approvalId: 5,
			migrationAttestationDocumentId: null,
			archiveClass: "governed",
			archivedAt: "2026-08-12T10:06:01.000Z",
		}),
	);
	return {
		commands,
		state,
		replacePacket: (id: number, letter: string) => {
			state.packet = { id, digest: digest(letter) };
			state.version += 1;
			state.lastEventSeq += 1;
		},
	};
}

async function openFixture(page: Page): Promise<void> {
	await page.goto("/e2e/approval.html?requirementId=1");
	await expect(page.getByTestId("hero")).toBeVisible();
}

test.describe("focused approval", () => {
	test("ready: 专注审阅展示 packet 事实,键盘批准 → receipt → archived 分阶段反馈", async ({ page }) => {
		const { commands } = await mockApi(page);
		await openFixture(page);

		await expect(page.getByTestId("hero")).toHaveAttribute("data-state", "ready_to_archive");
		await page.getByTestId("primary-action").click();

		const review = page.getByTestId("approval-review");
		await expect(review).toBeVisible();
		await expect(page.getByTestId("approval-heading")).toBeFocused();
		await expect(page.getByTestId("packet-digest")).toContainText(digest("p"));
		await expect(page.getByTestId("packet-artifacts")).toContainText("analysis");
		await expect(page.getByTestId("packet-artifacts")).toContainText("design");
		await expect(page.getByTestId("packet-decisions")).toContainText("选择事件溯源存储");
		await expect(page.getByTestId("packet-findings")).toContainText("边界条件未完全覆盖");
		await expect(page.getByTestId("packet-findings")).toContainText("operator:alice");
		await expect(page.getByTestId("packet-coverage")).toContainText("21, 22");
		await expect(page.getByTestId("packet-warnings")).toContainText("TraceLink");
		await expect(page.getByTestId("packet-readiness")).toContainText("terminal_current_work");

		// 键盘流程:Tab 移到 sticky 批准按钮,Enter 提交
		await page.keyboard.press("Tab");
		await page.getByTestId("approve-submit").focus();
		await expect(page.getByTestId("approve-submit")).toBeFocused();
		await page.keyboard.press("Enter");

		await expect(page.getByTestId("approval-review")).toHaveCount(0);
		await expect(page.getByTestId("command-receipt")).toContainText("批准归档");
		await expect(page.getByTestId("command-receipt")).toContainText("已接受");

		const approve = commands.find((command) => command.type === "approve-packet");
		expect(approve).toBeDefined();
		expect((approve!.payload as { packetDigest: string }).packetDigest).toBe(digest("p"));
		expect(approve!.expectedWorkflowVersion).toBe(8);

		await expect(page.getByTestId("hero")).toHaveAttribute("data-state", "archived");
		await expect(page.getByTestId("primary-action")).toHaveText("查看设计包");
	});

	test("reject: secondary 打回要求 reason 与 targets,接受后呈现运行中的实际结果", async ({ page }) => {
		const { commands } = await mockApi(page);
		await openFixture(page);
		await page.getByTestId("primary-action").click();
		await expect(page.getByTestId("approval-review")).toBeVisible();

		await page.getByTestId("reject-toggle").click();
		const form = page.getByTestId("reject-form");
		await expect(form).toBeVisible();
		await form.locator("input[name='reason']").fill("设计缺少回滚策略");
		await form.locator("input[name='targets'][value='design']").check();
		await page.getByTestId("reject-submit").click();

		await expect(page.getByTestId("approval-review")).toHaveCount(0);
		await expect(page.getByTestId("command-receipt")).toContainText("打回返工");
		await expect(page.getByTestId("hero")).toHaveAttribute("data-state", "running");

		const reject = commands.find((command) => command.type === "reject-packet");
		expect(reject).toBeDefined();
		const payload = reject!.payload as { reason: string; targets: string[] };
		expect(payload.reason).toBe("设计缺少回滚策略");
		expect(payload.targets).toEqual(["design"]);
	});

	test("packet stale: SSE 推进后锁定审阅、禁用批准、保留位置,显式 reload 后才能批准新 digest", async ({ page }) => {
		const { commands, replacePacket } = await mockApi(page);
		await openFixture(page);
		await page.getByTestId("primary-action").click();
		await expect(page.getByTestId("approval-review")).toBeVisible();
		await expect(page.getByTestId("packet-digest")).toContainText(digest("p"));

		replacePacket(10, "q");
		await emitWorkflowEvent(page);

		await expect(page.getByTestId("approval-stale")).toBeVisible();
		await expect(page.getByTestId("approval-stale")).toContainText(digest("p").slice(0, 27));
		await expect(page.getByTestId("approval-stale")).toContainText(digest("q").slice(0, 27));
		await expect(page.getByTestId("approve-submit")).toBeDisabled();
		await expect(page.getByTestId("reject-toggle")).toBeDisabled();
		await expect(page.getByTestId("live-region")).toContainText("批准包已变化");
		// 阅读位置保留:packet 内容仍然展示
		await expect(page.getByTestId("packet-artifacts")).toBeVisible();

		await page.getByTestId("approval-reload").click();
		await expect(page.getByTestId("approval-stale")).toHaveCount(0);
		await expect(page.getByTestId("packet-digest")).toContainText(digest("q"));
		await expect(page.getByTestId("approve-submit")).toBeEnabled();

		await page.getByTestId("approve-submit").click();
		await expect(page.getByTestId("hero")).toHaveAttribute("data-state", "archived");
		const approves = commands.filter((command) => command.type === "approve-packet");
		expect(approves).toHaveLength(1);
		expect((approves[0]!.payload as { packetDigest: string }).packetDigest).toBe(digest("q"));
	});
});
