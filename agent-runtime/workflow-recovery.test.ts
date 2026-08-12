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
	type FixtureClock,
	type FixtureOutboxTransport,
	type FixtureOperator,
} from "./testing/deterministic-fixtures.ts";
import {
	openHeadlessWorkflowRuntime,
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

interface RecoveryFixture {
	databasePath: string;
	runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;
	outbox: FixtureOutboxTransport;
	clock: FixtureClock;
}

async function withRecoveryRuntime(
	work: (fixture: RecoveryFixture) => Promise<void> | void,
	options: { failFirst?: number; crashPoints?: readonly string[] } = {},
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-workflow-recovery-"));
	const databasePath = path.join(directory, "workflow.db");
	const outbox = createOutboxTransport({ failFirst: options.failFirst });
	const clock = createFixtureClock("2026-08-12T10:00:00.000Z");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock,
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(options.crashPoints ?? []),
		outboxTransport: outbox,
	});
	try {
		await work({ databasePath, runtime, outbox, clock });
	} finally {
		runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
}

type Runtime = RecoveryFixture["runtime"];

async function createPendingWorkflow(runtime: Runtime): Promise<{ workflowId: number }> {
	const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
	const created = runtime.createRequirement({ workspaceId, baseline: BASELINE });
	return { workflowId: created.workflowId };
}

async function createStartedWorkflow(runtime: Runtime): Promise<{ workflowId: number }> {
	const { workflowId } = await createPendingWorkflow(runtime);
	runtime.executeCommand({
		workflowId,
		commandId: "cmd-start",
		expectedWorkflowVersion: 0,
		type: "start",
		operator: OPERATOR,
	});
	return { workflowId };
}

function exhaustOutboxDelivery(runtime: Runtime, clock: FixtureClock): void {
	for (let i = 0; i < 5; i += 1) {
		runtime.processOutbox();
		clock.advance(60_000);
	}
}

function queryIncident(
	databasePath: string,
	workflowId: number,
): { id: number; incident_type: string; failure_code: string; subject_type: string; subject_id: number; status: string } | undefined {
	const database = new Database(databasePath, { readonly: true });
	try {
		return database
			.prepare(
				"select id, incident_type, failure_code, subject_type, subject_id, status from workflow_incidents where workflow_id = ? order by id",
			)
			.get(workflowId) as
			| { id: number; incident_type: string; failure_code: string; subject_type: string; subject_id: number; status: string }
			| undefined;
	} finally {
		database.close();
	}
}

function snapshotTables(databasePath: string): string {
	const database = new Database(databasePath, { readonly: true });
	try {
		const tables = ["workflows", "workflow_events", "command_receipts", "outbox_jobs", "workflow_incidents"];
		const parts: string[] = [];
		for (const table of tables) {
			const rows = database.prepare(`select * from ${table} order by 1`).all();
			parts.push(`${table}:${JSON.stringify(rows)}`);
		}
		return parts.join("\n");
	} finally {
		database.close();
	}
}

test("reconcile delivers undelivered outbox after restart", async () => {
	await withRecoveryRuntime(
		async ({ databasePath, runtime, outbox }) => {
			const { workflowId } = await createPendingWorkflow(runtime);
			// Crash at drain_outbox.before — command commits but outbox is undelivered
			assert.throws(
				() =>
					runtime.executeCommand({
						workflowId,
						commandId: "cmd-start-crash",
						expectedWorkflowVersion: 0,
						type: "start",
						operator: OPERATOR,
					}),
				/crash point reached: drain_outbox\.before/,
			);
			runtime.close();
			const reopened = await openHeadlessWorkflowRuntime({
				databasePath,
				clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
				hashProvider: createHashProvider(),
				crashInjector: createCrashInjector(),
				outboxTransport: outbox,
			});
			try {
				const report = reopened.reconcile();
				assert.equal(report.databaseIntact, true);
				assert.equal(report.foreignKeysValid, true);
				assert.ok(report.outboxDelivered >= 1);
				const deliveries = outbox.deliveries();
				assert.ok(deliveries.some((d) => d.payload === "workflow_started"));
				// Command receipt persisted despite crash before outbox delivery
				const projection = reopened.getWorkflowProjection(workflowId);
				assert.ok(projection);
				assert.equal(projection.workflow.state, "running");
			} finally {
				reopened.close();
			}
		},
		{ crashPoints: ["drain_outbox.before"] },
	);
});

test("reconcile resets in-flight outbox without incrementing failures", async () => {
	await withRecoveryRuntime(
		async ({ databasePath, runtime, clock }) => {
			const { workflowId } = await createStartedWorkflow(runtime);
			runtime.processOutbox();
			clock.advance(60_000);
			const db1 = new Database(databasePath, { readonly: true });
			try {
				const job = db1
					.prepare("select delivery_failures, next_attempt_at from outbox_jobs where workflow_id = ?")
					.get(workflowId) as { delivery_failures: number; next_attempt_at: string };
				assert.equal(job.delivery_failures, 1);
				assert.ok(job.next_attempt_at);
			} finally {
				db1.close();
			}
			runtime.close();
			const reopened = await openHeadlessWorkflowRuntime({
				databasePath,
				clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
				hashProvider: createHashProvider(),
				crashInjector: createCrashInjector(),
				outboxTransport: createOutboxTransport(),
			});
			try {
				reopened.reconcile();
				const db2 = new Database(databasePath, { readonly: true });
				try {
					const job = db2
						.prepare("select delivery_failures, next_attempt_at from outbox_jobs where workflow_id = ?")
						.get(workflowId) as { delivery_failures: number; next_attempt_at: string | null };
					assert.equal(job.delivery_failures, 1);
					assert.equal(job.next_attempt_at, null);
				} finally {
					db2.close();
				}
			} finally {
				reopened.close();
			}
		},
		{ failFirst: 1 },
	);
});

test("reconcile is idempotent", async () => {
	await withRecoveryRuntime(async ({ runtime }) => {
		await createStartedWorkflow(runtime);
		const first = runtime.reconcile();
		const second = runtime.reconcile();
		assert.equal(second.outboxDelivered, 0);
		assert.equal(second.outboxExhausted, 0);
		assert.equal(second.incidentsCreated, 0);
		assert.equal(first.databaseIntact, second.databaseIntact);
	});
});

test("outbox delivery failure increments delivery_failures", async () => {
	await withRecoveryRuntime(
		async ({ databasePath, runtime, clock }) => {
			const { workflowId } = await createStartedWorkflow(runtime);
			runtime.processOutbox();
			clock.advance(60_000);
			const database = new Database(databasePath, { readonly: true });
			try {
				const job = database
					.prepare("select delivery_failures from outbox_jobs where workflow_id = ?")
					.get(workflowId) as { delivery_failures: number };
				assert.equal(job.delivery_failures, 1);
				const wf = database
					.prepare("select state from workflows where id = ?")
					.get(workflowId) as { state: string };
				assert.notEqual(wf.state, "failed");
			} finally {
				database.close();
			}
		},
		{ failFirst: 5 },
	);
});

test("outbox exhaustion creates incident and fails workflow", async () => {
	await withRecoveryRuntime(
		async ({ databasePath, runtime, clock }) => {
			const { workflowId } = await createStartedWorkflow(runtime);
			exhaustOutboxDelivery(runtime, clock);
			const database = new Database(databasePath, { readonly: true });
			try {
				const wf = database
					.prepare("select state, current_failure_code from workflows where id = ?")
					.get(workflowId) as { state: string; current_failure_code: string };
				assert.equal(wf.state, "failed");
				assert.equal(wf.current_failure_code, "outbox_exhausted");
			} finally {
				database.close();
			}
			const incident = queryIncident(databasePath, workflowId);
			assert.ok(incident);
			assert.equal(incident.incident_type, "outbox_exhausted");
			assert.equal(incident.failure_code, "outbox_exhausted");
			assert.equal(incident.status, "open");
		},
		{ failFirst: 5 },
	);
});

test("retry-recovery requeues the exhausted outbox job", async () => {
	await withRecoveryRuntime(
		async ({ databasePath, runtime, clock }) => {
			const { workflowId } = await createStartedWorkflow(runtime);
			exhaustOutboxDelivery(runtime, clock);
			const incident = queryIncident(databasePath, workflowId);
			assert.ok(incident);
			const receipt = runtime.executeCommand({
				workflowId,
				commandId: "cmd-retry-recovery",
				expectedWorkflowVersion: 2,
				type: "retry-recovery",
				payload: { incidentId: incident.id },
				operator: OPERATOR,
			});
			assert.equal(receipt.outcome, "accepted");
			assert.equal(receipt.httpStatus, 201);
			const projection = runtime.getWorkflowProjection(workflowId);
			assert.ok(projection);
			assert.equal(projection.workflow.state, "running");
			const resolved = queryIncident(databasePath, workflowId);
			assert.ok(resolved);
			assert.equal(resolved.status, "resolved");
			const database = new Database(databasePath, { readonly: true });
			try {
				const job = database
					.prepare("select delivery_failures, next_attempt_at, delivered_at from outbox_jobs where workflow_id = ?")
					.get(workflowId) as { delivery_failures: number; next_attempt_at: string | null; delivered_at: string | null };
				assert.equal(job.delivery_failures, 0);
				assert.equal(job.next_attempt_at, null);
				assert.ok(job.delivered_at);
			} finally {
				database.close();
			}
		},
		{ failFirst: 5 },
	);
});

test("retry-recovery rejects non-failed workflow", async () => {
	await withRecoveryRuntime(async ({ runtime }) => {
		const { workflowId } = await createStartedWorkflow(runtime);
		const receipt = runtime.executeCommand({
			workflowId,
			commandId: "cmd-retry-recovery",
			expectedWorkflowVersion: 1,
			type: "retry-recovery",
			payload: { incidentId: 999 },
			operator: OPERATOR,
		});
		assert.equal(receipt.outcome, "state_conflict");
		assert.equal(receipt.httpStatus, 409);
	});
});

test("retry-recovery rejects without valid incident", async () => {
	await withRecoveryRuntime(
		async ({ runtime, clock }) => {
			const { workflowId } = await createStartedWorkflow(runtime);
			exhaustOutboxDelivery(runtime, clock);
			const receipt = runtime.executeCommand({
				workflowId,
				commandId: "cmd-retry-recovery",
				expectedWorkflowVersion: 2,
				type: "retry-recovery",
				payload: { incidentId: 999 },
				operator: OPERATOR,
			});
			assert.equal(receipt.outcome, "business_rule_rejected");
			assert.equal(receipt.httpStatus, 422);
		},
		{ failFirst: 5 },
	);
});

test("Workflow Doctor reports healthy on clean database", async () => {
	await withRecoveryRuntime(async ({ runtime }) => {
		await createStartedWorkflow(runtime);
		const report = runtime.diagnose();
		assert.equal(report.overall, "healthy");
		for (const finding of report.findings) {
			assert.equal(finding.status, "pass", `${finding.check} should pass`);
		}
	});
});

test("Workflow Doctor detects invariant violation", async () => {
	await withRecoveryRuntime(async ({ databasePath, runtime }) => {
		await createStartedWorkflow(runtime);
		runtime.close();
		const database = new Database(databasePath);
		try {
			// Create a foreign key violation by inserting an orphan outbox job with FKs disabled
			database.pragma("foreign_keys = OFF");
			database
				.prepare("insert into outbox_jobs(workflow_id, event_seq, delivery_type, payload, created_at) values (99999, 1, 'workflow_event', 'orphan', '2026-01-01T00:00:00.000Z')")
				.run();
			database.pragma("foreign_keys = ON");
		} finally {
			database.close();
		}
		const reopened = await openHeadlessWorkflowRuntime({
			databasePath,
			clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
			hashProvider: createHashProvider(),
			crashInjector: createCrashInjector(),
			outboxTransport: createOutboxTransport(),
		});
		try {
			const report = reopened.diagnose();
			assert.equal(report.overall, "degraded");
			const fkCheck = report.findings.find((f) => f.check === "foreign_key_integrity");
			assert.ok(fkCheck);
			assert.equal(fkCheck.status, "fail");
		} finally {
			reopened.close();
		}
	});
});

test("Workflow Doctor is read-only", async () => {
	await withRecoveryRuntime(async ({ databasePath, runtime }) => {
		await createStartedWorkflow(runtime);
		const before = snapshotTables(databasePath);
		runtime.diagnose();
		const after = snapshotTables(databasePath);
		assert.equal(before, after);
	});
});
