import assert from "node:assert/strict";
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
} from "./testing/deterministic-fixtures.ts";
import {
	openHeadlessWorkflowRuntime,
	type HeadlessWorkflowRuntime,
} from "./workflow/headless-runtime.ts";
import { startOperatorServer, type OperatorServer } from "./workflow/operator-server.ts";
import { ScriptedModelDriver } from "./testing/scripted-model-driver.ts";
import type { PlanProposal, TaskProposal } from "./workflow/plan-types.ts";
import type { RequirementBaseline } from "./workflow/requirement.ts";

const ADMIN = createFixtureOperator("admin");
const TIMESTAMP = "2026-08-12T10:00:00.000Z";

const BASELINE: RequirementBaseline = {
	schemaVersion: "artifact/requirement/v1",
	artifactKind: "requirement",
	summary: "Workspace delete fixture",
	sourceRefs: [],
	title: "Workspace delete fixture",
	description: "Populated for workspace delete HTTP tests.",
};

interface RegistryContext {
	server: OperatorServer;
	runtime: HeadlessWorkflowRuntime;
	cookie: string;
}

async function withRegistryServer(run: (context: RegistryContext) => Promise<void>): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), "operator-workspaces-"));
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
		await run({ server, runtime, cookie });
	} finally {
		await server.close();
		runtime.close();
		rmSync(directory, { recursive: true, force: true });
	}
}

function get(context: RegistryContext, path: string): Promise<Response> {
	return fetch(`${context.server.url}${path}`, { headers: { cookie: context.cookie } });
}

function postJson(context: RegistryContext, path: string, body: unknown): Promise<Response> {
	return fetch(`${context.server.url}${path}`, {
		method: "POST",
		headers: { cookie: context.cookie, "content-type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

test("GET /api/workspaces requires an authenticated session", async () => {
	await withRegistryServer(async (context) => {
		const anonymous = await fetch(`${context.server.url}/api/workspaces`);
		assert.equal(anonymous.status, 401);
		const forged = await fetch(`${context.server.url}/api/workspaces`, {
			headers: { cookie: "baize_operator=forged-session-id" },
		});
		assert.equal(forged.status, 401);
	});
});

test("POST /api/workspaces requires an authenticated session", async () => {
	await withRegistryServer(async (context) => {
		const anonymous = await fetch(`${context.server.url}/api/workspaces`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ name: "North", repoPath: "/north" }),
		});
		assert.equal(anonymous.status, 401);
		const forged = await fetch(`${context.server.url}/api/workspaces`, {
			method: "POST",
			headers: { cookie: "baize_operator=forged-session-id", "content-type": "application/json" },
			body: JSON.stringify({ name: "North", repoPath: "/north" }),
		});
		assert.equal(forged.status, 401);
	});
});

test("GET /api/workspaces lists created workspaces in id order", async () => {
	await withRegistryServer(async (context) => {
		const initial = await get(context, "/api/workspaces");
		assert.equal(initial.status, 200);
		assert.deepEqual(await initial.json(), { workspaces: [] });

		const created = await postJson(context, "/api/workspaces", { name: "North", repoPath: "/north" });
		assert.equal(created.status, 201);
		assert.deepEqual(await created.json(), { workspaceId: 1 });

		await postJson(context, "/api/workspaces", { name: "South", repoPath: "/south" });
		await postJson(context, "/api/workspaces", { name: "East", repoPath: "/east" });

		const listed = await get(context, "/api/workspaces");
		assert.equal(listed.status, 200);
		assert.deepEqual(await listed.json(), {
			workspaces: [
				{ id: 1, name: "North", repoPath: "/north", createdAt: TIMESTAMP },
				{ id: 2, name: "South", repoPath: "/south", createdAt: TIMESTAMP },
				{ id: 3, name: "East", repoPath: "/east", createdAt: TIMESTAMP },
			],
		});
	});
});

test("POST /api/workspaces trims name and repoPath before storage", async () => {
	await withRegistryServer(async (context) => {
		const created = await postJson(context, "/api/workspaces", {
			name: "  North  ",
			repoPath: "  /north  ",
		});
		assert.equal(created.status, 201);
		const listed = await get(context, "/api/workspaces");
		const { workspaces } = (await listed.json()) as { workspaces: { name: string; repoPath: string }[] };
		assert.equal(workspaces.length, 1);
		assert.equal(workspaces[0].name, "North");
		assert.equal(workspaces[0].repoPath, "/north");
	});
});

test("POST /api/workspaces rejects duplicate repo_path with 409", async () => {
	await withRegistryServer(async (context) => {
		const first = await postJson(context, "/api/workspaces", { name: "North", repoPath: "/north" });
		assert.equal(first.status, 201);
		const duplicate = await postJson(context, "/api/workspaces", { name: "North again", repoPath: "/north" });
		assert.equal(duplicate.status, 409);
		assert.deepEqual(await duplicate.json(), { error: "duplicate_repo_path" });
	});
});

test("POST /api/workspaces allows duplicate names across distinct repo paths", async () => {
	await withRegistryServer(async (context) => {
		const first = await postJson(context, "/api/workspaces", { name: "Shared", repoPath: "/a" });
		const second = await postJson(context, "/api/workspaces", { name: "Shared", repoPath: "/b" });
		assert.equal(first.status, 201);
		assert.equal(second.status, 201);
		const listed = await get(context, "/api/workspaces");
		const { workspaces } = (await listed.json()) as { workspaces: unknown[] };
		assert.equal(workspaces.length, 2);
	});
});

test("POST /api/workspaces rejects malformed and blank bodies with 400", async () => {
	await withRegistryServer(async (context) => {
		const cases: { label: string; body: unknown }[] = [
			{ label: "invalid json", body: "{not json" },
			{ label: "array body", body: [] },
			{ label: "missing name", body: { repoPath: "/north" } },
			{ label: "missing repoPath", body: { name: "North" } },
			{ label: "blank name", body: { name: "   ", repoPath: "/north" } },
			{ label: "blank repoPath", body: { name: "North", repoPath: "" } },
			{ label: "non-string name", body: { name: 42, repoPath: "/north" } },
			{ label: "non-string repoPath", body: { name: "North", repoPath: ["/north"] } },
		];
		for (const { label, body } of cases) {
			const response = await postJson(context, "/api/workspaces", body);
			assert.equal(response.status, 400, `expected 400 for ${label} (got ${response.status})`);
			assert.deepEqual(await response.json(), { error: "malformed_workspace" }, `for ${label}`);
		}
	});
});

function deleteWorkspace(context: RegistryContext, id: number): Promise<Response> {
	return fetch(`${context.server.url}/api/workspaces/${id}`, { method: "DELETE", headers: { cookie: context.cookie } });
}

test("DELETE /api/workspaces/:id returns 404 for unknown and non-integer ids", async () => {
	await withRegistryServer(async (context) => {
		const unknown = await deleteWorkspace(context, 999);
		assert.equal(unknown.status, 404);
		assert.deepEqual(await unknown.json(), { error: "unknown_workspace" });
		const nonInteger = await fetch(`${context.server.url}/api/workspaces/abc`, { method: "DELETE", headers: { cookie: context.cookie } });
		assert.equal(nonInteger.status, 404);
		assert.deepEqual(await nonInteger.json(), { error: "unknown_workspace" });
	});
});

test("DELETE /api/workspaces/:id requires an authenticated session", async () => {
	await withRegistryServer(async (context) => {
		const workspaceId = (await (await postJson(context, "/api/workspaces", { name: "North", repoPath: "/north" })).json() as { workspaceId: number }).workspaceId;
		const anonymous = await fetch(`${context.server.url}/api/workspaces/${workspaceId}`, { method: "DELETE" });
		assert.equal(anonymous.status, 401);
		const forged = await fetch(`${context.server.url}/api/workspaces/${workspaceId}`, { method: "DELETE", headers: { cookie: "baize_operator=forged-session-id" } });
		assert.equal(forged.status, 401);
	});
});

test("DELETE /api/workspaces/:id removes the workspace and all workspace-gated reads 404", async () => {
	await withRegistryServer(async (context) => {
		const created = await postJson(context, "/api/workspaces", { name: "North", repoPath: "/north" });
		assert.equal(created.status, 201);
		const { workspaceId } = (await created.json()) as { workspaceId: number };
		const requirement = await postJson(context, `/api/workspaces/${workspaceId}/requirements`, {
			schemaVersion: "artifact/requirement/v1",
			artifactKind: "requirement",
			summary: "Req",
			sourceRefs: [],
			title: "Req",
			description: "Req",
		});
		assert.equal(requirement.status, 201);

		const deleted = await deleteWorkspace(context, workspaceId);
		assert.equal(deleted.status, 200);
		assert.deepEqual(await deleted.json(), { deleted: true });

		const listed = await get(context, "/api/workspaces");
		assert.deepEqual(await listed.json(), { workspaces: [] });
		const requirements = await get(context, `/api/requirements?workspaceId=${workspaceId}`);
		assert.equal(requirements.status, 404, "workspace-gated requirement list must 404 after delete");
		assert.deepEqual(await requirements.json(), { error: "unknown_workspace" });
		const again = await deleteWorkspace(context, workspaceId);
		assert.equal(again.status, 404, "second delete must 404 unknown_workspace");
	});
});

test("DELETE /api/workspaces/:id refuses a busy workspace with 409 workspace_busy", async () => {
	await withRegistryServer(async (context) => {
		const workspaceId = context.runtime.createWorkspace({ repoPath: "/busy", name: "Busy" });
		const created = context.runtime.createRequirement({ workspaceId, baseline: BASELINE });
		context.runtime.executeCommand({
			workflowId: created.workflowId,
			commandId: "cmd-start",
			expectedWorkflowVersion: 0,
			type: "start",
			operator: ADMIN,
		});
		const projection = context.runtime.getWorkflowProjection(created.workflowId);
		assert.ok(projection);
		const contextDigest = context.runtime.getPlanningContextDigest(created.workflowId);
		const tasks: TaskProposal[] = [
			{ key: "analyze-req", kind: "analyze", role: "analyst", objective: "Analyze", dependsOn: [], inputs: [], expectedArtifactEffects: [{ kind: "analysis", operation: "create_or_revise" }], completionPolicyRef: "analysis/v1", maxAttempts: 3 },
			{ key: "design-sol", kind: "design", role: "architect", objective: "Design", dependsOn: ["analyze-req"], inputs: [{ type: "task_output", taskKey: "analyze-req", artifactKind: "analysis", purpose: "input" }], expectedArtifactEffects: [{ kind: "design", operation: "create_or_revise" }], completionPolicyRef: "design/v1", maxAttempts: 3 },
		];
		const proposal: PlanProposal = {
			schemaVersion: "plan-proposal/v1",
			base: { workflowId: created.workflowId, workflowVersion: projection.workflow.version, basePlanRevisionId: null, planningContextDigest: contextDigest },
			objective: "Plan",
			tasks,
			rationale: "rationale",
		};
		const driver = new ScriptedModelDriver([
			{ role: "orchestrator", contextDigest, orderedToolCalls: [], structuredResult: proposal, modelUsage: { inputTokens: 0, outputTokens: 0 } },
		]);
		const planned = await context.runtime.planWorkflow(created.workflowId, driver);
		assert.equal(planned.outcome, "adopted");
		context.runtime.beginAttempt(created.workflowId);

		const deleted = await deleteWorkspace(context, workspaceId);
		assert.equal(deleted.status, 409);
		assert.deepEqual(await deleted.json(), { error: "workspace_busy", activeRuns: 1, activeClaims: 1 });
	});
});