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
import type { PlanProposal } from "./workflow/plan-types.js";
import type { RoleResult, TraceLinkProposal, ArtifactEffectProposal } from "./workflow/role-result.js";

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Add expiry reminders and controlled compensation.",
	sourceRefs: [],
	title: "Points expiry and compensation",
	description: "Add expiry reminders and controlled compensation.",
};

const OPERATOR: FixtureOperator = createFixtureOperator("alice");

interface Fixture {
	databasePath: string;
	runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;
	outbox: FixtureOutboxTransport;
	clock: FixtureClock;
}

async function withRuntime(
	work: (fixture: Fixture) => Promise<void> | void,
	options: { crashPoints?: readonly string[] } = {},
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-required-artifacts-"));
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

type Runtime = Fixture["runtime"];

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

async function createPlannedWorkflow(runtime: Runtime): Promise<{ workflowId: number; contextDigest: string }> {
	const { workflowId } = await createStartedWorkflow(runtime);
	const projectionBefore = runtime.getWorkflowProjection(workflowId);
	const prePlanningVersion = projectionBefore!.workflow.version;
	const begin = runtime.beginPlanning(workflowId);
	const contextDigest = runtime.getPlanningContextDigest(workflowId);
	const proposal: PlanProposal = {
		schemaVersion: "plan-proposal/v1",
		base: { workflowId, workflowVersion: prePlanningVersion, basePlanRevisionId: null, planningContextDigest: contextDigest },
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
		],
		rationale: "Analysis only",
	};
	runtime.completePlanning(workflowId, begin.attemptId, proposal);
	return { workflowId, contextDigest };
}

function validAnalysisContent(requirementRevisionId: number): unknown {
	return {
		schemaVersion: "artifact/analysis/v1",
		artifactKind: "analysis",
		summary: "Impact analysis for points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: requirementRevisionId }],
		goals: ["Understand impact"],
		nonGoals: ["Full rearchitecture"],
		constraints: ["Must be backward compatible"],
		acceptanceCriteria: ["Analysis covers all requirement aspects"],
		impactProfile: {
			process: { status: "no", rationale: "No process changes" },
			actors: { status: "no", rationale: "No actor changes" },
			behavior: { status: "no", rationale: "No behavior changes" },
			architecture: { status: "no", rationale: "No architecture changes" },
			data: { status: "no", rationale: "No data changes" },
			api: { status: "no", rationale: "No API changes" },
		},
		openQuestions: ["What is the expiry period?"],
	};
}

function invalidAnalysisContent(): unknown {
	return {
		schemaVersion: "artifact/analysis/v1",
		artifactKind: "analysis",
		summary: "Missing required fields",
	};
}

function makeRoleResult(workflowId: number, attemptId: number, effects: ArtifactEffectProposal[]): RoleResult {
	return {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId,
		effects,
	};
}

function queryImpactProfileCount(databasePath: string, workflowId: number): number {
	const database = new Database(databasePath, { readonly: true });
	try {
		return (database.prepare("select count(*) as count from impact_profiles where workflow_id = ?").get(workflowId) as { count: number }).count;
	} finally {
		database.close();
	}
}

function queryTraceLinkCount(databasePath: string): number {
	const database = new Database(databasePath, { readonly: true });
	try {
		return (database.prepare("select count(*) as count from trace_links").get() as { count: number }).count;
	} finally {
		database.close();
	}
}

test("bindEvidenceSnapshot creates immutable evidence snapshot", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createStartedWorkflow(runtime);
		const snapshot = runtime.bindEvidenceSnapshot(workflowId, "sha256:abc123", [{ path: "src/main.ts", digest: "sha256:file1", size: 100 }]);
		assert.equal(snapshot.workflowId, workflowId);
		assert.equal(snapshot.repoDigest, "sha256:abc123");
		const snapshots = runtime.getEvidenceSnapshots(workflowId) as readonly unknown[];
		assert.equal(snapshots.length, 1);
	});
});

test("bindEvidenceSnapshot deduplicates by repo digest", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createStartedWorkflow(runtime);
		const files = [{ path: "src/main.ts", digest: "sha256:file1", size: 100 }];
		runtime.bindEvidenceSnapshot(workflowId, "sha256:abc123", files);
		runtime.bindEvidenceSnapshot(workflowId, "sha256:abc123", files);
		const snapshots = runtime.getEvidenceSnapshots(workflowId) as readonly unknown[];
		assert.equal(snapshots.length, 1);
	});
});

test("isEvidenceStale returns true when no snapshot exists", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createStartedWorkflow(runtime);
		assert.equal(runtime.isEvidenceStale(workflowId, "sha256:abc123"), true);
	});
});

test("isEvidenceStale returns false when digest matches", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createStartedWorkflow(runtime);
		runtime.bindEvidenceSnapshot(workflowId, "sha256:abc123", []);
		assert.equal(runtime.isEvidenceStale(workflowId, "sha256:abc123"), false);
	});
});

test("isEvidenceStale returns true when digest differs", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createStartedWorkflow(runtime);
		runtime.bindEvidenceSnapshot(workflowId, "sha256:abc123", []);
		assert.equal(runtime.isEvidenceStale(workflowId, "sha256:different"), true);
	});
});

test("getTraceLinks returns empty for revision without links", async () => {
	await withRuntime(async ({ runtime }) => {
		const links = runtime.getTraceLinks(999);
		assert.equal(links.length, 0);
	});
});

test("artifact content schema validation rejects invalid analysis content", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPlannedWorkflow(runtime);
		const begin = runtime.beginAttempt(workflowId);
		const result = makeRoleResult(workflowId, begin.attemptId, [
			{
				effectType: "artifact_revision",
				artifactKind: "analysis",
				logicalKey: "analysis",
				content: invalidAnalysisContent(),
				baseRevisionId: null,
			},
		]);
		const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
		assert.equal(complete.outcome, "failed");
		assert.equal(complete.failureCode, "artifact_schema_invalid");
	});
});

test("trace link validation rejects analysis without trace links", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPlannedWorkflow(runtime);
		const projection = runtime.getWorkflowProjection(workflowId);
		const requirementRevisionId = projection!.requirement.currentRevision.id;
		const begin = runtime.beginAttempt(workflowId);
		const result = makeRoleResult(workflowId, begin.attemptId, [
			{
				effectType: "artifact_revision",
				artifactKind: "analysis",
				logicalKey: "analysis",
				content: validAnalysisContent(requirementRevisionId),
				baseRevisionId: null,
			},
		]);
		const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
		assert.equal(complete.outcome, "failed");
		assert.equal(complete.failureCode, "missing_trace_link");
	});
});

test("trace link validation passes for analysis with trace links", async () => {
	await withRuntime(async ({ databasePath, runtime }) => {
		const { workflowId } = await createPlannedWorkflow(runtime);
		const projection = runtime.getWorkflowProjection(workflowId);
		const requirementRevisionId = projection!.requirement.currentRevision.id;
		runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", [{ path: "src/main.ts", digest: "sha256:f1", size: 10 }]);
		const snapshots = runtime.getEvidenceSnapshots(workflowId) as readonly { id: number }[];
		const begin = runtime.beginAttempt(workflowId);
		const traceLinks: TraceLinkProposal[] = [{ evidenceSnapshotId: snapshots[0]!.id, sourceRef: { type: "requirement_revision", revisionId: requirementRevisionId } }];
		const result = makeRoleResult(workflowId, begin.attemptId, [
			{
				effectType: "artifact_revision",
				artifactKind: "analysis",
				logicalKey: "analysis",
				content: validAnalysisContent(requirementRevisionId),
				baseRevisionId: null,
				traceLinks,
			},
		]);
		const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
		assert.equal(complete.outcome, "published");
		assert.equal(queryTraceLinkCount(databasePath), 1);
		// 画像写入已废除（#12）：impact_profiles 表不再写入
		assert.equal(queryImpactProfileCount(databasePath, workflowId), 0);
	});
});

test("template required artifact set covers all fixed kinds after analysis published", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPlannedWorkflow(runtime);
		const projection = runtime.getWorkflowProjection(workflowId);
		const requirementRevisionId = projection!.requirement.currentRevision.id;
		runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", []);
		const snapshots = runtime.getEvidenceSnapshots(workflowId) as readonly { id: number }[];
		const begin = runtime.beginAttempt(workflowId);
		const traceLinks: TraceLinkProposal[] = [{ evidenceSnapshotId: snapshots[0]!.id, sourceRef: { type: "requirement_revision", revisionId: requirementRevisionId } }];
		const result = makeRoleResult(workflowId, begin.attemptId, [
			{
				effectType: "artifact_revision",
				artifactKind: "analysis",
				logicalKey: "analysis",
				content: validAnalysisContent(requirementRevisionId),
				baseRevisionId: null,
				traceLinks,
			},
		]);
		runtime.completeAttempt(workflowId, begin.attemptId, result);
		// 模板固定必需集：仅 analysis 已产，scenario/usecase/function/design/architecture/data/api 七类缺失
		const report = runtime.checkReadiness(workflowId);
		const artifactsCheck = report.checks.find((check) => check.name === "complete_required_artifacts");
		assert.ok(artifactsCheck);
		assert.equal(artifactsCheck.passed, false);
		assert.match(artifactsCheck.detail, /scenario/);
	});
});

test("completion policy on staged candidates rejects missing expected effect", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPlannedWorkflow(runtime);
		const projection = runtime.getWorkflowProjection(workflowId);
		const requirementRevisionId = projection!.requirement.currentRevision.id;
		runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", []);
		const snapshots = runtime.getEvidenceSnapshots(workflowId) as readonly { id: number }[];
		const begin = runtime.beginAttempt(workflowId);
		const traceLinks: TraceLinkProposal[] = [{ evidenceSnapshotId: snapshots[0]!.id, sourceRef: { type: "requirement_revision", revisionId: requirementRevisionId } }];
		const result = makeRoleResult(workflowId, begin.attemptId, [
			{
				effectType: "artifact_revision",
				artifactKind: "scenario",
				logicalKey: "scenario",
				content: {
					schemaVersion: "artifact/scenario/v1",
					artifactKind: "scenario",
					summary: "Scenario",
					sourceRefs: [{ type: "requirement_revision", revisionId: requirementRevisionId }],
					domains: [{
						nodeId: "d1",
						title: "D",
						scenarios: [{
							nodeId: "s1",
							title: "S",
							variants: [{
								nodeId: "v1",
								title: "Expiry",
								actors: ["User"],
								preconditions: [],
								trigger: "Time passes",
								mainFlow: ["Step 1"],
								alternateFlows: [],
								expectedOutcome: "Points expire",
							}],
						}],
					}],
				},
				baseRevisionId: null,
				traceLinks,
			},
		]);
		const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
		assert.equal(complete.outcome, "failed");
		assert.equal(complete.failureCode, "completion_policy_failed");
	});
});

test("required artifact set kind statuses reflect current revisions", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createPlannedWorkflow(runtime);
		const projection = runtime.getWorkflowProjection(workflowId);
		const requirementRevisionId = projection!.requirement.currentRevision.id;
		runtime.bindEvidenceSnapshot(workflowId, "sha256:repo1", []);
		const snapshots = runtime.getEvidenceSnapshots(workflowId) as readonly { id: number }[];
		const begin = runtime.beginAttempt(workflowId);
		const traceLinks: TraceLinkProposal[] = [{ evidenceSnapshotId: snapshots[0]!.id, sourceRef: { type: "requirement_revision", revisionId: requirementRevisionId } }];
		const result = makeRoleResult(workflowId, begin.attemptId, [
			{
				effectType: "artifact_revision",
				artifactKind: "analysis",
				logicalKey: "analysis",
				content: validAnalysisContent(requirementRevisionId),
				baseRevisionId: null,
				traceLinks,
			},
		]);
		runtime.completeAttempt(workflowId, begin.attemptId, result);
		// 模板必需集：analysis 有 current revision（evidence 覆盖）而 design 尚无——readiness 反映
		const report = runtime.checkReadiness(workflowId);
		const artifactsCheck = report.checks.find((check) => check.name === "complete_required_artifacts");
		assert.ok(artifactsCheck);
		// 模板 8 kinds 中仅 analysis 已产，scenario/usecase/function/design/architecture/data/api 缺失
		assert.equal(artifactsCheck.passed, false);
		assert.match(artifactsCheck.detail, /scenario/);
		const evidenceCheck = report.checks.find((check) => check.name === "evidence_coverage");
		assert.ok(evidenceCheck);
		assert.equal(evidenceCheck.passed, true);
	});
});
