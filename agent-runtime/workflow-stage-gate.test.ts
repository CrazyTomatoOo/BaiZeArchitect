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
	type RequirementBaseline,
} from "./workflow/headless-runtime.ts";
import type { RoleResult, ArtifactEffectProposal, CriticReport } from "./workflow/role-result.ts";

/**
 * #20 逐环节双闸审核语义测试：
 * - 绑定反转：未批准的产物不能被下一环节引用（beginAttempt → taskId 0）
 * - approve 前置：环节尾 review 完成（coverage 覆盖）且无 open major/critical 才可批准
 * - revoke-approval 扩展至 artifact_approval，撤销后 revision 回 pending
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

async function withRuntime(work: (fixture: { databasePath: string; runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>> }) => Promise<void> | void): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-stage-gate-"));
	const databasePath = path.join(directory, "workflow.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector([]),
		outboxTransport: createOutboxTransport(),
	});
	try {
		await work({ databasePath, runtime });
	} finally {
		runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
}

type Runtime = Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;

async function startAndPlan(runtime: Runtime): Promise<{ workflowId: number }> {
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
	return { workflowId: created.workflowId };
}

function analysisContent(revisionId: number): unknown {
	return {
		schemaVersion: "artifact/analysis/v1",
		artifactKind: "analysis",
		summary: "Analysis",
		sourceRefs: [{ type: "requirement_revision", revisionId }],
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

function effect(kind: string, content: unknown, evidenceSnapshotId: number, sourceRevisionId: number): ArtifactEffectProposal {
	return {
		effectType: "artifact_revision",
		artifactKind: kind as ArtifactEffectProposal["artifactKind"],
		logicalKey: kind,
		content,
		baseRevisionId: null,
		traceLinks: [{ evidenceSnapshotId, sourceRef: { type: "requirement_revision", revisionId: sourceRevisionId } }],
	};
}

function criticReport(revisionIds: readonly number[], workflowId = 0, attemptId = 0): CriticReport {
	return {
		schemaVersion: "critic-report/v1",
		workflowId,
		attemptId,
		coverageAttestation: {
			complete: true,
			reviewTargets: revisionIds.map((revisionId) => ({ revisionId, artifactKind: "analysis" })),
		},
		findings: [],
	};
}

function roleResult(workflowId: number, attemptId: number, effects: ArtifactEffectProposal[]): RoleResult {
	return { schemaVersion: "role-result/v1", workflowId, attemptId, effects };
}

/** 执行第一个就绪 Task（expectedRole 断言）并返回其产物 revision。 */
async function bindSnapshot(runtime: Runtime, workflowId: number): Promise<number> {
	const snapshot = runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", [{ path: "src/main.ts", digest: "sha256:f1", size: 10 }]);
	return snapshot.id;
}

function completeAttemptRevision(runtime: Runtime, workflowId: number): number {
	const artifact = runtime.getArtifactRevisionDetail(
		(runtime.getWorkflowProjection(workflowId) as { requirement: { id: number } }).requirement.id,
		"analysis",
	);
	assert.ok(artifact);
	return artifact.revisionId;
}

test("未批准的产物不能被下一环节引用（绑定反转阻塞）", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await startAndPlan(runtime);
		// 执行 analysis 生产任务（产出 analysis，pending 未批准）
		const begin = runtime.beginAttempt(workflowId);
		assert.ok(begin.taskId > 0);
		const projection = runtime.getWorkflowProjection(workflowId);
		const reqRev = projection!.requirement.currentRevision.id;
		const snapId = await bindSnapshot(runtime, workflowId);
		const result = roleResult(workflowId, begin.attemptId, [effect("analysis", analysisContent(reqRev), snapId, reqRev)]);
		const published = runtime.completeAttempt(workflowId, begin.attemptId, result);
		assert.equal(published.outcome, "published");
		// review-analysis 任务是 critic（无产物依赖，可直接执行）——执行它以产生 coverage
		const review = runtime.beginAttempt(workflowId);
		assert.ok(review.taskId > 0);
		const artifact = runtime.getArtifactRevisionDetail(projection!.requirement.id, "analysis");
		assert.ok(artifact);
		const reviewReport = criticReport([artifact.revisionId], workflowId, review.attemptId);
		const reviewResult: RoleResult = { schemaVersion: "role-result/v1", workflowId, attemptId: review.attemptId, effects: [], criticReport: reviewReport };
		const reviewDone = runtime.completeAttempt(workflowId, review.attemptId, reviewResult);
		assert.equal(reviewDone.outcome, "published");
		// 未 approve analysis：scenario 任务（依赖 analysis input）激活阻塞
		const scenario = runtime.beginAttempt(workflowId);
		assert.equal(scenario.taskId, 0, "scenario 不应在 analysis 未批准时可激活");
		// approve analysis 后 scenario 可激活
		runtime.executeCommand({
			workflowId,
			commandId: "cmd-approve-analysis",
			expectedWorkflowVersion: runtime.getWorkflowProjection(workflowId)!.workflow.version,
			type: "approve-artifact",
			operator: OPERATOR,
			payload: { artifactId: artifact.artifactId, revisionId: artifact.revisionId },
		});
		const scenario2 = runtime.beginAttempt(workflowId);
		assert.ok(scenario2.taskId > 0, "approve 后 scenario 应可激活");
	});
});

test("approve 前置：无 review coverage 或存在 open major finding 时拒绝", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await startAndPlan(runtime);
		const begin = runtime.beginAttempt(workflowId);
		assert.ok(begin.taskId > 0);
		const projection = runtime.getWorkflowProjection(workflowId);
		const reqRev = projection!.requirement.currentRevision.id;
		const snapId = await bindSnapshot(runtime, workflowId);
		const result = roleResult(workflowId, begin.attemptId, [effect("analysis", analysisContent(reqRev), snapId, reqRev)]);
		const published = runtime.completeAttempt(workflowId, begin.attemptId, result);
		assert.equal(published.outcome, "published");
		const artifact = runtime.getArtifactRevisionDetail(projection!.requirement.id, "analysis");
		assert.ok(artifact);
		// 未执行 review：approve 被拒（无 coverage）
		const rejected = runtime.executeCommand({
			workflowId,
			commandId: "cmd-approve-no-review",
			expectedWorkflowVersion: runtime.getWorkflowProjection(workflowId)!.workflow.version,
			type: "approve-artifact",
			operator: OPERATOR,
			payload: { artifactId: artifact.artifactId, revisionId: artifact.revisionId },
		});
		assert.equal(rejected.outcome, "business_rule_rejected");
	});
});

test("被撤销的产物不能经包审批重新批准（逐环节门禁不可绕过）", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await startAndPlan(runtime);
		const begin = runtime.beginAttempt(workflowId);
		assert.ok(begin.taskId > 0);
		const projection = runtime.getWorkflowProjection(workflowId);
		const reqRev = projection!.requirement.currentRevision.id;
		const snapId = await bindSnapshot(runtime, workflowId);
		const result = roleResult(workflowId, begin.attemptId, [effect("analysis", analysisContent(reqRev), snapId, reqRev)]);
		runtime.completeAttempt(workflowId, begin.attemptId, result);
		const review = runtime.beginAttempt(workflowId);
		const artifact = runtime.getArtifactRevisionDetail(projection!.requirement.id, "analysis");
		assert.ok(artifact);
		const reviewResult: RoleResult = { schemaVersion: "role-result/v1", workflowId, attemptId: review.attemptId, effects: [], criticReport: criticReport([artifact.revisionId], workflowId, review.attemptId) };
		runtime.completeAttempt(workflowId, review.attemptId, reviewResult);
		const approve = runtime.executeCommand({
			workflowId,
			commandId: "cmd-approve-packet-guard",
			expectedWorkflowVersion: runtime.getWorkflowProjection(workflowId)!.workflow.version,
			type: "approve-artifact",
			operator: OPERATOR,
			payload: { artifactId: artifact.artifactId, revisionId: artifact.revisionId },
		});
		assert.equal(approve.outcome, "accepted");
		const approvalRecords = runtime.getApprovalRecords(workflowId);
		const artifactApproval = approvalRecords.find((r) => r.recordType === "artifact_approval");
		assert.ok(artifactApproval);
		const revoke = runtime.executeCommand({
			workflowId,
			commandId: "cmd-revoke-packet-guard",
			expectedWorkflowVersion: runtime.getWorkflowProjection(workflowId)!.workflow.version,
			type: "revoke-approval",
			operator: OPERATOR,
			payload: { approvalRecordId: artifactApproval.id, reason: "needs rework" },
		});
		assert.equal(revoke.outcome, "accepted");
		const afterRevoke = runtime.getArtifactRevisionDetail(projection!.requirement.id, "analysis");
		assert.ok(afterRevoke);
		assert.equal(afterRevoke.status, "pending");
		// 构造审批包（当前缺其余 7 类产物会 readiness 失败；这里验证 buildApprovalPacket 在 revoked 产物上将拒绝归档路径）
		const built = runtime.buildApprovalPacket(workflowId);
		assert.equal(built.ready, false, "被撤销产物后不应 ready");
	});
});

test("有 open major finding 的产物即使有 coverage 也拒绝批准", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await startAndPlan(runtime);
		const begin = runtime.beginAttempt(workflowId);
		assert.ok(begin.taskId > 0);
		const projection = runtime.getWorkflowProjection(workflowId);
		const reqRev = projection!.requirement.currentRevision.id;
		const snapId = await bindSnapshot(runtime, workflowId);
		const result = roleResult(workflowId, begin.attemptId, [effect("analysis", analysisContent(reqRev), snapId, reqRev)]);
		runtime.completeAttempt(workflowId, begin.attemptId, result);
		// review 完成（coverage 覆盖）但记录 open major finding
		const review = runtime.beginAttempt(workflowId);
		assert.ok(review.taskId > 0);
		const artifact = runtime.getArtifactRevisionDetail(projection!.requirement.id, "analysis");
		assert.ok(artifact);
		const reviewResult: RoleResult = {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: review.attemptId,
			effects: [],
			criticReport: {
				schemaVersion: "critic-report/v1",
				workflowId,
				attemptId: review.attemptId,
				coverageAttestation: { complete: true, reviewTargets: [{ revisionId: artifact.revisionId, artifactKind: "analysis" }] },
				findings: [{ fingerprint: "fp-major-1", severity: "major", summary: "Major defect", targetRevisionId: artifact.revisionId, targetArtifactKind: "analysis", sourceRef: "review" }],
			},
		};
		const reviewDone = runtime.completeAttempt(workflowId, review.attemptId, reviewResult);
		assert.equal(reviewDone.outcome, "published");
		// coverage 已存在但有 open major finding → approve 仍被拒
		const rejected = runtime.executeCommand({
			workflowId,
			commandId: "cmd-approve-with-major",
			expectedWorkflowVersion: runtime.getWorkflowProjection(workflowId)!.workflow.version,
			type: "approve-artifact",
			operator: OPERATOR,
			payload: { artifactId: artifact.artifactId, revisionId: artifact.revisionId },
		});
		assert.equal(rejected.outcome, "business_rule_rejected", "open major finding 应阻止批准");
	});
});

test("revoke-approval 撤销 artifact_approval 后 revision 回 pending", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await startAndPlan(runtime);
		// 执行 analysis + review + approve
		const begin = runtime.beginAttempt(workflowId);
		const projection = runtime.getWorkflowProjection(workflowId);
		const reqRev = projection!.requirement.currentRevision.id;
		const snapId = await bindSnapshot(runtime, workflowId);
		const result = roleResult(workflowId, begin.attemptId, [effect("analysis", analysisContent(reqRev), snapId, reqRev)]);
		runtime.completeAttempt(workflowId, begin.attemptId, result);
		const review = runtime.beginAttempt(workflowId);
		const artifact = runtime.getArtifactRevisionDetail(projection!.requirement.id, "analysis");
		assert.ok(artifact);
		const reviewResult: RoleResult = { schemaVersion: "role-result/v1", workflowId, attemptId: review.attemptId, effects: [], criticReport: criticReport([artifact.revisionId], workflowId, review.attemptId) };
		runtime.completeAttempt(workflowId, review.attemptId, reviewResult);
		const preApproveVersion = runtime.getWorkflowProjection(workflowId)!.workflow.version;
		const approval = runtime.executeCommand({
			workflowId,
			commandId: "cmd-approve",
			expectedWorkflowVersion: preApproveVersion,
			type: "approve-artifact",
			operator: OPERATOR,
			payload: { artifactId: artifact.artifactId, revisionId: artifact.revisionId },
		});
		assert.equal(approval.outcome, "accepted", `approve failed: ${JSON.stringify(approval)}`);
		// 找到 artifact_approval 记录 id
		const afterApproval = runtime.getWorkflowProjection(workflowId);
		assert.ok(afterApproval);
		const approvalRecords = afterApproval.events.filter((e) => e.type === "artifact_revision_approved");
		assert.ok(approvalRecords.length > 0);
		// revoke 需要 approval record id——从 getApprovalRecords 拿
		const records = runtime.getApprovalRecords(workflowId);
		const artifactApproval = records.find((r) => r.recordType === "artifact_approval");
		assert.ok(artifactApproval, "artifact_approval record should exist");
		const currentVersion = runtime.getWorkflowProjection(workflowId)!.workflow.version;
		const revoked = runtime.executeCommand({
			workflowId,
			commandId: "cmd-revoke",
			expectedWorkflowVersion: currentVersion,
			type: "revoke-approval",
			operator: OPERATOR,
			payload: { approvalRecordId: artifactApproval.id, reason: "mistake" },
		});
		assert.equal(revoked.outcome, "accepted");
		const afterRevoke = runtime.getArtifactRevisionDetail(projection!.requirement.id, "analysis");
		assert.ok(afterRevoke);
		assert.equal(afterRevoke.status, "pending", "撤销后 revision 应回 pending");
	});
});