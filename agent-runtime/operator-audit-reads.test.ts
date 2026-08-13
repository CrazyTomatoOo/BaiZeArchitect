import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	createCrashInjector,
	createFixtureClock,
	createFixtureOperator,
	createHashProvider,
	createOutboxTransport,
	type FixtureOperator,
	type FixtureOutboxTransport,
} from "./testing/deterministic-fixtures.ts";
import {
	openHeadlessWorkflowRuntime,
	type RequirementBaseline,
} from "./workflow/headless-runtime.js";
import { startOperatorServer } from "./workflow/operator-server.js";

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "audit reads",
	sourceRefs: [],
	title: "Audit reads",
	description: "Verify command receipt and incident audit lists.",
};

const OPERATOR: FixtureOperator = createFixtureOperator("alice");

interface RuntimeFixture {
	databasePath: string;
	runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;
	outbox: FixtureOutboxTransport;
	clock: ReturnType<typeof createFixtureClock>;
}

async function withRuntime(
	work: (fixture: RuntimeFixture) => Promise<void> | void,
	options: { failFirst?: number } = {},
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-audit-reads-"));
	const databasePath = path.join(directory, "workflow.db");
	const outbox = createOutboxTransport({ failFirst: options.failFirst });
	const clock = createFixtureClock("2026-08-12T10:00:00.000Z");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock,
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector([]),
		outboxTransport: outbox,
	});
	try {
		await work({ databasePath, runtime, outbox, clock });
	} finally {
		runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
}

async function createPendingWorkflow(
	runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>,
): Promise<{ requirementId: number; workflowId: number }> {
	const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
	const created = runtime.createRequirement({ workspaceId, baseline: BASELINE });
	return { requirementId: created.requirementId, workflowId: created.workflowId };
}

test("listCommandReceipts returns receipts in order with actor, versions and digests", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPendingWorkflow(runtime);
		const first = runtime.executeCommand({
			workflowId,
			commandId: "cmd-audit-1",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});
		assert.equal(first.outcome, "accepted");
		const second = runtime.executeCommand({
			workflowId,
			commandId: "cmd-audit-2",
			expectedWorkflowVersion: 1,
			type: "start",
			operator: OPERATOR,
		});
		assert.equal(second.outcome, "state_conflict");

		const receipts = runtime.listCommandReceipts(workflowId, 200);
		assert.deepEqual(
			receipts.map((receipt) => receipt.commandId),
			["cmd-audit-1", "cmd-audit-2"],
		);
		assert.equal(receipts[0]!.commandType, "start");
		assert.equal(receipts[0]!.outcome, "accepted");
		assert.equal(receipts[0]!.httpStatus, 201);
		assert.equal(receipts[0]!.actorRef, OPERATOR.actorRef);
		assert.equal(receipts[0]!.workflowVersion, 1);
		assert.equal(receipts[0]!.lastEventSeq, 2);
		assert.match(receipts[0]!.requestDigest, /^sha256:[0-9a-f]{64}$/);
		assert.equal(receipts[1]!.outcome, "state_conflict");
		assert.equal(receipts[1]!.httpStatus, 409);
	});
});

test("listCommandReceipts returns empty for unknown workflow and honors limit", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPendingWorkflow(runtime);
		assert.equal(runtime.listCommandReceipts(9999, 200).length, 0);
		for (let index = 0; index < 3; index += 1) {
			runtime.executeCommand({
				workflowId,
				commandId: `cmd-audit-limit-${index}`,
				expectedWorkflowVersion: 99,
				type: "start",
				operator: OPERATOR,
			});
		}
		assert.equal(runtime.listCommandReceipts(workflowId, 2).length, 2);
	});
});

test("listWorkflowIncidents returns incidents with recovery subjects", async () => {
	await withRuntime(async ({ runtime, clock }) => {
		const { workflowId } = await createPendingWorkflow(runtime);
		assert.deepEqual(runtime.listWorkflowIncidents(workflowId), []);
		runtime.executeCommand({
			workflowId,
			commandId: "cmd-audit-start",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});
		for (let index = 0; index < 5; index += 1) {
			runtime.processOutbox();
			clock.advance(60_000);
		}
		const incidents = runtime.listWorkflowIncidents(workflowId);
		assert.equal(incidents.length, 1);
		assert.equal(incidents[0]!.incidentType, "outbox_exhausted");
		assert.equal(incidents[0]!.failureCode, "outbox_exhausted");
		assert.equal(incidents[0]!.subjectType, "outbox_job");
		assert.equal(incidents[0]!.status, "open");
		assert.equal(typeof incidents[0]!.subjectId, "number");
		assert.equal(runtime.getWorkflowProjection(workflowId)!.workflow.state, "failed");
	}, { failFirst: 5 });
});

test("audit list endpoints serve receipts and incidents over HTTP", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-audit-http-"));
	const databasePath = path.join(directory, "workflow.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector([]),
		outboxTransport: createOutboxTransport(),
	});
	const server = await startOperatorServer({ runtime, operators: { "token-admin": OPERATOR } });
	try {
		const session = await fetch(`${server.url}/api/session`, {
			method: "POST",
			headers: { authorization: "Bearer token-admin" },
		});
		assert.equal(session.status, 201);
		const cookie = (session.headers.get("set-cookie") as string).split(";")[0]!;
		const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
		const created = runtime.createRequirement({ workspaceId, baseline: BASELINE });

		const unauthenticated = await fetch(`${server.url}/api/workflows/${created.workflowId}/receipts`);
		assert.equal(unauthenticated.status, 401);

		const unknown = await fetch(`${server.url}/api/workflows/9999/receipts`, { headers: { cookie } });
		assert.equal(unknown.status, 404);

		const badLimit = await fetch(`${server.url}/api/workflows/${created.workflowId}/receipts?limit=501`, { headers: { cookie } });
		assert.equal(badLimit.status, 400);

		const command = await fetch(`${server.url}/api/workflows/${created.workflowId}/commands/cmd-audit-http`, {
			method: "PUT",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ type: "start", expectedWorkflowVersion: 0 }),
		});
		assert.equal(command.status, 201);

		const receipts = await fetch(`${server.url}/api/workflows/${created.workflowId}/receipts`, { headers: { cookie } });
		assert.equal(receipts.status, 200);
		const receiptsBody = (await receipts.json()) as { receipts: Array<{ commandId: string; actorRef: string | null; outcome: string }> };
		assert.equal(receiptsBody.receipts.length, 1);
		assert.equal(receiptsBody.receipts[0]!.commandId, "cmd-audit-http");
		assert.equal(receiptsBody.receipts[0]!.actorRef, OPERATOR.actorRef);
		assert.equal(receiptsBody.receipts[0]!.outcome, "accepted");

		const incidents = await fetch(`${server.url}/api/workflows/${created.workflowId}/incidents`, { headers: { cookie } });
		assert.equal(incidents.status, 200);
		const incidentsBody = (await incidents.json()) as { incidents: unknown[] };
		assert.deepEqual(incidentsBody.incidents, []);

		const unknownIncidents = await fetch(`${server.url}/api/workflows/9999/incidents`, { headers: { cookie } });
		assert.equal(unknownIncidents.status, 404);
	} finally {
		await server.close();
		runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
});
