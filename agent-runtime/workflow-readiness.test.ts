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
import { ScriptedModelDriver } from "./testing/scripted-model-driver.js";
import {
	openHeadlessWorkflowRuntime,
	type RequirementBaseline,
} from "./workflow/headless-runtime.js";
import type { PlanProposal, TaskProposal } from "./workflow/plan-types.js";
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
const TIMESTAMP = "2026-08-12T10:00:00.000Z";

interface ReadinessFixture {
	databasePath: string;
	runtime: Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;
	hashProvider: HashProvider;
}

type Runtime = ReadinessFixture["runtime"];

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

function analysisContent(impactStatus: "yes" | "no" | "unknown" = "no"): unknown {
	const dimension = { status: impactStatus, rationale: "rationale" };
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

function standardTasks(): TaskProposal[] {
	return [
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
			key: "design-sol",
			kind: "design",
			role: "architect",
			objective: "Produce design",
			dependsOn: ["analyze-req"],
			inputs: [{ type: "task_output", taskKey: "analyze-req", artifactKind: "analysis", purpose: "design input" }],
			expectedArtifactEffects: [{ kind: "design", operation: "create_or_revise" }],
			completionPolicyRef: "design/v1",
			maxAttempts: 3,
		},
		{
			key: "review-all",
			kind: "review",
			role: "critic",
			objective: "Review artifacts",
			dependsOn: ["design-sol"],
			inputs: [{ type: "task_output", taskKey: "design-sol", artifactKind: "design", purpose: "review" }],
			expectedArtifactEffects: [],
			completionPolicyRef: "review/v1",
			maxAttempts: 3,
		},
	];
}

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

async function adoptPlan(runtime: Runtime, workflowId: number, tasks: TaskProposal[]): Promise<void> {
	const projection = runtime.getWorkflowProjection(workflowId);
	assert.ok(projection, "workflow projection should exist");
	const contextDigest = runtime.getPlanningContextDigest(workflowId);
	const proposal: PlanProposal = {
		schemaVersion: "plan-proposal/v1",
		base: {
			workflowId,
			workflowVersion: projection.workflow.version,
			basePlanRevisionId: projection.workflow.currentPlanRevisionId,
			planningContextDigest: contextDigest,
		},
		objective: "Plan",
		tasks,
		rationale: "rationale",
	};
	const driver = new ScriptedModelDriver([
		{
			role: "orchestrator",
			contextDigest,
			orderedToolCalls: [],
			structuredResult: proposal,
			modelUsage: { inputTokens: 10, outputTokens: 20 },
		},
	]);
	const result = await runtime.planWorkflow(workflowId, driver);
	assert.equal(result.outcome, "adopted");
	driver.assertExhausted();
}

function setupEvidence(runtime: Runtime, workflowId: number): TraceLinkProposal {
	const snapshot = runtime.bindEvidenceSnapshot(workflowId, "sha256:repo-abc", { files: [] });
	return { evidenceSnapshotId: snapshot.id, sourceRef: { type: "code", path: "/src/analysis.ts" } };
}

function executeAnalystTask(runtime: Runtime, workflowId: number, options?: { impactStatus?: "yes" | "no" | "unknown"; decisions?: Array<{ severity: "critical" | "major" | "minor"; summary: string }>; baseRevisionId?: number | null }): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskRole, "analyst");
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [
			{
				effectType: "artifact_revision",
				artifactKind: "analysis",
				logicalKey: "analysis",
				content: analysisContent(options?.impactStatus ?? "no"),
				baseRevisionId: options?.baseRevisionId ?? null,
				traceLinks: [setupEvidence(runtime, workflowId)],
			},
		],
		...(options?.decisions ? { decisionProposals: options.decisions } : {}),
	};
	const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
	assert.equal(complete.outcome, "published");
}

function executeArchitectTask(runtime: Runtime, workflowId: number): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskRole, "architect");
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [
			{
				effectType: "artifact_revision",
				artifactKind: "design",
				logicalKey: "design",
				content: designContent(),
				baseRevisionId: null,
				traceLinks: [setupEvidence(runtime, workflowId)],
			},
		],
	};
	const complete = runtime.completeAttempt(workflowId, begin.attemptId, result);
	assert.equal(complete.outcome, "published");
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

function executeCriticTask(
	runtime: Runtime,
	databasePath: string,
	workflowId: number,
	options?: { findings?: Array<{ fingerprint: string; severity: "critical" | "major" | "minor" | "info"; summary: string; resolved?: boolean }>; coverKinds?: string[] },
): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskRole, "critic");
	const coverKinds = options?.coverKinds ?? ["requirement", "analysis", "design"];
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
			sourceRef: "review-all",
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

async function createFullyReviewedWorkflow(
	fixture: ReadinessFixture,
	options?: { findings?: Array<{ fingerprint: string; severity: "critical" | "major" | "minor" | "info"; summary: string; resolved?: boolean }>; coverKinds?: string[]; decisions?: Array<{ severity: "critical" | "major" | "minor"; summary: string }>; impactStatus?: "yes" | "no" | "unknown" },
): Promise<number> {
	const { runtime, databasePath } = fixture;
	const workflowId = await createStartedWorkflow(runtime);
	await adoptPlan(runtime, workflowId, standardTasks());
	executeAnalystTask(runtime, workflowId, { impactStatus: options?.impactStatus, decisions: options?.decisions });
	executeArchitectTask(runtime, workflowId);
	executeCriticTask(runtime, databasePath, workflowId, { findings: options?.findings, coverKinds: options?.coverKinds });
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
		assert.equal(report.checks.length, 11);
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
		assert.deepEqual(content.requiredArtifactKinds, ["analysis", "design", "requirement"]);
		assert.equal(content.artifacts.length, 3);
		// Rebuild with unchanged inputs reuses the same packet
		const rebuilt = fixture.runtime.buildApprovalPacket(workflowId);
		assert.equal(rebuilt.ready, true);
		assert.equal(rebuilt.packetId, built.packetId);
		assert.equal(rebuilt.digest, built.digest);
	});
});

test("terminal_current_work blocks readiness when a plan task is still pending", async () => {
	await withReadinessRuntime(async ({ runtime, databasePath }) => {
		const workflowId = await createStartedWorkflow(runtime);
		const tasks = standardTasks();
		tasks.push({
			key: "review-extra",
			kind: "review",
			role: "critic",
			objective: "Extra review",
			dependsOn: ["review-all"],
			inputs: [],
			expectedArtifactEffects: [],
			completionPolicyRef: "review/v1",
			maxAttempts: 3,
		});
		await adoptPlan(runtime, workflowId, tasks);
		executeAnalystTask(runtime, workflowId);
		executeArchitectTask(runtime, workflowId);
		executeCriticTask(runtime, databasePath, workflowId);
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
		// Replan with rework + two verify cycles targeting the open Finding Thread
		await adoptPlan(runtime, workflowId, [
			{
				key: "analyze-2",
				kind: "analyze",
				role: "analyst",
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
				inputs: [{ type: "finding", findingId, targetRevisionId: analysisRevisionId, purpose: "verify closure" }],
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
				inputs: [{ type: "finding", findingId, targetRevisionId: analysisRevisionId, purpose: "verify closure" }],
				expectedArtifactEffects: [],
				completionPolicyRef: "verify/v1",
				maxAttempts: 3,
			},
		]);
		executeAnalystTask(runtime, workflowId, { baseRevisionId: analysisRevisionId });
		executeCriticTask(runtime, databasePath, workflowId, { findings: [{ fingerprint: "fp-minor-1", severity: "minor", summary: "Still open", resolved: false }] });
		executeCriticTask(runtime, databasePath, workflowId, { findings: [{ fingerprint: "fp-minor-1", severity: "minor", summary: "Still open", resolved: false }] });
		const projection = runtime.getWorkflowProjection(workflowId);
		assert.equal(projection?.workflow.state, "waiting_for_human");
		const report = runtime.checkReadiness(workflowId);
		assert.equal(report.ready, false);
		assertOnlyCheckFails(report, "no_gate");
	});
});

test("complete_impact_profile blocks readiness when a dimension is unknown", async () => {
	await withReadinessRuntime(async (fixture) => {
		const workflowId = await createFullyReviewedWorkflow(fixture, { impactStatus: "unknown" });
		const report = fixture.runtime.checkReadiness(workflowId);
		assert.equal(report.ready, false);
		assertOnlyCheckFails(report, "complete_impact_profile");
	});
});

test("complete_required_artifacts blocks readiness when a required kind is missing", async () => {
	await withReadinessRuntime(async ({ runtime, databasePath }) => {
		const workflowId = await createStartedWorkflow(runtime);
		// Plan without a design task: design remains a required kind but is never produced
		await adoptPlan(runtime, workflowId, [
			standardTasks()[0]!,
			{
				key: "review-all",
				kind: "review",
				role: "critic",
				objective: "Review artifacts",
				dependsOn: ["analyze-req"],
				inputs: [{ type: "task_output", taskKey: "analyze-req", artifactKind: "analysis", purpose: "review" }],
				expectedArtifactEffects: [],
				completionPolicyRef: "review/v1",
				maxAttempts: 3,
			},
		]);
		executeAnalystTask(runtime, workflowId);
		executeCriticTask(runtime, databasePath, workflowId, { coverKinds: ["requirement", "analysis"] });
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
		await adoptPlan(fixture.runtime, workflowId, [
			{
				key: "analyze-2",
				kind: "analyze",
				role: "analyst",
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
				inputs: [{ type: "task_output", taskKey: "analyze-2", artifactKind: "analysis", purpose: "review" }],
				expectedArtifactEffects: [],
				completionPolicyRef: "review/v1",
				maxAttempts: 3,
			},
		]);
		executeAnalystTask(fixture.runtime, workflowId, { baseRevisionId: analysisRevisionId });
		executeCriticTask(fixture.runtime, fixture.databasePath, workflowId);
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
		const workflowId = await createStartedWorkflow(fixture.runtime);
		await adoptPlan(fixture.runtime, workflowId, standardTasks());
		executeAnalystTask(fixture.runtime, workflowId, {
			decisions: [
				{ severity: "critical", summary: "Critical choice" },
				{ severity: "minor", summary: "Minor choice" },
			],
		});
		executeArchitectTask(fixture.runtime, workflowId);
		executeCriticTask(fixture.runtime, fixture.databasePath, workflowId);
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
				/ApprovalPacket is immutable/,
			);
			assert.throws(
				() => db.prepare("delete from approval_packets where id = ?").run(built.packetId),
				/ApprovalPacket is immutable/,
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
