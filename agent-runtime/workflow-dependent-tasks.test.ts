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

import {
	openHeadlessWorkflowRuntime,
	type RequirementBaseline,
} from "./workflow/headless-runtime.js";
import type { CriticReport, RoleResult as RoleResultType, TraceLinkProposal } from "./workflow/role-result.js";
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

interface DepFixture {
	databasePath: string;
	runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;
	outbox: FixtureOutboxTransport;
	clock: FixtureClock;
}

async function withDepRuntime(
	work: (fixture: DepFixture) => Promise<void> | void,
	options: { crashPoints?: readonly string[] } = {},
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-dep-"));
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

type Runtime = DepFixture["runtime"];

async function createWorkflowWithDepPlan(runtime: Runtime): Promise<{ workflowId: number }> {
	const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
	const created = runtime.createRequirement({ workspaceId, baseline: BASELINE });
	runtime.executeCommand({
		workflowId: created.workflowId,
		commandId: "cmd-start",
		expectedWorkflowVersion: 0,
		type: "start",
		operator: OPERATOR,
	});
	// #19：Orchestrator 退场 —— 本文件聚焦 analyze→review→design 依赖语义，沿用三 Task 手工计划
	// （analysis-analyst / critic / design-architect），经 beginPlanning + completePlanning 直接采纳。
	// #20 双闸：design 激活需要 analysis revision 被 review 覆盖并 approve。
	// base.workflowVersion = beginPlanning 前的工作流版本（start 后为 1；beginPlanning 事件将版本抬到 2）。
	const begin = runtime.beginPlanning(created.workflowId);
	const contextDigest = runtime.getPlanningContextDigest(created.workflowId);
	const result = runtime.completePlanning(created.workflowId, begin.attemptId, depPlanProposal(created.workflowId, contextDigest, 1));
	assert.equal(result.outcome, "adopted");
	return { workflowId: created.workflowId };
}

function depPlanProposal(workflowId: number, contextDigest: string, workflowVersion: number): PlanProposal {
	return {
		schemaVersion: "plan-proposal/v1",
		base: { workflowId, workflowVersion, basePlanRevisionId: null, planningContextDigest: contextDigest },
		objective: "Analyze then design",
		tasks: [
			{
				key: "analyze-req",
				kind: "analyze",
				role: "analysis-analyst",
				objective: "Produce the analysis artifact",
				dependsOn: [],
				inputs: [],
				expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }],
				completionPolicyRef: "analysis/v1",
				maxAttempts: 3,
			},
			{
				// #20 双闸：环节尾 Critic 复审 —— approve-artifact 前置 coverage 由该任务产出
				key: "review-req",
				kind: "review",
				role: "critic",
				objective: "Review the analysis artifact",
				dependsOn: ["analyze-req"],
				inputs: [],
				expectedArtifactEffects: [],
				completionPolicyRef: "critic-review/v1",
				maxAttempts: 3,
			},
			{
				key: "design-sol",
				kind: "design",
				role: "design-architect",
				objective: "Design the solution using analysis output",
				dependsOn: ["review-req"],
				inputs: [{ type: "task_output", taskKey: "analyze-req", artifactKind: "analysis", purpose: "Analysis as design input" }],
				expectedArtifactEffects: [{ kind: "design", operation: "create_or_revise" }],
				completionPolicyRef: "design/v1",
				maxAttempts: 3,
			},
		],
		rationale: "Standard analysis-then-design flow with task_output dependency",
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

function validDesignContent(): unknown {
	return {
		schemaVersion: "artifact/design/v1",
		artifactKind: "design",
		summary: "Design of points expiry solution",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		changeUnits: [{ id: "cu1", area: "points", change: "Add expiry", rationale: "Business rule", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }] }],
		alternatives: ["Do nothing"],
		failureHandling: ["Retry on failure"],
		testStrategy: ["Unit and integration tests"],
		implementationOrder: ["Sequential"],
		rolloutStrategy: "Canary",
		rollbackStrategy: "Revert",
	};
}

function analysisRoleResult(workflowId: number, attemptId: number, traceLinks?: TraceLinkProposal[]): RoleResultType {
	return {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId,
		effects: [
			{ effectType: "artifact_revision", artifactKind: "analysis", logicalKey: "analysis", content: validAnalysisContent(), baseRevisionId: null, traceLinks },
		],
	};
}

function setupEvidence(runtime: Runtime, workflowId: number): TraceLinkProposal[] {
	runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", []);
	const evidenceSnapshotId = runtime.getEvidenceSnapshots(workflowId)[0]!.id;
	return [{ evidenceSnapshotId, sourceRef: { type: "requirement_revision", revisionId: 1 } }];
}

function designRoleResult(workflowId: number, attemptId: number, traceLinks?: TraceLinkProposal[]): RoleResultType {
	return {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId,
		effects: [
			{ effectType: "artifact_revision", artifactKind: "design", logicalKey: "design", content: validDesignContent(), baseRevisionId: null, traceLinks },
		],
	};
}

function queryEventTypes(databasePath: string, workflowId: number): string[] {
	const database = new Database(databasePath, { readonly: true });
	try {
		return (database.prepare("select type from workflow_events where workflow_id = ? order by seq").all(workflowId) as Array<{ type: string }>).map((r) => r.type);
	} finally {
		database.close();
	}
}

function queryTaskStatus(databasePath: string, workflowId: number, key: string): { status: string; id: number } {
	const database = new Database(databasePath, { readonly: true });
	try {
		return database.prepare("select id, status from tasks where workflow_id = ? and key = ?").get(workflowId, key) as { id: number; status: string };
	} finally {
		database.close();
	}
}

function queryAttemptStatus(databasePath: string, attemptId: number): string {
	const database = new Database(databasePath, { readonly: true });
	try {
		return (database.prepare("select status from task_attempts where id = ?").get(attemptId) as { status: string }).status;
	} finally {
		database.close();
	}
}

function queryPublishedRevisionCount(databasePath: string, workflowId: number, kind: string): number {
	const database = new Database(databasePath, { readonly: true });
	try {
		return (database
			.prepare(`select count(*) as count from artifact_revisions ar join artifacts a on a.id = ar.artifact_id join workflows w on w.requirement_id = a.requirement_id where w.id = ? and a.kind = ? and ar.status = 'pending'`)
			.get(workflowId, kind) as { count: number }).count;
	} finally {
		database.close();
	}
}

function queryTotalRevisionCount(databasePath: string, workflowId: number, kind: string): number {
	const database = new Database(databasePath, { readonly: true });
	try {
		const row = database
			.prepare(`select count(*) as count from artifact_revisions ar join artifacts a on a.id = ar.artifact_id join workflows w on w.requirement_id = a.requirement_id where w.id = ? and a.kind = ?`)
			.get(workflowId, kind) as { count: number };
		return row.count;
	} finally {
		database.close();
	}
}

function queryAnalysisArtifact(databasePath: string, workflowId: number): { artifactId: number; revisionId: number } {
	const database = new Database(databasePath, { readonly: true });
	try {
		const row = database
			.prepare(`select a.id as artifactId, ar.id as revisionId
				from artifact_revisions ar
				join artifacts a on a.id = ar.artifact_id
				join workflows w on w.requirement_id = a.requirement_id
				where w.id = ? and a.kind = 'analysis'
				order by ar.id desc limit 1`)
			.get(workflowId) as { artifactId: number; revisionId: number };
		assert.ok(row, "analysis artifact revision should exist");
		return row;
	} finally {
		database.close();
	}
}

/** #20 双闸（第一闸）：执行环节尾 Critic 复审，产出该 analysis revision 的 coverage。 */
function executeReviewTask(runtime: Runtime, databasePath: string, workflowId: number): { artifactId: number; revisionId: number } {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskKey, "review-req");
	assert.equal(begin.taskRole, "critic");
	const subject = queryAnalysisArtifact(databasePath, workflowId);
	const report: CriticReport = {
		schemaVersion: "critic-report/v1",
		workflowId,
		attemptId: begin.attemptId,
		coverageAttestation: { reviewTargets: [{ revisionId: subject.revisionId, artifactKind: "analysis" }], complete: true },
		findings: [],
	};
	const result: RoleResultType = { schemaVersion: "role-result/v1", workflowId, attemptId: begin.attemptId, effects: [], criticReport: report };
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
	return subject;
}

/** #20 双闸（第二闸）：人工 approve 已复审的 analysis revision。 */
function approveAnalysis(runtime: Runtime, workflowId: number, subject: { artifactId: number; revisionId: number }): void {
	const projection = runtime.getWorkflowProjection(workflowId);
	assert.ok(projection);
	const receipt = runtime.executeCommand({
		workflowId,
		commandId: `cmd-approve-analysis-${workflowId}`,
		expectedWorkflowVersion: projection.workflow.version,
		type: "approve-artifact",
		operator: OPERATOR,
		payload: subject,
	});
	assert.equal(receipt.outcome, "accepted");
}

/** #20 双闸：完成环节尾 Critic 复审（产出 coverage），再人工 approve analysis revision。 */
function reviewAndApproveAnalysis(runtime: Runtime, databasePath: string, workflowId: number): void {
	approveAnalysis(runtime, workflowId, executeReviewTask(runtime, databasePath, workflowId));
}

// ─── 1. task_output resolves to exactly one approved revision ───

test("task_output input resolves to exactly one approved ancestor revision before attempt creation", async () => {
	await withDepRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithDepPlan(runtime);

		// Execute the analyst task first
		const analystBegin = runtime.beginAttempt(workflowId);
		runtime.completeAttempt(workflowId, analystBegin.attemptId, analysisRoleResult(workflowId, analystBegin.attemptId, setupEvidence(runtime, workflowId)));

		// #20 双闸第一闸：环节尾 review（critic 可直接引用 pending revision）
		const subject = executeReviewTask(runtime, databasePath, workflowId);

		// #20 绑定反转：analysis revision 未 approve 前，design 不可激活
		const blocked = runtime.beginAttempt(workflowId);
		assert.equal(blocked.taskId, 0, "design task must not activate before the analysis revision is approved");

		// #20 双闸第二闸：人工 approve 后 design 可激活
		approveAnalysis(runtime, workflowId, subject);


		// Now begin the architect task — its task_output input resolves to the approved analysis revision
		const designBegin = runtime.beginAttempt(workflowId);
		assert.notEqual(designBegin.taskId, 0, "design task should be ready after analysis approved");

		// Verify the context manifest contains the resolved input revision
		const db = new Database(databasePath, { readonly: true });
		try {
			const attempt = db.prepare("select context_manifest_document_id from task_attempts where id = ?").get(designBegin.attemptId) as { context_manifest_document_id: number };
			const manifest = JSON.parse((db.prepare("select content from snapshot_documents where id = ?").get(attempt.context_manifest_document_id) as { content: string }).content) as { inputs: Array<Record<string, unknown>> };
			const taskOutput = manifest.inputs.find((i) => i.type === "task_output");
			assert.ok(taskOutput, "task_output input must exist in manifest");
			assert.equal(taskOutput.resolvedRevisionId, analystBegin.attemptId > 0 ? expectRevisionId(db, workflowId, "analysis") : 0);
		} finally {
			db.close();
		}
	});
});

function expectRevisionId(database: Database.Database, workflowId: number, kind: string): number {
	return (database
		.prepare(`select ar.id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id join workflows w on w.requirement_id = a.requirement_id where w.id = ? and a.kind = ? and ar.status = 'approved' order by ar.id desc limit 1`)
		.get(workflowId, kind) as { id: number }).id;
}

test("task_output with zero published candidate revisions does not start dependent task", async () => {
	await withDepRuntime(async ({ runtime }) => {
		const { workflowId } = await createWorkflowWithDepPlan(runtime);

		// Exhaust the analyst task budget (3 failures) so it permanently fails
		for (let i = 0; i < 3; i += 1) {
			const begin = runtime.beginAttempt(workflowId);
			runtime.completeAttempt(workflowId, begin.attemptId, { schemaVersion: "wrong" });
		}

		// Workflow is now failed — beginAttempt should throw
		assert.throws(
			() => runtime.beginAttempt(workflowId),
			/Cannot begin attempt on workflow in state failed/,
	);
	});
});

// ─── 2. Architect can only write design/architecture/data/api ───

test("architect attempting to write analysis artifact is rejected by tool ownership", async () => {
	await withDepRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithDepPlan(runtime);

		// Execute analyst first
		const analystBegin = runtime.beginAttempt(workflowId);
		runtime.completeAttempt(workflowId, analystBegin.attemptId, analysisRoleResult(workflowId, analystBegin.attemptId, setupEvidence(runtime, workflowId)));

		// #20 双闸：review + approve 后 design 才可激活
		reviewAndApproveAnalysis(runtime, databasePath, workflowId);

		// Architect attempts to write analysis (owned by analyst)
		const designBegin = runtime.beginAttempt(workflowId);
		const result = runtime.completeAttempt(workflowId, designBegin.attemptId, {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: designBegin.attemptId,
			effects: [
				{ effectType: "artifact_revision", artifactKind: "analysis", logicalKey: "analysis", content: validAnalysisContent(), baseRevisionId: null },
			],
		} as RoleResultType);

		assert.equal(result.outcome, "failed");
		assert.equal(result.failureCode, "tool_ownership_violation");
		assert.equal(queryTotalRevisionCount(databasePath, workflowId, "analysis"), 1, "no new analysis revision from architect");
	});
});

// ─── 3. Scheduler dispatches in stable topological order with retry priority ───

test("failed task retry takes priority over unrelated ready task", async () => {
	await withDepRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithDepPlan(runtime);

		// Execute analyst task (succeeds, publishes analysis)
		const analystBegin = runtime.beginAttempt(workflowId);
		runtime.completeAttempt(workflowId, analystBegin.attemptId, analysisRoleResult(workflowId, analystBegin.attemptId, setupEvidence(runtime, workflowId)));

		// #20 双闸：review + approve 后 design 才可被调度
		reviewAndApproveAnalysis(runtime, databasePath, workflowId);

		// Execute design task — fails (budget remains)
		const designBegin = runtime.beginAttempt(workflowId);
		runtime.completeAttempt(workflowId, designBegin.attemptId, { schemaVersion: "wrong" });

		// Design task is now pending again (reset on failure with budget remaining)
		assert.equal(queryTaskStatus(databasePath, workflowId, "design-sol").status, "pending");

		// Next beginAttempt should pick design-sol (retry priority), not skip to nothing
		const retryBegin = runtime.beginAttempt(workflowId);
		assert.equal(retryBegin.taskId, designBegin.taskId, "retry should target the same failed task");
	});
});

// ─── 4. cancel-run cancels active attempt and pauses workflow ───

test("cancel-run command cancels active attempt and pauses workflow", async () => {
	await withDepRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithDepPlan(runtime);

		const begin = runtime.beginAttempt(workflowId);
		assert.notEqual(begin.taskId, 0);

		const receipt = runtime.executeCommand({
			workflowId,
			commandId: "cmd-cancel-1",
			expectedWorkflowVersion: begin.workflowVersion,
			type: "cancel-run",
			reason: "Operator halt",
			operator: OPERATOR,
		});

		assert.equal(receipt.outcome, "accepted");
		assert.equal(receipt.httpStatus, 201);

		const after = runtime.getWorkflowProjection(workflowId);
		assert.ok(after);
		assert.equal(after.workflow.state, "paused");

		// Attempt must be cancelled (terminal), not still running
		assert.equal(queryAttemptStatus(databasePath, begin.attemptId), "cancelled");

		// Governance claim must be released
		const db = new Database(databasePath, { readonly: true });
		try {
			const claim = db.prepare("select status from governance_claims where attempt_id = ? and status = 'active'").get(begin.attemptId);
			assert.equal(claim, undefined, "claim must be released after cancel-run");
		} finally {
			db.close();
		}
	});
});

// ─── 5. Late result from cancelled attempt is audit-only ───

test("late result from cancelled attempt only appends audit, does not publish", async () => {
	await withDepRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithDepPlan(runtime);

		const begin = runtime.beginAttempt(workflowId);
		runtime.executeCommand({
			workflowId,
			commandId: "cmd-cancel-late",
			expectedWorkflowVersion: begin.workflowVersion,
			type: "cancel-run",
			reason: "Operator halt",
			operator: OPERATOR,
		});

		// Attempt is now cancelled; late result arrives
		assert.equal(queryAttemptStatus(databasePath, begin.attemptId), "cancelled");

		const result = runtime.completeAttempt(workflowId, begin.attemptId, analysisRoleResult(workflowId, begin.attemptId, setupEvidence(runtime, workflowId)));

		assert.equal(result.outcome, "late_result_audit");
		assert.equal(result.failureCode, null);

		// No new artifact revision published
		assert.equal(queryPublishedRevisionCount(databasePath, workflowId, "analysis"), 0);

		// Audit event must exist
		const events = queryEventTypes(databasePath, workflowId);
		assert.ok(events.includes("late_result_audit"), "late_result_audit event must exist");
	});
});

// ─── 6. blocked result stops branch and forms a gate ───

test("blocked result stops the task and emits a gate without failing the workflow", async () => {
	await withDepRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithDepPlan(runtime);
		const begin = runtime.beginAttempt(workflowId);

		const result = runtime.completeAttempt(workflowId, begin.attemptId, {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: begin.attemptId,
			outcome: "blocked",
			blockReason: "Missing context",
			effects: [],
		} as unknown as RoleResultType);

		assert.equal(result.outcome, "blocked");
		assert.equal(queryAttemptStatus(databasePath, begin.attemptId), "blocked");
		assert.equal(queryTaskStatus(databasePath, workflowId, "analyze-req").status, "blocked");

		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		assert.notEqual(projection.workflow.state, "failed", "blocked must not fail the workflow");

		const events = queryEventTypes(databasePath, workflowId);
		assert.ok(events.includes("task_blocked"), "task_blocked event must exist");
	});
});

// ─── 7. replan_requested waits for new PlanRevision ───

test("replan_requested result marks task for replanning without modifying current DAG", async () => {
	await withDepRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithDepPlan(runtime);
		const begin = runtime.beginAttempt(workflowId);

		const result = runtime.completeAttempt(workflowId, begin.attemptId, {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: begin.attemptId,
			outcome: "replan_requested",
			replanReason: "Current plan misses actor analysis",
			effects: [],
		} as unknown as RoleResultType);

		assert.equal(result.outcome, "replan_requested");
		assert.equal(queryAttemptStatus(databasePath, begin.attemptId), "replan_requested");
		assert.equal(queryTaskStatus(databasePath, workflowId, "analyze-req").status, "replan_requested");

		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		assert.notEqual(projection.workflow.state, "failed");

		// Current plan revision must still be active (not modified)
		const db = new Database(databasePath, { readonly: true });
		try {
			const planRev = db.prepare("select status from plan_revisions where id = ?").get(projection.workflow.currentPlanRevisionId) as { status: string };
			assert.equal(planRev.status, "active");
		} finally {
			db.close();
		}

		const events = queryEventTypes(databasePath, workflowId);
		assert.ok(events.includes("replan_requested"), "replan_requested event must exist");
	});
});

// ─── 8. Crash points at boundaries ───

test("crash at dispatch boundary rolls back attempt creation", async () => {
	await withDepRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithDepPlan(runtime);

		assert.throws(
			() => runtime.beginAttempt(workflowId),
			/crash point reached: begin_attempt\.before_commit/,
		);

		// No active claim or running attempt should survive
		const db = new Database(databasePath, { readonly: true });
		try {
			const claim = db.prepare("select attempt_id from governance_claims where status = 'active'").get();
			assert.equal(claim, undefined, "no active claim after rollback");
			const attempt = db.prepare("select count(*) as count from task_attempts where status = 'running'").get() as { count: number };
			assert.equal(attempt.count, 0, "no running attempt after rollback");
		} finally {
			db.close();
		}
	}, { crashPoints: ["begin_attempt.before_commit"] });
});

// ─── 9. Stable serial dispatch: tasks execute one at a time in plan order ───

test("tasks execute serially in plan ordinal: analyze before design", async () => {
	await withDepRuntime(async ({ runtime, databasePath }) => {
		const { workflowId } = await createWorkflowWithDepPlan(runtime);

		// First ready task should be analyze-req (ordinal 0, no deps)
		const first = runtime.beginAttempt(workflowId);
		const firstTask = queryTaskStatus(databasePath, workflowId, "analyze-req");
		assert.equal(first.taskId, firstTask.id, "first dispatch should target analyze-req");

		// Complete analyst
		runtime.completeAttempt(workflowId, first.attemptId, analysisRoleResult(workflowId, first.attemptId, setupEvidence(runtime, workflowId)));

		// #20 双闸：review-req 完成复审并 approve analysis 后，design-sol 才就绪
		reviewAndApproveAnalysis(runtime, databasePath, workflowId);

		// Second ready task should be design-sol (deps satisfied, analysis approved)
		const second = runtime.beginAttempt(workflowId);
		const secondTask = queryTaskStatus(databasePath, workflowId, "design-sol");
		assert.equal(second.taskId, secondTask.id, "second dispatch should target design-sol");

		// Complete architect
		runtime.completeAttempt(workflowId, second.attemptId, designRoleResult(workflowId, second.attemptId, setupEvidence(runtime, workflowId)));

		// No more ready tasks
		const third = runtime.beginAttempt(workflowId);
		assert.equal(third.taskId, 0, "no more ready tasks after plan complete");
	});
});
