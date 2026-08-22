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
import {
	openHeadlessWorkflowRuntime,
	type HeadlessWorkflowRuntime,
} from "./workflow/headless-runtime.js";
import { startOperatorServer, type OperatorServer } from "./workflow/operator-server.js";
import type { RequirementBaseline } from "./workflow/requirement.js";
import type { ArtifactEffectProposal, CriticReport, RoleResult } from "./workflow/role-result.js";
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
		body: JSON.stringify({ baseline: BASELINE }),
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


async function adoptPlan(runtime: HeadlessWorkflowRuntime, workflowId: number): Promise<void> {
	const result = await runtime.planWorkflow(workflowId, null);
	assert.equal(result.outcome, "adopted");
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

function scenarioContent(): unknown {
	return {
		schemaVersion: "artifact/scenario/v1",
		artifactKind: "scenario",
		summary: "Scenarios for points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		scenarios: [{ id: "sc1", title: "User redeems before expiry", actors: ["User"], preconditions: ["Points exist"], trigger: "Expiry reminder received", mainFlow: ["Open wallet", "Redeem points"], alternateFlows: [], expectedOutcome: "Points redeemed" }],
	};
}

function usecaseContent(): unknown {
	return {
		schemaVersion: "artifact/usecase/v1",
		artifactKind: "usecase",
		summary: "Use cases for points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		useCases: [{ id: "uc1", actor: "User", goal: "Redeem points before expiry", preconditions: ["Wallet active"], mainFlow: ["Receive reminder", "Redeem points"], alternativeFlows: [], postconditions: ["Points consumed"] }],
	};
}

function functionContent(): unknown {
	return {
		schemaVersion: "artifact/function/v1",
		artifactKind: "function",
		summary: "Functions for points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		functions: [{ id: "fn1", name: "Expiry scheduler", responsibility: "Expire points past threshold", inputs: ["points ledger"], outputs: ["expiry events"], businessRules: ["Expiry after 365 days"], acceptanceCriteria: ["Expired points are removed"] }],
	};
}

function architectureContent(): unknown {
	return {
		schemaVersion: "artifact/architecture/v1",
		artifactKind: "architecture",
		summary: "Architecture of points expiry solution",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		components: [{ id: "c1", name: "Expiry service", responsibility: "Schedule and execute expiry" }],
		relationships: [{ from: "c1", to: "Points ledger", interaction: "reads and writes balances" }],
		constraints: ["No downtime during expiry runs"],
		nonFunctionalRequirements: ["Expiry completes within the nightly window"],
		decisions: [],
	};
}

function dataContent(): unknown {
	return {
		schemaVersion: "artifact/data/v1",
		artifactKind: "data",
		summary: "Data model for points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		entities: [{ name: "points_ledger", purpose: "Track point balances and expiries", fields: ["id", "user_id", "balance", "expires_at"], lifecycle: "append-heavy with nightly expiry updates" }],
		relationships: ["points_ledger.user_id -> users.id"],
		migrationPlan: "Add expires_at column with backfill",
		rollbackPlan: "Drop expires_at column",
		privacyAndRetention: ["Expiry records retained for 90 days"],
	};
}

function apiContent(): unknown {
	return {
		schemaVersion: "artifact/api/v1",
		artifactKind: "api",
		summary: "API surface for points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		interfaces: [{ id: "api1", kind: "http", name: "GET /points", contract: "Returns balance with expiry dates", errors: ["404 not found"], compatibility: "Additive fields only" }],
		security: ["Operator token required"],
		versioning: "URL path versioning",
		testStrategy: ["Contract tests against the public surface"],
	};
}

function traceLink(runtime: HeadlessWorkflowRuntime, workflowId: number): { evidenceSnapshotId: number; sourceRef: { type: string; path: string } } {
	const snapshot = runtime.bindEvidenceSnapshot(workflowId, "sha256:repo-abc", { files: [] });
	return { evidenceSnapshotId: snapshot.id, sourceRef: { type: "code", path: "/src/analysis.ts" } };
}

function artifactEffect(
	runtime: HeadlessWorkflowRuntime,
	workflowId: number,
	kind: ArtifactEffectProposal["artifactKind"],
	content: unknown,
	links?: Array<{ evidenceSnapshotId: number; sourceRef: { type: string; path: string } }>,
): ArtifactEffectProposal {
	return {
		effectType: "artifact_revision",
		artifactKind: kind,
		logicalKey: kind,
		content,
		baseRevisionId: null,
		traceLinks: links ?? [traceLink(runtime, workflowId)],
	};
}

function publishTaskEffects(
	runtime: HeadlessWorkflowRuntime,
	workflowId: number,
	taskKey: string,
	taskRole: string,
	effects: ReadonlyArray<ArtifactEffectProposal>,
): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskKey, taskKey);
	assert.equal(begin.taskRole, taskRole);
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects,
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

function publishCriticReview(runtime: HeadlessWorkflowRuntime, databasePath: string, workflowId: number, coverKinds: readonly string[]): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskRole, "critic");
	const report: CriticReport = {
		schemaVersion: "critic-report/v1",
		workflowId,
		attemptId: begin.attemptId,
		coverageAttestation: {
			reviewTargets: coverKinds.map((kind) => ({ revisionId: getRevisionId(databasePath, kind), artifactKind: kind })),
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

function executeTemplateChain(runtime: HeadlessWorkflowRuntime, databasePath: string, workflowId: number): void {
	publishTaskEffects(runtime, workflowId, "analyze", "analysis-analyst", [artifactEffect(runtime, workflowId, "analysis", analysisContent())]);
	publishCriticReview(runtime, databasePath, workflowId, ["requirement", "analysis"]);
	publishTaskEffects(runtime, workflowId, "scenario", "scenario-analyst", [artifactEffect(runtime, workflowId, "scenario", scenarioContent())]);
	publishCriticReview(runtime, databasePath, workflowId, ["scenario"]);
	publishTaskEffects(runtime, workflowId, "usecase", "usecase-analyst", [artifactEffect(runtime, workflowId, "usecase", usecaseContent())]);
	publishCriticReview(runtime, databasePath, workflowId, ["usecase"]);
	publishTaskEffects(runtime, workflowId, "function", "function-analyst", [artifactEffect(runtime, workflowId, "function", functionContent())]);
	publishCriticReview(runtime, databasePath, workflowId, ["function"]);
	const links = [traceLink(runtime, workflowId)];
	publishTaskEffects(runtime, workflowId, "design", "design-architect", [
		artifactEffect(runtime, workflowId, "design", designContent(), links),
		artifactEffect(runtime, workflowId, "architecture", architectureContent(), links),
		artifactEffect(runtime, workflowId, "data", dataContent(), links),
		artifactEffect(runtime, workflowId, "api", apiContent(), links),
	]);
	publishCriticReview(runtime, databasePath, workflowId, ["design", "architecture", "data", "api"]);
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
		const runFrames = await collectSse(runResponse, (collected) => collected.filter((frame) => frame.event === "run-event").length >= 1);
		const runEvents = runFrames.filter((frame) => frame.event === "run-event");
		assert.deepEqual(runEvents.map((frame) => frame.id), ["1"]);
		const payloads = runEvents.map((frame) => JSON.parse(frame.data ?? "{}") as { type: string; payload: { role?: string } });
		assert.deepEqual(payloads.map((event) => event.type), ["plan_template_instantiated"]);
		const firstPayload = payloads[0].payload as { role: string };
		assert.equal(firstPayload.role, "engine");
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
		// Engine execution: deterministic plan-template instantiation, then the
		// full 10-task template chain (no orchestrator model call anywhere).
		await adoptPlan(context.runtime, workflowId);
		executeTemplateChain(context.runtime, context.databasePath, workflowId);

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

		// Run streams carry the engine execution facts: planning instantiates the
		// template deterministically (role engine); no model/token facts exist
		// because direct begin/completeAttempt runs make no model calls.
		const db = new Database(context.databasePath, { readonly: true });
		const runWithEvents = db.prepare("select run_id as id from run_events order by run_id limit 1").get() as { id: number } | undefined;
		db.close();
		assert.ok(runWithEvents);
		const runEvents = context.runtime.getRunEvents(runWithEvents.id, 0, 500);
		const templateEvent = runEvents.find((event) => event.type === "plan_template_instantiated");
		assert.ok(templateEvent, "run events must include the plan_template_instantiated event");
		const templatePayload = templateEvent.payload as { role: string };
		assert.equal(templatePayload.role, "engine");
		assert.ok(!runEvents.some((event) => event.type === "token"), "engine-direct planning emits no token facts");
	});
});
