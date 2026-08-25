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

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Add expiry reminders and controlled compensation.",
	sourceRefs: [],
	title: "Points expiry and compensation",
	description: "Add expiry reminders and controlled compensation.",
};

const OPERATOR: FixtureOperator = createFixtureOperator("alice");

interface PlanningFixture {
	databasePath: string;
	runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;
	outbox: FixtureOutboxTransport;
	clock: FixtureClock;
}

async function withPlanningRuntime(
	work: (fixture: PlanningFixture) => Promise<void> | void,
	options: { crashPoints?: readonly string[] } = {},
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-planning-"));
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

type Runtime = PlanningFixture["runtime"];

async function createStartedWorkflow(runtime: Runtime): Promise<{ workflowId: number }> {
	const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
	const created = runtime.createRequirement({ workspaceId, baseline: BASELINE });
	runtime.executeCommand({
		workflowId: created.workflowId,
		commandId: "cmd-start",
		expectedWorkflowVersion: 0,
		type: "start",
		operator: OPERATOR,
	});
	return { workflowId: created.workflowId };
}

function validProposal(workflowId: number, contextDigest: string, workflowVersion = 1, basePlanRevisionId: number | null = null): PlanProposal {
	return {
		schemaVersion: "plan-proposal/v1",
		base: { workflowId, workflowVersion, basePlanRevisionId, planningContextDigest: contextDigest },
		objective: "Plan analysis and design",
		tasks: [
			{
				key: "analyze-req",
				kind: "analyze",
				role: "analysis-analyst",
				objective: "Analyze the requirement",
				dependsOn: [],
				inputs: [],
				expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }],
				completionPolicyRef: "analysis/v1",
				maxAttempts: 3,
			},
			{
				key: "design-sol",
				kind: "design",
				role: "design-architect",
				objective: "Design the solution",
				dependsOn: ["analyze-req"],
				inputs: [{ type: "task_output", taskKey: "analyze-req", artifactKind: "analysis", purpose: "Analysis as design input" }],
				expectedArtifactEffects: [{ kind: "design", operation: "create_or_revise" }],
				completionPolicyRef: "design/v1",
				maxAttempts: 3,
			},
		],
		rationale: "Standard analysis-then-design flow",
	};
}

function invalidProposal(workflowId: number, contextDigest: string, workflowVersion = 1): PlanProposal {
	const proposal = validProposal(workflowId, contextDigest, workflowVersion);
	proposal.tasks[1].expectedArtifactEffects = [{ kind: "analysis", operation: "create_or_revise" }];
	return proposal;
}

function queryPlanRevisionCount(databasePath: string, workflowId: number): number {
	const database = new Database(databasePath, { readonly: true });
	try {
		return (database.prepare("select count(*) as count from plan_revisions where workflow_id = ?").get(workflowId) as { count: number }).count;
	} finally {
		database.close();
	}
}

function queryTaskCount(databasePath: string, workflowId: number): number {
	const database = new Database(databasePath, { readonly: true });
	try {
		return (database.prepare("select count(*) as count from tasks where workflow_id = ? and kind != 'plan'").get(workflowId) as { count: number }).count;
	} finally {
		database.close();
	}
}
function queryPlanTaskStatus(databasePath: string, workflowId: number): string {
	const database = new Database(databasePath, { readonly: true });
	try {
		return (database.prepare("select status from tasks where workflow_id = ? and kind = 'plan' order by id desc limit 1").get(workflowId) as { status: string }).status;
	} finally {
		database.close();
	}
}

function queryWorkflowState(databasePath: string, workflowId: number): { state: string; version: number; consecutive_plan_revisions: number; current_failure_code: string | null } {
	const database = new Database(databasePath, { readonly: true });
	try {
		return database.prepare("select state, version, consecutive_plan_revisions, current_failure_code from workflows where id = ?").get(workflowId) as { state: string; version: number; consecutive_plan_revisions: number; current_failure_code: string | null };
	} finally {
		database.close();
	}
}

test("planWorkflow instantiates the plan-template deterministically (no orchestrator model call)", async () => {
	await withPlanningRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createStartedWorkflow(runtime);
		const result = await runtime.planWorkflow(workflowId, null);
		assert.equal(result.outcome, "adopted");
		assert.ok(result.planRevisionId);
		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		assert.equal(projection.workflow.currentPlanRevisionId, result.planRevisionId);
		assert.equal(queryPlanRevisionCount(databasePath, workflowId), 1);
		// 模板 = 8 生产 Task + 5 复审 Task (design 拆为 design/architecture/data/api 各一 Task)
		assert.equal(queryTaskCount(databasePath, workflowId), 13);
		const plan = runtime.getPlanRevisionDetail(result.planRevisionId!);
		assert.ok(plan);
		assert.equal(plan.proposal.tasks.length, 13);
		assert.equal(plan.proposal.tasks.filter((t) => t.role === "critic").length, 5);
		// design 拆为 4 个独立 Task 各产 1 kind
		const designTask = plan.proposal.tasks.find((t) => t.key === "design");
		assert.ok(designTask);
		assert.deepEqual(designTask.expectedArtifactEffects.map((e) => e.kind), ["design"]);
		const archTask = plan.proposal.tasks.find((t) => t.key === "architecture");
		assert.ok(archTask);
		assert.deepEqual(archTask.expectedArtifactEffects.map((e) => e.kind), ["architecture"]);
	});
});





test("planning creates task, attempt, run, and governance claim", async () => {
	await withPlanningRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createStartedWorkflow(runtime);
		const begin = runtime.beginPlanning(workflowId);
		assert.ok(begin.taskId > 0);
		assert.ok(begin.attemptId > 0);
		assert.ok(begin.runId > 0);
		const database = new Database(databasePath, { readonly: true });
		try {
			const task = database.prepare("select kind, role, status from tasks where id = ?").get(begin.taskId) as { kind: string; role: string; status: string };
			assert.equal(task.kind, "plan");
			assert.equal(task.role, "orchestrator");
			assert.equal(task.status, "in_progress");
			const attempt = database.prepare("select status from task_attempts where id = ?").get(begin.attemptId) as { status: string };
			assert.equal(attempt.status, "running");
			const run = database.prepare("select status from runs where id = ?").get(begin.runId) as { status: string };
			assert.equal(run.status, "running");
			const claim = database.prepare("select status from governance_claims where attempt_id = ?").get(begin.attemptId) as { status: string };
			assert.equal(claim.status, "active");
		} finally {
			database.close();
		}
	});
});

test("planning task completes on plan adoption (task_completed emitted, no stall)", async () => {
	await withPlanningRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createStartedWorkflow(runtime);
		const result = await runtime.planWorkflow(workflowId, null);
		assert.equal(result.outcome, "adopted");

		// 规划任务必须结算为 completed,否则依赖它的生产任务永不激活 → 工作流静默卡死
		assert.equal(queryPlanTaskStatus(databasePath, workflowId), "completed");
		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		const taskCompleted = projection.events.filter((e) => e.type === "task_completed");
		assert.equal(taskCompleted.length, 1, "planning task_completed should be emitted exactly once");
		assert.equal(taskCompleted[0]!.entity.type, "task");
	});
});

test("planWorkflow never invokes the ModelDriver (orchestrator retired)", async () => {
	await withPlanningRuntime(async ({ runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
		const modelRoles = {
			"analysis-analyst": { provider: "qwen-token-plan-cn", modelId: "qwen-max" },
		};
		const created = runtime.createRequirement({ workspaceId, baseline: BASELINE, modelRoles });
		runtime.executeCommand({
			workflowId: created.workflowId,
			commandId: "cmd-start",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: OPERATOR,
		});
		const events: string[] = [];
		const driver = new ScriptedModelDriver([
			{
				role: "analysis-analyst",
				contextDigest: runtime.getPlanningContextDigest(created.workflowId),
				orderedToolCalls: [],
				structuredResult: null,
				modelUsage: { provider: "test", modelId: "test", inputTokens: 0, outputTokens: 0 },
				invoke: async () => {
					events.push("model-call");
				},
			},
		]);
		const result = await runtime.planWorkflow(created.workflowId, driver);
		assert.equal(result.outcome, "adopted");
		assert.deepEqual(events, [], "planWorkflow must not call the model driver");
	});
});

test("released governance claim cannot be reactivated while another is active", async () => {
	await withPlanningRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createStartedWorkflow(runtime);
		const begin = runtime.beginPlanning(workflowId);
		const database = new Database(databasePath);
		try {
			database.prepare("insert into governance_claims(workflow_id, attempt_id, status, created_at) values (?, ?, 'released', ?)").run(workflowId, begin.attemptId, "2026-08-12T10:00:00.000Z");
			assert.throws(
				() => database.prepare("update governance_claims set status = 'active' where status = 'released'").run(),
				/Only one active governance claim per workflow/,
			);
		} finally {
			database.close();
		}
	});
});
