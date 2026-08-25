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
} from "./testing/deterministic-fixtures.js";
import {
	openHeadlessWorkflowRuntime,
	type RequirementBaseline,
} from "./workflow/headless-runtime.js";
import type { RoleResult, ArtifactEffectProposal, TraceLinkProposal } from "./workflow/role-result.js";

/**
 * promote: 把 approved artifact revisions 提升为 reusable assets。
 * 验证 promote 对 8 种 kind 的覆盖,含 design 拆分后每种产物各自独立提升。
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
	const directory = await mkdtemp(path.join(tmpdir(), "baize-promote-"));
	const databasePath = path.join(directory, "workflow.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(),
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
	const plan = await runtime.planWorkflow(created.workflowId, null);
	assert.equal(plan.outcome, "adopted");
	return { workflowId: created.workflowId };
}

async function bindSnapshot(runtime: Runtime, workflowId: number): Promise<number> {
	const snap = runtime.bindEvidenceSnapshot(workflowId, "sha256:repo-abc", { files: [] });
	return snap.id;
}

function effectFor(kind: string, content: unknown, snapId: number, _reqRev: number): ArtifactEffectProposal {
	return {
		effectType: "artifact_revision",
		artifactKind: kind as ArtifactEffectProposal["artifactKind"],
		logicalKey: kind,
		content,
		baseRevisionId: null,
		traceLinks: ["analysis", "design", "architecture", "data", "api"].includes(kind) ? [{ evidenceSnapshotId: snapId, sourceRef: { type: "code", path: "/src/foo.ts" } }] : undefined,
	};
}

function roleResult(workflowId: number, attemptId: number, effects: ArtifactEffectProposal[]): RoleResult {
	return { schemaVersion: "role-result/v1", workflowId, attemptId, effects };
}

async function produceApproveKind(runtime: Runtime, workflowId: number, kind: string, content: unknown): Promise<void> {
	const snap = await bindSnapshot(runtime, workflowId);
	const begin = runtime.beginAttempt(workflowId);
	assert.ok(begin.taskId > 0);
	const result = roleResult(workflowId, begin.attemptId, [effectFor(kind, content, snap, 1)]);
	const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
	assert.equal(complete.outcome, "published", `produce ${kind} failed: ${JSON.stringify(complete)}`);
	// For kinds in the design block (design/architecture/data/api), there is no separate review task
	// between them - review-design covers all 4 at the end. Skip review+approve; just produce.
	if (["design", "architecture", "data", "api"].includes(kind)) {
		return;
	}
	// For analysis/scenario/usecase/function: produce -> review -> approve
	// Critic review
	const review = runtime.beginAttempt(workflowId);
	assert.ok(review.taskId > 0);
	const proj = runtime.getWorkflowProjection(workflowId)!;
	const detail = runtime.getArtifactRevisionDetail(proj.requirement.id, kind);
	assert.ok(detail);
	const reviewResult: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: review.attemptId,
		effects: [],
		criticReport: {
			schemaVersion: "critic-report/v1",
			workflowId,
			attemptId: review.attemptId,
			coverageAttestation: {
				reviewTargets: [{ revisionId: detail.revisionId, artifactKind: kind }],
				complete: true,
			},
			findings: [],
		},
	};
	const reviewComplete = runtime.completeAttempt(workflowId, review.attemptId, reviewResult);
	assert.equal(reviewComplete.outcome, "published");
	// Approve
	const approveReceipt = runtime.executeCommand({
		workflowId,
		commandId: `cmd-approve-${kind}-${detail.revisionId}`,
		expectedWorkflowVersion: runtime.getWorkflowProjection(workflowId)!.workflow.version,
		type: "approve-artifact",
		operator: OPERATOR,
		payload: { artifactId: detail.artifactId, revisionId: detail.revisionId },
	});
	assert.equal(approveReceipt.outcome, "accepted");
}

const CONTENT: Record<string, () => unknown> = {
	analysis: () => ({ schemaVersion: "artifact/analysis/v1", artifactKind: "analysis", summary: "A", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], goals: ["g"], nonGoals: ["n"], constraints: ["c"], acceptanceCriteria: ["a"], impactProfile: { process: { status: "yes", rationale: "r" }, actors: { status: "no", rationale: "r" }, behavior: { status: "no", rationale: "r" }, architecture: { status: "no", rationale: "r" }, data: { status: "no", rationale: "r" }, api: { status: "no", rationale: "r" } }, openQuestions: [] }),
	scenario: () => ({ schemaVersion: "artifact/scenario/v1", artifactKind: "scenario", summary: "S", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], scenarios: [{ id: "s1", title: "T", actors: ["U"], preconditions: ["P"], trigger: "Tr", mainFlow: ["F"], alternateFlows: [], expectedOutcome: "O" }] }),
	usecase: () => ({ schemaVersion: "artifact/usecase/v1", artifactKind: "usecase", summary: "U", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], useCases: [{ id: "u1", actor: "U", goal: "G", preconditions: ["P"], mainFlow: ["F"], alternativeFlows: [], postconditions: ["C"] }] }),
	function: () => ({ schemaVersion: "artifact/function/v1", artifactKind: "function", summary: "F", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], functions: [{ id: "f1", name: "N", responsibility: "R", inputs: ["I"], outputs: ["O"], businessRules: ["B"], acceptanceCriteria: ["A"] }] }),
	design: () => ({ schemaVersion: "artifact/design/v1", artifactKind: "design", summary: "D", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], changeUnits: [{ id: "C1", area: "A", change: "C", rationale: "R", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }] }], alternatives: ["a"], failureHandling: ["f"], testStrategy: ["t"], implementationOrder: ["i"], rolloutStrategy: "r", rollbackStrategy: "r" }),
	architecture: () => ({ schemaVersion: "artifact/architecture/v1", artifactKind: "architecture", summary: "Arch", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], components: [{ id: "c1", name: "N", responsibility: "R" }], relationships: [{ from: "c1", to: "c2", interaction: "I" }], constraints: ["C"], nonFunctionalRequirements: ["N"], decisions: [] }),
	data: () => ({ schemaVersion: "artifact/data/v1", artifactKind: "data", summary: "Data", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], entities: [{ name: "E", purpose: "P", fields: ["f"], lifecycle: "L" }], relationships: ["R"], migrationPlan: "M", rollbackPlan: "R", privacyAndRetention: ["P"] }),
	api: () => ({ schemaVersion: "artifact/api/v1", artifactKind: "api", summary: "API", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }], interfaces: [{ id: "a1", kind: "http", name: "N", contract: "C", errors: ["E"], compatibility: "C" }], security: ["S"], versioning: "V", testStrategy: ["T"] }),
};

test("promote 覆盖 architecture/data/api/design/content 拆细", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		void databasePath;
		const { workflowId } = await createStartedWorkflow(runtime);

		// Execute + approve each stage
		await produceApproveKind(runtime, workflowId, "analysis", CONTENT.analysis());
		await produceApproveKind(runtime, workflowId, "scenario", CONTENT.scenario());
		await produceApproveKind(runtime, workflowId, "usecase", CONTENT.usecase());
		await produceApproveKind(runtime, workflowId, "function", CONTENT.function());
		await produceApproveKind(runtime, workflowId, "design", CONTENT.design());
		await produceApproveKind(runtime, workflowId, "architecture", CONTENT.architecture());
		await produceApproveKind(runtime, workflowId, "data", CONTENT.data());
		await produceApproveKind(runtime, workflowId, "api", CONTENT.api());
	// review-design covers all 4 design-block kinds
	const review = runtime.beginAttempt(workflowId);
	assert.ok(review.taskId > 0);
	const proj = runtime.getWorkflowProjection(workflowId)!;
	const reviewTargets = ["design", "architecture", "data", "api"].map((kind) => {
		const detail = runtime.getArtifactRevisionDetail(proj.requirement.id, kind);
		assert.ok(detail, `${kind} revision should exist`);
		return { revisionId: detail.revisionId, artifactKind: kind };
	});
	const reviewResult: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: review.attemptId,
		effects: [],
		criticReport: {
			schemaVersion: "critic-report/v1",
			workflowId,
			attemptId: review.attemptId,
			coverageAttestation: { reviewTargets, complete: true },
			findings: [],
		},
	};
	const reviewComplete = runtime.completeAttempt(workflowId, review.attemptId, reviewResult);
	assert.equal(reviewComplete.outcome, "published");
	// Approve all 4 design-block kinds
	for (const kind of ["design", "architecture", "data", "api"]) {
		const detail = runtime.getArtifactRevisionDetail(runtime.getWorkflowProjection(workflowId)!.requirement.id, kind);
		const ar = runtime.executeCommand({
			workflowId,
			commandId: `cmd-approve-${kind}-${detail!.revisionId}`,
			expectedWorkflowVersion: runtime.getWorkflowProjection(workflowId)!.workflow.version,
			type: "approve-artifact",
			operator: OPERATOR,
			payload: { artifactId: detail!.artifactId, revisionId: detail!.revisionId },
		});
		assert.equal(ar.outcome, "accepted", `approve ${kind} failed`);
	}

	const counts = runtime.promoteRequirementArtifacts(workflowId, ["analysis", "scenario", "usecase", "function", "design", "architecture", "data", "api"]);
		assert.equal(counts["analysis"] ?? 0, 0, "analysis has no extractable items (impactProfile is not a titled list)");
		assert.equal(counts["scenario"], 1);
		assert.equal(counts["usecase"], 1);
		assert.equal(counts["function"], 1);
		assert.equal(counts["design"], 1);
		assert.equal(counts["architecture"], 1);
		assert.equal(counts["data"], 1);
		assert.equal(counts["api"], 1);
	});
});

test("promote 对未产生产物 kind 返回 0", async () => {
	await withRuntime(async ({ runtime }) => {
		const { workflowId } = await createStartedWorkflow(runtime);
		await produceApproveKind(runtime, workflowId, "analysis", CONTENT.analysis());
		const counts = runtime.promoteRequirementArtifacts(workflowId, ["scenario", "usecase", "function", "design", "architecture", "data", "api"]);
		assert.equal(counts["scenario"], 0);
		assert.equal(counts["usecase"], 0);
		assert.equal(counts["design"], 0);
		assert.equal(counts["architecture"], 0);
		assert.equal(counts["data"], 0);
		assert.equal(counts["api"], 0);
	});
});