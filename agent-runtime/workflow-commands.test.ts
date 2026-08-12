import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import {
	createCrashInjector,
	createFixtureClock,
	createFixtureOperator,
	createHashProvider,
	createOutboxTransport,
	type FixtureOutboxTransport,
	type FixtureOperator,
} from "./testing/deterministic-fixtures.ts";
import {
	openHeadlessWorkflowRuntime,
	type CommandReceipt,
	type RequirementBaseline,
} from "./workflow/headless-runtime.js";

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Add expiry reminders and controlled compensation.",
	sourceRefs: [],
	title: "Points expiry and compensation",
	description: "Add expiry reminders and controlled compensation.",
};

const OPERATOR: FixtureOperator = createFixtureOperator("alice");
const DENIED_OPERATOR: FixtureOperator = {
	actorRef: "operator:denied",
	capabilities: ["workflow:approve"],
};

interface RuntimeFixture {
	databasePath: string;
	runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;
	outbox: FixtureOutboxTransport;
}

function runtimeOptions(
	databasePath: string,
	outbox: FixtureOutboxTransport,
	crashPoints: readonly string[] = [],
) {
	return {
		databasePath,
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(crashPoints),
		outboxTransport: outbox,
	};
}

async function withRuntime(
	work: (fixture: RuntimeFixture) => Promise<void> | void,
	crashPoints: readonly string[] = [],
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-workflow-commands-"));
	const databasePath = path.join(directory, "workflow.db");
	const outbox = createOutboxTransport();
	const runtime = await openHeadlessWorkflowRuntime(runtimeOptions(databasePath, outbox, crashPoints));
	try {
		await work({ databasePath, runtime, outbox });
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

test("start transitions pending to running and appends workflow_started event", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPendingWorkflow(runtime);

		const receipt = runtime.executeCommand({
			workflowId,
			commandId: "cmd-start-1",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});

		assert.equal(receipt.outcome, "accepted");
		assert.equal(receipt.httpStatus, 201);
		assert.equal(receipt.commandType, "start");
		assert.equal(receipt.workflowVersion, 1);
		assert.equal(receipt.lastEventSeq, 2);

		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		assert.equal(projection.workflow.state, "running");
		assert.equal(projection.workflow.version, 1);
		assert.equal(projection.workflow.lastEventSeq, 2);
		assert.deepEqual(projection.events[1], {
			workflowId,
			seq: 2,
			type: "workflow_started",
			typeVersion: 1,
			schemaVersion: "workflow-event/v1",
			workflowVersion: 1,
			entity: { type: "workflow", id: workflowId, version: 1 },
			payload: {},
		createdAt: "2026-08-12T10:00:00.000Z",
		});
	});
});

test("pause and resume follow the seven-state transition table", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPendingWorkflow(runtime);

		runtime.executeCommand({
			workflowId,
			commandId: "cmd-start-1",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});

		const pauseReceipt = runtime.executeCommand({
			workflowId,
			commandId: "cmd-pause-1",
			expectedWorkflowVersion: 1,
			type: "pause",
			operator: OPERATOR,
		});
		assert.equal(pauseReceipt.outcome, "accepted");
		assert.equal(pauseReceipt.workflowVersion, 2);
		assert.equal(pauseReceipt.lastEventSeq, 3);
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.state, "paused");

		const resumeReceipt = runtime.executeCommand({
			workflowId,
			commandId: "cmd-resume-1",
			expectedWorkflowVersion: 2,
			type: "resume",
			operator: OPERATOR,
		});
		assert.equal(resumeReceipt.outcome, "accepted");
		assert.equal(resumeReceipt.workflowVersion, 3);
		assert.equal(resumeReceipt.lastEventSeq, 4);
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.state, "running");

		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		assert.deepEqual(
			projection.events.map((e) => e.type),
			["workflow_created", "workflow_started", "workflow_paused", "workflow_resumed"],
		);
	});
});

test("same commandId and same request digest replays the first outcome exactly", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPendingWorkflow(runtime);

		const first = runtime.executeCommand({
			workflowId,
			commandId: "cmd-start-1",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});

		const replayed = runtime.executeCommand({
			workflowId,
			commandId: "cmd-start-1",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});

		assert.deepEqual(replayed, first);
		assert.equal(replayed.outcome, "accepted");
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.lastEventSeq, 2);
	});
});

test("same commandId with different request digest returns idempotency conflict and leaves audit event", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPendingWorkflow(runtime);

		runtime.executeCommand({
			workflowId,
			commandId: "cmd-1",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});

		const conflict = runtime.executeCommand({
			workflowId,
			commandId: "cmd-1",
			expectedWorkflowVersion: 1,
			type: "pause",
			operator: OPERATOR,
		});

		assert.equal(conflict.outcome, "idempotency_conflict");
		assert.equal(conflict.httpStatus, 409);

		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		assert.equal(projection.workflow.state, "running");
		assert.equal(projection.workflow.version, 1);
		assert.equal(projection.workflow.lastEventSeq, 3);
		assert.equal(projection.events[2].type, "command_idempotency_conflict");

		const stored = runtime.getCommandReceipt(workflowId, "cmd-1");
		assert.ok(stored);
		assert.equal(stored.outcome, "accepted");
	});
});

test("version conflict persists a receipt and does not change state", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPendingWorkflow(runtime);

		runtime.executeCommand({
			workflowId,
			commandId: "cmd-start-1",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});

		const receipt = runtime.executeCommand({
			workflowId,
			commandId: "cmd-pause-stale",
			expectedWorkflowVersion: 0,
			type: "pause",
			operator: OPERATOR,
		});

		assert.equal(receipt.outcome, "version_conflict");
		assert.equal(receipt.httpStatus, 409);
		assert.equal(receipt.workflowVersion, 1);

		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		assert.equal(projection.workflow.state, "running");
		assert.equal(projection.workflow.version, 1);

		const stored = runtime.getCommandReceipt(workflowId, "cmd-pause-stale");
		assert.ok(stored);
		assert.equal(stored.outcome, "version_conflict");
	});
});

test("state conflict persists a receipt when start is applied to a non-pending Workflow", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPendingWorkflow(runtime);

		runtime.executeCommand({
			workflowId,
			commandId: "cmd-start-1",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});

		const receipt = runtime.executeCommand({
			workflowId,
			commandId: "cmd-start-2",
			expectedWorkflowVersion: 1,
			type: "start",
			operator: OPERATOR,
		});

		assert.equal(receipt.outcome, "state_conflict");
		assert.equal(receipt.httpStatus, 409);

		const stored = runtime.getCommandReceipt(workflowId, "cmd-start-2");
		assert.ok(stored);
		assert.equal(stored.outcome, "state_conflict");
	});
});

test("capability denial persists a receipt and does not change state", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPendingWorkflow(runtime);

		const receipt = runtime.executeCommand({
			workflowId,
			commandId: "cmd-start-denied",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: DENIED_OPERATOR,
		});

		assert.equal(receipt.outcome, "capability_denied");
		assert.equal(receipt.httpStatus, 403);

		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		assert.equal(projection.workflow.state, "pending");
		assert.equal(projection.workflow.version, 0);

		const stored = runtime.getCommandReceipt(workflowId, "cmd-start-denied");
		assert.ok(stored);
		assert.equal(stored.outcome, "capability_denied");
	});
});

test("invalid command envelope does not forge a domain receipt", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPendingWorkflow(runtime);

		assert.throws(
			() =>
				runtime.executeCommand({
					workflowId,
					commandId: "cmd-bad",
					schemaVersion: "not-a-command/v1",
				} as never),
			/Command envelope schema is invalid/,
		);

		assert.throws(
			() =>
				runtime.executeCommand({
					workflowId,
					commandId: "cmd-bad-type",
					expectedWorkflowVersion: 0,
					type: "explode" as never,
					operator: OPERATOR,
				} as never),
			/Command envelope schema is invalid/,
		);

		assert.equal(runtime.getCommandReceipt(workflowId, "cmd-bad"), undefined);
		assert.equal(runtime.getCommandReceipt(workflowId, "cmd-bad-type"), undefined);
	});
});

test("crash during command rolls back the entire transaction", async () => {
	await withRuntime(async ({ databasePath, runtime }) => {
		const { workflowId } = await createPendingWorkflow(runtime);

		assert.throws(
			() =>
				runtime.executeCommand({
					workflowId,
					commandId: "cmd-start-crash",
					expectedWorkflowVersion: 0,
					type: "start",
					operator: OPERATOR,
				}),
			/crash point reached: execute_command.before_commit/,
		);

		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		assert.equal(projection.workflow.state, "pending");
		assert.equal(projection.workflow.version, 0);
		assert.equal(projection.workflow.lastEventSeq, 1);
		assert.equal(projection.events.length, 1);

		const database = new Database(databasePath, { readonly: true });
		try {
			const receipts = database
				.prepare("select count(*) as count from command_receipts")
				.get() as { count: number };
			assert.equal(receipts.count, 0);
		} finally {
			database.close();
		}

		const receipt = runtime.executeCommand({
			workflowId,
			commandId: "cmd-start-retry",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});
		assert.equal(receipt.outcome, "accepted");
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.state, "running");
	}, ["execute_command.before_commit"]);
});

test("accepted command delivers an outbox job after commit", async () => {
	await withRuntime(async ({ runtime, outbox }) => {
		const { workflowId } = await createPendingWorkflow(runtime);

		runtime.executeCommand({
			workflowId,
			commandId: "cmd-start-1",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});

		const deliveries = outbox.deliveries();
		assert.equal(deliveries.length, 1);
		assert.equal(deliveries[0].type, "workflow_event");
		assert.equal(deliveries[0].payload, "workflow_started");
	});
});

test("command receipts are immutable once persisted", async () => {
	await withRuntime(async ({ databasePath, runtime }) => {
		const { workflowId } = await createPendingWorkflow(runtime);

		runtime.executeCommand({
			workflowId,
			commandId: "cmd-start-1",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});

		const database = new Database(databasePath);
		try {
			assert.throws(
				() =>
					database
						.prepare("update command_receipts set outcome = 'state_conflict' where command_id = ?")
						.run("cmd-start-1"),
				/Command Receipt is immutable/,
			);
			assert.throws(
				() =>
					database
						.prepare("delete from command_receipts where command_id = ?")
						.run("cmd-start-1"),
				/Command Receipt is immutable/,
			);
		} finally {
			database.close();
		}
	});
});
