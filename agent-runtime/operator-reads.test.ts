import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createCrashInjector,
	createFixtureClock,
	createFixtureOperator,
	createHashProvider,
	createOutboxTransport,
} from "./testing/deterministic-fixtures.js";
import {
	openHeadlessWorkflowRuntime,
	type HeadlessWorkflowRuntime,
} from "./workflow/headless-runtime.js";
import { startOperatorServer, type OperatorServer } from "./workflow/operator-server.js";
import type { PlanProposal } from "./workflow/plan-types.js";
import type { RequirementBaseline } from "./workflow/requirement.js";
import type { CriticReport, RoleResult, TraceLinkProposal } from "./workflow/role-result.js";

const ADMIN = createFixtureOperator("admin");
const TIMESTAMP = "2026-08-12T10:00:00.000Z";

function baseline(title = "Read model requirement"): RequirementBaseline {
	return {
		schemaVersion: "artifact/requirement/v1",
		artifactKind: "requirement",
		summary: title,
		sourceRefs: [],
		title,
		description: "Created for read model tests.",
	};
}

interface ReadContext {
	server: OperatorServer;
	runtime: HeadlessWorkflowRuntime;
	workspaceId: number;
	databasePath: string;
	cookie: string;
}

async function withReadServer(run: (context: ReadContext) => Promise<void>): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), "operator-reads-"));
	const databasePath = join(directory, "test.db");
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath,
		clock: createFixtureClock(TIMESTAMP),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(),
		outboxTransport: createOutboxTransport(),
	});
	const server = await startOperatorServer({ runtime, operators: { "token-admin": ADMIN } });
	try {
		const session = await fetch(`${server.url}/api/session`, {
			method: "POST",
			headers: { authorization: "Bearer token-admin" },
		});
		assert.equal(session.status, 201);
		const cookie = (session.headers.get("set-cookie") as string).split(";")[0];
		await run({
			server,
			runtime,
			workspaceId: runtime.createWorkspace({ repoPath: "/repo", name: "repo" }),
			databasePath,
			cookie,
		});
	} finally {
		await server.close();
		runtime.close();
		rmSync(directory, { recursive: true, force: true });
	}
}

async function get(context: ReadContext, path: string): Promise<Response> {
	return fetch(`${context.server.url}${path}`, { headers: { cookie: context.cookie } });
}

function putCommand(
	context: ReadContext,
	workflowId: number,
	commandId: string,
	body: unknown,
): Promise<Response> {
	return fetch(`${context.server.url}/api/workflows/${workflowId}/commands/${commandId}`, {
		method: "PUT",
		headers: { "content-type": "application/json", cookie: context.cookie },
		body: JSON.stringify(body),
	});
}

async function createStartedWorkflow(context: ReadContext, title = "Read model requirement"): Promise<{ requirementId: number; workflowId: number }> {
	const created = await fetch(`${context.server.url}/api/workspaces/${context.workspaceId}/requirements`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie: context.cookie },
		body: JSON.stringify({ baseline: baseline(title) }),
	});
	assert.equal(created.status, 201);
	const body = (await created.json()) as { requirementId: number; workflowId: number };
	const started = await putCommand(context, body.workflowId, `start-${body.workflowId}`, { type: "start", expectedWorkflowVersion: 0 });
	assert.equal(started.status, 201);
	return body;
}

function analysisContent(): unknown {
	const dimension = { status: "no", rationale: "rationale" };
	return {
		schemaVersion: "artifact/analysis/v1",
		artifactKind: "analysis",
		summary: "Analysis",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		goals: ["g"],
		nonGoals: ["n"],
		constraints: ["c"],
		acceptanceCriteria: ["a"],
		impactProfile: { process: dimension, actors: dimension, behavior: dimension, architecture: dimension, data: dimension, api: dimension },
		openQuestions: [],
	};
}

function designContent(): unknown {
	return {
		schemaVersion: "artifact/design/v1",
		artifactKind: "design",
		summary: "Design",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		changeUnits: [{ id: "cu1", area: "points", change: "Add expiry", rationale: "rule", sourceRefs: [{ type: "requirement_revision", revisionId: 1 }] }],
		alternatives: ["none"],
		failureHandling: ["retry"],
		testStrategy: ["unit"],
		implementationOrder: ["seq"],
		rolloutStrategy: "canary",
		rollbackStrategy: "revert",
	};
}

function scenarioContent(): unknown {
	return {
		schemaVersion: "artifact/scenario/v1",
		artifactKind: "scenario",
		summary: "Scenarios for read model",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		domains: [{
			nodeId: "d1",
			title: "Read model",
			scenarios: [{
				nodeId: "sc1",
				title: "Read a requirement",
				variants: [{
					nodeId: "v1",
					title: "Read a requirement",
					actors: ["Operator"],
					preconditions: ["Requirement exists"],
					trigger: "Requirement list opened",
					mainFlow: ["Open workspace", "Read requirement"],
					alternateFlows: [],
					expectedOutcome: "Requirement is read",
				}],
			}],
		}],
	};
}

function usecaseContent(): unknown {
	return {
		schemaVersion: "artifact/usecase/v1",
		artifactKind: "usecase",
		summary: "Use cases for read model",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		useCases: [{ id: "uc1", actor: "Operator", goal: "Read requirement summaries", preconditions: ["Session is authenticated"], mainFlow: ["Open list", "Pick requirement"], alternativeFlows: [], postconditions: ["Detail is shown"] }],
	};
}

function functionContent(): unknown {
	return {
		schemaVersion: "artifact/function/v1",
		artifactKind: "function",
		summary: "Functions for read model",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		domains: [{
			nodeId: "fd1",
			title: "Read model",
			items: [{
				nodeId: "fi1",
				title: "Requirement queries",
				points: [{
					nodeId: "fp1",
					name: "Requirement listing",
					responsibility: "Return workflow summaries in stable order",
					inputs: ["workspaceId"],
					outputs: ["requirement summaries"],
					businessRules: ["Stable ordering by creation"],
					acceptanceCriteria: ["List returns newest workflows with state"],
				}],
			}],
		}],
	};
}

function architectureContent(): unknown {
	return {
		schemaVersion: "artifact/architecture/v1",
		artifactKind: "architecture",
		summary: "Architecture of read model",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		components: [{ componentId: "c1", name: "Operator server", responsibility: "Serve bounded read projections" }],
		relationships: [{ relationshipId: "r1", fromComponentId: "c1", toComponentId: "workflow-store", interaction: "reads projections" }],
		constraints: ["Reads never mutate state"],
		nonFunctionalRequirements: ["Reads respond within the operator budget"],
	};
}

function dataContent(): unknown {
	return {
		schemaVersion: "artifact/data/v1",
		artifactKind: "data",
		summary: "Data model for read model",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		entities: [{
			entityId: "ent-requirements",
			name: "requirements",
			fields: [
				{ fieldId: "f-id", name: "id", type: "integer" },
				{ fieldId: "f-workspace-id", name: "workspace_id", type: "integer" },
				{ fieldId: "f-title", name: "title", type: "string" },
			],
		}],
		relations: [{
			fromEntityId: "ent-requirements",
			fromFieldIds: ["f-workspace-id"],
			toEntityId: "ent-workspaces",
			toFieldIds: ["f-id"],
			cardinality: "many-to-one",
		}],
	};
}

function apiContent(): unknown {
	return {
		schemaVersion: "artifact/api/v1",
		artifactKind: "api",
		summary: "API surface for read model",
		sourceRefs: [{ type: "requirement_revision", revisionId: 1 }],
		openapi: "3.1.0",
		info: { title: "Read model API", version: "1.0.0" },
		paths: {
			"/api/requirements": {
				summary: "Requirement summaries",
				get: {
					summary: "List requirement summaries",
					responses: {
						"200": { description: "Requirement summaries" },
						"404": { description: "Unknown workspace" },
					},
				},
			},
		},
	};
}


async function adoptPlan(runtime: HeadlessWorkflowRuntime, workflowId: number): Promise<void> {
	// The operator server starts Engine-direct planning synchronously before
	// returning the start receipt. If a current plan already exists, do nothing;
	// otherwise instantiate one directly.
	const projection = runtime.getWorkflowProjection(workflowId);
	if (projection?.workflow.currentPlanRevisionId) {
		return;
	}
	const result = await runtime.planWorkflow(workflowId, null);
	assert.equal(result.outcome, "adopted");
}

function setupEvidence(runtime: HeadlessWorkflowRuntime, workflowId: number): TraceLinkProposal {
	const snapshot = runtime.bindEvidenceSnapshot(workflowId, `sha256:repo-${workflowId}`, { files: [] });
	return { evidenceSnapshotId: snapshot.id, sourceRef: { type: "code", path: "/src/a.ts" } };
}

function executeAnalystTask(runtime: HeadlessWorkflowRuntime, workflowId: number): void {
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

function executeScenarioTask(runtime: HeadlessWorkflowRuntime, workflowId: number): void {
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

function executeUsecaseTask(runtime: HeadlessWorkflowRuntime, workflowId: number): void {
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

function executeFunctionTask(runtime: HeadlessWorkflowRuntime, workflowId: number): void {
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

function executeArchitectTask(runtime: HeadlessWorkflowRuntime, workflowId: number): void {
	const links = [setupEvidence(runtime, workflowId)];
	const designBegin = runtime.beginAttempt(workflowId);
	assert.equal(designBegin.taskKey, "design");
	assert.equal(designBegin.taskRole, "design-architect");
	const designResult: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: designBegin.attemptId,
		effects: [{ effectType: "artifact_revision", artifactKind: "design", logicalKey: "design", content: designContent(), baseRevisionId: null, traceLinks: links }],
	};
	assert.equal(runtime.completeAttempt(workflowId, designBegin.attemptId, designResult).outcome, "published");
	const archBegin = runtime.beginAttempt(workflowId);
	assert.equal(archBegin.taskKey, "architecture");
	assert.equal(archBegin.taskRole, "architecture-architect");
	const archResult: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: archBegin.attemptId,
		effects: [{ effectType: "artifact_revision", artifactKind: "architecture", logicalKey: "architecture", content: architectureContent(), baseRevisionId: null, traceLinks: links }],
	};
	assert.equal(runtime.completeAttempt(workflowId, archBegin.attemptId, archResult).outcome, "published");
	const dataBegin = runtime.beginAttempt(workflowId);
	assert.equal(dataBegin.taskKey, "data");
	assert.equal(dataBegin.taskRole, "data-architect");
	const dataResult: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: dataBegin.attemptId,
		effects: [{ effectType: "artifact_revision", artifactKind: "data", logicalKey: "data", content: dataContent(), baseRevisionId: null, traceLinks: links }],
	};
	assert.equal(runtime.completeAttempt(workflowId, dataBegin.attemptId, dataResult).outcome, "published");
	const apiBegin = runtime.beginAttempt(workflowId);
	assert.equal(apiBegin.taskKey, "api");
	assert.equal(apiBegin.taskRole, "api-architect");
	const apiResult: RoleResult = {
		schemaVersion: "role-result/v1",
		workflowId,
		attemptId: apiBegin.attemptId,
		effects: [{ effectType: "artifact_revision", artifactKind: "api", logicalKey: "api", content: apiContent(), baseRevisionId: null, traceLinks: links }],
	};
	assert.equal(runtime.completeAttempt(workflowId, apiBegin.attemptId, apiResult).outcome, "published");
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

function executeCriticTask(runtime: HeadlessWorkflowRuntime, databasePath: string, workflowId: number, coverKinds: readonly string[]): void {
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
		findings: [],
	};
	const result: RoleResult = { schemaVersion: "role-result/v1", workflowId, attemptId: begin.attemptId, effects: [], criticReport: report };
	assert.equal(runtime.completeAttempt(workflowId, begin.attemptId, result).outcome, "published");
}

let approveCommandSeq = 0;

/** #20 双闸：环节尾 review 完成后，人工 approve 该环节产物 revision，下一环节才可引用。 */
function approveStageArtifact(context: ReadContext, workflowId: number, kind: string): void {
	approveCommandSeq += 1;
	const projection = context.runtime.getWorkflowProjection(workflowId);
	assert.ok(projection);
	const detail = context.runtime.getArtifactRevisionDetail(projection.requirement.id, kind);
	assert.ok(detail, `${kind} revision should exist`);
	const receipt = context.runtime.executeCommand({
		workflowId,
		commandId: `cmd-approve-${kind}-${approveCommandSeq}`,
		expectedWorkflowVersion: projection.workflow.version,
		type: "approve-artifact",
		operator: ADMIN,
		payload: { artifactId: detail.artifactId, revisionId: detail.revisionId },
	});
	assert.equal(receipt.outcome, "accepted");
}

/** #20 双闸全链：5 生产 + 5 复审，每环节 review 后 approve，直至全模板完成。 */
function executeReviewedTemplateChain(context: ReadContext, workflowId: number): void {
	executeAnalystTask(context.runtime, workflowId);
	executeCriticTask(context.runtime, context.databasePath, workflowId, ["requirement", "analysis"]);
	approveStageArtifact(context, workflowId, "analysis");
	executeScenarioTask(context.runtime, workflowId);
	executeCriticTask(context.runtime, context.databasePath, workflowId, ["scenario"]);
	approveStageArtifact(context, workflowId, "scenario");
	executeUsecaseTask(context.runtime, workflowId);
	executeCriticTask(context.runtime, context.databasePath, workflowId, ["usecase"]);
	approveStageArtifact(context, workflowId, "usecase");
	executeFunctionTask(context.runtime, workflowId);
	executeCriticTask(context.runtime, context.databasePath, workflowId, ["function"]);
	approveStageArtifact(context, workflowId, "function");
	executeArchitectTask(context.runtime, workflowId);
	executeCriticTask(context.runtime, context.databasePath, workflowId, ["design", "architecture", "data", "api"]);
	for (const kind of ["design", "architecture", "data", "api"]) {
		approveStageArtifact(context, workflowId, kind);
	}
}

test("session read returns the server-registered operator identity", async () => {
	await withReadServer(async (context) => {
		const response = await get(context, "/api/session");
		assert.equal(response.status, 200);
		const body = (await response.json()) as { actorRef: string; capabilities: readonly string[] };
		assert.equal(body.actorRef, ADMIN.actorRef);
		assert.deepEqual(body.capabilities, ADMIN.capabilities);
	});
});

test("reads reject unauthenticated requests", async () => {
	await withReadServer(async (context) => {
		for (const path of ["/api/session", "/api/requirements?workspaceId=1", "/api/workflows/1", "/api/assets?workspaceId=1"]) {
			const response = await fetch(`${context.server.url}${path}`);
			assert.equal(response.status, 401, path);
		}
	});
});

test("requirement list returns workflow summaries in stable order", async () => {
	await withReadServer(async (context) => {
		const first = await createStartedWorkflow(context, "First");
		const second = await createStartedWorkflow(context, "Second");
		const response = await get(context, `/api/requirements?workspaceId=${context.workspaceId}`);
		assert.equal(response.status, 200);
		const body = (await response.json()) as { requirements: Array<{ requirementId: number; title: string; workflow: { id: number; state: string; version: number; lastEventSeq: number } }> };
		assert.deepEqual(body.requirements.map((entry) => entry.requirementId), [first.requirementId, second.requirementId]);
		assert.equal(body.requirements[0].workflow.id, first.workflowId);
		assert.equal(body.requirements[0].workflow.state, "running");
		const firstProjection = context.runtime.getWorkflowProjection(first.workflowId);
		assert.equal(body.requirements[0].workflow.version, firstProjection?.workflow.version);
		const missing = await get(context, "/api/requirements?workspaceId=9999");
		assert.equal(missing.status, 404);
	});
});

test("requirement detail returns the current baseline and workflow link", async () => {
	await withReadServer(async (context) => {
		const { requirementId, workflowId } = await createStartedWorkflow(context);
		const response = await get(context, `/api/requirements/${requirementId}`);
		assert.equal(response.status, 200);
		const body = (await response.json()) as { id: number; workflowId: number; currentRevision: { revisionNo: number; content: { title: string } } };
		assert.equal(body.id, requirementId);
		assert.equal(body.workflowId, workflowId);
		assert.equal(body.currentRevision.revisionNo, 1);
		assert.equal(body.currentRevision.content.title, "Read model requirement");
		const missing = await get(context, "/api/requirements/9999");
		assert.equal(missing.status, 404);
	});
});

test("bounded projection embeds current state without events or snapshot content", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		await adoptPlan(context.runtime, workflowId);
		executeAnalystTask(context.runtime, workflowId);
		const response = await get(context, `/api/workflows/${workflowId}`);
		assert.equal(response.status, 200);
		const body = (await response.json()) as Record<string, any>;
		assert.equal(body.workflow.id, workflowId);
		assert.equal(body.workflow.state, "running");
		assert.equal(typeof body.workflow.version, "number");
		assert.equal(typeof body.workflow.lastEventSeq, "number");
		assert.deepEqual(Object.keys(body.workflow.policyBundle).sort(), ["digest", "documentId"]);
		assert.equal("events" in body, false, "bounded projection must not embed the event stream");
		assert.equal(body.currentPlan.revisionNo, 1);
		assert.deepEqual(body.tasks.map((task: { key: string }) => task.key), ["analyze", "review-analysis", "scenario", "review-scenario", "usecase", "review-usecase", "function", "review-function", "design", "architecture", "data", "api", "review-design"]);
		assert.equal(body.tasks[0].status, "completed");
		assert.equal(body.tasks[0].latestAttempt.status, "succeeded");
		assert.equal(body.tasks[1].latestAttempt, null);
		assert.equal(body.activeClaim, null);
		assert.equal(body.activeRun, null);
		assert.deepEqual(body.openGates, []);
		assert.equal(body.currentPacket, null);
		assert.equal(body.currentIncident, null);
		assert.ok(Array.isArray(body.readiness.checks), "readiness checks are embedded");
		assert.equal("content" in body.requirement.currentRevision, false, "bounded projection carries digests, not content");
		const missing = await get(context, "/api/workflows/9999");
		assert.equal(missing.status, 404);
	});
});

test("projection stays bounded to the current plan after replanning", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		await adoptPlan(context.runtime, workflowId);
		executeAnalystTask(context.runtime, workflowId);
		const projection = context.runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		const replacement: PlanProposal = {
			schemaVersion: "plan-proposal/v1",
			base: { workflowId, workflowVersion: projection.workflow.version, basePlanRevisionId: projection.workflow.currentPlanRevisionId, planningContextDigest: context.runtime.getPlanningContextDigest(workflowId) },
			objective: "Replacement",
			tasks: [
				{ key: "analyze-2", kind: "analyze", role: "analysis-analyst", objective: "Re-analyze", dependsOn: [], inputs: [], expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }], completionPolicyRef: "analysis/v1", maxAttempts: 3 },
			],
			rationale: "replan",
		};
		const replaced = await putCommand(context, workflowId, "replace-1", {
			type: "replace-plan",
			expectedWorkflowVersion: projection.workflow.version,
			payload: { proposal: replacement, reason: "narrow scope" },
		});
		assert.equal(replaced.status, 201);
		const response = await get(context, `/api/workflows/${workflowId}`);
		const body = (await response.json()) as Record<string, any>;
		assert.equal(body.currentPlan.revisionNo, 2);
		assert.deepEqual(body.tasks.map((task: { key: string }) => task.key), ["analyze-2"], "superseded plan tasks are not embedded");
		const oldPlan = await get(context, `/api/plan-revisions/${projection.workflow.currentPlanRevisionId}`);
		assert.equal(oldPlan.status, 200, "older plan revisions remain readable through the detail endpoint");
		const oldPlanBody = (await oldPlan.json()) as { revisionNo: number; status: string };
		assert.equal(oldPlanBody.revisionNo, 1);
		assert.equal(oldPlanBody.status, "superseded");
	});
});

test("plan revision detail preserves the immutable proposal and provenance", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		await adoptPlan(context.runtime, workflowId);
		const projection = context.runtime.getWorkflowProjection(workflowId);
		const planRevisionId = projection?.workflow.currentPlanRevisionId as number;
		const response = await get(context, `/api/plan-revisions/${planRevisionId}`);
		assert.equal(response.status, 200);
		const body = (await response.json()) as Record<string, any>;
		assert.equal(body.id, planRevisionId);
		assert.equal(body.revisionNo, 1);
		assert.equal(body.status, "active");
		assert.equal(typeof body.proposalDocumentId, "number");
		assert.equal(typeof body.proposalDigest, "string");
		assert.equal(typeof body.planningAttemptId, "number");
		assert.deepEqual(body.proposal.tasks.map((task: { key: string }) => task.key), ["analyze", "review-analysis", "scenario", "review-scenario", "usecase", "review-usecase", "function", "review-function", "design", "architecture", "data", "api", "review-design"]);
		const missing = await get(context, "/api/plan-revisions/9999");
		assert.equal(missing.status, 404);
	});
});

test("task, attempts, attempt and run details link the execution chain", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		await adoptPlan(context.runtime, workflowId);
		executeAnalystTask(context.runtime, workflowId);
		const projection = (await (await get(context, `/api/workflows/${workflowId}`)).json()) as Record<string, any>;
		const taskId = projection.tasks[0].id as number;
		const task = (await (await get(context, `/api/tasks/${taskId}`)).json()) as Record<string, any>;
		assert.equal(task.key, "analyze");
		assert.equal(task.kind, "analyze");
		assert.equal(task.role, "analysis-analyst");
		assert.equal(task.status, "completed");
		assert.deepEqual(task.expectedArtifactEffects, [{ kind: "analysis", operation: "create_or_revise" }]);
		const attempts = (await (await get(context, `/api/tasks/${taskId}/attempts`)).json()) as { attempts: Array<{ id: number; attemptNo: number; status: string }> };
		assert.equal(attempts.attempts.length, 1);
		assert.equal(attempts.attempts[0].attemptNo, 1);
		assert.equal(attempts.attempts[0].status, "succeeded");
		const attempt = (await (await get(context, `/api/attempts/${attempts.attempts[0].id}`)).json()) as Record<string, any>;
		assert.equal(attempt.status, "succeeded");
		assert.equal(typeof attempt.contextManifest.documentId, "number");
		assert.equal(typeof attempt.contextManifest.digest, "string");
		assert.equal(typeof attempt.roleContract.documentId, "number");
		assert.equal(attempt.effects.length, 1);
		assert.equal(attempt.effects[0].state, "published");
		assert.equal(typeof attempt.effects[0].publishedArtifactRevisionId, "number");
		const run = (await (await get(context, `/api/runs/${attempt.run.id}`)).json()) as Record<string, any>;
		assert.equal(run.status, "completed");
		assert.equal(run.attemptId, attempt.id);
		assert.equal(run.workflowId, workflowId);
		assert.equal(typeof run.sessionId, "string");
		const missing = await get(context, "/api/attempts/9999");
		assert.equal(missing.status, 404);
	});
});

test("command receipt read returns the persisted receipt with the server-registered actor", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		const response = await get(context, `/api/workflows/${workflowId}/commands/start-${workflowId}`);
		assert.equal(response.status, 200);
		const body = (await response.json()) as Record<string, any>;
		assert.equal(body.commandId, `start-${workflowId}`);
		assert.equal(body.commandType, "start");
		assert.equal(body.outcome, "accepted");
		assert.equal(body.httpStatus, 201);
		assert.equal(body.actorRef, ADMIN.actorRef, "actor comes from the trusted session registry");
		assert.deepEqual(body.capabilities, ADMIN.capabilities);
		const missing = await get(context, `/api/workflows/${workflowId}/commands/nope`);
		assert.equal(missing.status, 404);
	});
});

test("projection versions feed directly into command expected versions", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		const projection = (await (await get(context, `/api/workflows/${workflowId}`)).json()) as Record<string, any>;
		const paused = await putCommand(context, workflowId, "pause-1", { type: "pause", expectedWorkflowVersion: projection.workflow.version });
		assert.equal(paused.status, 201);
	});
});

test("approval packet detail exposes content and current validity", async () => {
	await withReadServer(async (context) => {
		const { workflowId } = await createStartedWorkflow(context);
		await adoptPlan(context.runtime, workflowId);
		executeReviewedTemplateChain(context, workflowId);
		const built = context.runtime.buildApprovalPacket(workflowId);
		assert.equal(built.ready, true);
		const packetId = built.packetId as number;
		const detail = (await (await get(context, `/api/approval-packets/${packetId}`)).json()) as Record<string, any>;
		assert.equal(detail.id, packetId);
		assert.equal(detail.digest, built.digest);
		assert.equal(detail.status, "current");
		assert.equal(detail.valid, true);
		assert.ok(Array.isArray(detail.content.artifacts), "full packet content is embedded in the detail read");
		const projection = context.runtime.getWorkflowProjection(workflowId);
		const rejected = await putCommand(context, workflowId, "reject-packet-1", {
			type: "reject-packet",
			expectedWorkflowVersion: projection?.workflow.version,
			payload: { packetId, packetDigest: built.digest, reason: "needs rework", targets: [{ type: "artifact", id: 1 }] },
		});
		assert.equal(rejected.status, 201);
		const afterReject = (await (await get(context, `/api/approval-packets/${packetId}`)).json()) as Record<string, any>;
		assert.equal(afterReject.status, "rejected");
		assert.equal(afterReject.valid, false, "rejected packet is no longer a valid approval subject");
	});
});

test("governed design package is created at packet approval and stays read-only", async () => {
	await withReadServer(async (context) => {
		const { workflowId, requirementId } = await createStartedWorkflow(context);
		await adoptPlan(context.runtime, workflowId);
		executeReviewedTemplateChain(context, workflowId);
		const built = context.runtime.buildApprovalPacket(workflowId);
		assert.equal(built.ready, true);
		const projection = context.runtime.getWorkflowProjection(workflowId);
		const approved = await putCommand(context, workflowId, "approve-packet-1", {
			type: "approve-packet",
			expectedWorkflowVersion: projection?.workflow.version,
			payload: { packetId: built.packetId, packetDigest: built.digest },
		});
		assert.equal(approved.status, 201);
		const db = new Database(context.databasePath, { readonly: true });
		let packageId: number;
		try {
			const row = db.prepare("select id from design_packages where requirement_id = ?").get(requirementId) as { id: number } | undefined;
			assert.ok(row, "approving the packet must create the governed DesignPackage");
			packageId = row.id;
		} finally {
			db.close();
		}
		const detail = (await (await get(context, `/api/design-packages/${packageId}`)).json()) as Record<string, any>;
		assert.equal(detail.archiveClass, "governed");
		assert.equal(detail.approvalPacketId, built.packetId);
		assert.equal(typeof detail.approvalId, "number");
		assert.equal(detail.migrationAttestationDocumentId, null);
		assert.equal(detail.digest, built.digest);
		const patched = await fetch(`${context.server.url}/api/design-packages/${packageId}`, {
			method: "PATCH",
			headers: { "content-type": "application/json", cookie: context.cookie },
			body: JSON.stringify({ archiveClass: "legacy_pre_policy" }),
		});
		assert.equal(patched.status, 404, "design packages have no mutation route");
	});
});

test("legacy_pre_policy design package reads do not masquerade as governed approvals", async () => {
	await withReadServer(async (context) => {
		const { requirementId } = await createStartedWorkflow(context);
		const db = new Database(context.databasePath);
		try {
			db.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('migration_attestation', 'migration-attestation/v1', 'application/json', '{}', 'sha256:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1', ?)").run(TIMESTAMP);
			const attestationId = Number((db.prepare("select id from snapshot_documents where digest = 'sha256:a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1'").get() as { id: number }).id);
			db.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('approval_packet', 'legacy-package/v1', 'application/json', '{}', 'sha256:b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', ?)").run(TIMESTAMP);
			const documentId = Number((db.prepare("select id from snapshot_documents where digest = 'sha256:b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2'").get() as { id: number }).id);
			assert.throws(
				() => db.prepare("insert into design_packages(requirement_id, workspace_id, document_id, digest, approval_packet_id, approval_id, migration_attestation_document_id, archive_class, archived_at) values (?, ?, ?, 'sha256:b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', 1, null, ?, 'legacy_pre_policy', ?)").run(requirementId, context.workspaceId, documentId, attestationId, TIMESTAMP),
				/archive class shape is invalid/,
				"legacy packages cannot reference governed approvals",
			);
			db.prepare("insert into design_packages(requirement_id, workspace_id, document_id, digest, approval_packet_id, approval_id, migration_attestation_document_id, archive_class, archived_at) values (?, ?, ?, 'sha256:b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2', null, null, ?, 'legacy_pre_policy', ?)").run(requirementId, context.workspaceId, documentId, attestationId, TIMESTAMP);
		} finally {
			db.close();
		}
		const dbRead = new Database(context.databasePath, { readonly: true });
		let packageId: number;
		try {
			packageId = (dbRead.prepare("select id from design_packages where requirement_id = ?").get(requirementId) as { id: number }).id;
		} finally {
			dbRead.close();
		}
		const detail = (await (await get(context, `/api/design-packages/${packageId}`)).json()) as Record<string, any>;
		assert.equal(detail.archiveClass, "legacy_pre_policy");
		assert.equal(detail.approvalPacketId, null);
		assert.equal(detail.approvalId, null);
		assert.equal(typeof detail.migrationAttestationDocumentId, "number");
	});
});

test("legacy import detail exposes classification and anomaly summary", async () => {
	await withReadServer(async (context) => {
		const { requirementId, workflowId } = await createStartedWorkflow(context);
		const missing = await get(context, `/api/legacy-imports/${requirementId}`);
		assert.equal(missing.status, 404);
		const db = new Database(context.databasePath);
		try {
			db.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('legacy_requirement_bundle', 'legacy-bundle/v1', 'application/json', '{}', 'sha256:c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3', ?)").run(TIMESTAMP);
			db.prepare("insert into snapshot_documents(kind, schema_ref, media_type, content, digest, created_at) values ('migration_attestation', 'migration-attestation/v1', 'application/json', '{}', 'sha256:d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4', ?)").run(TIMESTAMP);
			const bundleId = (db.prepare("select id from snapshot_documents where digest = 'sha256:c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3'").get() as { id: number }).id;
			const attestationId = (db.prepare("select id from snapshot_documents where digest = 'sha256:d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4'").get() as { id: number }).id;
			db.prepare("insert into legacy_imports(requirement_id, workflow_id, import_class, bundle_document_id, attestation_document_id, anomaly_count, created_at) values (?, ?, 'pending_reentry', ?, ?, 2, ?)").run(requirementId, workflowId, bundleId, attestationId, TIMESTAMP);
			assert.throws(
				() => db.prepare("update legacy_imports set anomaly_count = 0 where requirement_id = ?").run(requirementId),
				/LegacyImport is immutable/,
			);
		} finally {
			db.close();
		}
		const detail = (await (await get(context, `/api/legacy-imports/${requirementId}`)).json()) as Record<string, any>;
		assert.equal(detail.requirementId, requirementId);
		assert.equal(detail.importClass, "pending_reentry");
		assert.equal(typeof detail.bundleDocumentId, "number");
		assert.equal(typeof detail.attestationDocumentId, "number");
		assert.equal(detail.anomalySummary.count, 2);
	});
});

test("reusable assets support list, create, detail, delete, export and import without governance side effects", async () => {
	await withReadServer(async (context) => {
		const requirementsBefore = context.runtime.listRequirements(context.workspaceId).length;
		const created = await fetch(`${context.server.url}/api/assets`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: context.cookie },
			body: JSON.stringify({ workspaceId: context.workspaceId, kind: "scenario", title: "Expiry scenario", content: { schemaVersion: "artifact/scenario/v1", artifactKind: "scenario", summary: "Expiry scenario", sourceRefs: [], domains: [{ nodeId: "d-expiry", title: "Expiry domain", scenarios: [{ nodeId: "s-expiry", title: "Expiry", variants: [{ nodeId: "v-expiry", title: "Expiry variant", actors: ["Customer"], preconditions: [], trigger: "Date reached", mainFlow: ["Expire"], alternateFlows: [], expectedOutcome: "Expired" }] }] }] } }),
		});
		assert.equal(created.status, 201);
		const { assetId } = (await created.json()) as { assetId: number; revisionId: number };
		assert.equal(context.runtime.listRequirements(context.workspaceId).length, requirementsBefore, "assets never create Requirements or Workflows");
		const list = (await (await get(context, `/api/assets?workspaceId=${context.workspaceId}`)).json()) as { assets: Array<{ id: number; kind: string; title: string; currentRevision: { revisionNo: number; digest: string } }> };
		assert.equal(list.assets.length, 1);
		assert.equal(list.assets[0].kind, "scenario");
		assert.equal(list.assets[0].currentRevision.revisionNo, 1);
		const detail = (await (await get(context, `/api/assets/${assetId}`)).json()) as Record<string, any>;
		assert.equal(detail.title, "Expiry scenario");
		assert.equal(detail.revisions.length, 1);
		assert.equal(detail.revisions[0].source, "manual");
		assert.deepEqual(detail.revisions[0].content, { schemaVersion: "artifact/scenario/v1", artifactKind: "scenario", summary: "Expiry scenario", sourceRefs: [], domains: [{ nodeId: "d-expiry", title: "Expiry domain", scenarios: [{ nodeId: "s-expiry", title: "Expiry", variants: [{ nodeId: "v-expiry", title: "Expiry variant", actors: ["Customer"], preconditions: [], trigger: "Date reached", mainFlow: ["Expire"], alternateFlows: [], expectedOutcome: "Expired" }] }] }] });
		const exported = (await (await get(context, `/api/assets/export?workspaceId=${context.workspaceId}`)).json()) as { assets: Array<{ title: string }> };
		assert.equal(exported.assets.length, 1);
		const imported = await fetch(`${context.server.url}/api/assets/import`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: context.cookie },
			body: JSON.stringify({ workspaceId: context.workspaceId, assets: [{ kind: "usecase", title: "Imported use case", content: { schemaVersion: "artifact/usecase/v1", artifactKind: "usecase", summary: "Imported use case", sourceRefs: [], useCases: [{ id: "imported", actor: "Customer", goal: "Use imported case", preconditions: [], mainFlow: ["Complete"], alternativeFlows: [], postconditions: ["Done"] }] } }] }),
		});
		assert.equal(imported.status, 201);
		const { assetIds } = (await imported.json()) as { assetIds: number[] };
		const importedDetail = (await (await get(context, `/api/assets/${assetIds[0]}`)).json()) as Record<string, any>;
		assert.equal(importedDetail.revisions[0].source, "import");
		assert.equal(context.runtime.listRequirements(context.workspaceId).length, requirementsBefore);
		const deleted = await fetch(`${context.server.url}/api/assets/${assetId}`, { method: "DELETE", headers: { cookie: context.cookie } });
		assert.equal(deleted.status, 200);
		const afterDelete = await get(context, `/api/assets/${assetId}`);
		assert.equal(afterDelete.status, 404);
		const badKind = await fetch(`${context.server.url}/api/assets`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: context.cookie },
			body: JSON.stringify({ workspaceId: context.workspaceId, kind: "analysis", title: "wrong", content: {} }),
		});
		assert.equal(badKind.status, 400, "asset kinds are restricted to the reusable asset kinds");
	});
});

test("asset list route returns a paginated kind-filtered envelope", async () => {
	await withReadServer(async (context) => {
		context.runtime.createReusableAsset({ workspaceId: context.workspaceId, kind: "scenario", title: "Flow A", content: { nodeId: "s1", title: "Flow A" } });
		context.runtime.createReusableAsset({ workspaceId: context.workspaceId, kind: "scenario", title: "Flow B", content: { nodeId: "s2", title: "Flow B" } });
		context.runtime.createReusableAsset({ workspaceId: context.workspaceId, kind: "usecase", title: "Flow use case", content: { flow: ["c"] } });

		const response = await get(context, `/api/assets?workspaceId=${context.workspaceId}&page=2&pageSize=1&kind=scenario&q=FLOW`);
		assert.equal(response.status, 200);
		const body = (await response.json()) as {
			assets: Array<{ title: string; kind: string; resolvedGraph?: unknown }>;
			total: number;
			page: number;
			pageSize: number;
			kindCounts: Record<string, number>;
		};
		assert.equal(body.total, 2);
		assert.equal(body.page, 2);
		assert.equal(body.pageSize, 1);
		assert.deepEqual(body.assets.map((asset) => asset.title), ["Flow A"]);
		assert.equal(body.assets[0]?.kind, "scenario");
		assert.equal("resolvedGraph" in (body.assets[0] ?? {}), false);
		assert.deepEqual(body.kindCounts, {
			"scenario-domain": 0,
			scenario: 2,
			"scenario-variant": 0,
			"function-domain": 0,
			"function-item": 0,
			"function-point": 0,
			usecase: 1,
			design: 0,
			architecture: 0,
			data: 0,
			api: 0,
			stakeholder: 0,
		});
	});
});


// #22 review（P3/P4）：promote 路由边界 —— unknown kinds → 400、unknown requirement → 404、
// requirementId 路径正确解析（无需走 approve 链即可验证路由前置校验）。
test("promote route rejects unknown kinds and unknown requirement at HTTP boundary", async () => {
	await withReadServer(async ({ runtime, server, cookie, workspaceId }) => {
		const created = runtime.createRequirement({ workspaceId, baseline: baseline("Promote boundary") });
		// unknown kind → 400 unknown_asset_kind
		const badKind = await fetch(`${server.url}/api/requirements/${created.requirementId}/promote`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ kinds: ["scneario"] }),
		});
		assert.equal(badKind.status, 400);
		const badKindBody = (await badKind.json()) as { error: string };
		assert.equal(badKindBody.error, "unknown_asset_kind");
		// unknown requirement → 404
		const badReq = await fetch(`${server.url}/api/requirements/999999/promote`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ kinds: ["scenario"] }),
		});
		assert.equal(badReq.status, 404);
		// 缺 kinds → 400 malformed
		const missing = await fetch(`${server.url}/api/requirements/${created.requirementId}/promote`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({}),
		});
		assert.equal(missing.status, 400);
	});
});


// #23 FTS5 检索 HTTP 边界：GET /api/search 200 命中 + unknown workspace 404。
test("search route returns hits for workspace query and 404 for unknown workspace", async () => {
	await withReadServer(async ({ runtime, server, cookie, workspaceId }) => {
		runtime.createReusableAsset({ workspaceId, kind: "scenario", title: "支付网关回调签名", content: { nodeId: "s1", title: "支付网关回调签名" } });
		const ok = await fetch(`${server.url}/api/search?workspaceId=${workspaceId}&q=${encodeURIComponent("回调签名")}`, { headers: { cookie } });
		assert.equal(ok.status, 200);
		const body = (await ok.json()) as { query: string; hits: Array<{ corpus: string; title: string }> };
		assert.equal(body.query, "回调签名");
		assert.ok(body.hits.length >= 1, "search returns asset hit");
		assert.equal(body.hits[0]!.corpus, "reusable_asset");
		const missing = await fetch(`${server.url}/api/search?workspaceId=999999&q=回调`, { headers: { cookie } });
		assert.equal(missing.status, 404);
	});
});
