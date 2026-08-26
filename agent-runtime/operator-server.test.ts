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
} from "./testing/deterministic-fixtures.js";
import {
	openHeadlessWorkflowRuntime,
	type HeadlessWorkflowRuntime,
} from "./workflow/headless-runtime.js";
import { startOperatorServer, type OperatorServer } from "./workflow/operator-server.js";
import type { RequirementBaseline } from "./workflow/requirement.js";

const ADMIN = createFixtureOperator("admin");
const VIEWER: { actorRef: string; capabilities: readonly string[] } = {
	actorRef: "operator:viewer",
	capabilities: [],
};

function baseline(title = "HTTP requirement"): RequirementBaseline {
	return {
		schemaVersion: "artifact/requirement/v1",
		artifactKind: "requirement",
		summary: title,
		sourceRefs: [],
		title,
		description: "Created through the operator transport.",
	};
}

interface ServerContext {
	server: OperatorServer;
	runtime: HeadlessWorkflowRuntime;
	workspaceId: number;
}

async function withServer(run: (context: ServerContext) => Promise<void>): Promise<void> {
	const directory = mkdtempSync(join(tmpdir(), "operator-server-"));
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath: join(directory, "test.db"),
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(),
		outboxTransport: createOutboxTransport(),
	});
	const server = await startOperatorServer({
		runtime,
		operators: { "token-admin": ADMIN, "token-viewer": VIEWER },
	});
	try {
		await run({
			server,
			runtime,
			workspaceId: runtime.createWorkspace({ repoPath: "/repo", name: "repo" }),
		});
	} finally {
		await server.close();
		runtime.close();
		rmSync(directory, { recursive: true, force: true });
	}
}

async function bootstrap(url: string, token = "token-admin"): Promise<string> {
	const response = await fetch(`${url}/api/session`, {
		method: "POST",
		headers: { authorization: `Bearer ${token}` },
	});
	assert.equal(response.status, 201);
	const setCookie = response.headers.get("set-cookie");
	assert.ok(setCookie, "bootstrap must set a session cookie");
	return setCookie.split(";")[0];
}

function putCommand(
	url: string,
	workflowId: number,
	commandId: string,
	body: unknown,
	cookie: string,
): Promise<Response> {
	return fetch(`${url}/api/workflows/${workflowId}/commands/${commandId}`, {
		method: "PUT",
		headers: { "content-type": "application/json", cookie },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

async function createStartedWorkflow(
	context: ServerContext,
	cookie: string,
): Promise<{ requirementId: number; workflowId: number }> {
	const created = await fetch(`${context.server.url}/api/workspaces/${context.workspaceId}/requirements`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify({ baseline: baseline() }),
	});
	assert.equal(created.status, 201);
	const body = (await created.json()) as { requirementId: number; workflowId: number };
	const started = await putCommand(
		context.server.url,
		body.workflowId,
		`start-${body.workflowId}`,
		{ type: "start", expectedWorkflowVersion: 0 },
		cookie,
	);
	assert.equal(started.status, 201);
	return body;
}

async function createAsset(
	url: string,
	cookie: string,
	body: unknown,
): Promise<Response> {
	return fetch(`${url}/api/assets`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify(body),
	});
}

function scenarioContent(title: string, actor = "Customer"): Record<string, unknown> {
	return {
		schemaVersion: "artifact/scenario/v1",
		artifactKind: "scenario",
		summary: title,
		sourceRefs: [],
		scenarios: [{ id: title.toLowerCase().replace(/\s+/g, "-"), title, actors: [actor], preconditions: [], trigger: "Start", mainFlow: ["Complete"], alternateFlows: [], expectedOutcome: "Done" }],
	};
}

async function updateAsset(
	url: string,
	cookie: string,
	assetId: number,
	body: unknown,
): Promise<Response> {
	return fetch(`${url}/api/assets/${assetId}`, {
		method: "PUT",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify(body),
	});
}

async function importAssets(
	url: string,
	cookie: string,
	body: unknown,
): Promise<Response> {
	return fetch(`${url}/api/assets/import`, {
		method: "POST",
		headers: { "content-type": "application/json", cookie },
		body: JSON.stringify(body),
	});
}

test("stakeholder asset import maps stakeholder validation errors to public responses", async () => {
	await withServer(async ({ server, workspaceId }) => {
		const cookie = await bootstrap(server.url);
		const malformed = await importAssets(server.url, cookie, {
			workspaceId,
			assets: [{ kind: "stakeholder", title: "Ignored", content: { name: "   " } }],
		});
		assert.equal(malformed.status, 400);
		assert.deepEqual(await malformed.json(), { error: "malformed_body" });

		const seeded = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "stakeholder",
			content: { name: "Admin" },
		});
		assert.equal(seeded.status, 201);
		const conflict = await importAssets(server.url, cookie, {
			workspaceId,
			assets: [{ kind: "stakeholder", title: "Ignored", content: { name: " admin " } }],
		});
		assert.equal(conflict.status, 409);
		assert.deepEqual(await conflict.json(), { error: "name_conflict" });
	});
});
test("stakeholder assets create with normalized content, mirrored title, and name uniqueness", async () => {
	await withServer(async ({ server, workspaceId }) => {
		const cookie = await bootstrap(server.url);
		const created = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "stakeholder",
			content: { name: " Admin ", description: "Runs the system" },
		});
		assert.equal(created.status, 201);
		const createdBody = (await created.json()) as { assetId: number; revisionId: number; revisionNo: number };
		assert.ok(createdBody.assetId > 0);
		assert.ok(createdBody.revisionId > 0);
		assert.equal(createdBody.revisionNo, 1);

		const detail = await fetch(`${server.url}/api/assets/${createdBody.assetId}`, { headers: { cookie } });
		assert.equal(detail.status, 200);
		const asset = (await detail.json()) as { title: string; revisions: Array<{ revisionNo: number; content: unknown }> };
		assert.equal(asset.title, "Admin");
		assert.deepEqual(asset.revisions.at(-1)?.content, { name: "Admin", description: "Runs the system" });

		const duplicate = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "stakeholder",
			content: { name: "admin" },
		});
		assert.equal(duplicate.status, 409);
		assert.deepEqual(await duplicate.json(), { error: "name_conflict" });

		for (const body of [
			{ workspaceId, kind: "stakeholder" },
			{ workspaceId, kind: "stakeholder", content: { name: "   " } },
		]) {
			const malformed = await createAsset(server.url, cookie, body);
			assert.equal(malformed.status, 400, JSON.stringify(body));
			assert.deepEqual(await malformed.json(), { error: "malformed_body" });
		}
	});
});

test("PUT appends revisions for all asset kinds and rejects malformed, conflicting, and stale updates", async () => {
	await withServer(async ({ server, workspaceId }) => {
		const cookie = await bootstrap(server.url);
		const actor = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "stakeholder",
			content: { name: "Operator", description: "Old" },
		});
		const actorBody = (await actor.json()) as { assetId: number; revisionId: number };
		const other = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "stakeholder",
			content: { name: "Reviewer" },
		});
		assert.equal(other.status, 201);
		const scenario = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "scenario",
			title: "Scenario",
			content: scenarioContent("Scenario", "Operator"),
		});
		const scenarioBody = (await scenario.json()) as { assetId: number; revisionId: number };

		const patched = await updateAsset(server.url, cookie, actorBody.assetId, {
			expectedRevisionId: actorBody.revisionId,
			title: "Lead Operator",
			content: { name: "Lead Operator", description: "Old" },
			relations: [],
		});
		assert.equal(patched.status, 200);
		const patchedBody = (await patched.json()) as { revisionId: number; revisionNo: number };
		assert.equal(patchedBody.revisionNo, 2);
		assert.ok(patchedBody.revisionId > actorBody.revisionId);
		const detail = await fetch(`${server.url}/api/assets/${actorBody.assetId}`, { headers: { cookie } });
		const asset = (await detail.json()) as { title: string; revisions: Array<{ revisionNo: number; content: unknown }> };
		assert.equal(asset.title, "Lead Operator");
		assert.deepEqual(asset.revisions.map((revision) => revision.revisionNo), [1, 2]);
		assert.deepEqual(asset.revisions.at(-1)?.content, { name: "Lead Operator", description: "Old" });

		const scenarioUpdate = await updateAsset(server.url, cookie, scenarioBody.assetId, {
			expectedRevisionId: scenarioBody.revisionId,
			title: "Updated Scenario",
			content: scenarioContent("Updated Scenario", "Operator"),
			relations: [],
		});
		assert.equal(scenarioUpdate.status, 200);

		const empty = await updateAsset(server.url, cookie, actorBody.assetId, {});
		assert.equal(empty.status, 400);
		assert.deepEqual(await empty.json(), { error: "malformed_body" });
		const conflict = await updateAsset(server.url, cookie, actorBody.assetId, {
			expectedRevisionId: patchedBody.revisionId,
			title: " reviewer ",
			content: { name: " reviewer " },
			relations: [],
		});
		assert.equal(conflict.status, 409);
		assert.deepEqual(await conflict.json(), { error: "name_conflict" });
		const stale = await updateAsset(server.url, cookie, actorBody.assetId, {
			expectedRevisionId: actorBody.revisionId,
			title: "Stale",
			content: { name: "Stale" },
			relations: [],
		});
		assert.equal(stale.status, 409);
		assert.deepEqual(await stale.json(), { error: "version_conflict" });
		const missing = await updateAsset(server.url, cookie, 999999, {
			expectedRevisionId: 1,
			title: "Missing",
			content: {},
			relations: [],
		});
		assert.equal(missing.status, 404);
		assert.deepEqual(await missing.json(), { error: "unknown_asset" });
	});
});
test("bootstrap authenticates with a bearer token and sets a hardened session cookie", async () => {
	await withServer(async ({ server }) => {
		const response = await fetch(`${server.url}/api/session`, {
			method: "POST",
			headers: { authorization: "Bearer token-admin" },
		});
		assert.equal(response.status, 201);
		const body = (await response.json()) as { actorRef: string; capabilities: readonly string[] };
		assert.equal(body.actorRef, ADMIN.actorRef);
		assert.deepEqual(body.capabilities, ADMIN.capabilities);
		const setCookie = response.headers.get("set-cookie") ?? "";
		assert.match(setCookie, /baize_operator=/);
		assert.match(setCookie, /HttpOnly/);
		assert.match(setCookie, /SameSite=Strict/);
		assert.match(setCookie, /Path=\//);
	});
});

test("bootstrap rejects an unknown bearer token without issuing a cookie", async () => {
	await withServer(async ({ server }) => {
		const response = await fetch(`${server.url}/api/session`, {
			method: "POST",
			headers: { authorization: "Bearer wrong-token" },
		});
		assert.equal(response.status, 401);
		assert.equal(response.headers.get("set-cookie"), null);
	});
});

test("protected routes reject missing or forged session cookies", async () => {
	await withServer(async ({ server, workspaceId }) => {
		const anonymous = await fetch(`${server.url}/api/workspaces/${workspaceId}/requirements`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ baseline: baseline() }),
		});
		assert.equal(anonymous.status, 401);
		const forged = await fetch(`${server.url}/api/workspaces/${workspaceId}/requirements`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie: "baize_operator=forged" },
			body: JSON.stringify({ baseline: baseline() }),
		});
		assert.equal(forged.status, 401);
	});
});

test("requirement creation over HTTP atomically returns the pending workflow identity", async () => {
	await withServer(async ({ server, runtime, workspaceId }) => {
		const cookie = await bootstrap(server.url);
		const response = await fetch(`${server.url}/api/workspaces/${workspaceId}/requirements`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ baseline: baseline() }),
		});
		assert.equal(response.status, 201);
		const body = (await response.json()) as {
			requirementId: number;
			workflowId: number;
			workflowState: string;
			workflowVersion: number;
			lastEventSeq: number;
		};
		assert.ok(body.requirementId > 0);
		assert.ok(body.workflowId > 0);
		assert.equal(body.workflowState, "pending");
		assert.equal(body.workflowVersion, 0);
		assert.equal(body.lastEventSeq, 1);
		const projection = runtime.getWorkflowProjection(body.workflowId);
		assert.equal(projection?.workflow.state, "pending");
		assert.equal(projection?.requirement.id, body.requirementId);
	});
});

test("requirement creation rejects unknown workspace, invalid baseline, and actor fields", async () => {
	await withServer(async ({ server, workspaceId }) => {
		const cookie = await bootstrap(server.url);
		const unknownWorkspace = await fetch(`${server.url}/api/workspaces/999999/requirements`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ baseline: baseline() }),
		});
		assert.equal(unknownWorkspace.status, 404);
		const invalidBaseline = await fetch(`${server.url}/api/workspaces/${workspaceId}/requirements`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ baseline: { title: "missing schema" } }),
		});
		assert.equal(invalidBaseline.status, 400);
		const withActor = await fetch(`${server.url}/api/workspaces/${workspaceId}/requirements`, {
			method: "POST",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ baseline: baseline(), actor: "operator:forged" }),
		});
		assert.equal(withActor.status, 400);
	});
});

test("commands execute through the unified idempotent resource", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const created = await fetch(
			`${context.server.url}/api/workspaces/${context.workspaceId}/requirements`,
			{
				method: "POST",
				headers: { "content-type": "application/json", cookie },
				body: JSON.stringify({ baseline: baseline() }),
			},
		);
		const { workflowId } = (await created.json()) as { workflowId: number };
		const response = await putCommand(
			context.server.url,
			workflowId,
			"cmd-start",
			{ type: "start", expectedWorkflowVersion: 0 },
			cookie,
		);
		assert.equal(response.status, 201);
		const receipt = (await response.json()) as {
			commandId: string;
			outcome: string;
			workflowVersion: number;
			lastEventSeq: number;
		};
		assert.equal(receipt.commandId, "cmd-start");
		assert.equal(receipt.outcome, "accepted");
		assert.equal(receipt.workflowVersion, 1);
		assert.equal(
			context.runtime.getWorkflowProjection(workflowId)?.workflow.state,
			"running",
		);
	});
});

test("command bodies cannot supply actor, operator, or commandId", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		for (const extra of [
			{ actor: "operator:forged" },
			{ operator: { actorRef: "operator:forged", capabilities: [] } },
			{ commandId: "different-id" },
		]) {
			const response = await putCommand(
				context.server.url,
				workflowId,
				"cmd-forge",
				{ type: "pause", expectedWorkflowVersion: 1, ...extra },
				cookie,
			);
			assert.equal(response.status, 400, JSON.stringify(extra));
		}
	});
});

test("same commandId replay returns the stored receipt without new effects", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		const projection = context.runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		const workflowVersion = projection.workflow.version;
		const first = await putCommand(
			context.server.url,
			workflowId,
			"cmd-pause",
			{ type: "pause", expectedWorkflowVersion: workflowVersion },
			cookie,
		);
		assert.equal(first.status, 201);
		const firstReceipt = (await first.json()) as { workflowVersion: number; lastEventSeq: number };
		const replay = await putCommand(
			context.server.url,
			workflowId,
			"cmd-pause",
			{ type: "pause", expectedWorkflowVersion: workflowVersion },
			cookie,
		);
		assert.equal(replay.status, 201);
		const replayReceipt = (await replay.json()) as { workflowVersion: number; lastEventSeq: number };
		assert.deepEqual(replayReceipt, firstReceipt);
		const currentProjection = context.runtime.getWorkflowProjection(workflowId);
		assert.equal(currentProjection?.workflow.version, firstReceipt.workflowVersion);
		assert.equal(currentProjection?.workflow.lastEventSeq, firstReceipt.lastEventSeq);
	});
});

test("same commandId with a different payload is an idempotency conflict", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		const projection = context.runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		const workflowVersion = projection.workflow.version;
		const first = await putCommand(
			context.server.url,
			workflowId,
			"cmd-conflict",
			{ type: "pause", expectedWorkflowVersion: workflowVersion },
			cookie,
		);
		assert.equal(first.status, 201);
		const conflict = await putCommand(
			context.server.url,
			workflowId,
			"cmd-conflict",
			{ type: "pause", expectedWorkflowVersion: workflowVersion, reason: "different" },
			cookie,
		);
		assert.equal(conflict.status, 409);
		const receipt = (await conflict.json()) as { outcome: string };
		assert.equal(receipt.outcome, "idempotency_conflict");
	});
});

test("stale expected workflow version is a version conflict", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		const response = await putCommand(
			context.server.url,
			workflowId,
			"cmd-stale",
			{ type: "pause", expectedWorkflowVersion: 0 },
			cookie,
		);
		assert.equal(response.status, 409);
		const receipt = (await response.json()) as { outcome: string };
		assert.equal(receipt.outcome, "version_conflict");
	});
});

test("operators without workflow:operate receive a persisted denial", async () => {
	await withServer(async (context) => {
		const adminCookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, adminCookie);
		const viewerCookie = await bootstrap(context.server.url, "token-viewer");
		const response = await putCommand(
			context.server.url,
			workflowId,
			"cmd-denied",
			{ type: "pause", expectedWorkflowVersion: 1 },
			viewerCookie,
		);
		assert.equal(response.status, 403);
		const receipt = (await response.json()) as { outcome: string };
		assert.equal(receipt.outcome, "capability_denied");
		const stored = context.runtime.getCommandReceipt(workflowId, "cmd-denied");
		assert.equal(stored?.outcome, "capability_denied");
	});
});

test("invalid transitions and business-rule violations map to conflict and rejection", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		const projection = context.runtime.getWorkflowProjection(workflowId);
		assert.ok(projection);
		const workflowVersion = projection.workflow.version;
		const stateConflict = await putCommand(
			context.server.url,
			workflowId,
			"cmd-resume",
			{ type: "resume", expectedWorkflowVersion: workflowVersion },
			cookie,
		);
		assert.equal(stateConflict.status, 409);
		assert.equal(((await stateConflict.json()) as { outcome: string }).outcome, "state_conflict");
		const businessRule = await putCommand(
			context.server.url,
			workflowId,
			"cmd-dispose",
			{ type: "dispose-decision", expectedWorkflowVersion: workflowVersion, payload: {} },
			cookie,
		);
		assert.equal(businessRule.status, 422);
		assert.equal(
			((await businessRule.json()) as { outcome: string }).outcome,
			"business_rule_rejected",
		);
	});
});

test("transport rejects unknown workflows, malformed envelopes, and unknown routes", async () => {
	await withServer(async (context) => {
		const cookie = await bootstrap(context.server.url);
		const unknownWorkflow = await putCommand(
			context.server.url,
			999999,
			"cmd-missing",
			{ type: "start", expectedWorkflowVersion: 0 },
			cookie,
		);
		assert.equal(unknownWorkflow.status, 404);
		const { workflowId } = await createStartedWorkflow(context, cookie);
		const malformedJson = await putCommand(
			context.server.url,
			workflowId,
			"cmd-bad-json",
			"{not json",
			cookie,
		);
		assert.equal(malformedJson.status, 400);
		const unknownType = await putCommand(
			context.server.url,
			workflowId,
			"cmd-bad-type",
			{ type: "force-ready", expectedWorkflowVersion: 1 },
			cookie,
		);
		assert.equal(unknownType.status, 400);
		const missingVersion = await putCommand(
			context.server.url,
			workflowId,
			"cmd-no-version",
			{ type: "pause" },
			cookie,
		);
		assert.equal(missingVersion.status, 400);
		const unknownRoute = await fetch(`${context.server.url}/api/workflows/${workflowId}`, {
			method: "PATCH",
			headers: { "content-type": "application/json", cookie },
			body: JSON.stringify({ state: "archived" }),
		});
		assert.equal(unknownRoute.status, 404);
	});
});

test("session cookie carries the Secure attribute when TLS is enabled", async () => {
	const directory = mkdtempSync(join(tmpdir(), "operator-server-tls-"));
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath: join(directory, "test.db"),
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(),
		outboxTransport: createOutboxTransport(),
	});
	const server = await startOperatorServer({
		runtime,
		operators: { "token-admin": ADMIN },
		secureCookies: true,
	});
	try {
		const response = await fetch(`${server.url}/api/session`, {
			method: "POST",
			headers: { authorization: "Bearer token-admin" },
		});
		assert.equal(response.status, 201);
		assert.match(response.headers.get("set-cookie") ?? "", /Secure/);
	} finally {
		await server.close();
		runtime.close();
		rmSync(directory, { recursive: true, force: true });
	}
});

test("non-loopback binding requires configured operator credentials", async () => {
	const directory = mkdtempSync(join(tmpdir(), "operator-server-bind-"));
	const runtime = await openHeadlessWorkflowRuntime({
		databasePath: join(directory, "test.db"),
		clock: createFixtureClock("2026-08-12T10:00:00.000Z"),
		hashProvider: createHashProvider(),
		crashInjector: createCrashInjector(),
		outboxTransport: createOutboxTransport(),
	});
	try {
		await assert.rejects(
			() => startOperatorServer({ runtime, operators: {}, host: "0.0.0.0" }),
			/non-loopback/i,
		);
	} finally {
		runtime.close();
		rmSync(directory, { recursive: true, force: true });
	}
});
test("asset relation create, detail enrich, and workspace graph are exposed over HTTP", async () => {
	await withServer(async ({ server, workspaceId }) => {
		const cookie = await bootstrap(server.url);
		const stakeholder = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "stakeholder",
			content: { name: "Customer" },
		});
		assert.equal(stakeholder.status, 201);
		const stakeholderBody = (await stakeholder.json()) as { assetId: number; revisionId: number };
		const scenario = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "scenario",
			title: "Checkout",
			content: scenarioContent("Checkout"),
			relations: [{ toAssetId: stakeholderBody.assetId, type: "involves" }],
		});
		assert.equal(scenario.status, 201);
		const scenarioBody = (await scenario.json()) as { assetId: number; revisionId: number };

		const detail = await fetch(`${server.url}/api/assets/${scenarioBody.assetId}`, { headers: { cookie } });
		assert.equal(detail.status, 200);
		const detailBody = (await detail.json()) as { resolvedGraph: { outgoing: Array<{ assetId: number; revisionId: number; type: string; title: string; kind: string }> } };
		assert.deepEqual(detailBody.resolvedGraph.outgoing, [{
			assetId: stakeholderBody.assetId,
			revisionId: stakeholderBody.revisionId,
			type: "involves",
			title: "Customer",
			kind: "stakeholder",
		}]);

		const graph = await fetch(`${server.url}/api/assets/graph?workspaceId=${workspaceId}`, { headers: { cookie } });
		assert.equal(graph.status, 200);
		assert.deepEqual(await graph.json(), {
			nodes: [
				{ assetId: stakeholderBody.assetId, kind: "stakeholder", title: "Customer" },
				{ assetId: scenarioBody.assetId, kind: "scenario", title: "Checkout" },
			],
			edges: [{ fromAssetId: scenarioBody.assetId, toAssetId: stakeholderBody.assetId, type: "involves" }],
		});
	});
});

test("invalid asset relations return aggregated errors without creating the source asset", async () => {
	await withServer(async ({ server, workspaceId }) => {
		const cookie = await bootstrap(server.url);
		const invalid = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "scenario",
			title: "Invalid",
			content: scenarioContent("Invalid"),
			relations: [
				{ toAssetId: 999999, type: "involves" },
				{ toAssetId: 999998, type: "contains" },
			],
		});
		assert.equal(invalid.status, 400);
		assert.deepEqual(await invalid.json(), {
			error: "invalid_relations",
			invalidRelations: [
				{ toAssetId: 999999, type: "involves", reason: "unknown_asset" },
				{ toAssetId: 999998, type: "contains", reason: "unknown_asset" },
			],
		});
		const list = await fetch(`${server.url}/api/assets?workspaceId=${workspaceId}`, { headers: { cookie } });
		assert.equal(list.status, 200);
		assert.deepEqual((await list.json() as { assets: Array<{ title: string }> }).assets, []);
	});
});
test("asset export and import preserve portable relationship edges", async () => {
	await withServer(async ({ server, runtime, workspaceId }) => {
		const cookie = await bootstrap(server.url);
		const stakeholder = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "stakeholder",
			content: { name: "Customer" },
		});
		const stakeholderBody = (await stakeholder.json()) as { assetId: number };
		const scenario = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "scenario",
			title: "Checkout",
			content: scenarioContent("Checkout"),
			relations: [{ toAssetId: stakeholderBody.assetId, type: "involves" }],
		});
		assert.equal(scenario.status, 201);

		const exported = await fetch(`${server.url}/api/assets/export?workspaceId=${workspaceId}`, { headers: { cookie } });
		assert.equal(exported.status, 200);
		const bundle = await exported.json() as {
			assets: Array<{ kind: string; title: string; revisions: Array<{ content: unknown }> }>;
			relations: Array<{ fromTitle: string; fromKind: string; toTitle: string; toKind: string; type: string }>;
		};
		assert.deepEqual(bundle.relations, [{ fromTitle: "Checkout", fromKind: "scenario", toTitle: "Customer", toKind: "stakeholder", type: "involves" }]);
		assert.equal("assetId" in bundle.relations[0], false);

		const destinationWorkspaceId = runtime.createWorkspace({ repoPath: "/destination", name: "destination" });
		const imported = await importAssets(server.url, cookie, {
			workspaceId: destinationWorkspaceId,
			assets: bundle.assets.map((asset) => ({ kind: asset.kind, title: asset.title, content: asset.revisions.at(-1)?.content })),
			relations: bundle.relations,
		});
		assert.equal(imported.status, 201);
		const importedBody = (await imported.json()) as { assetIds: number[] };
		assert.equal(importedBody.assetIds.length, 2);

		const graph = await fetch(`${server.url}/api/assets/graph?workspaceId=${destinationWorkspaceId}`, { headers: { cookie } });
		assert.deepEqual((await graph.json() as { edges: unknown[] }).edges, [{ fromAssetId: importedBody.assetIds[1], toAssetId: importedBody.assetIds[0], type: "involves" }]);
	});
});

test("relation import reuses title-kind assets and rolls back malformed edges", async () => {
	await withServer(async ({ server, runtime, workspaceId }) => {
		const cookie = await bootstrap(server.url);
		const destinationWorkspaceId = runtime.createWorkspace({ repoPath: "/destination", name: "destination" });
		const first = await importAssets(server.url, cookie, {
			workspaceId: destinationWorkspaceId,
			assets: [
				{ kind: "stakeholder", title: "Customer", content: { name: "Customer" } },
				{ kind: "scenario", title: "Checkout", content: scenarioContent("Checkout") },
			],
			relations: [{ fromTitle: "Checkout", fromKind: "scenario", toTitle: "Customer", toKind: "stakeholder", type: "involves" }],
		});
		assert.equal(first.status, 201);
		const firstIds = (await first.json() as { assetIds: number[] }).assetIds;
		const repeated = await importAssets(server.url, cookie, {
			workspaceId: destinationWorkspaceId,
			assets: [
				{ kind: "stakeholder", title: "Customer", content: { name: "Customer", description: "Ignored" } },
				{ kind: "scenario", title: "Checkout", content: { title: "Checkout", changed: true } },
			],
			relations: [{ fromTitle: "Checkout", fromKind: "scenario", toTitle: "Customer", toKind: "stakeholder", type: "involves" }],
		});
		assert.equal(repeated.status, 201);
		assert.deepEqual((await repeated.json() as { assetIds: number[] }).assetIds, firstIds);

		const malformed = await importAssets(server.url, cookie, {
			workspaceId,
			assets: [{ kind: "scenario", title: "Broken", content: { title: "Broken" } }],
			relations: [{ fromTitle: "Broken", fromKind: "scenario", toTitle: "Missing", toKind: "stakeholder", type: "involves" }],
		});
		assert.equal(malformed.status, 400);
		const list = await fetch(`${server.url}/api/assets?workspaceId=${workspaceId}`, { headers: { cookie } });
		const replaced = await importAssets(server.url, cookie, {
			workspaceId: destinationWorkspaceId,
			assets: [
				{ kind: "stakeholder", title: "Customer", content: { name: "Customer" } },
				{ kind: "scenario", title: "Checkout", content: { title: "Checkout" } },
			],
			relations: [],
		});
		assert.equal(replaced.status, 201);
		const graph = await fetch(`${server.url}/api/assets/graph?workspaceId=${destinationWorkspaceId}`, { headers: { cookie } });
		assert.deepEqual((await graph.json() as { edges: unknown[] }).edges, []);
		assert.deepEqual((await list.json() as { assets: Array<{ title: string }> }).assets, []);
	});
});
test("asset deletion scans relation edges in both directions and unified update keeps graph titles current", async () => {
	await withServer(async ({ server, workspaceId }) => {
		const cookie = await bootstrap(server.url);
		const stakeholder = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "stakeholder",
			content: { name: "Customer" },
		});
		const stakeholderBody = (await stakeholder.json()) as { assetId: number; revisionId: number };
		const scenario = await createAsset(server.url, cookie, {
			workspaceId,
			kind: "scenario",
			title: "Checkout",
			content: scenarioContent("Checkout"),
			relations: [{ toAssetId: stakeholderBody.assetId, type: "involves" }],
		});
		const scenarioBody = (await scenario.json()) as { assetId: number; revisionId: number };
		const updated = await updateAsset(server.url, cookie, stakeholderBody.assetId, {
			expectedRevisionId: stakeholderBody.revisionId,
			title: "Buyer",
			content: { name: "Buyer" },
			relations: [],
		});
		assert.equal(updated.status, 200);
		const detail = await fetch(`${server.url}/api/assets/${scenarioBody.assetId}`, { headers: { cookie } });
		assert.equal((await detail.json() as { resolvedGraph: { outgoing: Array<{ title: string }> } }).resolvedGraph.outgoing[0].title, "Buyer");

		const deleteTarget = await fetch(`${server.url}/api/assets/${stakeholderBody.assetId}`, { method: "DELETE", headers: { cookie } });
		assert.equal(deleteTarget.status, 409);
		assert.deepEqual((await deleteTarget.json() as { error: string; refs: Array<{ assetId: number; kind: string; type: string }> }).refs, [{ assetId: scenarioBody.assetId, kind: "scenario", title: "Checkout", type: "involves" }]);
		const deleteSource = await fetch(`${server.url}/api/assets/${scenarioBody.assetId}`, { method: "DELETE", headers: { cookie } });
		assert.equal(deleteSource.status, 409);
	});
});
