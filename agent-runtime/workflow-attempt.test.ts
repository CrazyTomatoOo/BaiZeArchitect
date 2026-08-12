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
	type FixtureOperator,
	type FixtureOutboxTransport,
} from "./testing/deterministic-fixtures.js";
import { ScriptedModelDriver } from "./testing/scripted-model-driver.js";
import {
	openHeadlessWorkflowRuntime,
	type RequirementBaseline,
} from "./workflow/headless-runtime.js";
import type { PlanProposal } from "./workflow/plan-types.js";
import type { RoleResult, TraceLinkProposal } from "./workflow/role-result.js";

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Add expiry reminders and controlled compensation.",
	sourceRefs: [],
	title: "Points expiry and compensation",
	description: "Add expiry reminders and controlled compensation.",
};

const OPERATOR: FixtureOperator = createFixtureOperator("alice");

interface AttemptFixture {
	databasePath: string;
	runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;
	outbox: FixtureOutboxTransport;
	clock: FixtureClock;
}

async function withAttemptRuntime(
	work: (fixture: AttemptFixture) => Promise<void> | void,
	options: { crashPoints?: readonly string[] } = {},
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-attempt-"));
	const databasePath = path.join(directory, "workflow.db");
	const outbox = createOutboxTransport();
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

type Runtime = AttemptFixture["runtime"];

async function createWorkflowWithPlan(runtime: Runtime): Promise<{ workflowId: number; contextDigest: string }> {
	const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
	const created = runtime.createRequirement({ workspaceId, baseline: BASELINE });
	runtime.executeCommand({
		workflowId: created.workflowId,
		commandId: "cmd-start",
		expectedWorkflowVersion: 0,
		type: "start",
		operator: OPERATOR,
	});
	const contextDigest = runtime.getPlanningContextDigest(created.workflowId);
	const driver = new ScriptedModelDriver([
		{
			role: "orchestrator",
			contextDigest,
			orderedToolCalls: [],
			structuredResult: validPlanProposal(created.workflowId, contextDigest),
			modelUsage: { inputTokens: 100, outputTokens: 200 },
		},
	]);
	await runtime.planWorkflow(created.workflowId, driver);
	driver.assertExhausted();
	return { workflowId: created.workflowId, contextDigest };
}

function validPlanProposal(workflowId: number, contextDigest: string): PlanProposal {
	return {
		schemaVersion: "plan-proposal/v1",
		base: { workflowId, workflowVersion: 1, basePlanRevisionId: null, planningContextDigest: contextDigest },
		objective: "Analyze the requirement",
		tasks: [
			{
				key: "analyze-req",
				kind: "analyze",
				role: "analyst",
				objective: "Produce the analysis artifact",
				dependsOn: [],
				inputs: [],
				expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }],
				completionPolicyRef: "analysis/v1",
				maxAttempts: 3,
			},
		],
		rationale: "Single analyst task",
	};
}

function validAnalysisContent(): unknown {
	return {
		schemaVersion: "artifact/analysis/v1",
		artifactKind: "analysis",
		summary: "Analysis of points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		goals: ["Understand the expiry domain"],
		nonGoals: ["Design the solution"],
		constraints: ["Must be backward compatible"],
		acceptanceCriteria: ["All tests pass"],
		impactProfile: {
			process: { status: "yes", rationale: "Expiry changes the flow" },
			actors: { status: "yes", rationale: "Users are affected" },
			behavior: { status: "yes", rationale: "New reminder behavior" },
			architecture: { status: "no", rationale: "No architectural change" },
			data: { status: "no", rationale: "No data model change" },
			api: { status: "no", rationale: "No API change" },
		},
		openQuestions: [],
	};
}

function validRoleResult(workflowId: number, attemptId: number, content: unknown, traceLinks?: TraceLinkProposal[]): RoleResult {
	return {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId,
		effects: [
			{
				effectType: "artifact_revision",
				artifactKind: "analysis",
				logicalKey: "analysis",
				content,
				baseRevisionId: null,
				traceLinks,
			},
		],
	};
}

function queryAttemptState(databasePath: string, attemptId: number): { status: string; completed_at: string | null } {
	const database = new Database(databasePath, { readonly: true });
	try {
		return database.prepare("select status, completed_at from task_attempts where id = ?").get(attemptId) as { status: string; completed_at: string | null };
	} finally {
		database.close();
	}
}

function queryArtifactRevision(databasePath: string, workflowId: number, kind: string): { status: string; source_attempt_id: number; content_digest: string; revision_no: number } | undefined {
	const database = new Database(databasePath, { readonly: true });
	try {
		return database
			.prepare(
				`select ar.status, ar.source_attempt_id, ar.content_digest, ar.revision_no
				from artifact_revisions ar
				join artifacts a on a.id = ar.artifact_id
				join workflows w on w.requirement_id = a.requirement_id
				where w.id = ? and a.kind = ?
				order by ar.id desc limit 1`,
			)
			.get(workflowId, kind) as { status: string; source_attempt_id: number; content_digest: string; revision_no: number } | undefined;
	} finally {
		database.close();
	}
}

function queryEventTypes(databasePath: string, workflowId: number): string[] {
	const database = new Database(databasePath, { readonly: true });
	try {
		return (database.prepare("select type from workflow_events where workflow_id = ? order by seq").all(workflowId) as Array<{ type: string }>).map((r) => r.type);
	} finally {
		database.close();
	}
}

function queryActiveClaim(databasePath: string, workflowId: number): { attempt_id: number } | undefined {
	const database = new Database(databasePath, { readonly: true });
	try {
		return database.prepare("select attempt_id from governance_claims where workflow_id = ? and status = 'active'").get(workflowId) as { attempt_id: number } | undefined;
	} finally {
		database.close();
	}
}

function queryEffectState(databasePath: string, attemptId: number): Array<{ state: string; logical_key: string; published_artifact_revision_id: number | null }> {
	const database = new Database(databasePath, { readonly: true });
	try {
		return database.prepare("select state, logical_key, published_artifact_revision_id from attempt_effects where attempt_id = ?").all(attemptId) as Array<{ state: string; logical_key: string; published_artifact_revision_id: number | null }>;
	} finally {
		database.close();
	}
}

test("analyst attempt acquires claim, creates attempt, run, and context manifest", async () => {
	await withAttemptRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithPlan(runtime);
		const begin = runtime.beginAttempt(workflowId);

		assert.notEqual(begin.taskId, 0);
		assert.notEqual(begin.attemptId, 0);
		assert.notEqual(begin.runId, 0);
		assert.ok(begin.contextDigest, "context digest must be non-empty");

		const claim = queryActiveClaim(databasePath, workflowId);
		assert.equal(claim?.attempt_id, begin.attemptId);

		const db = new Database(databasePath, { readonly: true });
		try {
			const attempt = db.prepare("select context_manifest_document_id, role_contract_document_id, base_workflow_version, status from task_attempts where id = ?").get(begin.attemptId) as { context_manifest_document_id: number; role_contract_document_id: number; base_workflow_version: number; status: string };
			assert.ok(attempt.context_manifest_document_id, "context manifest must be set");
			assert.ok(attempt.role_contract_document_id, "role contract must be set");
			assert.equal(attempt.status, "running");
			const run = db.prepare("select mode, role, session_file, session_id, status from runs where attempt_id = ?").get(begin.attemptId) as { mode: string; role: string; session_file: string; session_id: string; status: string };
			assert.equal(run.mode, "governance");
			assert.equal(run.role, "analyst");
			assert.ok(run.session_file);
			assert.ok(run.session_id);
			assert.equal(run.status, "running");
		} finally {
			db.close();
		}
	});
});

test("second governance attempt cannot acquire an active claim", async () => {
	await withAttemptRuntime(async ({ runtime }) => {
		const { workflowId } = await createWorkflowWithPlan(runtime);
		const first = runtime.beginAttempt(workflowId);
		assert.notEqual(first.taskId, 0);
		assert.throws(
			() => runtime.beginAttempt(workflowId),
			/Only one active governance claim per workflow/,
		);
	});
});

test("successful publication creates pending artifact revision, provenance, terminal states, and events", async () => {
	await withAttemptRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithPlan(runtime);
		runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", []);
		const evidenceSnapshotId = runtime.getEvidenceSnapshots(workflowId)[0]!.id;
		const begin = runtime.beginAttempt(workflowId);
		const result = runtime.completeAttempt(workflowId, begin.attemptId, validRoleResult(workflowId, begin.attemptId, validAnalysisContent(), [{ evidenceSnapshotId, sourceRef: { type: "requirement_revision", revisionId: 1 } }]));

		assert.equal(result.outcome, "published");
		assert.equal(result.failureCode, null);

		const revision = queryArtifactRevision(databasePath, workflowId, "analysis");
		assert.ok(revision, "analysis revision must exist");
		assert.equal(revision.status, "pending");
		assert.equal(revision.source_attempt_id, begin.attemptId);

		const attempt = queryAttemptState(databasePath, begin.attemptId);
		assert.equal(attempt.status, "succeeded");

		const claim = queryActiveClaim(databasePath, workflowId);
		assert.equal(claim, undefined, "claim must be released");

		const events = queryEventTypes(databasePath, workflowId);
		assert.ok(events.includes("artifact_revision_published"));
		assert.ok(events.includes("attempt_succeeded"));
		assert.ok(events.includes("task_completed"));
		assert.ok(events.includes("workflow_attempt_claim_released"));

		const effects = queryEffectState(databasePath, begin.attemptId);
		assert.equal(effects.length, 1);
		assert.equal(effects[0].state, "published");
		assert.ok(effects[0].published_artifact_revision_id);
	});
});

test("invalid RoleResult schema fails the attempt without publishing", async () => {
	await withAttemptRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithPlan(runtime);
		const begin = runtime.beginAttempt(workflowId);
		const result = runtime.completeAttempt(workflowId, begin.attemptId, { schemaVersion: "wrong", effects: [] });

		assert.equal(result.outcome, "failed");
		assert.equal(result.failureCode, "invalid_role_result_schema");

		const attempt = queryAttemptState(databasePath, begin.attemptId);
		assert.equal(attempt.status, "failed");

		const revision = queryArtifactRevision(databasePath, workflowId, "analysis");
		assert.equal(revision, undefined, "no revision must be published");

		const claim = queryActiveClaim(databasePath, workflowId);
		assert.equal(claim, undefined);
	});
});

test("tool ownership violation fails the attempt", async () => {
	await withAttemptRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithPlan(runtime);
		const begin = runtime.beginAttempt(workflowId);
		const result = runtime.completeAttempt(workflowId, begin.attemptId, {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: begin.attemptId,
			effects: [
				{
					effectType: "artifact_revision",
					artifactKind: "design",
					logicalKey: "design",
					content: { schemaVersion: "artifact/design/v1", artifactKind: "design", summary: "x", sourceRefs: [] },
					baseRevisionId: null,
				},
			],
		} as RoleResult);

		assert.equal(result.outcome, "failed");
		assert.equal(result.failureCode, "tool_ownership_violation");
	});
});

test("missing required effect fails completion policy", async () => {
	await withAttemptRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithPlan(runtime);
		const begin = runtime.beginAttempt(workflowId);
		const result = runtime.completeAttempt(workflowId, begin.attemptId, {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: begin.attemptId,
			effects: [],
		} as RoleResult);

		assert.equal(result.outcome, "failed");
		assert.equal(result.failureCode, "completion_policy_failed");
	});
});

test("attempt budget exhaustion fails the task and the workflow", async () => {
	await withAttemptRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithPlan(runtime);
		for (let i = 0; i < 3; i += 1) {
			const begin = runtime.beginAttempt(workflowId);
			const result = runtime.completeAttempt(workflowId, begin.attemptId, { schemaVersion: "wrong" });
			assert.equal(result.outcome, i < 2 ? "failed" : "task_exhausted");
		}
		const db = new Database(databasePath, { readonly: true });
		try {
			const wf = db.prepare("select state, current_failure_code from workflows where id = ?").get(workflowId) as { state: string; current_failure_code: string | null };
			assert.equal(wf.state, "failed");
			assert.equal(wf.current_failure_code, "task_budget_exhausted");
		} finally {
			db.close();
		}
	});
});

test("crash before publish commit rolls back all candidate effects", async () => {
	await withAttemptRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithPlan(runtime);
		runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", []);
		const evidenceSnapshotId = runtime.getEvidenceSnapshots(workflowId)[0]!.id;
		const begin = runtime.beginAttempt(workflowId);
		assert.throws(
			() => runtime.completeAttempt(workflowId, begin.attemptId, validRoleResult(workflowId, begin.attemptId, validAnalysisContent(), [{ evidenceSnapshotId, sourceRef: { type: "requirement_revision", revisionId: 1 } }])),
			/crash point reached: publish_attempt\.before_commit/,
		);
		const revision = queryArtifactRevision(databasePath, workflowId, "analysis");
		assert.equal(revision, undefined, "no revision must survive rollback");
		const claim = queryActiveClaim(databasePath, workflowId);
		assert.ok(claim, "claim must be restored after rollback");
	}, { crashPoints: ["publish_attempt.before_commit"] });
});

test("executeTask drives analyst model and publishes via the model/tool boundary", async () => {
	await withAttemptRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithPlan(runtime);
		runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", []);
		const evidenceSnapshotId = runtime.getEvidenceSnapshots(workflowId)[0]!.id;
		const begin = runtime.beginAttempt(workflowId);
		const structuredResult = validRoleResult(workflowId, begin.attemptId, validAnalysisContent(), [{ evidenceSnapshotId, sourceRef: { type: "requirement_revision", revisionId: 1 } }]);
		const driver = new ScriptedModelDriver([
			{
				role: "analyst",
				contextDigest: begin.contextDigest,
				orderedToolCalls: [],
				structuredResult,
				modelUsage: { inputTokens: 50, outputTokens: 100 },
			},
		]);
		const result = runtime.completeAttempt(workflowId, begin.attemptId, structuredResult);
		assert.equal(result.outcome, "published");
		const revision = queryArtifactRevision(databasePath, workflowId, "analysis");
		assert.ok(revision);
		assert.equal(revision.status, "pending");
	});
});
