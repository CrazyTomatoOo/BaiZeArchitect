import assert from "node:assert/strict";
import Database from "better-sqlite3";
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
import type { CriticReport, RoleResult, TraceLinkProposal } from "./workflow/role-result.js";

const ADMIN = createFixtureOperator("admin");
const TIMESTAMP = "2026-08-12T10:00:00.000Z";

function baseline(title = "Read model requirement"): RequirementBaseline {
	return {
		schemaVersion: "artifact/requirement/v1",
		artifactKind: "requirement",
		summary: title,
		sourceRefs: [],
		title,
		description: "Created for read model tests.",
	};
}

interface ReadContext {
	server: OperatorServer;
	runtime: HeadlessWorkflowRuntime;
	workspaceId: number;
	databasePath: string;
	cookie: string;
}

async function withReadServer(run: (context: ReadContext) => Promise<void>): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), "operator-reads-"));
	const databasePath = join(directory, "test.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock(TIMESTAMP),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(),
		outboxTransport: createOutboxTransport(),
	});
	const server = await startOperatorServer({ runtime, operators: { "token-admin": ADMIN } });
	try {
		const session = await fetch(`${server.url}/api/session`, {
			method: "POST",
			headers: { authorization: "Bearer token-admin" },
		});
		assert.equal(session.status, 201);
		const cookie = (session.headers.get("set-cookie") as string).split(";")[0];
		await run({
			server,
			runtime,
			workspaceId: runtime.createWorkspace({ repoPath: "/repo", name: "repo" }),
			databasePath,
			cookie,
		});
	} finally {
		await server.close();
		runtime.close();
		rmSync(directory, { recursive: true, force: true });
	}
}

async function get(context: ReadContext, path: string): Promise<Response> {
	return fetch(`${context.server.url}${path}`, { headers: { cookie: context.cookie } });
}

function putCommand(
	context: ReadContext,
	workflowId: number,
	commandId: string,
	body: unknown,
): Promise<Response> {
	return fetch(`${context.server.url}/api/workflows/${workflowId}/commands/${commandId}`, {
		method: "PUT",
		headers: { "content-type": "application/json", cookie: context.cookie },
		body: JSON.stringify(body),
	});
}

async function createStartedWorkflow(context: ReadContext, title = "Read model requirement"): Promise<{ requirementId: number; workflowId: number }> {
	const created = await fetch(`${context.server.url}/api/workspaces/${context.workspaceId}/requirements`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie: context.cookie },
		body: JSON.stringify({ baseline: baseline(title) }),
	});
	assert.equal(created.status, 201);
	const body = (await created.json()) as { requirementId: number; workflowId: number };
	const started = await putCommand(context, body.workflowId, `start-${body.workflowId}`, { type: "start", expectedWorkflowVersion: 0 });
	assert.equal(started.status, 201);
	return body;
}

function analysisContent(): unknown {
	const dimension = { status: "no", rationale: "rationale" };
	return {
		schemaVersion: "artifact/analysis/v1",
		artifactKind: "analysis",
		summary: "Analysis",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		goals: ["g"],
		nonGoals: ["n"],
		constraints: ["c"],
		acceptanceCriteria: ["a"],
		impactProfile: { process: dimension, actors: dimension, behavior: dimension, architecture: dimension, data: dimension, api: dimension },
		openQuestions: [],
	};
}

function designContent(): unknown {
	return {
		schemaVersion: "artifact/design/v1",
		artifactKind: "design",
		summary: "Design",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		changeUnits: [{ id: "cu1", area: "points", change: "Add expiry", rationale: "rule", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }] }],
		alternatives: ["none"],
		failureHandling: ["retry"],
		testStrategy: ["unit"],
		implementationOrder: ["seq"],
		rolloutStrategy: "canary",
		rollbackStrategy: "revert",
	};
}

function standardTasks(): TaskProposal[] {
	return [
		{ key: "analyze-req", kind: "analyze", role: "analyst", objective: "Produce analysis", dependsOn: [], inputs: [], expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }], completionPolicyRef: "analysis/v1", maxAttempts: 3 },
		{ key: "design-sol", kind: "design", role: "architect", objective: "Produce design", dependsOn: ["analyze-req"], inputs: [{ type: "task_output", taskKey: "analyze-req", artifactKind: "analysis", purpose: "design input" }], expectedArtifactEffects: [{ kind: "design", operation: "create_or_revise" }], completionPolicyRef: "design/v1", maxAttempts: 3 },
		{ key: "review-all", kind: "review", role: "critic", objective: "Review artifacts", dependsOn: ["design-sol"], inputs: [{ type: "task_output", taskKey: "design-sol", artifactKind: "design", purpose: "review" }], expectedArtifactEffects: [], completionPolicyRef: "review/v1", maxAttempts: 3 },
	];
}

async function adoptPlan(runtime: HeadlessWorkflowRuntime, workflowId: number, tasks: TaskProposal[]): Promise<void> {
	const projection = runtime.getWorkflowProjection(workflowId);
	assert.ok(projection);
	const contextDigest = runtime.getPlanningContextDigest(workflowId);
	const proposal: PlanProposal = {
		schemaVersion: "plan-proposal/v1",
		base: { workflowId, workflowVersion: projection.workflow.version, basePlanRevisionId: projection.workflow.currentPlanRevisionId, planningContextDigest: contextDigest },
		objective: "Plan",
		tasks,
		rationale: "rationale",
	};
	const driver = new ScriptedModelDriver([
		{ role: "orchestrator", contextDigest, orderedToolCalls: [], structuredResult: proposal, modelUsage: { provider: "test", modelId: "test", inputTokens: 10, outputTokens: 20 } },
	]);
	const result = await runtime.planWorkflow(workflowId, driver);
	assert.equal(result.outcome, "adopted");
	driver.assertExhausted();
}

function setupEvidence(runtime: HeadlessWorkflowRuntime, workflowId: number): TraceLinkProposal {
	const snapshot = runtime.bindEvidenceSnapshot(workflowId, `sha256:repo-${workflowId}`, { files: [] });
	return { evidenceSnapshotId: snapshot.id, sourceRef: { type: "code", path: "/src/a.ts" } };
}

function executeAnalystTask(runtime: HeadlessWorkflowRuntime, workflowId: number): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskRole, "analyst");
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [{ effectType: "artifact_revision", artifactKind: "analysis", logicalKey: "analysis", content: analysisContent(), baseRevisionId: null, traceLinks: [setupEvidence(runtime, workflowId)] }],
	};
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

function executeArchitectTask(runtime: HeadlessWorkflowRuntime, workflowId: number): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskRole, "architect");
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [{ effectType: "artifact_revision", artifactKind: "design", logicalKey: "design", content: designContent(), baseRevisionId: null, traceLinks: [setupEvidence(runtime, workflowId)] }],
	};
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

function getRevisionId(databasePath: string, kind: string): number {
	const db = new Database(databasePath, { readonly: true });
	try {
		const row = db.prepare("select ar.id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.kind = ? order by ar.id desc limit 1").get(kind) as { id: number } | undefined;
		assert.ok(row, `${kind} revision should exist`);
		return row.id;
	} finally {
		db.close();
	}
}

function executeCriticTask(runtime: HeadlessWorkflowRuntime, databasePath: string, workflowId: number): void {
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
	const result: RoleResult = { schemaVersion: "role-result/v1", workflowId, attemptId: begin.attemptId, effects: [], criticReport: report };
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

test("session read returns the server-registered operator identity", async () => {
	await withReadServer(async (context) => {
		const response = await get(context, "/api/session");
		assert.equal(response.status, 200);
		const body = (await response.json()) as { actorRef: string; capabilities: readonly string[] };
		assert.equal(body.actorRef, ADMIN.actorRef);
		assert.deepEqual(body.capabilities, ADMIN.capabilities);
	});
});

test("reads reject unauthenticated requests", async () => {
	await withReadServer(async (context) => {
		for (const path of ["/api/session", "/api/requirements?workspaceId=1", "/api/workflows/1", "/api/assets?workspaceId=1"]) {
			const response = await fetch(`${context.server.url}${path}`);
			assert.equal(response.status, 401, path);
		}
	});
});

test("requirement list returns workflow summaries in stable order", async () => {
	await withReadServer(async (context) => {
		const first = await createStartedWorkflow(context, "First");
		const second = await createStartedWorkflow(context, "Second");
		const response = await get(context, `/api/requirements?workspaceId=${context.workspaceId}`);
		assert.equal(response.status, 200);
		const body = (await response.json()) as { requirements: Array<{ requirementId: number; title: string; workflow: { id: number; state: string; version: number; lastEventSeq: number } }> };
		assert.deepEqual(body.requirements.map((entry) => entry.requirementId), [first.requirementId, second.requirementId]);
		assert.equal(body.requirements[0].workflow.id, first.workflowId);
		assert.equal(body.requirements[0].workflow.state, "running");
		assert.equal(body.requirements[0].workflow.version, 1);
		const missing = await get(context, "/api/requirements?workspaceId=9999");
		assert.equal(missing.status, 404);
	});
});

test("requirement detail returns the current baseline and workflow link", async () => {
	await withReadServer(async (context) => {
		const { requirementId, workflowId } = await createStartedWorkflow(context);
		const response = await get(context, `/api/requirements/${requirementId}`);
		assert.equal(response.status, 200);
		const body = (await response.json()) as { id: number; workflowId: number; currentRevision: { revisionNo: number; content: { title: string } } };
		assert.equal(body.id, requirementId);
		assert.equal(body.workflowId, workflowId);
		assert.equal(body.currentRevision.revisionNo, 1);
		assert.equal(body.currentRevision.content.title, "Read model requirement");
		const missing = await get(context, "/api/requirements/9999");
		assert.equal(missing.status, 404);
	});
});

test("bounded projection embeds current state without events or snapshot content", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		await adoptPlan(context.runtime, workflowId, standardTasks());
		executeAnalystTask(context.runtime, workflowId);
		const response = await get(context, `/api/workflows/${workflowId}`);
		assert.equal(response.status, 200);
		const body = (await response.json()) as Record<string, any>;
		assert.equal(body.workflow.id, workflowId);
		assert.equal(body.workflow.state, "running");
		assert.equal(typeof body.workflow.version, "number");
		assert.equal(typeof body.workflow.lastEventSeq, "number");
		assert.deepEqual(Object.keys(body.workflow.policyBundle).sort(), ["digest", "documentId"]);
		assert.equal("events" in body, false, "bounded projection must not embed the event stream");
		assert.equal(body.currentPlan.revisionNo, 1);
		assert.deepEqual(body.tasks.map((task: { key: string }) => task.key), ["analyze-req", "design-sol", "review-all"]);
		assert.equal(body.tasks[0].status, "completed");
		assert.equal(body.tasks[0].latestAttempt.status, "succeeded");
		assert.equal(body.tasks[1].latestAttempt, null);
		assert.equal(body.activeClaim, null);
		assert.equal(body.activeRun, null);
		assert.deepEqual(body.openGates, []);
		assert.equal(body.currentPacket, null);
		assert.equal(body.currentIncident, null);
		assert.ok(Array.isArray(body.readiness.checks), "readiness checks are embedded");
		assert.equal("content" in body.requirement.currentRevision, false, "bounded projection carries digests, not content");
		const missing = await get(context, "/api/workflows/9999");
		assert.equal(missing.status, 404);
	});
});

test("projection stays bounded to the current plan after replanning", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		await adoptPlan(context.runtime, workflowId, standardTasks());
		executeAnalystTask(context.runtime, workflowId);
		const projection = context.runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		const replacement: PlanProposal = {
			schemaVersion: "plan-proposal/v1",
			base: { workflowId, workflowVersion: projection.workflow.version, basePlanRevisionId: projection.workflow.currentPlanRevisionId, planningContextDigest: context.runtime.getPlanningContextDigest(workflowId) },
			objective: "Replacement",
			tasks: [
				{ key: "analyze-2", kind: "analyze", role: "analyst", objective: "Re-analyze", dependsOn: [], inputs: [], expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }], completionPolicyRef: "analysis/v1", maxAttempts: 3 },
			],
			rationale: "replan",
		};
		const replaced = await putCommand(context, workflowId, "replace-1", {
			type: "replace-plan",
			expectedWorkflowVersion: projection.workflow.version,
			payload: { proposal: replacement, reason: "narrow scope" },
		});
		assert.equal(replaced.status, 201);
		const response = await get(context, `/api/workflows/${workflowId}`);
		const body = (await response.json()) as Record<string, any>;
		assert.equal(body.currentPlan.revisionNo, 2);
		assert.deepEqual(body.tasks.map((task: { key: string }) => task.key), ["analyze-2"], "superseded plan tasks are not embedded");
		const oldPlan = await get(context, `/api/plan-revisions/${projection.workflow.currentPlanRevisionId}`);
		assert.equal(oldPlan.status, 200, "older plan revisions remain readable through the detail endpoint");
		const oldPlanBody = (await oldPlan.json()) as { revisionNo: number; status: string };
		assert.equal(oldPlanBody.revisionNo, 1);
		assert.equal(oldPlanBody.status, "superseded");
	});
});

test("plan revision detail preserves the immutable proposal and provenance", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		await adoptPlan(context.runtime, workflowId, standardTasks());
		const projection = context.runtime.getWorkflowProjection(workflowId);
		const planRevisionId = projection?.workflow.currentPlanRevisionId as number;
		const response = await get(context, `/api/plan-revisions/${planRevisionId}`);
		assert.equal(response.status, 200);
		const body = (await response.json()) as Record<string, any>;
		assert.equal(body.id, planRevisionId);
		assert.equal(body.revisionNo, 1);
		assert.equal(body.status, "active");
		assert.equal(typeof body.proposalDocumentId, "number");
		assert.equal(typeof body.proposalDigest, "string");
		assert.equal(typeof body.planningAttemptId, "number");
		assert.deepEqual(body.proposal.tasks.map((task: { key: string }) => task.key), ["analyze-req", "design-sol", "review-all"]);
		const missing = await get(context, "/api/plan-revisions/9999");
		assert.equal(missing.status, 404);
	});
});

test("task, attempts, attempt and run details link the execution chain", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		await adoptPlan(context.runtime, workflowId, standardTasks());
		executeAnalystTask(context.runtime, workflowId);
		const projection = (await (await get(context, `/api/workflows/${workflowId}`)).json()) as Record<string, any>;
		const taskId = projection.tasks[0].id as number;
		const task = (await (await get(context, `/api/tasks/${taskId}`)).json()) as Record<string, any>;
		assert.equal(task.key, "analyze-req");
		assert.equal(task.kind, "analyze");
		assert.equal(task.role, "analyst");
		assert.equal(task.status, "completed");
		assert.deepEqual(task.expectedArtifactEffects, [{ kind: "analysis", operation: "create_or_revise" }]);
		const attempts = (await (await get(context, `/api/tasks/${taskId}/attempts`)).json()) as { attempts: Array<{ id: number; attemptNo: number; status: string }> };
		assert.equal(attempts.attempts.length, 1);
		assert.equal(attempts.attempts[0].attemptNo, 1);
		assert.equal(attempts.attempts[0].status, "succeeded");
		const attempt = (await (await get(context, `/api/attempts/${attempts.attempts[0].id}`)).json()) as Record<string, any>;
		assert.equal(attempt.status, "succeeded");
		assert.equal(typeof attempt.contextManifest.documentId, "number");
		assert.equal(typeof attempt.contextManifest.digest, "string");
		assert.equal(typeof attempt.roleContract.documentId, "number");
		assert.equal(attempt.effects.length, 1);
		assert.equal(attempt.effects[0].state, "published");
		assert.equal(typeof attempt.effects[0].publishedArtifactRevisionId, "number");
		const run = (await (await get(context, `/api/runs/${attempt.run.id}`)).json()) as Record<string, any>;
		assert.equal(run.status, "completed");
		assert.equal(run.attemptId, attempt.id);
		assert.equal(run.workflowId, workflowId);
		assert.equal(typeof run.sessionId, "string");
		const missing = await get(context, "/api/attempts/9999");
		assert.equal(missing.status, 404);
	});
});

test("command receipt read returns the persisted receipt with the server-registered actor", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		const response = await get(context, `/api/workflows/${workflowId}/commands/start-${workflowId}`);
		assert.equal(response.status, 200);
		const body = (await response.json()) as Record<string, any>;
		assert.equal(body.commandId, `start-${workflowId}`);
		assert.equal(body.commandType, "start");
		assert.equal(body.outcome, "accepted");
		assert.equal(body.httpStatus, 201);
		assert.equal(body.actorRef, ADMIN.actorRef, "actor comes from the trusted session registry");
		assert.deepEqual(body.capabilities, ADMIN.capabilities);
		const missing = await get(context, `/api/workflows/${workflowId}/commands/nope`);
		assert.equal(missing.status, 404);
	});
});

test("projection versions feed directly into command expected versions", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		const projection = (await (await get(context, `/api/workflows/${workflowId}`)).json()) as Record<string, any>;
		const paused = await putCommand(context, workflowId, "pause-1", { type: "pause", expectedWorkflowVersion: projection.workflow.version });
		assert.equal(paused.status, 201);
	});
});

test("approval packet detail exposes content and current validity", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		await adoptPlan(context.runtime, workflowId, standardTasks());
		executeAnalystTask(context.runtime, workflowId);
		executeArchitectTask(context.runtime, workflowId);
		executeCriticTask(context.runtime, context.databasePath, workflowId);
		const built = context.runtime.buildApprovalPacket(workflowId);
		assert.equal(built.ready, true);
		const packetId = built.packetId as number;
		const detail = (await (await get(context, `/api/approval-packets/${packetId}`)).json()) as Record<string, any>;
		assert.equal(detail.id, packetId);
		assert.equal(detail.digest, built.digest);
		assert.equal(detail.status, "current");
		assert.equal(detail.valid, true);
		assert.ok(Array.isArray(detail.content.artifacts), "full packet content is embedded in the detail read");
		const projection = context.runtime.getWorkflowProjection(workflowId);
		const rejected = await putCommand(context, workflowId, "reject-packet-1", {
			type: "reject-packet",
			expectedWorkflowVersion: projection?.workflow.version,
			payload: { packetId, packetDigest: built.digest, reason: "needs rework", targets: [{ type: "artifact", id: 1 }] },
		});
		assert.equal(rejected.status, 201);
		const afterReject = (await (await get(context, `/api/approval-packets/${packetId}`)).json()) as Record<string, any>;
		assert.equal(afterReject.status, "rejected");
		assert.equal(afterReject.valid, false, "rejected packet is no longer a valid approval subject");
	});
});

test("governed design package is created at packet approval and stays read-only", async () => {
	await withReadServer(async (context) => {
		const { workflowId, requirementId } = await createStartedWorkflow(context);
		await adoptPlan(context.runtime, workflowId, standardTasks());
		executeAnalystTask(context.runtime, workflowId);
		executeArchitectTask(context.runtime, workflowId);
		executeCriticTask(context.runtime, context.databasePath, workflowId);
		const built = context.runtime.buildApprovalPacket(workflowId);
		assert.equal(built.ready, true);
		const projection = context.runtime.getWorkflowProjection(workflowId);
		const approved = await putCommand(context, workflowId, "approve-packet-1", {
			type: "approve-packet",
			expectedWorkflowVersion: projection?.workflow.version,
			payload: { packetId: built.packetId, packetDigest: built.digest },
		});
		assert.equal(approved.status, 201);
		const db = new Database(context.databasePath, { readonly: true });
		let packageId: number;
		try {
			const row = db.prepare("select id from design_packages where requirement_id = ?").get(requirementId) as { id: number } | undefined;
			assert.ok(row, "approving the packet must create the governed DesignPackage");
			packageId = row.id;
		} finally {
			db.close();
		}
		const detail = (await (await get(context, `/api/design-packages/${packageId}`)).json()) as Record<string, any>;
		assert.equal(detail.archiveClass, "governed");
		assert.equal(detail.approvalPacketId, built.packetId);
		assert.equal(typeof detail.approvalId, "number");
		assert.equal(detail.migrationAttestationDocumentId, null);
		assert.equal(detail.digest, built.digest);
		const patched = await fetch(`${context.server.url}/api/design-packages/${packageId}`, {
			method: "PATCH",
			headers: { "content-type": "application/json", cookie: context.cookie },
			body: JSON.stringify({ archiveClass: "legacy_pre_policy" }),
		});
		assert.equal(patched.status, 404, "design packages have no mutation route");
	});
});

test("legacy_pre_policy design package reads do not masquerade as governed approvals", async () => {
	await withReadServer(async (context) => {
		const { requirementId } = await createStartedWorkflow(context);
		const db = new Database(context.databasePath);
		try {
			db.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('migration_attestation', 'migration-attestation/v1', 'application/json', '{}', 'sha256:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', ?)").run(TIMESTAMP);
			const attestationId = Number((db.prepare("select id from snapshot_documents where digest = 'sha256:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'").get() as { id: number }).id);
			db.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('approval_packet', 'legacy-package/v1', 'application/json', '{}', 'sha256:b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', ?)").run(TIMESTAMP);
			const documentId = Number((db.prepare("select id from snapshot_documents where digest = 'sha256:b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'").get() as { id: number }).id);
			assert.throws(
				() => db.prepare("insert into design_packages(requirement_id, workspace_id, document_id, digest, approval_packet_id, approval_id, migration_attestation_document_id, archive_class, archived_at) values (?, ?, ?, 'sha256:b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', 1, null, ?, 'legacy_pre_policy', ?)").run(requirementId, context.workspaceId, documentId, attestationId, TIMESTAMP),
				/archive class shape is invalid/,
				"legacy packages cannot reference governed approvals",
			);
			db.prepare("insert into design_packages(requirement_id, workspace_id, document_id, digest, approval_packet_id, approval_id, migration_attestation_document_id, archive_class, archived_at) values (?, ?, ?, 'sha256:b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', null, null, ?, 'legacy_pre_policy', ?)").run(requirementId, context.workspaceId, documentId, attestationId, TIMESTAMP);
		} finally {
			db.close();
		}
		const dbRead = new Database(context.databasePath, { readonly: true });
		let packageId: number;
		try {
			packageId = (dbRead.prepare("select id from design_packages where requirement_id = ?").get(requirementId) as { id: number }).id;
		} finally {
			dbRead.close();
		}
		const detail = (await (await get(context, `/api/design-packages/${packageId}`)).json()) as Record<string, any>;
		assert.equal(detail.archiveClass, "legacy_pre_policy");
		assert.equal(detail.approvalPacketId, null);
		assert.equal(detail.approvalId, null);
		assert.equal(typeof detail.migrationAttestationDocumentId, "number");
	});
});

test("legacy import detail exposes classification and anomaly summary", async () => {
	await withReadServer(async (context) => {
		const { requirementId, workflowId } = await createStartedWorkflow(context);
		const missing = await get(context, `/api/legacy-imports/${requirementId}`);
		assert.equal(missing.status, 404);
		const db = new Database(context.databasePath);
		try {
			db.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('legacy_requirement_bundle', 'legacy-bundle/v1', 'application/json', '{}', 'sha256:c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3', ?)").run(TIMESTAMP);
			db.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('migration_attestation', 'migration-attestation/v1', 'application/json', '{}', 'sha256:d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4', ?)").run(TIMESTAMP);
			const bundleId = (db.prepare("select id from snapshot_documents where digest = 'sha256:c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3'").get() as { id: number }).id;
			const attestationId = (db.prepare("select id from snapshot_documents where digest = 'sha256:d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4'").get() as { id: number }).id;
			db.prepare("insert into legacy_imports(requirement_id, workflow_id, import_class, bundle_document_id, attestation_document_id, anomaly_count, created_at) values (?, ?, 'pending_reentry', ?, ?, 2, ?)").run(requirementId, workflowId, bundleId, attestationId, TIMESTAMP);
			assert.throws(
				() => db.prepare("update legacy_imports set anomaly_count = 0 where requirement_id = ?").run(requirementId),
				/LegacyImport is immutable/,
			);
		} finally {
			db.close();
		}
		const detail = (await (await get(context, `/api/legacy-imports/${requirementId}`)).json()) as Record<string, any>;
		assert.equal(detail.requirementId, requirementId);
		assert.equal(detail.importClass, "pending_reentry");
		assert.equal(typeof detail.bundleDocumentId, "number");
		assert.equal(typeof detail.attestationDocumentId, "number");
		assert.equal(detail.anomalySummary.count, 2);
	});
});

test("reusable assets support list, create, detail, delete, export and import without governance side effects", async () => {
	await withReadServer(async (context) => {
		const requirementsBefore = context.runtime.listRequirements(context.workspaceId).length;
		const created = await fetch(`${context.server.url}/api/assets`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: context.cookie },
			body: JSON.stringify({ workspaceId: context.workspaceId, kind: "scenario", title: "Expiry scenario", content: { steps: ["a"] } }),
		});
		assert.equal(created.status, 201);
		const { assetId } = (await created.json()) as { assetId: number; revisionId: number };
		assert.equal(context.runtime.listRequirements(context.workspaceId).length, requirementsBefore, "assets never create Requirements or Workflows");
		const list = (await (await get(context, `/api/assets?workspaceId=${context.workspaceId}`)).json()) as { assets: Array<{ id: number; kind: string; title: string; currentRevision: { revisionNo: number; digest: string } }> };
		assert.equal(list.assets.length, 1);
		assert.equal(list.assets[0].kind, "scenario");
		assert.equal(list.assets[0].currentRevision.revisionNo, 1);
		const detail = (await (await get(context, `/api/assets/${assetId}`)).json()) as Record<string, any>;
		assert.equal(detail.title, "Expiry scenario");
		assert.equal(detail.revisions.length, 1);
		assert.equal(detail.revisions[0].source, "manual");
		assert.deepEqual(detail.revisions[0].content, { steps: ["a"] });
		const exported = (await (await get(context, `/api/assets/export?workspaceId=${context.workspaceId}`)).json()) as { assets: Array<{ title: string }> };
		assert.equal(exported.assets.length, 1);
		const imported = await fetch(`${context.server.url}/api/assets/import`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: context.cookie },
			body: JSON.stringify({ workspaceId: context.workspaceId, assets: [{ kind: "usecase", title: "Imported use case", content: { flow: ["x"] } }] }),
		});
		assert.equal(imported.status, 201);
		const { assetIds } = (await imported.json()) as { assetIds: number[] };
		const importedDetail = (await (await get(context, `/api/assets/${assetIds[0]}`)).json()) as Record<string, any>;
		assert.equal(importedDetail.revisions[0].source, "import");
		assert.equal(context.runtime.listRequirements(context.workspaceId).length, requirementsBefore);
		const deleted = await fetch(`${context.server.url}/api/assets/${assetId}`, { method: "DELETE", headers: { cookie: context.cookie } });
		assert.equal(deleted.status, 200);
		const afterDelete = await get(context, `/api/assets/${assetId}`);
		assert.equal(afterDelete.status, 404);
		const badKind = await fetch(`${context.server.url}/api/assets`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: context.cookie },
			body: JSON.stringify({ workspaceId: context.workspaceId, kind: "analysis", title: "wrong", content: {} }),
		});
		assert.equal(badKind.status, 400, "asset kinds are restricted to scenario/usecase/function");
	});
});
