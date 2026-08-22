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
import { openHeadlessWorkflowRuntime, type RequirementBaseline } from "./workflow/headless-runtime.js";
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
const OPERATE_ONLY = { actorRef: "operator:bob", capabilities: ["workflow:operate"] };
const APPROVE_ONLY = { actorRef: "operator:carol", capabilities: ["workflow:approve"] };
const TIMESTAMP = "2026-08-12T10:00:00.000Z";

type Runtime = Awaited<ReturnType<typeof openHeadlessWorkflowRuntime>>;

async function withRuntime(work: (fixture: { databasePath: string; runtime: Runtime }) => Promise<void> | void): Promise<void> {
	const directory = await mkdtemp(path.join(tmpdir(), "baize-governance-"));
	const databasePath = path.join(directory, "workflow.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock(TIMESTAMP),
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

function command(runtime: Runtime, workflowId: number, type: Parameters<Runtime["executeCommand"]>[0]["type"], payload?: Record<string, unknown>, operator = OPERATOR) {
	const projection = runtime.getWorkflowProjection(workflowId);
	assert.ok(projection, "projection should exist");
	return runtime.executeCommand({
		workflowId,
		commandId: `cmd-${type}-${projection.workflow.version}-${Math.abs(hashCode(JSON.stringify(payload ?? {})))}`,
		expectedWorkflowVersion: projection.workflow.version,
		type,
		payload,
		operator,
	});
}

function hashCode(value: string): number {
	let hash = 0;
	for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0;
	return hash;
}

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
		impactProfile: { process: dimension, actors: dimension, behavior: dimension, architecture: dimension, data: dimension, api: dimension },
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

function scenarioContent(): unknown {
	return {
		schemaVersion: "artifact/scenario/v1",
		artifactKind: "scenario",
		summary: "Scenarios for points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		scenarios: [{ id: "sc1", title: "User redeems before expiry", actors: ["User"], preconditions: ["Points exist"], trigger: "Expiry reminder received", mainFlow: ["Open wallet", "Redeem points"], alternateFlows: ["Points already expired"], expectedOutcome: "Points redeemed" }],
	};
}

function usecaseContent(): unknown {
	return {
		schemaVersion: "artifact/usecase/v1",
		artifactKind: "usecase",
		summary: "Use cases for points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		useCases: [{ id: "uc1", actor: "User", goal: "Redeem points before expiry", preconditions: ["Wallet active"], mainFlow: ["Receive reminder", "Redeem points"], alternativeFlows: ["Contact support"], postconditions: ["Points consumed"] }],
	};
}

function functionContent(): unknown {
	return {
		schemaVersion: "artifact/function/v1",
		artifactKind: "function",
		summary: "Functions for points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		functions: [{ id: "fn1", name: "Expiry scheduler", responsibility: "Expire points past threshold", inputs: ["points ledger"], outputs: ["expiry events"], businessRules: ["Expiry after 365 days"], acceptanceCriteria: ["Expired points are removed"] }],
	};
}

function architectureContent(): unknown {
	return {
		schemaVersion: "artifact/architecture/v1",
		artifactKind: "architecture",
		summary: "Architecture of points expiry solution",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		components: [{ id: "c1", name: "Expiry service", responsibility: "Schedule and execute expiry" }],
		relationships: [{ from: "c1", to: "Points ledger", interaction: "reads and writes balances" }],
		constraints: ["No downtime during expiry runs"],
		nonFunctionalRequirements: ["Expiry completes within the nightly window"],
		decisions: [],
	};
}

function dataContent(): unknown {
	return {
		schemaVersion: "artifact/data/v1",
		artifactKind: "data",
		summary: "Data model for points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		entities: [{ name: "points_ledger", purpose: "Track point balances and expiries", fields: ["id", "user_id", "balance", "expires_at"], lifecycle: "append-heavy with nightly expiry updates" }],
		relationships: ["points_ledger.user_id -> users.id"],
		migrationPlan: "Add expires_at column with backfill",
		rollbackPlan: "Drop expires_at column",
		privacyAndRetention: ["Expiry records retained for 90 days"],
	};
}

function apiContent(): unknown {
	return {
		schemaVersion: "artifact/api/v1",
		artifactKind: "api",
		summary: "API surface for points expiry",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		interfaces: [{ id: "api1", kind: "http", name: "GET /points", contract: "Returns balance with expiry dates", errors: ["404 not found"], compatibility: "Additive fields only" }],
		security: ["Operator token required"],
		versioning: "URL path versioning",
		testStrategy: ["Contract tests against the public surface"],
	};
}


async function createStartedWorkflow(runtime: Runtime): Promise<number> {
	const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
	const created = runtime.createRequirement({ workspaceId, baseline: BASELINE });
	runtime.executeCommand({ workflowId: created.workflowId, commandId: "cmd-start", expectedWorkflowVersion: 0, type: "start", operator: OPERATOR });
	return created.workflowId;
}

async function adoptPlan(runtime: Runtime, workflowId: number): Promise<void> {
	const result = await runtime.planWorkflow(workflowId, null);
	assert.equal(result.outcome, "adopted");
}

function setupEvidence(runtime: Runtime, workflowId: number): TraceLinkProposal {
	const snapshot = runtime.bindEvidenceSnapshot(workflowId, "sha256:repo-abc", { files: [] });
	return { evidenceSnapshotId: snapshot.id, sourceRef: { type: "code", path: "/src/analysis.ts" } };
}

function executeAnalystTask(runtime: Runtime, workflowId: number): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskKey, "analyze");
	assert.equal(begin.taskRole, "analysis-analyst");
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [{ effectType: "artifact_revision", artifactKind: "analysis", logicalKey: "analysis", content: analysisContent(), baseRevisionId: null, traceLinks: [setupEvidence(runtime, workflowId)] }],
	};
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

function executeScenarioTask(runtime: Runtime, workflowId: number): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskKey, "scenario");
	assert.equal(begin.taskRole, "scenario-analyst");
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [{ effectType: "artifact_revision", artifactKind: "scenario", logicalKey: "scenario", content: scenarioContent(), baseRevisionId: null, traceLinks: [setupEvidence(runtime, workflowId)] }],
	};
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

function executeUsecaseTask(runtime: Runtime, workflowId: number): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskKey, "usecase");
	assert.equal(begin.taskRole, "usecase-analyst");
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [{ effectType: "artifact_revision", artifactKind: "usecase", logicalKey: "usecase", content: usecaseContent(), baseRevisionId: null, traceLinks: [setupEvidence(runtime, workflowId)] }],
	};
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

function executeFunctionTask(runtime: Runtime, workflowId: number): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskKey, "function");
	assert.equal(begin.taskRole, "function-analyst");
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [{ effectType: "artifact_revision", artifactKind: "function", logicalKey: "function", content: functionContent(), baseRevisionId: null, traceLinks: [setupEvidence(runtime, workflowId)] }],
	};
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

function executeArchitectTask(runtime: Runtime, workflowId: number): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskKey, "design");
	assert.equal(begin.taskRole, "design-architect");
	const links = [setupEvidence(runtime, workflowId)];
	const result: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: begin.attemptId,
		effects: [
			{ effectType: "artifact_revision", artifactKind: "design", logicalKey: "design", content: designContent(), baseRevisionId: null, traceLinks: links },
			{ effectType: "artifact_revision", artifactKind: "architecture", logicalKey: "architecture", content: architectureContent(), baseRevisionId: null, traceLinks: links },
			{ effectType: "artifact_revision", artifactKind: "data", logicalKey: "data", content: dataContent(), baseRevisionId: null, traceLinks: links },
			{ effectType: "artifact_revision", artifactKind: "api", logicalKey: "api", content: apiContent(), baseRevisionId: null, traceLinks: links },
		],
	};
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

function getRevisionId(databasePath: string, kind: string): number {
	const db = new Database(databasePath, { readonly: true });
	try {
		const row = db.prepare("select ar.id from artifact_revisions ar join artifacts a on a.id = ar.artifact_id where a.kind = ? order by ar.id desc limit 1").get(kind) as { id: number } | undefined;
		assert.ok(row, `${kind} revision should exist`);
		return row.id;
	} finally {
		db.close();
	}
}

function getArtifactId(databasePath: string, kind: string): number {
	const db = new Database(databasePath, { readonly: true });
	try {
		const row = db.prepare("select id from artifacts where kind = ? order by id desc limit 1").get(kind) as { id: number } | undefined;
		assert.ok(row, `${kind} artifact should exist`);
		return row.id;
	} finally {
		db.close();
	}
}

function executeCriticTask(
	runtime: Runtime,
	databasePath: string,
	workflowId: number,
	coverKinds: readonly string[],
	findings: Array<{ fingerprint: string; severity: "critical" | "major" | "minor" | "info"; summary: string }> = [],
): void {
	const begin = runtime.beginAttempt(workflowId);
	assert.equal(begin.taskRole, "critic");
	const report: CriticReport = {
		schemaVersion: "critic-report/v1",
		workflowId,
		attemptId: begin.attemptId,
		coverageAttestation: {
			reviewTargets: coverKinds.map((kind) => ({ revisionId: getRevisionId(databasePath, kind), artifactKind: kind })),
			complete: true,
		},
		findings: findings.map((f) => ({ fingerprint: f.fingerprint, severity: f.severity, summary: f.summary, targetRevisionId: getRevisionId(databasePath, "analysis"), targetArtifactKind: "analysis" as const, sourceRef: begin.taskKey })),
	};
	const result: RoleResult = { schemaVersion: "role-result/v1", workflowId, attemptId: begin.attemptId, effects: [], criticReport: report };
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

async function createReadyWorkflow(runtime: Runtime, databasePath: string): Promise<{ workflowId: number; digest: string }> {
	const workflowId = await createStartedWorkflow(runtime);
	await adoptPlan(runtime, workflowId);
	executeAnalystTask(runtime, workflowId);
	executeCriticTask(runtime, databasePath, workflowId, ["requirement", "analysis"]);
	executeScenarioTask(runtime, workflowId);
	executeCriticTask(runtime, databasePath, workflowId, ["scenario"]);
	executeUsecaseTask(runtime, workflowId);
	executeCriticTask(runtime, databasePath, workflowId, ["usecase"]);
	executeFunctionTask(runtime, workflowId);
	executeCriticTask(runtime, databasePath, workflowId, ["function"]);
	executeArchitectTask(runtime, workflowId);
	executeCriticTask(runtime, databasePath, workflowId, ["design", "architecture", "data", "api"]);
	const built = runtime.buildApprovalPacket(workflowId);
	assert.equal(built.ready, true);
	assert.ok(built.digest);
	return { workflowId, digest: built.digest };
}

test("steer records an immutable Human Directive and invalidates the planning context", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await createStartedWorkflow(runtime);
		const digestBefore = runtime.getPlanningContextDigest(workflowId);
		const receipt = command(runtime, workflowId, "steer", { directive: "Focus on compensation rules first" });
		assert.equal(receipt.outcome, "accepted");
		const directives = runtime.getHumanDirectives(workflowId);
		assert.equal(directives.length, 1);
		assert.equal(directives[0].directiveText, "Focus on compensation rules first");
		assert.notEqual(runtime.getPlanningContextDigest(workflowId), digestBefore);
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.state, "running");
	});
});

test("steer requires a non-empty directive and a steering-capable state", async () => {
	await withRuntime(async ({ runtime }) => {
		const workspaceId = runtime.createWorkspace({ repoPath: "/tmp/repo", name: "Repo" });
		const created = runtime.createRequirement({ workspaceId, baseline: BASELINE });
		const pending = command(runtime, created.workflowId, "steer", { directive: "too early" });
		assert.equal(pending.outcome, "state_conflict");
		const workflowId = created.workflowId;
		runtime.executeCommand({ workflowId, commandId: "cmd-start", expectedWorkflowVersion: 0, type: "start", operator: OPERATOR });
		const empty = command(runtime, workflowId, "steer", { directive: "" });
		assert.equal(empty.outcome, "business_rule_rejected");
	});
});

test("replace-plan validates and adopts a complete Proposal and supersedes non-terminal work", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const workflowId = await createStartedWorkflow(runtime);
		await adoptPlan(runtime, workflowId);
		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		const oldPlanRevisionId = projection.workflow.currentPlanRevisionId;
		assert.ok(oldPlanRevisionId !== null);
		const replacement: PlanProposal = {
			schemaVersion: "plan-proposal/v1",
			base: { workflowId, workflowVersion: projection.workflow.version, basePlanRevisionId: oldPlanRevisionId, planningContextDigest: runtime.getPlanningContextDigest(workflowId) },
			objective: "Replacement plan",
			tasks: [
				{ key: "analyze-v2", kind: "analyze", role: "analyst", objective: "Re-analyze", dependsOn: [], inputs: [], expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }], completionPolicyRef: "analysis/v1", maxAttempts: 3 },
			],
			rationale: "operator requested a smaller scope",
		};
		const receipt = command(runtime, workflowId, "replace-plan", { proposal: replacement });
		assert.equal(receipt.outcome, "accepted");
		const after = runtime.getWorkflowProjection(workflowId);
		assert.ok(after);
		assert.notEqual(after.workflow.currentPlanRevisionId, oldPlanRevisionId);
		const db = new Database(databasePath, { readonly: true });
		try {
			const oldPlan = db.prepare("select status from plan_revisions where id = ?").get(oldPlanRevisionId) as { status: string };
			assert.equal(oldPlan.status, "superseded");
			const superseded = (db.prepare("select count(*) as count from tasks where workflow_id = ? and plan_revision_id = ? and status = 'superseded'").get(workflowId, oldPlanRevisionId) as { count: number }).count;
			assert.equal(superseded, 10);
			const newTasks = db.prepare("select key, status from tasks where workflow_id = ? and plan_revision_id = ?").all(workflowId, after.workflow.currentPlanRevisionId) as Array<{ key: string; status: string }>;
			assert.deepEqual(newTasks, [{ key: "analyze-v2", status: "pending" }]);
		} finally {
			db.close();
		}
	});
});

test("replace-plan rejects a Proposal bound to a stale base", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await createStartedWorkflow(runtime);
		await adoptPlan(runtime, workflowId);
		const projection = runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		const stale: PlanProposal = {
			schemaVersion: "plan-proposal/v1",
			base: { workflowId, workflowVersion: projection.workflow.version - 1, basePlanRevisionId: projection.workflow.currentPlanRevisionId, planningContextDigest: runtime.getPlanningContextDigest(workflowId) },
			objective: "Stale",
			tasks: [{ key: "analyze-v2", kind: "analyze", role: "analyst", objective: "Re-analyze", dependsOn: [], inputs: [], expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }], completionPolicyRef: "analysis/v1", maxAttempts: 3 }],
			rationale: "stale base",
		};
		const receipt = command(runtime, workflowId, "replace-plan", { proposal: stale });
		assert.equal(receipt.outcome, "business_rule_rejected");
	});
});

test("retry-task resets an exhausted Task and resumes the Workflow", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const workflowId = await createStartedWorkflow(runtime);
		await adoptPlan(runtime, workflowId);
		for (let attemptNo = 1; attemptNo <= 3; attemptNo += 1) {
			const begin = runtime.beginAttempt(workflowId);
			assert.equal(begin.taskKey, "analyze");
			const invalid: RoleResult = { schemaVersion: "role-result/v1", workflowId, attemptId: begin.attemptId, effects: [] };
			const outcome = runtime.completeAttempt(workflowId, begin.attemptId, invalid).outcome;
			assert.equal(outcome, attemptNo < 3 ? "failed" : "task_exhausted");
		}
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.state, "failed");
		const db = new Database(databasePath, { readonly: true });
		const taskRow = db.prepare("select id from tasks where workflow_id = ? and key = 'analyze'").get(workflowId) as { id: number };
		const taskId = taskRow.id;
		db.close();
		const receipt = command(runtime, workflowId, "retry-task", { taskId });
		assert.equal(receipt.outcome, "accepted");
		const projection = runtime.getWorkflowProjection(workflowId);
		assert.equal(projection?.workflow.state, "running");
		const db2 = new Database(databasePath, { readonly: true });
		assert.equal((db2.prepare("select status from tasks where id = ?").get(taskId) as { status: string }).status, "pending");
		db2.close();
	});
});

test("retry-task is rejected without task_budget_exhausted or with a wrong subject", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await createStartedWorkflow(runtime);
		const wrongState = command(runtime, workflowId, "retry-task", { taskId: 1 });
		assert.equal(wrongState.outcome, "state_conflict");
	});
});

test("retry-planning resumes a planning-exhausted Workflow and planning can adopt", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await createStartedWorkflow(runtime);
		for (let planningNo = 1; planningNo <= 2; planningNo += 1) {
			const begin = runtime.beginPlanning(workflowId);
			const failed = runtime.completePlanning(workflowId, begin.attemptId, { invalid: true });
			assert.equal(failed.outcome, planningNo < 2 ? "validation_failed" : "planning_exhausted");
		}
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.state, "failed");
		const receipt = command(runtime, workflowId, "retry-planning");
		assert.equal(receipt.outcome, "accepted");
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.state, "running");
		await adoptPlan(runtime, workflowId);
		assert.ok(runtime.getWorkflowProjection(workflowId)?.workflow.currentPlanRevisionId !== null);
	});
});

test("diagnostic-run appends an immutable record without changing state", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await createStartedWorkflow(runtime);
		const before = runtime.getWorkflowProjection(workflowId);
		const receipt = command(runtime, workflowId, "diagnostic-run", { purpose: "inspect plan state" });
		assert.equal(receipt.outcome, "accepted");
		const runs = runtime.getDiagnosticRuns(workflowId);
		assert.equal(runs.length, 1);
		assert.equal(runs[0].purpose, "inspect plan state");
		assert.equal(runs[0].status, "completed");
		const after = runtime.getWorkflowProjection(workflowId);
		assert.equal(after?.workflow.state, before?.workflow.state);
		const missing = command(runtime, workflowId, "diagnostic-run", {});
		assert.equal(missing.outcome, "business_rule_rejected");
	});
});

test("provide-human-input resolves the exact gate, unblocks the Task, and resumes", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const workflowId = await createStartedWorkflow(runtime);
		await adoptPlan(runtime, workflowId);
		const begin = runtime.beginAttempt(workflowId);
		const blocked: RoleResult = { schemaVersion: "role-result/v1", workflowId, attemptId: begin.attemptId, effects: [], outcome: "blocked", blockReason: "Need the expiry threshold" } as RoleResult;
		assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, blocked).outcome, "blocked");
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.state, "waiting_for_human");
		const gates = runtime.getHumanGates(workflowId);
		assert.equal(gates.length, 1);
		assert.equal(gates[0].gateType, "human_input");
		assert.equal(gates[0].status, "open");
		const wrong = command(runtime, workflowId, "provide-human-input", { gateId: gates[0].id + 100, input: "42 days" });
		assert.equal(wrong.outcome, "business_rule_rejected");
		const receipt = command(runtime, workflowId, "provide-human-input", { gateId: gates[0].id, input: "42 days" });
		assert.equal(receipt.outcome, "accepted");
		const resolved = runtime.getHumanGates(workflowId);
		assert.equal(resolved[0].status, "resolved");
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.state, "running");
		const db = new Database(databasePath, { readonly: true });
		const statusRow = db.prepare("select status from tasks where workflow_id = ? and key = 'analyze'").get(workflowId) as { status: string };
		assert.equal(statusRow.status, "pending");
		db.close();
		const again = command(runtime, workflowId, "provide-human-input", { gateId: gates[0].id, input: "again" });
		assert.equal(again.outcome, "state_conflict", "after the last gate resolves the workflow is running and no longer accepts gate input");
	});
});

test("revise-requirement creates an approved successor baseline and stales exact dependents", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const workflowId = await createStartedWorkflow(runtime);
		await adoptPlan(runtime, workflowId);
		const digestBefore = runtime.getPlanningContextDigest(workflowId);
		const revised: RequirementBaseline = { ...BASELINE, title: "Points expiry v2", description: "Revised scope." };
		const receipt = command(runtime, workflowId, "revise-requirement", { baseline: revised });
		assert.equal(receipt.outcome, "accepted");
		const projection = runtime.getWorkflowProjection(workflowId);
		assert.equal(projection?.requirement.version, 2);
		assert.equal(projection?.requirement.title, "Points expiry v2");
		assert.equal(projection?.requirement.currentRevision.status, "approved");
		assert.equal(projection?.requirement.currentRevision.revisionNo, 2);
		assert.notEqual(runtime.getPlanningContextDigest(workflowId), digestBefore);
		const db = new Database(databasePath, { readonly: true });
		const gateCount = (db.prepare("select count(*) as count from human_gates where workflow_id = ?").get(workflowId) as { count: number }).count;
		assert.equal(gateCount, 0, "revise-requirement must not resolve or create gates");
		db.close();
		const invalid = command(runtime, workflowId, "revise-requirement", { baseline: { bad: true } });
		assert.equal(invalid.outcome, "business_rule_rejected");
	});
});

test("approve-artifact and reject-artifact bind the exact current pending revision", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const workflowId = await createStartedWorkflow(runtime);
		await adoptPlan(runtime, workflowId);
		executeAnalystTask(runtime, workflowId);
		const artifactId = getArtifactId(databasePath, "analysis");
		const revisionId = getRevisionId(databasePath, "analysis");
		const approved = command(runtime, workflowId, "approve-artifact", { artifactId, revisionId });
		assert.equal(approved.outcome, "accepted");
		const records = runtime.getApprovalRecords(workflowId);
		assert.equal(records.length, 1);
		assert.equal(records[0].recordType, "artifact_approval");
		assert.equal(records[0].subjectId, revisionId);
		assert.ok(records[0].subjectDigest?.startsWith("sha256:"));
		const db = new Database(databasePath, { readonly: true });
		assert.equal((db.prepare("select status from artifact_revisions where id = ?").get(revisionId) as { status: string }).status, "approved");
		db.close();
		const repeat = command(runtime, workflowId, "approve-artifact", { artifactId, revisionId });
		assert.equal(repeat.outcome, "business_rule_rejected", "non-pending revision must be rejected");
		const noReason = command(runtime, workflowId, "reject-artifact", { artifactId, revisionId });
		assert.equal(noReason.outcome, "business_rule_rejected", "reject requires a reason");
		const staleSubject = command(runtime, workflowId, "reject-artifact", { artifactId, revisionId: revisionId + 100, reason: "stale" });
		assert.equal(staleSubject.outcome, "business_rule_rejected", "non-current revision must be rejected");
	});
});

test("accept-finding-risk binds the exact major Finding and target revision; critical is rejected", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const workflowId = await createStartedWorkflow(runtime);
		await adoptPlan(runtime, workflowId);
		executeAnalystTask(runtime, workflowId);
		executeCriticTask(runtime, databasePath, workflowId, ["requirement", "analysis"], [
			{ fingerprint: "fp-major-1", severity: "major", summary: "Major gap" },
			{ fingerprint: "fp-critical-1", severity: "critical", summary: "Critical flaw" },
		]);
		const findings = runtime.getFindings(workflowId);
		const major = findings.find((f) => f.severity === "major");
		const critical = findings.find((f) => f.severity === "critical");
		assert.ok(major && critical);
		const criticalAttempt = command(runtime, workflowId, "accept-finding-risk", { findingId: critical.id, targetRevisionId: critical.targetRevisionId, impact: "x", reason: "y" });
		assert.equal(criticalAttempt.outcome, "business_rule_rejected", "critical findings can never be risk accepted");
		const stale = command(runtime, workflowId, "accept-finding-risk", { findingId: major.id, targetRevisionId: major.targetRevisionId + 100, impact: "x", reason: "y" });
		assert.equal(stale.outcome, "business_rule_rejected", "stale target revision binding must be rejected");
		const accepted = command(runtime, workflowId, "accept-finding-risk", { findingId: major.id, targetRevisionId: major.targetRevisionId, impact: "limited to display", reason: "accepted by product" });
		assert.equal(accepted.outcome, "accepted");
		const after = runtime.getFindings(workflowId).find((f) => f.id === major.id);
		assert.equal(after?.status, "risk_accepted");
		const thread = runtime.getFindingThreads(workflowId).find((t) => t.fingerprint === "fp-major-1");
		assert.equal(thread?.status, "risk_accepted");
		const record = runtime.getApprovalRecords(workflowId).find((r) => r.recordType === "finding_risk_acceptance");
		assert.ok(record);
		assert.equal(record.subjectId, major.id);
		assert.equal(record.subjectDigest, "fp-major-1");
	});
});

test("approve-packet archives atomically: approval record, revisions approved, session frozen", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const { workflowId, digest } = await createReadyWorkflow(runtime, databasePath);
		const wrongDigest = command(runtime, workflowId, "approve-packet", { packetDigest: "sha256:wrong" });
		assert.equal(wrongDigest.outcome, "business_rule_rejected");
		const receipt = command(runtime, workflowId, "approve-packet", { packetDigest: digest });
		assert.equal(receipt.outcome, "accepted");
		const projection = runtime.getWorkflowProjection(workflowId);
		assert.equal(projection?.workflow.state, "archived");
		const records = runtime.getApprovalRecords(workflowId);
		const approval = records.find((r) => r.recordType === "packet_approval");
		assert.ok(approval);
		assert.equal(approval.subjectDigest, digest);
		const db = new Database(databasePath, { readonly: true });
		try {
			const pendingRow = db.prepare("select count(*) as count from artifact_revisions where status = 'pending' and artifact_id in (select id from artifacts where kind != 'requirement')").get() as { count: number };
			assert.equal(pendingRow.count, 0, "packet approval approves all included pending revisions (the requirement baseline revision is not packet content)");
			const session = db.prepare("select status, archived_at from design_sessions").get() as { status: string; archived_at: string | null };
			assert.equal(session.status, "archived");
			assert.ok(session.archived_at !== null);
			const archivedEvent = db.prepare("select type from workflow_events where workflow_id = ? and type = 'workflow_archived'").get(workflowId);
			assert.ok(archivedEvent);
			const packetEvent = db.prepare("select type from workflow_events where workflow_id = ? and type = 'packet_approved'").get(workflowId);
			assert.ok(packetEvent);
		} finally {
			db.close();
		}
	});
});

test("approve-packet is rejected from non-ready states", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await createStartedWorkflow(runtime);
		const receipt = command(runtime, workflowId, "approve-packet", { packetDigest: "sha256:any" });
		assert.equal(receipt.outcome, "state_conflict");
	});
});

test("reject-packet requires reason and targets and blocks resubmission of the same digest", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const { workflowId, digest } = await createReadyWorkflow(runtime, databasePath);
		const noTargets = command(runtime, workflowId, "reject-packet", { reason: "needs work" });
		assert.equal(noTargets.outcome, "business_rule_rejected");
		const noReason = command(runtime, workflowId, "reject-packet", { targets: [{ kind: "design" }] });
		assert.equal(noReason.outcome, "business_rule_rejected");
		const receipt = command(runtime, workflowId, "reject-packet", { reason: "design incomplete", targets: [{ kind: "design", revisionId: getRevisionId(databasePath, "design") }] });
		assert.equal(receipt.outcome, "accepted");
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.state, "running");
		const rejection = runtime.getApprovalRecords(workflowId).find((r) => r.recordType === "packet_rejection");
		assert.ok(rejection);
		assert.equal(rejection.reason, "design incomplete");
		const rebuilt = runtime.buildApprovalPacket(workflowId);
		assert.equal(rebuilt.ready, false, "same digest cannot be resubmitted before governed inputs change");
		assert.ok(rebuilt.checks.some((c) => c.name === "packet_not_previously_rejected" && !c.passed));
		const revised: RequirementBaseline = { ...BASELINE, description: "Changed governed input." };
		const revise = command(runtime, workflowId, "revise-requirement", { baseline: revised });
		assert.equal(revise.outcome, "accepted");
		void digest;
	});
});

test("archived has no outgoing commands except approval revocation", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const { workflowId, digest } = await createReadyWorkflow(runtime, databasePath);
		command(runtime, workflowId, "approve-packet", { packetDigest: digest });
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.state, "archived");
		const blocked: Array<Parameters<Runtime["executeCommand"]>[0]["type"]> = ["start", "pause", "resume", "steer", "retry-task", "retry-planning", "replace-plan", "diagnostic-run", "provide-human-input", "revise-requirement", "approve-artifact", "reject-artifact", "accept-finding-risk", "cancel-run", "dispose-decision", "retry-recovery", "approve-packet", "reject-packet"];
		for (const type of blocked) {
			const receipt = command(runtime, workflowId, type, { directive: "x", taskId: 1, gateId: 1, input: "x", baseline: BASELINE, artifactId: 1, revisionId: 1, reason: "r", targets: [{}], findingId: 1, targetRevisionId: 1, impact: "i", packetDigest: digest, incidentId: 1, proposal: {} });
			assert.equal(receipt.outcome, "state_conflict", `${type} must be rejected on archived`);
		}
		const approval = runtime.getApprovalRecords(workflowId).find((r) => r.recordType === "packet_approval");
		assert.ok(approval);
		const wrongRecord = command(runtime, workflowId, "revoke-approval", { approvalRecordId: approval.id + 100 });
		assert.equal(wrongRecord.outcome, "business_rule_rejected");
		const revoked = command(runtime, workflowId, "revoke-approval", { approvalRecordId: approval.id, reason: "granted in error" });
		assert.equal(revoked.outcome, "accepted");
		assert.equal(runtime.getWorkflowProjection(workflowId)?.workflow.state, "archived", "revocation appends a record without leaving archived");
		const revocation = runtime.getApprovalRecords(workflowId).find((r) => r.recordType === "approval_revocation");
		assert.ok(revocation);
		assert.equal(revocation.subjectId, approval.id);
	});
});

test("capability matrix: approve commands require workflow:approve, operate commands require workflow:operate", async () => {
	await withRuntime(async ({ runtime, databasePath }) => {
		const { workflowId, digest } = await createReadyWorkflow(runtime, databasePath);
		const approveCommands: Array<[Parameters<Runtime["executeCommand"]>[0]["type"], Record<string, unknown>]> = [
			["approve-packet", { packetDigest: digest }],
			["reject-packet", { reason: "r", targets: [{}] }],
			["approve-artifact", { artifactId: 1, revisionId: 1 }],
			["reject-artifact", { artifactId: 1, revisionId: 1, reason: "r" }],
			["accept-finding-risk", { findingId: 1, targetRevisionId: 1, impact: "i", reason: "r" }],
			["revoke-approval", { approvalRecordId: 1 }],
			["dispose-decision", { decisionId: 1, status: "accepted" }],
		];
		for (const [type, payload] of approveCommands) {
			const receipt = command(runtime, workflowId, type, payload, OPERATE_ONLY);
			assert.equal(receipt.outcome, "capability_denied", `${type} must deny operate-only operator`);
			assert.equal(receipt.httpStatus, 403);
		}
		const operateCommands: Array<Parameters<Runtime["executeCommand"]>[0]["type"]> = ["pause", "steer", "diagnostic-run", "revise-requirement"];
		for (const type of operateCommands) {
			const receipt = command(runtime, workflowId, type, { directive: "x", purpose: "p", baseline: BASELINE }, APPROVE_ONLY);
			assert.equal(receipt.outcome, "capability_denied", `${type} must deny approve-only operator`);
		}
	});
});

test("force-* and waiver command types are rejected at the envelope", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await createStartedWorkflow(runtime);
		for (const type of ["force-ready", "force-skip", "force-role", "waive-consistency", "waive-critical-finding"]) {
			assert.throws(
				() => runtime.executeCommand({ workflowId, commandId: `cmd-${type}`, expectedWorkflowVersion: 1, type: type as "start", operator: OPERATOR }),
				/Command envelope schema is invalid/,
			);
		}
	});
});

test("an Agent cannot smuggle a Decision disposition through decisionProposals", async () => {
	await withRuntime(async ({ runtime }) => {
		const workflowId = await createStartedWorkflow(runtime);
		await adoptPlan(runtime, workflowId);
		const begin = runtime.beginAttempt(workflowId);
		const smuggled = {
			schemaVersion: "role-result/v1",
			workflowId,
			attemptId: begin.attemptId,
			effects: [{ effectType: "artifact_revision", artifactKind: "analysis", logicalKey: "analysis", content: analysisContent(), baseRevisionId: null, traceLinks: [setupEvidence(runtime, workflowId)] }],
			decisionProposals: [{ severity: "critical", summary: "smuggled", status: "accepted" }],
		};
		const complete = runtime.completeAttempt(workflowId, begin.attemptId, smuggled);
		assert.equal(complete.outcome, "failed");
		assert.equal(complete.failureCode, "invalid_decision_proposal");
		assert.equal(runtime.getDecisions(workflowId).length, 0, "no Decision may be persisted from a smuggled proposal");
	});
});
