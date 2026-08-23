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
} from "./testing/deterministic-fixtures.ts";
import {
	openHeadlessWorkflowRuntime,
	type HeadlessWorkflowRuntime,
	type RequirementBaseline,
} from "./workflow/headless-runtime.ts";
import type { RoleResult, ArtifactEffectProposal, CriticReport } from "./workflow/role-result.ts";

/**
 * #21 引擎自动返工语义测试：
 * - reject → 引擎生成新 PlanRevision（rework Task + review Task），旧计划 supersede 留档
 * - 返工产物重新批准后，后续环节引用最新 approved revision
 * - 同 kind 累计 reject ≥2 → finding_disposition 门禁升级（不再自动返工）
 */

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Add expiry reminders and controlled compensation.",
	sourceRefs: [],
	title: "Points expiry and compensation",
	description: "Add expiry reminders and controlled compensation.",
};

const OPERATOR: FixtureOperator = createFixtureOperator("alice");

async function withRuntime(work: (fixture: { runtime: HeadlessWorkflowRuntime }) => Promise<void> | void): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-rework-"));
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath: path.join(directory, "workflow.db"),
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector([]),
		outboxTransport: createOutboxTransport(),
	});
	try {
		await work({ runtime });
	} finally {
		runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
}

type Runtime = HeadlessWorkflowRuntime;

async function startAndPlan(runtime: Runtime): Promise<number> {
	const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
	const created = runtime.createRequirement({ workspaceId, baseline: BASELINE });
	runtime.executeCommand({
		workflowId: created.workflowId,
		commandId: "cmd-start",
		expectedWorkflowVersion: 0,
		type: "start",
		operator: OPERATOR,
	});
	const result = await runtime.planWorkflow(created.workflowId, null);
	assert.equal(result.outcome, "adopted");
	return created.workflowId;
}

function analysisContent(revId: number): unknown {
	return {
		schemaVersion: "artifact/analysis/v1",
		artifactKind: "analysis",
		summary: "Analysis",
		sourceRefs: [{ type: "requirement_revision", revisionId: revId }],
		goals: ["g"],
		nonGoals: [],
		constraints: [],
		acceptanceCriteria: ["ok"],
		impactProfile: {
			process: { status: "no", rationale: "r" },
			actors: { status: "no", rationale: "r" },
			behavior: { status: "no", rationale: "r" },
			architecture: { status: "no", rationale: "r" },
			data: { status: "no", rationale: "r" },
			api: { status: "no", rationale: "r" },
		},
		openQuestions: [],
	};
}

function analysisEffect(evidenceSnapshotId: number, sourceRevId: number, baseRevisionId: number | null = null): ArtifactEffectProposal {
	return {
		effectType: "artifact_revision",
		artifactKind: "analysis",
		logicalKey: "analysis",
		content: analysisContent(sourceRevId),
		baseRevisionId,
		traceLinks: [{ evidenceSnapshotId, sourceRef: { type: "requirement_revision", revisionId: sourceRevId } }],
	};
}

function criticReport(revisionIds: readonly number[], workflowId: number, attemptId: number): CriticReport {
	return {
		schemaVersion: "critic-report/v1",
		workflowId,
		attemptId,
		coverageAttestation: { complete: true, reviewTargets: revisionIds.map((revisionId) => ({ revisionId, artifactKind: "analysis" })) },
		findings: [],
	};
}

function roleResult(workflowId: number, attemptId: number, effects: ArtifactEffectProposal[]): RoleResult {
	return { schemaVersion: "role-result/v1", workflowId, attemptId, effects };
}

async function bindSnapshot(runtime: Runtime, workflowId: number): Promise<number> {
	const snapshot = runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", [{ path: "src/main.ts", digest: "sha256:f1", size: 10 }]);
	return snapshot.id;
}

function currentVersion(runtime: Runtime, workflowId: number): number {
	return runtime.getWorkflowProjection(workflowId)!.workflow.version;
}

/** 执行模板 analysis 环节：produce → review（coverage）→ 返回 artifact 详情。 */
async function produceAndReviewAnalysis(runtime: Runtime, workflowId: number): Promise<{ artifactId: number; revisionId: number }> {
	const projection = runtime.getWorkflowProjection(workflowId)!;
	const reqRev = projection.requirement.currentRevision.id;
	const snapId = await bindSnapshot(runtime, workflowId);
	const begin = runtime.beginAttempt(workflowId);
	assert.ok(begin.taskId > 0, "analysis task ready");
	assert.equal(begin.taskRole, "analysis-analyst");
	const published = runtime.completeAttempt(workflowId, begin.attemptId, roleResult(workflowId, begin.attemptId, [analysisEffect(snapId, reqRev)]));
	assert.equal(published.outcome, "published");
	const review = runtime.beginAttempt(workflowId);
	assert.ok(review.taskId > 0, "review-analysis task ready");
	const artifact = runtime.getArtifactRevisionDetail(projection.requirement.id, "analysis");
	assert.ok(artifact);
	const reviewDone = runtime.completeAttempt(workflowId, review.attemptId, {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: review.attemptId,
		effects: [],
		criticReport: criticReport([artifact.revisionId], workflowId, review.attemptId),
	});
	assert.equal(reviewDone.outcome, "published");
	return { artifactId: artifact.artifactId, revisionId: artifact.revisionId };
}

async function rejectAnalysis(runtime: Runtime, workflowId: number, artifactId: number, revisionId: number, commandId: string, reason: string) {
	const receipt = runtime.executeCommand({
		workflowId,
		commandId,
		expectedWorkflowVersion: currentVersion(runtime, workflowId),
		type: "reject-artifact",
		operator: OPERATOR,
		payload: { artifactId, revisionId, reason },
	});
	return receipt;
}

test("reject 触发引擎生成 rework 新计划（rework+review Task、旧计划留档）", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await startAndPlan(runtime);
		const { artifactId, revisionId } = await produceAndReviewAnalysis(runtime, workflowId);
		const beforePlan = runtime.getWorkflowProjection(workflowId)!.workflow.currentPlanRevisionId;
		const receipt = await rejectAnalysis(runtime, workflowId, artifactId, revisionId, "cmd-reject-1", "analysis wrong");
		assert.equal(receipt.outcome, "accepted");
		const projection = runtime.getWorkflowProjection(workflowId)!;
		const afterPlan = projection.workflow.currentPlanRevisionId;
		assert.notEqual(afterPlan, beforePlan, "reject 应生成新 PlanRevision");
		// 新计划含 rework-analysis + review-analysis-rework
		const plan = runtime.getPlanRevisionDetail(afterPlan!);
		assert.ok(plan);
		const keys = plan.proposal.tasks.map((t) => t.key).sort();
		assert.deepEqual(keys, ["review-analysis-rework", "rework-analysis"]);
		// 旧计划 superseded 留档
		const oldPlan = runtime.getPlanRevisionDetail(beforePlan!);
		assert.ok(oldPlan);
		assert.equal(oldPlan.status, "superseded", "旧计划应 superseded 留档");
		// 新计划第一个任务 = rework（role analysis-analyst）
		const first = runtime.beginAttempt(workflowId);
		assert.ok(first.taskId > 0);
		assert.equal(first.taskRole, "analysis-analyst");
	});
});

test("返工产物重新批准后，后续环节引用最新 approved revision", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await startAndPlan(runtime);
		const first = await produceAndReviewAnalysis(runtime, workflowId);
		await rejectAnalysis(runtime, workflowId, first.artifactId, first.revisionId, "cmd-reject-1", "needs rework");
		// 执行 rework 任务（产新 revision）+ review
		const rework = runtime.beginAttempt(workflowId);
		assert.ok(rework.taskId > 0);
		assert.equal(rework.taskRole, "analysis-analyst");
		const projection = runtime.getWorkflowProjection(workflowId)!;
		const reqRev = projection.requirement.currentRevision.id;
		const snapId = await bindSnapshot(runtime, workflowId);
		const reworkDone = runtime.completeAttempt(workflowId, rework.attemptId, roleResult(workflowId, rework.attemptId, [analysisEffect(snapId, reqRev, first.revisionId)]));
		assert.equal(reworkDone.outcome, "published");
		const reworked = runtime.getArtifactRevisionDetail(projection.requirement.id, "analysis");
		assert.ok(reworked);
		assert.equal(reworked.revisionNo, 2, "返工产生新 revision");
		const review = runtime.beginAttempt(workflowId);
		assert.ok(review.taskId > 0);
		const reviewDone = runtime.completeAttempt(workflowId, review.attemptId, {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: review.attemptId,
			effects: [],
			criticReport: criticReport([reworked.revisionId], workflowId, review.attemptId),
		});
		assert.equal(reviewDone.outcome, "published");
		// approve 返工产物
		const approve = runtime.executeCommand({
			workflowId,
			commandId: "cmd-approve-rework",
			expectedWorkflowVersion: currentVersion(runtime, workflowId),
			type: "approve-artifact",
			operator: OPERATOR,
			payload: { artifactId: reworked.artifactId, revisionId: reworked.revisionId },
		});
		assert.equal(approve.outcome, "accepted", `approve result: ${JSON.stringify(approve)}`);
		console.log("post-approve plan:", runtime.getWorkflowProjection(workflowId)!.workflow.currentPlanRevisionId);
		// 下一环节（scenario）应可激活 —— 绑定解析最新 approved revision
		const scenario = runtime.beginAttempt(workflowId);
		assert.ok(scenario.taskId > 0, "scenario 应引用返工后已批准的 analysis");
	});
});

test("升级的 finding_disposition 门禁可经 accept-finding-risk 关闭", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await startAndPlan(runtime);
		// 两次 reject 触发预算耗尽
		const first = await produceAndReviewAnalysis(runtime, workflowId);
		await rejectAnalysis(runtime, workflowId, first.artifactId, first.revisionId, "cmd-reject-1", "first reject");
		const rework = runtime.beginAttempt(workflowId);
		assert.ok(rework.taskId > 0);
		const projection = runtime.getWorkflowProjection(workflowId)!;
		const snapId = await bindSnapshot(runtime, workflowId);
		runtime.completeAttempt(workflowId, rework.attemptId, roleResult(workflowId, rework.attemptId, [analysisEffect(snapId, projection.requirement.currentRevision.id, first.revisionId)]));
		const reworked = runtime.getArtifactRevisionDetail(projection.requirement.id, "analysis");
		assert.ok(reworked);
		const review = runtime.beginAttempt(workflowId);
		runtime.completeAttempt(workflowId, review.attemptId, {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: review.attemptId,
			effects: [],
			criticReport: criticReport([reworked.revisionId], workflowId, review.attemptId),
		});
		await rejectAnalysis(runtime, workflowId, reworked.artifactId, reworked.revisionId, "cmd-reject-2", "second reject");
		// 门禁已开：有 open major finding 指向被拒 revision
		const after = runtime.getWorkflowProjection(workflowId)!;
		assert.equal(after.workflow.state, "waiting_for_human");
		const escalated = runtime.getFindings(workflowId).find((f) => f.fingerprint === `reject:analysis:${first.artifactId}`);
		assert.ok(escalated, "escalation 应创建 major finding");
		assert.equal(escalated.severity, "major");
		// accept-finding-risk（命令路径）关闭门禁，gate resolve
		const accept = runtime.executeCommand({
			workflowId,
			commandId: "cmd-accept-risk",
			expectedWorkflowVersion: currentVersion(runtime, workflowId),
			type: "accept-finding-risk",
			operator: OPERATOR,
			payload: { findingId: escalated.id, targetRevisionId: escalated.targetRevisionId, impact: "major", reason: "Accept rework risk" },
		});
		assert.equal(accept.outcome, "accepted", `accept result: ${JSON.stringify(accept)}`);
		const gates = runtime.getHumanGates(workflowId);
		assert.equal(gates.filter((g) => g.status === "open").length, 0, "accept-finding-risk 应 resolve human gate");
	});
});

test("同 kind 累计 reject ≥2 升级 finding_disposition 门禁（不再自动返工）", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await startAndPlan(runtime);
		// 第一次 reject → rework 计划
		const first = await produceAndReviewAnalysis(runtime, workflowId);
		const r1 = await rejectAnalysis(runtime, workflowId, first.artifactId, first.revisionId, "cmd-reject-1", "first reject");
		assert.equal(r1.outcome, "accepted");
		const plan1 = runtime.getWorkflowProjection(workflowId)!.workflow.currentPlanRevisionId;
		// 第二次 reject（同一 artifact kind）→ 预算耗尽，升门禁
		// 重做 analysis 产生新 revision 再 reject
		const rework = runtime.beginAttempt(workflowId);
		assert.ok(rework.taskId > 0);
		const projection = runtime.getWorkflowProjection(workflowId)!;
		const snapId = await bindSnapshot(runtime, workflowId);
		runtime.completeAttempt(workflowId, rework.attemptId, roleResult(workflowId, rework.attemptId, [analysisEffect(snapId, projection.requirement.currentRevision.id, first.revisionId)]));
		const reworked = runtime.getArtifactRevisionDetail(projection.requirement.id, "analysis");
		assert.ok(reworked);
		const review = runtime.beginAttempt(workflowId);
		runtime.completeAttempt(workflowId, review.attemptId, {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: review.attemptId,
			effects: [],
			criticReport: criticReport([reworked.revisionId], workflowId, review.attemptId),
		});
		const r2 = await rejectAnalysis(runtime, workflowId, reworked.artifactId, reworked.revisionId, "cmd-reject-2", "second reject");
		assert.equal(r2.outcome, "accepted", `r2: ${JSON.stringify(r2)}`);
		// 门禁升级：workflow 进入 waiting_for_human，不再产生新计划
		const after = runtime.getWorkflowProjection(workflowId)!;
		assert.equal(after.workflow.state, "waiting_for_human");
		// waiting_for_human 态 beginAttempt 拒绝（状态机不允许执行）
		assert.throws(() => runtime.beginAttempt(workflowId), /Cannot begin attempt on workflow in state waiting_for_human/);
		// human_gate 已开
		const gates = runtime.getHumanGates(workflowId);
		assert.ok(gates.length > 0, "finding_disposition gate should be open");
		assert.equal(gates[0]!.gateType, "finding_disposition");
		void plan1;
	});
});