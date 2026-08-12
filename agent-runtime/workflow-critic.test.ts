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
} from "./testing/deterministic-fixtures.js";
import { ScriptedModelDriver } from "./testing/scripted-model-driver.js";
import {
	openHeadlessWorkflowRuntime,
	type RequirementBaseline,
} from "./workflow/headless-runtime.js";
import type { PlanProposal } from "./workflow/plan-types.js";
import type { CriticReport, RoleResult, TraceLinkProposal } from "./workflow/role-result.js";

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Add expiry reminders and controlled compensation.",
	sourceRefs: [],
	title: "Points expiry and compensation",
	description: "Add expiry reminders and controlled compensation.",
};

const OPERATOR = createFixtureOperator("alice");

interface CriticFixture {
	databasePath: string;
	runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;
}

async function withCriticRuntime(work: (fixture: CriticFixture) => Promise<void> | void): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-critic-"));
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

type Runtime = CriticFixture["runtime"];

async function createWorkflowWithReviewPlan(runtime: Runtime): Promise<{ workflowId: number; contextDigest: string }> {
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
			structuredResult: reviewPlanProposal(created.workflowId, contextDigest),
			modelUsage: { inputTokens: 100, outputTokens: 200 },
		},
	]);
	await runtime.planWorkflow(created.workflowId, driver);
	driver.assertExhausted();
	return { workflowId: created.workflowId, contextDigest };
}

function reviewPlanProposal(workflowId: number, contextDigest: string): PlanProposal {
	return {
		schemaVersion: "plan-proposal/v1",
		base: { workflowId, workflowVersion: 1, basePlanRevisionId: null, planningContextDigest: contextDigest },
		objective: "Analyze then review",
		tasks: [
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
				key: "review-req",
				kind: "review",
				role: "critic",
				objective: "Review analysis",
				dependsOn: ["analyze-req"],
				inputs: [{ type: "task_output", taskKey: "analyze-req", artifactKind: "analysis", purpose: "review" }],
				expectedArtifactEffects: [],
				completionPolicyRef: "review/v1",
				maxAttempts: 3,
			},
		],
		rationale: "Analyze then review",
	};
}

function validAnalysisContent(): unknown {
	return {
		schemaVersion: "artifact/analysis/v1",
		artifactKind: "analysis",
		summary: "Analysis of points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		goals: ["Understand expiry"],
		nonGoals: ["Design solution"],
		constraints: ["Backward compatible"],
		acceptanceCriteria: ["Tests pass"],
		impactProfile: {
			process: { status: "yes", rationale: "Flow changes" },
			actors: { status: "yes", rationale: "Users affected" },
			behavior: { status: "yes", rationale: "New behavior" },
			architecture: { status: "no", rationale: "No arch change" },
			data: { status: "no", rationale: "No data change" },
			api: { status: "no", rationale: "No API change" },
		},
		openQuestions: [],
	};
}

function setupEvidence(runtime: Runtime, workflowId: number): TraceLinkProposal {
	const snapshot = runtime.bindEvidenceSnapshot(workflowId, "sha256:repo-abc", { files: [] });
	return { evidenceSnapshotId: snapshot.id, sourceRef: { type: "code", path: "/src/analysis.ts" } };
}

function validAnalysisRoleResult(workflowId: number, attemptId: number, traceLinks: TraceLinkProposal[]): RoleResult {
	return {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId,
		effects: [
			{
				effectType: "artifact_revision",
				artifactKind: "analysis",
				logicalKey: "analysis",
				content: validAnalysisContent(),
				baseRevisionId: null,
				traceLinks,
			},
		],
	};
}

function criticReportWithFindings(
	workflowId: number,
	attemptId: number,
	targetRevisionId: number,
	findings: Array<{ fingerprint: string; severity: string; summary: string; resolved?: boolean }>,
): CriticReport {
	return {
		schemaVersion: "critic-report/v1",
		workflowId,
		attemptId,
		coverageAttestation: {
			reviewTargets: [{ revisionId: targetRevisionId, artifactKind: "analysis" }],
			complete: true,
		},
		findings: findings.map((f) => ({
			fingerprint: f.fingerprint,
			severity: f.severity as "critical" | "major" | "minor" | "info",
			summary: f.summary,
			targetRevisionId,
			targetArtifactKind: "analysis" as const,
			sourceRef: "review-req",
			resolved: f.resolved,
		})),
	};
}

function emptyCriticReport(workflowId: number, attemptId: number, targetRevisionId: number): CriticReport {
	return {
		schemaVersion: "critic-report/v1",
		workflowId,
		attemptId,
		coverageAttestation: {
			reviewTargets: [{ revisionId: targetRevisionId, artifactKind: "analysis" }],
			complete: true,
		},
		findings: [],
	};
}

function getAnalysisRevisionId(databasePath: string): number {
	const db = new Database(databasePath, { readonly: true });
	try {
		const row = db
			.prepare("select ar.id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.kind = 'analysis' order by ar.id desc limit 1")
			.get() as { id: number } | undefined;
		assert.ok(row, "analysis revision should exist");
		return row.id;
	} finally {
		db.close();
	}
}

async function executeAnalysisTask(runtime: Runtime, workflowId: number): Promise<void> {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskKey, "analyze-req");
	const traceLinks = [setupEvidence(runtime, workflowId)];
	const complete = runtime.completeAttempt(workflowId, begin.attemptId, validAnalysisRoleResult(workflowId, begin.attemptId, traceLinks));
	assert.equal(complete.outcome, "published");
}

function executeReviewTask(runtime: Runtime, workflowId: number, report: CriticReport): { attemptId: number; outcome: string } {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskKey, "review-req");
	assert.equal(begin.taskRole, "critic");
	report.attemptId = begin.attemptId;
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [],
		criticReport: report,
	};
	const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
	return { attemptId: begin.attemptId, outcome: complete.outcome };
}

test("zero findings with complete coverage attestation succeeds", async () => {
	await withCriticRuntime(async ({ databasePath, runtime }) => {
		const { workflowId } = await createWorkflowWithReviewPlan(runtime);
		await executeAnalysisTask(runtime, workflowId);
		const revisionId = getAnalysisRevisionId(databasePath);
		const report = emptyCriticReport(workflowId, 0, revisionId);
		const { outcome } = executeReviewTask(runtime, workflowId, report);
		assert.equal(outcome, "published");
		assert.equal(runtime.getFindings(workflowId).length, 0);
	});
});

test("four severity levels create findings with correct severity", async () => {
	await withCriticRuntime(async ({ databasePath, runtime }) => {
		const { workflowId } = await createWorkflowWithReviewPlan(runtime);
		await executeAnalysisTask(runtime, workflowId);
		const revisionId = getAnalysisRevisionId(databasePath);
		const report = criticReportWithFindings(workflowId, 0, revisionId, [
			{ fingerprint: "fp-critical", severity: "critical", summary: "Critical issue" },
			{ fingerprint: "fp-major", severity: "major", summary: "Major issue" },
			{ fingerprint: "fp-minor", severity: "minor", summary: "Minor issue" },
			{ fingerprint: "fp-info", severity: "info", summary: "Info issue" },
		]);
		const { outcome } = executeReviewTask(runtime, workflowId, report);
		assert.equal(outcome, "published");
		const findings = runtime.getFindings(workflowId);
		assert.equal(findings.length, 4);
		assert.deepEqual(findings.map((f) => f.severity).sort(), ["critical", "info", "major", "minor"]);
		const threads = runtime.getFindingThreads(workflowId);
		assert.equal(threads.length, 4);
	});
});

test("fingerprint stable across revisions maintains thread identity", async () => {
	await withCriticRuntime(async ({ databasePath, runtime }) => {
		const { workflowId } = await createWorkflowWithReviewPlan(runtime);
		await executeAnalysisTask(runtime, workflowId);
		const revisionId = getAnalysisRevisionId(databasePath);
		const report = criticReportWithFindings(workflowId, 0, revisionId, [
			{ fingerprint: "fp-stable", severity: "major", summary: "Same issue" },
		]);
		executeReviewTask(runtime, workflowId, report);
		const threads = runtime.getFindingThreads(workflowId);
		assert.equal(threads.length, 1);
		assert.equal(threads[0].fingerprint, "fp-stable");
	});
});

test("different fingerprints create different threads", async () => {
	await withCriticRuntime(async ({ databasePath, runtime }) => {
		const { workflowId } = await createWorkflowWithReviewPlan(runtime);
		await executeAnalysisTask(runtime, workflowId);
		const revisionId = getAnalysisRevisionId(databasePath);
		const report = criticReportWithFindings(workflowId, 0, revisionId, [
			{ fingerprint: "fp-alpha", severity: "minor", summary: "Alpha" },
			{ fingerprint: "fp-beta", severity: "minor", summary: "Beta" },
		]);
		executeReviewTask(runtime, workflowId, report);
		const threads = runtime.getFindingThreads(workflowId);
		assert.equal(threads.length, 2);
		assert.deepEqual(threads.map((t) => t.fingerprint).sort(), ["fp-alpha", "fp-beta"]);
	});
});

test("critic cannot produce artifact effects", async () => {
	await withCriticRuntime(async ({ runtime }) => {
		const { workflowId } = await createWorkflowWithReviewPlan(runtime);
		await executeAnalysisTask(runtime, workflowId);
		const begin = runtime.beginAttempt(workflowId);
		assert.equal(begin.taskRole, "critic");
		const result: RoleResult = {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: begin.attemptId,
			effects: [{
				effectType: "artifact_revision",
				artifactKind: "analysis",
				logicalKey: "analysis",
				content: validAnalysisContent(),
				baseRevisionId: null,
			}],
		};
		const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
		assert.equal(complete.outcome, "failed");
		assert.equal(complete.failureCode, "critic_effect_violation");
	});
});

test("missing criticReport fails the attempt", async () => {
	await withCriticRuntime(async ({ runtime }) => {
		const { workflowId } = await createWorkflowWithReviewPlan(runtime);
		await executeAnalysisTask(runtime, workflowId);
		const begin = runtime.beginAttempt(workflowId);
		const result: RoleResult = {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: begin.attemptId,
			effects: [],
		};
		const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
		assert.equal(complete.outcome, "failed");
		assert.equal(complete.failureCode, "invalid_critic_report");
	});
});

test("incomplete coverage with zero findings fails", async () => {
	await withCriticRuntime(async ({ databasePath, runtime }) => {
		const { workflowId } = await createWorkflowWithReviewPlan(runtime);
		await executeAnalysisTask(runtime, workflowId);
		const revisionId = getAnalysisRevisionId(databasePath);
		const begin = runtime.beginAttempt(workflowId);
		const report: CriticReport = {
			schemaVersion: "critic-report/v1",
			workflowId,
			attemptId: begin.attemptId,
			coverageAttestation: { reviewTargets: [{ revisionId, artifactKind: "analysis" }], complete: false },
			findings: [],
		};
		const result: RoleResult = {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: begin.attemptId,
			effects: [],
			criticReport: report,
		};
		const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
		assert.equal(complete.outcome, "failed");
		assert.equal(complete.failureCode, "incomplete_coverage");
	});
});

test("major finding risk acceptance is recorded", async () => {
	await withCriticRuntime(async ({ databasePath, runtime }) => {
		const { workflowId } = await createWorkflowWithReviewPlan(runtime);
		await executeAnalysisTask(runtime, workflowId);
		const revisionId = getAnalysisRevisionId(databasePath);
		const report = criticReportWithFindings(workflowId, 0, revisionId, [
			{ fingerprint: "fp-risk", severity: "major", summary: "Risk issue" },
		]);
		executeReviewTask(runtime, workflowId, report);
		const findings = runtime.getFindings(workflowId);
		assert.equal(findings.length, 1);
		const findingId = findings[0].id;
		runtime.acceptFindingRisk(workflowId, findingId, "bob", "Acceptable risk for now");
		const updated = runtime.getFindings(workflowId)[0];
		assert.equal(updated.status, "risk_accepted");
		assert.equal(updated.riskAcceptedBy, "bob");
		assert.equal(updated.riskAcceptanceReason, "Acceptable risk for now");
	});
});

test("critical finding cannot be risk accepted", async () => {
	await withCriticRuntime(async ({ databasePath, runtime }) => {
		const { workflowId } = await createWorkflowWithReviewPlan(runtime);
		await executeAnalysisTask(runtime, workflowId);
		const revisionId = getAnalysisRevisionId(databasePath);
		const report = criticReportWithFindings(workflowId, 0, revisionId, [
			{ fingerprint: "fp-crit", severity: "critical", summary: "Critical" },
		]);
		executeReviewTask(runtime, workflowId, report);
		const findingId = runtime.getFindings(workflowId)[0].id;
		assert.throws(
			() => runtime.acceptFindingRisk(workflowId, findingId, "bob", "try"),
			/Critical findings cannot be risk accepted/,
		);
	});
});
