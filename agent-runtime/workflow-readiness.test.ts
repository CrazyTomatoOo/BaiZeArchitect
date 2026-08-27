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
	type HashProvider,
} from "./testing/deterministic-fixtures.js";
import {
	openHeadlessWorkflowRuntime,
	type HeadlessWorkflowRuntime,
	type RequirementBaseline,
} from "./workflow/headless-runtime.js";
import type { PlanProposal, TaskProposal } from "./workflow/plan-types.js";
import type { ArtifactEffectProposal, CriticReport, RoleResult, TraceLinkProposal } from "./workflow/role-result.js";

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Add expiry reminders and controlled compensation.",
	sourceRefs: [],
	title: "Points expiry and compensation",
	description: "Add expiry reminders and controlled compensation.",
};

const OPERATOR = createFixtureOperator("alice");
const TIMESTAMP = "2026-08-12T10:00:00.000Z";

interface ReadinessFixture {
	databasePath: string;
	runtime: HeadlessWorkflowRuntime;
	hashProvider: HashProvider;
}

type Runtime = HeadlessWorkflowRuntime;

async function withReadinessRuntime(
	work: (fixture: ReadinessFixture) => Promise<void> | void,
	hashProviderOverride?: HashProvider,
): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-readiness-"));
	const databasePath = path.join(directory, "workflow.db");
	const hashProvider = hashProviderOverride ?? createHashProvider();
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock(TIMESTAMP),
		hashProvider,
		crashInjector: createCrashInjector([]),
		outboxTransport: createOutboxTransport(),
	});
	try {
		await work({ databasePath, runtime, hashProvider });
	} finally {
		runtime.close();
		await rm(directory, { recursive: true, force: true });
	}
}

// #12 决议：Impact Profile 派生废除后 analysis 内容仍须 schema 合法（impactProfile 为 artifact-content/v1 必填字段），
// 但 readiness 不再依据维度 status 拒绝（complete_impact_profile 检查已删除）。
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
		impactProfile: {
			process: dimension,
			actors: dimension,
			behavior: dimension,
			architecture: dimension,
			data: dimension,
			api: dimension,
		},
		openQuestions: [],
	};
}

function scenarioContent(): unknown {
	return {
		schemaVersion: "artifact/scenario/v1",
		artifactKind: "scenario",
		summary: "Scenarios of points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		domains: [
			{
				nodeId: "sd1",
				title: "Member domain",
				scenarios: [
					{
						nodeId: "sn1",
						title: "Points expire after grace period",
						variants: [
							{
								nodeId: "sv1",
								title: "Points expire after grace period",
								actors: ["Member"],
								preconditions: ["Member holds points"],
								trigger: "Grace period ends",
								mainFlow: ["System notifies member", "System expires points"],
								alternateFlows: [],
								expectedOutcome: "Points expired",
							},
						],
					},
				],
			},
		],
	};
}

function usecaseContent(): unknown {
	return {
		schemaVersion: "artifact/usecase/v1",
		artifactKind: "usecase",
		summary: "Use cases of points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		useCases: [
			{
				id: "u1",
				actor: "Member",
				goal: "Be notified before points expire",
				preconditions: [],
				mainFlow: ["System lists expiring points", "System sends reminder"],
				alternativeFlows: [],
				postconditions: ["Member informed"],
			},
		],
	};
}

function functionContent(): unknown {
	return {
		schemaVersion: "artifact/function/v1",
		artifactKind: "function",
		summary: "Functions of points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		domains: [
			{
				nodeId: "fd1",
				title: "Expiry domain",
				items: [
					{
						nodeId: "fi1",
						title: "Scheduler item",
						points: [
							{
								nodeId: "fp1",
								name: "Expiry scheduler",
								responsibility: "Expire points after grace period",
								inputs: [],
								outputs: [],
								businessRules: [],
								acceptanceCriteria: ["Expired points never negative"],
							},
						],
					},
				],
			},
		],
	};
}

function designContent(): unknown {
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

function architectureContent(): unknown {
	return {
		schemaVersion: "artifact/architecture/v1",
		artifactKind: "architecture",
		summary: "Architecture of points expiry solution",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		components: [{ componentId: "c1", name: "Expiry service", responsibility: "Runs expiry batch" }],
		relationships: [],
		constraints: [],
		nonFunctionalRequirements: ["Batch completes within window"],
	};
}

function dataContent(): unknown {
	return {
		schemaVersion: "artifact/data/v1",
		artifactKind: "data",
		summary: "Data model of points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		entities: [
			{
				entityId: "points_ledger",
				name: "Points ledger",
				fields: [
					{ fieldId: "member_id", name: "Member ID", type: "string" },
					{ fieldId: "balance", name: "Balance", type: "integer" },
					{ fieldId: "expires_at", name: "Expires at", type: "datetime" },
				],
			},
		],
		relations: [
			{
				fromEntityId: "points_ledger",
				fromFieldIds: ["member_id"],
				toEntityId: "member_profile",
				cardinality: "many-to-one",
			},
		],
	};
}

function apiContent(): unknown {
	return {
		schemaVersion: "artifact/api/v1",
		artifactKind: "api",
		summary: "API surface of points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		openapi: "3.1.0",
		info: { title: "Expiry API", version: "1.0.0" },
		paths: {
			"/internal/expiry/run": {
				summary: "Run expiry batch",
				post: {
					summary: "Run expiry batch",
					responses: {
						"200": { description: "Expiry completed" },
					},
				},
			},
		},
	};
}

/** 模板生产环节（design 拆为 design→architecture→data→api 各一 Task，每环节尾 Critic 复审）。 */
const TEMPLATE_STAGES: ReadonlyArray<{ key: string; role: string; kinds: readonly ArtifactEffectProposal["artifactKind"][] }> = [
	{ key: "analyze", role: "analysis-analyst", kinds: ["analysis"] },
	{ key: "scenario", role: "scenario-analyst", kinds: ["scenario"] },
	{ key: "usecase", role: "usecase-analyst", kinds: ["usecase"] },
	{ key: "function", role: "function-analyst", kinds: ["function"] },
	{ key: "design", role: "design-architect", kinds: ["design"] },
	{ key: "architecture", role: "architecture-architect", kinds: ["architecture"] },
	{ key: "data", role: "data-architect", kinds: ["data"] },
	{ key: "api", role: "api-architect", kinds: ["api"] },
];

const STAGE_CONTENT: Readonly<Record<string, () => unknown>> = {
	analysis: analysisContent,
	scenario: scenarioContent,
	usecase: usecaseContent,
	function: functionContent,
	design: designContent,
	architecture: architectureContent,
	data: dataContent,
	api: apiContent,
};

/** code 类产物发布时必须携带 TraceLink（artifact-content/publish 校验）。 */
const TRACE_LINK_KINDS: readonly string[] = ["analysis", "design", "architecture", "data", "api"];

async function createStartedWorkflow(runtime: Runtime): Promise<number> {
	const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
	const created = runtime.createRequirement({ workspaceId, baseline: BASELINE });
	runtime.executeCommand({
		workflowId: created.workflowId,
		commandId: "cmd-start",
		expectedWorkflowVersion: 0,
		type: "start",
		operator: OPERATOR,
	});
	return created.workflowId;
}

/** #12 决议：引擎直接实例化 plan-template/v1（13 Task），无需 Orchestrator ModelDriver。 */
async function adoptTemplatePlan(runtime: Runtime, workflowId: number): Promise<void> {
	const result = await runtime.planWorkflow(workflowId, null);
	assert.equal(result.outcome, "adopted");
	assert.ok(result.planRevisionId !== null);
}

/** 人工替换计划（rework/verify 周期的唯一入口；模板计划之外的自定义任务经 replace-plan 进入）。 */
async function replacePlan(runtime: Runtime, workflowId: number, tasks: TaskProposal[], objective = "Plan"): Promise<void> {
	const projection = runtime.getWorkflowProjection(workflowId);
	assert.ok(projection, "workflow projection should exist");
	const proposal: PlanProposal = {
		schemaVersion: "plan-proposal/v1",
		base: {
			workflowId,
			workflowVersion: projection.workflow.version,
			basePlanRevisionId: projection.workflow.currentPlanRevisionId,
			planningContextDigest: runtime.getPlanningContextDigest(workflowId),
		},
		objective,
		tasks,
		rationale: "rationale",
	};
	const receipt = runtime.executeCommand({
		workflowId,
		commandId: "cmd-replace-plan",
		expectedWorkflowVersion: projection.workflow.version,
		type: "replace-plan",
		payload: { proposal },
		operator: OPERATOR,
	});
	assert.equal(receipt.outcome, "accepted");
}

function setupEvidence(runtime: Runtime, workflowId: number): TraceLinkProposal {
	const snapshot = runtime.bindEvidenceSnapshot(workflowId, "sha256:repo-abc", { files: [] });
	return { evidenceSnapshotId: snapshot.id, sourceRef: { type: "code", path: "/src/analysis.ts" } };
}

function getRevisionId(databasePath: string, kind: string): number {
	const db = new Database(databasePath, { readonly: true });
	try {
		const row = db
			.prepare("select ar.id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.kind = ? order by ar.id desc limit 1")
			.get(kind) as { id: number } | undefined;
		assert.ok(row, `${kind} revision should exist`);
		return row.id;
	} finally {
		db.close();
	}
}

function approveStageArtifacts(
	runtime: Runtime,
	workflowId: number,
	databasePath: string,
	kinds: readonly string[],
): void {
	const db = new Database(databasePath, { readonly: true });
	const targets: Array<{ artifactId: number; revisionId: number }> = [];
	try {
		for (const kind of kinds) {
			const row = db
				.prepare("select a.id as artifactId, ar.id as revisionId from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.kind = ? order by ar.id desc limit 1")
				.get(kind) as { artifactId: number; revisionId: number } | undefined;
			assert.ok(row, `${kind} revision should exist`);
			targets.push(row);
		}
	} finally {
		db.close();
	}
	for (const target of targets) {
		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection, "workflow projection should exist");
		const receipt = runtime.executeCommand({
			workflowId,
			commandId: `cmd-approve-artifact-${target.revisionId}`,
			expectedWorkflowVersion: projection.workflow.version,
			type: "approve-artifact",
			payload: { artifactId: target.artifactId, revisionId: target.revisionId },
			operator: OPERATOR,
		});
		// 双闸门禁：#20 —— 存在 open critical/major finding 时 approve 被拒是预期行为
		// （findings 场景 fixture 依赖此路径：有未处置发现的产物保持 pending，令 disposed_findings 检查失败）
		assert.ok(
			receipt.outcome === "accepted" || receipt.outcome === "business_rule_rejected",
			`approve-artifact for revision ${target.revisionId} unexpected outcome: ${receipt.outcome}`,
		);
	}
}

interface FindingScript {
	fingerprint: string;
	severity: "critical" | "major" | "minor" | "info";
	summary: string;
	resolved?: boolean;
}

function executeTemplateStage(
	runtime: Runtime,
	workflowId: number,
	stage: { key: string; role: string; kinds: readonly ArtifactEffectProposal["artifactKind"][] },
	options?: { decisions?: Array<{ severity: "critical" | "major" | "minor"; summary: string }> },
): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskKey, stage.key);
	assert.equal(begin.taskRole, stage.role);
	const needsEvidence = stage.kinds.some((kind) => TRACE_LINK_KINDS.includes(kind));
	const evidence = needsEvidence ? setupEvidence(runtime, workflowId) : undefined;
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: stage.kinds.map((kind): ArtifactEffectProposal => ({
			effectType: "artifact_revision",
			artifactKind: kind,
			logicalKey: kind,
			content: STAGE_CONTENT[kind]!(),
			baseRevisionId: null,
			traceLinks: evidence && TRACE_LINK_KINDS.includes(kind) ? [evidence] : [],
		})),
		...(options?.decisions ? { decisionProposals: options.decisions } : {}),
	};
	const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
	assert.equal(complete.outcome, "published");
}

/** Rework 任务（replace-plan 引入的 analyst 复analysis 修订）。 */
function executeAnalysisReworkTask(runtime: Runtime, workflowId: number, taskKey: string, baseRevisionId: number | null): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskKey, taskKey);
	assert.equal(begin.taskRole, "analysis-analyst");
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [
			{
				effectType: "artifact_revision",
				artifactKind: "analysis",
				logicalKey: "analysis",
				content: analysisContent(),
				baseRevisionId,
				traceLinks: [setupEvidence(runtime, workflowId)],
			},
		],
	};
	const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
	assert.equal(complete.outcome, "published");
}

/** Critic 任务（review 与 verify 同一提交面：critic-report/v1 + coverageAttestation）。 */
function executeCriticTask(
	runtime: Runtime,
	databasePath: string,
	workflowId: number,
	expectedTaskKey: string,
	options?: { findings?: readonly FindingScript[]; coverKinds?: readonly string[] },
): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskKey, expectedTaskKey);
	assert.equal(begin.taskRole, "critic");
	const coverKinds = options?.coverKinds ?? [];
	const report: CriticReport = {
		schemaVersion: "critic-report/v1",
		workflowId,
		attemptId: begin.attemptId,
		coverageAttestation: {
			reviewTargets: coverKinds.map((kind) => ({ revisionId: getRevisionId(databasePath, kind), artifactKind: kind })),
			complete: true,
		},
		findings: (options?.findings ?? []).map((f) => ({
			fingerprint: f.fingerprint,
			severity: f.severity,
			summary: f.summary,
			targetRevisionId: getRevisionId(databasePath, "analysis"),
			targetArtifactKind: "analysis" as const,
			sourceRef: expectedTaskKey,
			resolved: f.resolved,
		})),
	};
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [],
		criticReport: report,
	};
	const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
	assert.equal(complete.outcome, "published");
}

/** 模板全链执行：8 生产环节 + 每环节尾 Critic 复审（coverKinds 覆盖该环节产物）。 */
async function createFullyReviewedWorkflow(
	fixture: ReadinessFixture,
	options?: { findings?: readonly FindingScript[]; coverKinds?: readonly string[]; decisions?: Array<{ severity: "critical" | "major" | "minor"; summary: string }> },
): Promise<number> {
	const { runtime, databasePath } = fixture;
	const workflowId = await createStartedWorkflow(runtime);
	await adoptTemplatePlan(runtime, workflowId);
	executeTemplateStage(runtime, workflowId, TEMPLATE_STAGES[0]!, { decisions: options?.decisions });
	executeCriticTask(runtime, databasePath, workflowId, "review-analysis", { coverKinds: ["analysis"] });
	approveStageArtifacts(runtime, workflowId, databasePath, ["analysis"]);
	executeTemplateStage(runtime, workflowId, TEMPLATE_STAGES[1]!);
	executeCriticTask(runtime, databasePath, workflowId, "review-scenario", { coverKinds: ["scenario"] });
	approveStageArtifacts(runtime, workflowId, databasePath, ["scenario"]);
	executeTemplateStage(runtime, workflowId, TEMPLATE_STAGES[2]!);
	executeCriticTask(runtime, databasePath, workflowId, "review-usecase", { coverKinds: ["usecase"] });
	approveStageArtifacts(runtime, workflowId, databasePath, ["usecase"]);
	executeTemplateStage(runtime, workflowId, TEMPLATE_STAGES[3]!);
	executeCriticTask(runtime, databasePath, workflowId, "review-function", { coverKinds: ["function"] });
	approveStageArtifacts(runtime, workflowId, databasePath, ["function"]);
	executeTemplateStage(runtime, workflowId, TEMPLATE_STAGES[4]!);
	executeTemplateStage(runtime, workflowId, TEMPLATE_STAGES[5]!);
	executeTemplateStage(runtime, workflowId, TEMPLATE_STAGES[6]!);
	executeTemplateStage(runtime, workflowId, TEMPLATE_STAGES[7]!);
	const designCoverKinds = options?.coverKinds ?? ["design", "architecture", "data", "api"];
	executeCriticTask(runtime, databasePath, workflowId, "review-design", {
		coverKinds: designCoverKinds,
		findings: options?.findings,
	});
	const pendingDesignKinds = designCoverKinds.filter((kind) => {
		const detail = runtime.getArtifactRevisionDetail(runtime.getWorkflowProjection(workflowId)!.requirement.id, kind);
		return detail?.status === "pending";
	});
	if (pendingDesignKinds.length > 0) {
		approveStageArtifacts(runtime, workflowId, databasePath, pendingDesignKinds);
	}
	return workflowId;
}

function assertOnlyCheckFails(report: { checks: readonly { name: string; passed: boolean; detail: string }[] }, expectedFailure: string): void {
	const failed = report.checks.filter((check) => !check.passed);
	assert.deepEqual(failed.map((check) => check.name), [expectedFailure], `expected only ${expectedFailure} to fail, got: ${failed.map((c) => `${c.name}(${c.detail})`).join(", ")}`);
}

test("all checks pass builds immutable ApprovalPacket and transitions to ready_to_archive", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture);
		const report = fixture.runtime.checkReadiness(workflowId);
		assert.equal(report.ready, true);
		// #12 决议：complete_impact_profile 已删除，共 10 项检查
		assert.equal(report.checks.length, 10);
		const built = fixture.runtime.buildApprovalPacket(workflowId);
		assert.equal(built.ready, true);
		assert.ok(built.packetId !== null);
		assert.ok(built.digest?.startsWith("sha256:"));
		const projection = fixture.runtime.getWorkflowProjection(workflowId);
		assert.equal(projection?.workflow.state, "ready_to_archive");
		const packet = fixture.runtime.getApprovalPacket(workflowId);
		assert.ok(packet);
		assert.equal(packet.digest, built.digest);
		const content = packet.content as { schemaVersion: string; artifacts: unknown[]; requiredArtifactKinds: string[] };
		assert.equal(content.schemaVersion, "approval-packet/v1");
		// 模板固定必需集（8 生产 kinds + requirement）
		assert.deepEqual(content.requiredArtifactKinds, ["analysis", "api", "architecture", "data", "design", "function", "requirement", "scenario", "usecase"]);
		assert.equal(content.artifacts.length, 8);
		// Rebuild with unchanged inputs reuses the same packet
		const rebuilt = fixture.runtime.buildApprovalPacket(workflowId);
		assert.equal(rebuilt.ready, true);
		assert.equal(rebuilt.packetId, built.packetId);
		assert.equal(rebuilt.digest, built.digest);
	});
});

test("terminal_current_work blocks readiness when a plan task is still pending", async () => {
	await withReadinessRuntime(async (fixture) => {
		const { runtime, databasePath } = fixture;
		const workflowId = await createFullyReviewedWorkflow(fixture);
		// 人工替换计划追加复审环节：review-close 覆盖 rework 修订后 review-extra 保持 pending
		await replacePlan(runtime, workflowId, [
			{
				key: "analyze-2",
				kind: "analyze",
				role: "analysis-analyst",
				objective: "Revise analysis",
				dependsOn: [],
				inputs: [],
				expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }],
				completionPolicyRef: "analysis/v1",
				maxAttempts: 3,
			},
			{
				key: "review-close",
				kind: "review",
				role: "critic",
				objective: "Review revised analysis",
				dependsOn: ["analyze-2"],
				inputs: [],
				expectedArtifactEffects: [],
				completionPolicyRef: "review/v1",
				maxAttempts: 3,
			},
			{
				key: "review-extra",
				kind: "review",
				role: "critic",
				objective: "Extra review",
				dependsOn: ["review-close"],
				inputs: [],
				expectedArtifactEffects: [],
				completionPolicyRef: "review/v1",
				maxAttempts: 3,
			},
		]);
		executeAnalysisReworkTask(runtime, workflowId, "analyze-2", getRevisionId(databasePath, "analysis"));
		executeCriticTask(runtime, databasePath, workflowId, "review-close", { coverKinds: ["analysis"] });
		const report = runtime.checkReadiness(workflowId);
		assert.equal(report.ready, false);
		assertOnlyCheckFails(report, "terminal_current_work");
	});
});

test("no_gate blocks readiness when a Finding Thread escalates to human gate after two failed verify cycles", async () => {
	await withReadinessRuntime(async (fixture) => {
		const { runtime, databasePath } = fixture;
		const workflowId = await createFullyReviewedWorkflow(
			fixture,
			{ findings: [{ fingerprint: "fp-minor-1", severity: "minor", summary: "Minor wording issue" }] },
		);
		const findingId = runtime.getFindings(workflowId)[0]!.id;
		const analysisRevisionId = getRevisionId(databasePath, "analysis");
		// 替换计划：rework + 两个 verify 周期指向未闭环 Finding Thread
		const verifyInput: TaskProposal["inputs"][number] = { type: "finding", findingId, targetRevisionId: analysisRevisionId, purpose: "verify closure" };
		await replacePlan(runtime, workflowId, [
			{
				key: "analyze-2",
				kind: "analyze",
				role: "analysis-analyst",
				objective: "Revise analysis",
				dependsOn: [],
				inputs: [],
				expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }],
				completionPolicyRef: "analysis/v1",
				maxAttempts: 3,
			},
			{
				key: "verify-1",
				kind: "verify",
				role: "critic",
				objective: "Verify finding closure",
				dependsOn: ["analyze-2"],
				inputs: [verifyInput],
				expectedArtifactEffects: [],
				completionPolicyRef: "verify/v1",
				maxAttempts: 3,
			},
			{
				key: "verify-2",
				kind: "verify",
				role: "critic",
				objective: "Verify finding closure again",
				dependsOn: ["verify-1"],
				inputs: [verifyInput],
				expectedArtifactEffects: [],
				completionPolicyRef: "verify/v1",
				maxAttempts: 3,
			},
		]);
		executeAnalysisReworkTask(runtime, workflowId, "analyze-2", analysisRevisionId);
		executeCriticTask(runtime, databasePath, workflowId, "verify-1", { findings: [{ fingerprint: "fp-minor-1", severity: "minor", summary: "Still open", resolved: false }], coverKinds: ["analysis"] });
		executeCriticTask(runtime, databasePath, workflowId, "verify-2", { findings: [{ fingerprint: "fp-minor-1", severity: "minor", summary: "Still open", resolved: false }], coverKinds: ["analysis"] });
		const projection = runtime.getWorkflowProjection(workflowId);
		assert.equal(projection?.workflow.state, "waiting_for_human");
		const report = runtime.checkReadiness(workflowId);
		assert.equal(report.ready, false);
		assertOnlyCheckFails(report, "no_gate");
	});
});

test("complete_required_artifacts blocks readiness when a required kind is missing", async () => {
	await withReadinessRuntime(async ({ runtime, databasePath }) => {
		const workflowId = await createStartedWorkflow(runtime);
		await adoptTemplatePlan(runtime, workflowId);
		// 模板必需集固定（planMayRemoveRequiredKinds=false）：替换为仅产 analysis 的计划，
		// 其余 7 个生产 kinds 无 current revision → 仅 complete_required_artifacts 失败
		await replacePlan(runtime, workflowId, [
			{
				key: "analyze-only",
				kind: "analyze",
				role: "analysis-analyst",
				objective: "Produce analysis",
				dependsOn: [],
				inputs: [],
				expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }],
				completionPolicyRef: "analysis/v1",
				maxAttempts: 3,
			},
			{
				key: "review-only",
				kind: "review",
				role: "critic",
				objective: "Review analysis",
				dependsOn: ["analyze-only"],
				inputs: [],
				expectedArtifactEffects: [],
				completionPolicyRef: "review/v1",
				maxAttempts: 3,
			},
		]);
		executeAnalysisReworkTask(runtime, workflowId, "analyze-only", null);
		executeCriticTask(runtime, databasePath, workflowId, "review-only", { coverKinds: ["analysis"] });
		const report = runtime.checkReadiness(workflowId);
		assert.equal(report.ready, false);
		assertOnlyCheckFails(report, "complete_required_artifacts");
	});
});

test("no_unpublished_effects blocks readiness when a staged effect exists", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture);
		const db = new Database(fixture.databasePath);
		try {
			db.prepare(
				"insert into attempt_effects(workflow_id, task_id, attempt_id, effect_type, logical_key, artifact_kind, effect_version, payload_document_id, payload_digest, state, published_artifact_revision_id, created_at) select workflow_id, task_id, attempt_id, effect_type, 'staged-copy', artifact_kind, effect_version, payload_document_id, payload_digest, 'staged', null, created_at from attempt_effects where workflow_id = ? and state = 'published' limit 1",
			).run(workflowId);
		} finally {
			db.close();
		}
		const report = fixture.runtime.checkReadiness(workflowId);
		assert.equal(report.ready, false);
		assertOnlyCheckFails(report, "no_unpublished_effects");
	});
});

test("evidence_coverage blocks readiness when a code-related current revision lacks TraceLinks", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture);
		const db = new Database(fixture.databasePath);
		try {
			const designRevision = db
				.prepare("select ar.id, ar.artifact_id, ar.revision_no, ar.content_document_id, ar.source_attempt_id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.kind = 'design' order by ar.id desc limit 1")
				.get() as { id: number; artifact_id: number; revision_no: number; content_document_id: number; source_attempt_id: number };
			const document = db.prepare("select content from snapshot_documents where id = ?").get(designRevision.content_document_id) as { content: string };
			const newContent = { ...JSON.parse(document.content), summary: "Design v2 without trace links" };
			const digest = fixture.hashProvider.digest(newContent);
			const newDocumentId = Number(
				db.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('artifact_content', 'artifact/design/v1', 'application/json', ?, ?, ?)")
					.run(fixture.hashProvider.canonicalize(newContent), digest, TIMESTAMP).lastInsertRowid,
			);
			const newRevisionId = Number(
				db.prepare("insert into artifact_revisions(artifact_id, revision_no, content_document_id, content_digest, schema_ref, status, source_attempt_id, base_revision_id, created_at) values (?, ?, ?, ?, 'artifact/design/v1', 'pending', ?, ?, ?)")
					.run(designRevision.artifact_id, designRevision.revision_no + 1, newDocumentId, digest, designRevision.source_attempt_id, designRevision.id, TIMESTAMP).lastInsertRowid,
			);
			// Keep Critic coverage current so only evidence_coverage fails
			db.prepare("insert into critic_coverage_targets(workflow_id, task_attempt_id, revision_id, artifact_kind, created_at) values (?, ?, ?, 'design', ?)")
				.run(workflowId, designRevision.source_attempt_id, newRevisionId, TIMESTAMP);
		} finally {
			db.close();
		}
		const report = fixture.runtime.checkReadiness(workflowId);
		assert.equal(report.ready, false);
		assertOnlyCheckFails(report, "evidence_coverage");
	});
});

test("disposed_decisions blocks readiness while a Decision is open and passes after human disposition", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture, { decisions: [{ severity: "major", summary: "Use synchronous expiry job" }] });
		const report = fixture.runtime.checkReadiness(workflowId);
		assert.equal(report.ready, false);
		assertOnlyCheckFails(report, "disposed_decisions");
		// Human disposes the Decision
		const decision = fixture.runtime.getDecisions(workflowId)[0]!;
		assert.equal(decision.status, "open");
		const projection = fixture.runtime.getWorkflowProjection(workflowId)!;
		const receipt = fixture.runtime.executeCommand({
			workflowId,
			commandId: "cmd-dispose-1",
			expectedWorkflowVersion: projection.workflow.version,
			type: "dispose-decision",
			payload: { decisionId: decision.id, status: "accepted" },
			operator: OPERATOR,
		});
		assert.equal(receipt.outcome, "accepted");
		const after = fixture.runtime.checkReadiness(workflowId);
		assert.equal(after.ready, true);
	});
});

test("disposed_findings blocks readiness while a critical Finding is open", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture, { findings: [{ fingerprint: "fp-crit-1", severity: "critical", summary: "Critical defect" }] });
		const report = fixture.runtime.checkReadiness(workflowId);
		assert.equal(report.ready, false);
		assertOnlyCheckFails(report, "disposed_findings");
	});
});

test("major Finding with fresh risk acceptance passes; stale risk acceptance blocks", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture, { findings: [{ fingerprint: "fp-major-1", severity: "major", summary: "Major defect" }] });
		const finding = fixture.runtime.getFindings(workflowId)[0]!;
		fixture.runtime.acceptFindingRisk(workflowId, finding.id, "bob", "Accepted: low production impact");
		// Fresh risk acceptance passes readiness
		const freshReport = fixture.runtime.checkReadiness(workflowId);
		assert.equal(freshReport.ready, true);
		// A successor analysis revision makes the risk acceptance stale
		const analysisRevisionId = getRevisionId(fixture.databasePath, "analysis");
		await replacePlan(fixture.runtime, workflowId, [
			{
				key: "analyze-2",
				kind: "analyze",
				role: "analysis-analyst",
				objective: "Revise analysis",
				dependsOn: [],
				inputs: [],
				expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }],
				completionPolicyRef: "analysis/v1",
				maxAttempts: 3,
			},
			{
				key: "review-2",
				kind: "review",
				role: "critic",
				objective: "Review revised analysis",
				dependsOn: ["analyze-2"],
				inputs: [],
				expectedArtifactEffects: [],
				completionPolicyRef: "review/v1",
				maxAttempts: 3,
			},
		]);
		executeAnalysisReworkTask(fixture.runtime, workflowId, "analyze-2", analysisRevisionId);
		executeCriticTask(fixture.runtime, fixture.databasePath, workflowId, "review-2", { coverKinds: ["analysis"] });
		const staleReport = fixture.runtime.checkReadiness(workflowId);
		assert.equal(staleReport.ready, false);
		assertOnlyCheckFails(staleReport, "disposed_findings");
	});
});

test("minor and informational Findings are disclosed in the packet without blocking readiness", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture, {
			findings: [
				{ fingerprint: "fp-minor-1", severity: "minor", summary: "Minor issue" },
				{ fingerprint: "fp-info-1", severity: "info", summary: "Informational note" },
			],
		});
		const built = fixture.runtime.buildApprovalPacket(workflowId);
		assert.equal(built.ready, true);
		const packet = fixture.runtime.getApprovalPacket(workflowId)!;
		const content = packet.content as { disclosedFindingIds: number[]; findings: Array<{ id: number; severity: string; status: string }> };
		const openIds = fixture.runtime.getFindings(workflowId).filter((f) => f.status === "open").map((f) => f.id).sort((a, b) => a - b);
		assert.deepEqual([...content.disclosedFindingIds].sort((a, b) => a - b), openIds);
		assert.equal(content.findings.length, 2);
	});
});

test("current_critic_coverage blocks readiness when a required current revision was not covered", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture, { coverKinds: ["requirement", "analysis"] });
		const report = fixture.runtime.checkReadiness(workflowId);
		assert.equal(report.ready, false);
		assertOnlyCheckFails(report, "current_critic_coverage");
	});
});

test("no_consistency_error blocks readiness when a current revision fails schema validation", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture);
		const db = new Database(fixture.databasePath);
		try {
			const analysisRevision = db
				.prepare("select ar.id, ar.artifact_id, ar.revision_no, ar.source_attempt_id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.kind = 'analysis' order by ar.id desc limit 1")
				.get() as { id: number; artifact_id: number; revision_no: number; source_attempt_id: number };
			const invalidContent = { schemaVersion: "artifact/analysis/v1", artifactKind: "analysis" };
			const digest = fixture.hashProvider.digest(invalidContent);
			const newDocumentId = Number(
				db.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('artifact_content', 'artifact/analysis/v1', 'application/json', ?, ?, ?)")
					.run(fixture.hashProvider.canonicalize(invalidContent), digest, TIMESTAMP).lastInsertRowid,
			);
			const newRevisionId = Number(
				db.prepare("insert into artifact_revisions(artifact_id, revision_no, content_document_id, content_digest, schema_ref, status, source_attempt_id, base_revision_id, created_at) values (?, ?, ?, ?, 'artifact/analysis/v1', 'pending', ?, ?, ?)")
					.run(analysisRevision.artifact_id, analysisRevision.revision_no + 1, newDocumentId, digest, analysisRevision.source_attempt_id, analysisRevision.id, TIMESTAMP).lastInsertRowid,
			);
			// Keep evidence coverage and Critic coverage current so only consistency fails
			const evidenceId = (db.prepare("select id from evidence_snapshots where workflow_id = ? order by id desc limit 1").get(workflowId) as { id: number }).id;
			db.prepare("insert into trace_links(artifact_revision_id, evidence_snapshot_id, source_ref_json, created_at) values (?, ?, ?, ?)")
				.run(newRevisionId, evidenceId, fixture.hashProvider.canonicalize({ type: "code", path: "/src/analysis.ts" }), TIMESTAMP);
			db.prepare("insert into critic_coverage_targets(workflow_id, task_attempt_id, revision_id, artifact_kind, created_at) values (?, ?, ?, 'analysis', ?)")
				.run(workflowId, analysisRevision.source_attempt_id, newRevisionId, TIMESTAMP);
		} finally {
			db.close();
		}
		const report = fixture.runtime.checkReadiness(workflowId);
		assert.equal(report.ready, false);
		assertOnlyCheckFails(report, "no_consistency_error");
	});
});

test("buildable_approval_packet blocks readiness when packet assembly cannot be digested", async () => {
	const real = createHashProvider();
	let failDigest = false;
	const flakyHash: HashProvider = {
		digest(value: unknown) {
			if (failDigest) throw new Error("digest failure");
			return real.digest(value);
		},
		canonicalize(value: unknown) {
			return real.canonicalize(value);
		},
	};
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture);
		failDigest = true;
		const report = fixture.runtime.checkReadiness(workflowId);
		assert.equal(report.ready, false);
		assertOnlyCheckFails(report, "buildable_approval_packet");
	}, flakyHash);
});

test("governed input change withdraws readiness and a later rebuild produces a different packet digest", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture);
		const first = fixture.runtime.buildApprovalPacket(workflowId);
		assert.equal(first.ready, true);
		assert.equal(fixture.runtime.getWorkflowProjection(workflowId)?.workflow.state, "ready_to_archive");
		// A governed input changes: a new open Decision appears
		const db = new Database(fixture.databasePath);
		let decisionId: number;
		try {
			const attemptId = (db.prepare("select id from task_attempts where workflow_id = ? order by id limit 1").get(workflowId) as { id: number }).id;
			decisionId = Number(
				db.prepare("insert into decisions(workflow_id, task_attempt_id, severity, summary, status, created_at) values (?, ?, 'minor', 'Late decision', 'open', ?)")
					.run(workflowId, attemptId, TIMESTAMP).lastInsertRowid,
			);
		} finally {
			db.close();
		}
		const withdrawn = fixture.runtime.buildApprovalPacket(workflowId);
		assert.equal(withdrawn.ready, false);
		assertOnlyCheckFails(withdrawn, "disposed_decisions");
		assert.equal(fixture.runtime.getWorkflowProjection(workflowId)?.workflow.state, "running");
		assert.equal(fixture.runtime.getApprovalPacket(workflowId), undefined);
		// Dispose the Decision, then rebuild: the new packet has a different digest
		const projection = fixture.runtime.getWorkflowProjection(workflowId)!;
		const receipt = fixture.runtime.executeCommand({
			workflowId,
			commandId: "cmd-dispose-late",
			expectedWorkflowVersion: projection.workflow.version,
			type: "dispose-decision",
			payload: { decisionId, status: "accepted" },
			operator: OPERATOR,
		});
		assert.equal(receipt.outcome, "accepted");
		const rebuilt = fixture.runtime.buildApprovalPacket(workflowId);
		assert.equal(rebuilt.ready, true);
		assert.notEqual(rebuilt.digest, first.digest);
		assert.equal(fixture.runtime.getWorkflowProjection(workflowId)?.workflow.state, "ready_to_archive");
	});
});

test("pure pause retains the valid packet and rebuild after resume reuses it", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture);
		const first = fixture.runtime.buildApprovalPacket(workflowId);
		assert.equal(first.ready, true);
		let projection = fixture.runtime.getWorkflowProjection(workflowId)!;
		const paused = fixture.runtime.executeCommand({
			workflowId,
			commandId: "cmd-pause",
			expectedWorkflowVersion: projection.workflow.version,
			type: "pause",
			operator: OPERATOR,
		});
		assert.equal(paused.outcome, "accepted");
		assert.equal(fixture.runtime.getWorkflowProjection(workflowId)?.workflow.state, "paused");
		// Packet remains available while paused
		const packetWhilePaused = fixture.runtime.getApprovalPacket(workflowId);
		assert.ok(packetWhilePaused);
		assert.equal(packetWhilePaused.digest, first.digest);
		// Resume and rebuild: identical digest reuses the same packet
		projection = fixture.runtime.getWorkflowProjection(workflowId)!;
		const resumed = fixture.runtime.executeCommand({
			workflowId,
			commandId: "cmd-resume",
			expectedWorkflowVersion: projection.workflow.version,
			type: "resume",
			operator: OPERATOR,
		});
		assert.equal(resumed.outcome, "accepted");
		const rebuilt = fixture.runtime.buildApprovalPacket(workflowId);
		assert.equal(rebuilt.ready, true);
		assert.equal(rebuilt.packetId, first.packetId);
		assert.equal(rebuilt.digest, first.digest);
	});
});

test("dispose-decision enforces severity rules", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture, {
			decisions: [
				{ severity: "critical", summary: "Critical choice" },
				{ severity: "minor", summary: "Minor choice" },
			],
		});
		const decisions = fixture.runtime.getDecisions(workflowId);
		const critical = decisions.find((d) => d.severity === "critical")!;
		const minor = decisions.find((d) => d.severity === "minor")!;
		// critical cannot be deferred
		let projection = fixture.runtime.getWorkflowProjection(workflowId)!;
		const rejected1 = fixture.runtime.executeCommand({
			workflowId,
			commandId: "cmd-d1",
			expectedWorkflowVersion: projection.workflow.version,
			type: "dispose-decision",
			payload: { decisionId: critical.id, status: "deferred", reason: "r", owner: "o", followUpTarget: "t" },
			operator: OPERATOR,
		});
		assert.equal(rejected1.outcome, "business_rule_rejected");
		// minor deferred requires reason, owner, and follow-up target
		projection = fixture.runtime.getWorkflowProjection(workflowId)!;
		const rejected2 = fixture.runtime.executeCommand({
			workflowId,
			commandId: "cmd-d2",
			expectedWorkflowVersion: projection.workflow.version,
			type: "dispose-decision",
			payload: { decisionId: minor.id, status: "deferred" },
			operator: OPERATOR,
		});
		assert.equal(rejected2.outcome, "business_rule_rejected");
		// minor deferred with all fields succeeds
		projection = fixture.runtime.getWorkflowProjection(workflowId)!;
		const accepted = fixture.runtime.executeCommand({
			workflowId,
			commandId: "cmd-d3",
			expectedWorkflowVersion: projection.workflow.version,
			type: "dispose-decision",
			payload: { decisionId: minor.id, status: "deferred", reason: "Not urgent", owner: "alice", followUpTarget: "next sprint" },
			operator: OPERATOR,
		});
		assert.equal(accepted.outcome, "accepted");
		const disposed = fixture.runtime.getDecisions(workflowId).find((d) => d.id === minor.id)!;
		assert.equal(disposed.status, "deferred");
		assert.equal(disposed.reason, "Not urgent");
		assert.equal(disposed.owner, "alice");
		assert.equal(disposed.followUpTarget, "next sprint");
	});
});

test("ApprovalPacket is immutable once stored", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture);
		const built = fixture.runtime.buildApprovalPacket(workflowId);
		assert.equal(built.ready, true);
		const db = new Database(fixture.databasePath);
		try {
			assert.throws(
				() => db.prepare("update approval_packets set digest = 'sha256:tampered' where id = ?").run(built.packetId),
				/ApprovalPacket (content )?is immutable/,
			);
			assert.throws(
				() => db.prepare("delete from approval_packets where id = ?").run(built.packetId),
				/ApprovalPacket (content )?is immutable/,
			);
		} finally {
			db.close();
		}
	});
});

test("Decision content is immutable and disposition is irreversible", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture, { decisions: [{ severity: "minor", summary: "Original summary" }] });
		const decision = fixture.runtime.getDecisions(workflowId)[0]!;
		const projection = fixture.runtime.getWorkflowProjection(workflowId)!;
		fixture.runtime.executeCommand({
			workflowId,
			commandId: "cmd-disp",
			expectedWorkflowVersion: projection.workflow.version,
			type: "dispose-decision",
			payload: { decisionId: decision.id, status: "accepted" },
			operator: OPERATOR,
		});
		const db = new Database(fixture.databasePath);
		try {
			assert.throws(
				() => db.prepare("update decisions set summary = 'Changed' where id = ?").run(decision.id),
				/Decision content is immutable/,
			);
			assert.throws(
				() => db.prepare("update decisions set status = 'rejected' where id = ?").run(decision.id),
				/Decision disposition is irreversible/,
			);
		} finally {
			db.close();
		}
	});
});
