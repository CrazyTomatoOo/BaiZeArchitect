import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createCrashInjector,
	createFixtureClock,
	createFixtureOperator,
	createHashProvider,
	createOutboxTransport,
} from "./testing/deterministic-fixtures.js";
import { ScriptedModelDriver } from "./testing/scripted-model-driver.js";
import {
	openHeadlessWorkflowRuntime,
	type HeadlessWorkflowRuntime,
} from "./workflow/headless-runtime.js";
import { startOperatorServer, type OperatorServer } from "./workflow/operator-server.js";
import type { PlanProposal, TaskProposal } from "./workflow/plan-types.js";
import type { RequirementBaseline } from "./workflow/requirement.js";
import type { CriticReport, RoleResult } from "./workflow/role-result.js";
import Database from "better-sqlite3";

const ADMIN = createFixtureOperator("admin");

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Expire unredeemed points",
	sourceRefs: [],
	title: "Points expiry",
	description: "Add expiry reminders and controlled compensation.",
};

interface ServerContext {
	server: OperatorServer;
	runtime: HeadlessWorkflowRuntime;
	workspaceId: number;
	databasePath: string;
}

async function withServer(run: (context: ServerContext) => Promise<void>): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), "operator-events-"));
	const databasePath = join(directory, "test.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(),
		outboxTransport: createOutboxTransport(),
	});
	const server = await startOperatorServer({
		runtime,
		operators: { "token-admin": ADMIN },
		sseHeartbeatMs: 25,
	});
	try {
		await run({
			server,
			runtime,
			databasePath,
			workspaceId: runtime.createWorkspace({ repoPath: "/repo", name: "repo" }),
		});
	} finally {
		await server.close();
		runtime.close();
		rmSync(directory, { recursive: true, force: true });
	}
}

async function bootstrap(url: string): Promise<string> {
	const response = await fetch(`${url}/api/session`, {
		method: "POST",
		headers: { authorization: "Bearer token-admin" },
	});
	assert.equal(response.status, 201);
	const setCookie = response.headers.get("set-cookie");
	assert.ok(setCookie);
	return setCookie.split(";")[0];
}

function putCommand(
	url: string,
	workflowId: number,
	commandId: string,
	body: unknown,
	cookie: string,
): Promise<Response> {
	return fetch(`${url}/api/workflows/${workflowId}/commands/${commandId}`, {
		method: "PUT",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify(body),
	});
}

async function createStartedWorkflow(
	context: ServerContext,
	cookie: string,
): Promise<{ requirementId: number; workflowId: number }> {
	const created = await fetch(`${context.server.url}/api/workspaces/${context.workspaceId}/requirements`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify(BASELINE),
	});
	assert.equal(created.status, 201);
	const body = (await created.json()) as { requirementId: number; workflowId: number };
	const started = await putCommand(
		context.server.url,
		body.workflowId,
		`start-${body.workflowId}`,
		{ type: "start", expectedWorkflowVersion: 0 },
		cookie,
	);
	assert.equal(started.status, 201);
	return body;
}

interface SseFrame {
	id?: string;
	event?: string;
	data?: string;
	comment?: boolean;
}

function parseSseFrames(text: string): SseFrame[] {
	const frames: SseFrame[] = [];
	for (const block of text.split("\n\n")) {
		const trimmed = block.trim();
		if (!trimmed) continue;
		if (trimmed.startsWith(":")) {
			frames.push({ comment: true });
			continue;
		}
		const frame: SseFrame = {};
		for (const line of block.split("\n")) {
			if (line.startsWith("id: ")) frame.id = line.slice(4);
			else if (line.startsWith("event: ")) frame.event = line.slice(7);
			else if (line.startsWith("data: ")) frame.data = line.slice(6);
		}
		frames.push(frame);
	}
	return frames;
}

async function collectSse(
	response: Response,
	until: (frames: SseFrame[]) => boolean,
	timeoutMs = 3000,
): Promise<SseFrame[]> {
	assert.equal(response.status, 200);
	assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
	const body = response.body;
	assert.ok(body);
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let text = "";
	const deadline = Date.now() + timeoutMs;
	try {
		while (Date.now() < deadline) {
			const result = await Promise.race([
				reader.read(),
				new Promise<null>((resolve) => {
					setTimeout(() => resolve(null), 50);
				}),
			]);
			if (result === null) {
				if (until(parseSseFrames(text))) break;
				continue;
			}
			if (result.done) break;
			text += decoder.decode(result.value, { stream: true });
			if (until(parseSseFrames(text))) break;
		}
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	return parseSseFrames(text);
}

function taskPlan(): TaskProposal[] {
	return [
		{
			key: "analyze-req",
			kind: "analyze",
			role: "analyst",
			objective: "Produce analysis",
			dependsOn: [],
			inputs: [],
			expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }],
			completionPolicyRef: "analysis/v1",
			maxAttempts: 3,
		},
		{
			key: "design-sol",
			kind: "design",
			role: "architect",
			objective: "Produce design",
			dependsOn: ["analyze-req"],
			inputs: [{ type: "task_output", taskKey: "analyze-req", artifactKind: "analysis", purpose: "design input" }],
			expectedArtifactEffects: [{ kind: "design", operation: "create_or_revise" }],
			completionPolicyRef: "design/v1",
			maxAttempts: 3,
		},
		{
			key: "review-all",
			kind: "review",
			role: "critic",
			objective: "Review artifacts",
			dependsOn: ["design-sol"],
			inputs: [{ type: "task_output", taskKey: "design-sol", artifactKind: "design", purpose: "review" }],
			expectedArtifactEffects: [],
			completionPolicyRef: "review/v1",
			maxAttempts: 3,
		},
	];
}

function planProposal(runtime: HeadlessWorkflowRuntime, workflowId: number): PlanProposal {
	const projection = runtime.getWorkflowProjection(workflowId);
	assert.ok(projection);
	return {
		schemaVersion: "plan-proposal/v1",
		base: {
			workflowId,
			workflowVersion: projection.workflow.version,
			basePlanRevisionId: projection.workflow.currentPlanRevisionId,
			planningContextDigest: runtime.getPlanningContextDigest(workflowId),
		},
		objective: "Plan",
		tasks: taskPlan(),
		rationale: "rationale",
	};
}

async function adoptPlan(runtime: HeadlessWorkflowRuntime, workflowId: number): Promise<void> {
	const proposal = planProposal(runtime, workflowId);
	const driver = new ScriptedModelDriver([
		{
			role: "orchestrator",
			contextDigest: proposal.base.planningContextDigest,
			orderedToolCalls: [],
			structuredResult: proposal,
			modelUsage: { inputTokens: 11, outputTokens: 22 },
		},
	]);
	const result = await runtime.planWorkflow(workflowId, driver);
	assert.equal(result.outcome, "adopted");
	driver.assertExhausted();
}

function analysisContent(): unknown {
	const dimension = { status: "no", rationale: "rationale" };
	return {
		schemaVersion: "artifact/analysis/v1",
		artifactKind: "analysis",
		summary: "Analysis of points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		goals: ["Understand expiry"],
		nonGoals: ["Design solution"],
		constraints: ["Backward compatible"],
		acceptanceCriteria: ["Tests pass"],
		impactProfile: { process: dimension, actors: dimension, behavior: dimension, architecture: dimension, data: dimension, api: dimension },
		openQuestions: [],
	};
}

function designContent(): unknown {
	return {
		schemaVersion: "artifact/design/v1",
		artifactKind: "design",
		summary: "Design of points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		changeUnits: [{ id: "cu1", area: "points", change: "Add expiry", rationale: "rule", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }] }],
		alternatives: ["Do nothing"],
		failureHandling: ["Retry"],
		testStrategy: ["Unit tests"],
		implementationOrder: ["Sequential"],
		rolloutStrategy: "Canary",
		rollbackStrategy: "Revert",
	};
}

function traceLink(runtime: HeadlessWorkflowRuntime, workflowId: number): { evidenceSnapshotId: number; sourceRef: { type: string; path: string } } {
	const snapshot = runtime.bindEvidenceSnapshot(workflowId, "sha256:repo-abc", { files: [] });
	return { evidenceSnapshotId: snapshot.id, sourceRef: { type: "code", path: "/src/analysis.ts" } };
}

function publishEffect(runtime: HeadlessWorkflowRuntime, workflowId: number, role: string, kind: "analysis" | "design", content: unknown): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskRole, role);
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [
			{
				effectType: "artifact_revision",
				artifactKind: kind,
				logicalKey: kind,
				content,
				baseRevisionId: null,
				traceLinks: [traceLink(runtime, workflowId)],
			},
		],
	};
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

function getRevisionId(databasePath: string, kind: string): number {
	const db = new Database(databasePath, { readonly: true });
	try {
		const row = db
			.prepare("select ar.id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.kind = ? order by ar.id desc limit 1")
			.get(kind) as { id: number } | undefined;
		assert.ok(row);
		return row.id;
	} finally {
		db.close();
	}
}

function publishCriticReview(runtime: HeadlessWorkflowRuntime, databasePath: string, workflowId: number): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskRole, "critic");
	const report: CriticReport = {
		schemaVersion: "critic-report/v1",
		workflowId,
		attemptId: begin.attemptId,
		coverageAttestation: {
			reviewTargets: ["requirement", "analysis", "design"].map((kind) => ({ revisionId: getRevisionId(databasePath, kind), artifactKind: kind })),
			complete: true,
		},
		findings: [],
	};
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [],
		criticReport: report,
	};
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

function latestRunId(databasePath: string): number {
	const db = new Database(databasePath, { readonly: true });
	try {
		const row = db.prepare("select id from runs order by id desc limit 1").get() as { id: number } | undefined;
		assert.ok(row);
		return row.id;
	} finally {
		db.close();
	}
}

test("event stream reads use explicit external error semantics", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		const unauthStream = await fetch(`${context.server.url}/api/workflows/${workflowId}/events/stream`);
		assert.equal(unauthStream.status, 401);
		const unknownWorkflow = await fetch(`${context.server.url}/api/workflows/9999/events/stream`, { headers: { cookie } });
		assert.equal(unknownWorkflow.status, 404);
		const unknownRun = await fetch(`${context.server.url}/api/runs/9999/events/stream`, { headers: { cookie } });
		assert.equal(unknownRun.status, 404);
		const badCursor = await fetch(`${context.server.url}/api/workflows/${workflowId}/events/stream?after=abc`, { headers: { cookie } });
		assert.equal(badCursor.status, 400);
		const badLimit = await fetch(`${context.server.url}/api/workflows/${workflowId}/events/stream?limit=501`, { headers: { cookie } });
		assert.equal(badLimit.status, 400);
		const zeroLimit = await fetch(`${context.server.url}/api/workflows/${workflowId}/events/stream?limit=0`, { headers: { cookie } });
		assert.equal(zeroLimit.status, 400);
		const outOfRange = await fetch(`${context.server.url}/api/workflows/${workflowId}/events/stream?after=999`, { headers: { cookie } });
		assert.equal(outOfRange.status, 416);
		const rangeBody = (await outOfRange.json()) as { error: string; watermark: number };
		assert.equal(rangeBody.error, "cursor_out_of_range");
		assert.equal(rangeBody.watermark, 2);
	});
});

test("workflow SSE replays catch-up then streams live events without loss or duplication", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		const stream = fetch(`${context.server.url}/api/workflows/${workflowId}/events/stream?after=0`, { headers: { cookie } });
		const response = await stream;
		// Live commands issued while the stream is open must be buffered/flushed in order.
		const projection = (await (await fetch(`${context.server.url}/api/workflows/${workflowId}`, { headers: { cookie } })).json()) as { workflow: { version: number } };
		const paused = await putCommand(context.server.url, workflowId, "pause-1", { type: "pause", expectedWorkflowVersion: projection.workflow.version }, cookie);
		assert.equal(paused.status, 201);
		const resumed = await putCommand(context.server.url, workflowId, "resume-1", { type: "resume", expectedWorkflowVersion: projection.workflow.version + 1 }, cookie);
		assert.equal(resumed.status, 201);
		const frames = await collectSse(response, (collected) => collected.filter((frame) => frame.event === "workflow-event").length >= 4);
		const events = frames.filter((frame) => frame.event === "workflow-event");
		assert.equal(events.length, 4);
		assert.deepEqual(events.map((frame) => frame.id), ["1", "2", "3", "4"]);
		const payloads = events.map((frame) => JSON.parse(frame.data ?? "{}") as { seq: number; type: string });
		assert.deepEqual(payloads.map((event) => event.seq), [1, 2, 3, 4]);
		assert.deepEqual(payloads.map((event) => event.type), ["workflow_created", "workflow_started", "workflow_paused", "workflow_resumed"]);
	});
});

test("heartbeat frames do not consume sequence and Last-Event-ID takes precedence over after", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		const response = await fetch(`${context.server.url}/api/workflows/${workflowId}/events/stream?after=0`, {
			headers: { cookie, "last-event-id": "1" },
		});
		// Issue a live command after replay and at least one heartbeat interval.
		const pauseAfterDelay = (async () => {
			await new Promise((resolve) => {
				setTimeout(resolve, 120);
			});
			const projection = (await (await fetch(`${context.server.url}/api/workflows/${workflowId}`, { headers: { cookie } })).json()) as { workflow: { version: number } };
			const paused = await putCommand(context.server.url, workflowId, "pause-hb", { type: "pause", expectedWorkflowVersion: projection.workflow.version }, cookie);
			assert.equal(paused.status, 201);
		})();
		const frames = await collectSse(response, (collected) => {
			const events = collected.filter((frame) => frame.event === "workflow-event");
			return events.length >= 2 && collected.some((frame) => frame.comment);
		});
		await pauseAfterDelay;
		const allEvents = frames.filter((frame) => frame.event === "workflow-event");
		// Last-Event-ID: 1 wins over after=0 — replay starts at seq 2; the heartbeat
		// comment consumed no sequence, so the live pause event continues at seq 3.
		assert.deepEqual(allEvents.map((frame) => frame.id), ["2", "3"]);
		assert.ok(frames.some((frame) => frame.comment), "heartbeat comment frame expected");
	});
});

test("run SSE streams run-event frames and token facts never enter the workflow audit stream", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		await adoptPlan(context.runtime, workflowId);
		const runId = latestRunId(context.databasePath);
		const runResponse = await fetch(`${context.server.url}/api/runs/${runId}/events/stream?after=0`, { headers: { cookie } });
		const runFrames = await collectSse(runResponse, (collected) => collected.filter((frame) => frame.event === "run-event").length >= 3);
		const runEvents = runFrames.filter((frame) => frame.event === "run-event");
		assert.deepEqual(runEvents.map((frame) => frame.id), ["1", "2", "3"]);
		const types = runEvents.map((frame) => (JSON.parse(frame.data ?? "{}") as { type: string }).type);
		assert.deepEqual(types, ["model_call_started", "model_tokens", "model_result"]);
		const workflowEvents = context.runtime.getWorkflowEvents(workflowId, 0, 500);
		assert.ok(!workflowEvents.some((event) => event.type.startsWith("model_")), "workflow audit stream must not contain model/token facts");
	});
});

test("replayed commandId appends no duplicate domain events", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		const first = await putCommand(context.server.url, workflowId, "pause-dup", { type: "pause", expectedWorkflowVersion: 1 }, cookie);
		assert.equal(first.status, 201);
		const firstReceipt = (await first.json()) as { workflowVersion: number; lastEventSeq: number };
		const replay = await putCommand(context.server.url, workflowId, "pause-dup", { type: "pause", expectedWorkflowVersion: 1 }, cookie);
		assert.equal(replay.status, 201);
		const replayReceipt = (await replay.json()) as { workflowVersion: number; lastEventSeq: number };
		assert.deepEqual(replayReceipt, firstReceipt);
		const events = context.runtime.getWorkflowEvents(workflowId, 0, 500);
		assert.equal(events.filter((event) => event.type === "workflow_paused").length, 1);
	});
});

test("two concurrent commands expose only the persisted winner plus the failed receipt", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		const [winner, loser] = await Promise.all([
			putCommand(context.server.url, workflowId, "pause-a", { type: "pause", expectedWorkflowVersion: 1 }, cookie),
			putCommand(context.server.url, workflowId, "pause-b", { type: "pause", expectedWorkflowVersion: 1 }, cookie),
		]);
		const statuses = [winner.status, loser.status].sort((left, right) => left - right);
		assert.deepEqual(statuses, [201, 409]);
		const winnerReceipt = (await winner.json()) as { commandId: string; outcome: string };
		const loserReceipt = (await loser.json()) as { commandId: string; outcome: string };
		const receipts = [winnerReceipt, loserReceipt];
		assert.equal(receipts.filter((receipt) => receipt.outcome === "accepted").length, 1);
		assert.equal(receipts.filter((receipt) => receipt.outcome === "version_conflict").length, 1);
		const events = context.runtime.getWorkflowEvents(workflowId, 0, 500);
		assert.equal(events.filter((event) => event.type === "workflow_paused").length, 1);
	});
});

test("create to archive through public API, dual SSE, receipts, and projection", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		// Catch-up replays from seq 0, so opening the stream after creation loses nothing.
		const workflowStreamResponse = await fetch(`${context.server.url}/api/workflows/${workflowId}/events/stream?after=0`, { headers: { cookie } });
		// Engine execution: plan, analyze, design, review (model-driving is engine-internal).
		await adoptPlan(context.runtime, workflowId);
		publishEffect(context.runtime, workflowId, "analyst", "analysis", analysisContent());
		publishEffect(context.runtime, workflowId, "architect", "design", designContent());
		publishCriticReview(context.runtime, context.databasePath, workflowId);

		const built = context.runtime.buildApprovalPacket(workflowId);
		assert.equal(built.ready, true);
		assert.ok(built.digest);

		const projectionBeforeApprove = (await (await fetch(`${context.server.url}/api/workflows/${workflowId}`, { headers: { cookie } })).json()) as { workflow: { state: string; version: number } };
		assert.equal(projectionBeforeApprove.workflow.state, "ready_to_archive");

		const approved = await putCommand(
			context.server.url,
			workflowId,
			"approve-final",
			{ type: "approve-packet", expectedWorkflowVersion: projectionBeforeApprove.workflow.version, payload: { packetDigest: built.digest } },
			cookie,
		);
		assert.equal(approved.status, 201);
		const receipt = (await approved.json()) as { outcome: string; workflowVersion: number; lastEventSeq: number };
		assert.equal(receipt.outcome, "accepted");

		// Projection confirms actual state after the accepted receipt.
		const projection = context.runtime.getWorkflowProjection(workflowId);
		assert.equal(projection?.workflow.state, "archived");

		// The workflow stream replays the full contiguous governance history.
		const frames = await collectSse(workflowStreamResponse, (collected) => {
			const events = collected.filter((frame) => frame.event === "workflow-event");
			return events.some((frame) => (frame.data ?? "").includes("workflow_archived"));
		});
		const events = frames.flatMap((frame) => {
			if (frame.event !== "workflow-event") return [];
			return [JSON.parse(frame.data ?? "{}") as { seq: number; type: string }];
		});
		const seqs = events.map((event) => event.seq);
		assert.deepEqual(seqs, Array.from({ length: seqs.length }, (_, index) => index + 1), "workflow seq must be contiguous from 1");
		assert.equal(events[0].type, "workflow_created");
		assert.equal(events[events.length - 1].type, "workflow_archived");
		assert.ok(events.some((event) => event.type === "packet_approved"));
		assert.ok(!events.some((event) => event.type.startsWith("model_")), "no token facts in workflow audit");

		// Run streams carry the model execution facts separately (the planning run
		// executed a real model call; direct begin/completeAttempt runs do not).
		const db = new Database(context.databasePath, { readonly: true });
		const runWithEvents = db.prepare("select run_id as id from run_events order by run_id limit 1").get() as { id: number } | undefined;
		db.close();
		assert.ok(runWithEvents);
		const runEvents = context.runtime.getRunEvents(runWithEvents.id, 0, 500);
		assert.ok(runEvents.some((event) => event.type === "model_tokens"));
	});
});
